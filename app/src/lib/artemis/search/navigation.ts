import type { ManifestSearchItem, PreviewBubbleItem, ToponymIndexItem } from '$lib/artemis/types';
import type { MainLayerId } from '$lib/artemis/layerConfig';

export type SearchFocusState = {
  mainId: MainLayerId;
  year: number | null;
  nonce: number;
};

type SearchNavigationDeps = {
  mainLayerLabels: Record<string, string>;
  timelineYearByLayer: Partial<Record<MainLayerId, number>>;
  currentMassartYear: number;
  setMassartYear: (year: number) => void;
  tick: () => Promise<void>;
  currentMainLayerOrder: MainLayerId[];
  setMainLayerOrder: (next: MainLayerId[]) => void;
  mainLayerEnabled: Record<string, boolean>;
  toggleMainLayer: (mainId: string, enabled: boolean) => Promise<void>;
  applyZOrder: () => void;
  flyToCoordinates: (lon: number, lat: number, label: string) => void;
  openPreviewBubbleAt: (item: PreviewBubbleItem, lon: number, lat: number) => void;
};

function resolveMainIdForMapName(
  mapName: string,
  mainLayerLabels: SearchNavigationDeps['mainLayerLabels']
): MainLayerId | undefined {
  const norm = mapName.trim().toLowerCase();
  for (const [id, label] of Object.entries(mainLayerLabels)) {
    if (label.toLowerCase() === norm) return id as MainLayerId;
  }
  for (const [id, label] of Object.entries(mainLayerLabels)) {
    if (norm.includes(id) || label.toLowerCase().includes(norm)) return id as MainLayerId;
  }
  return undefined;
}

async function focusTimelineForMainLayer(
  mainId: MainLayerId,
  deps: Pick<SearchNavigationDeps, 'timelineYearByLayer' | 'currentMassartYear' | 'setMassartYear' | 'tick'>
) {
  const targetYear = deps.timelineYearByLayer[mainId];
  if (targetYear == null || deps.currentMassartYear === targetYear) return;
  deps.setMassartYear(targetYear);
  await deps.tick();
}

async function activateLayer(
  mainId: MainLayerId,
  deps: Pick<
    SearchNavigationDeps,
    'currentMainLayerOrder' | 'setMainLayerOrder' | 'mainLayerEnabled' | 'toggleMainLayer' | 'applyZOrder'
  >
) {
  if (deps.currentMainLayerOrder[0] !== mainId) {
    deps.setMainLayerOrder([mainId, ...deps.currentMainLayerOrder.filter((id) => id !== mainId)]);
  }
  if (!deps.mainLayerEnabled[mainId]) {
    await deps.toggleMainLayer(mainId, true);
  } else {
    deps.applyZOrder();
  }
}

function buildSearchFocus(
  mainId: MainLayerId,
  currentNonce: number,
  timelineYearByLayer: SearchNavigationDeps['timelineYearByLayer']
): SearchFocusState {
  return {
    mainId,
    year: timelineYearByLayer[mainId] ?? null,
    nonce: currentNonce + 1,
  };
}

export async function handleToponymSelection(
  item: ToponymIndexItem,
  currentNonce: number,
  deps: SearchNavigationDeps
): Promise<SearchFocusState | null> {
  const mainId = resolveMainIdForMapName(item.mapName, deps.mainLayerLabels);
  if (mainId) {
    await focusTimelineForMainLayer(mainId, deps);
    await activateLayer(mainId, deps);
  }
  deps.flyToCoordinates(item.lon, item.lat, `Toponym "${item.text}"`);
  return mainId ? buildSearchFocus(mainId, currentNonce, deps.timelineYearByLayer) : null;
}

export async function handleManifestSelection(
  result: ManifestSearchItem,
  currentNonce: number,
  deps: SearchNavigationDeps
): Promise<SearchFocusState | null> {
  const mainId = resolveMainIdForMapName(result.mapName, deps.mainLayerLabels);
  if (mainId) {
    await focusTimelineForMainLayer(mainId, deps);
    await activateLayer(mainId, deps);
  }
  if (result.centerLon != null && result.centerLat != null) {
    deps.flyToCoordinates(result.centerLon, result.centerLat, `Manifest "${result.text}"`);
    deps.openPreviewBubbleAt(
      {
        title: result.label,
        manifestUrl: result.sourceManifestUrl,
        location: mainId ? deps.mainLayerLabels[mainId] : result.mapName,
        kicker: 'Map Sheet',
      },
      result.centerLon,
      result.centerLat
    );
  }
  return mainId ? buildSearchFocus(mainId, currentNonce, deps.timelineYearByLayer) : null;
}
