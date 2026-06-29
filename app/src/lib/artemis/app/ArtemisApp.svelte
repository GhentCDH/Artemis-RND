<!-- src/routes/+page.svelte — map shell + orchestration -->
<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/theme.css';
  import '$lib/ui.css';
  import { onDestroy, onMount, tick } from 'svelte';
  import type maplibregl from 'maplibre-gl';

  import {
    ensureMapContext, destroyMapContext, createMapContext, destroyMapContextInstance,
    setBaselayer,
    setHistCartLayerVisible, setHistCartLayerOpacity,
    setLandUsageLayerVisible, setLandUsageLayerOpacity, getLandUsageLayerId,
    setPrimitiveLayerVisible, isPrimitiveLayerVisible,
    setPrimitiveLayerOpacity, getPrimitiveLayerIds,
    setPrimitiveHoverFeature, setPrimitiveSelectFeature,
    setIiifHoverMasks,
    setMassartPins, getMassartClickLayerIds,
    flashLocationMarker,
  } from '$lib/artemis/map/mapInit';
  import {
    loadCompiledIndex, runLayerGroup, removeLayerGroup, parkLayerGroup, clearAllLayerGroups,
    isLayerGroupParked, setLayerGroupOpacity, getLayerGroupLayerIds,
    resetCompiledIndexCache, resetPaneRuntime, getLayerGroupId, refreshActiveLayerGroups,
    getAllActiveWarpedMaps, getManifestInfoForMapId,
    type LayerInfo, type CompiledIndex, type CompiledRunnerConfig,
  } from '$lib/artemis/iiif/layerController';
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
  import { resolveIiifGeomapsPath } from '$lib/artemis/config/iiifGeomaps';
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
  import MapInfoWindow from '$lib/components/MapInfoWindow.svelte';
  import BrandingPanel from '$lib/components/BrandingPanel.svelte';
  import ImagesInViewPanel from '$lib/components/ImagesInViewPanel.svelte';
  import Window from '$lib/artemis/ui/primitives/Window.svelte';
  import Button from '$lib/artemis/ui/primitives/Button.svelte';
  import type { CollectionInfo } from '$lib/components/timeslider/types';

  // ─── Map ───────────────────────────────────────────────────────────────────

  type PaneId = 'left' | 'right';
  type ViewMode = 'single' | 'split';
  let mapDiv: HTMLElement;
  let map: maplibregl.Map;
  let mapStageEl: HTMLElement;
  let rightMapDiv: HTMLElement;
  let rightMap: maplibregl.Map | null = null;
  let rightMapReady = false;
  let rightMapInitInFlight = false;
  let suppressSyncPane: PaneId | null = null;
  let viewMode: ViewMode = 'single';
  let scaleWidthPx = 0;
  let scaleLabel = '';
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
  let searchModalOpen = false;
  let activeCollection: CollectionInfo | null = null;
  let rightActiveCollection: CollectionInfo | null = null;
  let clearLeftCollectionNonce = 0;
  let clearRightCollectionNonce = 0;
  let mapInfoWindowOpen = false;
  let rightMapInfoWindowOpen = false;
  let baselayersMenuOpen = false;
  let selectedBaselayer = 'scheldt';
  let customBaselayers: Array<{ id: string; label: string; tileUrl: string }> = [];
  let customBaselayerFormOpen = false;
  let customBaselayerUrl = '';
  let customBaselayerLabel = '';
  let customBaselayerChecking = false;
  let customBaselayerCheckPassed = false;
  let customBaselayerCheckError = '';
  let customBaselayerResolvedTileUrl = '';

  function resolveWmtsTileUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl);
    const layer = parsed.searchParams.get('layers') ?? parsed.searchParams.get('layer') ?? '';
    const base = `${parsed.origin}${parsed.pathname}`;
    return `${base}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${encodeURIComponent(layer)}&STYLE=&FORMAT=image/png` +
      `&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  }

  function isWmtsUrl(url: string): boolean {
    return /wmts/i.test(url);
  }

  async function addCustomBaselayer() {
    customBaselayerChecking = true;
    customBaselayerCheckPassed = false;
    customBaselayerCheckError = '';
    customBaselayerResolvedTileUrl = '';
    try {
      const url = customBaselayerUrl.trim();
      if (!url) throw new Error('URL is required');
      if (!customBaselayerLabel.trim()) throw new Error('Label is required');

      let tileUrl: string;
      if (isWmtsUrl(url)) {
        tileUrl = resolveWmtsTileUrl(url);
      } else if (url.includes('{z}') && url.includes('{x}') && url.includes('{y}')) {
        tileUrl = url;
      } else {
        throw new Error('Provide a WMTS URL (e.g. …/wmts?layers=…) or an XYZ tile URL with {z}/{x}/{y}');
      }

      const testUrl = tileUrl.replace('{z}', '10').replace('{y}', '341').replace('{x}', '526');
      const res = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`Tile request returned ${res.status}`);

      const id = `custom-${Date.now()}`;
      customBaselayers = [...customBaselayers, { id, label: customBaselayerLabel.trim(), tileUrl }];
      switchBaselayer(id, tileUrl);
      customBaselayerFormOpen = false;
    } catch (e: any) {
      customBaselayerCheckError = e?.message ?? 'Failed';
    } finally {
      customBaselayerChecking = false;
    }
  }

  function openCustomBaselayerForm() {
    baselayersMenuOpen = false;
    customBaselayerUrl = '';
    customBaselayerLabel = '';
    customBaselayerCheckPassed = false;
    customBaselayerCheckError = '';
    customBaselayerResolvedTileUrl = '';
    customBaselayerFormOpen = true;
  }

  // Search button cycling text with terminal effect
  const SEARCH_PROMPTS = ['Search Maps', 'Search Places', 'Search Manifest'];
  let currentPromptIndex = 1;
  let displayText = 'Search Places';
  let isRemoving = false;
  let promptCycleTimer: ReturnType<typeof setTimeout> | null = null;
  let charRemovalTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Config ────────────────────────────────────────────────────────────────

  const DEFAULT_BASE_URL = 'https://ghentcdh.github.io/Artemis-RnD-Data/build';
  const FEATURE_FLAGS: { parallelIiifLoading: boolean; spriteDebugMode: boolean } = {
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
	    const compiledTail = iiifLayer?.compiledCollectionPath?.split('/').filter(Boolean).pop() ?? '';
	    const iiifMap = typeof (iiifLayer as any)?.map === 'string' ? String((iiifLayer as any).map).trim() : '';
	    const geomapsStem = (iiifLayer as any)?.geomapsPath
	      ?.split('/')
	      .filter(Boolean)
	      .pop()
	      ?.replace(/_geomaps\.json$/i, '') ?? '';
	    return [...new Set([compiledTail, iiifMap, geomapsStem, mainId].filter(Boolean))];
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

  const MASSART_LEEWAY = 3; // years each side of the active collection that count as "near"
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
  let massartYear = Math.round((1700 + 1855) / 2);
  let rightTimelineYear = MASSART_YEAR_MAX;
  let massartSpriteRects: Record<string, { x: number; y: number; width: number; height: number }> = {};
  let massartSpriteSheetUrl = '';
  let massartSpriteSheetSize: [number, number] = [0, 0];
  let imagesInView: Array<MassartItem & { spriteRef?: any }> = [];
  let imagesInViewPanelOpen = false;
  let closeImagesPanel = false;

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

  function computeImagesInView() {
    if (!map || massartItems.length === 0) { imagesInView = []; return; }
    const bounds = map.getBounds();
    const w = bounds.getWest(), e = bounds.getEast();
    const s = bounds.getSouth(), n = bounds.getNorth();
    const inBounds = massartItems.filter(
      item => item.lat != null && item.lon != null &&
              item.lat >= s && item.lat <= n &&
              item.lon >= w && item.lon <= e
    );
    inBounds.sort((a, b) => {
      const ya = parseInt(a.year ?? '9999');
      const yb = parseInt(b.year ?? '9999');
      return ya - yb;
    });
    imagesInView = inBounds.map(item => ({
      ...item,
      spriteRef: massartSpriteRef(item),
    }));
  }

  function setMassartPinsVisible(visible: boolean) {
    if (!map) return;
    const visibility = visible ? 'visible' : 'none';
    if (map.getLayer('massart-pins-inactive')) {
      map.setLayoutProperty('massart-pins-inactive', 'visibility', visibility);
    }
    if (map.getLayer('massart-pins-active')) {
      map.setLayoutProperty('massart-pins-active', 'visibility', visibility);
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

  function switchBaselayer(layerId: string, customTileUrl?: string) {
    mainLayerEnabled = makeInitialMainLayerEnabled();
    subLayerEnabled = makeInitialSubLayerEnabled();
    activeCollection = null;
    rightActiveCollection = null;
    clearLeftCollectionNonce += 1;
    clearRightCollectionNonce += 1;
    selectedBaselayer = layerId;

    const id = (layerId === 'scheldt' || layerId === 'osm') ? layerId : 'custom';
    setBaselayer(map, id, () => { void rehydratePaneMap(map, 'main'); }, customTileUrl);
    if (rightMap) {
      setBaselayer(rightMap, id, () => { void rehydratePaneMap(rightMap!, 'right'); }, customTileUrl);
    }
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

  function log(_level: 'INFO' | 'WARN' | 'ERROR', _msg: string) {}

  // Screenshot functionality
  function captureScreenshot() {
    if (!map) return;

    function isCanvasReadable(canvas: HTMLCanvasElement): boolean {
      try { canvas.toDataURL(); return true; } catch { return false; }
    }

    function drawCanvasAtScreenPos(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, stageRect: DOMRect, dpr: number) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((rect.left - stageRect.left) * dpr);
      const y = Math.round((rect.top  - stageRect.top)  * dpr);
      ctx.drawImage(canvas, x, y, canvas.width, canvas.height);
    }

    function doCapture() {
      const stageRect = mapStageEl!.getBoundingClientRect();

      // Derive true DPR from map canvas vs its container CSS size
      const mapCanvas = map.getCanvas();
      const mapContainer = mapDiv as HTMLElement;
      const dpr = mapContainer.clientWidth > 0 ? mapCanvas.width / mapContainer.clientWidth : (window.devicePixelRatio || 1);

      // Export canvas covers the full stage at physical resolution
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width  = Math.round(stageRect.width  * dpr);
      exportCanvas.height = Math.round(stageRect.height * dpr);
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) return;

      // Draw all map canvases at their actual screen positions
      const mapCanvases = Array.from(mapStageEl!.querySelectorAll<HTMLCanvasElement>('.map-canvas canvas'));
      for (const c of mapCanvases) {
        drawCanvasAtScreenPos(ctx, c, stageRect, dpr);
      }

      // Composite all OSD viewer canvases on top at their actual screen positions
      if (hasViewerPane) {
        const osdCanvases = Array.from(mapStageEl!.querySelectorAll<HTMLCanvasElement>('.viewer-body canvas'));
        for (const c of osdCanvases) {
          if (!isCanvasReadable(c)) continue;
          const rect = c.getBoundingClientRect();
          const x = Math.round((rect.left - stageRect.left) * dpr);
          const y = Math.round((rect.top  - stageRect.top)  * dpr);
          // Fill with --window-background from theme.css before compositing transparent OSD canvas
          ctx.fillStyle = '#f8f5ed';
          ctx.fillRect(x, y, c.width, c.height);
          drawCanvasAtScreenPos(ctx, c, stageRect, dpr);
        }
      }

      exportCanvas.toBlob((blob) => { if (blob) downloadBlob(blob); }, 'image/png');
    }

    // Capture during render frame before WebGL clears the buffer
    if (isSplitLayout && rightMap) {
      // Trigger repaint on both, capture once both have rendered
      let leftDone = false;
      let rightDone = false;
      const tryCapture = () => { if (leftDone && rightDone) doCapture(); };
      map.once('render', () => { leftDone = true; tryCapture(); });
      rightMap.once('render', () => { rightDone = true; tryCapture(); });
      map.triggerRepaint();
      rightMap.triggerRepaint();
    } else {
      map.once('render', doCapture);
      map.triggerRepaint();
    }
  }

  function buildScreenshotFilename(): string {
    const center = map.getCenter();
    const lat = center.lat.toFixed(4);
    const lon = center.lng.toFixed(4);

    const activeLabels = mainLayerOrder
      .filter(id => mainLayerEnabled[id])
      .map(id => MAIN_LAYER_LABELS[id] ?? id)
      .join('+')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_+\-]/g, '');

    const layerPart = activeLabels || 'no-layers';

    if (hasViewerPane && viewerItem?.title) {
      const manifestLabel = viewerItem.title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
      return `Artemis_${lat}N_${lon}E_${layerPart}_${manifestLabel}.png`;
    }

    return `Artemis_${lat}N_${lon}E_${layerPart}.png`;
  }

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildScreenshotFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

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

  function normalizeSourceLayers(index: CompiledIndex): UILayerInfo[] {
    const baseLayers = index.renderLayers ?? [];
    const nextIiifLayers = Array.isArray((index as any).iiifLayers) ? (index as any).iiifLayers : [];

	    if (baseLayers.length === 0 && nextIiifLayers.length > 0) {
	      const normalized = nextIiifLayers.map((layer: any) => {
	        const sourceCollectionLabel = cleanLayerLabel(
	          String(layer.map ?? layer.label ?? layer.sourceCollectionLabel ?? '')
	        );
          const layerMapId = String(layer.map ?? deriveIiifMapId(sourceCollectionLabel) ?? '').trim() || undefined;
	        const normalizedLayer: UILayerInfo = {
	          sourceCollectionUrl: String(layer.sourceCollectionUrl ?? ''),
	          sourceCollectionLabel,
	          compiledCollectionPath: layer.compiledCollectionPath,
	          map: layerMapId ?? layer.map,
	          geomapsPath: resolveIiifGeomapsPath(layerMapId, (layer as any).geomapsPath),
	          spritesPath: layer.spritesPath,
	          renderLayerKey: String(layer.renderLayerKey ?? 'default'),
	          renderLayerLabel: cleanLayerLabel(String(layer.renderLayerLabel ?? 'Map')),
	          hidden: Boolean(layer.hidden),
	          uiLayerId: getLayerGroupId({
	            sourceCollectionUrl: String(layer.sourceCollectionUrl ?? ''),
	            sourceCollectionLabel,
	            compiledCollectionPath: layer.compiledCollectionPath,
	            map: layerMapId ?? layer.map,
	            geomapsPath: resolveIiifGeomapsPath(layerMapId, (layer as any).geomapsPath),
	            spritesPath: layer.spritesPath,
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
        geomapsPath: map
          ? resolveIiifGeomapsPath(map, undefined)
          : resolveIiifGeomapsPath((layer as any).map, (layer as any).geomapsPath),
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

  function onMassartClick(item: MassartItem) {
    if (item.lat != null && item.lon != null) {
      flashLocationMarker(map, item.lon, item.lat);
      flyToCoordinates(item.lon, item.lat, `Photo "${item.title ?? 'Untitled'}"`);
    }
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

  function openFirstIiifHitInViewer(
    hits: Array<{ mapId: string; warpedMap: any; groupId: string }>,
    sourcePane: PaneId,
    paneId: PaneId | 'main' = 'main'
  ) {
    const [item] = buildIiifInfoPanelItems(hits, paneId);
    if (!item) return;
    openViewer(item, sourcePane, 'right');
    closeImageCollectionBubble();
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

  // ─── MapInfoWindow wiring ──────────────────────────────────────────────────

  $: mapInfoWindowOpen = activeCollection !== null;
  $: rightMapInfoWindowOpen = dualPaneEnabled && rightActiveCollection !== null;
  $: anyLayerLoading = Object.values(combinedMainLayerLoading).some(Boolean);

  function onMapInfoWindowClose(pane: PaneId = 'left') {
    if (pane === 'right') {
      rightActiveCollection = null;
      clearRightCollectionNonce += 1;
      return;
    }
    activeCollection = null;
    clearLeftCollectionNonce += 1;
  }

  async function onMapInfoWindowSublayerToggle(
    e: CustomEvent<{ sublayerId: string; enabled: boolean }>,
    pane: PaneId = 'left'
  ) {
    if (pane === 'right') {
      await onTimesliderPaneSublayerChange(new CustomEvent('paneSublayerChange', {
        detail: { pane: 'right', subId: e.detail.sublayerId, enabled: e.detail.enabled },
      }) as CustomEvent<{ pane: PaneId; subId: string; enabled: boolean }>);
      return;
    }
    await toggleSubLayer(e.detail.sublayerId, e.detail.enabled);
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
      openFirstIiifHitInViewer(rightIiifHoveredMaps, 'right', 'right');
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
      createMapContext,
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

  $: if (viewerOpen && map && massartItems.length > 0) {
    setMassartPinsVisible(true);
  }

  // ─── Search prompt cycling with terminal effect ────────────────────────

  function startCharacterRemoval() {
    isRemoving = true;
    function removeChar() {
      if (displayText.length > 0) {
        displayText = displayText.slice(0, -1);
        charRemovalTimer = setTimeout(removeChar, 50);
      } else {
        isRemoving = false;
        currentPromptIndex = (currentPromptIndex + 1) % SEARCH_PROMPTS.length;
        scheduleNextPrompt();
      }
    }
    removeChar();
  }

  function scheduleNextPrompt() {
    if (charRemovalTimer) clearTimeout(charRemovalTimer);
    const currentPrompt = SEARCH_PROMPTS[currentPromptIndex];
    let charIndex = 0;

    function addChar() {
      if (charIndex < currentPrompt.length) {
        displayText = currentPrompt.slice(0, charIndex + 1);
        charIndex++;
        charRemovalTimer = setTimeout(addChar, 100);
      } else {
        charRemovalTimer = setTimeout(startCharacterRemoval, 2000);
      }
    }

    addChar();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(() => {
    // Start search prompt cycling after 5 seconds
    promptCycleTimer = setTimeout(() => {
      scheduleNextPrompt();
    }, 5000);

    // Close baselayers menu when clicking outside
    const handleDocumentClick = (e: MouseEvent) => {
      const baselayersWrapper = document.querySelector('.baselayers-menu-wrapper');
      if (baselayersWrapper && !baselayersWrapper.contains(e.target as Node)) {
        baselayersMenuOpen = false;
      }
    };
    document.addEventListener('click', handleDocumentClick);

	    map = ensureMapContext(mapDiv);
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
          computeImagesInView();

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
      openFirstIiifHitInViewer(iiifHoveredMaps, 'left');
    };

	    const onMapMove = () => {
	      if (imageCollectionBubbleItem) closeImageCollectionBubble();
	      refreshActiveLayerGroups('main');
	      syncCamera('left');
	      updateScaleIndicator(map);
	      logViewLevel(map, 'left');
	      computeImagesInView();
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
      if (promptCycleTimer) clearTimeout(promptCycleTimer);
      if (charRemovalTimer) clearTimeout(charRemovalTimer);
      document.removeEventListener('click', handleDocumentClick);
    };
  });

  onDestroy(() => {
    teardownRightMap();
    destroyMapContext();
  });

</script>

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

    <ToponymSearch
      bind:isModalOpen={searchModalOpen}
      toponymIndex={toponymIndex}
      manifestSearchIndex={manifestSearchIndex}
      massartIndex={massartItems}
      activeMapIds={new Set([
        ...Object.entries(mainLayerEnabled).filter(([_, enabled]) => enabled).map(([id]) => id),
        ...Object.entries(rightMainLayerVisible).filter(([_, enabled]) => enabled).map(([id]) => id),
      ])}
      loading={toponymLoading}
      error={toponymError}
      on:fly-to-toponym={(e) => onFlyToToponym(e.detail)}
      on:manifest-click={(e) => onManifestClick(e.detail)}
      on:massart-click={(e) => onMassartClick(e.detail)}
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
            class="search-toggle"
            type="button"
            aria-label="Open search"
            on:click={() => { searchModalOpen = true; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            {#if displayText}
              <span class="search-prompt">{displayText}</span>
            {/if}
          </button>
          {#if anyLayerLoading}
            <span class="toolbar-loading-ring" aria-label="Loading map layer" role="status"></span>
          {/if}
        </div>
        <div class="timeslider-toolbar-right">
          {#if scaleLabel}
            <div class="map-scale" aria-label={`Map scale indicator: ${scaleLabel} in the real world`}>
              <span class="map-scale-label">{scaleLabel}</span>
              <div class="map-scale-bar" style={`width:${scaleWidthPx}px;`}></div>
            </div>
          {/if}
          <div class="baselayers-menu-wrapper">
            <button
              class="baselayers-toggle"
              type="button"
              title="Select base layer"
              aria-label="Select base layer"
              aria-expanded={baselayersMenuOpen}
              on:click={() => (baselayersMenuOpen = !baselayersMenuOpen)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12h2m2 0h2m2 0h2m2 0h2m2 0h2" />
                <path d="M3 7h18M3 17h18" />
              </svg>
            </button>
            {#if baselayersMenuOpen}
              <div class="baselayers-menu">
                <div class="baselayers-window">
                  <div class="baselayers-content">
                    <div class="baselayer-section">
                      <Button
                        class="baselayer-option"
                        variant="chrome"
                        active={selectedBaselayer === 'scheldt'}
                        on:click={() => { switchBaselayer('scheldt'); baselayersMenuOpen = false; }}
                      >
                        Scheldt Gemapt
                      </Button>
                      <Button
                        class="baselayer-option"
                        variant="chrome"
                        active={selectedBaselayer === 'osm'}
                        on:click={() => { switchBaselayer('osm'); baselayersMenuOpen = false; }}
                      >
                        OpenStreetMap
                      </Button>
                      {#each customBaselayers as custom (custom.id)}
                        <Button
                          class="baselayer-option"
                          variant="chrome"
                          active={selectedBaselayer === custom.id}
                          on:click={() => { switchBaselayer(custom.id, custom.tileUrl); baselayersMenuOpen = false; }}
                        >
                          {custom.label}
                        </Button>
                      {/each}
                    </div>
                    <div class="baselayer-separator"></div>
                    <div class="baselayer-section">
                      <Button
                        class="baselayer-add-button"
                        variant="chrome"
                        title="Add custom base layer"
                        aria-label="Add custom base layer"
                        on:click={openCustomBaselayerForm}
                      >
                        Add Custom
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
          <button
            class="screenshot-toggle"
            type="button"
            title="Screenshot without UI"
            aria-label="Screenshot without UI"
            on:click={captureScreenshot}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </button>
        </div>
      </div>
      <Timeslider
        {massartItems}
        {layerMetadataByMainId}
        dualPaneEnabled={dualPaneEnabled}
        {searchFocusMainId}
        {searchFocusNonce}
        yearLeeway={MASSART_LEEWAY}
        loadingLayers={combinedMainLayerLoading}
        {clearLeftCollectionNonce}
        {clearRightCollectionNonce}
        bind:activeCollection
        bind:rightActiveCollection
        on:mainToggle={onTimesliderMainToggle}
        on:sublayerChange={onTimesliderSublayerChange}
        on:paneMainToggle={onTimesliderPaneMainToggle}
        on:paneSublayerChange={onTimesliderPaneSublayerChange}
        on:focus-image={onTimelineImageFocus}
        on:open-viewer={(e) => openViewer({ title: e.detail.title, sourceManifestUrl: e.detail.sourceManifestUrl, imageServiceUrl: e.detail.imageServiceUrl }, 'left')}
      />
    </div>

    <MapInfoWindow
      isOpen={mapInfoWindowOpen}
      pane="left"
      collectionKey={activeCollection?.key ?? null}
      collectionName={activeCollection?.name ?? ''}
      collectionColor={activeCollection?.color ?? ''}
      collectionDate={activeCollection?.dateRange ?? ''}
      collectionInfo={activeCollection?.info ?? ''}
      sublayers={activeCollection?.sublayers ?? []}
      on:close={() => onMapInfoWindowClose('left')}
      on:sublayer-toggle={(e) => onMapInfoWindowSublayerToggle(e, 'left')}
    />

    <MapInfoWindow
      isOpen={rightMapInfoWindowOpen}
      pane="right"
      collectionKey={rightActiveCollection?.key ?? null}
      collectionName={rightActiveCollection?.name ?? ''}
      collectionColor={rightActiveCollection?.color ?? ''}
      collectionDate={rightActiveCollection?.dateRange ?? ''}
      collectionInfo={rightActiveCollection?.info ?? ''}
      sublayers={rightActiveCollection?.sublayers ?? []}
      on:close={() => onMapInfoWindowClose('right')}
      on:sublayer-toggle={(e) => onMapInfoWindowSublayerToggle(e, 'right')}
    />

    <BrandingPanel {siteMetadata} />

    {#if !viewerOpen}
      <ImagesInViewPanel
        items={imagesInView}
        forceClose={closeImagesPanel}
        on:click={(e) => {
          const item = e.detail;
          openViewer({
            title: item.title,
            sourceManifestUrl: item.manifestUrl,
            imageServiceUrl: item.imageServiceUrl,
            layerLabel: '',
            centerLon: item.lon,
            centerLat: item.lat,
            spriteRef: item.spriteRef,
          }, 'left');
        }}
        on:open={() => {
          imagesInViewPanelOpen = true;
          setMassartPinsVisible(true);
        }}
        on:close={() => {
          imagesInViewPanelOpen = false;
          setMassartPinsVisible(false);
        }}
      />
    {:else}
      <div style="display: contents;">
        <!-- Pins stay active when viewer is open -->
        {#if map && massartItems.length > 0}
          <!-- Silently maintain pin visibility -->
        {/if}
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
          closeImagesPanel = true;
          // Reset the signal after a tick so the panel can process it
          void Promise.resolve().then(() => {
            closeImagesPanel = false;
          });
        }}
      />
    {/if}

    {#if customBaselayerFormOpen}
      <div class="custom-baselayer-backdrop" on:click|self={() => { customBaselayerFormOpen = false; }} role="presentation"></div>
      <div class="custom-baselayer-modal">
        <Window variant="floating" showClose={true} title="Add Custom Base Layer" on:close={() => { customBaselayerFormOpen = false; }}>
          <div class="custom-baselayer-form">
            <div class="custom-baselayer-field">
              <label class="custom-baselayer-label" for="custom-url">URL</label>
              <input
                id="custom-url"
                class="custom-baselayer-input"
                type="text"
                placeholder={"WMTS: https://…/wmts?layers=… or XYZ: https://…/{z}/{x}/{y}.png"}
                bind:value={customBaselayerUrl}
                on:input={() => { customBaselayerCheckPassed = false; customBaselayerCheckError = ''; customBaselayerResolvedTileUrl = ''; }}
              />
            </div>
            <div class="custom-baselayer-field">
              <label class="custom-baselayer-label" for="custom-label">Label</label>
              <input
                id="custom-label"
                class="custom-baselayer-input"
                type="text"
                placeholder="My Base Layer"
                bind:value={customBaselayerLabel}
              />
            </div>
            {#if customBaselayerCheckError}
              <p class="custom-baselayer-error">{customBaselayerCheckError}</p>
            {/if}
            <div class="custom-baselayer-actions">
              <Button
                variant="primary"
                disabled={customBaselayerChecking || !customBaselayerUrl.trim() || !customBaselayerLabel.trim()}
                on:click={addCustomBaselayer}
              >
                {customBaselayerChecking ? 'Checking…' : 'Add'}
              </Button>
            </div>
          </div>
        </Window>
      </div>
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
    width: var(--split-pane-edge-shadow-width);
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
    width: var(--split-divider-width);
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 4;
    background: var(--split-divider-color);
  }


  .map-canvas {
    width: 100%;
    height: 100%;
  }

  .timeslider-wrap {
    position: absolute;
    bottom: 14px;
    left: 0;
    right: 0;
    z-index: 4;
    pointer-events: none;
  }

  .timeslider-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    padding: 0 12px;
    pointer-events: none;
  }

  .timeslider-toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .timeslider-toolbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .toolbar-loading-ring {
    width: 30px;
    height: 30px;
    box-sizing: border-box;
    border: 3px solid rgba(47, 128, 237, 0.2);
    border-top-color: #2f80ed;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--window-background) 78%, transparent);
    box-shadow: var(--control-shadow);
    pointer-events: none;
    animation: toolbar-loading-spin 850ms linear infinite;
  }

  @keyframes toolbar-loading-spin {
    to {
      transform: rotate(360deg);
    }
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
    background: color-mix(in srgb, var(--window-background) 90%, transparent);
    border: 1px solid var(--window-border);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.02em;
    box-shadow: var(--control-shadow);
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
    border: 1px solid var(--window-border);
    border-radius: var(--radius-xs);
    background: var(--button-background);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.01em;
    box-shadow: var(--control-shadow);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
    pointer-events: auto;
  }

  .compare-toggle:hover {
    transform: translateY(-1px);
    background: var(--button-background-hover);
  }

  .compare-toggle.is-active {
    background: var(--button-active-background);
    border-color: var(--button-active-background);
    color: var(--button-primary-text);
  }

  .search-toggle {
    padding: 11px 18px;
    min-width: 170px;
    border: 1px solid var(--window-border);
    border-radius: var(--radius-xs);
    background: var(--button-background);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.01em;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: var(--control-shadow);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
    pointer-events: auto;
  }

  .search-toggle:hover {
    transform: translateY(-1px);
    background: var(--button-background-hover);
  }

  .search-toggle svg {
    flex-shrink: 0;
  }

  .search-prompt {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.01em;
    color: var(--text-primary);
  }

  .screenshot-toggle {
    width: 40px;
    height: 40px;
    border: 1px solid var(--window-border);
    border-radius: var(--radius-xs);
    background: var(--button-background);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--control-shadow);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
    pointer-events: auto;
  }

  .screenshot-toggle:hover {
    transform: translateY(-1px);
    background: var(--button-background-hover);
  }

  .screenshot-toggle svg {
    width: 16px;
    height: 16px;
  }

  .baselayers-menu-wrapper {
    position: relative;
  }

  .baselayers-toggle {
    width: 40px;
    height: 40px;
    border: 1px solid var(--window-border);
    border-radius: var(--radius-xs);
    background: var(--button-background);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--control-shadow);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
    pointer-events: auto;
  }

  .baselayers-toggle:hover {
    transform: translateY(-1px);
    background: var(--button-background-hover);
  }

  .baselayers-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 100;
    pointer-events: auto;
  }

  .baselayers-window {
    background: var(--window-background);
    border: 1px solid var(--window-border);
    border-radius: var(--radius-md);
    box-shadow: var(--window-shadow);
    min-width: 180px;
    overflow: hidden;
  }

  .baselayers-content {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 6px;
  }

  .baselayer-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  :global(.baselayers-window .artemis-button) {
    width: 100%;
    justify-content: flex-start;
    border-radius: var(--radius-xs);
    font-size: 13px;
    padding: 10px 14px;
    min-height: 38px;
  }

  :global(.baselayers-window .baselayer-add-button) {
    justify-content: center;
    font-size: 16px;
  }

  .baselayer-separator {
    height: 1px;
    background: var(--window-border);
    margin: 4px 0;
  }

  :global(.baselayers-window .baselayer-add-button) {
    justify-content: flex-start;
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }

  :global(.baselayers-window .baselayer-add-button:hover:not(:disabled)) {
    color: var(--text-secondary);
  }

  .custom-baselayer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
    backdrop-filter: blur(4px);
    background: rgba(0, 0, 0, 0.15);
  }

  .custom-baselayer-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 200;
    width: min(420px, calc(100vw - 32px));
  }

  .custom-baselayer-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }

  .custom-baselayer-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .custom-baselayer-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .custom-baselayer-input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 12px;
    border: 1px solid var(--window-border);
    border-radius: var(--radius-xs);
    background: var(--button-background);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: 13px;
    outline: none;
    transition: border-color 150ms ease;
  }

  .custom-baselayer-input:focus {
    border-color: var(--button-primary-background);
  }

  .custom-baselayer-error {
    margin: 0;
    font-size: 12px;
    color: var(--text-error, #c0392b);
  }

  .custom-baselayer-success {
    margin: 0;
    font-size: 12px;
    color: var(--button-primary-background);
  }

  .custom-baselayer-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
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
