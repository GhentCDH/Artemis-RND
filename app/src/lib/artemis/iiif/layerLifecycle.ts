import type maplibregl from 'maplibre-gl';
import { runLayerGroup, type LayerInfo } from '$lib/artemis/iiif/layerController';

type LayerInfoWithUiId = LayerInfo & { uiLayerId: string };

export async function loadIiifLayerIntoPane(opts: {
  targetMap: maplibregl.Map;
  paneId?: 'right';
  cfg: any;
  layerInfo: LayerInfoWithUiId;
  parallelLoading: boolean;
  spriteDebugMode: boolean;
}) {
  const { targetMap, paneId, cfg, layerInfo, parallelLoading, spriteDebugMode } = opts;
  await runLayerGroup({
    map: targetMap,
    paneId,
    cfg,
    layerInfo,
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
