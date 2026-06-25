import type { LayerInfo } from "$lib/artemis/iiif/bundleLoader";

// Hard-coded Allmaps mapOptions toggles.
//
// Allmaps lets you pass `mapOptions` into:
// - addGeoreferencedMap(georeferencedMap, mapOptions)
// - addGeoreferenceAnnotation(annotation, mapOptions)
//
// The expected type is `Partial<WebGL2WarpedMapOptions>` (from @allmaps/render).
// We mirror the full option surface here without importing @allmaps/render directly,
// since it's a transitive dependency and won't exist as a top-level node_modules entry
// in this pnpm workspace unless added explicitly.
export type AllmapsMapOptions = Partial<{
  // WebGL2WarpedMapOptions (render + debug)
  renderMaps: boolean;
  renderLines: boolean;
  renderPoints: boolean;

  renderGcps: boolean;
  renderGcpsColor: string;
  renderGcpsSize: number;
  renderGcpsBorderColor: string;
  renderGcpsBorderSize: number;

  renderTransformedGcps: boolean;
  renderTransformedGcpsColor: string;
  renderTransformedGcpsSize: number;
  renderTransformedGcpsBorderColor: string;
  renderTransformedGcpsBorderSize: number;

  renderVectors: boolean;
  renderVectorsColor: string;
  renderVectorsSize: number;
  renderVectorsBorderColor: string;
  renderVectorsBorderSize: number;

  renderFullMask: boolean;
  renderFullMaskColor: string;
  renderFullMaskSize: number;
  renderFullMaskBorderColor: string;
  renderFullMaskBorderSize: number;

  renderAppliableMask: boolean;
  renderAppliableMaskColor: string;
  renderAppliableMaskSize: number;
  renderAppliableMaskBorderColor: string;
  renderAppliableMaskBorderSize: number;

  renderMask: boolean;
  renderMaskColor: string;
  renderMaskSize: number;
  renderMaskBorderColor: string;
  renderMaskBorderSize: number;

  opacity: number;
  saturation: number;

  removeColor: boolean;
  removeColorColor: string;
  removeColorThreshold: number;
  removeColorHardness: number;

  colorize: boolean;
  colorizeColor: string;

  distortionColor00: string;
  distortionColor01: string;
  distortionColor1: string;
  distortionColor2: string;
  distortionColor3: string;

  renderGrid: boolean;
  renderGridColor: string;

  debugTriangles: boolean;
  debugTriangulation: boolean;
  debugTiles: boolean;

  // WarpedMap / triangulation pipeline options (non-primitive types kept as unknown)
  fetchFn: any;
  gcps: any;
  resourceMask: any;
  transformationType: any;
  internalProjection: any;
  projection: any;
  visible: boolean;
  applyMask: boolean;
  distortionMeasure: any;

  resourceResolution: number;
  distortionMeasures: any;
}>;

export type AllmapsDebugConfig = {
  enabled: boolean;
  defaults: AllmapsMapOptions;
  byIiifLayer: Record<string, AllmapsMapOptions>;
  byIiifLayerAndRenderKey: Record<string, AllmapsMapOptions>;
};

export const ALLMAPS_DEBUG_CONFIG: AllmapsDebugConfig = {
  enabled: true,

  // Applied to every IIIF map when enabled (unless overwritten below).
  defaults: {
    debugTriangles: false,
    debugTriangulation: false,
    debugTiles: false,
  },

  // Main IIIF layer keys (usually `LayerInfo.map`, e.g. "PrimitiefKadaster").
  byIiifLayer: {
    // Example:
    // PrimitiefKadaster: { debugTriangles: true, debugTriangulation: true },
  },

  // Optional finer-grained overrides per render layer key.
  // Key format: `${iiifLayerKey}::${renderLayerKey}` (renderLayerKey defaults to "all").
  byIiifLayerAndRenderKey: {
    // Example:
    // "PrimitiefKadaster::verzamelblad": { debugTiles: true },
  },
};

function getIiifLayerKey(layerInfo: LayerInfo): string {
  const key = String(layerInfo.map ?? layerInfo.sourceCollectionLabel ?? "").trim();
  return key || "unknown";
}

export function getAllmapsDebugMapOptions(layerInfo: LayerInfo): AllmapsMapOptions | undefined {
  if (!ALLMAPS_DEBUG_CONFIG.enabled) return undefined;

  const iiifLayerKey = getIiifLayerKey(layerInfo);
  const renderKey = String(layerInfo.renderLayerKey ?? "all").trim() || "all";
  const perRenderKey = ALLMAPS_DEBUG_CONFIG.byIiifLayerAndRenderKey[`${iiifLayerKey}::${renderKey}`];
  const perLayer = ALLMAPS_DEBUG_CONFIG.byIiifLayer[iiifLayerKey];

  return {
    ...ALLMAPS_DEBUG_CONFIG.defaults,
    ...perLayer,
    ...perRenderKey,
  };
}
