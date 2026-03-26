<!-- src/routes/+page.svelte — map shell + orchestration -->
<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/theme.css';
  import { onDestroy, onMount } from 'svelte';
  import type maplibregl from 'maplibre-gl';

  import {
    ensureMapContext, destroyMapContext,
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
    loadCompiledIndex, runLayerGroup, removeLayerGroup, parkLayerGroup,
    isLayerGroupParked, setLayerGroupOpacity, getLayerGroupLayerIds,
    resetCompiledIndexCache, getIiifCacheStats, getLayerGroupId,
    getAllActiveWarpedMaps, getManifestInfoForMapId,
    type LayerInfo, type CompiledIndex, type CompiledRunnerConfig, type LayerRenderStats,
  } from '$lib/artemis/runner';
  import { startBulkRun, endBulkRun, resetBulkMetrics, ingestRunResult } from '$lib/artemis/metrics';
  import { normalizeSearchText } from '$lib/artemis/search';
  import { normalizeRawToponym } from '$lib/artemis/toponyms';
  import { asFiniteNumber } from '$lib/artemis/utils';
  import {
    MAIN_LAYER_ORDER, MAIN_LAYER_META, MAIN_LAYER_LABELS,
    MAIN_LAYER_SUBS, SUB_LAYER_DEFS,
    makeInitialMainLayerEnabled, makeInitialSubLayerEnabled,
    type MainLayerId, type HistCartLayerKey,
  } from '$lib/artemis/layerConfig';
  import type {
    ToponymIndexItem, RawToponymIndexItem, ManifestSearchItem,
    IiifMapInfo, ParcelClickInfo, PinnedCard, IiifPanelGroup, UILog, MassartItem,
  } from '$lib/artemis/types';

  import ToponymSearch from '$lib/artemis/ui/ToponymSearch.svelte';
  import InfoCards from '$lib/artemis/ui/InfoCards.svelte';
  import DebugMenu from '$lib/artemis/ui/DebugMenu.svelte';
  import ImageCollectionBubble from '$lib/artemis/ui/ImageCollectionBubble.svelte';
  import IiifViewer from '$lib/artemis/viewer/IiifViewer.svelte';
  import Timeslider from '$lib/components/Timeslider.svelte';

  // ─── Map ───────────────────────────────────────────────────────────────────

  let mapDiv: HTMLElement;
  let map: maplibregl.Map;

  // ─── Config ────────────────────────────────────────────────────────────────

  const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build';
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
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${buildPath}`.replace(/\/+$/, '');
    }
    return url.replace(/\/index\.json\/?$/i, '').replace(/\/+$/, '');
  }

  function primitiveGeojsonUrl(): string {
    return `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Parcels/Primitive/index.geojson`;
  }

  // ─── Massart ───────────────────────────────────────────────────────────────

  const MASSART_LEEWAY = 3; // years each side of the scrubber that count as "active"
  let massartItems: MassartItem[] = [];
  let massartYear = Math.round((1700 + 1855) / 2); // updated by slider year-change

  async function loadMassartData() {
    try {
      const url = `${cfg().datasetBaseUrl}/Massart/index.json`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      massartItems = Array.isArray(data.items) ? data.items : [];
    } catch { /* degrade silently — pins won't appear */ }
  }

  function onMassartYearChange(e: CustomEvent<{ year: number }>) {
    massartYear = e.detail.year;
    if (map?.isStyleLoaded()) updateMassartActiveYear(map, massartYear, MASSART_LEEWAY);
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  let logs: UILog[] = [];
  const MAX_LOGS = 2000;

  function log(level: UILog['level'], msg: string) {
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
  let mainLayerOpacity: Record<string, number>  = { gereduceerd: 1, primitief: 1, vandermaelen: 1, ferraris: 1, handdrawn: 1 };
  let subLayerEnabled   = makeInitialSubLayerEnabled();
  let subLayerLoading: Record<string, boolean>  = {};
  const iiifSyncByMain = new Map<string, Promise<void>>();

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
  let iiifInfoPanel: IiifMapInfo[] | null = null;
  let parcelClickInfo: ParcelClickInfo | null = null;
  let pinnedCards: PinnedCard[] = [];
  let viewerOpen = false;
  let viewerItem: IiifMapInfo | null = null;
  let imageCollectionBubbleItem: MassartItem | null = null;
  let imageCollectionBubbleX = 0;
  let imageCollectionBubbleY = 0;
  let imageCollectionBubbleLngLat: { lon: number; lat: number } | null = null;
  let imageCollectionBubblePlaceBelow = false;
  let initialWarmupPending = true;
  let initialWarmupRunning = false;
  let initialWarmupDone = 0;
  let initialWarmupTotal = 0;
  let initialWarmupLabel = 'Preparing IIIF layers';

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
    if (subId === 'primitief-iiif')  return findIiifLayer('primitief',  'default');
    if (subId === 'gereduceerd-iiif') return findIiifLayer('gereduceerd', 'default');
    if (subId === 'handdrawn-iiif')   return findIiifLayer('handdrawn',   'default');
    return undefined;
  }

  function getMainWmtsKey(mainId: string): HistCartLayerKey | undefined {
    if (mainId === 'ferraris')    return 'ferraris';
    if (mainId === 'vandermaelen') return 'vandermaelen';
    return undefined;
  }

  function colorForGroupId(gid: string): string {
    const mainId = groupIdToMainId.get(gid);
    return MAIN_LAYER_META[mainId ?? '']?.color ?? '#888888';
  }

  function closeImageCollectionBubble() {
    imageCollectionBubbleItem = null;
    imageCollectionBubbleLngLat = null;
    imageCollectionBubblePlaceBelow = false;
  }

  function syncImageCollectionBubblePosition() {
    if (!map || !imageCollectionBubbleLngLat) return;
    const point = map.project([imageCollectionBubbleLngLat.lon, imageCollectionBubbleLngLat.lat]);
    const canvas = map.getCanvas();
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

    imageCollectionBubbleX = point.x;
    imageCollectionBubbleY = point.y;
    imageCollectionBubblePlaceBelow = point.y < 260;
  }

  function openImageCollectionBubble(item: MassartItem) {
    imageCollectionBubbleItem = item;
    imageCollectionBubbleLngLat = item.lon != null && item.lat != null
      ? { lon: item.lon, lat: item.lat }
      : null;
    syncImageCollectionBubblePosition();
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
          const lid = getLandUsageLayerId(mainId as HistCartLayerKey);
          try { if (map.getLayer(lid)) map.moveLayer(lid); } catch { /* ignore */ }
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
          setLandUsageLayerOpacity(map, mainId as HistCartLayerKey, opacity);
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
        map, cfg: cfg(), layerInfo, log,
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
    if (!initialWarmupPending || initialWarmupRunning) return;

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

  async function toggleMainLayer(mainId: string, enabled: boolean) {
    if (mainLayerEnabled[mainId] === enabled) {
      log('INFO', `[toggleMain] ${mainId} already ${enabled} — skip`);
      return;
    }
    mainLayerEnabled = { ...mainLayerEnabled, [mainId]: enabled };

    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey) {
      // WMTS tile visibility is owned by the wmts sublayer (ferraris-wmts / vandermaelen-wmts).
      // The sublayerChange events that fire alongside this mainToggle will show/hide the tiles.
      applyZOrder();
      return;
    }

    const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
    if (!iiifSubId) { log('WARN', `[toggleMain] ${mainId} no iiif sublayer`); return; }
    log('INFO', `[toggleMain] ${mainId} ${enabled ? 'ENABLE' : 'DISABLE'}`);
    await scheduleIiifMainLayerSync(mainId);
  }

  async function toggleSubLayer(subId: string, enabled: boolean) {
    if (subLayerEnabled[subId] === enabled) {
      log('INFO', `[toggleSub] ${subId} already ${enabled} — skip`);
      return;
    }
    subLayerEnabled = { ...subLayerEnabled, [subId]: enabled };

    const subDef = SUB_LAYER_DEFS[subId];
    if (!subDef || subDef.kind === 'searchable') return;

    const mainId = Object.keys(MAIN_LAYER_SUBS).find(k => MAIN_LAYER_SUBS[k].includes(subId)) ?? '';
    const opacity = mainLayerOpacity[mainId] ?? 1;

    if (subDef.kind === 'wmts') {
      setHistCartLayerVisible(map, mainId as HistCartLayerKey, enabled);
      if (enabled) setHistCartLayerOpacity(map, mainId as HistCartLayerKey, opacity);
      applyZOrder();
      return;
    }
    if (subDef.kind === 'wms') {
      setLandUsageLayerVisible(map, mainId as HistCartLayerKey, enabled);
      if (enabled) setLandUsageLayerOpacity(map, mainId as HistCartLayerKey, opacity);
      applyZOrder();
      return;
    }
    if (subDef.kind === 'geojson') {
      if (subId === 'primitief-parcels') {
        setPrimitiveLayerVisible(map, enabled, primitiveGeojsonUrl());
        if (enabled) setPrimitiveLayerOpacity(map, opacity);
        applyZOrder();
      }
      return;
    }

    // IIIF sublayer
    if (!getIiifInfoForSub(subId)) { log('WARN', `[toggleSub] ${subId} getIiifInfoForSub returned undefined (layers.length=${layers.length})`); return; }
    log('INFO', `[toggleSub] ${subId} ${enabled ? 'ENABLE' : 'DISABLE'} sync`);
    await scheduleIiifMainLayerSync(mainId);
  }

  // ─── Index + toponym loading ───────────────────────────────────────────────

  type ToponymIndexPayload = {
    itemCount?: number;
    items?: RawToponymIndexItem[];
    features?: Array<{ id?: string | number; properties?: Record<string, unknown>; geometry?: unknown }>;
  };

  async function loadToponymIndex() {
    toponymLoading = true;
    toponymError = null;
    try {
      const url = `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Toponyms/index.json`;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`Toponyms index fetch failed (${res.status})`);

      const json = (await res.json()) as ToponymIndexPayload;
      const rawItems: RawToponymIndexItem[] = Array.isArray(json.items)
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
                mapId: typeof p.mapId === 'string' ? p.mapId : undefined,
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

      toponymIndex = rawItems.map(normalizeRawToponym).filter((x): x is ToponymIndexItem => !!x);
      log('INFO', `Toponyms loaded: ${toponymIndex.length}`);
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

      await loadToponymIndex();
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

  function hitTestAllWarpedMaps(lon: number, lat: number) {
    const hits: Array<{ mapId: string; warpedMap: any; groupId: string }> = [];
    for (const { mapId, warpedMap, groupId } of getAllActiveWarpedMaps()) {
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

  // ─── ToponymSearch event handlers ─────────────────────────────────────────

  async function onFlyToToponym(item: ToponymIndexItem) {
    flyToCoordinates(item.lon, item.lat, `Toponym "${item.text}"`);
    const mainId = findMainIdForMapName(item.mapName);
    if (mainId) await activateLayer(mainId);
  }

  async function onManifestClick(result: ManifestSearchItem) {
    flyToCoordinates(result.centerLon, result.centerLat, `Manifest "${result.text}"`);
    const mainId = findMainIdForMapName(result.mapName);
    if (mainId) await activateLayer(mainId);
    iiifInfoPanel = [{
      title: result.label,
      sourceManifestUrl: result.sourceManifestUrl,
      layerLabel: mainId ? MAIN_LAYER_LABELS[mainId] : result.mapName,
      layerColor: mainId ? MAIN_LAYER_META[mainId]?.color : undefined,
    }];
  }

  // ─── InfoCards event handlers ──────────────────────────────────────────────

  function groupIiifPanel(items: IiifMapInfo[] | null): IiifPanelGroup[] {
    if (!items) return [];
    const groups = new Map<string, IiifPanelGroup>();
    for (const item of items) {
      const key = item.layerLabel ?? '';
      if (!groups.has(key))
        groups.set(key, { layerLabel: item.layerLabel ?? '', layerColor: item.layerColor ?? '#888888', items: [] });
      groups.get(key)!.items.push(item);
    }
    return Array.from(groups.values());
  }

  function closeIiifGroup(layerLabel: string) {
    if (!iiifInfoPanel) return;
    const remaining = iiifInfoPanel.filter(item => (item.layerLabel ?? '') !== layerLabel);
    iiifInfoPanel = remaining.length > 0 ? remaining : null;
  }

  function pinIiifGroup(group: IiifPanelGroup) {
    pinnedCards = [...pinnedCards, { type: 'iiif', group }];
    closeIiifGroup(group.layerLabel);
  }

  function pinParcel() {
    if (!parcelClickInfo) return;
    pinnedCards = [...pinnedCards, { type: 'parcel', info: parcelClickInfo }];
    parcelClickInfo = null;
    setPrimitiveSelectFeature(map, null);
  }

  function unpinCard(index: number) { pinnedCards = pinnedCards.filter((_, i) => i !== index); }

  function focusIiifGroup(group: IiifPanelGroup) {
    const first = group.items[0];
    if (!first) return;
    if (first.centerLon != null && first.centerLat != null)
      flyToCoordinates(first.centerLon, first.centerLat, first.title);
    if (first.mainId) activateLayer(first.mainId);
  }

  function focusParcel(info: ParcelClickInfo) {
    flyToCoordinates(info.lon, info.lat, `Parcel ${info.parcelLabel}`);
  }

  // ─── Reactive derivations ──────────────────────────────────────────────────

  $: iiifPanelGroups = groupIiifPanel(iiifInfoPanel);
  $: panelOpen = iiifInfoPanel !== null || parcelClickInfo !== null || pinnedCards.length > 0;

  // ─── Timeslider wiring ─────────────────────────────────────────────────────

  async function onTimesliderMainToggle(e: CustomEvent<{ mainId: string; enabled: boolean }>) {
    log('INFO', `[TS→] mainToggle ${e.detail.mainId} enabled=${e.detail.enabled}`);
    await toggleMainLayer(e.detail.mainId, e.detail.enabled);
  }

  async function onTimesliderSublayerChange(e: CustomEvent<{ subId: string; enabled: boolean }>) {
    log('INFO', `[TS→] sublayerChange ${e.detail.subId} enabled=${e.detail.enabled}`);
    await toggleSubLayer(e.detail.subId, e.detail.enabled);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(() => {
    map = ensureMapContext(mapDiv);
    attachAllmapsDebugEvents(map, log);
    map.on('load', () => {
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
              openImageCollectionBubble(item);
            });
            map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
          }
        }
      });
    });

    const onMouseMove = (e: any) => {
      // Primitive parcel hover
      let parcelHit = false;
      if (subLayerEnabled['primitief-parcels'] && map.getLayer('primitive-parcels-layer')) {
        const feature = map.queryRenderedFeatures(e.point, { layers: getPrimitiveLayerIds() })[0];
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
      const lngLat = map.unproject(e.point);
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
      if (iiifHoveredMaps.length === 0) {
        iiifInfoPanel = null;
      } else {
        const items: IiifMapInfo[] = [];
        for (const hit of iiifHoveredMaps) {
          const info = getManifestInfoForMapId(hit.mapId);
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
        iiifInfoPanel = items.length > 0 ? items : null;
      }
    };

    const onMapMove = () => {
      syncImageCollectionBubblePosition();
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
    destroyMapContext();
  });
</script>

<div class="wrap">
  <main class="map-shell">
    <div class="map-canvas" bind:this={mapDiv}></div>

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
        {iiifPanelGroups}
        {parcelClickInfo}
        on:unpin={(e) => unpinCard(e.detail)}
        on:close-iiif={(e) => closeIiifGroup(e.detail)}
        on:close-parcel={() => { parcelClickInfo = null; setPrimitiveSelectFeature(map, null); }}
        on:pin-iiif={(e) => pinIiifGroup(e.detail)}
        on:pin-parcel={() => pinParcel()}
        on:focus-iiif={(e) => focusIiifGroup(e.detail)}
        on:focus-parcel={(e) => focusParcel(e.detail)}
        on:open-viewer={(e) => { viewerItem = e.detail; viewerOpen = true; }}
      />
    {/if}


    <DebugMenu
      bind:datasetBaseUrl
      {indexLoading}
      {indexError}
      {logs}
      {layerRenderStats}
      {layerProgress}
      on:reload={() => reloadIndex()}
    />

    <div class="timeslider-wrap">
      <Timeslider
        {massartItems}
        yearLeeway={MASSART_LEEWAY}
        loadingLayers={mainLayerLoading}
        on:mainToggle={onTimesliderMainToggle}
        on:sublayerChange={onTimesliderSublayerChange}
        on:year-change={onMassartYearChange}
        on:open-viewer={(e) => { viewerItem = { title: e.detail.title, sourceManifestUrl: e.detail.sourceManifestUrl, imageServiceUrl: e.detail.imageServiceUrl }; viewerOpen = true; }}
      />
    </div>

    {#if imageCollectionBubbleItem}
      <ImageCollectionBubble
        item={imageCollectionBubbleItem}
        x={imageCollectionBubbleX}
        y={imageCollectionBubbleY}
        placeBelow={imageCollectionBubblePlaceBelow}
        on:close={closeImageCollectionBubble}
        on:open-viewer={(e) => {
          viewerItem = {
            title: e.detail.title,
            sourceManifestUrl: e.detail.sourceManifestUrl,
            imageServiceUrl: e.detail.imageServiceUrl
          };
          closeImageCollectionBubble();
          viewerOpen = true;
        }}
      />
    {/if}
  </main>
</div>

{#if viewerOpen && viewerItem}
  <IiifViewer
    imageServiceUrl={viewerItem.imageServiceUrl ?? ''}
    title={viewerItem.title}
    sourceManifestUrl={viewerItem.sourceManifestUrl}
    manifestAllmapsUrl={viewerItem.manifestAllmapsUrl ?? ''}
    on:close={() => (viewerOpen = false)}
  />
{/if}

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
    background:
      linear-gradient(180deg, rgba(245, 242, 235, 0.96), rgba(255, 255, 255, 0.92)),
      radial-gradient(circle at top left, rgba(212, 168, 75, 0.18), transparent 36%);
    backdrop-filter: blur(4px);
  }

  .startup-card {
    width: min(280px, calc(100vw - 32px));
    padding: 24px 24px 22px;
    border-radius: var(--radius-lg);
    border: 1px solid rgba(0,0,0,0.1);
    background: rgba(255,255,255,0.95);
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
    background: linear-gradient(180deg, #d4a84b, #c07b28);
    animation: startup-bounce 0.9s ease-in-out infinite;
  }

  .startup-loader span:nth-child(2) { animation-delay: 0.12s; }
  .startup-loader span:nth-child(3) { animation-delay: 0.24s; }

  .startup-title {
    font-size: 24px;
    line-height: 1.05;
    font-weight: 700;
    color: #171717;
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
    pointer-events: all;
  }

</style>
