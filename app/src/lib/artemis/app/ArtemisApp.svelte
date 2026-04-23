<!-- src/routes/+page.svelte — map shell + orchestration -->
<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/theme.css';
  import '$lib/ui.css';
  import { onDestroy, onMount, tick } from 'svelte';
  import type maplibregl from 'maplibre-gl';

  import {
    ensureMapContext, destroyMapContext, createMapContextWithTheme, destroyMapContextInstance, setBaseMapTheme,
    setHistCartLayerVisible, setHistCartLayerOpacity,
    setLandUsageLayerVisible, setLandUsageLayerOpacity, getLandUsageLayerId,
    setPrimitiveLayerVisible, isPrimitiveLayerVisible,
    setPrimitiveLayerOpacity, getPrimitiveLayerIds,
    setPrimitiveHoverFeature, setPrimitiveSelectFeature,
    setIiifHoverMasks,
    setMassartPins, updateMassartActiveYear, getMassartClickLayerIds,
    flashLocationMarker,
  } from '$lib/artemis/map/mapInit';
  import {
    loadCompiledIndex, runLayerGroup, removeLayerGroup, parkLayerGroup, clearAllLayerGroups,
    isLayerGroupParked, setLayerGroupOpacity, getLayerGroupLayerIds,
    resetCompiledIndexCache, resetPaneRuntime, getLayerGroupId, refreshActiveLayerGroups,
    getAllActiveWarpedMaps, getManifestInfoForMapId,
    type LayerInfo, type CompiledIndex, type CompiledRunnerConfig,
  } from '$lib/artemis/iiif/runner';
  import {
    loadRuntimeMetadata as loadRuntimeMetadataData,
    type RuntimeSiteMetadata,
    type RuntimeLayerMetadata,
    type RuntimeTeamInstitution,
  } from '$lib/artemis/dataset/runtimeMetadata';
  import { buildManifestSearchIndex as buildManifestSearchIndexData } from '$lib/artemis/dataset/manifestSearch';
  import { loadToponymIndex as loadToponymIndexData } from '$lib/artemis/dataset/toponyms';
  import {
    getIiifMainLayerIds as getIiifMainLayerIdsData,
    loadIiifLayerIntoPane,
    scheduleMainSync,
    warmInitialIiifLayers as warmInitialIiifLayersData,
  } from '$lib/artemis/iiif/layerLifecycle';
  import {
    handleManifestSelection,
    handleToponymSelection,
    type SearchFocusState,
  } from '$lib/artemis/search/navigation';
  import {
    applyLayerOrderToPane,
    toggleMainLayerState,
    toggleRightPaneMainLayerState,
    toggleRightPaneSubLayerState,
    toggleSubLayerState,
  } from '$lib/artemis/timeline/layerControls';
  import {
    ensureRightPaneMap,
    syncCameraBetweenPanes,
    syncMapsAfterLayoutChange as syncMapsAfterLayoutChangeData,
    syncRightPaneState as syncRightPaneStateData,
    teardownRightPaneMap,
  } from '$lib/artemis/panes/splitView';
  import { normalizeSearchText } from '$lib/artemis/search/text';
  import { normalizeRawToponym } from '$lib/artemis/dataset/toponymNormalization';
  import { asFiniteNumber } from '$lib/artemis/shared/utils';
  import {
    MAIN_LAYER_ORDER, MAIN_LAYER_META, MAIN_LAYER_LABELS, MAIN_LAYER_INFO,
    MAIN_LAYER_SUBS, SUB_LAYER_DEFS,
    makeInitialMainLayerEnabled, makeInitialSubLayerEnabled,
    type MainLayerId,
  } from '$lib/artemis/config/layers';
  import type { HistCartLayerKey } from '$lib/artemis/map/mapInit';
  import type {
    ToponymIndexItem, ManifestSearchItem,
    IiifMapInfo, ParcelClickInfo, PinnedCard, MassartItem, PreviewBubbleItem, SpriteRef,
  } from '$lib/artemis/shared/types';

  import ToponymSearch from '$lib/artemis/ui/ToponymSearch.svelte';
  import InfoCards from '$lib/artemis/ui/InfoCards.svelte';
  import ImageCollectionBubble from '$lib/artemis/ui/ImageCollectionBubble.svelte';
  import IiifViewer from '$lib/artemis/viewer/IiifViewer.svelte';
  import Timeslider from '$lib/components/Timeslider.svelte';

  // ─── Map ───────────────────────────────────────────────────────────────────

  type PaneId = 'left' | 'right';
  type ViewMode = 'single' | 'split';
  type ThemeMode = 'light' | 'dark';
  let mapDiv: HTMLElement;
  let map: maplibregl.Map;
  let mapStageEl: HTMLElement;
  let rightMapDiv: HTMLElement;
  let rightMap: maplibregl.Map | null = null;
  let rightMapReady = false;
  let rightMapInitInFlight = false;
  let suppressSyncPane: PaneId | null = null;
  let viewMode: ViewMode = 'single';
  let themeMode: ThemeMode = 'light';
  const THEME_STORAGE_KEY = 'artemis-theme-mode';
  let scaleWidthPx = 0;
  let scaleLabel = '';
  let siteInfoOpen = false;
  let siteMetadata: RuntimeSiteMetadata = {
    title: 'About Artemis',
    info: [],
    attribution: '',
    team: [] as RuntimeTeamInstitution[],
    logos: [],
  };
  let layerMetadataByMainId: Record<string, RuntimeLayerMetadata> = {};
  const SCALE_MAX_WIDTH_PX = 120;
  let searchFocusMainId: MainLayerId | null = null;
  let searchFocusYear: number | null = null;
  let searchFocusNonce = 0;

  // ─── Config ────────────────────────────────────────────────────────────────

  const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/ghentcdh/Artemis-RnD-Data/dev/build';
  const FEATURE_FLAGS: { startupPreloadScreen: boolean; parallelIiifLoading: boolean; spriteDebugMode: boolean } = {
    // Flip to false to bypass the startup preload/loading-screen concept.
    startupPreloadScreen: false,
    // Load all IIIF maps in parallel vs phased (bootstrap → background). Flip to test performance.
    parallelIiifLoading: false,
    // Use debug spritesheets (with pink tint) to visualize sprite loading. Flip to test.
    spriteDebugMode: false,
  };
  let datasetBaseUrl = DEFAULT_BASE_URL;

  function cfg(): CompiledRunnerConfig {
    return { datasetBaseUrl: normalizeDatasetBaseUrl(datasetBaseUrl.trim()), fetchTimeoutMs: 30000 };
  }

  function normalizeDatasetBaseUrl(input: string): string {
    let url = input.trim();
    if (!url) return url;
    // Accept pasted GitHub blob URL: https://github.com/…/blob/…/build/index.json
    const blobMatch = url.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)\/index\.json\/?$/i
    );
    if (blobMatch) {
      const [, owner, repo, ref, buildPath] = blobMatch;
      return `https://${owner.toLowerCase()}.github.io/${repo}/${buildPath}`.replace(/\/+$/, '');
    }
    return url.replace(/\/index\.json\/?$/i, '').replace(/\/+$/, '');
  }

  function primitiveGeojsonUrl(): string {
    return `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Parcels/PrimitiefKadaster/PrimitiefKadasterParcels.geojson`;
  }

  function runtimeStaticBaseUrl(): string {
    const base = normalizeDatasetBaseUrl(datasetBaseUrl.trim());
    if (!base) return '';
    if (/\/build\/?$/i.test(base)) return base.replace(/\/build\/?$/i, '/static');
    return `${base}/static`.replace(/\/+$/, '');
  }

  function getLayerMetadataCandidates(mainId: string): string[] {
    const subIds = MAIN_LAYER_SUBS[mainId] ?? [];
    const iiifSubId = subIds.find((subId) => SUB_LAYER_DEFS[subId]?.kind === 'iiif');
    const iiifLayer = iiifSubId ? getIiifInfoForSub(iiifSubId) : undefined;
    const explicitLayerId = typeof (iiifLayer as any)?.layerId === 'string'
      ? String((iiifLayer as any).layerId).trim()
      : '';
    const compiledTail = iiifLayer?.compiledCollectionPath?.split('/').filter(Boolean).pop() ?? '';
    const iiifMap = typeof (iiifLayer as any)?.map === 'string' ? String((iiifLayer as any).map).trim() : '';
    const geomapsStem = (iiifLayer as any)?.geomapsPath
      ?.split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/_geomaps\.json$/i, '') ?? '';
    return [...new Set([explicitLayerId, compiledTail, iiifMap, geomapsStem, mainId].filter(Boolean))];
  }

  async function loadRuntimeMetadata() {
    const runtimeMetadata = await loadRuntimeMetadataData({
      staticBaseUrl: runtimeStaticBaseUrl(),
      mainLayerOrder,
      mainLayerLabels: MAIN_LAYER_LABELS,
      mainLayerInfo: MAIN_LAYER_INFO,
      getLayerMetadataCandidates,
    });
    siteMetadata = runtimeMetadata.siteMetadata;
    layerMetadataByMainId = runtimeMetadata.layerMetadataByMainId;
  }

  // ─── Massart ───────────────────────────────────────────────────────────────

  const MASSART_LEEWAY = 3; // years each side of the scrubber that count as "active"
  const MASSART_YEAR_MIN = 1904;
  const MASSART_YEAR_MAX = 1912;
  const MAIN_LAYER_TIMELINE_YEAR: Partial<Record<MainLayerId, number>> = {
    HanddrawnCollection: 1707,
    Frickx: 1712,
    Villaret: 1746,
    Ferraris: 1774,
    PrimitiefKadaster: 1814,
    Vandermaelen: 1850,
    GereduceerdeKadaster: 1851,
    Popp: 1860,
    NGI1873: 1873,
    NGI1904: 1904,
  };
  let massartItems: MassartItem[] = [];
  let massartYear = Math.round((1700 + 1855) / 2); // updated by slider year-change
  let rightTimelineYear = MASSART_YEAR_MAX;
  let massartSpriteRects: Record<string, { x: number; y: number; width: number; height: number }> = {};
  let massartSpriteSheetUrl = '';
  let massartSpriteSheetSize: [number, number] = [0, 0];

  async function loadMassartData() {
    try {
      const base = `${cfg().datasetBaseUrl}/Image collections/Massart`;
      const res = await fetch(`${base}/Massart_index.json`);
      if (!res.ok) return;
      const data = await res.json();
      massartItems = Array.isArray(data.items) ? data.items : [];
      if (data.sprites?.json && data.sprites?.image) {
        const spritesRes = await fetch(`${cfg().datasetBaseUrl}/${data.sprites.json}`);
        if (spritesRes.ok) {
          massartSpriteRects = await spritesRes.json();
          massartSpriteSheetUrl = `${cfg().datasetBaseUrl}/${data.sprites.image}`;
          massartSpriteSheetSize = data.sprites.imageSize ?? [0, 0];
        }
      }
    } catch { /* degrade silently — pins won't appear */ }
  }

  function massartSpriteRef(item: MassartItem): SpriteRef | undefined {
    const rect = massartSpriteRects[item.repId];
    if (!rect || !massartSpriteSheetUrl) return undefined;
    const sheetUrl = FEATURE_FLAGS.spriteDebugMode
      ? massartSpriteSheetUrl.replace(/(\.[^.]+)$/, "_debug$1")
      : massartSpriteSheetUrl;
    return {
      sheetUrl,
      sheetWidth: massartSpriteSheetSize[0],
      sheetHeight: massartSpriteSheetSize[1],
      ...rect,
    };
  }

  function onMassartYearChange(e: CustomEvent<{ year: number; pane?: 'left' | 'right' }>) {
    const pane = e.detail.pane ?? 'left';
    if (pane === 'right') {
      rightTimelineYear = e.detail.year;
      if (rightMap?.isStyleLoaded()) {
        updateMassartActiveYear(rightMap, rightTimelineYear, MASSART_LEEWAY);
      }
      return;
    }
    massartYear = e.detail.year;
    if (map?.isStyleLoaded()) {
      updateMassartActiveYear(map, massartYear, MASSART_LEEWAY);
    }
  }

  function onTimelineImageFocus(e: CustomEvent<{ pane: PaneId; title: string; lon: number; lat: number }>) {
    const label = `Photo "${e.detail.title}"`;
    if (e.detail.pane === 'right' && rightMap) {
      try {
        const nextZoom = Math.max(rightMap.getZoom(), 14);
        const center = [e.detail.lon, e.detail.lat] as [number, number];
        const cur = rightMap.getCenter();
        if (Math.abs(cur.lng - e.detail.lon) >= 1e-9 || Math.abs(cur.lat - e.detail.lat) >= 1e-9 || Math.abs(rightMap.getZoom() - nextZoom) >= 0.01) {
          rightMap.stop();
          rightMap.easeTo({ center, zoom: nextZoom, essential: true, duration: 900 });
        }
      } catch (err: any) {
        log('ERROR', `Fly-to failed: ${err?.message ?? String(err)}`);
      }
      return;
    }
    flyToCoordinates(e.detail.lon, e.detail.lat, label);
  }

  function setViewMode(nextMode: ViewMode) {
    viewMode = nextMode;
    void syncMapsAfterLayoutChange(nextMode);
  }

  function waitForAnimationFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function syncMapsAfterLayoutChange(nextMode: ViewMode) {
    await syncMapsAfterLayoutChangeData({
      nextMode,
      leftMap: map,
      rightMap,
      awaitLayout: async () => {
        await tick();
        await waitForAnimationFrame();
      },
      rehydratePaneMap,
    });
  }

  function toggleSplitMode() {
    setViewMode(viewMode === 'split' ? 'single' : 'split');
  }

  function applyThemeMode(next: ThemeMode) {
    themeMode = next;
    document.documentElement.dataset.theme = next;
  }

  function formatScaleDistance(distanceMeters: number): string {
    if (distanceMeters >= 1000) {
      const km = distanceMeters / 1000;
      return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
    }
    return `${Math.round(distanceMeters)} m`;
  }

  function chooseNiceScaleDistance(maxMeters: number): number {
    if (!Number.isFinite(maxMeters) || maxMeters <= 0) return 0;
    const exponent = Math.floor(Math.log10(maxMeters));
    const base = 10 ** exponent;
    for (const step of [5, 2, 1]) {
      const candidate = step * base;
      if (candidate <= maxMeters) return candidate;
    }
    return base / 2;
  }

	  function updateScaleIndicator(targetMap?: maplibregl.Map | null) {
	    const activeMap = targetMap ?? map ?? rightMap;
	    if (!activeMap) return;
	    const center = activeMap.getCenter();
	    const zoom = activeMap.getZoom();
	    const metersPerPixel = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / (2 ** zoom);
	    const maxMeters = metersPerPixel * SCALE_MAX_WIDTH_PX;
	    const niceDistance = chooseNiceScaleDistance(maxMeters);
	    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0 || niceDistance <= 0) {
	      scaleWidthPx = 0;
	      scaleLabel = '';
	      return;
	    }
	    scaleWidthPx = Math.max(24, Math.min(SCALE_MAX_WIDTH_PX, niceDistance / metersPerPixel));
	    scaleLabel = formatScaleDistance(niceDistance);
	  }

	  const lastLoggedTileZoom: Record<PaneId, number | null> = { left: null, right: null };
	  function logViewLevel(targetMap: maplibregl.Map, pane: PaneId) {
	    if (!import.meta.env.DEV) return;
	    const zoom = targetMap.getZoom();
	    const tileZoom = Math.floor(zoom);
	    if (lastLoggedTileZoom[pane] === tileZoom) return;
	    lastLoggedTileZoom[pane] = tileZoom;
	    const center = targetMap.getCenter();
	    console.log(
	      `[Artemis] pane=${pane} zoom=${zoom.toFixed(2)} tileZ=${tileZoom} (round=${Math.round(zoom)}) center=${center.lng.toFixed(6)},${center.lat.toFixed(6)}`,
	    );
	  }

	  async function rehydratePaneMap(targetMap: maplibregl.Map, paneId: PaneId | 'main') {
	    await clearAllLayerGroups(targetMap, paneId);
	    resetPaneRuntime(paneId);

    if (paneId === 'right') {
      rightIiifHoveredMaps = [];
      setIiifHoverMasks(targetMap, null);
    } else {
      primitiveHoveredFeature = null;
      setPrimitiveHoverFeature(targetMap, null);
      setPrimitiveSelectFeature(targetMap, null);
      iiifHoveredMaps = [];
      setIiifHoverMasks(targetMap, null);
      parcelClickInfo = null;
    }

    const visibleMain = paneId === 'right' ? rightMainLayerVisible : mainLayerEnabled;
    const visibleSubs = paneId === 'right' ? rightSubLayerVisible : subLayerEnabled;

    for (const mainId of mainLayerOrder) {
      for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
        if (!visibleSubs[subId]) continue;
        const subDef = SUB_LAYER_DEFS[subId];
        const opacity = mainLayerOpacity[mainId] ?? 1;
        if (subDef?.kind === 'wmts') {
          const wmtsKey = getMainWmtsKey(mainId);
          if (wmtsKey) {
            setHistCartLayerVisible(targetMap, wmtsKey, true);
            setHistCartLayerOpacity(targetMap, wmtsKey, opacity);
          }
        } else if (subDef?.kind === 'wms') {
          const landUsageKey = getLandUsageKey(mainId);
          if (landUsageKey) {
            setLandUsageLayerVisible(targetMap, landUsageKey, true);
            setLandUsageLayerOpacity(targetMap, landUsageKey, opacity);
          }
        } else if (subDef?.kind === 'geojson' && subId === 'primitief-parcels') {
          setPrimitiveLayerVisible(targetMap, true, primitiveGeojsonUrl());
          setPrimitiveLayerOpacity(targetMap, opacity);
        }
      }
    }

    if (massartItems.length > 0) {
      const year = paneId === 'right' ? rightTimelineYear : massartYear;
      setMassartPins(targetMap, massartItems, year, MASSART_LEEWAY);
    }

    if (paneId === 'right') applyZOrderForPane(targetMap, 'right');
    else applyZOrder();

    for (const mainId of mainLayerOrder) {
      if (!visibleMain[mainId]) continue;
      const hasIiif = (MAIN_LAYER_SUBS[mainId] ?? []).some((subId) => SUB_LAYER_DEFS[subId]?.kind === 'iiif');
      if (!hasIiif) continue;
      if (paneId === 'right') await scheduleRightIiifMainLayerSync(mainId);
      else await scheduleIiifMainLayerSync(mainId);
    }
  }

  async function applyThemeToMap(targetMap: maplibregl.Map, paneId: PaneId | 'main') {
    const changed = setBaseMapTheme(targetMap, themeMode);
    if (!changed) return;
    await new Promise<void>((resolve) => targetMap.once('style.load', () => resolve()));
    await rehydratePaneMap(targetMap, paneId);
  }


  function log(_level: 'INFO' | 'WARN' | 'ERROR', _msg: string) {}

  // ─── Layer state ───────────────────────────────────────────────────────────

  type UILayerInfo = LayerInfo & { uiLayerId: string };
  let layers: UILayerInfo[] = [];

  let mainLayerOrder: MainLayerId[] = [...MAIN_LAYER_ORDER];
  let mainLayerEnabled  = makeInitialMainLayerEnabled();
  let mainLayerLoading: Record<string, boolean> = {};
  let mainLayerOpacity: Record<string, number>  = {
    ngi1904: 1,
    ngi1873: 1,
    gereduceerd: 1,
    popp: 1,
    vandermaelen: 1,
    primitief: 1,
    ferraris: 1,
    villaret: 1,
    frickx: 1,
    handdrawn: 1,
  };
  let subLayerEnabled   = makeInitialSubLayerEnabled();
  let subLayerLoading: Record<string, boolean>  = {};
  const iiifSyncByMain = new Map<string, Promise<void>>();
  const iiifSyncQueuedByMain = new Map<string, boolean>();
  let rightMainLayerVisible = makeInitialMainLayerEnabled();
  let rightMainLayerLoading: Record<string, boolean> = {};
  let rightSubLayerVisible = makeInitialSubLayerEnabled();
  const rightIiifSyncByMain = new Map<string, Promise<void>>();
  const rightIiifSyncQueuedByMain = new Map<string, boolean>();
  $: combinedMainLayerLoading = Object.fromEntries(
    mainLayerOrder.map((mainId) => [mainId, Boolean(mainLayerLoading[mainId] || rightMainLayerLoading[mainId])])
  );

  // Groups that should be parked as soon as their in-flight load completes.
  // Prevents the race where parkLayerGroup is called before runLayerGroup finishes.
  const pendingPark = new Set<string>();

  // Maps groupId → mainId for hover colour lookups
  const groupIdToMainId = new Map<string, string>();

  // ─── Search data (fed into ToponymSearch as props) ─────────────────────────

  let toponymIndex: ToponymIndexItem[] = [];
  let manifestSearchIndex: ManifestSearchItem[] = [];
  let toponymLoading = false;
  let toponymError: string | null = null;

  // ─── IIIF hover / click state ──────────────────────────────────────────────

  let primitiveHoveredFeature: any = null;
  let iiifHoveredMaps: Array<{ mapId: string; warpedMap: any; groupId: string }> = [];
  let rightIiifHoveredMaps: Array<{ mapId: string; warpedMap: any; groupId: string }> = [];
  let parcelClickInfo: ParcelClickInfo | null = null;
  let pinnedCards: PinnedCard[] = [];
  let viewerOpen = false;
  let viewerItem: IiifMapInfo | null = null;
  let viewerHistory: IiifMapInfo[] = [];
  let viewerPane: PaneId = 'right';
  let viewerSpriteRef: SpriteRef | undefined = undefined;
  let viewerPlaceholderWidth = 0;
  let viewerPlaceholderHeight = 0;
  let imageCollectionBubbleItem: PreviewBubbleItem | null = null;
  let imageCollectionBubbleX = 0;
  let imageCollectionBubbleY = 0;
  let imageCollectionBubbleLngLat: { lon: number; lat: number } | null = null;
  let imageCollectionBubblePane: PaneId = 'left';
  let imageCollectionBubblePlaceBelow = false;
  let initialWarmupPending = FEATURE_FLAGS.startupPreloadScreen;
  let initialWarmupRunning = false;
  let initialWarmupDone = 0;
  let initialWarmupTotal = 0;
  let initialWarmupLabel = 'Preparing IIIF layers';
  $: dualPaneEnabled = viewMode !== 'single';
  $: isSplitLayout = viewMode === 'split';
  $: hasViewerPane = viewerOpen && viewerItem !== null;
  $: showSecondaryPane = isSplitLayout || hasViewerPane;
  $: showViewerOnLeft = hasViewerPane && isSplitLayout && viewerPane === 'left';
  $: showViewerOnRight = hasViewerPane && viewerPane === 'right';
  $: showRightMapPane = isSplitLayout;
  $: if (!isSplitLayout && viewerOpen) {
    viewerPane = 'right';
  }

  // ─── Layer helpers ─────────────────────────────────────────────────────────

  function cleanLayerLabel(label: string): string {
    return label.replace(/^\s*artemis\s*[-–—:]\s*/i, '').trim();
  }

  function normalizeLayerLookupKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function deriveIiifMapId(label: string): string | undefined {
    const key = normalizeLayerLookupKey(label);
    if (key === 'primitiefkadaster') return 'PrimitiefKadaster';
    if (key === 'gereduceerdkadaster' || key === 'gereduceerdekadaster') return 'GereduceerdeKadaster';
    if (key === 'handdrawncollection') return 'HanddrawnCollection';
    return undefined;
  }

  function findIiifLayer(labelMatch: string, renderKey: string): UILayerInfo | undefined {
    const normalizedMatch = normalizeLayerLookupKey(labelMatch);
    const requestedMapId = deriveIiifMapId(labelMatch);
    const candidates = layers.filter((l) => l.renderLayerKey === renderKey);
    const match = candidates.find((l) => {
      const candidateMapId = l.map ?? deriveIiifMapId(l.sourceCollectionLabel);
      if (requestedMapId && candidateMapId) return candidateMapId === requestedMapId;
      return normalizeLayerLookupKey(l.sourceCollectionLabel).includes(normalizedMatch);
    });

    return match;
  }

  function getIiifInfoForSub(subId: string): UILayerInfo | undefined {
    let result: UILayerInfo | undefined;
    if (subId === 'PrimitiefKadaster-iiif') result = findIiifLayer('PrimitiefKadaster', 'default');
    else if (subId === 'GereduceerdeKadaster-iiif') result = findIiifLayer('GereduceerdeKadaster', 'default');
    else if (subId === 'HanddrawnCollection-iiif') result = findIiifLayer('HanddrawnCollection', 'default');

    return result;
  }

  function getMainWmtsKey(mainId: string): HistCartLayerKey | undefined {
    if (mainId === 'NGI1904')      return 'ngi1904';
    if (mainId === 'NGI1873')      return 'ngi1873';
    if (mainId === 'Popp')         return 'popp';
    if (mainId === 'Ferraris')     return 'ferraris';
    if (mainId === 'Villaret')     return 'villaret';
    if (mainId === 'Frickx')       return 'frickx';
    if (mainId === 'Vandermaelen') return 'vandermaelen';
    return undefined;
  }

  function getLandUsageKey(mainId: string): 'ferraris' | 'vandermaelen' | undefined {
    if (mainId === 'Ferraris') return 'ferraris';
    if (mainId === 'Vandermaelen') return 'vandermaelen';
    return undefined;
  }

  function colorForGroupId(gid: string): string {
    const mainId = groupIdToMainId.get(gid);
    return MAIN_LAYER_META[mainId ?? '']?.color ?? '#888888';
  }

  function sameViewerItem(a: IiifMapInfo, b: IiifMapInfo): boolean {
    return a.sourceManifestUrl === b.sourceManifestUrl && (a.imageServiceUrl ?? '') === (b.imageServiceUrl ?? '');
  }

  function oppositePane(pane: PaneId): PaneId {
    return pane === 'left' ? 'right' : 'left';
  }

  function openViewer(
    next: IiifMapInfo,
    sourcePane: PaneId = 'left',
    targetPane?: PaneId,
    spriteRef?: SpriteRef,
    placeholderSize?: { width?: number; height?: number }
  ) {
    viewerPane = targetPane ?? (isSplitLayout ? oppositePane(sourcePane) : 'right');
    viewerItem = next;
    viewerSpriteRef = spriteRef ?? next.spriteRef;
    viewerPlaceholderWidth = placeholderSize?.width ?? next.placeholderWidth ?? 0;
    viewerPlaceholderHeight = placeholderSize?.height ?? next.placeholderHeight ?? 0;
    viewerOpen = true;
    viewerHistory = [next, ...viewerHistory.filter((item) => !sameViewerItem(item, next))].slice(0, 10);
  }

  function closeImageCollectionBubble() {
    imageCollectionBubbleItem = null;
    imageCollectionBubbleLngLat = null;
    imageCollectionBubblePane = 'left';
    imageCollectionBubblePlaceBelow = false;
  }

  function syncImageCollectionBubblePosition() {
    const targetMap = imageCollectionBubblePane === 'right' ? rightMap : map;
    if (!targetMap || !imageCollectionBubbleLngLat) return;
    const point = targetMap.project([imageCollectionBubbleLngLat.lon, imageCollectionBubbleLngLat.lat]);
    const canvas = targetMap.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const viewportMargin = 16;
    const offscreen =
      point.x < -viewportMargin ||
      point.y < -viewportMargin ||
      point.x > canvas.clientWidth + viewportMargin ||
      point.y > canvas.clientHeight + viewportMargin;

    if (offscreen) {
      closeImageCollectionBubble();
      return;
    }

    imageCollectionBubbleX = rect.left + point.x;
    imageCollectionBubbleY = rect.top + point.y;
    imageCollectionBubblePlaceBelow = point.y < 260;
  }

  function openImageCollectionBubble(item: PreviewBubbleItem, pane: PaneId = 'left') {
    imageCollectionBubbleItem = item;
    imageCollectionBubblePane = pane;
    imageCollectionBubbleLngLat = item.lon != null && item.lat != null
      ? { lon: item.lon, lat: item.lat }
      : null;
    syncImageCollectionBubblePosition();
  }

  function openPreviewBubbleAt(item: PreviewBubbleItem, lon: number, lat: number, pane: PaneId = 'left') {
    imageCollectionBubbleItem = item;
    imageCollectionBubblePane = pane;
    imageCollectionBubbleLngLat = { lon, lat };
    syncImageCollectionBubblePosition();
  }

  function iiifBubbleItem(info: IiifMapInfo): PreviewBubbleItem {
    return {
      title: info.title,
      manifestUrl: info.sourceManifestUrl,
      imageServiceUrl: info.imageServiceUrl,
      location: info.layerLabel,
      kicker: 'Map Sheet',
      spriteRef: info.spriteRef,
      placeholderWidth: info.placeholderWidth,
      placeholderHeight: info.placeholderHeight,
    };
  }

  function iiifBubbleItems(infos: IiifMapInfo[]): PreviewBubbleItem[] {
    return infos.map((info) => iiifBubbleItem(info));
  }

  function iiifBubbleGroup(infos: IiifMapInfo[]): PreviewBubbleItem | null {
    const items = iiifBubbleItems(infos);
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];
    return { ...items[0], alternatives: items };
  }

  function normalizeSourceLayers(index: CompiledIndex): UILayerInfo[] {
    const baseLayers = index.renderLayers ?? [];
    const nextIiifLayers = Array.isArray((index as any).iiifLayers) ? (index as any).iiifLayers : [];

    if (baseLayers.length === 0 && nextIiifLayers.length > 0) {
      const normalized = nextIiifLayers.map((layer: any) => {
        const sourceCollectionLabel = cleanLayerLabel(
          String(layer.map ?? layer.label ?? layer.sourceCollectionLabel ?? layer.layerId ?? '')
        );
        const normalizedLayer: UILayerInfo = {
          sourceCollectionUrl: String(layer.sourceCollectionUrl ?? ''),
          sourceCollectionLabel,
          compiledCollectionPath: layer.compiledCollectionPath,
          map: layer.map,
          layerId: layer.layerId,
          geomapsPath: (layer as any).geomapsPath,
          spritesPath: layer.spritesPath,
          manifestCount: Number(layer.manifestCount ?? 0),
          georefCount: Number(layer.georefCount ?? 0),
          renderLayerKey: String(layer.renderLayerKey ?? 'default'),
          renderLayerLabel: cleanLayerLabel(String(layer.renderLayerLabel ?? 'Map')),
          hidden: Boolean(layer.hidden),
          uiLayerId: getLayerGroupId({
            sourceCollectionUrl: String(layer.sourceCollectionUrl ?? ''),
            sourceCollectionLabel,
            compiledCollectionPath: layer.compiledCollectionPath,
            map: layer.map,
            layerId: layer.layerId,
            geomapsPath: (layer as any).geomapsPath,
            spritesPath: layer.spritesPath,
            manifestCount: Number(layer.manifestCount ?? 0),
            georefCount: Number(layer.georefCount ?? 0),
            renderLayerKey: String(layer.renderLayerKey ?? 'default'),
            renderLayerLabel: cleanLayerLabel(String(layer.renderLayerLabel ?? 'Map')),
            hidden: Boolean(layer.hidden),
          }),
        };
        return normalizedLayer;
      });

      return normalized;
    }

    if (baseLayers.length === 0) {
      throw new Error('index.json has no renderLayers; viewer requires renderLayers for layer toggles.');
    }
    const normalized = baseLayers.map(layer => {
      const sourceCollectionLabel = cleanLayerLabel(layer.sourceCollectionLabel);
      const map = deriveIiifMapId(sourceCollectionLabel);
      const nextLayer = {
        ...layer,
        sourceCollectionLabel,
        map: map ?? (layer as any).map,
        geomapsPath: map ? `IIIF/${map}_geomaps.json` : (layer as any).geomapsPath,
        spritesPath: map ? `IIIF/${map}/sprites/` : (layer as any).spritesPath,
        compiledCollectionPath: map ? undefined : layer.compiledCollectionPath,
        renderLayerLabel: layer.renderLayerLabel ? cleanLayerLabel(layer.renderLayerLabel) : layer.renderLayerLabel,
      };
      return {
        ...nextLayer,
        uiLayerId: getLayerGroupId(nextLayer),
      };
    });

    return normalized;
  }

  // ─── Z-order + opacity ─────────────────────────────────────────────────────

  function applyZOrder() {
    applyLayerOrderToPane({
      targetMap: map,
      paneId: 'main',
      mainLayerOrder,
      mainLayerSubs: MAIN_LAYER_SUBS,
      subLayerDefs: SUB_LAYER_DEFS,
      getMainWmtsKey,
      getLandUsageKey,
      getLandUsageLayerId,
      getIiifInfoForSub,
      getLayerGroupLayerIds,
      getPrimitiveLayerIds,
    });
  }

  function applyZOrderForPane(targetMap: maplibregl.Map, paneId: PaneId | 'main') {
    applyLayerOrderToPane({
      targetMap,
      paneId,
      mainLayerOrder,
      mainLayerSubs: MAIN_LAYER_SUBS,
      subLayerDefs: SUB_LAYER_DEFS,
      getMainWmtsKey,
      getLandUsageKey,
      getLandUsageLayerId,
      getIiifInfoForSub,
      getLayerGroupLayerIds,
      getPrimitiveLayerIds,
    });
  }

  // ─── Layer toggle operations ───────────────────────────────────────────────

  async function loadIiifLayer(layerInfo: UILayerInfo) {
    await loadIiifLayerIntoPane({
      targetMap: map,
      cfg: cfg(),
      layerInfo,
      log,
      parallelLoading: FEATURE_FLAGS.parallelIiifLoading,
      spriteDebugMode: FEATURE_FLAGS.spriteDebugMode,
    });
  }

  function getIiifMainLayerIds(): string[] {
    return getIiifMainLayerIdsData({
      mainLayerOrder,
      mainLayerSubs: MAIN_LAYER_SUBS,
      subLayerDefs: SUB_LAYER_DEFS,
    });
  }

  async function warmInitialIiifLayers() {
    await warmInitialIiifLayersData({
      startupPreloadScreen: FEATURE_FLAGS.startupPreloadScreen,
      initialWarmupPending,
      initialWarmupRunning,
      mainLayerOrder,
      mainLayerLabels: MAIN_LAYER_LABELS,
      mainLayerSubs: MAIN_LAYER_SUBS,
      subLayerDefs: SUB_LAYER_DEFS,
      getIiifInfoForSub,
      setInitialWarmupState: ({ running, total, done, label, pending }) => {
        if (running != null) initialWarmupRunning = running;
        if (total != null) initialWarmupTotal = total;
        if (done != null) initialWarmupDone = done;
        if (label != null) initialWarmupLabel = label;
        if (pending != null) initialWarmupPending = pending;
      },
      setMainLayerLoading: (mainId, value) => {
        mainLayerLoading = { ...mainLayerLoading, [mainId]: value };
      },
      loadIiifLayer,
      parkLayerGroup: async (groupId) => {
        await parkLayerGroup(map, groupId);
      },
      log,
    });
  }

  function shouldShowIiifGroup(mainId: string, iiifSubId: string): boolean {
    return Boolean(mainLayerEnabled[mainId] && subLayerEnabled[iiifSubId]);
  }

  async function syncIiifMainLayer(mainId: string) {
    const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
    if (!iiifSubId) { log('WARN', `[syncIiif] ${mainId} no iiif sublayer`); return; }
    const info = getIiifInfoForSub(iiifSubId);
    if (!info) { log('WARN', `[syncIiif] ${mainId} getIiifInfoForSub returned undefined (layers.length=${layers.length})`); return; }

    const gid = info.uiLayerId;
    const shouldShow = shouldShowIiifGroup(mainId, iiifSubId);
    const parked = isLayerGroupParked(gid);
    const knownLayerIds = getLayerGroupLayerIds(gid);
    const hasLoadedGroup = knownLayerIds.length > 0;

    if (!shouldShow) {
      if (!parked && hasLoadedGroup) {
        await parkLayerGroup(map, gid);
      }
      applyZOrder();
      return;
    }

    if (hasLoadedGroup && !parked) {
      setLayerGroupOpacity(map, gid, mainLayerOpacity[mainId] ?? 1);
      applyZOrder();
      return;
    }

    mainLayerLoading = { ...mainLayerLoading, [mainId]: true };
    try {
      await loadIiifLayer(info);
      const shouldStillShow = shouldShowIiifGroup(mainId, iiifSubId);
      if (!shouldStillShow) {
        await parkLayerGroup(map, gid);
        applyZOrder();
        return;
      }
      setLayerGroupOpacity(map, gid, mainLayerOpacity[mainId] ?? 1);
      applyZOrder();
    } catch (e: any) {
      log('ERROR', `[syncIiif] ${mainId} load failed: ${e?.message ?? String(e)}`);
    } finally {
      mainLayerLoading = { ...mainLayerLoading, [mainId]: false };
    }
  }

  function scheduleIiifMainLayerSync(mainId: string) {
    return scheduleMainSync({
      mainId,
      queuedByMain: iiifSyncQueuedByMain,
      inFlightByMain: iiifSyncByMain,
      syncMain: syncIiifMainLayer,
    });
  }

  async function loadIiifLayerForRight(layerInfo: UILayerInfo) {
    if (!rightMap) return;
    await loadIiifLayerIntoPane({
      targetMap: rightMap,
      paneId: 'right',
      cfg: cfg(),
      layerInfo,
      log,
      parallelLoading: FEATURE_FLAGS.parallelIiifLoading,
      spriteDebugMode: FEATURE_FLAGS.spriteDebugMode,
    });
  }

  function shouldShowRightIiifGroup(mainId: string, iiifSubId: string): boolean {
    return Boolean(rightMainLayerVisible[mainId] && rightSubLayerVisible[iiifSubId]);
  }

  async function syncRightIiifMainLayer(mainId: string) {
    if (!rightMap) return;
    const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
    if (!iiifSubId) return;
    const info = getIiifInfoForSub(iiifSubId);
    if (!info) return;

    const gid = info.uiLayerId;
    const shouldShow = shouldShowRightIiifGroup(mainId, iiifSubId);
    const parked = isLayerGroupParked(gid, 'right');
    const hasLoadedGroup = getLayerGroupLayerIds(gid, 'right').length > 0;

    if (!shouldShow) {
      if (!parked && hasLoadedGroup) {
        await parkLayerGroup(rightMap, gid, 'right');
      }
      applyZOrderForPane(rightMap, 'right');
      return;
    }

    if (hasLoadedGroup && !parked) {
      setLayerGroupOpacity(rightMap, gid, mainLayerOpacity[mainId] ?? 1, 'right');
      applyZOrderForPane(rightMap, 'right');
      return;
    }

    rightMainLayerLoading = { ...rightMainLayerLoading, [mainId]: true };
    try {
      await loadIiifLayerForRight(info);
      if (!shouldShowRightIiifGroup(mainId, iiifSubId)) {
        await parkLayerGroup(rightMap, gid, 'right');
        applyZOrderForPane(rightMap, 'right');
        return;
      }
      setLayerGroupOpacity(rightMap, gid, mainLayerOpacity[mainId] ?? 1, 'right');
      applyZOrderForPane(rightMap, 'right');
    } finally {
      rightMainLayerLoading = { ...rightMainLayerLoading, [mainId]: false };
    }
  }

  function scheduleRightIiifMainLayerSync(mainId: string) {
    return scheduleMainSync({
      mainId,
      queuedByMain: rightIiifSyncQueuedByMain,
      inFlightByMain: rightIiifSyncByMain,
      syncMain: syncRightIiifMainLayer,
    });
  }

  async function toggleMainLayer(mainId: string, enabled: boolean) {
    await toggleMainLayerState(mainId, enabled, {
      currentEnabled: mainLayerEnabled,
      setEnabled: (next) => {
        mainLayerEnabled = next;
      },
      getMainWmtsKey,
      applyMainPaneOrder: applyZOrder,
      mainLayerSubs: MAIN_LAYER_SUBS,
      subLayerDefs: SUB_LAYER_DEFS,
      scheduleIiifMainLayerSync,
      log,
    });
  }

  async function toggleSubLayer(subId: string, enabled: boolean) {
    await toggleSubLayerState(subId, enabled, {
      currentEnabled: subLayerEnabled,
      setEnabled: (next) => {
        subLayerEnabled = next;
      },
      subLayerDefs: SUB_LAYER_DEFS,
      mainLayerSubs: MAIN_LAYER_SUBS,
      mainLayerOpacity,
      getMainWmtsKey,
      getLandUsageKey,
      setHistCartLayerVisible,
      setHistCartLayerOpacity,
      setLandUsageLayerVisible,
      setLandUsageLayerOpacity,
      setPrimitiveLayerVisible,
      setPrimitiveLayerOpacity,
      primitiveGeojsonUrl,
      getIiifInfoForSub,
      scheduleIiifMainLayerSync,
      applyMainPaneOrder: applyZOrder,
      log,
      layersLength: layers.length,
      targetMap: map,
    });
  }

  // ─── Index + toponym loading ───────────────────────────────────────────────

  async function fetchIndex() {
    resetCompiledIndexCache();
    try {
      const index = await loadCompiledIndex(cfg());
      layers = normalizeSourceLayers(index);
      await loadRuntimeMetadata();
      groupIdToMainId.clear();
      for (const [mainId, subs] of Object.entries(MAIN_LAYER_SUBS)) {
        for (const subId of subs) {
          const info = getIiifInfoForSub(subId);
          if (info) groupIdToMainId.set(info.uiLayerId, mainId);
        }
      }
      manifestSearchIndex = buildManifestSearchIndexData({
        index,
        visibleLayers: layers,
        cleanLayerLabel,
        normalizeSearchText,
        asFiniteNumber,
      });

      await warmInitialIiifLayers();

      // Re-trigger load for any main layers that were marked enabled before the index was
      // ready (e.g. set by Timeslider's onMount firing before layers were populated).
      for (const mainId of mainLayerOrder) {
        if (!mainLayerEnabled[mainId]) continue;
        const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
        if (!iiifSubId) continue; // WMTS layers (ferraris, vandermaelen) don't need this
        const info = getIiifInfoForSub(iiifSubId);
        if (!info) continue;
        mainLayerEnabled = { ...mainLayerEnabled, [mainId]: false };
        await toggleMainLayer(mainId, true);
      }

      if (dualPaneEnabled && rightMap) {
        await syncRightPaneState();
      }

      await loadToponymIndexData({
        buildIndex: index,
        datasetBaseUrl: normalizeDatasetBaseUrl(datasetBaseUrl.trim()),
        normalizeRawToponym,
        log,
        setToponymIndex: (items) => {
          toponymIndex = items;
        },
        setToponymError: (error) => {
          toponymError = error;
        },
        setToponymLoading: (loading) => {
          toponymLoading = loading;
        },
      });
    } catch (e: any) {
      manifestSearchIndex = [];
      log('ERROR', `Index fetch failed: ${e?.message ?? String(e)}`);
    }
  }

  // ─── Map interaction ───────────────────────────────────────────────────────

  function pointInPolygon(point: [number, number], ring: Array<[number, number]>): boolean {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function hitTestAllWarpedMaps(lon: number, lat: number, paneId: PaneId | 'main' = 'main') {
    const hits: Array<{ mapId: string; warpedMap: any; groupId: string }> = [];
    for (const { mapId, warpedMap, groupId } of getAllActiveWarpedMaps(paneId)) {
      const mask: Array<[number, number]> = warpedMap.geoMask ?? [];
      if (mask.length < 3) continue;
      const bbox: [number, number, number, number] | undefined = warpedMap.geoMaskBbox;
      if (bbox && (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3])) continue;
      if (pointInPolygon([lon, lat], mask)) hits.push({ mapId, warpedMap, groupId });
    }
    return hits;
  }

  function parcelHoverDetailsFromFeature(feature: any): { parcelLabel: string; leafId: string } | null {
    const props = feature?.properties ?? {};
    const sourceFileRaw = String(props._source_file ?? '').trim();
    const leafId = sourceFileRaw.replace(/\.geojson$/i, '');
    if (!leafId) return null;
    const parcelNumber = String(props.parcel_number ?? '').trim();
    if (parcelNumber) return { parcelLabel: parcelNumber, leafId };
    const parcelIndex = String(props.parcel_index ?? '').trim();
    if (parcelIndex) return { parcelLabel: `#${parcelIndex}`, leafId };
    return null;
  }

  // ─── Navigation helpers ────────────────────────────────────────────────────

  function flyToCoordinates(lon: number, lat: number, label: string) {
    if (!map || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const fly = () => {
      try {
        const nextZoom = Math.max(map.getZoom(), 14);
        const center = [lon, lat] as [number, number];
        const cur = map.getCenter();
        if (Math.abs(cur.lng - lon) < 1e-9 && Math.abs(cur.lat - lat) < 1e-9 && Math.abs(map.getZoom() - nextZoom) < 0.01) return;
        map.stop();
        map.easeTo({ center, zoom: nextZoom, essential: true, duration: 900 });
      } catch (e: any) { log('ERROR', `Fly-to failed: ${e?.message ?? String(e)}`); }
    };
    if (map.isStyleLoaded()) {
      fly();
    } else {
      const onReady = () => {
        map.off('styledata', onReady);
        map.off('idle', onReady);
        fly();
      };
      map.once('styledata', onReady);
      map.once('idle', onReady);
    }
  }

  function applySearchFocus(focus: SearchFocusState | null) {
    if (!focus) return;
    searchFocusMainId = focus.mainId;
    searchFocusYear = focus.year;
    searchFocusNonce = focus.nonce;
  }

  // ─── ToponymSearch event handlers ─────────────────────────────────────────

  async function onFlyToToponym(item: ToponymIndexItem) {
    flashLocationMarker(map, item.lon, item.lat);
    applySearchFocus(
      await handleToponymSelection(item, searchFocusNonce, {
        mainLayerLabels: MAIN_LAYER_LABELS,
        timelineYearByLayer: MAIN_LAYER_TIMELINE_YEAR,
        currentMassartYear: massartYear,
        setMassartYear: (year) => {
          massartYear = year;
        },
        tick,
        currentMainLayerOrder: mainLayerOrder,
        setMainLayerOrder: (next) => {
          mainLayerOrder = next;
        },
        mainLayerEnabled,
        toggleMainLayer,
        applyZOrder,
        flyToCoordinates,
        openPreviewBubbleAt: (preview, lon, lat) => openPreviewBubbleAt(preview, lon, lat),
      })
    );
  }

  async function onManifestClick(result: ManifestSearchItem) {
    if (result.centerLon != null && result.centerLat != null) {
      flashLocationMarker(map, result.centerLon, result.centerLat);
    }
    applySearchFocus(
      await handleManifestSelection(result, searchFocusNonce, {
        mainLayerLabels: MAIN_LAYER_LABELS,
        timelineYearByLayer: MAIN_LAYER_TIMELINE_YEAR,
        currentMassartYear: massartYear,
        setMassartYear: (year) => {
          massartYear = year;
        },
        tick,
        currentMainLayerOrder: mainLayerOrder,
        setMainLayerOrder: (next) => {
          mainLayerOrder = next;
        },
        mainLayerEnabled,
        toggleMainLayer,
        applyZOrder,
        flyToCoordinates,
        openPreviewBubbleAt: (preview, lon, lat) => openPreviewBubbleAt(preview, lon, lat),
      })
    );
  }

  function pinParcel() {
    if (!parcelClickInfo) return;
    pinnedCards = [...pinnedCards, { type: 'parcel', info: parcelClickInfo }];
    parcelClickInfo = null;
    setPrimitiveSelectFeature(map, null);
  }

  function unpinCard(index: number) { pinnedCards = pinnedCards.filter((_, i) => i !== index); }

  function focusParcel(info: ParcelClickInfo) {
    flyToCoordinates(info.lon, info.lat, `Parcel ${info.parcelLabel}`);
  }

  function buildIiifInfoPanelItems(
    hits: Array<{ mapId: string; warpedMap: any; groupId: string }>,
    paneId: PaneId | 'main' = 'main'
  ): IiifMapInfo[] {
    const items: IiifMapInfo[] = [];
    for (const hit of hits) {
      const info = getManifestInfoForMapId(hit.mapId, paneId);
      if (!info) continue;
      const mainId = groupIdToMainId.get(hit.groupId) ?? '';
      const bbox: [number, number, number, number] | undefined = hit.warpedMap?.geoMaskBbox;
      items.push({
        title: info.label,
        sourceManifestUrl: info.sourceManifestUrl,
        imageServiceUrl: hit.warpedMap?.georeferencedMap?.resource?.id ?? undefined,
        manifestAllmapsUrl: info.manifestAllmapsUrl,
        layerLabel: MAIN_LAYER_LABELS[mainId] ?? '',
        layerColor: colorForGroupId(hit.groupId),
        mainId,
        centerLon: bbox ? (bbox[0] + bbox[2]) / 2 : undefined,
        centerLat: bbox ? (bbox[1] + bbox[3]) / 2 : undefined,
        spriteRef: info.spriteRef,
        placeholderWidth: info.placeholderWidth,
        placeholderHeight: info.placeholderHeight,
      });
    }
    return items;
  }

  // ─── Reactive derivations ──────────────────────────────────────────────────

  $: panelOpen = parcelClickInfo !== null || pinnedCards.length > 0;

  // ─── Timeslider wiring ─────────────────────────────────────────────────────

  async function onTimesliderMainToggle(e: CustomEvent<{ mainId: string; enabled: boolean }>) {
    await toggleMainLayer(e.detail.mainId, e.detail.enabled);
  }

  async function onTimesliderSublayerChange(e: CustomEvent<{ subId: string; enabled: boolean }>) {
    await toggleSubLayer(e.detail.subId, e.detail.enabled);
  }

  async function onTimesliderPaneMainToggle(e: CustomEvent<{ pane: PaneId; mainId: string; enabled: boolean }>) {
    await toggleRightPaneMainLayerState({
      pane: e.detail.pane,
      mainId: e.detail.mainId,
      enabled: e.detail.enabled,
      currentVisible: rightMainLayerVisible,
      setVisible: (next) => {
        rightMainLayerVisible = next;
      },
      rightMap,
      getMainWmtsKey,
      applyRightPaneOrder: () => {
        if (rightMap) applyZOrderForPane(rightMap, 'right');
      },
      mainLayerSubs: MAIN_LAYER_SUBS,
      subLayerDefs: SUB_LAYER_DEFS,
      scheduleRightIiifMainLayerSync,
    });
  }

  async function onTimesliderPaneSublayerChange(e: CustomEvent<{ pane: PaneId; subId: string; enabled: boolean }>) {
    await toggleRightPaneSubLayerState({
      pane: e.detail.pane,
      subId: e.detail.subId,
      enabled: e.detail.enabled,
      currentVisible: rightSubLayerVisible,
      setVisible: (next) => {
        rightSubLayerVisible = next;
      },
      rightMap,
      subLayerDefs: SUB_LAYER_DEFS,
      mainLayerSubs: MAIN_LAYER_SUBS,
      mainLayerOpacity,
      getMainWmtsKey,
      getLandUsageKey,
      setHistCartLayerVisible,
      setHistCartLayerOpacity,
      setLandUsageLayerVisible,
      setLandUsageLayerOpacity,
      setPrimitiveLayerVisible,
      setPrimitiveLayerOpacity,
      primitiveGeojsonUrl,
      applyRightPaneOrder: () => {
        if (rightMap) applyZOrderForPane(rightMap, 'right');
      },
      scheduleRightIiifMainLayerSync,
    });
  }

  function syncCamera(from: PaneId) {
    syncCameraBetweenPanes({
      from,
      dualPaneEnabled,
      leftMap: map,
      rightMap,
      suppressSyncPane,
      setSuppressSyncPane: (pane) => {
        suppressSyncPane = pane;
      },
    });
  }


  function attachRightMassartHandlers(targetMap: maplibregl.Map) {
    for (const layerId of getMassartClickLayerIds()) {
      targetMap.on('click', layerId, (e) => {
        const feat = e.features?.[0];
        if (!feat?.properties) return;
        const { manifestUrl } = feat.properties as { manifestUrl: string };
        const item = massartItems.find(entry => entry.manifestUrl === manifestUrl);
        if (!item) return;
        openImageCollectionBubble({ ...item, spriteRef: massartSpriteRef(item) }, 'right');
      });
      targetMap.on('mouseenter', layerId, () => { targetMap.getCanvas().style.cursor = 'pointer'; });
      targetMap.on('mouseleave', layerId, () => { targetMap.getCanvas().style.cursor = ''; });
    }
  }

  function attachRightIiifHandlers(targetMap: maplibregl.Map) {
    let rightHoverRafId: number | null = null;
    let rightHoverPendingPoint: { x: number; y: number } | null = null;

    const onMouseMove = (e: any) => {
      rightHoverPendingPoint = { x: e.point.x, y: e.point.y };
      if (rightHoverRafId !== null) return;
      rightHoverRafId = requestAnimationFrame(() => {
        rightHoverRafId = null;
        const point = rightHoverPendingPoint;
        if (!point) return;

        const lngLat = targetMap.unproject([point.x, point.y] as [number, number]);
        const hits = hitTestAllWarpedMaps(lngLat.lng, lngLat.lat, 'right');
        const prevIds = rightIiifHoveredMaps.map((h) => h.mapId).join(',');
        const nextIds = hits.map((h) => h.mapId).join(',');
        if (prevIds !== nextIds) {
          rightIiifHoveredMaps = hits;
          setIiifHoverMasks(targetMap, hits.length === 0 ? null : hits.map((h) => {
            const color = colorForGroupId(h.groupId);
            return { ring: h.warpedMap.geoMask, fillColor: color, lineColor: color };
          }));
        }

        targetMap.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : '';
      });
    };

    const onMouseOut = () => {
      rightIiifHoveredMaps = [];
      setIiifHoverMasks(targetMap, null);
      targetMap.getCanvas().style.cursor = '';
    };

    const onClick = () => {
      const items = buildIiifInfoPanelItems(rightIiifHoveredMaps, 'right');
      const anchor = items[0];
      const item = iiifBubbleGroup(items);
      if (!item || !anchor) return;
      const centerLon = anchor.centerLon;
      const centerLat = anchor.centerLat;
      if (centerLon == null || centerLat == null) return;
      openPreviewBubbleAt(item, centerLon, centerLat, 'right');
    };

    targetMap.on('mousemove', onMouseMove);
    targetMap.on('mouseout', onMouseOut);
    targetMap.on('click', onClick);
  }

  async function syncRightPaneState() {
    await syncRightPaneStateData({
      rightMap,
      massartItemsLength: massartItems.length,
      setMassartPinsForRightPane: () => {
        if (rightMap) setMassartPins(rightMap, massartItems, rightTimelineYear, MASSART_LEEWAY);
      },
      rightSubLayerVisible,
      rightMainLayerVisible,
      hasIiifSubLayers: (mainId) =>
        (MAIN_LAYER_SUBS[mainId] ?? []).some((subId) => SUB_LAYER_DEFS[subId]?.kind === 'iiif'),
      onPaneSublayerChange: async (subId, enabled) =>
        onTimesliderPaneSublayerChange(new CustomEvent('paneSublayerChange', {
          detail: { pane: 'right', subId, enabled },
        }) as CustomEvent<{ pane: PaneId; subId: string; enabled: boolean }>),
      onPaneMainToggle: async (mainId, enabled) =>
        onTimesliderPaneMainToggle(new CustomEvent('paneMainToggle', {
          detail: { pane: 'right', mainId, enabled },
        }) as CustomEvent<{ pane: PaneId; mainId: string; enabled: boolean }>),
      applyZOrderForPane,
    });
  }

  async function ensureRightMap() {
    await ensureRightPaneMap({
      isSplitLayout,
      rightMapDiv,
      rightMap,
      rightMapInitInFlight,
      awaitTick: tick,
      createMapContextWithTheme,
      themeMode,
      leftMap: map,
      setRightMapInitInFlight: (value) => {
        rightMapInitInFlight = value;
      },
      setRightMap: (value) => {
        rightMap = value;
      },
      setRightMapReady: (value) => {
        rightMapReady = value;
      },
	      onLoad: async (targetMap) => {
	        updateScaleIndicator(targetMap);
	        logViewLevel(targetMap, 'right');
	        attachRightMassartHandlers(targetMap);
	        attachRightIiifHandlers(targetMap);
	        await syncRightPaneState();
	      },
	      onMove: (targetMap) => {
	        if (imageCollectionBubbleItem) closeImageCollectionBubble();
	        refreshActiveLayerGroups('right');
	        syncCamera('right');
	        updateScaleIndicator(targetMap);
	        logViewLevel(targetMap, 'right');
	      },
	    });
	  }

  function teardownRightMap() {
    teardownRightPaneMap({
      rightMap,
      destroyMapContextInstance,
      resetPaneRuntime,
      setRightMap: (value) => {
        rightMap = value;
      },
      setRightMapReady: (value) => {
        rightMapReady = value;
      },
      setRightMapInitInFlight: (value) => {
        rightMapInitInFlight = value;
      },
      clearRightPaneState: () => {
        rightMainLayerLoading = {};
        rightIiifHoveredMaps = [];
      },
    });
  }

  $: if (isSplitLayout && rightMapDiv && !rightMap) {
    void ensureRightMap();
  }

  $: if (!isSplitLayout && rightMap) {
    teardownRightMap();
  }

  $: if (rightMapReady && rightMap && massartItems.length > 0) {
    setMassartPins(rightMap, massartItems, rightTimelineYear, MASSART_LEEWAY);
  }


  $: if (imageCollectionBubblePane === 'right' && !showRightMapPane) {
    closeImageCollectionBubble();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(() => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      applyThemeMode(storedTheme === 'dark' ? 'dark' : 'light');
    } catch {
      applyThemeMode('light');
    }

	    map = ensureMapContext(mapDiv, themeMode);
	    map.on('load', () => {
	      updateScaleIndicator(map);
	      logViewLevel(map, 'left');
	      // Re-apply WMTS/WMS visibility that may have been set before the style finished loading.
	      // setHistCartLayerVisible / setLandUsageLayerVisible call map.addSource + map.addLayer,
	      // which throw if the style isn't ready. The Timeslider onMount fires before load, so any
      // sublayer toggle that arrived early is silently lost. Re-applying here closes that gap.
      for (const mainId of mainLayerOrder) {
        for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
          if (!subLayerEnabled[subId]) continue;
          const subDef = SUB_LAYER_DEFS[subId];
          const opacity = mainLayerOpacity[mainId] ?? 1;
          if (subDef?.kind === 'wmts') {
            const wmtsKey = getMainWmtsKey(mainId);
            if (wmtsKey) {
              setHistCartLayerVisible(map, wmtsKey, true);
              setHistCartLayerOpacity(map, wmtsKey, opacity);
            }
          } else if (subDef?.kind === 'wms') {
            const landUsageKey = getLandUsageKey(mainId);
            if (landUsageKey) {
              setLandUsageLayerVisible(map, landUsageKey, true);
              setLandUsageLayerOpacity(map, landUsageKey, opacity);
            }
          }
        }
      }
      applyZOrder();

      // Load Massart data then add pins to the map.
      loadMassartData().then(() => {
        if (massartItems.length > 0) {
          setMassartPins(map, massartItems, massartYear, MASSART_LEEWAY);

          // Click on a pin → open an anchored info bubble for that photo.
          for (const layerId of getMassartClickLayerIds()) {
            map.on('click', layerId, (e) => {
              const feat = e.features?.[0];
              if (!feat?.properties) return;
              const { manifestUrl } = feat.properties as { manifestUrl: string };
              const item = massartItems.find(entry => entry.manifestUrl === manifestUrl);
              if (!item) return;
              openImageCollectionBubble({ ...item, spriteRef: massartSpriteRef(item) }, 'left');
            });
            map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
          }
        }
      });
    });

    let hoverRafId: number | null = null;
    let hoverPendingPoint: { x: number; y: number } | null = null;

    const onMouseMove = (e: any) => {
      hoverPendingPoint = { x: e.point.x, y: e.point.y };
      if (hoverRafId !== null) return;
      hoverRafId = requestAnimationFrame(() => {
        hoverRafId = null;
        const point = hoverPendingPoint;
        if (!point) return;

        // Primitive parcel hover
        let parcelHit = false;
        if (subLayerEnabled['primitief-parcels'] && map.getLayer('primitive-parcels-layer')) {
          const pt: [number, number] = [point.x, point.y];
          const feature = map.queryRenderedFeatures(pt, { layers: getPrimitiveLayerIds() })[0];
          const details = parcelHoverDetailsFromFeature(feature);
          if (details) {
            parcelHit = true;
            setPrimitiveHoverFeature(map, feature);
            primitiveHoveredFeature = feature;
          } else {
            primitiveHoveredFeature = null;
            setPrimitiveHoverFeature(map, null);
          }
        } else {
          primitiveHoveredFeature = null;
          setPrimitiveHoverFeature(map, null);
        }

        // IIIF warped map hover
        const lngLat = map.unproject([point.x, point.y] as [number, number]);
        const hits = hitTestAllWarpedMaps(lngLat.lng, lngLat.lat);
        const prevIds = iiifHoveredMaps.map(h => h.mapId).join(',');
        const nextIds = hits.map(h => h.mapId).join(',');
        if (prevIds !== nextIds) {
          iiifHoveredMaps = hits;
          setIiifHoverMasks(map, hits.length === 0 ? null : hits.map(h => {
            const color = colorForGroupId(h.groupId);
            return { ring: h.warpedMap.geoMask, fillColor: color, lineColor: color };
          }));
        }

        map.getCanvas().style.cursor = (parcelHit || hits.length > 0) ? 'pointer' : '';
      });
    };

    const onMouseOut = () => {
      primitiveHoveredFeature = null;
      setPrimitiveHoverFeature(map, null);
      iiifHoveredMaps = [];
      setIiifHoverMasks(map, null);
      map.getCanvas().style.cursor = '';
    };

    const onClick = (e: any) => {
      // Parcel click
      if (primitiveHoveredFeature) {
        const details = parcelHoverDetailsFromFeature(primitiveHoveredFeature);
        if (details) {
          parcelClickInfo = { parcelLabel: details.parcelLabel, leafId: details.leafId, properties: primitiveHoveredFeature.properties ?? {}, lon: e.lngLat.lng, lat: e.lngLat.lat };
          setPrimitiveSelectFeature(map, primitiveHoveredFeature);
        }
      } else {
        parcelClickInfo = null;
        setPrimitiveSelectFeature(map, null);
      }

      // IIIF click
      const items = buildIiifInfoPanelItems(iiifHoveredMaps);
      const anchor = items[0];
      const item = iiifBubbleGroup(items);
      if (!item || !anchor) return;
      const centerLon = anchor.centerLon;
      const centerLat = anchor.centerLat;
      if (centerLon == null || centerLat == null) return;
      openPreviewBubbleAt(item, centerLon, centerLat, 'left');
    };

	    const onMapMove = () => {
	      if (imageCollectionBubbleItem) closeImageCollectionBubble();
	      refreshActiveLayerGroups('main');
	      syncCamera('left');
	      updateScaleIndicator(map);
	      logViewLevel(map, 'left');
	    };

    map.on('mousemove', onMouseMove);
    map.on('mouseout',  onMouseOut);
    map.on('click',     onClick);
    map.on('move',      onMapMove);
    void fetchIndex();

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseout',  onMouseOut);
      map.off('click',     onClick);
      map.off('move',      onMapMove);
    };
  });

  onDestroy(() => {
    teardownRightMap();
    destroyMapContext();
  });

  $: if (map && themeMode) {
    void applyThemeToMap(map, 'main');
  }

  $: if (rightMap && themeMode) {
    void applyThemeToMap(rightMap, 'right');
  }
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && siteInfoOpen) { siteInfoOpen = false; } }} />
<div class="wrap">
  <main class="map-shell">
    <div
      class="map-stage"
      class:is-split={showSecondaryPane}
      class:is-dual-pane={dualPaneEnabled}
      bind:this={mapStageEl}
    >
      <div class="map-pane map-pane--left">
        <div class="map-canvas" bind:this={mapDiv}></div>
        {#if viewerItem && showViewerOnLeft}
          {#key `${viewerPane}::${viewerItem.sourceManifestUrl}::${viewerItem.imageServiceUrl ?? ''}`}
            <IiifViewer
              inline={true}
              mirrored={true}
              imageServiceUrl={viewerItem.imageServiceUrl ?? ''}
              title={viewerItem.title}
              sourceManifestUrl={viewerItem.sourceManifestUrl}
              manifestAllmapsUrl={viewerItem.manifestAllmapsUrl ?? ''}
              historyItems={viewerHistory}
              spriteRef={viewerSpriteRef}
              placeholderWidth={viewerPlaceholderWidth}
              placeholderHeight={viewerPlaceholderHeight}
              on:close={() => { viewerOpen = false; viewerSpriteRef = undefined; viewerPlaceholderWidth = 0; viewerPlaceholderHeight = 0; }}
              on:select-history={(e: CustomEvent<IiifMapInfo>) => openViewer(e.detail, viewerPane, viewerPane)}
            />
          {/key}
        {/if}
      </div>
      {#if showSecondaryPane}
        <div class="map-pane map-pane--right">
          {#if showRightMapPane}
            <div class="map-canvas" bind:this={rightMapDiv}></div>
          {/if}
          {#if viewerItem && showViewerOnRight}
            {#key `${viewerPane}::${viewerItem.sourceManifestUrl}::${viewerItem.imageServiceUrl ?? ''}`}
              <IiifViewer
                inline={true}
                mirrored={false}
                imageServiceUrl={viewerItem.imageServiceUrl ?? ''}
                title={viewerItem.title}
                sourceManifestUrl={viewerItem.sourceManifestUrl}
                manifestAllmapsUrl={viewerItem.manifestAllmapsUrl ?? ''}
                historyItems={viewerHistory}
                spriteRef={viewerSpriteRef}
                placeholderWidth={viewerPlaceholderWidth}
                placeholderHeight={viewerPlaceholderHeight}
                on:close={() => { viewerOpen = false; viewerSpriteRef = undefined; viewerPlaceholderWidth = 0; viewerPlaceholderHeight = 0; }}
                on:select-history={(e: CustomEvent<IiifMapInfo>) => openViewer(e.detail, viewerPane, viewerPane)}
              />
            {/key}
          {/if}
        </div>
      {/if}
      {#if showSecondaryPane}
        <div class="split-divider" aria-hidden="true"></div>
      {/if}
    </div>

    {#if initialWarmupPending || initialWarmupRunning}
      <div class="startup-overlay" role="status" aria-live="polite">
        <div class="startup-card">
          <div class="startup-loader" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="startup-title">Preparing Maps</div>
        </div>
      </div>
    {/if}

    <ToponymSearch
      toponymIndex={toponymIndex}
      manifestSearchIndex={manifestSearchIndex}
      loading={toponymLoading}
      error={toponymError}
      on:fly-to-toponym={(e) => onFlyToToponym(e.detail)}
      on:manifest-click={(e) => onManifestClick(e.detail)}
    />

    {#if panelOpen}
      <InfoCards
        {pinnedCards}
        iiifPanelGroups={[]}
        {parcelClickInfo}
        on:unpin={(e) => unpinCard(e.detail)}
        on:close-parcel={() => { parcelClickInfo = null; setPrimitiveSelectFeature(map, null); }}
        on:pin-parcel={() => pinParcel()}
        on:focus-parcel={(e) => focusParcel(e.detail)}
      />
    {/if}
    <div class="timeslider-wrap">
      <div class="timeslider-toolbar">
        <div class="timeslider-toolbar-left">
          <button
            class="compare-toggle"
            class:is-active={isSplitLayout}
            type="button"
            aria-pressed={isSplitLayout}
            on:click={toggleSplitMode}
          >{isSplitLayout ? 'Exit Compare' : 'Compare'}</button>
          <button
            class="compare-toggle site-info-toggle"
            type="button"
            aria-label="Open site information"
            title="Open site information"
            aria-haspopup="dialog"
            aria-expanded={siteInfoOpen}
            on:click={() => (siteInfoOpen = !siteInfoOpen)}
          >
            About
          </button>
        </div>
        {#if scaleLabel}
          <div class="map-scale" aria-label={`Map scale indicator: ${scaleLabel} in the real world`}>
            <span class="map-scale-label">{scaleLabel}</span>
            <div class="map-scale-bar" style={`width:${scaleWidthPx}px;`}></div>
          </div>
        {/if}
      </div>
      <Timeslider
        {massartItems}
        {layerMetadataByMainId}
        dualPaneEnabled={dualPaneEnabled}
        disabledPane={hasViewerPane && isSplitLayout ? viewerPane : null}
        leftYear={massartYear}
        rightYear={rightTimelineYear}
        {searchFocusMainId}
        {searchFocusYear}
        {searchFocusNonce}
        yearLeeway={MASSART_LEEWAY}
        loadingLayers={combinedMainLayerLoading}
        on:mainToggle={onTimesliderMainToggle}
        on:sublayerChange={onTimesliderSublayerChange}
        on:paneMainToggle={onTimesliderPaneMainToggle}
        on:paneSublayerChange={onTimesliderPaneSublayerChange}
        on:year-change={onMassartYearChange}
        on:focus-image={onTimelineImageFocus}
        on:open-viewer={(e) => openViewer({ title: e.detail.title, sourceManifestUrl: e.detail.sourceManifestUrl, imageServiceUrl: e.detail.imageServiceUrl }, 'left')}
      />
    </div>

    {#if siteInfoOpen}
      <div
        class="site-info-backdrop"
        role="button"
        tabindex="0"
        aria-label="Close site information"
        on:click={(event) => {
          if (event.target === event.currentTarget) siteInfoOpen = false;
        }}
        on:keydown={(event) => {
          if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            siteInfoOpen = false;
          }
        }}
      >
        <div
          class="site-info-modal ui-panel-overlay"
          role="dialog"
          tabindex="-1"
          aria-modal="true"
          aria-label={siteMetadata.title}
        >
          <div class="site-info-head">
            <div>
              <div class="ui-label">Site Info</div>
              <h2>{siteMetadata.title}</h2>
            </div>
            <button class="ui-btn site-info-close" type="button" on:click={() => (siteInfoOpen = false)}>Close</button>
          </div>
          <div class="site-info-body">
            {#each siteMetadata.info as paragraph}
              <p>{paragraph}</p>
            {/each}
            {#if siteMetadata.team.length > 0}
              <div class="site-info-section">
                <div class="ui-label">Team</div>
                <div class="site-info-team">
                  {#each siteMetadata.team as institution}
                    <div class="site-info-team-institution-group">
                      <div class="site-info-team-institution">{institution.institution}</div>
                      <div class="site-info-team-units">
                        {#each institution.units as unit}
                          <div class="site-info-team-unit-group">
                            {#if unit.unit}
                              <div class="site-info-team-unit">{unit.unit}</div>
                            {/if}
                            {#if unit.members.length > 0}
                              <ul class="site-info-team-members">
                                {#each unit.members as member}
                                  <li>{member}</li>
                                {/each}
                              </ul>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            {#if siteMetadata.logos.length > 0}
              <div class="site-info-section">
                <div class="ui-label">Partners</div>
                <div class="site-info-logos">
                  {#each siteMetadata.logos as logo}
                    {#if logo.href}
                      <a href={logo.href} target="_blank" rel="noreferrer" title={logo.label}>
                        <img src={logo.src} alt={logo.alt} loading="lazy" />
                      </a>
                    {:else}
                      <img src={logo.src} alt={logo.alt} title={logo.label} loading="lazy" />
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
            {#if siteMetadata.attribution}
              <div class="site-info-section">
                <div class="ui-label">Attribution</div>
                <p>{siteMetadata.attribution}</p>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if imageCollectionBubbleItem}
      <ImageCollectionBubble
        item={imageCollectionBubbleItem}
        x={imageCollectionBubbleX}
        y={imageCollectionBubbleY}
        placeBelow={imageCollectionBubblePlaceBelow}
        on:close={closeImageCollectionBubble}
        on:open-viewer={(e) => {
          openViewer({
            title: e.detail.title,
            sourceManifestUrl: e.detail.sourceManifestUrl,
            imageServiceUrl: e.detail.imageServiceUrl
          }, imageCollectionBubblePane, undefined, e.detail.spriteRef, {
            width: e.detail.placeholderWidth,
            height: e.detail.placeholderHeight,
          });
          closeImageCollectionBubble();
        }}
      />
    {/if}
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    height: 100%;
    font-family: var(--font-ui);
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
  }

  .wrap {
    height: 100dvh;
    overflow: hidden;
  }

  .map-shell {
    position: relative;
    width: 100vw;
    height: 100dvh;
  }

  .map-stage {
    width: 100%;
    height: 100%;
    display: block;
    position: relative;
  }

  .map-stage.is-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0;
  }

  .map-pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  .map-pane--left,
  .map-pane--right {
    box-shadow: none;
  }

  .map-stage.is-split .map-pane--left,
  .map-stage.is-split .map-pane--right {
    position: relative;
    inset: auto;
    height: 100%;
    clip-path: none;
  }

  .map-stage.is-split .map-pane--left::after,
  .map-stage.is-split .map-pane--right::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 18px;
    pointer-events: none;
    z-index: 3;
  }

  .map-stage.is-split .map-pane--left::after {
    right: 0;
    background: linear-gradient(90deg, transparent 0%, var(--split-pane-edge-shadow) 100%);
  }

  .map-stage.is-split .map-pane--right::before {
    left: 0;
    background: linear-gradient(90deg, var(--split-pane-edge-shadow) 0%, transparent 100%);
  }

  .split-divider {
    position: absolute;
    top: 10px;
    bottom: 10px;
    left: 50%;
    width: 10px;
    transform: translateX(-50%);
    border-radius: 999px;
    pointer-events: none;
    z-index: 4;
    background:
      linear-gradient(90deg, var(--split-divider-shine-edge) 0%, var(--split-divider-shine) 50%, var(--split-divider-shine-edge) 100%),
      linear-gradient(180deg, var(--split-divider-core-edge) 0%, var(--split-divider-core) 50%, var(--split-divider-core-edge) 100%);
    box-shadow:
      0 0 0 1px var(--split-divider-outline),
      0 0 20px var(--split-divider-shadow);
  }


  .map-canvas {
    width: 100%;
    height: 100%;
  }

  .startup-overlay {
    position: absolute;
    inset: 0;
    z-index: 90;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--startup-overlay-bg);
    backdrop-filter: blur(4px);
  }

  .startup-card {
    width: min(280px, calc(100vw - 32px));
    padding: 24px 24px 22px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--startup-card-border);
    background: var(--startup-card-bg);
    box-shadow: var(--shadow-card);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .startup-loader {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 18px;
  }

  .startup-loader span {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--startup-loader-fill);
    animation: startup-bounce 0.9s ease-in-out infinite;
  }

  .startup-loader span:nth-child(2) { animation-delay: 0.12s; }
  .startup-loader span:nth-child(3) { animation-delay: 0.24s; }

  .startup-title {
    font-size: 24px;
    line-height: 1.05;
    font-weight: 700;
    color: var(--startup-title-color);
    text-align: center;
  }

  @keyframes startup-bounce {
    0%, 80%, 100% {
      transform: translateY(0);
      opacity: 0.5;
    }
    40% {
      transform: translateY(-5px);
      opacity: 1;
    }
  }

  .timeslider-wrap {
    position: absolute;
    bottom: 12px;
    left: 12px;
    right: 12px;
    z-index: 4;
    pointer-events: none;
  }

  .timeslider-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    pointer-events: none;
  }

  .timeslider-toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .map-scale {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    min-width: 0;
    pointer-events: none;
    user-select: none;
  }

  .map-scale-label {
    padding: 4px 8px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface-floating) 90%, transparent);
    border: 1px solid var(--surface-outline-soft);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
    box-shadow: var(--shadow-sm);
    white-space: nowrap;
  }

  .map-scale-bar {
    position: relative;
    height: 8px;
    border-bottom: 2px solid var(--text-secondary);
  }

  .map-scale-bar::before,
  .map-scale-bar::after {
    content: '';
    position: absolute;
    bottom: -2px;
    width: 2px;
    height: 8px;
    background: var(--text-secondary);
  }

  .map-scale-bar::before { left: 0; }
  .map-scale-bar::after { right: 0; }

  .compare-toggle {
    padding: 11px 18px;
    border: 1px solid var(--surface-outline-soft);
    border-radius: var(--radius-xs);
    background: var(--toolbar-button-bg);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.01em;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
    pointer-events: auto;
  }

  .compare-toggle:hover {
    transform: translateY(-1px);
    background: var(--toolbar-button-hover-bg);
  }

  .compare-toggle.is-active {
    background: var(--toolbar-button-active-bg);
    border-color: var(--toolbar-button-active-border);
    color: var(--toolbar-button-active-text);
  }

  .site-info-toggle {
    min-width: 92px;
    justify-content: center;
  }

  .site-info-toggle[aria-expanded='true'] {
    background: var(--toolbar-button-active-bg);
    border-color: var(--toolbar-button-active-border);
    color: var(--toolbar-button-active-text);
  }

  .site-info-backdrop {
    position: absolute;
    inset: 0;
    z-index: 110;
    background: rgba(17, 15, 11, 0.26);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 88px 20px 20px;
  }

  .site-info-modal {
    width: min(920px, calc(100vw - 40px));
    max-height: min(84vh, 900px);
    overflow: auto;
    padding: 22px 24px 20px;
    color: var(--text-primary);
    /* Override ui-panel-overlay dark overlay bg with the warm panel surface */
    background: var(--surface-floating);
    backdrop-filter: blur(6px);
    border-color: var(--surface-outline-soft);
    box-shadow: 0 8px 32px rgba(40, 30, 10, 0.14), 0 2px 6px rgba(40, 30, 10, 0.08);
  }

  .site-info-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--border-ui) 82%, transparent);
  }

  .site-info-head h2 {
    margin: 6px 0 0;
    font-size: clamp(24px, 2vw, 30px);
    line-height: 1.08;
    letter-spacing: -0.02em;
    font-weight: 700;
  }

  .site-info-close {
    flex: 0 0 auto;
  }

  .site-info-body {
    font-family: var(--font-ui);
  }

  .site-info-body p {
    margin: 0 0 14px;
    max-width: 64ch;
    font-size: 14px;
    line-height: 1.68;
    color: color-mix(in srgb, var(--text-primary) 94%, white 6%);
  }

  .site-info-section {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid color-mix(in srgb, var(--border-ui) 76%, transparent);
  }


  .site-info-logos {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 12px;
    align-items: center;
  }

  .site-info-logos a,
  .site-info-logos img {
    border-radius: var(--radius-xs);
  }

  .site-info-logos a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--border-ui) 74%, transparent);
    background: color-mix(in srgb, var(--overlay-bg) 86%, black 14%);
    transition: transform 150ms ease, border-color 150ms ease, background 150ms ease;
  }

  .site-info-logos a:hover {
    transform: translateY(-1px);
    border-color: var(--border-ui);
    background: color-mix(in srgb, var(--overlay-bg) 92%, black 8%);
  }

  .site-info-logos img {
    display: block;
    max-height: 52px;
    max-width: 140px;
    object-fit: contain;
  }

  .site-info-team {
    display: grid;
    gap: 18px;
  }

  .site-info-team-institution-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .site-info-team-institution {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.01em;
    color: var(--text-primary);
  }

  .site-info-team-units {
    display: grid;
    gap: 10px;
    padding-left: 8px;
    border-left: 2px solid color-mix(in srgb, var(--border-ui) 40%, transparent);
  }

  .site-info-team-unit-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .site-info-team-unit {
    font-size: 12px;
    color: color-mix(in srgb, var(--text-primary) 78%, white 22%);
    font-weight: 500;
    margin: 0;
  }

  .site-info-team-members {
    margin: 0;
    padding-left: 14px;
    list-style: none;
    display: grid;
    gap: 2px;
  }

  .site-info-team-members li {
    font-size: 12px;
    line-height: 1.35;
    color: color-mix(in srgb, var(--text-primary) 85%, white 15%);
  }

  @media (max-width: 700px) {
    .site-info-modal {
      width: min(100vw - 24px, 920px);
      max-height: min(88vh, 900px);
      padding: 18px 18px 16px;
    }

    .site-info-head {
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 12px;
    }

    .site-info-head h2 {
      font-size: 22px;
    }
  }

  @media (max-width: 700px) {
    .timeslider-toolbar {
      gap: 8px;
    }

    .map-scale-label {
      font-size: 10px;
      padding: 4px 7px;
    }
  }


</style>
