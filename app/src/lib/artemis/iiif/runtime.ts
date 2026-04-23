import type maplibregl from "maplibre-gl";
import type { WarpedMapLayer } from "@allmaps/maplibre";
import type { SpriteRef } from "$lib/artemis/shared/types";
import type { LayerInfo } from "./bundleLoader";

export type PaneRuntimeId = string;

export type ManifestInfo = {
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

export type SpriteFeature = {
  id: string;
  label: string;
  spriteUrl: string;
  bbox: [number, number, number, number];
  layerId: string;
  layerLabel: string;
};

const activeLayersByGroup = new Map<string, string[]>();
const activeWarpedLayersByGroup = new Map<string, WarpedMapLayer[]>();
const mapIdToManifestInfo = new Map<string, ManifestInfo>();
const activeLayerCleanup = new Map<string, () => void>();
const parkedLayersByGroup = new Map<string, { layerIds: string[]; warpedLayers: WarpedMapLayer[] }>();
const paneRuntimes = new Map<PaneRuntimeId, PaneRuntime>();

export const spriteIndex = new Map<string, SpriteFeature>();

export function getLayerGroupId(layerInfo: LayerInfo): string {
  const base =
    layerInfo.compiledCollectionPath ||
    layerInfo.geomapsPath ||
    layerInfo.map ||
    layerInfo.sourceCollectionLabel;
  return `${base}::${layerInfo.renderLayerKey ?? "all"}`;
}

export function getPaneRuntime(paneId: PaneRuntimeId = "main"): PaneRuntime {
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

export function resetAllIiifRuntime() {
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

export async function waitForMapReady(map: maplibregl.Map): Promise<void> {
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
    if (isUsable()) finish();
  });
}

export async function removeMaplibreLayer(map: maplibregl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // ignore
  }
}

export function safeHasMapLayer(map: maplibregl.Map, layerId: string): boolean {
  try {
    return Boolean(map?.getLayer?.(layerId));
  } catch {
    return false;
  }
}

export async function removeLayerGroup(map: maplibregl.Map, groupId: string, paneId: PaneRuntimeId = "main") {
  await waitForMapReady(map);
  const runtime = getPaneRuntime(paneId);

  if (runtime.parkedLayersByGroup.has(groupId)) {
    const parked = runtime.parkedLayersByGroup.get(groupId)!;
    runtime.parkedLayersByGroup.delete(groupId);
    for (const id of parked.layerIds) await removeMaplibreLayer(map, id);
    return;
  }

  runtime.activeLayerCleanup.get(groupId)?.();
  runtime.activeLayerCleanup.delete(groupId);
  const ids = runtime.activeLayersByGroup.get(groupId) ?? [];
  for (const id of ids) await removeMaplibreLayer(map, id);
  runtime.activeLayersByGroup.delete(groupId);
  runtime.activeWarpedLayersByGroup.delete(groupId);
}

export async function parkLayerGroup(map: maplibregl.Map, groupId: string, paneId: PaneRuntimeId = "main") {
  await waitForMapReady(map);
  const runtime = getPaneRuntime(paneId);
  const warpedLayers = runtime.activeWarpedLayersByGroup.get(groupId);
  const layerIds = runtime.activeLayersByGroup.get(groupId);
  if (!warpedLayers || !layerIds || layerIds.length === 0) return;
  for (const l of warpedLayers) {
    try {
      l.setOpacity(0);
    } catch {
      // ignore
    }
  }
  runtime.parkedLayersByGroup.set(groupId, { layerIds: [...layerIds], warpedLayers: [...warpedLayers] });
  runtime.activeLayersByGroup.delete(groupId);
  runtime.activeWarpedLayersByGroup.delete(groupId);
}

export function isLayerGroupParked(groupId: string, paneId: PaneRuntimeId = "main"): boolean {
  return getPaneRuntime(paneId).parkedLayersByGroup.has(groupId);
}

export function reorderLayerGroups(map: maplibregl.Map, orderedGroupIds: string[], paneId: PaneRuntimeId = "main") {
  const runtime = getPaneRuntime(paneId);
  for (const groupId of orderedGroupIds) {
    const ids = runtime.activeLayersByGroup.get(groupId) ?? [];
    for (const id of ids) {
      try {
        if (map.getLayer(id)) map.moveLayer(id);
      } catch {
        // ignore
      }
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
