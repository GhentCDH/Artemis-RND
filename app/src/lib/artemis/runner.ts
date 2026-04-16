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
  canvasCount: number;
  isVerzamelblad?: boolean;
  compiledManifestPath: string;
  // Present only for georef manifests:
  centerLon?: number;
  centerLat?: number;
  manifestAllmapsId?: string;
  canvasAllmapsHits?: Array<{
    canvasId: string;
    canvasAllmapsId: string;
    mirroredAllmapsAnnotationPath: string;
  }>;
  georefDetectedBy?: "canvas" | "manifest" | "both";
  annotSource?: "single" | "multi";
};

export type LayerInfo = {
  sourceCollectionUrl: string;
  sourceCollectionLabel: string;
  compiledCollectionPath?: string;
  map?: string;
  layerId?: string;
  geomapsPath?: string;
  spritesPath?: string;
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
  compiledOk: number;
  layers?: LayerInfo[];
  renderLayers?: LayerInfo[];
  iiifLayers?: LayerInfo[];
  index: CompiledIndexEntry[];
  domains?: {
    iiif?: { available: boolean; maps?: string[] };
    toponyms?: { available: boolean; maps?: string[] };
    parcels?: { available: boolean; maps?: string[] };
    imageCollections?: { available: boolean; collections?: any[] };
  };
  imageServices?: Record<string, any>;
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

type RuntimeLayerEntry = {
  label: string;
  sourceManifestUrl: string;
  compiledManifestPath: string;
  isVerzamelblad?: boolean;
  annotSource?: "single" | "multi";
  inlineAnnotations?: Array<{ url: string; raw: unknown }>;
  manifestAllmapsUrl?: string;
};

type RunnerLog = (level: "INFO" | "WARN" | "ERROR", msg: string) => void;
type PaneRuntimeId = string;

export function getLayerGroupId(layerInfo: LayerInfo): string {
  const base =
    layerInfo.compiledCollectionPath ||
    layerInfo.geomapsPath ||
    layerInfo.map ||
    layerInfo.sourceCollectionLabel;
  return `${base}::${layerInfo.renderLayerKey ?? "all"}`;
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
const cachedNewIiifBundles = new Map<string, Promise<{ entries: RuntimeLayerEntry[]; infoByServiceUrl: Map<string, any> }>>();
type ManifestInfo = {
  sourceManifestUrl: string;
  label: string;
  compiledManifestPath: string;
  manifestAllmapsUrl?: string;
};
type PaneRuntime = {
  activeLayersByGroup: Map<string, string[]>;
  activeWarpedLayersByGroup: Map<string, WarpedMapLayer[]>;
  mapIdToManifestInfo: Map<string, ManifestInfo>;
  activeLayerCleanup: Map<string, () => void>;
  parkedLayersByGroup: Map<string, { layerIds: string[]; warpedLayers: WarpedMapLayer[] }>;
};
// Preserve the legacy single-map runtime as the exact default path.
const activeLayersByGroup = new Map<string, string[]>();
const activeWarpedLayersByGroup = new Map<string, WarpedMapLayer[]>();
const mapIdToManifestInfo = new Map<string, ManifestInfo>();
const activeLayerCleanup = new Map<string, () => void>();
const parkedLayersByGroup = new Map<string, { layerIds: string[]; warpedLayers: WarpedMapLayer[] }>();
const paneRuntimes = new Map<PaneRuntimeId, PaneRuntime>();

function getPaneRuntime(paneId: PaneRuntimeId = "main"): PaneRuntime {
  if (paneId === "main") {
    return {
      activeLayersByGroup,
      activeWarpedLayersByGroup,
      mapIdToManifestInfo,
      activeLayerCleanup,
      parkedLayersByGroup,
    };
  }
  if (!paneRuntimes.has(paneId)) {
    paneRuntimes.set(paneId, {
      activeLayersByGroup: new Map<string, string[]>(),
      activeWarpedLayersByGroup: new Map<string, WarpedMapLayer[]>(),
      mapIdToManifestInfo: new Map<string, ManifestInfo>(),
      activeLayerCleanup: new Map<string, () => void>(),
      parkedLayersByGroup: new Map<string, { layerIds: string[]; warpedLayers: WarpedMapLayer[] }>(),
    });
  }
  return paneRuntimes.get(paneId)!;
}

export function resetCompiledIndexCache() {
  cachedIndex = null;
  cachedNewIiifBundles.clear();
  iiifTileCache.clear();
  iiifCacheHits = 0;
  iiifCacheMisses = 0;
  activeLayersByGroup.clear();
  activeWarpedLayersByGroup.clear();
  mapIdToManifestInfo.clear();
  activeLayerCleanup.clear();
  parkedLayersByGroup.clear();
  paneRuntimes.clear();
}

export function resetPaneRuntime(paneId: PaneRuntimeId = "main") {
  const runtime = getPaneRuntime(paneId);
  runtime.activeLayersByGroup.clear();
  runtime.activeWarpedLayersByGroup.clear();
  runtime.mapIdToManifestInfo.clear();
  runtime.activeLayerCleanup.clear();
  runtime.parkedLayersByGroup.clear();
  if (paneId !== "main") {
    paneRuntimes.delete(paneId);
  }
}

export function getManifestInfoForMapId(mapId: string, paneId: PaneRuntimeId = "main") {
  return getPaneRuntime(paneId).mapIdToManifestInfo.get(mapId) ?? null;
}

export function getAllActiveWarpedMaps(paneId: PaneRuntimeId = "main"): { mapId: string; warpedMap: any; groupId: string }[] {
  const result: { mapId: string; warpedMap: any; groupId: string }[] = [];
  for (const [groupId, layers] of getPaneRuntime(paneId).activeWarpedLayersByGroup.entries()) {
    for (const layer of layers) {
      for (const wm of layer.getWarpedMaps()) {
        const mapId = (wm as any).mapId;
        if (mapId) result.push({ mapId, warpedMap: wm, groupId });
      }
    }
  }
  return result;
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
  const isUsable = () => {
    try {
      return Boolean(
        map.isStyleLoaded?.() ||
        map.loaded?.() ||
        (map.getStyle?.()?.layers?.length ?? 0) > 0
      );
    } catch {
      return false;
    }
  };

  if (isUsable()) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      map.off("load", onMapEvent);
      map.off("styledata", onMapEvent);
      map.off("idle", onMapEvent);
      resolve();
    };
    const onMapEvent = () => {
      if (isUsable()) finish();
    };
    map.on("load", onMapEvent);
    map.on("styledata", onMapEvent);
    map.on("idle", onMapEvent);
    // Re-check after attaching listeners to avoid missing a transition that
    // happened between the synchronous guard above and listener registration.
    if (isUsable()) finish();
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

function deriveAllmapsManifestUrl(entry: { manifestAllmapsUrl?: string; manifestAllmapsId?: string }): string | undefined {
  if (entry.manifestAllmapsUrl) return entry.manifestAllmapsUrl;
  if (!entry.manifestAllmapsId) return undefined;
  return `https://annotations.allmaps.org/manifests/${entry.manifestAllmapsId}`;
}

async function loadNewIiifEntries(
  cfg: CompiledRunnerConfig,
  layerInfo: LayerInfo,
  timeout: number,
  log?: RunnerLog
): Promise<{
  entries: RuntimeLayerEntry[];
  infoByServiceUrl: Map<string, any>;
}> {
  const cacheKey = [
    cfg.datasetBaseUrl.replace(/\/+$/, ""),
    layerInfo.geomapsPath,
  ].join("::");
  const cached = cachedNewIiifBundles.get(cacheKey);
  if (cached) return cached;

  const bundlePromise = (async () => {
    const geomapsUrl = joinUrl(cfg.datasetBaseUrl, layerInfo.geomapsPath!);
    log?.("INFO", `[runLayerGroup] fetching IIIF geomaps bundle ${geomapsUrl}`);

    const bundle = await fetchJson<any>(geomapsUrl, timeout);
    const maps = (bundle?.maps ?? []) as any[];
    const entries: RuntimeLayerEntry[] = [];
    const infoByServiceUrl = new Map<string, any>();

    for (const map of maps) {
      const sourceManifestUrl = String(map.id ?? "").trim();
      const label = String(map.label ?? sourceManifestUrl).trim();
      const canvases = Array.isArray(map.canvases) ? map.canvases : [];

      const inlineAnnotations = canvases.flatMap((canvas: any) => {
        if (!canvas.georef) return [];
        return [{ url: `${geomapsUrl}#${encodeURIComponent(canvas.id)}`, raw: canvas.georef }];
      });

      if (inlineAnnotations.length === 0) continue;

      // Collect info by service URL
      for (const canvas of canvases) {
        if (canvas.info) {
          const serviceUrl = String(canvas.info["@id"] ?? canvas.info.id ?? "").replace(/\/+$/, "");
          if (serviceUrl) infoByServiceUrl.set(serviceUrl, canvas.info);
        }
      }

      const firstItem = (inlineAnnotations[0]?.raw as any)?.items?.[0];
      const manifestPartOf = firstItem?.target?.source?.partOf?.[0]?.partOf?.[0];
      const manifestAllmapsUrl = typeof manifestPartOf?.id === "string" ? manifestPartOf.id : undefined;

      entries.push({
        label,
        sourceManifestUrl,
        compiledManifestPath: sourceManifestUrl || `${layerInfo.geomapsPath}#${encodeURIComponent(label)}`,
        isVerzamelblad: map.isVerzamelblad ?? false,
        annotSource: inlineAnnotations.length > 1 ? "multi" : "single",
        inlineAnnotations,
        manifestAllmapsUrl,
      });
    }

    log?.("INFO", `[runLayerGroup] geomaps parsed: ${entries.length} entries, ${infoByServiceUrl.size} info services`);
    return { entries, infoByServiceUrl };
  })().catch((err) => {
    cachedNewIiifBundles.delete(cacheKey);
    throw err;
  });

  cachedNewIiifBundles.set(cacheKey, bundlePromise);
  return bundlePromise;
}

function toAbsoluteUrl(baseUrl: string, maybePathOrUrl: string): string {
  if (/^https?:\/\//i.test(maybePathOrUrl)) return maybePathOrUrl;
  return joinUrl(baseUrl, maybePathOrUrl);
}

// ---------------------------------------------------------------------------
// Layer group tracking
// groupId = compiledCollectionPath (e.g. "collections/dbd858bb241ff374")
// ---------------------------------------------------------------------------

async function removeMaplibreLayer(map: maplibregl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // ignore
  }
}

function safeHasMapLayer(map: maplibregl.Map, layerId: string): boolean {
  try {
    return Boolean(map?.getLayer?.(layerId));
  } catch {
    return false;
  }
}

export async function removeLayerGroup(map: maplibregl.Map, groupId: string, paneId: PaneRuntimeId = "main") {
  await waitForMapReady(map);
  const runtime = getPaneRuntime(paneId);

  // Handle parked layers (hidden but still on the map)
  if (runtime.parkedLayersByGroup.has(groupId)) {
    const parked = runtime.parkedLayersByGroup.get(groupId)!;
    runtime.parkedLayersByGroup.delete(groupId);
    for (const id of parked.layerIds) await removeMaplibreLayer(map, id);
    return;
  }

  // Clean up stale event handlers and intervals BEFORE removing the MapLibre layer.
  // Without this, map.on handlers from previous loads accumulate — each reload adds
  // another full set of handlers, causing doubled/tripled event counts and flickering.
  runtime.activeLayerCleanup.get(groupId)?.();
  runtime.activeLayerCleanup.delete(groupId);
  const ids = runtime.activeLayersByGroup.get(groupId) ?? [];
  for (const id of ids) await removeMaplibreLayer(map, id);
  runtime.activeLayersByGroup.delete(groupId);
  runtime.activeWarpedLayersByGroup.delete(groupId);
}

// Park a layer group: hide it (opacity 0) without destroying it.
// Restoring is instant — no re-fetch or re-parse needed.
export async function parkLayerGroup(map: maplibregl.Map, groupId: string, paneId: PaneRuntimeId = "main") {
  await waitForMapReady(map);
  const runtime = getPaneRuntime(paneId);
  const warpedLayers = runtime.activeWarpedLayersByGroup.get(groupId);
  const layerIds = runtime.activeLayersByGroup.get(groupId);
  if (!warpedLayers || !layerIds || layerIds.length === 0) return;
  for (const l of warpedLayers) { try { l.setOpacity(0); } catch { /* ignore */ } }
  runtime.parkedLayersByGroup.set(groupId, { layerIds: [...layerIds], warpedLayers: [...warpedLayers] });
  runtime.activeLayersByGroup.delete(groupId);
  runtime.activeWarpedLayersByGroup.delete(groupId);
  // Event handlers and keepalive interval are intentionally left; keepalive self-terminates.
}

export function isLayerGroupParked(groupId: string, paneId: PaneRuntimeId = "main"): boolean {
  return getPaneRuntime(paneId).parkedLayersByGroup.has(groupId);
}

// Enforce z-order of layer groups. Pass orderedGroupIds bottom-to-top;
// each group's layers are moved to the top of the stack in that order,
// so the last group ends up rendered on top of all others.
export function reorderLayerGroups(map: maplibregl.Map, orderedGroupIds: string[], paneId: PaneRuntimeId = "main") {
  const runtime = getPaneRuntime(paneId);
  for (const groupId of orderedGroupIds) {
    const ids = runtime.activeLayersByGroup.get(groupId) ?? [];
    for (const id of ids) {
      try {
        if (map.getLayer(id)) map.moveLayer(id);
      } catch { /* ignore */ }
    }
  }
}

export function setLayerGroupOpacity(map: maplibregl.Map, groupId: string, opacity: number, paneId: PaneRuntimeId = "main") {
  const clamped = Math.max(0, Math.min(1, opacity));
  const layers = getPaneRuntime(paneId).activeWarpedLayersByGroup.get(groupId) ?? [];
  for (const layer of layers) {
    try {
      layer.setOpacity(clamped);
    } catch {
      // ignore
    }
  }
}

export function isLayerGroupRendered(map: maplibregl.Map, groupId: string, paneId: PaneRuntimeId = "main"): boolean {
  const ids = getPaneRuntime(paneId).activeLayersByGroup.get(groupId) ?? [];
  return ids.some((id) => !!map.getLayer(id));
}

export function getLayerGroupLayerIds(groupId: string, paneId: PaneRuntimeId = "main"): string[] {
  const runtime = getPaneRuntime(paneId);
  return [...(runtime.activeLayersByGroup.get(groupId) ?? runtime.parkedLayersByGroup.get(groupId)?.layerIds ?? [])];
}

export function refreshActiveLayerGroups(paneId: PaneRuntimeId = "main") {
  const runtime = getPaneRuntime(paneId);
  for (const layers of runtime.activeWarpedLayersByGroup.values()) {
    for (const layer of layers) {
      try {
        (layer as any).nativeUpdate?.();
      } catch {
        // ignore
      }
    }
  }
}

export async function clearAllLayerGroups(map: maplibregl.Map, paneId: PaneRuntimeId = "main") {
  await waitForMapReady(map);
  for (const [groupId] of getPaneRuntime(paneId).activeLayersByGroup) {
    await removeLayerGroup(map, groupId, paneId);
  }
}

// ---------------------------------------------------------------------------
// Run a single layer group (all entries from one source collection)
// ---------------------------------------------------------------------------

export async function runLayerGroup(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;
  layerInfo: LayerInfo;
  paneId?: PaneRuntimeId;
  log?: RunnerLog;
  debug?: boolean; // gates expensive diagnostic work (annotation strategy, viewport diff analysis)
  onProgress?: (done: number, total: number, latest: RunResult) => void;
  onRenderStats?: (stats: LayerRenderStats) => void;
}): Promise<RunResult[]> {
  const { map, cfg, layerInfo, log, debug = false, paneId = "main" } = opts;
  const runtime = getPaneRuntime(paneId);
  const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;
  log?.(
    "INFO",
    `[runLayerGroup] start pane=${paneId} label="${layerLabel}" compiledCollectionPath=${layerInfo.compiledCollectionPath ?? "n/a"} geomapsPath=${layerInfo.geomapsPath ?? "n/a"} renderKey=${layerInfo.renderLayerKey ?? "all"}`
  );

  log?.("INFO", `[runLayerGroup] waiting for map ready label="${layerLabel}"`);
  await waitForMapReady(map);
  log?.("INFO", `[runLayerGroup] map ready label="${layerLabel}"`);

  const groupId = getLayerGroupId(layerInfo);

  // If parked (hidden but loaded), restore immediately — no re-fetch or re-parse needed.
  if (runtime.parkedLayersByGroup.has(groupId)) {
    const parked = runtime.parkedLayersByGroup.get(groupId)!;
    runtime.parkedLayersByGroup.delete(groupId);
    runtime.activeLayersByGroup.set(groupId, parked.layerIds);
    runtime.activeWarpedLayersByGroup.set(groupId, parked.warpedLayers);
    log?.("INFO", `Layer "${layerLabel}": restored from park (instant)`);
    // Caller is responsible for setting correct opacity via setLayerGroupOpacity.
    return [];
  }

  // Remove any previously loaded version of this layer group
  await removeLayerGroup(map, groupId, paneId);
  log?.("INFO", `[runLayerGroup] removed stale group label="${layerLabel}" groupId=${groupId}`);

  if (!layerInfo.geomapsPath) {
    log?.("ERROR", `[runLayerGroup] missing geomapsPath for "${layerLabel}"`);
    throw new Error(`IIIF layer "${layerLabel}" has no geomapsPath`);
  }

  const timeout = cfg.fetchTimeoutMs ?? 30000;
  const loaded = await loadNewIiifEntries(cfg, layerInfo, timeout, log);
  const infoByServiceUrl = loaded.infoByServiceUrl;
  const entriesUnfiltered = loaded.entries;

  const entries = entriesUnfiltered.filter((entry) => {
    if (layerInfo.renderLayerKey === "verzamelblad") return entry.isVerzamelblad === true;
    if (layerInfo.renderLayerKey === "default") return entry.isVerzamelblad !== true;
    if (layerInfo.renderLayerKey === "single-canvas") return entry.annotSource === "single";
    if (layerInfo.renderLayerKey === "multi-canvas") return entry.annotSource === "multi";
    return true;
  });

  log?.("INFO", `Layer "${layerLabel}": ${entries.length} entries`);

  // Log annotation source strategy for debug visibility
  if (debug) {
    const georefEntries = entries.filter((e) => e.annotSource !== undefined);
    const nonGeorefEntries = entries.filter((e) => e.annotSource === undefined);
    if (georefEntries.length > 0) {
      const single = georefEntries.filter((e) => e.annotSource === "single").length;
      const multi = georefEntries.filter((e) => e.annotSource === "multi").length;
      log?.(
        "INFO",
        `[${layerLabel}] annotation strategy: georef=${georefEntries.length}(single:${single} multi:${multi}) none=${nonGeorefEntries.length}`
      );
    }
  }

  const results: RunResult[] = [];
  const mapMetaByMapId = new Map<string, { label: string; manifestAllmapsUrl?: string }>();

  // Keep a single layer for stability. Multi-layer splitting can leave one
  // sub-layer permanently non-fetchable on dense Primitief runs.
  const chunkCount = 1;

  const layerIds = Array.from({ length: chunkCount }, (_, i) =>
    `warped-layer-${groupId.replace(/\//g, "-")}${chunkCount > 1 ? `-${i}` : ""}`
  );
  const layers: WarpedMapLayer[] = [];
  for (let i = 0; i < chunkCount; i++) {
    await removeMaplibreLayer(map, layerIds[i]);
    const l = new WarpedMapLayer({ layerId: layerIds[i], fetchFn: cachedFetch } as any);
    try {
      map.addLayer(l as any);
      layers.push(l);
    } catch (e: any) {
      log?.("ERROR", `addLayer failed (${layerIds[i]}): ${e?.message ?? String(e)}`);
      return [];
    }
  }
  runtime.activeLayersByGroup.set(groupId, layerIds);
  runtime.activeWarpedLayersByGroup.set(groupId, layers);

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
  runtime.activeLayerCleanup.set(groupId, () => {
    clearInterval(cleanupRef.interval);
    for (const h of mapHandlers) {
      if (h.type === "__tilefetcherror__") h.tileCache?.removeEventListener("tilefetcherror", h.fn);
      else map.off(h.type as any, h.fn);
    }
    log?.("INFO", `[${label}] cleanup: removed ${mapHandlers.length} handlers`);
  });

  // Phase 1: collect inlined annotations from the geomaps bundle
  type FetchedAnnotation =
    | { url: string; raw: unknown; fetchMs: number }
    | { url: string; error: string };
  type Fetched =
    | { entry: RuntimeLayerEntry; annotations: FetchedAnnotation[] }
    | { entry: RuntimeLayerEntry; error: string };

  const fetchedAll = await Promise.all(
    entries.map(async (entry): Promise<Fetched> => {
      if (!entry.inlineAnnotations?.length) {
        return { entry, error: "noAnnotation" };
      }
      return {
        entry,
        annotations: entry.inlineAnnotations.map((a) => ({
          url: a.url,
          raw: a.raw,
          fetchMs: 0,
        })),
      };
    })
  );

  // Phase 2: apply georeference annotations concurrently.
  let done = 0;
  const processed = await Promise.all(
    fetchedAll.map((item, idx) =>
      (async (): Promise<RunResult> => {
        const targetLayer = layers[idx % layers.length];
        const compiledManifestUrl = toAbsoluteUrl(cfg.datasetBaseUrl, item.entry.compiledManifestPath);
        const startedAtISO = new Date().toISOString();
        const t0 = nowMs();

        if ("error" in item) {
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: 0,
            steps: [{ step: "fetch_annotation", ms: 0, ok: item.error === "noAnnotation", detail: item.error }],
            ok: item.error === "noAnnotation",
            error: item.error === "noAnnotation" ? undefined : item.error
          };
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
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: false,
            error: `All annotation fetches failed (${failedAnnotations.length})`
          };
        }

        try {
          const ts2 = nowMs();
          const annoResults: Array<string | Error> = [];
          const appliedAnnotations = await Promise.all(
            okAnnotations.map((a) => targetLayer.addGeoreferenceAnnotation(normalizeAllmapsPayload(a.raw)))
          );
          for (const result of appliedAnnotations) {
            annoResults.push(...result);
          }
          const failed = annoResults.filter((r): r is Error => r instanceof Error);
          if (failed.length > 0) {
            manifestsWithAnnotationErrors++;
            annotationErrorCount += failed.length;
          }
          const failedMessages = failed.map((err) => err.message);
          for (const err of failed) log?.("ERROR", `annotation error [${item.entry.label} | ${deriveAllmapsManifestUrl(item.entry)}]: ${err.message}`);
          if (!annoResults.some((r) => typeof r === "string")) throw new Error("No maps loaded from annotation.");
          const succeeded = annoResults.filter((r): r is string => typeof r === "string");
          for (const mapId of succeeded) {
            mapMetaByMapId.set(mapId, {
              label: item.entry.label,
              manifestAllmapsUrl: deriveAllmapsManifestUrl(item.entry)
            });
            runtime.mapIdToManifestInfo.set(mapId, {
              sourceManifestUrl: item.entry.sourceManifestUrl,
              label: item.entry.label,
              compiledManifestPath: item.entry.compiledManifestPath,
              manifestAllmapsUrl: deriveAllmapsManifestUrl(item.entry)
            });
          }
          steps.push({
            step: "allmaps_apply_annotation",
            ms: nowMs() - ts2,
            ok: failed.length === 0,
            detail: `added=${succeeded.join(",")}${failed.length ? `; annotationErrors=${failed.length}` : ""}`
          });

          return {
            manifestUrl: compiledManifestUrl,
            annotationUrl: okAnnotations[0]?.url,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO, totalMs: nowMs() - t0, steps, ok: true,
            annotationErrorCount: failed.length,
            annotationErrors: failedMessages
          };
        } catch (err: any) {
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: nowMs() - t0, steps, ok: false,
            error: String(err?.message ?? err)
          };
        }
      })().then((result) => {
        done++;
        opts.onProgress?.(done, entries.length, result);
        return result;
      })
    )
  );
  results.push(...processed);

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
      let cacheHits = 0;
      let cacheMisses = 0;
      const infoJsons = await Promise.all(
        uniqueImageUrls.map(async (url) => {
          const normalizedUrl = url.replace(/\/+$/, "");
          const cached = infoByServiceUrl.get(normalizedUrl);
          if (cached) {
            cacheHits++;
            // Normalize @id / id to the URL the warped map expects, same as the
            // live-fetch path below.
            return { ...cached, "@id": url, id: url };
          }
          cacheMisses++;
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
      log?.("INFO", `[${label}] info.json cache: ${cacheHits} hits / ${cacheMisses} misses (${uniqueImageUrls.length} total)`);
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
    if (!safeHasMapLayer(map, layerIds[0])) { clearInterval(repaintHandle); return; }
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
      if (debug) {
        logViewportVsFetchable("viewport-diff(full)");
        logVisibleNotFetchableReasons("viewport-reasons(full)");
      }
      log?.("INFO", `[${label}] keepalive done(full) — firstTiles:${firstTilesLoaded}/${expectedMaps} inViewport:${mapsInViewport} peakViewport:${peakMapsInViewport} active:${tilesLoaded - tilesDeleted}`);
      clearInterval(repaintHandle);
      return;
    }

    if (firstTilesLoaded >= expectedVisibleMaps && idleMs >= KEEPALIVE_IDLE_STOP_MS && elapsed >= 1500) {
      const likelyViewportLimited = expectedMaps > peakMapsInViewport;
      if (debug) {
        logViewportVsFetchable("viewport-diff(viewport)");
        logVisibleNotFetchableReasons("viewport-reasons(viewport)");
      }
      log?.("INFO", `[${label}] keepalive done(viewport) — firstTiles:${firstTilesLoaded}/${expectedMaps} expectedVisible:${expectedVisibleMaps} peakViewport:${peakMapsInViewport} likelyViewportLimited:${likelyViewportLimited}`);
      clearInterval(repaintHandle);
      return;
    }

    if (elapsed >= keepaliveBudgetMs) {
      const likelyViewportLimited = expectedMaps > peakMapsInViewport;
      if (debug) {
        logViewportVsFetchable("viewport-diff(timeout)");
        logVisibleNotFetchableReasons("viewport-reasons(timeout)");
      }
      log?.("WARN", `[${label}] keepalive timeout — firstTiles:${firstTilesLoaded}/${expectedMaps} imgInfos:${imageInfosAdded} inViewport:${mapsInViewport} peakViewport:${peakMapsInViewport} idleMs:${Math.round(idleMs)} likelyViewportLimited:${likelyViewportLimited}`);
      clearInterval(repaintHandle);
      return;
    }

    for (const l of layers) (l as any).nativeUpdate?.();
  }, KEEPALIVE_TICK_MS);

  emitRenderStats(true);
  if (debug) {
    logViewportVsFetchable("viewport-diff(final)");
    logVisibleNotFetchableReasons("viewport-reasons(final)");
  }
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log?.("INFO", `Layer "${label}" done: ${ok} ok, ${failed} failed | registered:${mapsAdded} imgInfos:${imageInfosAdded} firstTiles:${firstTilesLoaded} activeTiles:${tilesLoaded - tilesDeleted} tileErrs:${tileFetchErrors} annotationErrs:${annotationErrorCount} manifestsWithAnnotationErrs:${manifestsWithAnnotationErrors}`);

  return results;
}
