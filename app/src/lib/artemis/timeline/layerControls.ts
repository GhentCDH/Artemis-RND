import type maplibregl from 'maplibre-gl';
import type { HistCartLayerKey, LandUsageLayerKey } from '$lib/artemis/map/mapInit';

export type LayerGroupInfo = {
  uiLayerId: string;
};

type SubLayerDef = {
  kind: 'iiif' | 'geojson' | 'wmts' | 'wms' | 'searchable';
};

type PaneId = 'left' | 'right';

type ApplyLayerOrderDeps = {
  targetMap: maplibregl.Map | null | undefined;
  paneId: PaneId | 'main';
  mainLayerOrder: string[];
  mainLayerSubs: Record<string, string[]>;
  subLayerDefs: Record<string, SubLayerDef>;
  getMainWmtsKey: (mainId: string) => HistCartLayerKey | undefined;
  getLandUsageKey: (mainId: string) => LandUsageLayerKey | undefined;
  getLandUsageLayerId: (key: LandUsageLayerKey) => string;
  getIiifInfoForSub: (subId: string) => LayerGroupInfo | undefined;
  getLayerGroupLayerIds: (groupId: string, paneId?: PaneId | 'main') => string[];
  getPrimitiveLayerIds: () => string[];
};

type ToggleMainLayerDeps = {
  currentEnabled: Record<string, boolean>;
  setEnabled: (next: Record<string, boolean>) => void;
  getMainWmtsKey: (mainId: string) => HistCartLayerKey | undefined;
  applyMainPaneOrder: () => void;
  mainLayerSubs: Record<string, string[]>;
  subLayerDefs: Record<string, SubLayerDef>;
  scheduleIiifMainLayerSync: (mainId: string) => Promise<void> | void;
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void;
};

type ToggleSubLayerDeps = {
  currentEnabled: Record<string, boolean>;
  setEnabled: (next: Record<string, boolean>) => void;
  subLayerDefs: Record<string, SubLayerDef>;
  mainLayerSubs: Record<string, string[]>;
  mainLayerOpacity: Record<string, number>;
  getMainWmtsKey: (mainId: string) => HistCartLayerKey | undefined;
  getLandUsageKey: (mainId: string) => LandUsageLayerKey | undefined;
  setHistCartLayerVisible: (map: maplibregl.Map | null | undefined, key: HistCartLayerKey, visible: boolean) => void;
  setHistCartLayerOpacity: (map: maplibregl.Map | null | undefined, key: HistCartLayerKey, opacity: number) => void;
  setLandUsageLayerVisible: (map: maplibregl.Map | null | undefined, key: LandUsageLayerKey, visible: boolean) => void;
  setLandUsageLayerOpacity: (map: maplibregl.Map | null | undefined, key: LandUsageLayerKey, opacity: number) => void;
  setPrimitiveLayerVisible: (map: maplibregl.Map | null | undefined, visible: boolean, url: string) => void;
  setPrimitiveLayerOpacity: (map: maplibregl.Map, opacity: number) => void;
  primitiveGeojsonUrl: () => string;
  getIiifInfoForSub: (subId: string) => LayerGroupInfo | undefined;
  scheduleIiifMainLayerSync: (mainId: string) => Promise<void> | void;
  applyMainPaneOrder: () => void;
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void;
  layersLength: number;
  targetMap: maplibregl.Map;
};

type ToggleRightMainLayerDeps = {
  pane: PaneId;
  mainId: string;
  enabled: boolean;
  currentVisible: Record<string, boolean>;
  setVisible: (next: Record<string, boolean>) => void;
  rightMap: maplibregl.Map | null;
  getMainWmtsKey: (mainId: string) => HistCartLayerKey | undefined;
  applyRightPaneOrder: () => void;
  mainLayerSubs: Record<string, string[]>;
  subLayerDefs: Record<string, SubLayerDef>;
  scheduleRightIiifMainLayerSync: (mainId: string) => Promise<void> | void;
};

type ToggleRightSubLayerDeps = {
  pane: PaneId;
  subId: string;
  enabled: boolean;
  currentVisible: Record<string, boolean>;
  setVisible: (next: Record<string, boolean>) => void;
  rightMap: maplibregl.Map | null;
  subLayerDefs: Record<string, SubLayerDef>;
  mainLayerSubs: Record<string, string[]>;
  mainLayerOpacity: Record<string, number>;
  getMainWmtsKey: (mainId: string) => HistCartLayerKey | undefined;
  getLandUsageKey: (mainId: string) => LandUsageLayerKey | undefined;
  setHistCartLayerVisible: (map: maplibregl.Map | null | undefined, key: HistCartLayerKey, visible: boolean) => void;
  setHistCartLayerOpacity: (map: maplibregl.Map | null | undefined, key: HistCartLayerKey, opacity: number) => void;
  setLandUsageLayerVisible: (map: maplibregl.Map | null | undefined, key: LandUsageLayerKey, visible: boolean) => void;
  setLandUsageLayerOpacity: (map: maplibregl.Map | null | undefined, key: LandUsageLayerKey, opacity: number) => void;
  setPrimitiveLayerVisible: (map: maplibregl.Map | null | undefined, visible: boolean, url: string) => void;
  setPrimitiveLayerOpacity: (map: maplibregl.Map, opacity: number) => void;
  primitiveGeojsonUrl: () => string;
  applyRightPaneOrder: () => void;
  scheduleRightIiifMainLayerSync: (mainId: string) => Promise<void> | void;
};

function findIiifSubId(
  mainId: string,
  mainLayerSubs: Record<string, string[]>,
  subLayerDefs: Record<string, SubLayerDef>
): string | undefined {
  return mainLayerSubs[mainId]?.find((subId) => subLayerDefs[subId]?.kind === 'iiif');
}

export function applyLayerOrderToPane({
  targetMap,
  paneId,
  mainLayerOrder,
  mainLayerSubs,
  subLayerDefs,
  getMainWmtsKey,
  getLandUsageKey,
  getLandUsageLayerId,
  getIiifInfoForSub,
  getLayerGroupLayerIds,
  getPrimitiveLayerIds,
}: ApplyLayerOrderDeps) {
  if (!targetMap || !targetMap.isStyleLoaded()) return;
  for (let i = mainLayerOrder.length - 1; i >= 0; i -= 1) {
    const mainId = mainLayerOrder[i];
    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey) {
      const layerId = `histcart-${wmtsKey}-layer`;
      try {
        if (targetMap.getLayer(layerId)) targetMap.moveLayer(layerId);
      } catch {
      }
    }
    for (const subId of mainLayerSubs[mainId] ?? []) {
      const subDef = subLayerDefs[subId];
      if (subDef?.kind === 'wms') {
        const landUsageKey = getLandUsageKey(mainId);
        if (landUsageKey) {
          const layerId = getLandUsageLayerId(landUsageKey);
          try {
            if (targetMap.getLayer(layerId)) targetMap.moveLayer(layerId);
          } catch {
          }
        }
      } else if (subDef?.kind === 'iiif') {
        const info = getIiifInfoForSub(subId);
        if (!info) continue;
        for (const layerId of getLayerGroupLayerIds(info.uiLayerId, paneId)) {
          try {
            if (targetMap.getLayer(layerId)) targetMap.moveLayer(layerId);
          } catch {
          }
        }
      } else if (subDef?.kind === 'geojson' && subId === 'PrimitiefKadaster-parcels') {
        for (const layerId of getPrimitiveLayerIds()) {
          try {
            if (targetMap.getLayer(layerId)) targetMap.moveLayer(layerId);
          } catch {
          }
        }
      }
    }
  }
}

export async function toggleMainLayerState(mainId: string, enabled: boolean, deps: ToggleMainLayerDeps) {
  if (deps.currentEnabled[mainId] === enabled) return;
  deps.setEnabled({ ...deps.currentEnabled, [mainId]: enabled });

  const wmtsKey = deps.getMainWmtsKey(mainId);
  if (wmtsKey) {
    deps.applyMainPaneOrder();
    return;
  }

  const iiifSubId = findIiifSubId(mainId, deps.mainLayerSubs, deps.subLayerDefs);
  if (!iiifSubId) {
    deps.log('WARN', `[toggleMain] ${mainId} no iiif sublayer`);
    return;
  }
  await deps.scheduleIiifMainLayerSync(mainId);
}

export async function toggleSubLayerState(subId: string, enabled: boolean, deps: ToggleSubLayerDeps) {
  if (deps.currentEnabled[subId] === enabled) return;
  deps.setEnabled({ ...deps.currentEnabled, [subId]: enabled });

  const subDef = deps.subLayerDefs[subId];
  if (!subDef || subDef.kind === 'searchable') return;

  const mainId = Object.keys(deps.mainLayerSubs).find((key) => deps.mainLayerSubs[key].includes(subId)) ?? '';
  const opacity = deps.mainLayerOpacity[mainId] ?? 1;

  if (subDef.kind === 'wmts') {
    const histKey = deps.getMainWmtsKey(mainId);
    if (!histKey) return;
    deps.setHistCartLayerVisible(deps.targetMap, histKey, enabled);
    if (enabled) deps.setHistCartLayerOpacity(deps.targetMap, histKey, opacity);
    deps.applyMainPaneOrder();
    return;
  }

  if (subDef.kind === 'wms') {
    const landUsageKey = deps.getLandUsageKey(mainId);
    if (landUsageKey) {
      deps.setLandUsageLayerVisible(deps.targetMap, landUsageKey, enabled);
      if (enabled) deps.setLandUsageLayerOpacity(deps.targetMap, landUsageKey, opacity);
    }
    deps.applyMainPaneOrder();
    return;
  }

  if (subDef.kind === 'geojson') {
    if (subId === 'PrimitiefKadaster-parcels') {
      deps.setPrimitiveLayerVisible(deps.targetMap, enabled, deps.primitiveGeojsonUrl());
      if (enabled) deps.setPrimitiveLayerOpacity(deps.targetMap, opacity);
      deps.applyMainPaneOrder();
    }
    return;
  }

  if (!deps.getIiifInfoForSub(subId)) {
    deps.log('WARN', `[toggleSub] ${subId} getIiifInfoForSub returned undefined (layers.length=${deps.layersLength})`);
    return;
  }

  await deps.scheduleIiifMainLayerSync(mainId);
}

export async function toggleRightPaneMainLayerState(deps: ToggleRightMainLayerDeps) {
  if (deps.pane !== 'right') return;
  deps.setVisible({ ...deps.currentVisible, [deps.mainId]: deps.enabled });
  if (!deps.rightMap) return;

  const wmtsKey = deps.getMainWmtsKey(deps.mainId);
  if (wmtsKey) {
    deps.applyRightPaneOrder();
    return;
  }

  const iiifSubId = findIiifSubId(deps.mainId, deps.mainLayerSubs, deps.subLayerDefs);
  if (!iiifSubId) return;
  await deps.scheduleRightIiifMainLayerSync(deps.mainId);
}

export async function toggleRightPaneSubLayerState(deps: ToggleRightSubLayerDeps) {
  if (deps.pane !== 'right') return;
  deps.setVisible({ ...deps.currentVisible, [deps.subId]: deps.enabled });
  if (!deps.rightMap) return;

  const subDef = deps.subLayerDefs[deps.subId];
  if (!subDef || subDef.kind === 'searchable') return;

  const mainId = Object.keys(deps.mainLayerSubs).find((key) => deps.mainLayerSubs[key].includes(deps.subId)) ?? '';
  const opacity = deps.mainLayerOpacity[mainId] ?? 1;

  if (subDef.kind === 'wmts') {
    const histKey = deps.getMainWmtsKey(mainId);
    if (!histKey) return;
    deps.setHistCartLayerVisible(deps.rightMap, histKey, deps.enabled);
    if (deps.enabled) deps.setHistCartLayerOpacity(deps.rightMap, histKey, opacity);
    deps.applyRightPaneOrder();
    return;
  }

  if (subDef.kind === 'wms') {
    const landUsageKey = deps.getLandUsageKey(mainId);
    if (landUsageKey) {
      deps.setLandUsageLayerVisible(deps.rightMap, landUsageKey, deps.enabled);
      if (deps.enabled) deps.setLandUsageLayerOpacity(deps.rightMap, landUsageKey, opacity);
    }
    deps.applyRightPaneOrder();
    return;
  }

  if (subDef.kind === 'geojson') {
    if (deps.subId === 'PrimitiefKadaster-parcels') {
      deps.setPrimitiveLayerVisible(deps.rightMap, deps.enabled, deps.primitiveGeojsonUrl());
      if (deps.enabled) deps.setPrimitiveLayerOpacity(deps.rightMap, opacity);
      deps.applyRightPaneOrder();
    }
    return;
  }

  await deps.scheduleRightIiifMainLayerSync(mainId);
}
