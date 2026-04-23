import type maplibregl from "maplibre-gl";
import { initializeLayerGroup, type LayerRenderStats, type SubLayerRenderStats } from "./initialization";
import { resetBundleLoaderCache, loadCompiledIndex, getIiifCacheStats, type CompiledIndex, type CompiledIndexEntry, type CompiledRunnerConfig, type IiifLog, type LayerInfo } from "./bundleLoader";
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
  spriteIndex,
  type ManifestInfo,
  type PaneRuntimeId,
  type SpriteFeature,
} from "./runtime";

export type {
  CompiledIndex,
  CompiledIndexEntry,
  CompiledRunnerConfig,
  IiifLog,
  LayerInfo,
  ManifestInfo,
  PaneRuntimeId,
  SpriteFeature,
  LayerRenderStats,
  SubLayerRenderStats,
};

export {
  clearAllLayerGroups,
  getAllActiveWarpedMaps,
  getIiifCacheStats,
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
  spriteIndex,
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
  log?: IiifLog;
  debug?: boolean;
  onProgress?: (done: number, total: number, latest: any) => void;
  onRenderStats?: (stats: LayerRenderStats) => void;
}) {
  return initializeLayerGroup(opts);
}
