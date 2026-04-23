import type maplibregl from "maplibre-gl";
import type { SpriteRef } from "$lib/artemis/shared/types";

export type CompiledIndexEntry = {
  label: string;
  sourceManifestUrl: string;
  sourceCollectionUrl: string;
  canvasCount: number;
  isVerzamelblad?: boolean;
  compiledManifestPath: string;
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
  indexPath?: string;
  fetchTimeoutMs?: number;
};

export type RuntimeLayerEntry = {
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
  bbox?: [number, number, number, number] | null;
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

export type IiifLog = (level: "INFO" | "WARN" | "ERROR", msg: string) => void;

let cachedIndex: CompiledIndex | null = null;
const cachedNewIiifBundles = new Map<string, Promise<{ entries: RuntimeLayerEntry[]; infoByServiceUrl: Map<string, any> }>>();

const iiifTileCache = new Map<string, Promise<ArrayBuffer>>();
let iiifCacheHits = 0;
let iiifCacheMisses = 0;

export function getIiifCacheStats() {
  return { size: iiifTileCache.size, hits: iiifCacheHits, misses: iiifCacheMisses };
}

export function resetBundleLoaderCache() {
  cachedIndex = null;
  cachedNewIiifBundles.clear();
  iiifTileCache.clear();
  iiifCacheHits = 0;
  iiifCacheMisses = 0;
}

export function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

export function toAbsoluteUrl(baseUrl: string, maybePathOrUrl: string): string {
  if (/^https?:\/\//i.test(maybePathOrUrl)) return maybePathOrUrl;
  return joinUrl(baseUrl, maybePathOrUrl);
}

export function deriveAllmapsManifestUrl(entry: { manifestAllmapsUrl?: string; manifestAllmapsId?: string }): string | undefined {
  if (entry.manifestAllmapsUrl) return entry.manifestAllmapsUrl;
  if (!entry.manifestAllmapsId) return undefined;
  return `https://annotations.allmaps.org/manifests/${entry.manifestAllmapsId}`;
}

export async function loadCompiledIndex(cfg: CompiledRunnerConfig): Promise<CompiledIndex> {
  if (cachedIndex) return cachedIndex;
  const indexUrl = joinUrl(cfg.datasetBaseUrl, cfg.indexPath ?? "index.json");
  cachedIndex = await fetchJson<CompiledIndex>(indexUrl, cfg.fetchTimeoutMs ?? 30000);
  return cachedIndex;
}

export async function loadNewIiifEntries(
  cfg: CompiledRunnerConfig,
  layerInfo: LayerInfo,
  timeout: number,
  spriteDebugMode = false,
  log?: IiifLog,
  emitStep?: (step: string, detail?: string) => void
): Promise<{ entries: RuntimeLayerEntry[]; infoByServiceUrl: Map<string, any> }> {
  const cacheKey = [cfg.datasetBaseUrl.replace(/\/+$/, ""), layerInfo.geomapsPath].join("::");
  const cached = cachedNewIiifBundles.get(cacheKey);
  if (cached) return cached;

  const bundlePromise = (async () => {
    const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;
    const emit = (step: string, detail?: string) => {
      if (emitStep) emitStep(step, detail);
      else emitIiifStep(log, layerLabel, step, detail);
    };

    const geomapsUrl = joinUrl(cfg.datasetBaseUrl, layerInfo.geomapsPath!);
    const fetchStartedAt = nowMs();
    emit("fetch-geomaps:start", geomapsUrl);

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
      ? joinUrl(cfg.datasetBaseUrl, spriteDebugMode ? spritePath.replace(/(\.[^.]+)$/, "_debug$1") : spritePath)
      : "";
    const spritesByCanvasAllmapsId = new Map<string, BundleSprite>();

    if (spriteJsonPath) {
      const spritesUrl = joinUrl(cfg.datasetBaseUrl, spriteJsonPath);
      const spriteJsonStartedAt = nowMs();
      emit("fetch-sprites-json:start", spritesUrl);
      const sprites = await fetchJson<Record<string, BundleSprite>>(spritesUrl, timeout);
      emit("fetch-sprites-json:done", `${Math.round(nowMs() - spriteJsonStartedAt)}ms sprites=${Object.keys(sprites ?? {}).length}`);
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

    emit("fetch-geomaps:done", `${Math.round(nowMs() - fetchStartedAt)}ms maps=${maps.length} entries=${entries.length} info=${infoByServiceUrl.size}`);
    return { entries, infoByServiceUrl };
  })().catch((err) => {
    cachedNewIiifBundles.delete(cacheKey);
    throw err;
  });

  cachedNewIiifBundles.set(cacheKey, bundlePromise);
  return bundlePromise;
}

export function scoreEntryForViewport(entry: RuntimeLayerEntry, viewportCenter: [number, number] | null): number {
  if (!viewportCenter) return Number.POSITIVE_INFINITY;
  const entryCenter = getEntryGeoCenter(entry);
  if (!entryCenter) return Number.POSITIVE_INFINITY;
  const dx = entryCenter[0] - viewportCenter[0];
  const dy = entryCenter[1] - viewportCenter[1];
  return dx * dx + dy * dy;
}

export function getMapViewportBbox(map: maplibregl.Map): [number, number, number, number] | null {
  try {
    const b = map.getBounds();
    return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null;
  } catch {
    return null;
  }
}

export function bboxIntersects(
  [aW, aS, aE, aN]: [number, number, number, number],
  [bW, bS, bE, bN]: [number, number, number, number]
): boolean {
  return aW <= bE && aE >= bW && aS <= bN && aN >= bS;
}

export function geoBoxFromGcps(gcps: any[]): [number, number, number, number] | null {
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

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function nowMs() {
  return performance.now();
}

function emitIiifStep(log: IiifLog | undefined, layerLabel: string, step: string, detail?: string) {
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
