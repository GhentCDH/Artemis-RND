import type maplibregl from "maplibre-gl";
import { initializeLayerGroup } from "./initialization";
import { resetBundleLoaderCache, loadCompiledIndex, type CompiledIndex, type CompiledRunnerConfig, type LayerInfo } from "./bundleLoader";
import {
  clearAllLayerGroups,
  getAllActiveWarpedMaps,
  getLayerGroupId,
  getLayerGroupLayerIds,
  getManifestInfoForMapId,
  isLayerGroupParked,
  isLayerGroupRendered,
  parkLayerGroup,
  refreshActiveLayerGroups,
  removeLayerGroup,
  reorderLayerGroups,
  resetAllIiifRuntime,
  resetPaneRuntime,
  setLayerGroupOpacity,
  type ManifestInfo,
  type PaneRuntimeId,
} from "./runtime";

export type {
  CompiledIndex,
  CompiledRunnerConfig,
  LayerInfo,
  ManifestInfo,
  PaneRuntimeId,
};

export {
  clearAllLayerGroups,
  getAllActiveWarpedMaps,
  getLayerGroupId,
  getLayerGroupLayerIds,
  getManifestInfoForMapId,
  isLayerGroupParked,
  isLayerGroupRendered,
  loadCompiledIndex,
  parkLayerGroup,
  refreshActiveLayerGroups,
  removeLayerGroup,
  reorderLayerGroups,
  resetPaneRuntime,
  setLayerGroupOpacity,
};

export function resetCompiledIndexCache() {
  resetBundleLoaderCache();
  resetAllIiifRuntime();
}

export async function runLayerGroup(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;
  layerInfo: LayerInfo;
  paneId?: PaneRuntimeId;
  initialRenderMaps?: boolean;
  spriteOnly?: boolean;
  parallelLoading?: boolean;
  spriteDebugMode?: boolean;
}) {
  return initializeLayerGroup(opts);
}
