// $lib/artemis/runner.ts
//
// Compiled-only runner — loads annotations from a GitHub Pages-hosted dataset.
// Supports multiple independent layers, each toggled on/off via the UI.

import type maplibregl from "maplibre-gl";
import { WarpedMapLayer } from "@allmaps/maplibre";
import type { RunResult, StepTiming } from "$lib/artemis/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompiledIndexEntry = {
  label: string;
  sourceManifestUrl: string;
  sourceCollectionUrl: string;
  centerLon?: number;
  centerLat?: number;
  compiledManifestPath: string;
  mirroredAllmapsAnnotationPath?: string;
  canvasCount: number;
  manifestAllmapsId?: string;
  manifestAllmapsUrl?: string;
  manifestAllmapsStatus?: number;
  georefDetectedBy?: "none" | "manifest" | "canvas";
  annotSource?: "single" | "multi" | "none";
  canvasAllmapsHits?: Array<{
    canvasId: string;
    canvasAllmapsId?: string;
    canvasAllmapsUrl?: string;
    canvasAllmapsStatus?: number;
    mirroredAllmapsAnnotationPath?: string;
  }>;
  isVerzamelblad?: boolean;
  canvasIds: string[];
};

export type LayerInfo = {
  sourceCollectionUrl: string;
  sourceCollectionLabel: string;
  compiledCollectionPath: string;
  manifestCount: number;
  georefCount: number;
  singleCanvasGeorefCount?: number;
  multiCanvasGeorefCount?: number;
  renderLayerKey?: string;
  renderLayerLabel?: string;
  parentRenderLayerKey?: string;
  hidden?: boolean;
};

export type CompiledIndex = {
  generatedAt: string;
  totalManifests: number;
  georefManifests: number;
  mirroredOk: number;
  compiledOk: number;
  layers: LayerInfo[];
  renderLayers?: LayerInfo[];
  index: CompiledIndexEntry[];
};

export type CompiledRunnerConfig = {
  datasetBaseUrl: string;
  indexPath?: string; // default "index.json"
  fetchTimeoutMs?: number; // default 30000
};

export type SubLayerRenderStats = {
  registeredMaps: number;
  fetchableMaps: number;
};

export type LayerRenderStats = {
  registeredMaps: number;
  visibleMaps: number;
  fetchableMaps: number;
  firstTilesLoaded: number;
  peakVisibleMaps: number;
  subLayers?: SubLayerRenderStats[]; // only present when layer was split (chunkCount > 1)
};

type RunnerLog = (level: "INFO" | "WARN" | "ERROR", msg: string) => void;

export function getLayerGroupId(layerInfo: LayerInfo): string {
  return `${layerInfo.compiledCollectionPath}::${layerInfo.renderLayerKey ?? "all"}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowMs() {
  return performance.now();
}

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
      throw new Error(`Expected JSON but got HTML from ${url} (wrong datasetBaseUrl?)`);
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Index cache (fetch once per base URL)
// ---------------------------------------------------------------------------

let cachedIndex: CompiledIndex | null = null;

export function resetCompiledIndexCache() {
  cachedIndex = null;
}

export async function loadCompiledIndex(cfg: CompiledRunnerConfig): Promise<CompiledIndex> {
  if (cachedIndex) return cachedIndex;

  const indexUrl = joinUrl(cfg.datasetBaseUrl, cfg.indexPath ?? "index.json");
  cachedIndex = await fetchJson<CompiledIndex>(indexUrl, cfg.fetchTimeoutMs ?? 30000);
  return cachedIndex;
}

// ---------------------------------------------------------------------------
// Map readiness
// ---------------------------------------------------------------------------

function waitForMapReady(map: maplibregl.Map): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();

  return new Promise((resolve) => {
    const onLoad = () => {
      map.off("load", onLoad);
      resolve();
    };
    map.on("load", onLoad);
  });
}

// ---------------------------------------------------------------------------
// IIIF tile cache — shared across all layers for the page lifetime
// ---------------------------------------------------------------------------

const iiifTileCache = new Map<string, Promise<ArrayBuffer>>();
let iiifCacheHits = 0;
let iiifCacheMisses = 0;

export function getIiifCacheStats() {
  return { size: iiifTileCache.size, hits: iiifCacheHits, misses: iiifCacheMisses };
}

function cachedFetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string" ? input
    : input instanceof URL ? input.toString()
    : (input as Request).url;

  if (!iiifTileCache.has(url)) {
    iiifCacheMisses++;
    iiifTileCache.set(
      url,
      fetch(input, init)
        .then((r) => {
          if (!r.ok) { iiifTileCache.delete(url); throw new Error(`HTTP ${r.status}`); }
          return r.arrayBuffer();
        })
        .catch((err) => { iiifTileCache.delete(url); throw err; })
    );
  } else {
    iiifCacheHits++;
  }

  return iiifTileCache.get(url)!.then((buf) => new Response(buf));
}

// ---------------------------------------------------------------------------
// Allmaps payload normalization
// ---------------------------------------------------------------------------

function normalizeAllmapsPayload(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return { "@context": "http://www.w3.org/ns/anno.jsonld", type: "AnnotationPage", items: raw };
  }
  return raw;
}

type AnnotationRequest = {
  path: string;
};

function getMirroredAnnotationRequests(entry: CompiledIndexEntry): AnnotationRequest[] {
  // Collect canvas paths (deduplicated)
  const canvasPaths: string[] = [];
  const seenCanvasPaths = new Set<string>();
  for (const hit of entry.canvasAllmapsHits ?? []) {
    const canvasPath = hit.mirroredAllmapsAnnotationPath?.trim();
    if (!canvasPath || seenCanvasPaths.has(canvasPath)) continue;
    canvasPaths.push(canvasPath);
    seenCanvasPaths.add(canvasPath);
  }

  const manifestPath = entry.mirroredAllmapsAnnotationPath?.trim();

  // Always prefer the manifest annotation when available — it is the canonical
  // aggregated source and ensures a single addGeoreferenceAnnotation call regardless
  // of whether the entry is single- or multi-canvas. Canvas paths are only used as a
  // fallback when no manifest annotation was mirrored.
  if (manifestPath) return [{ path: manifestPath }];
  if (canvasPaths.length > 0) return canvasPaths.map((path) => ({ path }));
  return [];
}

function normalizePath(path: string): string {
  return path.replace(/^[./]+/, "");
}

function toAbsoluteUrl(baseUrl: string, maybePathOrUrl: string): string {
  if (/^https?:\/\//i.test(maybePathOrUrl)) return maybePathOrUrl;
  return joinUrl(baseUrl, maybePathOrUrl);
}

// ---------------------------------------------------------------------------
// Layer group tracking
// groupId = compiledCollectionPath (e.g. "collections/dbd858bb241ff374")
// ---------------------------------------------------------------------------

// Maps groupId → list of MapLibre layer IDs added for that group
const activeLayersByGroup = new Map<string, string[]>();
// Maps groupId -> active Allmaps custom layers (for runtime controls like opacity).
const activeWarpedLayersByGroup = new Map<string, WarpedMapLayer[]>();

// Maps groupId → cleanup fn (removes map.on handlers + clears keepalive interval)
// Must be called before re-adding a layer group to prevent handler accumulation.
const activeLayerCleanup = new Map<string, () => void>();

async function removeMaplibreLayer(map: maplibregl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // ignore
  }
}

export async function removeLayerGroup(map: maplibregl.Map, groupId: string) {
  await waitForMapReady(map);
  // Clean up stale event handlers and intervals BEFORE removing the MapLibre layer.
  // Without this, map.on handlers from previous loads accumulate — each reload adds
  // another full set of handlers, causing doubled/tripled event counts and flickering.
  activeLayerCleanup.get(groupId)?.();
  activeLayerCleanup.delete(groupId);
  const ids = activeLayersByGroup.get(groupId) ?? [];
  for (const id of ids) await removeMaplibreLayer(map, id);
  activeLayersByGroup.delete(groupId);
  activeWarpedLayersByGroup.delete(groupId);
}

// Enforce z-order of layer groups. Pass orderedGroupIds bottom-to-top;
// each group's layers are moved to the top of the stack in that order,
// so the last group ends up rendered on top of all others.
export function reorderLayerGroups(map: maplibregl.Map, orderedGroupIds: string[]) {
  for (const groupId of orderedGroupIds) {
    const ids = activeLayersByGroup.get(groupId) ?? [];
    for (const id of ids) {
      try {
        if (map.getLayer(id)) map.moveLayer(id);
      } catch { /* ignore */ }
    }
  }
}

export function setLayerGroupOpacity(map: maplibregl.Map, groupId: string, opacity: number) {
  const clamped = Math.max(0, Math.min(1, opacity));
  const layers = activeWarpedLayersByGroup.get(groupId) ?? [];
  for (const layer of layers) {
    try {
      layer.setOpacity(clamped);
    } catch {
      // ignore
    }
  }
}

export function isLayerGroupRendered(map: maplibregl.Map, groupId: string): boolean {
  const ids = activeLayersByGroup.get(groupId) ?? [];
  return ids.some((id) => !!map.getLayer(id));
}

export function getLayerGroupLayerIds(groupId: string): string[] {
  return [...(activeLayersByGroup.get(groupId) ?? [])];
}

export async function clearAllLayerGroups(map: maplibregl.Map) {
  await waitForMapReady(map);
  for (const [groupId] of activeLayersByGroup) {
    await removeLayerGroup(map, groupId);
  }
}

// ---------------------------------------------------------------------------
// Run a single layer group (all entries from one source collection)
// ---------------------------------------------------------------------------

export async function runLayerGroup(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;
  layerInfo: LayerInfo;
  log?: RunnerLog;
  onProgress?: (done: number, total: number, latest: RunResult) => void;
  onRenderStats?: (stats: LayerRenderStats) => void;
}): Promise<RunResult[]> {
  const { map, cfg, layerInfo, log } = opts;
  const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;

  await waitForMapReady(map);

  const groupId = getLayerGroupId(layerInfo);

  // Remove any previously loaded version of this layer group
  await removeLayerGroup(map, groupId);

  const index = await loadCompiledIndex(cfg);
  const timeout = cfg.fetchTimeoutMs ?? 30000;
  const compiledCollectionUrl = joinUrl(cfg.datasetBaseUrl, layerInfo.compiledCollectionPath);
  const compiledCollection = await fetchJson<{ manifests?: Array<{ "@id"?: string }> }>(
    compiledCollectionUrl,
    timeout
  );

  const entryByAbsoluteManifestUrl = new Map<string, CompiledIndexEntry>();
  const entryByRelativeManifestPath = new Map<string, CompiledIndexEntry>();
  for (const entry of index.index) {
    const absoluteUrl = toAbsoluteUrl(cfg.datasetBaseUrl, entry.compiledManifestPath);
    entryByAbsoluteManifestUrl.set(absoluteUrl, entry);
    entryByRelativeManifestPath.set(normalizePath(entry.compiledManifestPath), entry);
  }

  const entriesUnfiltered: CompiledIndexEntry[] = [];
  for (const m of compiledCollection.manifests ?? []) {
    const id = m?.["@id"]?.trim();
    if (!id) continue;
    const byAbsolute = entryByAbsoluteManifestUrl.get(id);
    if (byAbsolute) {
      entriesUnfiltered.push(byAbsolute);
      continue;
    }
    const byRelative = entryByRelativeManifestPath.get(normalizePath(id));
    if (byRelative) entriesUnfiltered.push(byRelative);
  }

  const entries = entriesUnfiltered.filter((entry) => {
    if (layerInfo.renderLayerKey === "verzamelblad") return entry.isVerzamelblad === true;
    if (layerInfo.renderLayerKey === "default") return entry.isVerzamelblad !== true;
    if (layerInfo.renderLayerKey === "single-canvas") return entry.annotSource === "single";
    if (layerInfo.renderLayerKey === "multi-canvas") return entry.annotSource === "multi";
    return true;
  });

  log?.("INFO", `Layer "${layerLabel}": ${entries.length} entries`);

  // Log annotation source strategy for debug visibility
  {
    const georefEntries = entries.filter((e) => e.annotSource !== "none" && e.annotSource);
    const noneEntries = entries.filter((e) => e.annotSource === "none" || !e.annotSource);
    const usingManifest = georefEntries.filter((e) => e.mirroredAllmapsAnnotationPath?.trim()).length;
    const usingCanvas = georefEntries.length - usingManifest;
    if (georefEntries.length > 0) {
      log?.(
        "INFO",
        `[${layerLabel}] annotation strategy: georef=${georefEntries.length}(manifest:${usingManifest} canvas-fallback:${usingCanvas}) none=${noneEntries.length}`
      );
    }
  }

  const results: RunResult[] = [];
  const mapMetaByMapId = new Map<string, { label: string; manifestAllmapsUrl?: string }>();

  // Prefetch all annotation JSONs in parallel
  const prefetch = new Map<string, Promise<unknown>>();
  for (const entry of entries) {
    for (const req of getMirroredAnnotationRequests(entry)) {
      const url = joinUrl(cfg.datasetBaseUrl, req.path);
      prefetch.set(url, fetchJson<unknown>(url, timeout).catch(() => null));
    }
  }

  // Keep a single layer for stability. Multi-layer splitting can leave one
  // sub-layer permanently non-fetchable on dense Primitief runs.
  const chunkCount = 1;

  const layerIds = Array.from({ length: chunkCount }, (_, i) =>
    `warped-layer-${groupId.replace(/\//g, "-")}${chunkCount > 1 ? `-${i}` : ""}`
  );
  const layers: WarpedMapLayer[] = [];
  for (let i = 0; i < chunkCount; i++) {
    await removeMaplibreLayer(map, layerIds[i]);
    const l = new WarpedMapLayer({ layerId: layerIds[i] } as any);
    try {
      map.addLayer(l as any);
      layers.push(l);
    } catch (e: any) {
      log?.("ERROR", `addLayer failed (${layerIds[i]}): ${e?.message ?? String(e)}`);
      return [];
    }
  }
  activeLayersByGroup.set(groupId, layerIds);
  activeWarpedLayersByGroup.set(groupId, layers);

  // ---------------------------------------------------------------------------
  // Debug event listeners
  // WarpedMapLayer fires events on the MapLibre map via map.fire(), not on
  // itself. Use map.on() and filter by layerId in event data.
  // ---------------------------------------------------------------------------
  const label = layerLabel;
  const NOISY_LOG_EVERY = 25;
  let mapsAdded = 0;
  let imageInfosAdded = 0;
  let firstTilesLoaded = 0;
  let mapsInViewport = 0;
  let tileFetchErrors = 0;
  let annotationErrorCount = 0;
  let manifestsWithAnnotationErrors = 0;
  let warpedMapAddedEvents = 0;
  let firstMapTileLoadedEvents = 0;
  const addedMapIds = new Set<string>();
  const imageInfoMapIds = new Set<string>();
  const firstTileMapIds = new Set<string>();
  const inViewportMapIds = new Set<string>();
  let fallbackInViewportCount = 0;
  let peakMapsInViewport = 0;
  let lastProgressAtMs = nowMs();
  let lastStatsEmitAtMs = 0;

  const layerIdSet = new Set(layerIds);

  // map.on handlers keyed by event type so we can remove them later
  const mapHandlers: { type: string; fn: (e: any) => void; tileCache?: any }[] = [];
  function onMap(type: string, fn: (e: any) => void) {
    const handler = (e: any) => { if (layerIdSet.has(e.layerId)) fn(e); };
    map.on(type as any, handler);
    mapHandlers.push({ type, fn: handler });
  }

  function getAllFetchableSet(): Set<string> {
    const combined = new Set<string>();
    for (const l of layers) {
      const renderer: any = (l as any).renderer;
      if (renderer?.mapsWithFetchableTilesForViewport instanceof Set) {
        for (const id of renderer.mapsWithFetchableTilesForViewport) combined.add(id);
      }
    }
    return combined;
  }

  function getWarpedMapFromAnyLayer(mapId: string): any {
    for (const l of layers) {
      const wm = (l as any).renderer?.warpedMapList?.getWarpedMap?.(mapId);
      if (wm) return wm;
    }
    return null;
  }

  function emitRenderStats(force = false) {
    const now = nowMs();
    if (!force && now - lastStatsEmitAtMs < 120) return;
    lastStatsEmitAtMs = now;
    const fetchableMaps = getAllFetchableSet().size;
    const subLayers: SubLayerRenderStats[] | undefined = layers.length > 1
      ? layers.map((l) => {
          const renderer: any = (l as any).renderer;
          return {
            registeredMaps: Array.from(renderer?.warpedMapList?.getWarpedMaps?.() ?? []).length,
            fetchableMaps: renderer?.mapsWithFetchableTilesForViewport instanceof Set
              ? renderer.mapsWithFetchableTilesForViewport.size
              : 0
          };
        })
      : undefined;
    opts.onRenderStats?.({
      registeredMaps: mapsAdded,
      visibleMaps: mapsInViewport,
      fetchableMaps,
      firstTilesLoaded,
      peakVisibleMaps: peakMapsInViewport,
      subLayers
    });
  }

  onMap("warpedmapadded", (e) => {
    const ids: string[] = e.mapIds ?? [];
    warpedMapAddedEvents++;
    for (const id of ids) addedMapIds.add(id);
    mapsAdded = addedMapIds.size || warpedMapAddedEvents;
    emitRenderStats();
    if (mapsAdded <= 5 || mapsAdded % NOISY_LOG_EVERY === 0) {
      log?.("INFO", `[${label}] warpedmapadded events:${warpedMapAddedEvents} maps:${mapsAdded} ids=[${ids.join(",")}]`);
    }
  });

  onMap("warpedmapremoved", (e) => {
    const ids: string[] = e.mapIds ?? [];
    log?.("WARN", `[${label}] warpedmapremoved ids=[${ids.join(",")}] (unexpected!)`);
  });

  onMap("imageinfosadded", (e) => {
    const ids: string[] = e.mapIds ?? [];
    for (const id of ids) imageInfoMapIds.add(id);
    imageInfosAdded = imageInfoMapIds.size || (imageInfosAdded + 1);
    lastProgressAtMs = nowMs();
    emitRenderStats();
    if (imageInfosAdded <= 5 || imageInfosAdded % NOISY_LOG_EVERY === 0) {
      log?.("INFO", `[${label}] imageinfosadded maps:${imageInfosAdded} ids=[${ids.join(",")}]`);
    }
  });

  onMap("firstmaptileloaded", (e) => {
    const ids: string[] = e.mapIds ?? [];
    firstMapTileLoadedEvents++;
    for (const id of ids) firstTileMapIds.add(id);
    firstTilesLoaded = firstTileMapIds.size || firstMapTileLoadedEvents;
    lastProgressAtMs = nowMs();
    emitRenderStats();
    if (firstTilesLoaded <= 5 || firstTilesLoaded % NOISY_LOG_EVERY === 0) {
      log?.("INFO", `[${label}] firstmaptileloaded events:${firstMapTileLoadedEvents} maps:${firstTilesLoaded} ids=[${ids.join(",")}]`);
    }
  });

  onMap("allrequestedtilesloaded", () => {
    log?.("INFO", `[${label}] allrequestedtilesloaded — registered:${mapsAdded} imgInfos:${imageInfosAdded} firstTiles:${firstTilesLoaded} inViewport:${mapsInViewport} tileErrs:${tileFetchErrors}`);
  });

  let tilesLoaded = 0;
  let tilesDeleted = 0;
  let lastTileActivityLog = 0;

  onMap("maptileloaded", () => {
    tilesLoaded++;
    lastProgressAtMs = nowMs();
  });

  onMap("maptiledeleted", (e) => {
    tilesDeleted++;
    const now = performance.now();
    // Log deletions in bursts (throttled) so we can see cache eviction
    if (now - lastTileActivityLog > 500) {
      log?.("WARN", `[${label}] maptiledeleted — activeTiles:${tilesLoaded - tilesDeleted} (loaded:${tilesLoaded} deleted:${tilesDeleted})`);
      lastTileActivityLog = now;
    }
  });

  onMap("warpedmapentered", (e) => {
    const ids: string[] = e.mapIds ?? [];
    if (ids.length > 0) {
      for (const id of ids) inViewportMapIds.add(id);
      mapsInViewport = inViewportMapIds.size;
    } else {
      fallbackInViewportCount++;
      mapsInViewport = inViewportMapIds.size || fallbackInViewportCount;
    }
    peakMapsInViewport = Math.max(peakMapsInViewport, mapsInViewport);
    lastProgressAtMs = nowMs();
    emitRenderStats();
    // Only log in small batches to avoid flooding (burst of 273 is useless)
    if (mapsInViewport <= 5 || mapsInViewport % 50 === 0) {
      log?.("INFO", `[${label}] warpedmapentered inViewport:${mapsInViewport}`);
    }
  });

  onMap("warpedmapleft", (e) => {
    const ids: string[] = e.mapIds ?? [];
    if (ids.length > 0) {
      for (const id of ids) inViewportMapIds.delete(id);
      mapsInViewport = inViewportMapIds.size;
    } else {
      fallbackInViewportCount = Math.max(0, fallbackInViewportCount - 1);
      mapsInViewport = inViewportMapIds.size || fallbackInViewportCount;
    }
    emitRenderStats();
    log?.("INFO", `[${label}] warpedmapleft ×${ids.length || 1} inViewport:${mapsInViewport}`);
  });

  // Tile fetch errors — on internal tileCache (not propagated to map.fire())
  for (const l of layers) {
    const tileCache = (l as any).renderer?.tileCache;
    if (tileCache) {
      const tileErrHandler = (e: any) => {
        tileFetchErrors++;
        log?.("ERROR", `[${label}] tilefetcherror #${tileFetchErrors} url=${e.data?.tileUrl ?? ""}`);
      };
      tileCache.addEventListener("tilefetcherror", tileErrHandler);
      mapHandlers.push({ type: "__tilefetcherror__", fn: tileErrHandler, tileCache });
    }
  }

  // Register cleanup so removeLayerGroup can tear down all handlers + intervals.
  // repaintHandle is declared later; use a ref so cleanup captures the final value.
  const cleanupRef = { interval: -1 as ReturnType<typeof setInterval> };
  activeLayerCleanup.set(groupId, () => {
    clearInterval(cleanupRef.interval);
    for (const h of mapHandlers) {
      if (h.type === "__tilefetcherror__") h.tileCache?.removeEventListener("tilefetcherror", h.fn);
      else map.off(h.type as any, h.fn);
    }
    log?.("INFO", `[${label}] cleanup: removed ${mapHandlers.length} handlers`);
  });

  // Phase 1: fetch all annotation JSONs in parallel
  type FetchedAnnotation =
    | { url: string; raw: unknown; fetchMs: number }
    | { url: string; error: string };
  type Fetched =
    | { entry: CompiledIndexEntry; annotations: FetchedAnnotation[] }
    | { entry: CompiledIndexEntry; error: string };

  const fetchedAll = await Promise.all(
    entries.map(async (entry): Promise<Fetched> => {
      const requests = getMirroredAnnotationRequests(entry);
      if (requests.length === 0) {
        return { entry, error: "noAnnotation" };
      }
      const annotations = await Promise.all(
        requests.map(async (req): Promise<FetchedAnnotation> => {
          const url = joinUrl(cfg.datasetBaseUrl, req.path);
          const ts = nowMs();
          try {
            const raw = await (prefetch.get(url) ?? fetchJson<unknown>(url, timeout));
            if (!raw) return { url, error: "fetch returned null" };
            return { url, raw, fetchMs: nowMs() - ts };
          } catch (e: any) {
            return { url, error: String(e?.message ?? e) };
          }
        })
      );

      return { entry, annotations };
    })
  );

  // Phase 2: serialize addGeoreferenceAnnotation — concurrent calls on the same
  // WarpedMapLayer cause interleaved internal state mutations that produce flicker.
  // Round-robin across sub-layers by GEOREF entry order (not total entry index).
  // The full entry list includes many no-annotation entries at arbitrary positions;
  // interleaving by total idx creates uneven georef distribution (geographic clusters
  // land disproportionately in one layer). Counting only georef entries guarantees
  // exactly ⌊georefTotal/chunkCount⌋ annotated entries per layer.
  let done = 0;
  let georefIdx = 0;

  for (let idx = 0; idx < fetchedAll.length; idx++) {
    const item = fetchedAll[idx];
    // Assign layer before checking error so no-annotation entries don't consume a slot
    const targetLayer = "error" in item ? layers[0] : layers[georefIdx % layers.length];
    const compiledManifestUrl = joinUrl(cfg.datasetBaseUrl, item.entry.compiledManifestPath);
    const startedAtISO = new Date().toISOString();
    const t0 = nowMs();

    if ("error" in item) {
      const result: RunResult = {
        manifestUrl: compiledManifestUrl,
        manifestLabel: item.entry.label,
        sourceManifestUrl: item.entry.sourceManifestUrl,
        allmapsManifestUrl: item.entry.manifestAllmapsUrl,
        startedAtISO,
        totalMs: 0,
        steps: [{ step: "fetch_annotation", ms: 0, ok: item.error === "noAnnotation", detail: item.error }],
        ok: item.error === "noAnnotation",
        error: item.error === "noAnnotation" ? undefined : item.error
      };
      done++;
      opts.onProgress?.(done, entries.length, result);
      results.push(result);
      continue;
    }

    const okAnnotations = item.annotations.filter((a): a is { url: string; raw: unknown; fetchMs: number } => "raw" in a);
    const failedAnnotations = item.annotations.filter((a): a is { url: string; error: string } => "error" in a);

    const totalFetchMs = okAnnotations.reduce((sum, a) => sum + a.fetchMs, 0);
    const steps: StepTiming[] = [
      {
        step: "fetch_annotation",
        ms: totalFetchMs,
        ok: okAnnotations.length > 0,
        detail: `ok=${okAnnotations.length}/${item.annotations.length}`
      }
    ];

    if (okAnnotations.length === 0) {
      const result: RunResult = {
        manifestUrl: compiledManifestUrl,
        manifestLabel: item.entry.label,
        sourceManifestUrl: item.entry.sourceManifestUrl,
        allmapsManifestUrl: item.entry.manifestAllmapsUrl,
        startedAtISO,
        totalMs: nowMs() - t0,
        steps,
        ok: false,
        error: `All annotation fetches failed (${failedAnnotations.length})`
      };
      done++;
      opts.onProgress?.(done, entries.length, result);
      results.push(result);
      continue;
    }

    try {
      georefIdx++;
      const ts2 = nowMs();
      const annoResults: Array<string | Error> = [];
      // Important: keep this sequential. Concurrent addGeoreferenceAnnotation calls
      // on the same WarpedMapLayer can interleave internal mutations.
      for (const a of okAnnotations) {
        const r = await targetLayer.addGeoreferenceAnnotation(
          normalizeAllmapsPayload(a.raw)
        );
        annoResults.push(...r);
      }
      const failed = annoResults.filter((r): r is Error => r instanceof Error);
      if (failed.length > 0) {
        manifestsWithAnnotationErrors++;
        annotationErrorCount += failed.length;
      }
      const failedMessages = failed.map((err) => err.message);
      for (const err of failed) log?.("ERROR", `annotation error [${item.entry.label} | ${item.entry.manifestAllmapsUrl}]: ${err.message}`);
      if (!annoResults.some((r) => typeof r === "string")) throw new Error("No maps loaded from annotation.");
      const succeeded = annoResults.filter((r): r is string => typeof r === "string");
      for (const mapId of succeeded) {
        mapMetaByMapId.set(mapId, {
          label: item.entry.label,
          manifestAllmapsUrl: item.entry.manifestAllmapsUrl
        });
      }
      steps.push({
        step: "allmaps_apply_annotation",
        ms: nowMs() - ts2,
        ok: failed.length === 0,
        detail: `added=${succeeded.join(",")}${failed.length ? `; annotationErrors=${failed.length}` : ""}`
      });

      const result: RunResult = {
        manifestUrl: compiledManifestUrl,
        annotationUrl: okAnnotations[0]?.url,
        manifestLabel: item.entry.label,
        sourceManifestUrl: item.entry.sourceManifestUrl,
        allmapsManifestUrl: item.entry.manifestAllmapsUrl,
        startedAtISO, totalMs: nowMs() - t0, steps, ok: true,
        annotationErrorCount: failed.length,
        annotationErrors: failedMessages
      };
      done++; opts.onProgress?.(done, entries.length, result);
      results.push(result);
    } catch (err: any) {
      const result: RunResult = {
        manifestUrl: compiledManifestUrl,
        manifestLabel: item.entry.label,
        sourceManifestUrl: item.entry.sourceManifestUrl,
        allmapsManifestUrl: item.entry.manifestAllmapsUrl,
        startedAtISO,
        totalMs: nowMs() - t0, steps, ok: false,
        error: String(err?.message ?? err)
      };
      done++; opts.onProgress?.(done, entries.length, result);
      results.push(result);
    }
  }

  // Pre-warm image infos: fetch all IIIF info.json files concurrently and inject
  // them into all sub-layers' image caches via addImageInfos(). Without this, the render
  // loop discovers maps one batch per frame via loadMissingImagesInViewport(), leaving
  // many maps "visible but not fetchable" for several render cycles.
  try {
    const allWarpedMaps: any[] = [];
    for (const l of layers) {
      const wms = Array.from((l as any).renderer?.warpedMapList?.getWarpedMaps?.() ?? []) as any[];
      allWarpedMaps.push(...wms);
    }
    const uniqueImageUrls = [
      ...new Set(
        allWarpedMaps
          .filter((wm) => !wm.hasImage?.())
          .map((wm) => wm.georeferencedMap?.resource?.id)
          .filter(Boolean)
      )
    ] as string[];

    if (uniqueImageUrls.length > 0) {
      log?.("INFO", `[${label}] pre-warming ${uniqueImageUrls.length} image infos across ${layers.length} sub-layer(s)...`);
      const tsWarm = nowMs();
      const infoJsons = await Promise.all(
        uniqueImageUrls.map(async (url) => {
          try {
            const res = await fetch(`${url}/info.json`);
            if (!res.ok) return null;
            const info = await res.json();
            // Normalize: addImageInfos matches info["@id"] / info.id against
            // warpedMap.georeferencedMap.resource.id. If the server returns a
            // canonical @id that differs from the URL we fetched with (e.g.
            // http→https, trailing slash), the match fails silently. Force both
            // fields to the URL we know the map expects.
            return { ...info, "@id": url, id: url };
          } catch { return null; }
        })
      );
      const valid = infoJsons.filter(Boolean);
      if (valid.length > 0) {
        for (const l of layers) (l as any).addImageInfos?.(valid);
        // Verify: log per-layer hasImage() coverage so we can tell if addImageInfos matched correctly
        for (let i = 0; i < layers.length; i++) {
          const wms = Array.from((layers[i] as any).renderer?.warpedMapList?.getWarpedMaps?.() ?? []) as any[];
          const withImage = wms.filter((wm) => wm.hasImage?.()).length;
          log?.("INFO", `[${label}] sub-layer [${i}] post-prewarm: hasImage ${withImage}/${wms.length}`);
        }
        log?.("INFO", `[${label}] pre-warmed ${valid.length}/${uniqueImageUrls.length} image infos in ${Math.round(nowMs() - tsWarm)}ms`);
      }
    }
  } catch (e: any) {
    log?.("WARN", `[${label}] image info pre-warm failed: ${e?.message ?? e}`);
  }

  // Fit to the union of all sub-layers' bounds. When entries are split by index order
  // and the collection is sorted geographically, each chunk covers a different region —
  // fitting to only layers[0] would leave layers[1]'s maps permanently off-screen.
  const MIN_ZOOM = 12;
  try {
    type BB = [[number, number], [number, number]];
    let merged: BB | null = null;
    for (const l of layers) {
      const b = l.getBounds() as BB | undefined;
      if (!b) continue;
      merged = merged
        ? [[Math.min(merged[0][0], b[0][0]), Math.min(merged[0][1], b[0][1])],
           [Math.max(merged[1][0], b[1][0]), Math.max(merged[1][1], b[1][1])]]
        : b;
    }
    if (merged) {
      map.fitBounds(merged as any, { padding: 40, animate: false });
      const zoom = map.getZoom();
      log?.("INFO", `[${label}] fitBounds zoom=${zoom.toFixed(1)} bounds=${JSON.stringify(merged)}`);
      if (zoom < MIN_ZOOM) {
        map.setZoom(MIN_ZOOM);
        log?.("WARN", `[${label}] zoom ${zoom.toFixed(1)} < ${MIN_ZOOM} — clamped to ${MIN_ZOOM} so sections are tile-renderable`);
      }
    } else {
      log?.("WARN", `[${label}] fitBounds skipped — all sub-layers returned undefined bounds`);
    }
  } catch (e: any) {
    log?.("WARN", `[${label}] fitBounds error: ${e?.message ?? e}`);
  }

  // Keep the render loop alive so loadMissingImagesInViewport() keeps running.
  // With a fast IIIF server, allrequestedtilesloaded fires after the first batch
  // of tiles, MapLibre goes idle, and the remaining image infos (still fetching
  // in the background) never trigger tile requests. Periodic repaints fix this.
  //
  // Important: for very large spatial extents, many maps are outside the current
  // viewport and therefore won't load tiles yet. Don't keepalive forever waiting
  // for non-visible maps; stop when visible progress stalls.
  const expectedMaps = mapsAdded;
  const KEEPALIVE_TICK_MS = 180;
  const KEEPALIVE_IDLE_STOP_MS = 3500;
  const KEEPALIVE_BASE_MS = 8000;
  const KEEPALIVE_PER_MAP_MS = 120;
  const KEEPALIVE_MAX_MS = 90000;
  const keepaliveStartMs = nowMs();
  const keepaliveBudgetMs = Math.min(
    KEEPALIVE_MAX_MS,
    Math.max(KEEPALIVE_BASE_MS, KEEPALIVE_BASE_MS + expectedMaps * KEEPALIVE_PER_MAP_MS)
  );

  let lastProgressSnapshot = `${firstTilesLoaded}|${imageInfosAdded}|${tilesLoaded}|${mapsInViewport}`;

  function logViewportVsFetchable(tag: string) {
    const fetchableSet = getAllFetchableSet();
    const inViewportIds = [...inViewportMapIds];
    const visibleNotFetchable = inViewportIds.filter((id) => !fetchableSet.has(id));
    const byLabel = new Map<string, number>();
    for (const mapId of visibleNotFetchable) {
      const lbl = mapMetaByMapId.get(mapId)?.label ?? "(unknown)";
      byLabel.set(lbl, (byLabel.get(lbl) ?? 0) + 1);
    }
    const topLabels = [...byLabel.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lbl, n]) => `${lbl}:${n}`)
      .join(" | ");
    log?.(
      "INFO",
      `[${label}] ${tag} visibleNotFetchable:${visibleNotFetchable.length}/${inViewportIds.length} fetchable:${fetchableSet.size} top=${topLabels || "none"}`
    );
  }

  function logVisibleNotFetchableReasons(tag: string) {
    const fetchableSet = getAllFetchableSet();
    if (!layers.some((l) => (l as any).renderer?.warpedMapList?.getWarpedMap)) {
      log?.("WARN", `[${label}] ${tag} reason-analysis unavailable (no warpedMapList)`);
      return;
    }

    const reasons = {
      noImage: 0,
      noViewportIntersection: 0,
      noTileZoom: 0,
      notInFetchableSet: 0
    };
    const labelBuckets = new Map<string, number>();

    for (const mapId of inViewportMapIds) {
      if (fetchableSet.has(mapId)) continue;

      const wm: any = getWarpedMapFromAnyLayer(mapId);
      const meta = mapMetaByMapId.get(mapId);
      const mapLabel = meta?.label ?? "(unknown)";
      labelBuckets.set(mapLabel, (labelBuckets.get(mapLabel) ?? 0) + 1);

      const hasImage = wm?.hasImage?.() ?? false;
      if (!hasImage) reasons.noImage++;

      const hasIntersection = Boolean(
        wm?.resourceBufferedViewportRingBboxAndResourceMaskBboxIntersectionForViewport
      );
      if (!hasIntersection) reasons.noViewportIntersection++;

      const hasTileZoom = Boolean(wm?.tileZoomLevelForViewport);
      if (!hasTileZoom) reasons.noTileZoom++;

      reasons.notInFetchableSet++;
    }

    const topLabels = [...labelBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lbl, n]) => `${lbl}:${n}`)
      .join(" | ");

    log?.(
      "INFO",
      `[${label}] ${tag} reasons notInFetchable:${reasons.notInFetchableSet} noImage:${reasons.noImage} noViewportIntersection:${reasons.noViewportIntersection} noTileZoom:${reasons.noTileZoom} top=${topLabels || "none"}`
    );
  }

  const repaintHandle = cleanupRef.interval = setInterval(() => {
    if (!map.getLayer(layerIds[0])) { clearInterval(repaintHandle); return; }
    const now = nowMs();
    const elapsed = now - keepaliveStartMs;
    const idleMs = now - lastProgressAtMs;
    const expectedVisibleMaps = Math.max(
      1,
      Math.min(expectedMaps, Math.max(mapsInViewport, peakMapsInViewport, firstTilesLoaded))
    );

    const snapshot = `${firstTilesLoaded}|${imageInfosAdded}|${tilesLoaded}|${mapsInViewport}`;
    if (snapshot !== lastProgressSnapshot) {
      lastProgressSnapshot = snapshot;
      lastProgressAtMs = now;
    }

    if (firstTilesLoaded >= expectedMaps && expectedMaps > 0) {
      logViewportVsFetchable("viewport-diff(full)");
      logVisibleNotFetchableReasons("viewport-reasons(full)");
      log?.("INFO", `[${label}] keepalive done(full) — firstTiles:${firstTilesLoaded}/${expectedMaps} inViewport:${mapsInViewport} peakViewport:${peakMapsInViewport} active:${tilesLoaded - tilesDeleted}`);
      clearInterval(repaintHandle);
      return;
    }

    if (firstTilesLoaded >= expectedVisibleMaps && idleMs >= KEEPALIVE_IDLE_STOP_MS && elapsed >= 1500) {
      const likelyViewportLimited = expectedMaps > peakMapsInViewport;
      logViewportVsFetchable("viewport-diff(viewport)");
      logVisibleNotFetchableReasons("viewport-reasons(viewport)");
      log?.("INFO", `[${label}] keepalive done(viewport) — firstTiles:${firstTilesLoaded}/${expectedMaps} expectedVisible:${expectedVisibleMaps} peakViewport:${peakMapsInViewport} likelyViewportLimited:${likelyViewportLimited}`);
      clearInterval(repaintHandle);
      return;
    }

    if (elapsed >= keepaliveBudgetMs) {
      const likelyViewportLimited = expectedMaps > peakMapsInViewport;
      logViewportVsFetchable("viewport-diff(timeout)");
      logVisibleNotFetchableReasons("viewport-reasons(timeout)");
      log?.("WARN", `[${label}] keepalive timeout — firstTiles:${firstTilesLoaded}/${expectedMaps} imgInfos:${imageInfosAdded} inViewport:${mapsInViewport} peakViewport:${peakMapsInViewport} idleMs:${Math.round(idleMs)} likelyViewportLimited:${likelyViewportLimited}`);
      clearInterval(repaintHandle);
      return;
    }

    for (const l of layers) (l as any).nativeUpdate?.();
  }, KEEPALIVE_TICK_MS);

  emitRenderStats(true);
  // Always print final diagnostic snapshot; this can otherwise get hidden by noisy event logs.
  logViewportVsFetchable("viewport-diff(final)");
  logVisibleNotFetchableReasons("viewport-reasons(final)");
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log?.("INFO", `Layer "${label}" done: ${ok} ok, ${failed} failed | registered:${mapsAdded} imgInfos:${imageInfosAdded} firstTiles:${firstTilesLoaded} activeTiles:${tilesLoaded - tilesDeleted} tileErrs:${tileFetchErrors} annotationErrs:${annotationErrorCount} manifestsWithAnnotationErrs:${manifestsWithAnnotationErrors}`);

  return results;
}
