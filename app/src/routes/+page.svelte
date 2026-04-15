<!-- src/routes/+page.svelte — map shell + orchestration -->
<script lang="ts">
  import { dev } from '$app/environment';
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
  } from '$lib/artemis/map/mapInit';
  import { attachAllmapsDebugEvents } from '$lib/artemis/debug/attachAllmapsDebugEvents';
  import {
    loadCompiledIndex, runLayerGroup, removeLayerGroup, parkLayerGroup, clearAllLayerGroups,
    isLayerGroupParked, setLayerGroupOpacity, getLayerGroupLayerIds,
    resetCompiledIndexCache, resetPaneRuntime, getIiifCacheStats, getLayerGroupId, refreshActiveLayerGroups,
    getAllActiveWarpedMaps, getManifestInfoForMapId,
    type LayerInfo, type CompiledIndex, type CompiledRunnerConfig, type LayerRenderStats,
  } from '$lib/artemis/runner';
  import { startBulkRun, endBulkRun, resetBulkMetrics, ingestRunResult } from '$lib/artemis/metrics';
  import { normalizeSearchText } from '$lib/artemis/search';
  import { normalizeRawToponym } from '$lib/artemis/toponyms';
  import { asFiniteNumber } from '$lib/artemis/utils';
  import {
    MAIN_LAYER_ORDER, MAIN_LAYER_META, MAIN_LAYER_LABELS, MAIN_LAYER_INFO,
    MAIN_LAYER_SUBS, SUB_LAYER_DEFS,
    makeInitialMainLayerEnabled, makeInitialSubLayerEnabled,
    type MainLayerId,
  } from '$lib/artemis/layerConfig';
  import type { HistCartLayerKey } from '$lib/artemis/map/mapInit';
  import type {
    ToponymIndexItem, RawToponymIndexItem, ManifestSearchItem,
    IiifMapInfo, ParcelClickInfo, PinnedCard, UILog, MassartItem, PreviewBubbleItem,
  } from '$lib/artemis/types';

  import ToponymSearch from '$lib/artemis/ui/ToponymSearch.svelte';
  import InfoCards from '$lib/artemis/ui/InfoCards.svelte';
  import DebugMenu from '$lib/artemis/ui/DebugMenu.svelte';
  import ImageCollectionBubble from '$lib/artemis/ui/ImageCollectionBubble.svelte';
  import IiifViewer from '$lib/artemis/viewer/IiifViewer.svelte';
  import Timeslider from '$lib/components/Timeslider.svelte';

  // ─── Map ───────────────────────────────────────────────────────────────────

  type PaneId = 'left' | 'right';
  type ViewMode = 'single' | 'split';
  type ThemeMode = 'light' | 'dark';
  type RuntimeSiteLogo = {
    src: string;
    alt: string;
    href: string | null;
    label: string;
  };
  type RuntimeTeamUnit = {
    unit: string;
    members: string[];
  };
  type RuntimeTeamInstitution = {
    institution: string;
    units: RuntimeTeamUnit[];
  };
  type RuntimeSiteMetadata = {
    title: string;
    info: string[];
    attribution: string;
    team: RuntimeTeamInstitution[];
    logos: RuntimeSiteLogo[];
  };
  type RuntimeLayerMetadata = {
    title: string;
    info: string[];
  };
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

  const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/dev/build';
  const FEATURE_FLAGS: { startupPreloadScreen: boolean; debugMenu: boolean } = {
    // Flip to false to bypass the startup preload/loading-screen concept.
    startupPreloadScreen: false,
    // Internal-only debug surface. Flip to true when needed locally.
    debugMenu: false,
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

  async function fetchRuntimeJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
      throw new Error(`Expected JSON but got HTML from ${url}`);
    }
    return JSON.parse(text) as T;
  }

  function normalizeParagraphList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }

  function normalizeTeamGroups(value: unknown): RuntimeTeamInstitution[] {
    if (!Array.isArray(value)) return [];
    const byInstitution: Record<string, RuntimeTeamUnit[]> = {};

    value.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const institution = typeof (entry as any).institution === 'string' ? (entry as any).institution.trim() : '';
      const unit = typeof (entry as any).unit === 'string' ? (entry as any).unit.trim() : '';
      const members = Array.isArray((entry as any).members)
        ? (entry as any).members
            .map((m: unknown) => (typeof m === 'string' ? m.trim() : ''))
            .filter(Boolean)
        : [];

      if (!institution || (!unit && members.length === 0)) return;
      if (!byInstitution[institution]) byInstitution[institution] = [];
      byInstitution[institution].push({ unit, members });
    });

    return Object.entries(byInstitution).map(([institution, units]) => ({
      institution,
      units,
    }));
  }

  function normalizeSiteLogos(value: unknown, repoRoot: string): RuntimeSiteLogo[] {
    if (!Array.isArray(value)) return [];
    function resolveSrc(raw: string): string {
      if (!raw) return raw;
      // Already absolute
      if (/^https?:\/\//i.test(raw)) return raw;
      // Relative path from site.json — resolve against repo root
      if (repoRoot) return `${repoRoot}/${raw.replace(/^\//, '')}`;
      return raw;
    }
    return value.flatMap((entry) => {
      if (typeof entry === 'string') {
        const src = resolveSrc(entry.trim());
        return src ? [{ src, alt: '', href: null, label: src }] : [];
      }
      if (!entry || typeof entry !== 'object') return [];
      const rawSrc = typeof (entry as any).src === 'string' ? (entry as any).src.trim() : '';
      if (!rawSrc) return [];
      const src = resolveSrc(rawSrc);
      const alt = typeof (entry as any).alt === 'string' ? (entry as any).alt.trim() : '';
      const hrefRaw = typeof (entry as any).href === 'string' ? (entry as any).href.trim() : '';
      const label =
        (typeof (entry as any).label === 'string' && (entry as any).label.trim()) ||
        (typeof (entry as any).name === 'string' && (entry as any).name.trim()) ||
        alt ||
        rawSrc;
      return [{ src, alt, href: hrefRaw || null, label }];
    });
  }

  function normalizeSiteMetadata(raw: unknown, repoRoot = ''): RuntimeSiteMetadata {
    const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'About Artemis',
      info: normalizeParagraphList(data.info),
      attribution: typeof data.attribution === 'string' ? data.attribution.trim() : '',
      team: normalizeTeamGroups(data.team),
      logos: normalizeSiteLogos(data.logos, repoRoot),
    };
  }

  function normalizeLayerMetadataMap(raw: unknown): Record<string, RuntimeLayerMetadata> {
    const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return Object.fromEntries(
      Object.entries(data).flatMap(([key, value]) => {
        if (!value || typeof value !== 'object') return [];
        const title = typeof (value as any).title === 'string' && (value as any).title.trim()
          ? (value as any).title.trim()
          : key;
        const info = normalizeParagraphList((value as any).info);
        return [[key, { title, info }]];
      })
    );
  }

  function layerMetadataCandidates(mainId: string): string[] {
    const subIds = MAIN_LAYER_SUBS[mainId] ?? [];
    const iiifSubId = subIds.find((subId) => SUB_LAYER_DEFS[subId]?.kind === 'iiif');
    const iiifLayer = iiifSubId ? getIiifInfoForSub(iiifSubId) : undefined;
    const explicitLayerId = typeof (iiifLayer as any)?.layerId === 'string'
      ? String((iiifLayer as any).layerId).trim()
      : '';
    const compiledTail = iiifLayer?.compiledCollectionPath?.split('/').filter(Boolean).pop() ?? '';
    return [...new Set([explicitLayerId, compiledTail, mainId].filter(Boolean))];
  }

  function fallbackLayerMetadata(mainId: string): RuntimeLayerMetadata {
    return {
      title: MAIN_LAYER_LABELS[mainId] ?? mainId,
      info: MAIN_LAYER_INFO[mainId] ? [MAIN_LAYER_INFO[mainId]] : [],
    };
  }

  function resolveLayerMetadataByMainId(rawByKey: Record<string, RuntimeLayerMetadata>): Record<string, RuntimeLayerMetadata> {
    if (dev) console.log(`[runtime-metadata] resolveLayerMetadataByMainId called with rawByKey keys: ${Object.keys(rawByKey).join(', ')}`);

    return Object.fromEntries(
      mainLayerOrder.map((mainId) => {
        const candidates = layerMetadataCandidates(mainId);
        if (dev) console.log(`[runtime-metadata] mainId="${mainId}" candidates: [${candidates.join(', ')}]`);

        const resolved = candidates.map((key) => rawByKey[key]).find(Boolean);

        if (dev) {
          if (resolved) {
            const foundKey = candidates.find((key) => rawByKey[key]);
            console.log(`[runtime-metadata] mainId="${mainId}" resolved with key="${foundKey}"`);
          } else {
            console.warn(`[runtime-metadata] mainId="${mainId}" FAILED to resolve - missing layer metadata key(s)=${candidates.join(', ')} label="${MAIN_LAYER_LABELS[mainId] ?? mainId}". Available keys in rawByKey: [${Object.keys(rawByKey).join(', ')}]`);
          }
        }

        return [mainId, resolved ?? fallbackLayerMetadata(mainId)];
      })
    );
  }

  async function loadRuntimeMetadata() {
    const staticBaseUrl = runtimeStaticBaseUrl();
    if (dev) console.log(`[runtime-metadata] constructed staticBaseUrl="${staticBaseUrl}"`);

    if (!staticBaseUrl) {
      if (dev) console.warn(`[runtime-metadata] staticBaseUrl is empty, using fallback metadata`);
      siteMetadata = normalizeSiteMetadata(null);
      layerMetadataByMainId = resolveLayerMetadataByMainId({});
      return;
    }

    const siteJsonUrl = `${staticBaseUrl}/site.json`;
    const layersJsonUrl = `${staticBaseUrl}/layers.json?t=${Date.now()}`;
    if (dev) {
      console.log(`[runtime-metadata] fetching site.json from "${siteJsonUrl}"`);
      console.log(`[runtime-metadata] fetching layers.json from "${layersJsonUrl}"`);
    }

    const [siteResult, layerResult] = await Promise.allSettled([
      fetchRuntimeJson<unknown>(siteJsonUrl),
      fetchRuntimeJson<unknown>(layersJsonUrl),
    ]);

    const repoRoot = staticBaseUrl.replace(/\/static\/?$/i, '');
    if (siteResult.status === 'fulfilled') {
      if (dev) console.log(`[runtime-metadata] site.json fetch succeeded`);
      siteMetadata = normalizeSiteMetadata(siteResult.value, repoRoot);
    } else {
      if (dev) console.warn(`[runtime-metadata] site.json unavailable: ${siteResult.reason?.message ?? String(siteResult.reason)}`);
      siteMetadata = normalizeSiteMetadata(null);
    }

    const rawLayers = layerResult.status === 'fulfilled' ? normalizeLayerMetadataMap(layerResult.value) : {};
    if (layerResult.status === 'fulfilled') {
      if (dev) {
        console.log(`[runtime-metadata] layers.json fetch succeeded`);
        console.log(`[runtime-metadata] raw layers.json keys: ${Object.keys(layerResult.value as Record<string, unknown>).join(', ')}`);
        console.log(`[runtime-metadata] normalized rawLayers keys: ${Object.keys(rawLayers).join(', ')}`);
      }
    } else {
      if (dev) console.warn(`[runtime-metadata] layers.json unavailable: ${layerResult.reason?.message ?? String(layerResult.reason)}`);
    }
    layerMetadataByMainId = resolveLayerMetadataByMainId(rawLayers);
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

  async function loadMassartData() {
    try {
      const url = `${cfg().datasetBaseUrl}/Image collections/Massart/index.json`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      massartItems = Array.isArray(data.items) ? data.items : [];
    } catch { /* degrade silently — pins won't appear */ }
  }

  function onMassartYearChange(e: CustomEvent<{ year: number; pane?: 'left' | 'right' }>) {
    const pane = e.detail.pane ?? 'left';
    if (dev) console.log(`[timeline-debug] onMassartYearChange — ${pane} pane scrubber moved to year=${e.detail.year}`);
    if (pane === 'right') {
      const prevYear = rightTimelineYear;
      rightTimelineYear = e.detail.year;
      if (dev) console.log(`[timeline-debug] onMassartYearChange(right) — ${prevYear} → ${rightTimelineYear}, mapReady=${rightMap?.isStyleLoaded()}`);
      if (rightMap?.isStyleLoaded()) {
        if (dev) console.log(`[timeline-debug] onMassartYearChange(right) — calling updateMassartActiveYear(rightMap, ${rightTimelineYear}, ${MASSART_LEEWAY})`);
        updateMassartActiveYear(rightMap, rightTimelineYear, MASSART_LEEWAY);
      }
      return;
    }
    const prevYear = massartYear;
    massartYear = e.detail.year;
    if (dev) console.log(`[timeline-debug] onMassartYearChange(left) — ${prevYear} → ${massartYear}, mapReady=${map?.isStyleLoaded()}`);
    if (map?.isStyleLoaded()) {
      if (dev) console.log(`[timeline-debug] onMassartYearChange(left) — calling updateMassartActiveYear(map, ${massartYear}, ${MASSART_LEEWAY})`);
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
    await tick();
    await waitForAnimationFrame();

    try { map?.resize(); } catch { /* ignore */ }
    try { rightMap?.resize(); } catch { /* ignore */ }

    await waitForAnimationFrame();

    try { map?.resize(); } catch { /* ignore */ }
    try { rightMap?.resize(); } catch { /* ignore */ }

    if (map?.isStyleLoaded()) {
      await rehydratePaneMap(map, 'main');
    }

    if (nextMode === 'split' && rightMap?.isStyleLoaded()) {
      await rehydratePaneMap(rightMap, 'right');
    }
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


  // ─── Logging ───────────────────────────────────────────────────────────────

  let logs: UILog[] = [];
  const MAX_LOGS = 2000;

  function log(level: UILog['level'], msg: string) {
    if (!FEATURE_FLAGS.debugMenu) return;
    logs = [{ atISO: new Date().toISOString(), level, msg }, ...logs].slice(0, MAX_LOGS);
  }

  // ─── Layer state ───────────────────────────────────────────────────────────

  type UILayerInfo = LayerInfo & { uiLayerId: string };
  let layers: UILayerInfo[] = [];
  let layerProgress: Record<string, { done: number; total: number }> = {};
  let layerRenderStats: Record<string, LayerRenderStats> = {};
  let indexError: string | null = null;
  let indexLoading = false;

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
  let rightMainLayerVisible = makeInitialMainLayerEnabled();
  let rightMainLayerLoading: Record<string, boolean> = {};
  let rightSubLayerVisible = makeInitialSubLayerEnabled();
  const rightIiifSyncByMain = new Map<string, Promise<void>>();
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

  function findIiifLayer(labelMatch: string, renderKey: string): UILayerInfo | undefined {
    return layers.find(l =>
      l.sourceCollectionLabel.toLowerCase().includes(labelMatch.toLowerCase()) &&
      l.renderLayerKey === renderKey
    );
  }

  function getIiifInfoForSub(subId: string): UILayerInfo | undefined {
    if (subId === 'PrimitiefKadaster-iiif')  return findIiifLayer('PrimitiefKadaster',  'default');
    if (subId === 'GereduceerdeKadaster-iiif') return findIiifLayer('GereduceerdeKadaster', 'default');
    if (subId === 'HanddrawnCollection-iiif')   return findIiifLayer('HanddrawnCollection',   'default');
    return undefined;
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

  function openViewer(next: IiifMapInfo, sourcePane: PaneId = 'left', targetPane?: PaneId) {
    viewerPane = targetPane ?? (isSplitLayout ? oppositePane(sourcePane) : 'right');
    viewerItem = next;
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
    if (baseLayers.length === 0) {
      throw new Error('index.json has no renderLayers; viewer requires renderLayers for layer toggles.');
    }
    return baseLayers.map(layer => ({
      ...layer,
      sourceCollectionLabel: cleanLayerLabel(layer.sourceCollectionLabel),
      renderLayerLabel: layer.renderLayerLabel ? cleanLayerLabel(layer.renderLayerLabel) : layer.renderLayerLabel,
      uiLayerId: getLayerGroupId(layer),
    }));
  }

  // ─── Z-order + opacity ─────────────────────────────────────────────────────

  function applyZOrder() {
    if (!map || !map.isStyleLoaded()) return;
    for (let i = mainLayerOrder.length - 1; i >= 0; i--) {
      const mainId = mainLayerOrder[i];
      const wmtsKey = getMainWmtsKey(mainId);
      if (wmtsKey) {
        const lid = `histcart-${wmtsKey}-layer`;
        try { if (map.getLayer(lid)) map.moveLayer(lid); } catch { /* ignore */ }
      }
      for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
        const subDef = SUB_LAYER_DEFS[subId];
        if (subDef?.kind === 'wms') {
          const landUsageKey = getLandUsageKey(mainId);
          if (landUsageKey) {
            const lid = getLandUsageLayerId(landUsageKey);
            try { if (map.getLayer(lid)) map.moveLayer(lid); } catch { /* ignore */ }
          }
        } else if (subDef?.kind === 'iiif') {
          const info = getIiifInfoForSub(subId);
          if (info) {
            for (const id of getLayerGroupLayerIds(info.uiLayerId)) {
              try { if (map.getLayer(id)) map.moveLayer(id); } catch { /* ignore */ }
            }
          }
        } else if (subDef?.kind === 'geojson' && subId === 'primitief-parcels') {
          for (const id of getPrimitiveLayerIds()) {
            try { if (map.getLayer(id)) map.moveLayer(id); } catch { /* ignore */ }
          }
        }
      }
    }
  }

  function applyZOrderForPane(targetMap: maplibregl.Map, paneId: PaneId | 'main') {
    if (!targetMap || !targetMap.isStyleLoaded()) return;
    for (let i = mainLayerOrder.length - 1; i >= 0; i--) {
      const mainId = mainLayerOrder[i];
      const wmtsKey = getMainWmtsKey(mainId);
      if (wmtsKey) {
        const lid = `histcart-${wmtsKey}-layer`;
        try { if (targetMap.getLayer(lid)) targetMap.moveLayer(lid); } catch { /* ignore */ }
      }
      for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
        const subDef = SUB_LAYER_DEFS[subId];
        if (subDef?.kind === 'wms') {
          const landUsageKey = getLandUsageKey(mainId);
          if (landUsageKey) {
            const lid = getLandUsageLayerId(landUsageKey);
            try { if (targetMap.getLayer(lid)) targetMap.moveLayer(lid); } catch { /* ignore */ }
          }
        } else if (subDef?.kind === 'iiif') {
          const info = getIiifInfoForSub(subId);
          if (info) {
            for (const id of getLayerGroupLayerIds(info.uiLayerId, paneId)) {
              try { if (targetMap.getLayer(id)) targetMap.moveLayer(id); } catch { /* ignore */ }
            }
          }
        } else if (subDef?.kind === 'geojson' && subId === 'primitief-parcels') {
          for (const id of getPrimitiveLayerIds()) {
            try { if (targetMap.getLayer(id)) targetMap.moveLayer(id); } catch { /* ignore */ }
          }
        }
      }
    }
  }

  function applyMainLayerOpacity(mainId: string) {
    const opacity = mainLayerOpacity[mainId] ?? 1;
    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey && mainLayerEnabled[mainId]) {
      setHistCartLayerOpacity(map, wmtsKey, opacity);
    }
    for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
      const subDef = SUB_LAYER_DEFS[subId];
      if (subDef?.kind === 'iiif') {
        if (!mainLayerEnabled[mainId]) continue;
        const info = getIiifInfoForSub(subId);
        if (info) setLayerGroupOpacity(map, info.uiLayerId, opacity);
      } else {
        if (!subLayerEnabled[subId]) continue;
        if (subDef?.kind === 'wms') {
          const landUsageKey = getLandUsageKey(mainId);
          if (landUsageKey) setLandUsageLayerOpacity(map, landUsageKey, opacity);
        } else if (subDef?.kind === 'geojson' && subId === 'primitief-parcels') {
          setPrimitiveLayerOpacity(map, opacity);
        }
      }
    }
  }

  // ─── Layer toggle operations ───────────────────────────────────────────────

  async function loadIiifLayer(layerInfo: UILayerInfo) {
    const gid = layerInfo.uiLayerId;
    log('INFO', `[loadIiif] start gid=${gid} path=${layerInfo.compiledCollectionPath} renderKey=${layerInfo.renderLayerKey ?? 'all'}`);
    layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
    startBulkRun('mirror');
    try {
      await runLayerGroup({
        map, cfg: cfg(), layerInfo, log, debug: FEATURE_FLAGS.debugMenu,
        onRenderStats: (stats) => { layerRenderStats = { ...layerRenderStats, [gid]: stats }; },
        onProgress: (done, total, result) => {
          layerProgress = { ...layerProgress, [gid]: { done, total } };
          ingestRunResult(result);
        },
      });
      log('INFO', `[loadIiif] done gid=${gid}`);
    } finally {
      layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
      endBulkRun();
    }
  }

  function getIiifMainLayerIds(): string[] {
    return mainLayerOrder.filter((mainId) =>
      (MAIN_LAYER_SUBS[mainId] ?? []).some((subId) => SUB_LAYER_DEFS[subId]?.kind === 'iiif')
    );
  }

  async function warmInitialIiifLayers() {
    if (!FEATURE_FLAGS.startupPreloadScreen || !initialWarmupPending || initialWarmupRunning) return;

    const iiifMainIds = getIiifMainLayerIds();
    initialWarmupRunning = true;
    initialWarmupTotal = iiifMainIds.length;
    initialWarmupDone = 0;
    initialWarmupLabel = 'Preparing IIIF layers';

    try {
      for (const mainId of iiifMainIds) {
        const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find((s) => SUB_LAYER_DEFS[s]?.kind === 'iiif');
        if (!iiifSubId) continue;
        const info = getIiifInfoForSub(iiifSubId);
        if (!info) continue;

        initialWarmupLabel = `Preparing ${MAIN_LAYER_LABELS[mainId] ?? mainId}`;
        mainLayerLoading = { ...mainLayerLoading, [mainId]: true };
        try {
          await loadIiifLayer(info);
          await parkLayerGroup(map, info.uiLayerId);
        } catch (e: any) {
          log('ERROR', `[Warmup] ${mainId} failed: ${e?.message ?? String(e)}`);
        } finally {
          mainLayerLoading = { ...mainLayerLoading, [mainId]: false };
          initialWarmupDone += 1;
        }
      }
      initialWarmupPending = false;
    } finally {
      initialWarmupRunning = false;
      initialWarmupLabel = 'IIIF layers ready';
    }
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

    log('INFO', `[syncIiif] ${mainId} target=${shouldShow} parked=${parked} loaded=${hasLoadedGroup}`);

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
      log('INFO', `[syncIiif] ${mainId} post-load shouldShow=${shouldStillShow}`);
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
    const prev = iiifSyncByMain.get(mainId) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => syncIiifMainLayer(mainId));
    iiifSyncByMain.set(mainId, next);
    return next;
  }

  async function loadIiifLayerForRight(layerInfo: UILayerInfo) {
    if (!rightMap) return;
    const gid = layerInfo.uiLayerId;
    log('INFO', `[loadIiif:right] start gid=${gid} path=${layerInfo.compiledCollectionPath} renderKey=${layerInfo.renderLayerKey ?? 'all'}`);
    try {
      await runLayerGroup({
        map: rightMap,
        paneId: 'right',
        cfg: cfg(),
        layerInfo,
        log,
        debug: FEATURE_FLAGS.debugMenu,
      });
    } finally {
      log('INFO', `[loadIiif:right] done gid=${gid}`);
    }
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
    const prev = rightIiifSyncByMain.get(mainId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => syncRightIiifMainLayer(mainId));
    rightIiifSyncByMain.set(mainId, next);
    return next;
  }

  async function toggleMainLayer(mainId: string, enabled: boolean) {
    if (mainLayerEnabled[mainId] === enabled) {
      log('INFO', `[toggleMain] ${mainId} already ${enabled} — skip`);
      if (dev) console.log(`[layer-debug] toggleMainLayer(${mainId}, ${enabled}) — already in that state, skip`);
      return;
    }
    const prevState = mainLayerEnabled[mainId];
    mainLayerEnabled = { ...mainLayerEnabled, [mainId]: enabled };
    if (dev) console.log(`[layer-debug] toggleMainLayer(${mainId}) — ${prevState} → ${enabled}`, { mainLayerEnabled });

    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey) {
      // WMTS tile visibility is owned by the wmts sublayer (ferraris-wmts / vandermaelen-wmts).
      // The sublayerChange events that fire alongside this mainToggle will show/hide the tiles.
      if (dev) console.log(`[layer-debug] toggleMainLayer(${mainId}) — WMTS layer, applyZOrder (sublayers will handle visibility)`);
      applyZOrder();
      return;
    }

    const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
    if (!iiifSubId) {
      log('WARN', `[toggleMain] ${mainId} no iiif sublayer`);
      if (dev) console.log(`[layer-debug] toggleMainLayer(${mainId}) — no iiif sublayer found`);
      return;
    }
    log('INFO', `[toggleMain] ${mainId} ${enabled ? 'ENABLE' : 'DISABLE'}`);
    if (dev) console.log(`[layer-debug] toggleMainLayer(${mainId}) — IIIF layer, scheduling sync for iiifSubId=${iiifSubId}`);
    await scheduleIiifMainLayerSync(mainId);
  }

  async function toggleSubLayer(subId: string, enabled: boolean) {
    if (subLayerEnabled[subId] === enabled) {
      log('INFO', `[toggleSub] ${subId} already ${enabled} — skip`);
      if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}, ${enabled}) — already in that state, skip`);
      return;
    }
    const prevState = subLayerEnabled[subId];
    subLayerEnabled = { ...subLayerEnabled, [subId]: enabled };
    if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — ${prevState} → ${enabled}`, { subLayerEnabled });

    const subDef = SUB_LAYER_DEFS[subId];
    if (!subDef || subDef.kind === 'searchable') {
      if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — not a renderable sublayer (kind=${subDef?.kind}), skip`);
      return;
    }

    const mainId = Object.keys(MAIN_LAYER_SUBS).find(k => MAIN_LAYER_SUBS[k].includes(subId)) ?? '';
    const opacity = mainLayerOpacity[mainId] ?? 1;
    if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}, kind=${subDef.kind}) — mainId=${mainId}, opacity=${opacity}`);

    if (subDef.kind === 'wmts') {
      if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — WMTS type, calling setHistCartLayerVisible(${mainId}, ${enabled})`);
      setHistCartLayerVisible(map, mainId as HistCartLayerKey, enabled);
      if (enabled) setHistCartLayerOpacity(map, mainId as HistCartLayerKey, opacity);
      applyZOrder();
      return;
    }
    if (subDef.kind === 'wms') {
      const landUsageKey = getLandUsageKey(mainId);
      if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — WMS type, landUsageKey=${landUsageKey}, enabled=${enabled}`);
      if (landUsageKey) {
        setLandUsageLayerVisible(map, landUsageKey, enabled);
        if (enabled) setLandUsageLayerOpacity(map, landUsageKey, opacity);
      }
      applyZOrder();
      return;
    }
    if (subDef.kind === 'geojson') {
      if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — GeoJSON type, enabled=${enabled}`);
      if (subId === 'primitief-parcels') {
        setPrimitiveLayerVisible(map, enabled, primitiveGeojsonUrl());
        if (enabled) setPrimitiveLayerOpacity(map, opacity);
        applyZOrder();
      }
      return;
    }

    // IIIF sublayer
    if (!getIiifInfoForSub(subId)) {
      log('WARN', `[toggleSub] ${subId} getIiifInfoForSub returned undefined (layers.length=${layers.length})`);
      if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — IIIF but getIiifInfoForSub returned undefined`);
      return;
    }
    log('INFO', `[toggleSub] ${subId} ${enabled ? 'ENABLE' : 'DISABLE'} sync`);
    if (dev) console.log(`[layer-debug] toggleSubLayer(${subId}) — IIIF type, scheduling sync for mainId=${mainId}`);
    await scheduleIiifMainLayerSync(mainId);
  }

  // ─── Index + toponym loading ───────────────────────────────────────────────

  type ToponymIndexPayload = {
    itemCount?: number;
    items?: RawToponymIndexItem[];
    features?: Array<{ id?: string | number; properties?: Record<string, unknown>; geometry?: unknown }>;
  };

  async function loadToponymIndex(buildIndex: CompiledIndex) {
    toponymLoading = true;
    toponymError = null;
    try {
      // Discover available maps from build/index.json domains array
      // Note: domains is a flat array of map IDs (or nested with .toponyms.maps for future compatibility)
      const knownMaps = Array.isArray(buildIndex.domains) ? buildIndex.domains : (buildIndex.domains as any)?.toponyms?.maps || [];

      if (!knownMaps || knownMaps.length === 0) {
        log?.('WARN', 'No toponym maps found in build/index.json domains');
        toponymIndex = [];
        return;
      }

      // Fetch all per-map toponym files
      const allItems: unknown[] = [];
      const loadedMaps: string[] = [];
      for (const mapId of knownMaps) {
        try {
          // Toponym files use descriptive naming: <mapId>/<mapId>Toponyms.json
          const url = `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Toponyms/${mapId}/${mapId}Toponyms.json`;
          const res = await fetch(url, { redirect: 'follow' });
          if (!res.ok) {
            log?.('INFO', `No toponyms available for ${mapId} (${res.status})`);
            continue;
          }

          const json = (await res.json()) as ToponymIndexPayload;
          const items: RawToponymIndexItem[] = Array.isArray(json.items)
            ? json.items
            : Array.isArray(json.features)
              ? json.features.map((f, i) => {
                  const p = (f?.properties ?? {}) as Record<string, unknown>;
                  return {
                    id: typeof f?.id === 'string' ? f.id : undefined,
                    text: typeof p.text === 'string' ? p.text : undefined,
                    textNormalized: typeof p.textNormalized === 'string' ? p.textNormalized : undefined,
                    sourceGroup: typeof p.sourceGroup === 'string' ? p.sourceGroup : undefined,
                    sourceFile: typeof p.sourceFile === 'string' ? p.sourceFile : undefined,
                    mapId: typeof p.mapId === 'string' ? p.mapId : mapId, // Use mapId from loop if not in data
                    mapName: typeof p.mapName === 'string' ? p.mapName : undefined,
                    featureIndex: Number.isFinite(p.featureIndex) ? Number(p.featureIndex) : i,
                    lon: asFiniteNumber(p.lon) ?? undefined,
                    lat: asFiniteNumber(p.lat) ?? undefined,
                    centroid: Array.isArray(p.centroid) ? (p.centroid as [number, number]) : undefined,
                    bounds: Array.isArray(p.bounds) ? (p.bounds as [number, number, number, number]) : undefined,
                    geometry: f?.geometry,
                  } as RawToponymIndexItem;
                })
              : [];

          if (items.length > 0) {
            // Ensure all items from items array also have mapId set from the filename
            const itemsWithMapId = Array.isArray(json.items)
              ? items.map(item => ({ ...item, mapId: item.mapId || mapId }))
              : items;
            allItems.push(...itemsWithMapId);
            loadedMaps.push(mapId);
            log?.('INFO', `Toponyms loaded for ${mapId}: ${items.length} items`);
          }
        } catch (err) {
          // Silently skip maps without toponyms (normal case, not an error)
          log?.('INFO', `Failed to load toponyms for ${mapId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      toponymIndex = allItems.map(item => normalizeRawToponym(item as RawToponymIndexItem)).filter((x): x is ToponymIndexItem => !!x);
      if (toponymIndex.length === 0) {
        log?.('WARN', `Toponyms index unavailable: no items loaded from ${loadedMaps.length} maps`);
      } else {
        log?.('INFO', `Total toponyms loaded: ${toponymIndex.length} items from maps: ${loadedMaps.join(', ')}`);
      }
    } catch (e: any) {
      toponymIndex = [];
      toponymError = e?.message ?? String(e);
      log('WARN', `Toponyms index unavailable: ${toponymError}`);
    } finally {
      toponymLoading = false;
    }
  }

  function buildManifestSearchIndex(index: CompiledIndex, visibleLayers: UILayerInfo[]): ManifestSearchItem[] {
    const sourceLabelByUrl = new Map<string, string>();
    for (const layer of visibleLayers) {
      const label = cleanLayerLabel(layer.sourceCollectionLabel || '');
      if (label && !sourceLabelByUrl.has(layer.sourceCollectionUrl))
        sourceLabelByUrl.set(layer.sourceCollectionUrl, label);
    }
    const out: ManifestSearchItem[] = [];
    const seen = new Set<string>();
    for (const entry of index.index ?? []) {
      const lon = asFiniteNumber((entry as any).centerLon);
      const lat = asFiniteNumber((entry as any).centerLat);
      if (lon === null || lat === null) continue;
      const label = String(entry.label ?? '').trim();
      if (!label) continue;
      const sourceManifestUrl = String(entry.sourceManifestUrl ?? '').trim();
      const compiledManifestPath = String(entry.compiledManifestPath ?? '').trim();
      if (!sourceManifestUrl || !compiledManifestPath) continue;
      const mapName = sourceLabelByUrl.get(entry.sourceCollectionUrl) || 'IIIF';
      const text = `${mapName} - ${label}`;
      const id = String(entry.manifestAllmapsId ?? '').trim() || compiledManifestPath || sourceManifestUrl;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label, text, textNormalized: normalizeSearchText(text), mapName, sourceManifestUrl, compiledManifestPath, centerLon: lon, centerLat: lat });
    }
    return out;
  }

  async function fetchIndex() {
    indexLoading = true;
    indexError = null;
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
      manifestSearchIndex = buildManifestSearchIndex(index, layers);
      log('INFO', `Manifest search entries loaded: ${manifestSearchIndex.length}`);

      await warmInitialIiifLayers();

      // Re-trigger load for any main layers that were marked enabled before the index was
      // ready (e.g. set by Timeslider's onMount firing before layers were populated).
      for (const mainId of mainLayerOrder) {
        if (!mainLayerEnabled[mainId]) continue;
        const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
        if (!iiifSubId) continue; // WMTS layers (ferraris, vandermaelen) don't need this
        const info = getIiifInfoForSub(iiifSubId);
        if (!info) continue;
        log('INFO', `[Init] Triggering deferred load for ${mainId}`);
        mainLayerEnabled = { ...mainLayerEnabled, [mainId]: false };
        await toggleMainLayer(mainId, true);
      }

      if (dualPaneEnabled && rightMap) {
        await syncRightPaneState();
      }

      await loadToponymIndex(index);
    } catch (e: any) {
      manifestSearchIndex = [];
      indexError = e?.message ?? String(e);
      log('ERROR', `Index fetch failed: ${indexError}`);
    } finally {
      indexLoading = false;
    }
  }

  async function reloadIndex() {
    for (const mainId of mainLayerOrder) {
      const wmtsKey = getMainWmtsKey(mainId);
      if (wmtsKey) setHistCartLayerVisible(map, wmtsKey, false);
      for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
        const subDef = SUB_LAYER_DEFS[subId];
        if (subDef?.kind === 'geojson' && subId === 'primitief-parcels') {
          setPrimitiveLayerVisible(map, false, primitiveGeojsonUrl());
        } else if (subDef?.kind === 'iiif') {
          const info = getIiifInfoForSub(subId);
          if (info) await removeLayerGroup(map, info.uiLayerId);
        }
      }
    }
    layers = [];
    manifestSearchIndex = [];
    mainLayerEnabled  = makeInitialMainLayerEnabled();
    mainLayerLoading  = {};
    subLayerEnabled   = makeInitialSubLayerEnabled();
    subLayerLoading   = {};
    layerRenderStats  = {};
    layerProgress     = {};
    resetBulkMetrics();
    initialWarmupPending = false;
    initialWarmupRunning = false;
    await fetchIndex();
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
    if (map.isStyleLoaded()) fly(); else map.once('load', fly);
  }

  function findMainIdForMapName(mapName: string): string | undefined {
    const norm = mapName.trim().toLowerCase();
    for (const [id, label] of Object.entries(MAIN_LAYER_LABELS)) {
      if (label.toLowerCase() === norm) return id;
    }
    for (const [id, label] of Object.entries(MAIN_LAYER_LABELS)) {
      if (norm.includes(id) || label.toLowerCase().includes(norm)) return id;
    }
    return undefined;
  }

  async function activateLayer(mainId: string) {
    if (mainLayerOrder[0] !== mainId)
      mainLayerOrder = [mainId as MainLayerId, ...mainLayerOrder.filter(id => id !== mainId)];
    if (!mainLayerEnabled[mainId]) {
      await toggleMainLayer(mainId, true);
    } else {
      applyZOrder();
    }
  }

  async function focusTimelineForMainLayer(mainId: MainLayerId) {
    const targetYear = MAIN_LAYER_TIMELINE_YEAR[mainId];
    if (targetYear == null || massartYear === targetYear) return;
    massartYear = targetYear;
    await tick();
  }

  function applySearchLayerFocus(mainId: MainLayerId) {
    searchFocusMainId = mainId;
    searchFocusYear = MAIN_LAYER_TIMELINE_YEAR[mainId] ?? null;
    searchFocusNonce += 1;
  }

  // ─── ToponymSearch event handlers ─────────────────────────────────────────

  async function onFlyToToponym(item: ToponymIndexItem) {
    const mainId = findMainIdForMapName(item.mapName);
    if (mainId) {
      await focusTimelineForMainLayer(mainId as MainLayerId);
      applySearchLayerFocus(mainId as MainLayerId);
      await activateLayer(mainId);
    }
    flyToCoordinates(item.lon, item.lat, `Toponym "${item.text}"`);
  }

  async function onManifestClick(result: ManifestSearchItem) {
    const mainId = findMainIdForMapName(result.mapName);
    if (mainId) {
      await focusTimelineForMainLayer(mainId as MainLayerId);
      applySearchLayerFocus(mainId as MainLayerId);
      await activateLayer(mainId);
    }
    flyToCoordinates(result.centerLon, result.centerLat, `Manifest "${result.text}"`);
    openPreviewBubbleAt({
      title: result.label,
      manifestUrl: result.sourceManifestUrl,
      location: mainId ? MAIN_LAYER_LABELS[mainId] : result.mapName,
      kicker: 'Map Sheet',
    }, result.centerLon, result.centerLat);
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
      });
    }
    return items;
  }

  // ─── Reactive derivations ──────────────────────────────────────────────────

  $: panelOpen = parcelClickInfo !== null || pinnedCards.length > 0;

  // ─── Timeslider wiring ─────────────────────────────────────────────────────

  async function onTimesliderMainToggle(e: CustomEvent<{ mainId: string; enabled: boolean }>) {
    log('INFO', `[TS→] mainToggle ${e.detail.mainId} enabled=${e.detail.enabled}`);
    if (dev) console.log(`[layer-debug] onTimesliderMainToggle — Event from Timeslider:`, e.detail);
    await toggleMainLayer(e.detail.mainId, e.detail.enabled);
  }

  async function onTimesliderSublayerChange(e: CustomEvent<{ subId: string; enabled: boolean }>) {
    log('INFO', `[TS→] sublayerChange ${e.detail.subId} enabled=${e.detail.enabled}`);
    if (dev) console.log(`[layer-debug] onTimesliderSublayerChange — Event from Timeslider (left pane):`, e.detail);
    await toggleSubLayer(e.detail.subId, e.detail.enabled);
  }

  async function onTimesliderPaneMainToggle(e: CustomEvent<{ pane: PaneId; mainId: string; enabled: boolean }>) {
    if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — Event from Timeslider (${e.detail.pane} pane):`, e.detail);
    if (e.detail.pane !== 'right') {
      if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — ignoring left pane event`);
      return;
    }
    rightMainLayerVisible = { ...rightMainLayerVisible, [e.detail.mainId]: e.detail.enabled };
    if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — rightMainLayerVisible updated:`, { [e.detail.mainId]: e.detail.enabled });
    if (!rightMap) {
      if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — rightMap not ready, skip`);
      return;
    }

    const wmtsKey = getMainWmtsKey(e.detail.mainId);
    if (wmtsKey) {
      if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — WMTS layer, applyZOrderForPane(right)`);
      applyZOrderForPane(rightMap, 'right');
      return;
    }

    const iiifSubId = MAIN_LAYER_SUBS[e.detail.mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
    if (!iiifSubId) {
      if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — no IIIF sublayer found for ${e.detail.mainId}`);
      return;
    }
    if (dev) console.log(`[layer-debug] onTimesliderPaneMainToggle — scheduling right IIIF sync for mainId=${e.detail.mainId}`);
    await scheduleRightIiifMainLayerSync(e.detail.mainId);
  }

  async function onTimesliderPaneSublayerChange(e: CustomEvent<{ pane: PaneId; subId: string; enabled: boolean }>) {
    if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — Event from Timeslider (${e.detail.pane} pane):`, e.detail);
    if (e.detail.pane !== 'right') {
      if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — ignoring left pane event`);
      return;
    }
    rightSubLayerVisible = { ...rightSubLayerVisible, [e.detail.subId]: e.detail.enabled };
    if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — rightSubLayerVisible updated:`, { [e.detail.subId]: e.detail.enabled });
    if (!rightMap) {
      if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — rightMap not ready, skip`);
      return;
    }

    const subDef = SUB_LAYER_DEFS[e.detail.subId];
    if (!subDef || subDef.kind === 'searchable') {
      if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — not a renderable sublayer (kind=${subDef?.kind})`);
      return;
    }
    const mainId = Object.keys(MAIN_LAYER_SUBS).find(k => MAIN_LAYER_SUBS[k].includes(e.detail.subId)) ?? '';
    const opacity = mainLayerOpacity[mainId] ?? 1;

    if (subDef.kind === 'wmts') {
      if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — WMTS sublayer ${e.detail.subId}, calling setHistCartLayerVisible(right, ${mainId}, ${e.detail.enabled})`);
      setHistCartLayerVisible(rightMap, mainId as HistCartLayerKey, e.detail.enabled);
      if (e.detail.enabled) setHistCartLayerOpacity(rightMap, mainId as HistCartLayerKey, opacity);
      applyZOrderForPane(rightMap, 'right');
      return;
    }
    if (subDef.kind === 'wms') {
      const landUsageKey = getLandUsageKey(mainId);
      if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — WMS sublayer ${e.detail.subId}, landUsageKey=${landUsageKey}, enabled=${e.detail.enabled}`);
      if (landUsageKey) {
        setLandUsageLayerVisible(rightMap, landUsageKey, e.detail.enabled);
        if (e.detail.enabled) setLandUsageLayerOpacity(rightMap, landUsageKey, opacity);
      }
      applyZOrderForPane(rightMap, 'right');
      return;
    }
    if (subDef.kind === 'geojson') {
      if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — GeoJSON sublayer ${e.detail.subId}, enabled=${e.detail.enabled}`);
      if (e.detail.subId === 'primitief-parcels') {
        setPrimitiveLayerVisible(rightMap, e.detail.enabled, primitiveGeojsonUrl());
        if (e.detail.enabled) setPrimitiveLayerOpacity(rightMap, opacity);
        applyZOrderForPane(rightMap, 'right');
      }
      return;
    }

    if (dev) console.log(`[layer-debug] onTimesliderPaneSublayerChange — IIIF sublayer ${e.detail.subId}, scheduling right IIIF sync for mainId=${mainId}`);
    await scheduleRightIiifMainLayerSync(mainId);
  }

  function syncCamera(from: PaneId) {
    if (!dualPaneEnabled || !map || !rightMap) return;
    const source = from === 'left' ? map : rightMap;
    const target = from === 'left' ? rightMap : map;
    const targetPane: PaneId = from === 'left' ? 'right' : 'left';
    if (!source || !target || suppressSyncPane === from) return;
    suppressSyncPane = targetPane;
    target.jumpTo({
      center: source.getCenter(),
      zoom: source.getZoom(),
      bearing: source.getBearing(),
      pitch: source.getPitch(),
    });
    suppressSyncPane = null;
  }


  function attachRightMassartHandlers(targetMap: maplibregl.Map) {
    for (const layerId of getMassartClickLayerIds()) {
      targetMap.on('click', layerId, (e) => {
        const feat = e.features?.[0];
        if (!feat?.properties) return;
        const { manifestUrl } = feat.properties as { manifestUrl: string };
        const item = massartItems.find(entry => entry.manifestUrl === manifestUrl);
        if (!item) return;
        openImageCollectionBubble(item, 'right');
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
    if (!rightMap) return;
    if (massartItems.length > 0) {
      setMassartPins(rightMap, massartItems, rightTimelineYear, MASSART_LEEWAY);
    }
    for (const subId of Object.keys(rightSubLayerVisible)) {
      await onTimesliderPaneSublayerChange(new CustomEvent('paneSublayerChange', {
        detail: { pane: 'right', subId, enabled: rightSubLayerVisible[subId] },
      }) as CustomEvent<{ pane: PaneId; subId: string; enabled: boolean }>);
    }
    for (const mainId of Object.keys(rightMainLayerVisible)) {
      if ((MAIN_LAYER_SUBS[mainId] ?? []).some((subId) => SUB_LAYER_DEFS[subId]?.kind === 'iiif')) {
        await onTimesliderPaneMainToggle(new CustomEvent('paneMainToggle', {
          detail: { pane: 'right', mainId, enabled: rightMainLayerVisible[mainId] },
        }) as CustomEvent<{ pane: PaneId; mainId: string; enabled: boolean }>);
      }
    }
    applyZOrderForPane(rightMap, 'right');
  }

  async function ensureRightMap() {
    if (!isSplitLayout || !rightMapDiv || rightMap || rightMapInitInFlight) return;
    rightMapInitInFlight = true;
    await tick();
    rightMap = createMapContextWithTheme(rightMapDiv, themeMode);
    attachAllmapsDebugEvents(rightMap, log);
    rightMap.on('load', async () => {
      rightMapReady = true;
      rightMap?.jumpTo({
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
      updateScaleIndicator(rightMap);
      attachRightMassartHandlers(rightMap!);
      attachRightIiifHandlers(rightMap!);
      await syncRightPaneState();
    });
    rightMap.on('move', () => {
      if (imageCollectionBubbleItem) closeImageCollectionBubble();
      refreshActiveLayerGroups('right');
      syncCamera('right');
      updateScaleIndicator(rightMap);
    });
    rightMapInitInFlight = false;
  }

  function teardownRightMap() {
    if (!rightMap) return;
    destroyMapContextInstance(rightMap);
    resetPaneRuntime('right');
    rightMap = null;
    rightMapReady = false;
    rightMapInitInFlight = false;
    rightMainLayerLoading = {};
    rightIiifHoveredMaps = [];
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
    attachAllmapsDebugEvents(map, log);
    map.on('load', () => {
      updateScaleIndicator(map);
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
              openImageCollectionBubble(item, 'left');
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
              on:close={() => (viewerOpen = false)}
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
                on:close={() => (viewerOpen = false)}
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


    {#if FEATURE_FLAGS.debugMenu}
      <DebugMenu
        bind:datasetBaseUrl
        {indexLoading}
        {indexError}
        {logs}
        {layerRenderStats}
        {layerProgress}
        on:reload={() => reloadIndex()}
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
          }, imageCollectionBubblePane);
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
