import type { SpriteRef } from "$lib/artemis/shared/types";
import { fetchJson, joinUrl } from "$lib/artemis/shared/utils";

export type LayerInfo = {
  sourceCollectionUrl: string;
  sourceCollectionLabel: string;
  compiledCollectionPath?: string;
  map?: string;
  geomapsPath?: string;
  spritesPath?: string;
  grSpritesPath?: string;
  tilesPath?: string;
  tilesMinZoom?: number;
  tilesMaxZoom?: number;
  masksPath?: string;
  renderLayerKey?: string;
  renderLayerLabel?: string;
  hidden?: boolean;
};

export type TilesConfig = {
  /** Path or URL containing literal `{z}/{x}/{y}` placeholders. */
  template: string;
  minZoom: number;
  maxZoom: number;
};

/** Known pre-warped XYZ tile pyramids (gdal2tiles output) by mapId, keyed until the data
 *  pipeline records this in the geomaps bundle itself (mirrors the gr_sprites convention
 *  fallback below). Directory names aren't derivable from mapId — they vary per pipeline run.
 *
 *  Full z8-12 range (everything the pipeline generates): the raster pyramid is the persistent
 *  base renderer now (Allmaps is loaded lazily only when the user zooms in past the pyramid's
 *  native detail — see `ALLMAPS_TRIGGER_ZOOM` in initialization.ts), so it needs the sharpest
 *  tiles available at whatever zoom the user is actually at, not a single overzoomed level.
 *  MapLibre requests only the handful of tiles intersecting the viewport, so the full range costs
 *  nothing extra at render time. Both collections use identical treatment — no per-layer pinning. */
const KNOWN_TILE_DIRS: Record<string, { dir: string; minZoom: number; maxZoom: number }> = {
  GereduceerdeKadaster: { dir: "GereduceerdeKadaster/Gereduceerd_Kadaster_tiles", minZoom: 8, maxZoom: 12 },
  PrimitiefKadaster: { dir: "PrimitiefKadaster/primitief_kadaster_tiles", minZoom: 8, maxZoom: 12 },
};

/**
 * Resolves the pre-warped raster tile pyramid for a layer, if one exists. Replaces the gr_sprites
 * WebGL placeholder: native MapLibre raster tiles need no manifest fetch, so this can be resolved
 * synchronously from `layerInfo` alone (no geomaps bundle fetch required) and used immediately.
 */
export function resolveTilesConfig(layerInfo: LayerInfo): TilesConfig | undefined {
  const explicitPath = readString(layerInfo.tilesPath);
  if (explicitPath) {
    return {
      template: explicitPath,
      minZoom: Number.isFinite(layerInfo.tilesMinZoom) ? (layerInfo.tilesMinZoom as number) : 0,
      maxZoom: Number.isFinite(layerInfo.tilesMaxZoom) ? (layerInfo.tilesMaxZoom as number) : 22,
    };
  }
  const mapId = readString(layerInfo.map);
  const known = mapId ? KNOWN_TILE_DIRS[mapId] : undefined;
  if (!known) return undefined;
  return { template: `IIIF/${known.dir}/{z}/{x}/{y}.webp`, minZoom: known.minZoom, maxZoom: known.maxZoom };
}

/**
 * Known pre-baked canvas-footprint vector tiles (PMTiles, single "masks" layer, one polygon per
 * canvas with a `manifestUrl` property) by mapId — replaces building clickable canvas outlines
 * from Allmaps' live `geoMask` geometry at runtime. Static data, so unlike Allmaps geoMask it's
 * available the instant the layer's pmtiles source loads, independent of triangulation progress.
 */
const KNOWN_MASK_PMTILES: Record<string, string> = {
  GereduceerdeKadaster: "GereduceerdeKadaster/Gereduceerd_Kadaster_masks.pmtiles",
  PrimitiefKadaster: "PrimitiefKadaster/primitief_kadaster_masks.pmtiles",
};

export function resolveMasksPath(layerInfo: LayerInfo): string | undefined {
  const explicitPath = readString(layerInfo.masksPath);
  if (explicitPath) return explicitPath;
  const mapId = readString(layerInfo.map);
  const known = mapId ? KNOWN_MASK_PMTILES[mapId] : undefined;
  return known ? `IIIF/${known}` : undefined;
}

export type CompiledIndex = {
  renderLayers?: LayerInfo[];
  iiifLayers?: LayerInfo[];
  index: Array<{
    label: string;
    sourceManifestUrl: string;
    sourceCollectionUrl: string;
    isVerzamelblad?: boolean;
    compiledManifestPath: string;
    centerLon?: number;
    centerLat?: number;
  }>;
  domains?: {
    toponyms?: { maps?: string[] };
  };
};

export type CompiledRunnerConfig = {
  datasetBaseUrl: string;
  indexPath?: string;
  fetchTimeoutMs?: number;
};

type RuntimeLayerEntry = {
  label: string;
  sourceManifestUrl: string;
  compiledManifestPath: string;
  isVerzamelblad?: boolean;
  inlineMaps?: Array<{
    url: string;
    raw: unknown;
    canvasAllmapsId?: string;
    imageServiceUrl?: string;
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

let cachedIndex: CompiledIndex | null = null;
const cachedNewIiifBundles = new Map<string, Promise<{ entries: RuntimeLayerEntry[]; infoByServiceUrl: Map<string, any>; grSpritesPath?: string }>>();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveGrSpritesPath(bundle: any, layerInfo: LayerInfo): string | undefined {
  const bundleSprites = bundle?.sprites;
  const explicitPath =
    readString(layerInfo.grSpritesPath) ??
    readString(bundleSprites?.grJson) ??
    readString(bundleSprites?.georeferencedJson) ??
    readString(bundleSprites?.warpedJson);

  if (explicitPath) return explicitPath;

  const mapId = readString(bundle?.mapId) ?? readString(layerInfo.map);
  if (mapId === "GereduceerdeKadaster" || mapId === "PrimitiefKadaster") {
    return `IIIF/${mapId}/sprites/gr_sprites.json`;
  }

  return undefined;
}

export function resetBundleLoaderCache() {
  cachedIndex = null;
  cachedNewIiifBundles.clear();
}

export async function loadCompiledIndex(cfg: CompiledRunnerConfig): Promise<CompiledIndex> {
  if (cachedIndex) return cachedIndex;
  const indexUrl = joinUrl(cfg.datasetBaseUrl, cfg.indexPath ?? "index.json");
  const index = await fetchJson<CompiledIndex>(indexUrl, cfg.fetchTimeoutMs ?? 30000);
  cachedIndex = index;
  return index;
}

export async function loadNewIiifEntries(
  cfg: CompiledRunnerConfig,
  layerInfo: LayerInfo,
  timeout: number,
  spriteDebugMode = false
): Promise<{ entries: RuntimeLayerEntry[]; infoByServiceUrl: Map<string, any>; grSpritesPath?: string }> {
  const cacheKey = [cfg.datasetBaseUrl.replace(/\/+$/, ""), layerInfo.geomapsPath, layerInfo.grSpritesPath ?? ""].join("::");
  const cached = cachedNewIiifBundles.get(cacheKey);
  if (cached) return cached;

  const bundlePromise = (async () => {
    const geomapsUrl = joinUrl(cfg.datasetBaseUrl, layerInfo.geomapsPath!);
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
    const grSpritesPath = resolveGrSpritesPath(bundle, layerInfo);
    const spriteImageUrl = spritePath
      ? joinUrl(cfg.datasetBaseUrl, spriteDebugMode ? spritePath.replace(/(\.[^.]+)$/, "_debug$1") : spritePath)
      : "";
    const spritesByCanvasAllmapsId = new Map<string, BundleSprite>();

    if (spriteJsonPath) {
      const spritesUrl = joinUrl(cfg.datasetBaseUrl, spriteJsonPath);
      const sprites = await fetchJson<Record<string, BundleSprite>>(spritesUrl, timeout);
      for (const [canvasAllmapsId, sprite] of Object.entries(sprites)) {
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
        const imageServiceUrl = String(canvas?.info?.["@id"] ?? canvas?.info?.id ?? "").replace(/\/+$/, "") || undefined;
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
          canvasAllmapsId: canvasAllmapsId || undefined,
          imageServiceUrl,
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
        inlineMaps,
        inlineSprites,
        manifestAllmapsUrl,
      });
    }

    return { entries, infoByServiceUrl, grSpritesPath };
  })().catch((err) => {
    cachedNewIiifBundles.delete(cacheKey);
    throw err;
  });

  cachedNewIiifBundles.set(cacheKey, bundlePromise);
  return bundlePromise;
}
