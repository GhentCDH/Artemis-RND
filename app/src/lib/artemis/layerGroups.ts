// MapLibre layer group lifecycle management.
// Tracks active WarpedMapLayer instances by group ID and provides
// add/remove/reorder/opacity controls used by both the runner and the UI.

import type maplibregl from "maplibre-gl";
import { WarpedMapLayer } from "@allmaps/maplibre";
import type { LayerInfo } from "$lib/artemis/types";

// --- Group ID ---

export function getLayerGroupId(layerInfo: LayerInfo): string {
  return `${layerInfo.compiledCollectionPath}::${layerInfo.renderLayerKey ?? "all"}`;
}

// --- Internal state ---

// Maps groupId → MapLibre layer IDs added for that group.
const activeLayersByGroup = new Map<string, string[]>();
// Maps groupId → active Allmaps custom layers (for opacity controls).
const activeWarpedLayersByGroup = new Map<string, WarpedMapLayer[]>();
// Maps groupId → cleanup fn (removes map.on handlers + clears keepalive interval).
// Called before re-adding a group to prevent handler accumulation.
const activeLayerCleanup = new Map<string, () => void>();

// --- Registration (called by runner after layer setup) ---

export function registerLayerGroup(
  groupId: string,
  layerIds: string[],
  warpedLayers: WarpedMapLayer[],
  cleanup: () => void
) {
  activeLayersByGroup.set(groupId, layerIds);
  activeWarpedLayersByGroup.set(groupId, warpedLayers);
  activeLayerCleanup.set(groupId, cleanup);
}

// --- Map readiness ---

export function waitForMapReady(map: maplibregl.Map): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();
  return new Promise((resolve) => {
    const onLoad = () => { map.off("load", onLoad); resolve(); };
    map.on("load", onLoad);
  });
}

// --- Lifecycle ---

export async function removeLayerGroup(map: maplibregl.Map, groupId: string) {
  await waitForMapReady(map);
  // Run cleanup (clears map.on handlers and keepalive interval) before removing layers.
  activeLayerCleanup.get(groupId)?.();
  activeLayerCleanup.delete(groupId);
  const ids = activeLayersByGroup.get(groupId) ?? [];
  for (const id of ids) {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
  }
  activeLayersByGroup.delete(groupId);
  activeWarpedLayersByGroup.delete(groupId);
}

export async function clearAllLayerGroups(map: maplibregl.Map) {
  await waitForMapReady(map);
  for (const [groupId] of activeLayersByGroup) {
    await removeLayerGroup(map, groupId);
  }
}

// --- Controls ---

// Pass orderedGroupIds bottom-to-top; each group is moved to the top of the stack
// in that order, so the last group ends up rendered on top of all others.
export function reorderLayerGroups(map: maplibregl.Map, orderedGroupIds: string[]) {
  for (const groupId of orderedGroupIds) {
    for (const id of activeLayersByGroup.get(groupId) ?? []) {
      try { if (map.getLayer(id)) map.moveLayer(id); } catch { /* ignore */ }
    }
  }
}

export function setLayerGroupOpacity(map: maplibregl.Map, groupId: string, opacity: number) {
  const clamped = Math.max(0, Math.min(1, opacity));
  for (const layer of activeWarpedLayersByGroup.get(groupId) ?? []) {
    try { layer.setOpacity(clamped); } catch { /* ignore */ }
  }
}

export function isLayerGroupRendered(map: maplibregl.Map, groupId: string): boolean {
  return (activeLayersByGroup.get(groupId) ?? []).some((id) => !!map.getLayer(id));
}

export function getLayerGroupLayerIds(groupId: string): string[] {
  return [...(activeLayersByGroup.get(groupId) ?? [])];
}
