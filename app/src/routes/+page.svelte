<!-- src/routes/+page.svelte -->
<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '$lib/theme.css';
  import { onDestroy, onMount } from "svelte";
  import type maplibregl from "maplibre-gl";

  import {
    ensureMapContext,
    destroyMapContext,
    setHistCartLayerVisible,
    isHistCartLayerVisible,
    setHistCartLayerOpacity,
    setLandUsageLayerVisible,
    setLandUsageLayerOpacity,
    getLandUsageLayerId,
    setPrimitiveLayerVisible,
    isPrimitiveLayerVisible,
    setPrimitiveLayerOpacity,
    getPrimitiveLayerIds,
    setPrimitiveHoverFeature,
    setPrimitiveSelectFeature,
    setIiifHoverMasks
  } from "$lib/artemis/map/mapInit";
  import { attachAllmapsDebugEvents } from "$lib/artemis/debug/attachAllmapsDebugEvents";
  import {
    loadCompiledIndex,
    runLayerGroup,
    removeLayerGroup,
    parkLayerGroup,
    isLayerGroupParked,
    setLayerGroupOpacity,
    getLayerGroupLayerIds,
    resetCompiledIndexCache,
    getIiifCacheStats,
    getLayerGroupId,
    getAllActiveWarpedMaps,
    getManifestInfoForMapId,
    type LayerInfo,
    type CompiledIndex,
    type CompiledRunnerConfig,
    type LayerRenderStats
  } from "$lib/artemis/runner";
  import {
    bulkSummary, startBulkRun, endBulkRun, resetBulkMetrics, ingestRunResult, fmtMs
  } from "$lib/artemis/metrics";
  import IiifViewer from "$lib/artemis/viewer/IiifViewer.svelte";

  let mapDiv: HTMLElement;
  let map: maplibregl.Map;

  const DEFAULT_BASE_URL = "https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build";
  let datasetBaseUrl = DEFAULT_BASE_URL;

  type LogLine = { atISO: string; level: "INFO" | "WARN" | "ERROR"; msg: string };
  let logs: LogLine[] = [];
  const MAX_LOGS = 2000;

  function log(level: "INFO" | "WARN" | "ERROR", msg: string) {
    logs = [{ atISO: new Date().toISOString(), level, msg }, ...logs].slice(0, MAX_LOGS);
  }

  // Layer state
  type UILayerInfo = LayerInfo & { uiLayerId: string };
  let layers: UILayerInfo[] = [];
  let layerProgress: Record<string, { done: number; total: number }> = {};
  let layerRenderStats: Record<string, LayerRenderStats> = {};
  let indexError: string | null = null;
  let indexLoading = false;
  let debugMenuOpen = false;
  type HistCartLayerKey = "ferraris" | "vandermaelen";

  // --- Layer tree state ---
  type MainLayerId = 'gereduceerd' | 'primitief' | 'vandermaelen' | 'ferraris' | 'handdrawn';
  type SubLayerKind = 'iiif' | 'geojson' | 'wmts' | 'wms' | 'searchable';

  let mainLayerOrder: MainLayerId[] = ['ferraris', 'vandermaelen', 'primitief', 'gereduceerd', 'handdrawn'];
  let mainLayerEnabled: Record<string, boolean> = { gereduceerd: false, primitief: false, vandermaelen: false, ferraris: false, handdrawn: false };
  let mainLayerLoading: Record<string, boolean> = {};
  let mainLayerOpacity: Record<string, number> = { gereduceerd: 1, primitief: 1, vandermaelen: 1, ferraris: 1, handdrawn: 1 };
  let mainLayerExpanded: Record<string, boolean> = {};
  let subLayerEnabled: Record<string, boolean> = {
    'ferraris-landusage': false, 'ferraris-toponyms': false,
    'vandermaelen-landusage': false, 'vandermaelen-toponyms': false,
    'primitief-iiif': false, 'primitief-parcels': false, 'primitief-landusage': false,
    'gereduceerd-iiif': false, 'gereduceerd-parcels': false, 'gereduceerd-landusage': false,
    'handdrawn-iiif': false, 'handdrawn-parcels': false, 'handdrawn-water': false,
  };
  let subLayerLoading: Record<string, boolean> = {};

  let primitiveHoveredFeature: any = null;

  // IIIF warped map hover/click state
  let iiifHoveredMaps: Array<{ mapId: string; warpedMap: any; groupId: string }> = [];
  type IiifMapInfo = { title: string; sourceManifestUrl: string; imageServiceUrl?: string; manifestAllmapsUrl?: string; layerLabel?: string; layerColor?: string };
  let iiifInfoPanel: IiifMapInfo[] | null = null;
  type ParcelClickInfo = { parcelLabel: string; leafId: string; properties: Record<string, any> };
  let parcelClickInfo: ParcelClickInfo | null = null;
  let viewerOpen = false;
  let viewerItem: IiifMapInfo | null = null;

  // Maps groupId (uiLayerId) → mainId for color lookups
  const groupIdToMainId = new Map<string, string>();

  function pointInPolygon(point: [number, number], ring: Array<[number, number]>): boolean {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function hitTestAllWarpedMaps(lon: number, lat: number): Array<{ mapId: string; warpedMap: any; groupId: string }> {
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

  function colorForGroupId(gid: string): string {
    const mainId = groupIdToMainId.get(gid);
    if (!mainId) return '#4ade80';
    return MAIN_LAYER_META[mainId]?.color ?? '#4ade80';
  }
  type ToponymIndexItem = {
    id: string;
    text: string;
    textNormalized?: string;
    sourceGroup: string;
    sourceFile: string;
    mapId: string;
    mapName: string;
    featureIndex: number;
    lon: number;
    lat: number;
  };
  type RawToponymIndexItem = {
    id?: string;
    text?: string;
    textNormalized?: string;
    sourceGroup?: string;
    sourceFile?: string;
    mapId?: string;
    mapName?: string;
    featureIndex?: number;
    lon?: number;
    lat?: number;
    centroid?: [number, number];
    bounds?: [number, number, number, number];
    geometry?: unknown;
  };
  type ToponymIndexPayload = {
    itemCount?: number;
    items?: RawToponymIndexItem[];
    features?: Array<{
      id?: string | number;
      properties?: Record<string, unknown>;
      geometry?: unknown;
    }>;
  };
  type ToponymSearchResult = ToponymIndexItem & { score: number };
  type ManifestSearchItem = {
    id: string;
    label: string;
    text: string;
    textNormalized: string;
    mapName: string;
    sourceManifestUrl: string;
    compiledManifestPath: string;
    centerLon: number;
    centerLat: number;
  };
  type ManifestSearchResult = ManifestSearchItem & { score: number };
  const MAX_TOPONYM_RESULTS = 8;
  const MAX_MANIFEST_RESULTS = 8;
  let toponymIndex: ToponymIndexItem[] = [];
  let manifestSearchIndex: ManifestSearchItem[] = [];
  let toponymLoading = false;
  let toponymError: string | null = null;
  let toponymQuery = "";
  let searchSelectionLocked = false;
  let toponymResults: ToponymSearchResult[] = [];
  let manifestResults: ManifestSearchResult[] = [];
  let toponymFirstFocusSeen = false;
  let toponymSeedSuggestions: ToponymIndexItem[] = [];

  function clampOpacity(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  function normalizeSearchText(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function scoreText(rawText: string, normalizedText: string, queryRaw: string, queryNorm: string): number {
    const rawLower = rawText.toLowerCase();
    const queryLower = queryRaw.toLowerCase();
    let score = -1;
    if (normalizedText === queryNorm) score = 500;
    else if (rawLower === queryLower) score = 450;
    else if (normalizedText.startsWith(queryNorm)) score = 300;
    else if (rawLower.startsWith(queryLower)) score = 260;
    else if (normalizedText.includes(queryNorm)) score = 180;
    else if (rawLower.includes(queryLower)) score = 140;
    else return -1;
    score -= Math.abs(normalizedText.length - queryNorm.length);
    return score;
  }

  function asFiniteNumber(value: unknown): number | null {
    if (typeof value !== "number") return null;
    return Number.isFinite(value) ? value : null;
  }

  function centroidFromBounds(bounds: unknown): [number, number] | null {
    if (!Array.isArray(bounds) || bounds.length < 4) return null;
    const minX = asFiniteNumber(bounds[0]);
    const minY = asFiniteNumber(bounds[1]);
    const maxX = asFiniteNumber(bounds[2]);
    const maxY = asFiniteNumber(bounds[3]);
    if (minX === null || minY === null || maxX === null || maxY === null) return null;
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  function extractPositionsFromGeometry(geometry: unknown): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const coords = (geometry as any)?.coordinates;
    const walk = (node: any) => {
      if (!Array.isArray(node)) return;
      if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
        if (Number.isFinite(node[0]) && Number.isFinite(node[1])) {
          out.push([node[0], node[1]]);
        }
        return;
      }
      for (const child of node) walk(child);
    };
    walk(coords);
    return out;
  }

  function centroidFromGeometry(geometry: unknown): [number, number] | null {
    const positions = extractPositionsFromGeometry(geometry);
    if (positions.length < 1) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of positions) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  function normalizeRawToponym(raw: RawToponymIndexItem): ToponymIndexItem | null {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text) return null;

    const sourceFile = typeof raw?.sourceFile === "string" ? raw.sourceFile : "";
    const sourceGroup =
      typeof raw?.sourceGroup === "string" && raw.sourceGroup.trim()
        ? raw.sourceGroup
        : sourceFile.split("/")[0] || "Unknown";
    const mapName =
      typeof raw?.mapName === "string" && raw.mapName.trim()
        ? raw.mapName
        : sourceGroup;
    const mapId =
      typeof raw?.mapId === "string" && raw.mapId.trim()
        ? raw.mapId
        : sourceGroup.toLowerCase();

    let lon = asFiniteNumber(raw?.lon);
    let lat = asFiniteNumber(raw?.lat);
    if ((lon === null || lat === null) && Array.isArray(raw?.centroid) && raw.centroid.length >= 2) {
      lon = asFiniteNumber(raw.centroid[0]);
      lat = asFiniteNumber(raw.centroid[1]);
    }
    if (lon === null || lat === null) {
      const cFromBounds = centroidFromBounds(raw?.bounds);
      if (cFromBounds) {
        lon = cFromBounds[0];
        lat = cFromBounds[1];
      }
    }
    if (lon === null || lat === null) {
      const cFromGeom = centroidFromGeometry(raw?.geometry);
      if (cFromGeom) {
        lon = cFromGeom[0];
        lat = cFromGeom[1];
      }
    }
    if (lon === null || lat === null) return null;

    return {
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id
          : `${sourceFile}:${Number.isFinite(raw.featureIndex) ? Number(raw.featureIndex) : 0}:${text}`,
      text,
      textNormalized:
        typeof raw.textNormalized === "string" && raw.textNormalized.trim()
          ? raw.textNormalized
          : normalizeSearchText(text),
      sourceGroup,
      sourceFile,
      mapName,
      mapId,
      featureIndex: Number.isFinite(raw.featureIndex) ? Number(raw.featureIndex) : 0,
      lon,
      lat
    };
  }

  function toponymScore(item: ToponymIndexItem, queryRaw: string, queryNorm: string): number {
    const textRaw = item.text ?? "";
    if (!textRaw) return -1;
    const norm = item.textNormalized?.trim() || normalizeSearchText(textRaw);
    if (!norm) return -1;
    return scoreText(textRaw, norm, queryRaw, queryNorm);
  }

  function updateToponymResults() {
    const raw = toponymQuery.trim();
    if (!raw || toponymIndex.length < 1) {
      toponymResults = [];
      return;
    }
    const norm = normalizeSearchText(raw);
    if (!norm) {
      toponymResults = [];
      return;
    }

    const ranked: ToponymSearchResult[] = [];
    for (const item of toponymIndex) {
      const score = toponymScore(item, raw, norm);
      if (score < 0) continue;
      ranked.push({ ...item, score });
    }

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const textCmp = a.text.localeCompare(b.text);
      if (textCmp !== 0) return textCmp;
      return a.sourceFile.localeCompare(b.sourceFile);
    });

    toponymResults = ranked.slice(0, MAX_TOPONYM_RESULTS);
  }

  function updateManifestResults() {
    const raw = toponymQuery.trim();
    if (!raw || manifestSearchIndex.length < 1) {
      manifestResults = [];
      return;
    }
    const norm = normalizeSearchText(raw);
    if (!norm) {
      manifestResults = [];
      return;
    }
    const ranked: ManifestSearchResult[] = [];
    for (const item of manifestSearchIndex) {
      const score = scoreText(item.text, item.textNormalized, raw, norm);
      if (score < 0) continue;
      ranked.push({ ...item, score });
    }
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const textCmp = a.text.localeCompare(b.text);
      if (textCmp !== 0) return textCmp;
      return a.sourceManifestUrl.localeCompare(b.sourceManifestUrl);
    });
    manifestResults = ranked.slice(0, MAX_MANIFEST_RESULTS);
  }

  function buildManifestSearchIndex(compiledIndex: CompiledIndex, visibleLayers: UILayerInfo[]): ManifestSearchItem[] {
    const sourceLabelByUrl = new Map<string, string>();
    for (const layer of visibleLayers) {
      const sourceLabel = cleanLayerLabel(layer.sourceCollectionLabel || "");
      if (sourceLabel && !sourceLabelByUrl.has(layer.sourceCollectionUrl)) {
        sourceLabelByUrl.set(layer.sourceCollectionUrl, sourceLabel);
      }
    }

    const out: ManifestSearchItem[] = [];
    const seen = new Set<string>();
    for (const entry of compiledIndex.index ?? []) {
      const lon = asFiniteNumber((entry as any).centerLon);
      const lat = asFiniteNumber((entry as any).centerLat);
      if (lon === null || lat === null) continue;
      const label = String(entry.label ?? "").trim();
      if (!label) continue;
      const sourceManifestUrl = String(entry.sourceManifestUrl ?? "").trim();
      if (!sourceManifestUrl) continue;
      const compiledManifestPath = String(entry.compiledManifestPath ?? "").trim();
      if (!compiledManifestPath) continue;
      const mapName = sourceLabelByUrl.get(entry.sourceCollectionUrl) || "IIIF";
      const text = `${mapName} - ${label}`;
      const textNormalized = normalizeSearchText(text);
      const id =
        String(entry.manifestAllmapsId ?? "").trim() ||
        compiledManifestPath ||
        sourceManifestUrl;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label,
        text,
        textNormalized,
        mapName,
        sourceManifestUrl,
        compiledManifestPath,
        centerLon: lon,
        centerLat: lat
      });
    }
    return out;
  }

  function flyToCoordinates(lon: number, lat: number, label: string) {
    if (!map) return;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      log("WARN", `${label} has invalid coordinates.`);
      return;
    }
    const fly = () => {
      try {
        const nextZoom = Math.max(map.getZoom(), 14);
        const center = [lon, lat] as [number, number];
        const current = map.getCenter();
        const sameCenter = Math.abs(current.lng - lon) < 1e-9 && Math.abs(current.lat - lat) < 1e-9;
        const sameZoom = Math.abs(map.getZoom() - nextZoom) < 0.01;
        if (sameCenter && sameZoom) return;
        map.stop();
        map.easeTo({ center, zoom: nextZoom, essential: true, duration: 900 });
      } catch (e: any) {
        log("ERROR", `Fly-to failed: ${e?.message ?? String(e)}`);
      }
    };
    if (map.isStyleLoaded()) fly();
    else map.once("load", fly);
  }

  async function flyToToponym(item: ToponymIndexItem) {
    toponymQuery = item.text;
    searchSelectionLocked = true;
    flyToCoordinates(item.lon, item.lat, `Toponym "${item.text}"`);
    const mainId = findMainIdForMapName(item.mapName);
    if (mainId) await activateLayer(mainId);
  }

  function findMainIdForMapName(mapName: string): string | undefined {
    const norm = mapName.trim().toLowerCase();
    for (const [mainId, label] of Object.entries(MAIN_LAYER_LABELS)) {
      if (label.toLowerCase() === norm) return mainId;
    }
    for (const [mainId, label] of Object.entries(MAIN_LAYER_LABELS)) {
      if (norm.includes(mainId) || label.toLowerCase().includes(norm)) return mainId;
    }
    return undefined;
  }

  async function activateLayer(mainId: string) {
    if (mainLayerOrder[0] !== mainId) {
      mainLayerOrder = [mainId as MainLayerId, ...mainLayerOrder.filter(id => id !== mainId)];
    }
    if (!mainLayerEnabled[mainId]) {
      await toggleMainLayer(mainId, true);
    } else {
      applyZOrder();
    }
  }

  async function onManifestResultClick(result: ManifestSearchItem) {
    toponymQuery = result.text;
    searchSelectionLocked = true;
    flyToCoordinates(result.centerLon, result.centerLat, `Manifest "${result.text}"`);
    const mainId = findMainIdForMapName(result.mapName);
    if (mainId) await activateLayer(mainId);
    iiifInfoPanel = [{
      title: result.label,
      sourceManifestUrl: result.sourceManifestUrl,
      layerLabel: mainId ? MAIN_LAYER_LABELS[mainId] : result.mapName,
      layerColor: mainId ? MAIN_LAYER_META[mainId]?.color : undefined
    }];
  }

  function pickRandomToponymSuggestions(count = 3) {
    if (toponymIndex.length < 1) {
      toponymSeedSuggestions = [];
      return;
    }
    const byText = new Map<string, ToponymIndexItem>();
    for (const item of toponymIndex) {
      const key = item.textNormalized?.trim() || normalizeSearchText(item.text);
      if (!key) continue;
      if (!byText.has(key)) byText.set(key, item);
    }
    const pool = Array.from(byText.values());
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    toponymSeedSuggestions = pool.slice(0, Math.max(1, Math.min(count, pool.length)));
  }

  function onToponymSearchFirstFocus() {
    if (toponymFirstFocusSeen) return;
    toponymFirstFocusSeen = true;
    pickRandomToponymSuggestions(3);
  }

  function primitiveGeojsonUrl(): string {
    const base = normalizeDatasetBaseUrl(datasetBaseUrl.trim());
    return `${base}/Parcels/Primitive/index.geojson`;
  }

  function cleanLayerLabel(label: string): string {
    return label.replace(/^\s*artemis\s*[-–—:]\s*/i, "").trim();
  }

  function cfg(): CompiledRunnerConfig {
    return { datasetBaseUrl: normalizeDatasetBaseUrl(datasetBaseUrl.trim()), fetchTimeoutMs: 30000 };
  }

  function normalizeDatasetBaseUrl(input: string): string {
    let url = input.trim();
    if (!url) return url;

    // Accept pasted GitHub blob URL to index.json and map it to raw build base.
    // Example:
    // https://github.com/GhentCDH/Artemis-RnD-Data/blob/master/build/index.json
    // -> https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build
    const blobMatch = url.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)\/index\.json\/?$/i
    );
    if (blobMatch) {
      const [, owner, repo, ref, buildPath] = blobMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${buildPath}`.replace(/\/+$/, "");
    }

    // Accept raw index.json URL and convert to base build path.
    url = url.replace(/\/index\.json\/?$/i, "");
    return url.replace(/\/+$/, "");
  }

  function normalizeSourceLayers(index: CompiledIndex): UILayerInfo[] {
    const baseLayers = index.renderLayers ?? [];
    if (baseLayers.length === 0) {
      throw new Error("index.json has no renderLayers; viewer requires renderLayers for layer toggles.");
    }
    return baseLayers
      .map((layer) => ({
        ...layer,
        sourceCollectionLabel: cleanLayerLabel(layer.sourceCollectionLabel),
        renderLayerLabel: layer.renderLayerLabel ? cleanLayerLabel(layer.renderLayerLabel) : layer.renderLayerLabel,
        uiLayerId: getLayerGroupId(layer)
      }));
  }

  async function loadToponymIndex() {
    toponymLoading = true;
    toponymError = null;
    try {
      const url = `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Toponyms/index.json`;
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        throw new Error(`Toponyms index fetch failed (${res.status})`);
      }
      const json = (await res.json()) as ToponymIndexPayload;
      const rawItems: RawToponymIndexItem[] = Array.isArray(json.items)
        ? json.items
        : Array.isArray(json.features)
          ? json.features.map((f, i) => {
              const p = (f?.properties ?? {}) as Record<string, unknown>;
              return {
                id: typeof f?.id === "string" ? f.id : undefined,
                text: typeof p.text === "string" ? p.text : undefined,
                textNormalized: typeof p.textNormalized === "string" ? p.textNormalized : undefined,
                sourceGroup: typeof p.sourceGroup === "string" ? p.sourceGroup : undefined,
                sourceFile: typeof p.sourceFile === "string" ? p.sourceFile : undefined,
                mapId: typeof p.mapId === "string" ? p.mapId : undefined,
                mapName: typeof p.mapName === "string" ? p.mapName : undefined,
                featureIndex: Number.isFinite(p.featureIndex) ? Number(p.featureIndex) : i,
                lon: asFiniteNumber(p.lon) ?? undefined,
                lat: asFiniteNumber(p.lat) ?? undefined,
                centroid: Array.isArray(p.centroid) ? (p.centroid as [number, number]) : undefined,
                bounds: Array.isArray(p.bounds) ? (p.bounds as [number, number, number, number]) : undefined,
                geometry: f?.geometry
              } as RawToponymIndexItem;
            })
          : [];

      toponymIndex = rawItems
        .map((x) => normalizeRawToponym(x))
        .filter((x): x is ToponymIndexItem => !!x);
      log("INFO", `Toponyms loaded: ${toponymIndex.length}`);
      if (toponymFirstFocusSeen) pickRandomToponymSuggestions(3);
      updateToponymResults();
    } catch (e: any) {
      toponymIndex = [];
      toponymResults = [];
      toponymError = e?.message ?? String(e);
      log("WARN", `Toponyms index unavailable: ${toponymError}`);
    } finally {
      toponymLoading = false;
    }
  }

  async function fetchIndex() {
    indexLoading = true;
    indexError = null;
    resetCompiledIndexCache();
    try {
      const index = await loadCompiledIndex(cfg());
      layers = normalizeSourceLayers(index);
      // Build groupId → mainId mapping for hover color lookups
      groupIdToMainId.clear();
      for (const [mainId, subs] of Object.entries(MAIN_LAYER_SUBS)) {
        for (const subId of subs) {
          const info = getIiifInfoForSub(subId);
          if (info) groupIdToMainId.set(info.uiLayerId, mainId);
        }
      }
      manifestSearchIndex = buildManifestSearchIndex(index, layers);
      log("INFO", `Manifest search entries loaded: ${manifestSearchIndex.length}`);
      await loadToponymIndex();
    } catch (e: any) {
      manifestSearchIndex = [];
      manifestResults = [];
      indexError = e?.message ?? String(e);
      log("ERROR", `Index fetch failed: ${indexError}`);
    } finally {
      indexLoading = false;
    }
  }

  // Find a UILayerInfo by label substring + renderLayerKey
  function findIiifLayer(labelMatch: string, renderKey: string): UILayerInfo | undefined {
    return layers.find(l =>
      l.sourceCollectionLabel.toLowerCase().includes(labelMatch.toLowerCase()) &&
      l.renderLayerKey === renderKey
    );
  }

  function getIiifInfoForSub(subId: string): UILayerInfo | undefined {
    if (subId === 'primitief-iiif') return findIiifLayer('primitief', 'default');
    if (subId === 'gereduceerd-iiif') return findIiifLayer('gereduceerd', 'default');
    return undefined;
  }

  function getMainWmtsKey(mainId: string): HistCartLayerKey | undefined {
    if (mainId === 'ferraris') return 'ferraris';
    if (mainId === 'vandermaelen') return 'vandermaelen';
    return undefined;
  }

  const SUB_LAYER_DEFS: Record<string, { label: string; kind: SubLayerKind }> = {
    'ferraris-landusage':      { label: 'Land usage',          kind: 'wms' },
    'ferraris-toponyms':       { label: 'Toponyms',            kind: 'searchable' },
    'vandermaelen-landusage':  { label: 'Land usage',          kind: 'wms' },
    'vandermaelen-toponyms':   { label: 'Toponyms',            kind: 'searchable' },
    'primitief-iiif':          { label: 'IIIF collection',     kind: 'iiif' },
    'primitief-parcels':       { label: 'Parcels',             kind: 'geojson' },
    'primitief-landusage':     { label: 'Land usage',          kind: 'geojson' },
    'gereduceerd-iiif':        { label: 'IIIF collection',     kind: 'iiif' },
    'gereduceerd-parcels':     { label: 'Parcels',             kind: 'geojson' },
    'gereduceerd-landusage':   { label: 'Land usage',          kind: 'geojson' },
    'handdrawn-iiif':          { label: 'IIIF collection',     kind: 'iiif' },
    'handdrawn-parcels':       { label: 'Parcels',             kind: 'geojson' },
    'handdrawn-water':         { label: 'Water infrastructure',kind: 'geojson' },
  };

  const MAIN_LAYER_SUBS: Record<string, string[]> = {
    ferraris:    ['ferraris-landusage', 'ferraris-toponyms'],
    vandermaelen: ['vandermaelen-landusage', 'vandermaelen-toponyms'],
    primitief:   ['primitief-iiif', 'primitief-parcels', 'primitief-landusage'],
    gereduceerd: ['gereduceerd-iiif', 'gereduceerd-parcels', 'gereduceerd-landusage'],
    handdrawn:   ['handdrawn-iiif', 'handdrawn-parcels', 'handdrawn-water'],
  };

  const MAIN_LAYER_LABELS: Record<string, string> = {
    ferraris:    'Ferraris',
    vandermaelen: 'Vandermaelen',
    primitief:   'Primitief kadaster',
    gereduceerd: 'Gereduceerd kadaster',
    handdrawn:   'Hand drawn collection',
  };

  const MAIN_LAYER_META: Record<string, { date: string; color: string }> = {
    ferraris:    { date: '1771',      color: '#c0392b' },
    vandermaelen: { date: '1846',     color: '#8e44ad' },
    primitief:   { date: '1808–1834', color: '#2980b9' },
    gereduceerd: { date: '1847–1855', color: '#27ae60' },
    handdrawn:   { date: '19th c.',   color: '#d35400' },
  };

  function applyMainLayerOpacity(mainId: string) {
    const opacity = mainLayerOpacity[mainId] ?? 1;
    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey && mainLayerEnabled[mainId]) {
      setHistCartLayerOpacity(map, wmtsKey, opacity);
    }
    for (const subId of MAIN_LAYER_SUBS[mainId] ?? []) {
      if (!subLayerEnabled[subId]) continue;
      const subDef = SUB_LAYER_DEFS[subId];
      if (subDef?.kind === 'wmts') {
        setHistCartLayerOpacity(map, mainId as HistCartLayerKey, opacity);
      } else if (subDef?.kind === 'wms') {
        setLandUsageLayerOpacity(map, mainId as HistCartLayerKey, opacity);
      } else if (subDef?.kind === 'iiif') {
        const info = getIiifInfoForSub(subId);
        if (info) setLayerGroupOpacity(map, info.uiLayerId, opacity);
      } else if (subDef?.kind === 'geojson' && subId === 'primitief-parcels') {
        setPrimitiveLayerOpacity(map, opacity);
      }
    }
  }

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

  // Run an IIIF layer group and track state
  async function loadIiifLayer(layerInfo: UILayerInfo) {
    const gid = layerInfo.uiLayerId;
    layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
    startBulkRun("mirror");
    try {
      await runLayerGroup({
        map,
        cfg: cfg(),
        layerInfo,
        log,
        onRenderStats: (stats) => { layerRenderStats = { ...layerRenderStats, [gid]: stats }; },
        onProgress: (done, total, result) => {
          layerProgress = { ...layerProgress, [gid]: { done, total } };
          ingestRunResult(result);
        }
      });
    } finally {
      layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
      endBulkRun();
    }
  }

  async function toggleMainLayer(mainId: string, enabled: boolean) {
    if (mainLayerEnabled[mainId] === enabled) return;
    mainLayerEnabled = { ...mainLayerEnabled, [mainId]: enabled };

    // WMTS eras: main toggle directly controls the HISTCART WMTS service
    const wmtsKey = getMainWmtsKey(mainId);
    if (wmtsKey) {
      setHistCartLayerVisible(map, wmtsKey, enabled);
      if (enabled) setHistCartLayerOpacity(map, wmtsKey, mainLayerOpacity[mainId] ?? 1);
      applyZOrder();
      return;
    }

    // IIIF eras: find the IIIF sublayer and load/park it
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
        log("ERROR", `Layer load failed: ${e?.message ?? String(e)}`);
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
    if (!subDef) return;

    const mainId = Object.keys(MAIN_LAYER_SUBS).find(k => MAIN_LAYER_SUBS[k].includes(subId)) ?? '';
    const opacity = mainLayerOpacity[mainId] ?? 1;

    if (subDef.kind === 'searchable') return;

    if (subDef.kind === 'wmts') {
      const wmtsKey = mainId as HistCartLayerKey;
      setHistCartLayerVisible(map, wmtsKey, enabled);
      if (enabled) setHistCartLayerOpacity(map, wmtsKey, opacity);
      applyZOrder();
      return;
    }

    if (subDef.kind === 'wms') {
      const wmsKey = mainId as HistCartLayerKey;
      setLandUsageLayerVisible(map, wmsKey, enabled);
      if (enabled) setLandUsageLayerOpacity(map, wmsKey, opacity);
      applyZOrder();
      return;
    }

    if (subDef.kind === 'geojson') {
      if (subId === 'primitief-parcels') {
        setPrimitiveLayerVisible(map, enabled, primitiveGeojsonUrl());
        if (enabled) setPrimitiveLayerOpacity(map, opacity);
        applyZOrder();
      }
      // other geojson sublayers: no-op for now
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
        log("ERROR", `Sublayer load failed: ${e?.message ?? String(e)}`);
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

  function setMainOpacity(mainId: string, rawValue: string) {
    const value = clampOpacity(Number(rawValue));
    mainLayerOpacity = { ...mainLayerOpacity, [mainId]: value };
    applyMainLayerOpacity(mainId);
  }

  function moveLayerUp(mainId: string) {
    mainLayerExpanded = {};
    const idx = mainLayerOrder.indexOf(mainId as MainLayerId);
    if (idx <= 0) return;
    const next = [...mainLayerOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    mainLayerOrder = next;
    applyZOrder();
  }

  function moveLayerDown(mainId: string) {
    mainLayerExpanded = {};
    const idx = mainLayerOrder.indexOf(mainId as MainLayerId);
    if (idx < 0 || idx >= mainLayerOrder.length - 1) return;
    const next = [...mainLayerOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    mainLayerOrder = next;
    applyZOrder();
  }

  async function reloadIndex() {
    // Remove all active layers
    for (const mainId of mainLayerOrder) {
      const wmtsKey = getMainWmtsKey(mainId);
      if (wmtsKey) {
        setHistCartLayerVisible(map, wmtsKey, false);
      }
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
    manifestResults = [];
    mainLayerEnabled = { gereduceerd: false, primitief: false, vandermaelen: false, ferraris: false, handdrawn: false };
    mainLayerLoading = {};
    subLayerEnabled = {
      'ferraris-landusage': false, 'ferraris-toponyms': false,
      'vandermaelen-landusage': false, 'vandermaelen-toponyms': false,
      'primitief-iiif': false, 'primitief-parcels': false, 'primitief-landusage': false,
      'gereduceerd-iiif': false, 'gereduceerd-parcels': false, 'gereduceerd-landusage': false,
      'handdrawn-iiif': false, 'handdrawn-parcels': false, 'handdrawn-water': false,
    };
    subLayerLoading = {};
    layerRenderStats = {};
    layerProgress = {};
    resetBulkMetrics();
    await fetchIndex();
  }

  function parcelHoverDetailsFromFeature(feature: any): { parcelLabel: string; leafId: string } | null {
    const props = feature?.properties ?? {};
    const parcelNumber = String(props.parcel_number ?? "").trim();
    const sourceFileRaw = String(props._source_file ?? "").trim();
    const leafId = sourceFileRaw.replace(/\.geojson$/i, "");
    if (!leafId) return null;
    if (parcelNumber) return { parcelLabel: parcelNumber, leafId };
    const parcelIndex = String(props.parcel_index ?? "").trim();
    if (parcelIndex) {
      return { parcelLabel: `#${parcelIndex}`, leafId };
    }
    return null;
  }

  onMount(() => {
    map = ensureMapContext(mapDiv);
    attachAllmapsDebugEvents(map, log);
    map.on("load", () => applyZOrder());
    const onMapMouseMove = (e: any) => {
      // --- Primitive parcel hover ---
      let parcelHit = false;
      if (subLayerEnabled['primitief-parcels'] && map.getLayer("primitive-parcels-layer")) {
        const features = map.queryRenderedFeatures(e.point, { layers: getPrimitiveLayerIds() });
        const feature = features[0];
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

      // --- IIIF warped map hover ---
      const lngLat = map.unproject(e.point);
      const hits = hitTestAllWarpedMaps(lngLat.lng, lngLat.lat);
      const prevIds = iiifHoveredMaps.map(h => h.mapId).join(',');
      const nextIds = hits.map(h => h.mapId).join(',');
      if (prevIds !== nextIds) {
        iiifHoveredMaps = hits;
        if (hits.length === 0) {
          setIiifHoverMasks(map, null);
        } else {
          setIiifHoverMasks(map, hits.map(h => {
            const color = colorForGroupId(h.groupId);
            return { ring: h.warpedMap.geoMask, fillColor: color, lineColor: color };
          }));
        }
      }

      map.getCanvas().style.cursor = (parcelHit || hits.length > 0) ? "pointer" : "";
    };

    const onMapMouseOut = () => {
      primitiveHoveredFeature = null;
      setPrimitiveHoverFeature(map, null);
      iiifHoveredMaps = [];
      setIiifHoverMasks(map, null);
      map.getCanvas().style.cursor = "";
    };

    const onMapClick = (e: any) => {
      // Parcel click
      if (primitiveHoveredFeature) {
        const details = parcelHoverDetailsFromFeature(primitiveHoveredFeature);
        if (details) {
          const props = primitiveHoveredFeature.properties ?? {};
          parcelClickInfo = { parcelLabel: details.parcelLabel, leafId: details.leafId, properties: props };
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
          const imageServiceUrl: string | undefined =
            hit.warpedMap?.georeferencedMap?.resource?.id ?? undefined;
          const mainId = groupIdToMainId.get(hit.groupId) ?? '';
          items.push({
            title: info.label,
            sourceManifestUrl: info.sourceManifestUrl,
            imageServiceUrl,
            manifestAllmapsUrl: info.manifestAllmapsUrl,
            layerLabel: MAIN_LAYER_LABELS[mainId] ?? '',
            layerColor: colorForGroupId(hit.groupId)
          });
        }
        iiifInfoPanel = items.length > 0 ? items : null;
      }
    };

    map.on("mousemove", onMapMouseMove);
    map.on("mouseout", onMapMouseOut);
    map.on("click", onMapClick);
    void fetchIndex();

    return () => {
      map.off("mousemove", onMapMouseMove);
      map.off("mouseout", onMapMouseOut);
      map.off("click", onMapClick);
    };
  });

  onDestroy(() => {
    destroyMapContext();
  });

  $: {
    toponymQuery;
    toponymIndex;
    manifestSearchIndex;
    updateToponymResults();
    updateManifestResults();
  }

  $: activeLayerCount = Object.values(subLayerEnabled).filter(Boolean).length;

  type IiifPanelGroup = { layerLabel: string; layerColor: string; items: IiifMapInfo[] };

  function groupIiifPanel(items: IiifMapInfo[] | null): IiifPanelGroup[] {
    if (!items) return [];
    const groups = new Map<string, IiifPanelGroup>();
    for (const item of items) {
      const key = item.layerLabel ?? '';
      if (!groups.has(key)) {
        groups.set(key, { layerLabel: item.layerLabel ?? '', layerColor: item.layerColor ?? '#4ade80', items: [] });
      }
      groups.get(key)!.items.push(item);
    }
    return Array.from(groups.values());
  }

  $: iiifPanelGroups = groupIiifPanel(iiifInfoPanel);
  $: panelOpen = iiifInfoPanel !== null || parcelClickInfo !== null;
  $: panelTitle = iiifInfoPanel && parcelClickInfo
    ? 'Location details'
    : iiifInfoPanel
      ? (iiifInfoPanel.length === 1 ? iiifInfoPanel[0].title : `${iiifInfoPanel.length} maps at this location`)
      : parcelClickInfo
        ? `Parcel ${parcelClickInfo.parcelLabel}`
        : '';
</script>

<div class="wrap">
  <main class="map-shell">
    <div class="map-canvas" bind:this={mapDiv}></div>

    <section class="toponym-search-panel">
      <div class="toponym-search-row">
        <input
          type="search"
          class="toponym-search-input"
          placeholder="Search manifests and toponyms..."
          bind:value={toponymQuery}
          on:input={() => (searchSelectionLocked = false)}
          on:focus={onToponymSearchFirstFocus}
          spellcheck="false"
        />
        {#if toponymLoading}
          <span class="toponym-search-status">Loading…</span>
        {/if}
      </div>
      {#if toponymError}
        <div class="toponym-search-error">{toponymError}</div>
      {/if}
      {#if toponymFirstFocusSeen && toponymQuery.trim() === "" && toponymSeedSuggestions.length > 0}
        <div class="toponym-suggestions">
          <div class="toponym-suggestions-title">Try one of these</div>
          <div class="toponym-suggestion-list">
            {#each toponymSeedSuggestions as s (s.id)}
              {@const sMainId = findMainIdForMapName(s.mapName)}
              {@const sColor = sMainId ? MAIN_LAYER_META[sMainId]?.color : undefined}
              <button type="button" class="toponym-suggestion" on:click={() => (toponymQuery = s.text)}>
                {#if sColor}<span class="result-color-dot" style="background:{sColor}"></span>{/if}
                <span class="toponym-text">{s.text}</span>
                <span class="toponym-meta">{s.mapName}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
      {#if !searchSelectionLocked && toponymQuery.trim() && (manifestResults.length > 0 || toponymResults.length > 0)}
        <div class="toponym-results" role="listbox" aria-label="Search results">
          {#if manifestResults.length > 0}
            <div class="result-group-title">IIIF manifests</div>
            {#each manifestResults as result (result.id)}
              {@const mMainId = findMainIdForMapName(result.mapName)}
              {@const mColor = mMainId ? MAIN_LAYER_META[mMainId]?.color : undefined}
              <button
                type="button"
                class="toponym-result"
                on:click={() => onManifestResultClick(result)}
              >
                {#if mColor}<span class="result-color-dot" style="background:{mColor}"></span>{/if}
                <span class="toponym-text">{result.text}</span>
                <span class="toponym-meta">IIIF · {result.mapName}</span>
              </button>
            {/each}
          {/if}
          {#if toponymResults.length > 0}
            <div class="result-group-title">Toponyms</div>
            {#each toponymResults as result (result.id)}
              {@const tMainId = findMainIdForMapName(result.mapName)}
              {@const tColor = tMainId ? MAIN_LAYER_META[tMainId]?.color : undefined}
              <button
                type="button"
                class="toponym-result"
                on:click={() => flyToToponym(result)}
              >
                {#if tColor}<span class="result-color-dot" style="background:{tColor}"></span>{/if}
                <span class="toponym-text">{result.text}</span>
                <span class="toponym-meta">{result.mapName}</span>
              </button>
            {/each}
          {/if}
        </div>
      {:else if !searchSelectionLocked && toponymQuery.trim() && !toponymLoading && !toponymError}
        <div class="toponym-search-empty">No matching manifests or toponyms.</div>
      {/if}
    </section>

    <!-- Info panel — sweeps in from the right on click (IIIF and/or parcel) -->
    <aside class="iiif-map-panel" class:open={panelOpen}>
      {#if panelOpen}
        <div class="iiif-panel-header">
          <span class="iiif-panel-title">{panelTitle}</span>
          <button class="iiif-panel-close" type="button" on:click={() => { iiifInfoPanel = null; parcelClickInfo = null; setPrimitiveSelectFeature(map, null); }} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="iiif-panel-body">
          {#if parcelClickInfo}
            <div class="iiif-layer-group" style="--group-color:{MAIN_LAYER_META['primitief'].color};">
              <div class="iiif-layer-group-header">
                <span class="iiif-panel-item-swatch" style="background:{MAIN_LAYER_META['primitief'].color};"></span>
                <span class="iiif-layer-group-label">Primitief — Parcel</span>
              </div>
              <div class="parcel-detail-block">
                <div class="parcel-detail-row">
                  <span class="parcel-detail-key">Parcel</span>
                  <span class="parcel-detail-val">{parcelClickInfo.parcelLabel}</span>
                </div>
                <div class="parcel-detail-row">
                  <span class="parcel-detail-key">Leaf</span>
                  <span class="parcel-detail-val mono">{parcelClickInfo.leafId}</span>
                </div>
                {#each Object.entries(parcelClickInfo.properties).filter(([k, v]) => !k.startsWith('_') && String(v ?? '').trim() && k !== 'parcel_number' && k !== 'parcel_index') as [k, v]}
                  <div class="parcel-detail-row">
                    <span class="parcel-detail-key">{k.replace(/_/g, ' ')}</span>
                    <span class="parcel-detail-val">{v}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          {#if iiifInfoPanel}
            {#if parcelClickInfo}<hr class="iiif-panel-divider" />{/if}
            {#each iiifPanelGroups as group, gi (group.layerLabel)}
              {#if gi > 0}<hr class="iiif-panel-divider" />{/if}
              <div class="iiif-layer-group" style="--group-color:{group.layerColor};">
                <div class="iiif-layer-group-header">
                  <span class="iiif-panel-item-swatch" style="background:{group.layerColor};"></span>
                  <span class="iiif-layer-group-label">{group.layerLabel}</span>
                  {#if group.items.length > 1}
                    <span class="iiif-layer-group-count">{group.items.length}</span>
                  {/if}
                </div>
                {#each group.items as item (item.sourceManifestUrl)}
                  <button
                    type="button"
                    class="iiif-map-row"
                    on:click={() => { viewerItem = item; viewerOpen = true; }}
                  >
                    {#if item.imageServiceUrl}
                      <img
                        class="iiif-thumb-sm"
                        src="{item.imageServiceUrl}/full/!56,56/0/default.jpg"
                        alt=""
                        loading="lazy"
                      />
                    {:else}
                      <div class="iiif-thumb-placeholder"></div>
                    {/if}
                    <span class="iiif-map-row-title">{item.title}</span>
                    <svg class="iiif-map-row-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </aside>

    <section class="map-layers-panel">
      <div class="panel-header">
        <span class="panel-title">Historical layers</span>
        <span class="panel-count">{activeLayerCount} active</span>
      </div>
      <div class="panel-list">
        {#each mainLayerOrder as mainId (mainId)}
          {@const enabled = mainLayerEnabled[mainId] ?? false}
          {@const loading = mainLayerLoading[mainId] ?? false}
          {@const expanded = mainLayerExpanded[mainId] ?? false}
          {@const opacity = mainLayerOpacity[mainId] ?? 1}
          {@const subs = MAIN_LAYER_SUBS[mainId] ?? []}
          {@const isFirst = mainLayerOrder[0] === mainId}
          {@const isLast = mainLayerOrder[mainLayerOrder.length - 1] === mainId}
          {@const meta = MAIN_LAYER_META[mainId]}
          {@const iiifSubId = subs.find(s => SUB_LAYER_DEFS[s]?.kind === 'iiif')}
          {@const iiifInfo = iiifSubId ? getIiifInfoForSub(iiifSubId) : null}
          {@const progress = iiifInfo ? (layerProgress[iiifInfo.uiLayerId] ?? null) : null}
          <div class="era-card" style="--layer-color:{meta.color}; --toggle-on:{meta.color};">
            <div class="era-header">
              <div class="order-arrows">
                <button class="arrow-btn" type="button" disabled={isFirst}
                  on:click={() => moveLayerUp(mainId)} aria-label="Move up">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 7l3-4 3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <button class="arrow-btn" type="button" disabled={isLast}
                  on:click={() => moveLayerDown(mainId)} aria-label="Move down">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 4 3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              <button class="era-swatch" type="button"
                style="background-color: {meta.color};"
                on:click={() => { const cur = mainLayerExpanded[mainId]; mainLayerExpanded = {}; if (!cur) mainLayerExpanded = { [mainId]: true }; }}
                aria-label="Toggle sublayers">
                {#if mainId === 'ferraris'}
                  <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {#each [4,9,14,19,24,29] as y}
                      <line x1="0" y1={y} x2="34" y2={y} stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                    {/each}
                  </svg>
                {:else if mainId === 'vandermaelen'}
                  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                    {#each [6,12,18,24,30] as v}
                      <line x1={v} y1="0" x2={v} y2="34" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                      <line x1="0" y1={v} x2="34" y2={v} stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                    {/each}
                  </svg>
                {:else if mainId === 'primitief'}
                  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                    {#each [0,8,16,24,32,40] as d}
                      <line x1={d-8} y1="0" x2={d+8} y2="34" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                    {/each}
                  </svg>
                {:else if mainId === 'gereduceerd'}
                  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                    {#each [6,12,18,24,30] as v}
                      <line x1={v} y1="0" x2={v} y2="34" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                      <line x1="0" y1={v} x2="34" y2={v} stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                    {/each}
                    {#each [0,8,16,24,32,40] as d}
                      <line x1={d-8} y1="0" x2={d+8} y2="34" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                    {/each}
                  </svg>
                {:else}
                  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                    <path d="M0 20 Q8 14 17 20 Q26 26 34 20" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" fill="none"/>
                    <path d="M0 27 Q8 21 17 27 Q26 33 34 27" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" fill="none"/>
                  </svg>
                {/if}
              </button>
              <button class="era-meta" type="button"
                on:click={() => { const cur = mainLayerExpanded[mainId]; mainLayerExpanded = {}; if (!cur) mainLayerExpanded = { [mainId]: true }; }}>
                <span class="era-name">{MAIN_LAYER_LABELS[mainId]}</span>
                <span class="era-date">{meta.date}</span>
              </button>
              <div class="era-controls">
                <button
                  class="toggle-pill"
                  class:on={enabled}
                  class:loading
                  type="button"
                  disabled={loading}
                  on:click={() => toggleMainLayer(mainId, !enabled)}
                  aria-label={enabled ? 'Disable' : 'Enable'}
                ></button>
                <button class="chevron-btn" type="button"
                  class:open={expanded}
                  on:click={() => { const cur = mainLayerExpanded[mainId]; mainLayerExpanded = {}; if (!cur) mainLayerExpanded = { [mainId]: true }; }}
                  aria-label="Toggle sublayers">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4.5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </div>
            {#if loading && progress && progress.total > 0}
              {@const pct = Math.round((progress.done / progress.total) * 100)}
              <div class="era-progress">
                <div class="era-progress-bar" style="width:{pct}%"></div>
                <span class="era-progress-label">{progress.done}/{progress.total}</span>
              </div>
            {:else if loading}
              <div class="era-progress-spinner">Loading…</div>
            {/if}
            {#if expanded}
              <div class="sublayer-panel">
                {#each subs.filter(s => SUB_LAYER_DEFS[s]?.kind !== 'iiif') as subId (subId)}
                  {@const subEnabled = subLayerEnabled[subId] ?? false}
                  {@const subLoading = subLayerLoading[subId] ?? false}
                  {@const subDef = SUB_LAYER_DEFS[subId]}
                  {@const subIiifInfo = subDef?.kind === 'iiif' ? getIiifInfoForSub(subId) : null}
                  {@const subProgress = subIiifInfo ? (layerProgress[subIiifInfo.uiLayerId] ?? null) : null}
                  <div class="sublayer-item">
                    <span class="sublayer-dot"></span>
                    <span class="sublayer-name">{subDef?.label ?? subId}</span>
                    <span class="sublayer-badge kind-{subDef?.kind ?? 'geojson'}">{subDef?.kind === 'searchable' ? 'Searchable' : subDef?.kind?.toUpperCase() ?? ''}</span>
                    {#if subDef?.kind !== 'searchable'}
                      <button
                        class="toggle-pill small"
                        class:on={subEnabled}
                        class:loading={subLoading}
                        type="button"
                        disabled={subLoading}
                        on:click={() => toggleSubLayer(subId, !subEnabled)}
                        aria-label={subEnabled ? 'Disable' : 'Enable'}
                      ></button>
                    {/if}
                    {#if subLoading && subProgress && subProgress.total > 0}
                      {@const pct = Math.round((subProgress.done / subProgress.total) * 100)}
                      <div class="era-progress" style="margin: 0 0 0 24px;">
                        <div class="era-progress-bar" style="width:{pct}%"></div>
                        <span class="era-progress-label">{subProgress.done}/{subProgress.total}</span>
                      </div>
                    {/if}
                  </div>
                {/each}
                <div class="opacity-row">
                  <input class="opacity-slider" type="range" min="0" max="1" step="0.01"
                    value={opacity}
                    on:input={(e) => setMainOpacity(mainId, (e.currentTarget as HTMLInputElement).value)} />
                  <span class="opacity-value mono">{Math.round(opacity * 100)}%</span>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <button class="debug-toggle" type="button" on:click={() => (debugMenuOpen = !debugMenuOpen)}>
      {debugMenuOpen ? "Hide Debug Menu" : "Show Debug Menu"}
    </button>

    {#if debugMenuOpen}
      <aside class="debug-menu">
        <div class="debug-menu-head">
          <h2>Debug Menu</h2>
          <button type="button" class="debug-close" on:click={() => (debugMenuOpen = false)}>Close</button>
        </div>

        <div class="field">
          <label for="datasetBaseUrl">Dataset URL</label>
          <input
            id="datasetBaseUrl"
            bind:value={datasetBaseUrl}
            spellcheck="false"
            disabled={indexLoading}
          />
        </div>

        <button
          type="button"
          class="reload-btn"
          on:click={reloadIndex}
          disabled={indexLoading}
        >
          {indexLoading ? "Loading…" : "Reload Index"}
        </button>

        {#if indexError}
          <div class="error-msg">{indexError}</div>
        {/if}

        {#if $bulkSummary && $bulkSummary.manifestCount > 0}
          <div class="metrics">
            <div class="metrics-title">Bulk report</div>

            <table class="mtable">
              <tbody>
                <tr><th>Duration</th><td>{fmtMs($bulkSummary.runDurationMs)}</td></tr>
                <tr><th>Manifests</th><td>{$bulkSummary.manifestCount}</td></tr>
                <tr><th>Applied</th><td class="ok">{$bulkSummary.appliedCount}</td></tr>
                <tr><th>No annotation</th><td class="muted">{$bulkSummary.noAnnotationsCount}</td></tr>
                <tr><th>Problematic manifests</th><td class={$bulkSummary.problematicCount > 0 ? "fail" : "ok"}>{$bulkSummary.problematicCount}</td></tr>
                <tr><th>Failed</th><td class="fail">{$bulkSummary.failCount}</td></tr>
                <tr><th>Avg total (all)</th><td>{fmtMs($bulkSummary.avgManifestTotalMs)}</td></tr>
                <tr><th>Avg total (applied)</th><td>{fmtMs($bulkSummary.avgAppliedTotalMs)}</td></tr>
              </tbody>
            </table>

            {#if $bulkSummary.problematicCount > 0}
              <div class="step-title">Problem manifests ({$bulkSummary.problematicCount})</div>
              <div class="problem-list">
                {#each $bulkSummary.problematicManifests as p}
                  <div class="problem-item">
                    <div class="problem-head">
                      <span class="mono">{p.annotationErrorCount}x</span>
                      <span>{p.manifestLabel}</span>
                    </div>
                    <a href={p.sourceManifestUrl} target="_blank" rel="noreferrer">source manifest</a>
                    {#if p.allmapsManifestUrl}
                      <a href={p.allmapsManifestUrl} target="_blank" rel="noreferrer">allmaps manifest</a>
                    {/if}
                    {#if p.annotationErrors.length > 0}
                      <div class="problem-error mono">{p.annotationErrors[0]}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <div class="step-title">Steps — all runs</div>
            <table class="mtable">
              <thead><tr><th>step</th><th>avg ms</th><th>n</th><th>ok</th></tr></thead>
              <tbody>
                {#each $bulkSummary.steps as s}
                  <tr>
                    <td class="mono">{s.step}</td>
                    <td class="mono">{fmtMs(s.avgMs)}</td>
                    <td>{s.count}</td>
                    <td>{s.okCount}/{s.count}</td>
                  </tr>
                {/each}
              </tbody>
            </table>

            <div class="step-title">Steps — applied only ({$bulkSummary.appliedCount})</div>
            {#if $bulkSummary.stepsApplied.length === 0}
              <div class="muted-text">No applied runs yet.</div>
            {:else}
              <table class="mtable">
                <thead><tr><th>step</th><th>avg ms</th><th>n</th><th>ok</th></tr></thead>
                <tbody>
                  {#each $bulkSummary.stepsApplied as s}
                    <tr>
                      <td class="mono">{s.step}</td>
                      <td class="mono">{fmtMs(s.avgMs)}</td>
                      <td>{s.count}</td>
                      <td>{s.okCount}/{s.count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        {/if}

        {#if Object.keys(layerRenderStats).length > 0}
          {@const totalVisible = Object.values(layerRenderStats).reduce((s, r) => s + r.visibleMaps, 0)}
          {@const totalRegistered = Object.values(layerRenderStats).reduce((s, r) => s + r.registeredMaps, 0)}
          {@const totalPending = Object.values(layerProgress).reduce((s, p) => s + Math.max(0, p.total - p.done), 0)}
          <div class="metrics">
            <div class="metrics-title">Map render state</div>
            <table class="mtable">
              <tbody>
                <tr><th>In viewport</th><td class="ok">{totalVisible}</td></tr>
                <tr><th>Registered</th><td>{totalRegistered}</td></tr>
                <tr><th>Pending</th><td class={totalPending > 0 ? "muted" : "ok"}>{totalPending}</td></tr>
              </tbody>
            </table>
          </div>
        {/if}

        <details class="log-details debug-details">
          <summary>Tile cache</summary>
          <div class="cache-stats">
            <div>Cached entries: <strong>{getIiifCacheStats().size}</strong></div>
            <div>Hits: <strong class="ok">{getIiifCacheStats().hits}</strong> / Misses: <strong>{getIiifCacheStats().misses}</strong></div>
          </div>
        </details>

        <details class="log-details">
          <summary>Logs {#if logs.length}({logs.length}){/if}</summary>
          <div class="logs">
            {#each logs as l}
              <div class="log-line {l.level}">
                <span class="ts">{l.atISO.slice(11, 23)}</span>
                <span class="msg">{l.msg}</span>
              </div>
            {/each}
          </div>
        </details>
      </aside>
    {/if}
  </main>
</div>

{#if viewerOpen && viewerItem}
  <IiifViewer
    imageServiceUrl={viewerItem.imageServiceUrl ?? ""}
    title={viewerItem.title}
    sourceManifestUrl={viewerItem.sourceManifestUrl}
    manifestAllmapsUrl={viewerItem.manifestAllmapsUrl ?? ""}
    on:close={() => (viewerOpen = false)}
  />
{/if}

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    height: 100%;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .wrap {
    height: 100vh;
    overflow: hidden;
  }

  .map-shell {
    position: relative;
    width: 100vw;
    height: 100vh;
  }

  .map-canvas {
    width: 100%;
    height: 100%;
  }

  .toponym-search-panel {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    width: min(560px, calc(100vw - 28px));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toponym-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0.5px solid var(--panel-border);
    border-radius: 8px;
    background: var(--panel-bg);
    box-shadow: var(--shadow-md);
  }

  .toponym-search-input {
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0;
    font-size: 14px;
    color: var(--text-primary);
    flex: 1;
  }

  .toponym-search-input::placeholder {
    color: var(--text-muted);
  }

  .toponym-search-status {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .toponym-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 0.5px solid var(--panel-border);
    border-radius: 8px;
    background: var(--panel-bg);
    box-shadow: var(--shadow-md);
  }

  .result-group-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    padding: 4px 6px 2px;
  }

  .toponym-suggestions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 0.5px solid var(--panel-border);
    border-radius: 8px;
    background: var(--panel-bg);
    box-shadow: var(--shadow-md);
  }

  .toponym-suggestions-title {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 700;
  }

  .toponym-suggestion-list {
    display: grid;
    gap: 4px;
  }

  .toponym-suggestion {
    border: 0;
    background: var(--result-bg);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    cursor: pointer;
  }

  .toponym-suggestion:hover {
    background: var(--result-hover);
  }

  .toponym-result {
    border: 0;
    background: var(--result-bg);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
  }

  .toponym-result:hover {
    background: var(--result-hover);
  }

  .toponym-text {
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    color: var(--text-primary);
  }

  .toponym-meta {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .result-color-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .toponym-search-error,
  .toponym-search-empty {
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--panel-bg);
    border: 0.5px solid var(--panel-border);
    font-size: 11px;
    color: var(--text-muted);
    box-shadow: var(--shadow-md);
  }

  .toponym-search-error {
    color: var(--text-error);
  }

  .parcel-detail-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 6px;
  }

  .parcel-detail-row {
    display: flex;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--group-color, #aaa) 7%, var(--card-bg));
    font-size: 12px;
    line-height: 1.4;
  }

  .parcel-detail-key {
    flex-shrink: 0;
    width: 90px;
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .parcel-detail-val {
    flex: 1;
    color: var(--text-primary);
    word-break: break-all;
  }

  /* IIIF map info panel */
  .iiif-map-panel {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: min(380px, 92vw);
    background: var(--panel-bg);
    border-left: 0.5px solid var(--panel-border);
    box-shadow: var(--shadow-panel-right);
    z-index: 10;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
  }

  .iiif-map-panel.open {
    transform: translateX(0);
  }

  .iiif-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 14px 12px;
    border-bottom: 0.5px solid var(--panel-border);
    flex-shrink: 0;
  }

  .iiif-panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.35;
  }

  .iiif-panel-close {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .iiif-panel-close:hover {
    color: var(--text-primary);
    background: rgba(0, 0, 0, 0.06);
  }

  .iiif-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .iiif-panel-divider {
    border: none;
    border-top: 0.5px solid var(--panel-border);
    margin: 8px 0;
  }

  .iiif-layer-group {
    display: flex;
    flex-direction: column;
    border-left: 3px solid var(--group-color, #aaa);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 2px;
  }

  .iiif-layer-group-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--group-color, #aaa) 10%, var(--card-bg));
  }

  .iiif-panel-item-swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .iiif-layer-group-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--group-color, #555);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  }

  .iiif-layer-group-count {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--group-color, #aaa) 15%, var(--card-bg));
    color: var(--group-color, #555);
  }

  .iiif-map-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 6px;
    border: none;
    background: none;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
    width: 100%;
  }

  .iiif-map-row:hover {
    background: color-mix(in srgb, var(--group-color, #aaa) 10%, var(--card-bg));
  }

  .iiif-thumb-sm {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.06);
  }

  .iiif-thumb-placeholder {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  .iiif-map-row-title {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .iiif-map-row-arrow {
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0.5;
  }

  .map-layers-panel {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 2;
    width: min(320px, calc(100vw - 28px));
    max-height: calc(100vh - 28px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border-radius: 8px;
    border: 1px solid var(--panel-border);
    box-shadow: var(--shadow-md);
  }

  .debug-toggle {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 3;
    border: 1px solid var(--border-ui);
    border-radius: 6px;
    background: var(--overlay-bg);
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-debug);
  }

  .debug-menu {
    position: absolute;
    top: 52px;
    right: 14px;
    z-index: 2;
    width: min(360px, calc(100vw - 28px));
    max-height: calc(100vh - 66px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border-ui);
    background: var(--overlay-bg);
    backdrop-filter: blur(4px);
    box-shadow: var(--shadow-lg);
  }

  .debug-menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .debug-close {
    border: 1px solid var(--border-ui);
    border-radius: 6px;
    background: var(--card-bg);
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .problem-list {
    display: grid;
    gap: 6px;
    margin-bottom: 6px;
  }

  .problem-item {
    border: 1px solid var(--problem-border);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--problem-bg);
    display: grid;
    gap: 2px;
  }

  .problem-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .problem-error {
    color: var(--problem-error-color);
    font-size: 12px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    font-size: 11px;
    opacity: 0.7;
  }

  input:not([type="checkbox"]) {
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
    font-size: 12px;
  }

  .reload-btn {
    padding: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .reload-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error-msg {
    font-size: 11px;
    color: var(--text-error);
    word-break: break-all;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 8px;
    border-bottom: 0.5px solid var(--panel-border);
    background: var(--panel-bg);
    border-radius: 8px 8px 0 0;
  }

  .panel-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .panel-count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .panel-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    overflow-y: auto;
  }

  .era-card {
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--layer-color) 28%, transparent);
    border-left: 3px solid var(--layer-color);
    border-radius: 8px;
    background: var(--card-bg);
    overflow: hidden;
  }

  .era-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--layer-color) 9%, var(--card-bg));
  }

  .order-arrows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }

  .arrow-btn {
    border: 0;
    background: transparent;
    padding: 1px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    transition: color 0.1s;
  }

  .arrow-btn:hover:not(:disabled) {
    color: var(--layer-color);
  }

  .arrow-btn:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .era-swatch {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 0;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s;
  }

  .era-swatch:hover {
    opacity: 0.88;
  }

  .era-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .era-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--layer-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }

  .era-date {
    font-size: 11px;
    color: var(--text-muted);
  }

  .era-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* Toggle pill */
  .toggle-pill {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    border: 0;
    background: var(--toggle-off);
    cursor: pointer;
    position: relative;
    transition: background 0.18s;
    flex-shrink: 0;
  }

  .toggle-pill::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--toggle-thumb);
    transition: transform 0.18s;
    box-shadow: var(--shadow-sm);
  }

  .toggle-pill.on {
    background: var(--toggle-on);
  }

  .toggle-pill.on::after {
    transform: translateX(14px);
  }

  .toggle-pill.loading {
    opacity: 0.5;
    cursor: default;
  }

  .toggle-pill.small {
    width: 26px;
    height: 15px;
    border-radius: 7.5px;
  }

  .toggle-pill.small::after {
    width: 9px;
    height: 9px;
    top: 3px;
    left: 3px;
  }

  .toggle-pill.small.on::after {
    transform: translateX(11px);
  }

  .chevron-btn {
    border: 0;
    background: transparent;
    padding: 2px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    border-radius: 3px;
    transition: transform 0.18s, color 0.1s;
  }

  .chevron-btn.open {
    transform: rotate(180deg);
  }

  .chevron-btn:hover {
    color: var(--layer-color);
  }

  /* Sublayer panel */
  .sublayer-panel {
    border-top: 1px solid color-mix(in srgb, var(--layer-color) 20%, transparent);
    background: color-mix(in srgb, var(--layer-color) 5%, var(--card-bg));
    padding: 6px 0 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sublayer-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px 5px 14px;
    border-radius: 5px;
    transition: background 0.1s;
  }

  .sublayer-item:hover {
    background: color-mix(in srgb, var(--layer-color) 12%, var(--card-bg));
  }

  .sublayer-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--layer-color);
  }

  .sublayer-name {
    font-size: 12px;
    color: var(--text-primary);
    flex: 1;
  }

  .sublayer-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    letter-spacing: 0.01em;
  }

  .sublayer-badge.kind-iiif {
    background: var(--badge-iiif-bg);
    color: var(--badge-iiif-color);
  }

  .sublayer-badge.kind-geojson {
    background: var(--badge-geo-bg);
    color: var(--badge-geo-color);
  }

  .sublayer-badge.kind-wmts {
    background: var(--badge-geo-bg);
    color: var(--badge-geo-color);
  }

  .sublayer-badge.kind-wms {
    background: var(--badge-geo-bg);
    color: var(--badge-geo-color);
  }

  .sublayer-badge.kind-searchable {
    background: var(--badge-search-bg);
    color: var(--badge-search-color);
  }

  /* Opacity row (inside sublayer panel) */
  .opacity-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 2px 14px;
  }

  .opacity-slider {
    flex: 1;
    accent-color: var(--layer-color);
  }

  .opacity-value {
    width: 36px;
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
    background: transparent;
  }

  /* Progress */
  .era-progress {
    position: relative;
    height: 12px;
    background: var(--progress-bg);
    margin: 0 10px 6px;
    border-radius: 3px;
    overflow: hidden;
  }

  .era-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--layer-color);
    transition: width 0.15s;
  }

  .era-progress-label {
    position: relative;
    font-size: 9px;
    padding: 0 4px;
    line-height: 12px;
  }

  .era-progress-spinner {
    font-size: 10px;
    color: var(--spinner-color);
    padding: 2px 10px 6px;
  }

  /* Metrics */
  .metrics {
    border: 1px solid var(--border-light);
    border-radius: 4px;
    padding: 10px;
    font-size: 12px;
  }

  .metrics-title {
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .step-title {
    font-size: 11px;
    font-weight: 600;
    margin: 8px 0 4px;
    opacity: 0.7;
  }

  .muted-text {
    font-size: 11px;
    opacity: 0.6;
  }

  .mtable {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    table-layout: fixed;
  }

  .mtable th, .mtable td {
    padding: 3px 4px;
    border-top: 1px solid var(--border-light);
    text-align: left;
    overflow: hidden;
    word-break: break-all;
  }

  .mtable thead th {
    opacity: 0.6;
    font-weight: 600;
  }

  .mtable td.ok   { color: var(--text-ok); }
  .mtable td.fail { color: var(--text-error); }
  .mtable td.muted { color: var(--text-muted); }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace; }

  .cache-stats {
    padding: 6px 8px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ok { color: var(--text-ok); }

  /* Logs */
  .log-details {
    border: 1px solid var(--border-light);
    border-radius: 3px;
  }

  .log-details summary {
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    color: var(--text-muted-log);
  }

  .log-details[open] summary {
    border-bottom: 1px solid var(--border-light);
  }

  .logs {
    max-height: 260px;
    overflow: auto;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 11px;
    padding: 6px;
  }

  .log-line {
    display: flex;
    gap: 6px;
    padding: 1px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .log-line.ERROR .msg { color: var(--text-error); }
  .log-line.WARN  .msg { color: var(--text-warn); }

  .ts {
    opacity: 0.5;
    flex-shrink: 0;
  }

  .msg {
    white-space: pre-wrap;
    word-break: break-all;
  }

  @media (max-width: 900px) {
    .toponym-search-panel {
      top: 10px;
      width: calc(100vw - 20px);
    }

    .map-layers-panel {
      top: 62px;
      left: 10px;
      width: calc(100vw - 20px);
      max-height: 42vh;
      overflow: hidden;
    }

    .debug-toggle {
      top: 62px;
      right: 10px;
    }

    .debug-menu {
      top: 100px;
      right: 10px;
      width: calc(100vw - 20px);
      max-height: calc(58vh - 100px);
    }
  }
</style>
