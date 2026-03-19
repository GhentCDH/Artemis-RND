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
    IiifMapInfo, ParcelClickInfo, PinnedCard, IiifPanelGroup, UILog,
  } from '$lib/artemis/types';

  import ToponymSearch from '$lib/artemis/ui/ToponymSearch.svelte';
  import InfoCards from '$lib/artemis/ui/InfoCards.svelte';
  import DebugMenu from '$lib/artemis/ui/DebugMenu.svelte';
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
    return MAIN_LAYER_META[mainId ?? '']?.color ?? '#4ade80';
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
    } finally {
      layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
      endBulkRun();
    }
  }

  async function toggleMainLayer(mainId: string, enabled: boolean) {
    if (mainLayerEnabled[mainId] === enabled) return;
    mainLayerEnabled = { ...mainLayerEnabled, [mainId]: enabled };

    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey) {
      setHistCartLayerVisible(map, wmtsKey, enabled);
      if (enabled) setHistCartLayerOpacity(map, wmtsKey, mainLayerOpacity[mainId] ?? 1);
      applyZOrder();
      return;
    }

    const iiifSubId = MAIN_LAYER_SUBS[mainId]?.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif');
    if (!iiifSubId) return;
    const info = getIiifInfoForSub(iiifSubId);
    if (!info) return;
    const gid = info.uiLayerId;

    if (enabled) {
      const restoring = isLayerGroupParked(gid);
      if (!restoring) mainLayerLoading = { ...mainLayerLoading, [mainId]: true };
      try {
        await loadIiifLayer(info);
        setLayerGroupOpacity(map, gid, mainLayerOpacity[mainId] ?? 1);
        applyZOrder();
      } catch (e: any) {
        log('ERROR', `Layer load failed: ${e?.message ?? String(e)}`);
        mainLayerEnabled = { ...mainLayerEnabled, [mainId]: false };
        const next = { ...layerRenderStats }; delete next[gid]; layerRenderStats = next;
      } finally {
        mainLayerLoading = { ...mainLayerLoading, [mainId]: false };
      }
    } else {
      await parkLayerGroup(map, gid);
      applyZOrder();
    }
  }

  async function toggleSubLayer(subId: string, enabled: boolean) {
    if (subLayerEnabled[subId] === enabled) return;
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
    const info = getIiifInfoForSub(subId);
    if (!info) return;
    const gid = info.uiLayerId;
    if (enabled) {
      const restoring = isLayerGroupParked(gid);
      if (!restoring) subLayerLoading = { ...subLayerLoading, [subId]: true };
      try {
        await loadIiifLayer(info);
        setLayerGroupOpacity(map, gid, opacity);
        applyZOrder();
      } catch (e: any) {
        log('ERROR', `Sublayer load failed: ${e?.message ?? String(e)}`);
        subLayerEnabled = { ...subLayerEnabled, [subId]: false };
        const next = { ...layerRenderStats }; delete next[gid]; layerRenderStats = next;
      } finally {
        subLayerLoading = { ...subLayerLoading, [subId]: false };
      }
    } else {
      await parkLayerGroup(map, gid);
      applyZOrder();
    }
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
        groups.set(key, { layerLabel: item.layerLabel ?? '', layerColor: item.layerColor ?? '#4ade80', items: [] });
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
    await toggleMainLayer(e.detail.mainId, e.detail.enabled);
  }

  async function onTimesliderSublayerChange(e: CustomEvent<{ subId: string; enabled: boolean }>) {
    await toggleSubLayer(e.detail.subId, e.detail.enabled);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(() => {
    map = ensureMapContext(mapDiv);
    attachAllmapsDebugEvents(map, log);
    map.on('load', () => applyZOrder());

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

    map.on('mousemove', onMouseMove);
    map.on('mouseout',  onMouseOut);
    map.on('click',     onClick);
    void fetchIndex();

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseout',  onMouseOut);
      map.off('click',     onClick);
    };
  });

  onDestroy(() => {
    destroyMapContext();
  });
</script>

<div class="wrap">
  <main class="map-shell">
    <div class="map-canvas" bind:this={mapDiv}></div>

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
        on:mainToggle={onTimesliderMainToggle}
        on:sublayerChange={onTimesliderSublayerChange}
      />
    </div>
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
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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

  .timeslider-wrap {
    position: absolute;
    bottom: 12px;
    left: 12px;
    right: 12px;
    z-index: 4;
    pointer-events: all;
  }

</style>
