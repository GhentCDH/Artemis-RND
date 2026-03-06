<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type maplibregl from "maplibre-gl";

  import {
    ensureMapContext,
    destroyMapContext,
    setHistCartLayerVisible,
    isHistCartLayerVisible,
    setHistCartLayerOpacity,
    setPrimitiveLayerVisible,
    isPrimitiveLayerVisible,
    setPrimitiveLayerOpacity,
    getPrimitiveLayerIds,
    setPrimitiveHoverFeature
  } from "$lib/artemis/map/mapInit";
  import { attachAllmapsDebugEvents } from "$lib/artemis/debug/attachAllmapsDebugEvents";
  import {
    loadCompiledIndex,
    runLayerGroup,
    removeLayerGroup,
    setLayerGroupOpacity,
    getLayerGroupLayerIds,
    resetCompiledIndexCache,
    getIiifCacheStats,
    getLayerGroupId,
    type LayerInfo,
    type CompiledIndex,
    type CompiledRunnerConfig,
    type LayerRenderStats
  } from "$lib/artemis/runner";
  import {
    bulkSummary, startBulkRun, endBulkRun, resetBulkMetrics, ingestRunResult, fmtMs
  } from "$lib/artemis/metrics";

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
  let layerEnabled: Record<string, boolean> = {};
  let layerLoading: Record<string, boolean> = {};
  let layerProgress: Record<string, { done: number; total: number }> = {};
  let layerRenderStats: Record<string, LayerRenderStats> = {};
  let layerOpacity: Record<string, number> = {};
  let indexError: string | null = null;
  let indexLoading = false;
  let debugMenuOpen = false;
  type HistCartLayerKey = "ferraris" | "vandermaelen";
  let wmtsEnabled: Record<HistCartLayerKey, boolean> = {
    ferraris: false,
    vandermaelen: false
  };
  let wmtsOpacity: Record<HistCartLayerKey, number> = {
    ferraris: 1,
    vandermaelen: 1
  };
  let primitiveEnabled = false;
  let primitiveOpacity = 1;
  let primitiveHover: { x: number; y: number; parcelLabel: string; leafId: string } | null = null;
  type StackItem = {
    id: string;
    type: "iiif" | "wmts" | "geojson";
    label: string;
    layerId: string;
  };
  const WMTS_STACK_LAYER_ID: Record<HistCartLayerKey, string> = {
    ferraris: "wmts:ferraris",
    vandermaelen: "wmts:vandermaelen"
  };
  const PRIMITIVE_STACK_LAYER_ID = "geojson:primitive";
  let stackItems: StackItem[] = [];
  let draggedStackItemId: string | null = null;
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
  let miradorDialog:
    | { title: string; sourceManifestUrl: string; miradorUrl: string }
    | null = null;
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

  function flyToToponym(item: ToponymIndexItem) {
    flyToCoordinates(item.lon, item.lat, `Toponym "${item.text}"`);
    toponymQuery = item.text;
    searchSelectionLocked = true;
  }

  function buildMiradorUrl(manifestUrl: string): string {
    return `https://projectmirador.org/embed/?manifest=${encodeURIComponent(manifestUrl)}`;
  }

  async function copyMiradorUrl() {
    if (!miradorDialog) return;
    try {
      await navigator.clipboard.writeText(miradorDialog.miradorUrl);
      log("INFO", "Mirador URL copied to clipboard.");
    } catch {
      log("WARN", "Could not copy Mirador URL to clipboard.");
    }
  }

  function openMiradorUrl() {
    if (!miradorDialog) return;
    window.open(miradorDialog.miradorUrl, "_blank", "noopener,noreferrer");
  }

  function onManifestResultClick(result: ManifestSearchItem) {
    flyToCoordinates(result.centerLon, result.centerLat, `Manifest "${result.text}"`);
    toponymQuery = result.text;
    searchSelectionLocked = true;
    miradorDialog = {
      title: result.text,
      sourceManifestUrl: result.sourceManifestUrl,
      miradorUrl: buildMiradorUrl(result.sourceManifestUrl)
    };
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

  function rebuildStackItems() {
    const iiifItems: StackItem[] = layers.map((layerInfo) => ({
      id: layerInfo.uiLayerId,
      type: "iiif",
      label: layerName(layerInfo),
      layerId: layerInfo.uiLayerId
    }));
    // UI order is top -> bottom.
    const defaults: StackItem[] = [
      ...iiifItems.toReversed(),
      { id: PRIMITIVE_STACK_LAYER_ID, type: "geojson", label: "Primitive Parcels", layerId: "primitive" },
      { id: WMTS_STACK_LAYER_ID.vandermaelen, type: "wmts", label: "Vandermaelen 1846", layerId: "vandermaelen" },
      { id: WMTS_STACK_LAYER_ID.ferraris, type: "wmts", label: "Ferraris 1771", layerId: "ferraris" }
    ];

    if (stackItems.length < 1) {
      stackItems = defaults;
      return;
    }

    const previousOrder = new Map(stackItems.map((item, idx) => [item.id, idx]));
    stackItems = defaults.sort((a, b) => (previousOrder.get(a.id) ?? 9999) - (previousOrder.get(b.id) ?? 9999));
  }

  function isStackItemEnabled(item: StackItem): boolean {
    if (item.type === "wmts") return wmtsEnabled[item.layerId as HistCartLayerKey];
    if (item.type === "geojson") return primitiveEnabled;
    return !!layerEnabled[item.layerId];
  }

  function primitiveGeojsonUrl(): string {
    const base = normalizeDatasetBaseUrl(datasetBaseUrl.trim());
    return `${base}/Parcels/Primitive/index.geojson`;
  }

  function applyLayerStackOrder() {
    if (!map || !map.isStyleLoaded()) return;
    const applyOnce = () => {
      // Build concrete layer id order bottom -> top, then move each to top in sequence.
      const orderedLayerIds: string[] = [];
      for (const item of [...stackItems].reverse()) {
        if (!isStackItemEnabled(item)) continue;
        if (item.type === "wmts") {
          orderedLayerIds.push(`histcart-${item.layerId}-layer`);
        } else if (item.type === "geojson") {
          orderedLayerIds.push(...getPrimitiveLayerIds());
        } else {
          orderedLayerIds.push(...getLayerGroupLayerIds(item.layerId));
        }
      }
      for (const id of orderedLayerIds) {
        try {
          if (map.getLayer(id)) map.moveLayer(id);
        } catch {
          // ignore transient move errors while layers are mounting/unmounting
        }
      }
    };
    applyOnce();
  }

  function onStackDragStart(itemId: string) {
    draggedStackItemId = itemId;
  }

  function onStackDrop(targetItemId: string) {
    if (!draggedStackItemId || draggedStackItemId === targetItemId) {
      draggedStackItemId = null;
      return;
    }

    const current = [...stackItems];
    const from = current.findIndex((x) => x.id === draggedStackItemId);
    const to = current.findIndex((x) => x.id === targetItemId);
    if (from < 0 || to < 0) {
      draggedStackItemId = null;
      return;
    }

    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    stackItems = current;
    draggedStackItemId = null;
    applyLayerStackOrder();
  }

  function getLayerInfoFromStackItem(item: StackItem): UILayerInfo | undefined {
    if (item.type !== "iiif") return undefined;
    return layers.find((layer) => layer.uiLayerId === item.layerId);
  }

  function isStackItemLoading(item: StackItem): boolean {
    if (item.type !== "iiif") return false;
    return layerLoading[item.layerId] ?? false;
  }

  function getStackItemOpacity(item: StackItem): number {
    if (item.type === "wmts") return wmtsOpacity[item.layerId as HistCartLayerKey] ?? 1;
    if (item.type === "geojson") return primitiveOpacity;
    return layerOpacity[item.layerId] ?? 1;
  }

  function getStackItemProgress(item: StackItem): { done: number; total: number } | undefined {
    if (item.type !== "iiif") return undefined;
    return layerProgress[item.layerId];
  }

  function getStackItemCounts(item: StackItem): string {
    if (item.type === "wmts") return `${Math.round(getStackItemOpacity(item) * 100)}%`;
    if (item.type === "geojson") return "geojson";
    const layerInfo = getLayerInfoFromStackItem(item);
    if (!layerInfo) return "";
    return `${layerInfo.georefCount}/${layerInfo.manifestCount}`;
  }

  async function onStackItemToggle(item: StackItem, nextEnabled: boolean) {
    if (item.type === "wmts") {
      onWmtsSetEnabled(item.layerId as HistCartLayerKey, nextEnabled);
      return;
    }
    if (item.type === "geojson") {
      onPrimitiveSetEnabled(nextEnabled);
      return;
    }
    const layerInfo = getLayerInfoFromStackItem(item);
    if (!layerInfo) return;
    await setIiifLayerEnabled(layerInfo, nextEnabled);
  }

  function onStackItemOpacityInput(item: StackItem, rawValue: string) {
    if (item.type === "wmts") {
      onWmtsOpacityInput(item.layerId as HistCartLayerKey, rawValue);
      return;
    }
    if (item.type === "geojson") {
      onPrimitiveOpacityInput(rawValue);
      return;
    }
    onLayerOpacityInput(item.layerId, rawValue);
  }

  function cleanLayerLabel(label: string): string {
    return label.replace(/^\s*artemis\s*[-–—:]\s*/i, "").trim();
  }

  function layerName(layerInfo: UILayerInfo): string {
    if (layerInfo.renderLayerLabel?.trim()) return cleanLayerLabel(layerInfo.renderLayerLabel.trim());
    if (layerInfo.renderLayerKey?.trim()) {
      const base = cleanLayerLabel(layerInfo.sourceCollectionLabel);
      const key = layerInfo.renderLayerKey.trim();
      // For hidden sub-layers just show the key to keep it compact
      if (layerInfo.hidden) return key;
      return `${base} (${key})`;
    }
    return cleanLayerLabel(layerInfo.sourceCollectionLabel);
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
      manifestSearchIndex = buildManifestSearchIndex(index, layers);
      log("INFO", `Manifest search entries loaded: ${manifestSearchIndex.length}`);
      layerEnabled = {};
      layerOpacity = {};
      for (const l of layers) layerEnabled[l.uiLayerId] = false;
      for (const l of layers) layerOpacity[l.uiLayerId] = 1;
      rebuildStackItems();
      await loadToponymIndex();
      const firstLayer = layers[0];
      if (firstLayer) {
        layerEnabled[firstLayer.uiLayerId] = true;
        await loadLayer(firstLayer);
      }
    } catch (e: any) {
      manifestSearchIndex = [];
      manifestResults = [];
      indexError = e?.message ?? String(e);
      log("ERROR", `Index fetch failed: ${indexError}`);
    } finally {
      indexLoading = false;
    }
  }

  async function loadLayer(layerInfo: UILayerInfo) {
    const gid = layerInfo.uiLayerId;
    layerLoading = { ...layerLoading, [gid]: true };
    layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
    startBulkRun("mirror");

    try {
      await runLayerGroup({
        map,
        cfg: cfg(),
        layerInfo,
        log,
        onRenderStats: (stats) => {
          layerRenderStats = { ...layerRenderStats, [gid]: stats };
        },
        onProgress: (done, total, result) => {
          layerProgress = { ...layerProgress, [gid]: { done, total } };
          ingestRunResult(result);
        }
      });
    } catch (e: any) {
      log("ERROR", `Layer load failed: ${e?.message ?? String(e)}`);
      layerEnabled = { ...layerEnabled, [gid]: false };
    } finally {
      // Always clear loading state even if reordering/opacities throw.
      layerLoading = { ...layerLoading, [gid]: false };
      layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
      try {
        setLayerGroupOpacity(map, gid, layerOpacity[gid] ?? 1);
        applyLayerStackOrder();
      } finally {
        endBulkRun();
      }
      if (!layerEnabled[gid]) {
        const next = { ...layerRenderStats };
        delete next[gid];
        layerRenderStats = next;
      }
    }
  }

  // Unload a layer and update enabled/stats state.
  async function unloadLayer(layerInfo: UILayerInfo) {
    const gid = layerInfo.uiLayerId;
    await removeLayerGroup(map, gid);
    layerEnabled = { ...layerEnabled, [gid]: false };
    const next = { ...layerRenderStats };
    delete next[gid];
    layerRenderStats = next;
  }

  async function setIiifLayerEnabled(layerInfo: UILayerInfo, nextEnabled: boolean) {
    const gid = layerInfo.uiLayerId;
    const enabled = !!layerEnabled[gid];
    if (enabled === nextEnabled) return;

    if (nextEnabled) {
      layerEnabled = { ...layerEnabled, [gid]: true };
      // Sub-layer being enabled: unload the parent default layer (same source, same maps).
      // Parent being enabled: unload any active sub-layers for the same source.
      // Without this, the same maps land in two WarpedMapLayers simultaneously → visual artifacts.
      if (layerInfo.parentRenderLayerKey) {
        // This is a sub-layer — find and unload the parent.
        const parent = layers.find(
          (l) => l.sourceCollectionUrl === layerInfo.sourceCollectionUrl &&
                 l.renderLayerKey === layerInfo.parentRenderLayerKey
        );
        if (parent && layerEnabled[parent.uiLayerId]) {
          log("INFO", `Unloading parent layer "${layerName(parent)}" to avoid overlap with sub-layer`);
          await unloadLayer(parent);
        }
      } else if (layerInfo.renderLayerKey === "default") {
        // Parent being re-enabled — unload any active sub-layers for the same source.
        const subLayers = layers.filter(
          (l) => l.sourceCollectionUrl === layerInfo.sourceCollectionUrl &&
                 l.parentRenderLayerKey === "default"
        );
        for (const sub of subLayers) {
          if (layerEnabled[sub.uiLayerId]) {
            log("INFO", `Unloading sub-layer "${layerName(sub)}" to avoid overlap with parent`);
            await unloadLayer(sub);
          }
        }
      }
      await loadLayer(layerInfo);
    } else {
      await removeLayerGroup(map, gid);
      layerEnabled = { ...layerEnabled, [gid]: false };
      const next = { ...layerRenderStats };
      delete next[gid];
      layerRenderStats = next;
      log("INFO", `Layer "${layerName(layerInfo)}" removed`);
      applyLayerStackOrder();
    }
  }

  async function reloadIndex() {
    // Remove all layers before reloading
    for (const l of layers) {
      await removeLayerGroup(map, l.uiLayerId);
    }
    layers = [];
    manifestSearchIndex = [];
    manifestResults = [];
    miradorDialog = null;
    layerEnabled = {};
    layerRenderStats = {};
    setPrimitiveLayerVisible(map, false, primitiveGeojsonUrl());
    primitiveEnabled = false;
    resetBulkMetrics();
    await fetchIndex();
  }

  function onWmtsSetEnabled(layerKey: HistCartLayerKey, nextEnabled: boolean) {
    if (wmtsEnabled[layerKey] === nextEnabled) return;
    wmtsEnabled = { ...wmtsEnabled, [layerKey]: nextEnabled };

    const apply = () => {
      setHistCartLayerVisible(map, layerKey, nextEnabled);
      if (nextEnabled) setHistCartLayerOpacity(map, layerKey, wmtsOpacity[layerKey]);
      const status = isHistCartLayerVisible(map, layerKey) ? "enabled" : "disabled";
      log("INFO", `WMTS "${layerKey}" ${status}`);
      if (nextEnabled) {
        // Band-aid fix: WMTS can ignore intended order on first add.
        // We replicate the proven manual workaround: move it to top first,
        // then restore the configured stack order.
        const original = [...stackItems];
        const wmtsId = WMTS_STACK_LAYER_ID[layerKey];
        const idx = original.findIndex((item) => item.id === wmtsId);
        if (idx >= 0) {
          const temp = [...original];
          const [wmtsItem] = temp.splice(idx, 1);
          temp.unshift(wmtsItem);
          stackItems = temp;
          applyLayerStackOrder();
          stackItems = original;
          requestAnimationFrame(() => applyLayerStackOrder());
          return;
        }
      }
      applyLayerStackOrder();
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }

  function onLayerOpacityInput(layerId: string, rawValue: string) {
    const value = clampOpacity(Number(rawValue));
    layerOpacity = { ...layerOpacity, [layerId]: value };
    if (layerEnabled[layerId]) setLayerGroupOpacity(map, layerId, value);
  }

  function onWmtsOpacityInput(layerKey: HistCartLayerKey, rawValue: string) {
    const value = clampOpacity(Number(rawValue));
    wmtsOpacity = { ...wmtsOpacity, [layerKey]: value };
    if (wmtsEnabled[layerKey]) setHistCartLayerOpacity(map, layerKey, value);
  }

  function onPrimitiveSetEnabled(nextEnabled: boolean) {
    if (primitiveEnabled === nextEnabled) return;
    const url = primitiveGeojsonUrl();
    log("INFO", `Primitive parcels toggle requested: ${nextEnabled ? "enable" : "disable"} (${url})`);
    primitiveEnabled = nextEnabled;
    if (!nextEnabled) {
      primitiveHover = null;
      setPrimitiveHoverFeature(map, null);
    }
    const apply = () => {
      setPrimitiveLayerVisible(map, nextEnabled, url);
      if (nextEnabled) setPrimitiveLayerOpacity(map, primitiveOpacity);
      const status = isPrimitiveLayerVisible(map) ? "enabled" : "disabled";
      log("INFO", `Primitive parcels "${status}"`);
      const hasSource = !!map.getSource("primitive-parcels-source");
      const hasLayer = !!map.getLayer("primitive-parcels-layer");
      log("INFO", `Primitive parcels state: source=${hasSource} layer=${hasLayer}`);
      applyLayerStackOrder();
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }

  function onPrimitiveOpacityInput(rawValue: string) {
    const value = clampOpacity(Number(rawValue));
    primitiveOpacity = value;
    if (primitiveEnabled) setPrimitiveLayerOpacity(map, value);
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
    map.on("load", () => applyLayerStackOrder());
    const onMapMouseMove = (e: any) => {
      if (!primitiveEnabled || !map.getLayer("primitive-parcels-layer")) {
        if (primitiveHover) primitiveHover = null;
        setPrimitiveHoverFeature(map, null);
        map.getCanvas().style.cursor = "";
        return;
      }
      const features = map.queryRenderedFeatures(e.point, { layers: getPrimitiveLayerIds() });
      const feature = features[0];
      const details = parcelHoverDetailsFromFeature(feature);
      if (!details) {
        if (primitiveHover) primitiveHover = null;
        setPrimitiveHoverFeature(map, null);
        map.getCanvas().style.cursor = "";
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      setPrimitiveHoverFeature(map, feature);
      primitiveHover = { x: e.point.x, y: e.point.y, parcelLabel: details.parcelLabel, leafId: details.leafId };
    };
    const onMapMouseOut = () => {
      primitiveHover = null;
      setPrimitiveHoverFeature(map, null);
      map.getCanvas().style.cursor = "";
    };
    map.on("mousemove", onMapMouseMove);
    map.on("mouseout", onMapMouseOut);
    void fetchIndex();

    return () => {
      map.off("mousemove", onMapMouseMove);
      map.off("mouseout", onMapMouseOut);
    };
  });

  onDestroy(() => {
    primitiveHover = null;
    destroyMapContext();
  });

  $: {
    toponymQuery;
    toponymIndex;
    manifestSearchIndex;
    updateToponymResults();
    updateManifestResults();
  }
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
              <button type="button" class="toponym-suggestion" on:click={() => (toponymQuery = s.text)}>
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
              <button
                type="button"
                class="toponym-result"
                on:click={() => onManifestResultClick(result)}
              >
                <span class="toponym-text">{result.text}</span>
                <span class="toponym-meta">IIIF - {result.mapName}</span>
              </button>
            {/each}
          {/if}
          {#if toponymResults.length > 0}
            <div class="result-group-title">Toponyms</div>
            {#each toponymResults as result (result.id)}
              <button
                type="button"
                class="toponym-result"
                on:click={() => flyToToponym(result)}
              >
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

    {#if miradorDialog}
      <div class="mirador-modal-backdrop">
        <div class="mirador-modal" role="dialog" aria-label="Mirador URL" tabindex="-1">
          <div class="mirador-title">{miradorDialog.title}</div>
          <div class="mirador-row">
            <div class="mirador-label">Source manifest</div>
            <input readonly value={miradorDialog.sourceManifestUrl} />
          </div>
          <div class="mirador-row">
            <div class="mirador-label">Mirador URL</div>
            <input readonly value={miradorDialog.miradorUrl} />
          </div>
          <div class="mirador-actions">
            <button type="button" on:click={copyMiradorUrl}>Copy URL</button>
            <button type="button" on:click={openMiradorUrl}>Open Mirador</button>
            <button type="button" on:click={() => (miradorDialog = null)}>Close</button>
          </div>
        </div>
      </div>
    {/if}

    {#if primitiveHover}
      <div class="parcel-hover-tooltip" style={`left:${primitiveHover.x + 14}px; top:${primitiveHover.y + 14}px;`}>
        <div>Parcel {primitiveHover.parcelLabel}</div>
        <div class="parcel-hover-leaf mono">Leaf {primitiveHover.leafId}</div>
      </div>
    {/if}

    {#if layers.length > 0}
      <section class="map-layers-panel">
        <div class="section-title">Layers (Top to Bottom)</div>
        <div class="stack-list" role="list">
          {#each stackItems as item}
            {@const enabled = isStackItemEnabled(item)}
            {@const loading = isStackItemLoading(item)}
            <div
              class="stack-item"
              role="listitem"
              on:dragover={(e) => e.preventDefault()}
              on:drop={() => onStackDrop(item.id)}
              on:dragend={() => (draggedStackItemId = null)}
            >
              <div class="stack-head">
                <label class="layer-label" class:loading>
                  <input
                    type="checkbox"
                    checked={enabled}
                    on:change={(e) => onStackItemToggle(item, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  <button
                    type="button"
                    class="stack-grip mono"
                    draggable="true"
                    on:dragstart={() => onStackDragStart(item.id)}
                  >::</button>
                  <span class="stack-label">{item.label}</span>
                  <span class="layer-counts">{getStackItemCounts(item)}</span>
                </label>
              </div>
              <div class="opacity-row">
                <input
                  class="opacity-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={getStackItemOpacity(item)}
                  on:input={(e) => onStackItemOpacityInput(item, (e.currentTarget as HTMLInputElement).value)}
                />
                <span class="opacity-value mono">{Math.round(getStackItemOpacity(item) * 100)}%</span>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

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

<style>
  .wrap {
    height: 100vh;
  }

  .map-shell {
    position: relative;
    width: 100%;
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
    border: 1px solid #d8d8d8;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .toponym-search-input {
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0;
    font-size: 14px;
  }

  .toponym-search-status {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
  }

  .toponym-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 1px solid #d8d8d8;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .result-group-title {
    font-size: 11px;
    font-weight: 700;
    color: #666;
    padding: 4px 6px 2px;
  }

  .toponym-suggestions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid #d8d8d8;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .toponym-suggestions-title {
    font-size: 11px;
    color: #666;
    font-weight: 700;
  }

  .toponym-suggestion-list {
    display: grid;
    gap: 4px;
  }

  .toponym-suggestion {
    border: 0;
    background: #ffffff;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    cursor: pointer;
  }

  .toponym-suggestion:hover {
    background: #f5f8ff;
  }

  .toponym-result {
    border: 0;
    background: #ffffff;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
  }

  .toponym-result:hover {
    background: #f5f8ff;
  }

  .toponym-text {
    font-size: 13px;
    font-weight: 600;
    text-align: left;
  }

  .toponym-meta {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
  }

  .toponym-search-error,
  .toponym-search-empty {
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #d8d8d8;
    font-size: 11px;
  }

  .toponym-search-error {
    color: #c0392b;
  }

  .mirador-modal-backdrop {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: rgba(0, 0, 0, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .mirador-modal {
    width: min(680px, 100%);
    background: #fff;
    border-radius: 10px;
    border: 1px solid #d8d8d8;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mirador-title {
    font-size: 14px;
    font-weight: 700;
  }

  .mirador-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mirador-label {
    font-size: 11px;
    opacity: 0.7;
  }

  .mirador-row input {
    font-size: 12px;
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
  }

  .mirador-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }

  .parcel-hover-tooltip {
    position: absolute;
    z-index: 4;
    pointer-events: none;
    padding: 4px 7px;
    border-radius: 4px;
    border: 1px solid #111;
    background: rgba(255, 255, 255, 0.97);
    color: #111;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  }

  .parcel-hover-leaf {
    margin-top: 2px;
    font-size: 10px;
    color: #555;
  }

  .map-layers-panel {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 2;
    width: min(420px, calc(100vw - 28px));
    max-height: calc(100vh - 28px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #d8d8d8;
    background: rgba(255, 255, 255, 0.93);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .debug-toggle {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 3;
    border: 1px solid #d1d1d1;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.95);
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 3px 14px rgba(0, 0, 0, 0.12);
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
    border: 1px solid #d8d8d8;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .debug-menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .debug-close {
    border: 1px solid #d1d1d1;
    border-radius: 6px;
    background: #fff;
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
    border: 1px solid #e8d6d6;
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff7f7;
    display: grid;
    gap: 2px;
  }

  .problem-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .problem-error {
    color: #8b1f1f;
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
    color: #c0392b;
    word-break: break-all;
  }

  /* Layers */
  .layers-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 800;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .layer-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .layer-row-sub {
    margin-left: 18px;
    border-left: 2px solid #e0e0e0;
    padding-left: 6px;
  }

  .layer-label {
    display: grid;
    grid-template-columns: 18px 18px minmax(120px, 1fr) max-content;
    align-items: center;
    column-gap: 8px;
    font-size: 12px;
    opacity: 1;
    cursor: pointer;
    user-select: none;
    width: 100%;
  }

  .layer-label-sub {
    font-size: 11px;
    opacity: 0.8;
  }

  .layer-label.loading {
    opacity: 0.6;
  }

  .layer-name {
    flex: 1;
    font-weight: 700;
  }

  .layer-counts {
    font-size: 10px;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
    min-width: 52px;
    text-align: right;
  }

  .opacity-row {
    margin-left: 52px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .opacity-slider {
    flex: 1;
  }

  .opacity-value {
    width: 40px;
    font-size: 11px;
    color: #666;
    text-align: right;
  }

  .stack-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 4px;
  }

  .stack-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px solid #e4e4e4;
    border-radius: 6px;
    background: #fafafa;
    user-select: none;
  }

  .stack-item-loading {
    opacity: 0.45;
  }

  .stack-grip {
    color: #888;
    width: 18px;
    cursor: grab;
    border: 0;
    background: transparent;
    padding: 0;
    line-height: 1;
  }

  .stack-grip:active {
    cursor: grabbing;
  }

  .stack-label {
    font-size: 12px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layer-progress {
    position: relative;
    height: 12px;
    background: #eee;
    border-radius: 3px;
    overflow: hidden;
    margin-left: 20px;
  }

  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: #4a90d9;
    transition: width 0.15s;
  }

  .layer-progress span {
    position: relative;
    font-size: 9px;
    padding: 0 4px;
    line-height: 12px;
  }

  .layer-progress-spinner {
    font-size: 10px;
    color: #4a90d9;
    margin-left: 20px;
  }

  .layer-sublayer {
    font-size: 11px;
    color: #888;
    margin-top: 1px;
  }

  /* Metrics */
  .metrics {
    border: 1px solid #e0e0e0;
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
    border-top: 1px solid #eee;
    text-align: left;
    overflow: hidden;
    word-break: break-all;
  }

  .mtable thead th {
    opacity: 0.6;
    font-weight: 600;
  }

  .mtable td.ok   { color: #2a7a2a; }
  .mtable td.fail { color: #c0392b; }
  .mtable td.muted { color: #999; }
  .mono { font-family: ui-monospace, "Courier New", monospace; }

  .cache-stats {
    padding: 6px 8px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ok { color: #2a7a2a; }

  /* Logs */
  .log-details {
    border: 1px solid #eee;
    border-radius: 3px;
  }

  .log-details summary {
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    color: #666;
  }

  .log-details[open] summary {
    border-bottom: 1px solid #eee;
  }

  .logs {
    max-height: 260px;
    overflow: auto;
    font-family: ui-monospace, "Courier New", monospace;
    font-size: 11px;
    padding: 6px;
  }

  .log-line {
    display: flex;
    gap: 6px;
    padding: 1px 0;
    border-bottom: 1px solid #f5f5f5;
  }

  .log-line.ERROR .msg { color: #c0392b; }
  .log-line.WARN  .msg { color: #b7800a; }

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
