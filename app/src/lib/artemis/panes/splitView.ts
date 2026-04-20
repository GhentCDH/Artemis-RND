import type maplibregl from 'maplibre-gl';

type PaneId = 'left' | 'right';
type ViewMode = 'single' | 'split';

export function syncCameraBetweenPanes(opts: {
  from: PaneId;
  dualPaneEnabled: boolean;
  leftMap: maplibregl.Map | null;
  rightMap: maplibregl.Map | null;
  suppressSyncPane: PaneId | null;
  setSuppressSyncPane: (pane: PaneId | null) => void;
}) {
  const { from, dualPaneEnabled, leftMap, rightMap, suppressSyncPane, setSuppressSyncPane } = opts;
  if (!dualPaneEnabled || !leftMap || !rightMap) return;
  const source = from === 'left' ? leftMap : rightMap;
  const target = from === 'left' ? rightMap : leftMap;
  const targetPane: PaneId = from === 'left' ? 'right' : 'left';
  if (!source || !target || suppressSyncPane === from) return;

  setSuppressSyncPane(targetPane);
  target.jumpTo({
    center: source.getCenter(),
    zoom: source.getZoom(),
    bearing: source.getBearing(),
    pitch: source.getPitch(),
  });
  setSuppressSyncPane(null);
}

export async function syncMapsAfterLayoutChange(opts: {
  nextMode: ViewMode;
  leftMap: maplibregl.Map | null;
  rightMap: maplibregl.Map | null;
  awaitLayout: () => Promise<void>;
  rehydratePaneMap: (targetMap: maplibregl.Map, paneId: 'main' | 'right') => Promise<void>;
}) {
  const { nextMode, leftMap, rightMap, awaitLayout, rehydratePaneMap } = opts;
  await awaitLayout();
  await awaitLayout();

  try { leftMap?.resize(); } catch {}
  try { rightMap?.resize(); } catch {}

  await awaitLayout();

  try { leftMap?.resize(); } catch {}
  try { rightMap?.resize(); } catch {}

  if (leftMap?.isStyleLoaded()) {
    await rehydratePaneMap(leftMap, 'main');
  }

  if (nextMode === 'split' && rightMap?.isStyleLoaded()) {
    await rehydratePaneMap(rightMap, 'right');
  }
}

export async function syncRightPaneState(opts: {
  rightMap: maplibregl.Map | null;
  massartItemsLength: number;
  setMassartPinsForRightPane: () => void;
  rightSubLayerVisible: Record<string, boolean>;
  rightMainLayerVisible: Record<string, boolean>;
  hasIiifSubLayers: (mainId: string) => boolean;
  onPaneSublayerChange: (subId: string, enabled: boolean) => Promise<void>;
  onPaneMainToggle: (mainId: string, enabled: boolean) => Promise<void>;
  applyZOrderForPane: (targetMap: maplibregl.Map, paneId: 'right') => void;
}) {
  const {
    rightMap,
    massartItemsLength,
    setMassartPinsForRightPane,
    rightSubLayerVisible,
    rightMainLayerVisible,
    hasIiifSubLayers,
    onPaneSublayerChange,
    onPaneMainToggle,
    applyZOrderForPane,
  } = opts;

  if (!rightMap) return;
  if (massartItemsLength > 0) {
    setMassartPinsForRightPane();
  }
  for (const subId of Object.keys(rightSubLayerVisible)) {
    await onPaneSublayerChange(subId, rightSubLayerVisible[subId]);
  }
  for (const mainId of Object.keys(rightMainLayerVisible)) {
    if (hasIiifSubLayers(mainId)) {
      await onPaneMainToggle(mainId, rightMainLayerVisible[mainId]);
    }
  }
  applyZOrderForPane(rightMap, 'right');
}

export async function ensureRightPaneMap(opts: {
  isSplitLayout: boolean;
  rightMapDiv: HTMLElement | undefined;
  rightMap: maplibregl.Map | null;
  rightMapInitInFlight: boolean;
  awaitTick: () => Promise<void>;
  createMapContextWithTheme: (container: HTMLElement, themeMode: 'light' | 'dark') => maplibregl.Map;
  themeMode: 'light' | 'dark';
  leftMap: maplibregl.Map;
  setRightMapInitInFlight: (value: boolean) => void;
  setRightMap: (value: maplibregl.Map | null) => void;
  setRightMapReady: (value: boolean) => void;
  onLoad: (targetMap: maplibregl.Map) => Promise<void>;
  onMove: (targetMap: maplibregl.Map) => void;
}) {
  const {
    isSplitLayout,
    rightMapDiv,
    rightMap,
    rightMapInitInFlight,
    awaitTick,
    createMapContextWithTheme,
    themeMode,
    leftMap,
    setRightMapInitInFlight,
    setRightMap,
    setRightMapReady,
    onLoad,
    onMove,
  } = opts;

  if (!isSplitLayout || !rightMapDiv || rightMap || rightMapInitInFlight) return;
  setRightMapInitInFlight(true);
  await awaitTick();

  const nextRightMap = createMapContextWithTheme(rightMapDiv, themeMode);
  setRightMap(nextRightMap);
  nextRightMap.on('load', async () => {
    setRightMapReady(true);
    nextRightMap.jumpTo({
      center: leftMap.getCenter(),
      zoom: leftMap.getZoom(),
      bearing: leftMap.getBearing(),
      pitch: leftMap.getPitch(),
    });
    await onLoad(nextRightMap);
  });
  nextRightMap.on('move', () => onMove(nextRightMap));
  setRightMapInitInFlight(false);
}

export function teardownRightPaneMap(opts: {
  rightMap: maplibregl.Map | null;
  destroyMapContextInstance: (targetMap: maplibregl.Map) => void;
  resetPaneRuntime: (paneId: 'right') => void;
  setRightMap: (value: maplibregl.Map | null) => void;
  setRightMapReady: (value: boolean) => void;
  setRightMapInitInFlight: (value: boolean) => void;
  clearRightPaneState: () => void;
}) {
  const {
    rightMap,
    destroyMapContextInstance,
    resetPaneRuntime,
    setRightMap,
    setRightMapReady,
    setRightMapInitInFlight,
    clearRightPaneState,
  } = opts;

  if (!rightMap) return;
  destroyMapContextInstance(rightMap);
  resetPaneRuntime('right');
  setRightMap(null);
  setRightMapReady(false);
  setRightMapInitInFlight(false);
  clearRightPaneState();
}
