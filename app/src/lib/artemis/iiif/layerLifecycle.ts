import type maplibregl from 'maplibre-gl';
import { runLayerGroup, type LayerInfo } from '$lib/artemis/iiif/layerController';

type LayerInfoWithUiId = LayerInfo & { uiLayerId: string };
type ViewMode = 'single' | 'split';

export async function loadIiifLayerIntoPane(opts: {
  targetMap: maplibregl.Map;
  paneId?: 'right';
  cfg: any;
  layerInfo: LayerInfoWithUiId;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string) => void;
  parallelLoading: boolean;
  spriteDebugMode: boolean;
}) {
  const { targetMap, paneId, cfg, layerInfo, log, parallelLoading, spriteDebugMode } = opts;
  await runLayerGroup({
    map: targetMap,
    paneId,
    cfg,
    layerInfo,
    log,
    parallelLoading,
    spriteDebugMode,
  });
}

export function getIiifMainLayerIds(opts: {
  mainLayerOrder: string[];
  mainLayerSubs: Record<string, string[]>;
  subLayerDefs: Record<string, { kind?: string }>;
}) {
  const { mainLayerOrder, mainLayerSubs, subLayerDefs } = opts;
  return mainLayerOrder.filter((mainId) =>
    (mainLayerSubs[mainId] ?? []).some((subId) => subLayerDefs[subId]?.kind === 'iiif')
  );
}

export async function warmInitialIiifLayers(opts: {
  startupPreloadScreen: boolean;
  initialWarmupPending: boolean;
  initialWarmupRunning: boolean;
  mainLayerOrder: string[];
  mainLayerLabels: Record<string, string>;
  mainLayerSubs: Record<string, string[]>;
  subLayerDefs: Record<string, { kind?: string }>;
  getIiifInfoForSub: (subId: string) => LayerInfoWithUiId | undefined;
  setInitialWarmupState: (patch: {
    running?: boolean;
    total?: number;
    done?: number;
    label?: string;
    pending?: boolean;
  }) => void;
  setMainLayerLoading: (mainId: string, value: boolean) => void;
  loadIiifLayer: (layerInfo: LayerInfoWithUiId) => Promise<void>;
  parkLayerGroup: (groupId: string) => Promise<void>;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string) => void;
}) {
  const {
    startupPreloadScreen,
    initialWarmupPending,
    initialWarmupRunning,
    mainLayerOrder,
    mainLayerLabels,
    mainLayerSubs,
    subLayerDefs,
    getIiifInfoForSub,
    setInitialWarmupState,
    setMainLayerLoading,
    loadIiifLayer,
    parkLayerGroup,
    log,
  } = opts;

  if (!startupPreloadScreen || !initialWarmupPending || initialWarmupRunning) return;

  const iiifMainIds = getIiifMainLayerIds({ mainLayerOrder, mainLayerSubs, subLayerDefs });
  setInitialWarmupState({
    running: true,
    total: iiifMainIds.length,
    done: 0,
    label: 'Preparing IIIF layers',
  });

  let done = 0;
  try {
    for (const mainId of iiifMainIds) {
      const iiifSubId = mainLayerSubs[mainId]?.find((s) => subLayerDefs[s]?.kind === 'iiif');
      if (!iiifSubId) continue;
      const info = getIiifInfoForSub(iiifSubId);
      if (!info) continue;

      setInitialWarmupState({ label: `Preparing ${mainLayerLabels[mainId] ?? mainId}` });
      setMainLayerLoading(mainId, true);
      try {
        await loadIiifLayer(info);
        await parkLayerGroup(info.uiLayerId);
      } catch (e: any) {
        log('ERROR', `[Warmup] ${mainId} failed: ${e?.message ?? String(e)}`);
      } finally {
        setMainLayerLoading(mainId, false);
        done += 1;
        setInitialWarmupState({ done });
      }
    }
    setInitialWarmupState({ pending: false });
  } finally {
    setInitialWarmupState({
      running: false,
      label: 'IIIF layers ready',
    });
  }
}

export function scheduleMainSync(opts: {
  mainId: string;
  queuedByMain: Map<string, boolean>;
  inFlightByMain: Map<string, Promise<void>>;
  syncMain: (mainId: string) => Promise<void>;
}) {
  const { mainId, queuedByMain, inFlightByMain, syncMain } = opts;
  queuedByMain.set(mainId, true);
  const inFlight = inFlightByMain.get(mainId);
  if (inFlight) return inFlight;

  const task = (async () => {
    while (queuedByMain.get(mainId)) {
      queuedByMain.set(mainId, false);
      await syncMain(mainId);
    }
  })().finally(() => {
    inFlightByMain.delete(mainId);
    queuedByMain.delete(mainId);
  });

  inFlightByMain.set(mainId, task);
  return task;
}
