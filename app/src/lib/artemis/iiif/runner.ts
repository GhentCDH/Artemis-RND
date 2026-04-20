// $lib/artemis/iiif/runner.ts
//
// Compiled-only runner — loads annotations from a GitHub Pages-hosted dataset.
// Supports multiple independent layers, each toggled on/off via the UI.

import type maplibregl from "maplibre-gl";
import { WarpedMapLayer } from "@allmaps/maplibre";
import type { RunResult, SpriteRef, StepTiming } from "$lib/artemis/shared/types";

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
  canvasCount?: number;
  inlineMaps?: Array<{
    url: string;
    raw: unknown;
    spriteRef?: SpriteRef;
    placeholderWidth?: number;
    placeholderHeight?: number;
  }>;
  inlineSprites?: Array<{
    imageUrl: string;
    imageSize: [number, number];
    sprite: {
      imageId: string;
      scaleFactor: number;
      x: number;
      y: number;
      width: number;
      height: number;
      spriteTileScale?: number;
    };
  }>;
  manifestAllmapsUrl?: string;
  bbox?: [number, number, number, number] | null; // [minLon, minLat, maxLon, maxLat]
};

type BundleSprite = {
  imageId: string;
  scaleFactor: number;
  x: number;
  y: number;
  width: number;
  height: number;
  spriteTileScale?: number;
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

// Compute geographic bounding box from GCP coordinates
function geoBoxFromGcps(gcps: any[]): [number, number, number, number] | null {
  if (!Array.isArray(gcps) || gcps.length === 0) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const gcp of gcps) {
    const geo = gcp?.geo;
    if (!Array.isArray(geo) || geo.length < 2) continue;
    const [lon, lat] = [Number(geo[0]), Number(geo[1])];
    if (!isFinite(lon) || !isFinite(lat)) continue;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}

// Check if two geographic bounding boxes intersect
function bboxIntersects(
  [aW, aS, aE, aN]: [number, number, number, number],
  [bW, bS, bE, bN]: [number, number, number, number]
): boolean {
  return aW <= bE && aE >= bW && aS <= bN && aN >= bS;
}

// Get current map viewport as a geographic bounding box
function getMapViewportBbox(map: maplibregl.Map): [number, number, number, number] | null {
  try {
    const b = map.getBounds();
    return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null;
  } catch {
    return null;
  }
}

function nowMs() {
  return performance.now();
}

function emitIiifStep(log: RunnerLog | undefined, layerLabel: string, step: string, detail?: string) {
  const message = `[IIIF] ${layerLabel} :: ${step}${detail ? ` :: ${detail}` : ""}`;
  log?.("INFO", message);
  console.info(message);
}


function getEntryGeoCenter(entry: RuntimeLayerEntry): [number, number] | null {
  const coords: Array<[number, number]> = [];
  for (const item of entry.inlineMaps ?? []) {
    const gcps = (item.raw as any)?.gcps;
    if (!Array.isArray(gcps)) continue;
    for (const gcp of gcps) {
      const geo = gcp?.geo;
      if (!Array.isArray(geo) || geo.length < 2) continue;
      const lon = Number(geo[0]);
      const lat = Number(geo[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) coords.push([lon, lat]);
    }
  }
  if (coords.length === 0) return null;
  const [sumLon, sumLat] = coords.reduce(([accLon, accLat], [lon, lat]) => [accLon + lon, accLat + lat], [0, 0]);
  return [sumLon / coords.length, sumLat / coords.length];
}

function scoreEntryForViewport(entry: RuntimeLayerEntry, viewportCenter: [number, number] | null): number {
  if (!viewportCenter) return Number.POSITIVE_INFINITY;
  const entryCenter = getEntryGeoCenter(entry);
  if (!entryCenter) return Number.POSITIVE_INFINITY;
  const dx = entryCenter[0] - viewportCenter[0];
  const dy = entryCenter[1] - viewportCenter[1];
  return dx * dx + dy * dy;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}


// Kept for debug UI compatibility. The custom shared fetch cache was removed
// because Allmaps sprite workers cannot clone a user-supplied fetch function.
const iiifTileCache = new Map<string, Promise<ArrayBuffer>>();
let iiifCacheHits = 0;
let iiifCacheMisses = 0;

export function getIiifCacheStats() {
  return { size: iiifTileCache.size, hits: iiifCacheHits, misses: iiifCacheMisses };
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

// Pending annotations: entries not yet added to WarpedMapLayer (deferred by viewport filtering)
type PendingGroupState = {
  entries: RuntimeLayerEntry[];
  layers: WarpedMapLayer[];
  cfg: CompiledRunnerConfig;
  layerInfo: LayerInfo;
  log?: RunnerLog;
};
const pendingByGroup = new Map<string, PendingGroupState>();

// Sprite preview data for low-zoom rendering
export type SpriteFeature = {
  id: string;
  label: string;
  spriteUrl: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  layerId: string;
  layerLabel: string;
};
export const spriteIndex = new Map<string, SpriteFeature>(); // keyed by entry.sourceManifestUrl

type ManifestInfo = {
  sourceManifestUrl: string;
  label: string;
  compiledManifestPath: string;
  manifestAllmapsUrl?: string;
  spriteRef?: SpriteRef;
  placeholderWidth?: number;
  placeholderHeight?: number;
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
  pendingByGroup.clear();
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

function deriveAllmapsManifestUrl(entry: { manifestAllmapsUrl?: string; manifestAllmapsId?: string }): string | undefined {
  if (entry.manifestAllmapsUrl) return entry.manifestAllmapsUrl;
  if (!entry.manifestAllmapsId) return undefined;
  return `https://annotations.allmaps.org/manifests/${entry.manifestAllmapsId}`;
}

async function loadNewIiifEntries(
  cfg: CompiledRunnerConfig,
  layerInfo: LayerInfo,
  timeout: number,
  spriteDebugMode: boolean = false,
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
    const fetchStartedAt = nowMs();
    emitIiifStep(log, layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel, "fetch-geomaps:start", geomapsUrl);

    const bundle = await fetchJson<any>(geomapsUrl, timeout);
    const maps = (bundle?.maps ?? []) as any[];
    const entries: RuntimeLayerEntry[] = [];
    const infoByServiceUrl = new Map<string, any>();
    const bundleSprites = bundle?.sprites;
    const spriteImageSize =
      Array.isArray(bundleSprites?.imageSize) && bundleSprites.imageSize.length === 2
        ? [Number(bundleSprites.imageSize[0]), Number(bundleSprites.imageSize[1])] as [number, number]
        : null;
    const spritePath = typeof bundleSprites?.image === "string" ? String(bundleSprites.image) : "";
    const spriteJsonPath = typeof bundleSprites?.json === "string" ? String(bundleSprites.json) : "";
    const spriteImageUrl = spritePath
      ? joinUrl(
          cfg.datasetBaseUrl,
          spriteDebugMode
            ? spritePath.replace(/(\.[^.]+)$/, "_debug$1")
            : spritePath
        )
      : "";
    const spritesByCanvasAllmapsId = new Map<string, BundleSprite>();

    if (spriteJsonPath) {
      const spritesUrl = joinUrl(cfg.datasetBaseUrl, spriteJsonPath);
      const sprites = await fetchJson<Record<string, BundleSprite>>(spritesUrl, timeout);
      for (const [canvasAllmapsId, sprite] of Object.entries(sprites ?? {})) {
        const key = String(canvasAllmapsId).trim();
        if (!key || !sprite) continue;
        spritesByCanvasAllmapsId.set(key, sprite);
      }
    }

    for (const map of maps) {
      const sourceManifestUrl = String(map.id ?? "").trim();
      const label = String(map.label ?? sourceManifestUrl).trim();
      const canvases = Array.isArray(map.canvases) ? map.canvases : [];

      const inlineMaps = canvases.flatMap((canvas: any) => {
        if (!canvas.georeferencedMap) return [];
        const canvasAllmapsId = String(canvas?.canvasAllmapsId ?? "").trim();
        const sprite = canvasAllmapsId ? spritesByCanvasAllmapsId.get(canvasAllmapsId) : undefined;
        const spriteRef =
          sprite && spriteImageSize && spriteImageUrl
            ? {
                sheetUrl: spriteImageUrl,
                sheetWidth: spriteImageSize[0],
                sheetHeight: spriteImageSize[1],
                x: sprite.x,
                y: sprite.y,
                width: sprite.width,
                height: sprite.height,
              }
            : undefined;
        const placeholderWidth = Number(canvas?.info?.width ?? canvas?.georeferencedMap?.resource?.width ?? 0);
        const placeholderHeight = Number(canvas?.info?.height ?? canvas?.georeferencedMap?.resource?.height ?? 0);
        return [{
          url: `${geomapsUrl}#${encodeURIComponent(canvas.id)}`,
          raw: canvas.georeferencedMap,
          spriteRef,
          placeholderWidth: Number.isFinite(placeholderWidth) && placeholderWidth > 0 ? placeholderWidth : undefined,
          placeholderHeight: Number.isFinite(placeholderHeight) && placeholderHeight > 0 ? placeholderHeight : undefined,
        }];
      });
      const inlineSprites = canvases.flatMap((canvas: any) => {
        const canvasAllmapsId = String(canvas?.canvasAllmapsId ?? "").trim();
        const sprite = canvasAllmapsId ? spritesByCanvasAllmapsId.get(canvasAllmapsId) : undefined;
        if (!sprite || !spriteImageSize || !spriteImageUrl) return [];
        return [{
          imageUrl: spriteImageUrl,
          imageSize: spriteImageSize,
          sprite,
        }];
      });

      if (inlineMaps.length === 0) continue;

      // Collect info by service URL
      for (const canvas of canvases) {
        if (canvas.info) {
          const serviceUrl = String(canvas.info["@id"] ?? canvas.info.id ?? "").replace(/\/+$/, "");
          if (serviceUrl) infoByServiceUrl.set(serviceUrl, canvas.info);
        }
      }

      const firstMap = inlineMaps[0]?.raw as any;
      const manifestPartOf = firstMap?.resource?.partOf?.[0]?.partOf?.[0];
      const manifestAllmapsUrl = typeof manifestPartOf?.id === "string" ? manifestPartOf.id : undefined;

      entries.push({
        label,
        sourceManifestUrl,
        compiledManifestPath: sourceManifestUrl || `${layerInfo.geomapsPath}#${encodeURIComponent(label)}`,
        isVerzamelblad: map.isVerzamelblad ?? false,
        annotSource: inlineMaps.length > 1 ? "multi" : "single",
        canvasCount: canvases.length,
        inlineMaps,
        inlineSprites,
        manifestAllmapsUrl,
      });
    }

    emitIiifStep(
      log,
      layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel,
      "fetch-geomaps:done",
      `${Math.round(nowMs() - fetchStartedAt)}ms maps=${maps.length} entries=${entries.length} info=${infoByServiceUrl.size}`
    );
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
  initialRenderMaps?: boolean;
  spriteOnly?: boolean;
  parallelLoading?: boolean; // Load all maps in parallel vs phased (bootstrap → background)
  spriteDebugMode?: boolean; // Use debug spritesheets with pink tint for visualization
  log?: RunnerLog;
  debug?: boolean; // gates expensive diagnostic work (annotation strategy, viewport diff analysis)
  onProgress?: (done: number, total: number, latest: RunResult) => void;
  onRenderStats?: (stats: LayerRenderStats) => void;
}): Promise<RunResult[]> {
  const { map, cfg, layerInfo, log, debug = false, paneId = "main", initialRenderMaps = true, spriteOnly = false, parallelLoading = false, spriteDebugMode = false } = opts;
  const runtime = getPaneRuntime(paneId);
  const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;
  const runStartedAt = nowMs();
  log?.(
    "INFO",
    `[runLayerGroup] start pane=${paneId} label="${layerLabel}" compiledCollectionPath=${layerInfo.compiledCollectionPath ?? "n/a"} geomapsPath=${layerInfo.geomapsPath ?? "n/a"} renderKey=${layerInfo.renderLayerKey ?? "all"}`
  );
  emitIiifStep(log, layerLabel, "run:start", `pane=${paneId} renderKey=${layerInfo.renderLayerKey ?? "all"}`);

  log?.("INFO", `[runLayerGroup] waiting for map ready label="${layerLabel}"`);
  await waitForMapReady(map);
  log?.("INFO", `[runLayerGroup] map ready label="${layerLabel}"`);
  emitIiifStep(log, layerLabel, "map-ready");

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
  const loaded = await loadNewIiifEntries(cfg, layerInfo, timeout, spriteDebugMode, log);
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
  emitIiifStep(log, layerLabel, "filter-entries", `total=${entriesUnfiltered.length} active=${entries.length}`);

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

  const chunkCount = 1;

  const layerIds = Array.from({ length: chunkCount }, (_, i) =>
    `warped-layer-${groupId.replace(/\//g, "-")}${chunkCount > 1 ? `-${i}` : ""}`
  );
  const layers: WarpedMapLayer[] = [];
  const layerCreateStartedAt = nowMs();
  for (let i = 0; i < chunkCount; i++) {
    await removeMaplibreLayer(map, layerIds[i]);
    const l = new WarpedMapLayer({ layerId: layerIds[i] } as any);
    try {
      map.addLayer(l as any);
      l.setLayerOptions({ visible: false } as any);
      layers.push(l);
    } catch (e: any) {
      log?.("ERROR", `addLayer failed (${layerIds[i]}): ${e?.message ?? String(e)}`);
      return [];
    }
  }
  runtime.activeLayersByGroup.set(groupId, layerIds);
  runtime.activeWarpedLayersByGroup.set(groupId, layers);
  emitIiifStep(log, layerLabel, "create-warped-layers", `${Math.round(nowMs() - layerCreateStartedAt)}ms count=${layers.length}`);

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
  let spriteTileLoadedEvents = 0;
  const addedMapIds = new Set<string>();
  const imageInfoMapIds = new Set<string>();
  const firstTileMapIds = new Set<string>();
  const spriteTileMapIds = new Set<string>();
  const inViewportMapIds = new Set<string>();
  let fallbackInViewportCount = 0;
  let peakMapsInViewport = 0;
  let lastProgressAtMs = nowMs();
  let lastStatsEmitAtMs = 0;
  let resolveBootstrapVisualReady: (() => void) | null = null;
  let bootstrapVisualReadyResolved = false;

  function markBootstrapVisualReady() {
    if (bootstrapVisualReadyResolved) return;
    bootstrapVisualReadyResolved = true;
    resolveBootstrapVisualReady?.();
    resolveBootstrapVisualReady = null;
  }

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

  onMap("maptilesloadedfromsprites", (e) => {
    const ids: string[] = e.mapIds ?? [];
    spriteTileLoadedEvents++;
    for (const id of ids) spriteTileMapIds.add(id);
    lastProgressAtMs = nowMs();
    markBootstrapVisualReady();
    log?.("INFO", `[${label}] maptilesloadedfromsprites events:${spriteTileLoadedEvents} maps:${spriteTileMapIds.size || ids.length} ids=[${ids.join(",")}]`);
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

  // Phase 1: collect inlined georeferenced maps from the geomaps bundle
  type FetchedGeoreferencedMap =
    | { url: string; raw: unknown; fetchMs: number; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number }
    | { url: string; error: string };
  type FetchedSprite = {
    imageUrl: string;
    imageSize: [number, number];
    sprite: {
      imageId: string;
      scaleFactor: number;
      x: number;
      y: number;
      width: number;
      height: number;
      spriteTileScale?: number;
    };
  };
  type Fetched =
    | { entry: RuntimeLayerEntry; maps: FetchedGeoreferencedMap[]; sprites: FetchedSprite[] }
    | { entry: RuntimeLayerEntry; error: string };

  // Seed IIIF info before map ingestion so warped maps can resolve images from cache
  // as soon as they enter the viewport, instead of discovering info.json later.
  try {
    const preloadStartedAt = nowMs();
    const valid = [...infoByServiceUrl.entries()]
      .map(([serviceUrl, info]) => ({ ...info, "@id": serviceUrl, id: serviceUrl }))
      .filter(Boolean);
    if (valid.length > 0) {
      emitIiifStep(log, layerLabel, "warm-image-info:start", `targets=${valid.length}`);
      for (const l of layers) (l as any).addImageInfos?.(valid);
      emitIiifStep(log, layerLabel, "warm-image-info:done", `${Math.round(nowMs() - preloadStartedAt)}ms valid=${valid.length}/${valid.length}`);
    }
  } catch (e: any) {
    log?.("WARN", `[${label}] image info pre-warm failed before map ingest: ${e?.message ?? e}`);
    emitIiifStep(log, layerLabel, "warm-image-info:error", String(e?.message ?? e));
  }

  const fetchedAll = await Promise.all(
    entries.map(async (entry): Promise<Fetched> => {
      if (!entry.inlineMaps?.length) {
        return { entry, error: "noGeoreferencedMap" };
      }
      return {
        entry,
        maps: entry.inlineMaps.map((a) => ({
          url: a.url,
          raw: a.raw,
          fetchMs: 0,
          spriteRef: a.spriteRef,
          placeholderWidth: a.placeholderWidth,
          placeholderHeight: a.placeholderHeight,
        })),
        sprites: entry.inlineSprites ?? [],
      };
    })
  );
  emitIiifStep(log, layerLabel, "collect-maps", `entries=${fetchedAll.length}`);

  const viewportCenter = (() => {
    try {
      const center = map.getCenter();
      return [center.lng, center.lat] as [number, number];
    } catch {
      return null;
    }
  })();
  const BOOTSTRAP_MAP_LIMIT = 24;
  const prioritizedFetched = [...fetchedAll].sort((a, b) =>
    scoreEntryForViewport(a.entry, viewportCenter) - scoreEntryForViewport(b.entry, viewportCenter)
  );
  const bootstrapFetched: Fetched[] = [];
  const backgroundFetched: Fetched[] = [];
  let bootstrapMapBudget = 0;
  for (const item of prioritizedFetched) {
    const itemMapCount = "maps" in item ? item.maps.filter((m) => "raw" in m).length : 0;
    if (bootstrapFetched.length < 1 || bootstrapMapBudget < BOOTSTRAP_MAP_LIMIT) {
      bootstrapFetched.push(item);
      bootstrapMapBudget += itemMapCount;
    } else {
      backgroundFetched.push(item);
    }
  }
  emitIiifStep(
    log,
    layerLabel,
    "bootstrap-selection",
    `entries=${bootstrapFetched.length} maps=${bootstrapMapBudget} remaining=${backgroundFetched.length}`
  );
  const hasSprites = fetchedAll.some((item) => "sprites" in item && item.sprites.length > 0);

  // Phase 2: apply georeferenced maps with a bootstrap-first pass so sprites can
  // appear quickly near the current view instead of waiting for the full ingest.
  let done = 0;
  const applyStartedAt = nowMs();
  const slowManifestThresholdMs = 50;
  const subLayerAssignments = Array.from({ length: layers.length }, () => ({
    manifests: 0,
    maps: 0,
  }));
  const subLayerCompletionMs = Array.from({ length: layers.length }, () => 0);
  const applyDiagnostics: Array<{
    label: string;
    manifestUrl: string;
    mapCount: number;
    canvasCount: number;
    addedCount: number;
    failedCount: number;
    ms: number;
    subLayerIndex: number;
  }> = [];
  async function applyFetchedBatch(batch: Fetched[], startIndex: number, mode: "sequential" | "parallel" | "chunked"): Promise<RunResult[]> {
    const runOne = async (item: Fetched, idx: number): Promise<RunResult> =>
      (async (): Promise<RunResult> => {
        const subLayerIndex = idx % layers.length;
        const targetLayer = layers[subLayerIndex];
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
            steps: [{ step: "fetch_georeferenced_map", ms: 0, ok: item.error === "noGeoreferencedMap", detail: item.error }],
            ok: item.error === "noGeoreferencedMap",
            error: item.error === "noGeoreferencedMap" ? undefined : item.error
          };
        }

        const okMaps = item.maps.filter(
          (a): a is { url: string; raw: unknown; fetchMs: number; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number } =>
            "raw" in a
        );
        const failedMaps = item.maps.filter((a): a is { url: string; error: string } => "error" in a);
        subLayerAssignments[subLayerIndex].manifests++;
        subLayerAssignments[subLayerIndex].maps += okMaps.length;

        const totalFetchMs = okMaps.reduce((sum, a) => sum + a.fetchMs, 0);
        const steps: StepTiming[] = [
          {
            step: "fetch_georeferenced_map",
            ms: totalFetchMs,
            ok: okMaps.length > 0,
            detail: `ok=${okMaps.length}/${item.maps.length}`
          }
        ];

        if (okMaps.length === 0) {
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: false,
            error: `All georeferenced map loads failed (${failedMaps.length})`
          };
        }

        try {
          const ts2 = nowMs();
          const mapResults = await Promise.allSettled(
            okMaps.map((a) => targetLayer.addGeoreferencedMap(a.raw))
          );
          const allmapsResults: Array<string | Error> = [];
          for (const result of mapResults) {
            if (result.status === "fulfilled") allmapsResults.push(result.value);
            else allmapsResults.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
          }
          const failed = allmapsResults.filter((r): r is Error => r instanceof Error);
          if (failed.length > 0) {
            manifestsWithAnnotationErrors++;
            annotationErrorCount += failed.length;
          }
          const failedMessages = failed.map((err) => err.message);
          for (const err of failed) log?.("ERROR", `annotation error [${item.entry.label} | ${deriveAllmapsManifestUrl(item.entry)}]: ${err.message}`);
          if (!allmapsResults.some((r) => typeof r === "string")) throw new Error("No maps loaded from georeferenced maps.");
          const succeeded = allmapsResults.filter((r): r is string => typeof r === "string");
          const applyMs = nowMs() - ts2;
          applyDiagnostics.push({
            label: item.entry.label,
            manifestUrl: item.entry.sourceManifestUrl,
            mapCount: okMaps.length,
            canvasCount: item.entry.canvasCount ?? okMaps.length,
            addedCount: succeeded.length,
            failedCount: failed.length,
            ms: applyMs,
            subLayerIndex,
          });
          subLayerCompletionMs[subLayerIndex] = Math.max(subLayerCompletionMs[subLayerIndex], applyMs);
          if (applyMs >= slowManifestThresholdMs) {
            emitIiifStep(
              log,
              layerLabel,
              "apply-manifest:slow",
              `${Math.round(applyMs)}ms layer=${subLayerIndex} label="${item.entry.label}" canvases=${item.entry.canvasCount ?? "?"} maps=${okMaps.length} added=${succeeded.length} failed=${failed.length}`
            );
          }
          for (let resultIndex = 0; resultIndex < allmapsResults.length; resultIndex++) {
            const mapId = allmapsResults[resultIndex];
            if (typeof mapId !== "string") continue;
            const sourceMap = okMaps[resultIndex];
            mapMetaByMapId.set(mapId, {
              label: item.entry.label,
              manifestAllmapsUrl: deriveAllmapsManifestUrl(item.entry)
            });
            runtime.mapIdToManifestInfo.set(mapId, {
              sourceManifestUrl: item.entry.sourceManifestUrl,
              label: item.entry.label,
              compiledManifestPath: item.entry.compiledManifestPath,
              manifestAllmapsUrl: deriveAllmapsManifestUrl(item.entry),
              spriteRef: sourceMap?.spriteRef,
              placeholderWidth: sourceMap?.placeholderWidth,
              placeholderHeight: sourceMap?.placeholderHeight,
            });
          }
          steps.push({
            step: "allmaps_add_georeferenced_map",
            ms: applyMs,
            ok: failed.length === 0,
            detail: `added=${succeeded.join(",")}${failed.length ? `; annotationErrors=${failed.length}` : ""}`
          });

          return {
            manifestUrl: compiledManifestUrl,
            annotationUrl: okMaps[0]?.url,
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
      });

    if (mode === "sequential") {
      const out: RunResult[] = [];
      for (let i = 0; i < batch.length; i++) {
        out.push(await runOne(batch[i], startIndex + i));
      }
      return out;
    }
    if (mode === "chunked") {
      const out: RunResult[] = [];
      const BACKGROUND_BATCH_SIZE = 6;
      for (let i = 0; i < batch.length; i += BACKGROUND_BATCH_SIZE) {
        const slice = batch.slice(i, i + BACKGROUND_BATCH_SIZE);
        out.push(...await Promise.all(slice.map((item, index) => runOne(item, startIndex + i + index))));
        if (i + BACKGROUND_BATCH_SIZE < batch.length) {
          await nextFrame();
        }
      }
      return out;
    }
    return Promise.all(batch.map((item, index) => runOne(item, startIndex + index)));
  }

  function getSpriteGroups(items: Fetched[]) {
    const spriteGroupsByLayer = Array.from({ length: layers.length }, () => new Map<string, { imageUrl: string; imageSize: [number, number]; sprites: FetchedSprite["sprite"][] }>());
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!("sprites" in item) || item.sprites.length === 0) continue;
      const subLayerIndex = idx % layers.length;
      const groups = spriteGroupsByLayer[subLayerIndex];
      for (const spriteItem of item.sprites) {
        const key = `${spriteItem.imageUrl}::${spriteItem.imageSize[0]}x${spriteItem.imageSize[1]}`;
        const existing = groups.get(key);
        if (existing) existing.sprites.push(spriteItem.sprite);
        else groups.set(key, {
          imageUrl: spriteItem.imageUrl,
          imageSize: spriteItem.imageSize,
          sprites: [spriteItem.sprite]
        });
      }
    }
    return spriteGroupsByLayer;
  }

  let initializedSpriteTargets = 0;
  async function initializeSpritesForItems(items: Fetched[]) {
    try {
      const spriteStartedAt = nowMs();
      const spriteGroupsByLayer = getSpriteGroups(items);
      const totalSpriteTargets = spriteGroupsByLayer.reduce((sum, groups) => sum + groups.size, 0);
      const totalSprites = spriteGroupsByLayer.reduce(
        (sum, groups) => sum + [...groups.values()].reduce((inner, group) => inner + group.sprites.length, 0),
        0
      );
      initializedSpriteTargets = totalSpriteTargets;
      if (totalSpriteTargets > 0) {
        emitIiifStep(log, layerLabel, "init-sprites:start", `targets=${totalSpriteTargets} sprites=${totalSprites}`);
        await Promise.all(
          spriteGroupsByLayer.flatMap((groups, index) =>
            [...groups.values()].map(async (group, groupIndex) => {
              const startedAt = nowMs();
              emitIiifStep(
                log,
                layerLabel,
                "init-sprites:addSprites:start",
                `layer=${index} group=${groupIndex + 1}/${groups.size} sprites=${group.sprites.length} imageSize=${group.imageSize[0]}x${group.imageSize[1]} imageUrl=${group.imageUrl}`
              );
              await layers[index].addSprites(group.sprites as any, group.imageUrl, group.imageSize);
              emitIiifStep(
                log,
                layerLabel,
                "init-sprites:addSprites:done",
                `${Math.round(nowMs() - startedAt)}ms layer=${index} group=${groupIndex + 1}/${groups.size} sprites=${group.sprites.length}`
              );
            })
          )
        );
        emitIiifStep(log, layerLabel, "init-sprites:done", `${Math.round(nowMs() - spriteStartedAt)}ms targets=${totalSpriteTargets} sprites=${totalSprites}`);
      }
    } catch (e: any) {
      log?.("WARN", `[${label}] sprite init failed: ${e?.message ?? e}`);
      emitIiifStep(log, layerLabel, "init-sprites:error", String(e?.message ?? e));
    }
  }

  if (parallelLoading || hasSprites) {
    // Parallel mode: Load all maps at once
    emitIiifStep(log, layerLabel, "load-mode", parallelLoading ? "parallel" : "sprites-unified");
    const allProcessed = await applyFetchedBatch(fetchedAll, 0, "parallel");
    results.push(...allProcessed);
  } else {
    // Phased mode: Bootstrap → Background (default)
    emitIiifStep(log, layerLabel, "load-mode", "phased");
    const bootstrapProcessed = await applyFetchedBatch(bootstrapFetched, 0, "sequential");
    results.push(...bootstrapProcessed);
    const processed = await applyFetchedBatch(backgroundFetched, bootstrapFetched.length, "chunked");
    results.push(...processed);
  }
  const totalGeoreferencedMaps = fetchedAll.reduce(
    (sum, item) => sum + ("maps" in item ? item.maps.length : 0),
    0
  );
  const totalCanvasRefs = fetchedAll.reduce(
    (sum, item) => sum + (item.entry.canvasCount ?? ("maps" in item ? item.maps.length : 0)),
    0
  );
  const slowestDiagnostics = [...applyDiagnostics]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10);
  emitIiifStep(
    log,
    layerLabel,
    "apply-annotations",
    `${Math.round(nowMs() - applyStartedAt)}ms ok=${results.filter((r) => r.ok).length}/${results.length} annotationErrors=${annotationErrorCount} maps=${totalGeoreferencedMaps} canvases=${totalCanvasRefs}`
  );
  if (layers.length > 1) {
    emitIiifStep(
      log,
      layerLabel,
      "apply-annotations:sublayers",
      subLayerAssignments
        .map((item, index) => `layer${index}=m${item.manifests}/g${item.maps}/t${Math.round(subLayerCompletionMs[index])}ms`)
        .join(" | ")
    );
  }
  if (slowestDiagnostics.length > 0) {
    emitIiifStep(
      log,
      layerLabel,
      "apply-annotations:slowest",
      slowestDiagnostics
        .map((item) => `${Math.round(item.ms)}ms[l${item.subLayerIndex}] "${item.label}" c=${item.canvasCount} g=${item.mapCount}`)
        .join(" | ")
    );
  }
  await initializeSpritesForItems(fetchedAll);

  if (initialRenderMaps && !spriteOnly) {
    for (const layer of layers) {
      layer.setLayerOptions({ visible: true } as any);
      (layer as any).nativeUpdate?.();
    }
    emitIiifStep(log, layerLabel, "init-layer:visible", `layers=${layers.length}`);
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

  if (initializedSpriteTargets === 0) {
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
  } else {
    emitIiifStep(log, layerLabel, "init-render-loop:skip", `reason=sprites targets=${initializedSpriteTargets}`);
  }

  emitIiifStep(
    log,
    layerLabel,
    "ingestion-ready",
    `${Math.round(nowMs() - runStartedAt)}ms manifests=${results.length} peakVisible=${peakMapsInViewport} firstTiles=${firstTilesLoaded}`
  );

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
