import { WarpedMapLayer } from "@allmaps/maplibre";
import type maplibregl from "maplibre-gl";
import type { RunResult, StepTiming, SpriteRef } from "$lib/artemis/shared/types";
import {
  deriveAllmapsManifestUrl,
  loadNewIiifEntries,
  nextFrame,
  nowMs,
  scoreEntryForViewport,
  toAbsoluteUrl,
  type CompiledRunnerConfig,
  type IiifLog,
  type LayerInfo,
  type RuntimeLayerEntry,
} from "./bundleLoader";
import {
  getLayerGroupId,
  getPaneRuntime,
  removeLayerGroup,
  removeMaplibreLayer,
  safeHasMapLayer,
  waitForMapReady,
  type PaneRuntimeId,
} from "./runtime";

export type SubLayerRenderStats = {
  registeredMaps: number;
  fetchableMaps: number;
};

export type LayerRenderStats = {
  registeredMaps: number;
  visibleMaps: number;
  fetchableMaps: number;
  firstTilesLoaded: number;
  peakVisibleMaps: number;
  subLayers?: SubLayerRenderStats[];
};

export async function initializeLayerGroup(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;
  layerInfo: LayerInfo;
  paneId?: PaneRuntimeId;
  initialRenderMaps?: boolean;
  spriteOnly?: boolean;
  parallelLoading?: boolean;
  spriteDebugMode?: boolean;
  log?: IiifLog;
  debug?: boolean;
  onProgress?: (done: number, total: number, latest: RunResult) => void;
  onRenderStats?: (stats: LayerRenderStats) => void;
}): Promise<RunResult[]> {
  const { map, cfg, layerInfo, log, debug = false, paneId = "main", initialRenderMaps = true, spriteOnly = false, parallelLoading = false, spriteDebugMode = false } = opts;
  const runtime = getPaneRuntime(paneId);
  const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;
  const timer = createIiifRunTimer({ log, layerLabel });
  const step = timer.step;
  const runStartedAt = nowMs();
  log?.("INFO", `[runLayerGroup] start pane=${paneId} label="${layerLabel}" compiledCollectionPath=${layerInfo.compiledCollectionPath ?? "n/a"} geomapsPath=${layerInfo.geomapsPath ?? "n/a"} renderKey=${layerInfo.renderLayerKey ?? "all"}`);
  step("run:start", `pane=${paneId} renderKey=${layerInfo.renderLayerKey ?? "all"}`);

  log?.("INFO", `[runLayerGroup] waiting for map ready label="${layerLabel}"`);
  const mapReadyStartedAt = nowMs();
  await waitForMapReady(map);
  log?.("INFO", `[runLayerGroup] map ready label="${layerLabel}"`);
  step("map-ready", `${Math.round(nowMs() - mapReadyStartedAt)}ms`);

  const groupId = getLayerGroupId(layerInfo);

  if (runtime.parkedLayersByGroup.has(groupId)) {
    const parked = runtime.parkedLayersByGroup.get(groupId)!;
    runtime.parkedLayersByGroup.delete(groupId);
    runtime.activeLayersByGroup.set(groupId, parked.layerIds);
    runtime.activeWarpedLayersByGroup.set(groupId, parked.warpedLayers);
    log?.("INFO", `Layer "${layerLabel}": restored from park (instant)`);
    return [];
  }

  const removeStartedAt = nowMs();
  await removeLayerGroup(map, groupId, paneId);
  step("remove-stale-group", `${Math.round(nowMs() - removeStartedAt)}ms groupId=${groupId}`);
  log?.("INFO", `[runLayerGroup] removed stale group label="${layerLabel}" groupId=${groupId}`);

  if (!layerInfo.geomapsPath) {
    log?.("ERROR", `[runLayerGroup] missing geomapsPath for "${layerLabel}"`);
    throw new Error(`IIIF layer "${layerLabel}" has no geomapsPath`);
  }

  const timeout = cfg.fetchTimeoutMs ?? 30000;
  const loaded = await loadNewIiifEntries(cfg, layerInfo, timeout, spriteDebugMode, log, (s, d) => step(s, d));
  const infoByServiceUrl = loaded.infoByServiceUrl;
  const entriesUnfiltered = loaded.entries;
  const entries = entriesUnfiltered.filter((entry) => {
    if (layerInfo.renderLayerKey === "verzamelblad") return entry.isVerzamelblad === true;
    if (layerInfo.renderLayerKey === "default") return entry.isVerzamelblad !== true;
    if (layerInfo.renderLayerKey === "single-canvas") return entry.annotSource === "single";
    if (layerInfo.renderLayerKey === "multi-canvas") return entry.annotSource === "multi";
    return true;
  });

  log?.("INFO", `Layer "${layerLabel}": ${entries.length} entries`);
  step("filter-entries", `total=${entriesUnfiltered.length} active=${entries.length}`);

  if (debug) {
    const georefEntries = entries.filter((e) => e.annotSource !== undefined);
    const nonGeorefEntries = entries.filter((e) => e.annotSource === undefined);
    if (georefEntries.length > 0) {
      const single = georefEntries.filter((e) => e.annotSource === "single").length;
      const multi = georefEntries.filter((e) => e.annotSource === "multi").length;
      log?.("INFO", `[${layerLabel}] annotation strategy: georef=${georefEntries.length}(single:${single} multi:${multi}) none=${nonGeorefEntries.length}`);
    }
  }

  const results: RunResult[] = [];
  const mapMetaByMapId = new Map<string, { label: string; manifestAllmapsUrl?: string }>();
  const chunkCount = 1;
  const layerIds = Array.from({ length: chunkCount }, (_, i) => `warped-layer-${groupId.replace(/\//g, "-")}${chunkCount > 1 ? `-${i}` : ""}`);
  const layers: WarpedMapLayer[] = [];
  const layerCreateStartedAt = nowMs();
  for (let i = 0; i < chunkCount; i++) {
    await removeMaplibreLayer(map, layerIds[i]);
    const l = new WarpedMapLayer({ layerId: layerIds[i] } as any);
    try {
      map.addLayer(l as any);
      l.setLayerOptions({ visible: false } as any);
      layers.push(l);
    } catch (e: any) {
      log?.("ERROR", `addLayer failed (${layerIds[i]}): ${e?.message ?? String(e)}`);
      return [];
    }
  }
  runtime.activeLayersByGroup.set(groupId, layerIds);
  runtime.activeWarpedLayersByGroup.set(groupId, layers);
  step("create-warped-layers", `${Math.round(nowMs() - layerCreateStartedAt)}ms count=${layers.length}`);

  const label = layerLabel;
  const NOISY_LOG_EVERY = 25;
  let mapsAdded = 0;
  let imageInfosAdded = 0;
  let firstTilesLoaded = 0;
  let mapsInViewport = 0;
  let tileFetchErrors = 0;
  let annotationErrorCount = 0;
  let manifestsWithAnnotationErrors = 0;
  let warpedMapAddedEvents = 0;
  let firstMapTileLoadedEvents = 0;
  let spriteTileLoadedEvents = 0;
  const addedMapIds = new Set<string>();
  const imageInfoMapIds = new Set<string>();
  const firstTileMapIds = new Set<string>();
  const spriteTileMapIds = new Set<string>();
  const inViewportMapIds = new Set<string>();
  let fallbackInViewportCount = 0;
  let peakMapsInViewport = 0;
  let lastProgressAtMs = nowMs();
  let lastStatsEmitAtMs = 0;

  const layerIdSet = new Set(layerIds);
  let nativeUpdateQueued = false;
  function scheduleNativeUpdate(reason: string) {
    if (nativeUpdateQueued) return;
    nativeUpdateQueued = true;
    requestAnimationFrame(() => {
      nativeUpdateQueued = false;
      if (!safeHasMapLayer(map, layerIds[0])) return;
      if (debug) log?.("INFO", `[${label}] nativeUpdate tick reason=${reason}`);
      for (const l of layers) (l as any).nativeUpdate?.();
    });
  }

  const mapHandlers: { type: string; fn: (e: any) => void; tileCache?: any }[] = [];
  function onMap(type: string, fn: (e: any) => void) {
    const handler = (e: any) => { if (layerIdSet.has(e.layerId)) fn(e); };
    map.on(type as any, handler);
    mapHandlers.push({ type, fn: handler });
  }

  function getAllFetchableSet(): Set<string> {
    const combined = new Set<string>();
    for (const l of layers) {
      const renderer: any = (l as any).renderer;
      if (renderer?.mapsWithFetchableTilesForViewport instanceof Set) {
        for (const id of renderer.mapsWithFetchableTilesForViewport) combined.add(id);
      }
    }
    return combined;
  }

  function getWarpedMapFromAnyLayer(mapId: string): any {
    for (const l of layers) {
      const wm = (l as any).renderer?.warpedMapList?.getWarpedMap?.(mapId);
      if (wm) return wm;
    }
    return null;
  }

  function emitRenderStats(force = false) {
    const now = nowMs();
    if (!force && now - lastStatsEmitAtMs < 120) return;
    lastStatsEmitAtMs = now;
    const fetchableMaps = getAllFetchableSet().size;
    const subLayers: SubLayerRenderStats[] | undefined = layers.length > 1
      ? layers.map((l) => {
          const renderer: any = (l as any).renderer;
          return {
            registeredMaps: Array.from(renderer?.warpedMapList?.getWarpedMaps?.() ?? []).length,
            fetchableMaps: renderer?.mapsWithFetchableTilesForViewport instanceof Set ? renderer.mapsWithFetchableTilesForViewport.size : 0,
          };
        })
      : undefined;
    opts.onRenderStats?.({
      registeredMaps: mapsAdded,
      visibleMaps: mapsInViewport,
      fetchableMaps,
      firstTilesLoaded,
      peakVisibleMaps: peakMapsInViewport,
      subLayers,
    });
  }

  onMap("warpedmapadded", (e) => {
    const ids: string[] = e.mapIds ?? [];
    warpedMapAddedEvents++;
    for (const id of ids) addedMapIds.add(id);
    mapsAdded = addedMapIds.size || warpedMapAddedEvents;
    emitRenderStats();
    if (mapsAdded <= 5 || mapsAdded % NOISY_LOG_EVERY === 0) {
      log?.("INFO", `[${label}] warpedmapadded events:${warpedMapAddedEvents} maps:${mapsAdded} ids=[${ids.join(",")}]`);
    }
  });

  onMap("warpedmapremoved", (e) => {
    const ids: string[] = e.mapIds ?? [];
    log?.("WARN", `[${label}] warpedmapremoved ids=[${ids.join(",")}] (unexpected!)`);
  });

  onMap("imageinfosadded", (e) => {
    const ids: string[] = e.mapIds ?? [];
    for (const id of ids) imageInfoMapIds.add(id);
    imageInfosAdded = imageInfoMapIds.size || (imageInfosAdded + 1);
    lastProgressAtMs = nowMs();
    emitRenderStats();
    scheduleNativeUpdate("imageinfosadded");
    if (imageInfosAdded <= 5 || imageInfosAdded % NOISY_LOG_EVERY === 0) {
      log?.("INFO", `[${label}] imageinfosadded maps:${imageInfosAdded} ids=[${ids.join(",")}]`);
    }
  });

  onMap("firstmaptileloaded", (e) => {
    const ids: string[] = e.mapIds ?? [];
    firstMapTileLoadedEvents++;
    for (const id of ids) firstTileMapIds.add(id);
    firstTilesLoaded = firstTileMapIds.size || firstMapTileLoadedEvents;
    lastProgressAtMs = nowMs();
    emitRenderStats();
    if (firstTilesLoaded <= 5 || firstTilesLoaded % NOISY_LOG_EVERY === 0) {
      log?.("INFO", `[${label}] firstmaptileloaded events:${firstMapTileLoadedEvents} maps:${firstTilesLoaded} ids=[${ids.join(",")}]`);
    }
  });

  onMap("maptilesloadedfromsprites", (e) => {
    const ids: string[] = e.mapIds ?? [];
    spriteTileLoadedEvents++;
    for (const id of ids) spriteTileMapIds.add(id);
    lastProgressAtMs = nowMs();
    log?.("INFO", `[${label}] maptilesloadedfromsprites events:${spriteTileLoadedEvents} maps:${spriteTileMapIds.size || ids.length} ids=[${ids.join(",")}]`);
  });

  onMap("allrequestedtilesloaded", () => {
    log?.("INFO", `[${label}] allrequestedtilesloaded — registered:${mapsAdded} imgInfos:${imageInfosAdded} firstTiles:${firstTilesLoaded} inViewport:${mapsInViewport} tileErrs:${tileFetchErrors}`);
  });

  let tilesLoaded = 0;
  let tilesDeleted = 0;
  let lastTileActivityLog = 0;
  onMap("maptileloaded", () => {
    tilesLoaded++;
    lastProgressAtMs = nowMs();
  });
  onMap("maptiledeleted", () => {
    tilesDeleted++;
    const now = performance.now();
    if (now - lastTileActivityLog > 500) {
      log?.("WARN", `[${label}] maptiledeleted — activeTiles:${tilesLoaded - tilesDeleted} (loaded:${tilesLoaded} deleted:${tilesDeleted})`);
      lastTileActivityLog = now;
    }
  });

  onMap("warpedmapentered", (e) => {
    const ids: string[] = e.mapIds ?? [];
    if (ids.length > 0) {
      for (const id of ids) inViewportMapIds.add(id);
      mapsInViewport = inViewportMapIds.size;
    } else {
      fallbackInViewportCount++;
      mapsInViewport = inViewportMapIds.size || fallbackInViewportCount;
    }
    peakMapsInViewport = Math.max(peakMapsInViewport, mapsInViewport);
    lastProgressAtMs = nowMs();
    emitRenderStats();
    if (mapsInViewport <= 5 || mapsInViewport % 50 === 0) {
      log?.("INFO", `[${label}] warpedmapentered inViewport:${mapsInViewport}`);
    }
  });

  onMap("warpedmapleft", (e) => {
    const ids: string[] = e.mapIds ?? [];
    if (ids.length > 0) {
      for (const id of ids) inViewportMapIds.delete(id);
      mapsInViewport = inViewportMapIds.size;
    } else {
      fallbackInViewportCount = Math.max(0, fallbackInViewportCount - 1);
      mapsInViewport = inViewportMapIds.size || fallbackInViewportCount;
    }
    emitRenderStats();
    log?.("INFO", `[${label}] warpedmapleft ×${ids.length || 1} inViewport:${mapsInViewport}`);
  });

  for (const l of layers) {
    const tileCache = (l as any).renderer?.tileCache;
    if (tileCache) {
      const tileErrHandler = (e: any) => {
        tileFetchErrors++;
        log?.("ERROR", `[${label}] tilefetcherror #${tileFetchErrors} url=${e.data?.tileUrl ?? ""}`);
      };
      tileCache.addEventListener("tilefetcherror", tileErrHandler);
      mapHandlers.push({ type: "__tilefetcherror__", fn: tileErrHandler, tileCache });
    }
  }

  const cleanupRef = { interval: -1 as ReturnType<typeof setInterval> };
  runtime.activeLayerCleanup.set(groupId, () => {
    clearInterval(cleanupRef.interval);
    for (const h of mapHandlers) {
      if (h.type === "__tilefetcherror__") h.tileCache?.removeEventListener("tilefetcherror", h.fn);
      else map.off(h.type as any, h.fn);
    }
    log?.("INFO", `[${label}] cleanup: removed ${mapHandlers.length} handlers`);
  });

  type FetchedGeoreferencedMap =
    | { url: string; raw: unknown; fetchMs: number; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number }
    | { url: string; error: string };
  type FetchedSprite = {
    imageUrl: string;
    imageSize: [number, number];
    sprite: {
      imageId: string;
      scaleFactor: number;
      x: number;
      y: number;
      width: number;
      height: number;
      spriteTileScale?: number;
    };
  };
  type Fetched = { entry: RuntimeLayerEntry; maps: FetchedGeoreferencedMap[]; sprites: FetchedSprite[] } | { entry: RuntimeLayerEntry; error: string };

  try {
    const preloadStartedAt = nowMs();
    const valid = [...infoByServiceUrl.entries()].map(([serviceUrl, info]) => ({ ...info, "@id": serviceUrl, id: serviceUrl })).filter(Boolean);
    if (valid.length > 0) {
      step("warm-image-info:start", `targets=${valid.length}`);
      for (const l of layers) (l as any).addImageInfos?.(valid);
      step("warm-image-info:done", `${Math.round(nowMs() - preloadStartedAt)}ms valid=${valid.length}/${valid.length}`);
    }
  } catch (e: any) {
    log?.("WARN", `[${label}] image info pre-warm failed before map ingest: ${e?.message ?? e}`);
    step("warm-image-info:error", String(e?.message ?? e));
  }

  const fetchedAll = await Promise.all(entries.map(async (entry): Promise<Fetched> => {
    if (!entry.inlineMaps?.length) return { entry, error: "noGeoreferencedMap" };
    return {
      entry,
      maps: entry.inlineMaps.map((a) => ({
        url: a.url,
        raw: a.raw,
        fetchMs: 0,
        spriteRef: a.spriteRef,
        placeholderWidth: a.placeholderWidth,
        placeholderHeight: a.placeholderHeight,
      })),
      sprites: entry.inlineSprites ?? [],
    };
  }));
  step("collect-maps", `entries=${fetchedAll.length}`);

  const viewportCenter = (() => {
    try {
      const center = map.getCenter();
      return [center.lng, center.lat] as [number, number];
    } catch {
      return null;
    }
  })();

  const BOOTSTRAP_MAP_LIMIT = 24;
  const prioritizedFetched = [...fetchedAll].sort((a, b) => scoreEntryForViewport(a.entry, viewportCenter) - scoreEntryForViewport(b.entry, viewportCenter));
  const bootstrapFetched: Fetched[] = [];
  const backgroundFetched: Fetched[] = [];
  let bootstrapMapBudget = 0;
  for (const item of prioritizedFetched) {
    const itemMapCount = "maps" in item ? item.maps.filter((m) => "raw" in m).length : 0;
    if (bootstrapFetched.length < 1 || bootstrapMapBudget < BOOTSTRAP_MAP_LIMIT) {
      bootstrapFetched.push(item);
      bootstrapMapBudget += itemMapCount;
    } else {
      backgroundFetched.push(item);
    }
  }
  step("bootstrap-selection", `entries=${bootstrapFetched.length} maps=${bootstrapMapBudget} remaining=${backgroundFetched.length}`);

  let done = 0;
  const applyStartedAt = nowMs();
  const slowManifestThresholdMs = 50;
  const subLayerAssignments = Array.from({ length: layers.length }, () => ({ manifests: 0, maps: 0 }));
  const subLayerCompletionMs = Array.from({ length: layers.length }, () => 0);
  const applyDiagnostics: Array<{ label: string; manifestUrl: string; mapCount: number; canvasCount: number; addedCount: number; failedCount: number; ms: number; subLayerIndex: number }> = [];

  async function applyFetchedBatch(batch: Fetched[], startIndex: number, mode: "sequential" | "parallel" | "chunked"): Promise<RunResult[]> {
    const runOne = async (item: Fetched, idx: number): Promise<RunResult> =>
      (async (): Promise<RunResult> => {
        const subLayerIndex = idx % layers.length;
        const targetLayer = layers[subLayerIndex];
        const compiledManifestUrl = toAbsoluteUrl(cfg.datasetBaseUrl, item.entry.compiledManifestPath);
        const startedAtISO = new Date().toISOString();
        const t0 = nowMs();

        if ("error" in item) {
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: 0,
            steps: [{ step: "fetch_georeferenced_map", ms: 0, ok: item.error === "noGeoreferencedMap", detail: item.error }],
            ok: item.error === "noGeoreferencedMap",
            error: item.error === "noGeoreferencedMap" ? undefined : item.error,
          };
        }

        const okMaps = item.maps.filter((a): a is { url: string; raw: unknown; fetchMs: number; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number } => "raw" in a);
        const failedMaps = item.maps.filter((a): a is { url: string; error: string } => "error" in a);
        subLayerAssignments[subLayerIndex].manifests++;
        subLayerAssignments[subLayerIndex].maps += okMaps.length;

        const totalFetchMs = okMaps.reduce((sum, a) => sum + a.fetchMs, 0);
        const steps: StepTiming[] = [{
          step: "fetch_georeferenced_map",
          ms: totalFetchMs,
          ok: okMaps.length > 0,
          detail: `ok=${okMaps.length}/${item.maps.length}`,
        }];

        if (okMaps.length === 0) {
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: false,
            error: `All georeferenced map loads failed (${failedMaps.length})`,
          };
        }

        try {
          const ts2 = nowMs();
          const mapResults = await Promise.allSettled(okMaps.map((a) => targetLayer.addGeoreferencedMap(a.raw)));
          const allmapsResults: Array<string | Error> = [];
          for (const result of mapResults) {
            if (result.status === "fulfilled") allmapsResults.push(result.value);
            else allmapsResults.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
          }
          const failed = allmapsResults.filter((r): r is Error => r instanceof Error);
          if (failed.length > 0) {
            manifestsWithAnnotationErrors++;
            annotationErrorCount += failed.length;
          }
          const failedMessages = failed.map((err) => err.message);
          for (const err of failed) log?.("ERROR", `annotation error [${item.entry.label} | ${deriveAllmapsManifestUrl(item.entry)}]: ${err.message}`);
          if (!allmapsResults.some((r) => typeof r === "string")) throw new Error("No maps loaded from georeferenced maps.");
          const succeeded = allmapsResults.filter((r): r is string => typeof r === "string");
          const applyMs = nowMs() - ts2;
          applyDiagnostics.push({
            label: item.entry.label,
            manifestUrl: item.entry.sourceManifestUrl,
            mapCount: okMaps.length,
            canvasCount: item.entry.canvasCount ?? okMaps.length,
            addedCount: succeeded.length,
            failedCount: failed.length,
            ms: applyMs,
            subLayerIndex,
          });
          subLayerCompletionMs[subLayerIndex] = Math.max(subLayerCompletionMs[subLayerIndex], applyMs);
          if (applyMs >= slowManifestThresholdMs) {
            step("apply-manifest:slow", `${Math.round(applyMs)}ms layer=${subLayerIndex} label="${item.entry.label}" canvases=${item.entry.canvasCount ?? "?"} maps=${okMaps.length} added=${succeeded.length} failed=${failed.length}`);
          }
          for (let resultIndex = 0; resultIndex < allmapsResults.length; resultIndex++) {
            const mapId = allmapsResults[resultIndex];
            if (typeof mapId !== "string") continue;
            const sourceMap = okMaps[resultIndex];
            mapMetaByMapId.set(mapId, { label: item.entry.label, manifestAllmapsUrl: deriveAllmapsManifestUrl(item.entry) });
            runtime.mapIdToManifestInfo.set(mapId, {
              sourceManifestUrl: item.entry.sourceManifestUrl,
              label: item.entry.label,
              compiledManifestPath: item.entry.compiledManifestPath,
              manifestAllmapsUrl: deriveAllmapsManifestUrl(item.entry),
              spriteRef: sourceMap?.spriteRef,
              placeholderWidth: sourceMap?.placeholderWidth,
              placeholderHeight: sourceMap?.placeholderHeight,
            });
          }
          steps.push({
            step: "allmaps_add_georeferenced_map",
            ms: applyMs,
            ok: failed.length === 0,
            detail: `added=${succeeded.join(",")}${failed.length ? `; annotationErrors=${failed.length}` : ""}`,
          });

          return {
            manifestUrl: compiledManifestUrl,
            annotationUrl: okMaps[0]?.url,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: true,
            annotationErrorCount: failed.length,
            annotationErrors: failedMessages,
          };
        } catch (err: any) {
          return {
            manifestUrl: compiledManifestUrl,
            manifestLabel: item.entry.label,
            sourceManifestUrl: item.entry.sourceManifestUrl,
            allmapsManifestUrl: deriveAllmapsManifestUrl(item.entry),
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: false,
            error: String(err?.message ?? err),
          };
        }
      })().then((result) => {
        done++;
        opts.onProgress?.(done, entries.length, result);
        return result;
      });

    if (mode === "sequential") {
      const out: RunResult[] = [];
      for (let i = 0; i < batch.length; i++) out.push(await runOne(batch[i], startIndex + i));
      return out;
    }
    if (mode === "chunked") {
      const out: RunResult[] = [];
      const BACKGROUND_BATCH_SIZE = 6;
      for (let i = 0; i < batch.length; i += BACKGROUND_BATCH_SIZE) {
        const slice = batch.slice(i, i + BACKGROUND_BATCH_SIZE);
        out.push(...await Promise.all(slice.map((item, index) => runOne(item, startIndex + i + index))));
        if (i + BACKGROUND_BATCH_SIZE < batch.length) await nextFrame();
      }
      return out;
    }
    return Promise.all(batch.map((item, index) => runOne(item, startIndex + index)));
  }

  function getSpriteGroups(items: Fetched[]) {
    const spriteGroupsByLayer = Array.from({ length: layers.length }, () => new Map<string, { imageUrl: string; imageSize: [number, number]; sprites: FetchedSprite["sprite"][] }>());
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!("sprites" in item) || item.sprites.length === 0) continue;
      const subLayerIndex = idx % layers.length;
      const groups = spriteGroupsByLayer[subLayerIndex];
      for (const spriteItem of item.sprites) {
        const key = `${spriteItem.imageUrl}::${spriteItem.imageSize[0]}x${spriteItem.imageSize[1]}`;
        const existing = groups.get(key);
        if (existing) existing.sprites.push(spriteItem.sprite);
        else groups.set(key, { imageUrl: spriteItem.imageUrl, imageSize: spriteItem.imageSize, sprites: [spriteItem.sprite] });
      }
    }
    return spriteGroupsByLayer;
  }

  let initializedSpriteTargets = 0;
  async function initializeSpritesForItems(items: Fetched[]) {
    try {
      const spriteStartedAt = nowMs();
      const spriteGroupsByLayer = getSpriteGroups(items);
      const totalSpriteTargets = spriteGroupsByLayer.reduce((sum, groups) => sum + groups.size, 0);
      const totalSprites = spriteGroupsByLayer.reduce((sum, groups) => sum + [...groups.values()].reduce((inner, group) => inner + group.sprites.length, 0), 0);
      initializedSpriteTargets = totalSpriteTargets;
      if (totalSpriteTargets > 0) {
        step("init-sprites:start", `targets=${totalSpriteTargets} sprites=${totalSprites}`);
        await Promise.all(
          spriteGroupsByLayer.flatMap((groups, index) =>
            [...groups.values()].map(async (group, groupIndex) => {
              const startedAt = nowMs();
              step("init-sprites:addSprites:start", `layer=${index} group=${groupIndex + 1}/${groups.size} sprites=${group.sprites.length} imageSize=${group.imageSize[0]}x${group.imageSize[1]} imageUrl=${group.imageUrl}`);
              await layers[index].addSprites(group.sprites as any, group.imageUrl, group.imageSize);
              step("init-sprites:addSprites:done", `${Math.round(nowMs() - startedAt)}ms layer=${index} group=${groupIndex + 1}/${groups.size} sprites=${group.sprites.length}`);
            })
          )
        );
        step("init-sprites:done", `${Math.round(nowMs() - spriteStartedAt)}ms targets=${totalSpriteTargets} sprites=${totalSprites}`);
      }
    } catch (e: any) {
      log?.("WARN", `[${label}] sprite init failed: ${e?.message ?? e}`);
      step("init-sprites:error", String(e?.message ?? e));
    }
  }

  if (parallelLoading) {
    step("load-mode", "parallel");
    results.push(...await applyFetchedBatch(fetchedAll, 0, "parallel"));
  } else {
    step("load-mode", "phased");
    results.push(...await applyFetchedBatch(bootstrapFetched, 0, "sequential"));
    results.push(...await applyFetchedBatch(backgroundFetched, bootstrapFetched.length, "chunked"));
  }

  const totalGeoreferencedMaps = fetchedAll.reduce((sum, item) => sum + ("maps" in item ? item.maps.length : 0), 0);
  const totalCanvasRefs = fetchedAll.reduce((sum, item) => sum + (item.entry.canvasCount ?? ("maps" in item ? item.maps.length : 0)), 0);
  const slowestDiagnostics = [...applyDiagnostics].sort((a, b) => b.ms - a.ms).slice(0, 10);
  step("apply-annotations", `${Math.round(nowMs() - applyStartedAt)}ms ok=${results.filter((r) => r.ok).length}/${results.length} annotationErrors=${annotationErrorCount} maps=${totalGeoreferencedMaps} canvases=${totalCanvasRefs}`);
  if (layers.length > 1) {
    step("apply-annotations:sublayers", subLayerAssignments.map((item, index) => `layer${index}=m${item.manifests}/g${item.maps}/t${Math.round(subLayerCompletionMs[index])}ms`).join(" | "));
  }
  if (slowestDiagnostics.length > 0) {
    step("apply-annotations:slowest", slowestDiagnostics.map((item) => `${Math.round(item.ms)}ms[l${item.subLayerIndex}] "${item.label}" c=${item.canvasCount} g=${item.mapCount}`).join(" | "));
  }
  await initializeSpritesForItems(fetchedAll);

  if (initialRenderMaps && !spriteOnly) {
    for (const layer of layers) {
      layer.setLayerOptions({ visible: true } as any);
      (layer as any).nativeUpdate?.();
    }
    step("init-layer:visible", `layers=${layers.length}`);
  }

  function logViewportVsFetchable(tag: string) {
    const fetchableSet = getAllFetchableSet();
    const inViewportIds = [...inViewportMapIds];
    const visibleNotFetchable = inViewportIds.filter((id) => !fetchableSet.has(id));
    const byLabel = new Map<string, number>();
    for (const mapId of visibleNotFetchable) {
      const lbl = mapMetaByMapId.get(mapId)?.label ?? "(unknown)";
      byLabel.set(lbl, (byLabel.get(lbl) ?? 0) + 1);
    }
    const topLabels = [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([lbl, n]) => `${lbl}:${n}`).join(" | ");
    log?.("INFO", `[${label}] ${tag} visibleNotFetchable:${visibleNotFetchable.length}/${inViewportIds.length} fetchable:${fetchableSet.size} top=${topLabels || "none"}`);
  }

  function logVisibleNotFetchableReasons(tag: string) {
    const fetchableSet = getAllFetchableSet();
    if (!layers.some((l) => (l as any).renderer?.warpedMapList?.getWarpedMap)) {
      log?.("WARN", `[${label}] ${tag} reason-analysis unavailable (no warpedMapList)`);
      return;
    }

    const reasons = { noImage: 0, noViewportIntersection: 0, noTileZoom: 0, notInFetchableSet: 0 };
    const labelBuckets = new Map<string, number>();

    for (const mapId of inViewportMapIds) {
      if (fetchableSet.has(mapId)) continue;

      const wm: any = getWarpedMapFromAnyLayer(mapId);
      const meta = mapMetaByMapId.get(mapId);
      const mapLabel = meta?.label ?? "(unknown)";
      labelBuckets.set(mapLabel, (labelBuckets.get(mapLabel) ?? 0) + 1);

      const hasImage = wm?.hasImage?.() ?? false;
      if (!hasImage) reasons.noImage++;

      const hasIntersection = Boolean(wm?.resourceBufferedViewportRingBboxAndResourceMaskBboxIntersectionForViewport);
      if (!hasIntersection) reasons.noViewportIntersection++;

      const hasTileZoom = Boolean(wm?.tileZoomLevelForViewport);
      if (!hasTileZoom) reasons.noTileZoom++;

      reasons.notInFetchableSet++;
    }

    const topLabels = [...labelBuckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([lbl, n]) => `${lbl}:${n}`).join(" | ");
    log?.("INFO", `[${label}] ${tag} reasons notInFetchable:${reasons.notInFetchableSet} noImage:${reasons.noImage} noViewportIntersection:${reasons.noViewportIntersection} noTileZoom:${reasons.noTileZoom} top=${topLabels || "none"}`);
  }

  if (initializedSpriteTargets === 0) {
    // No periodic repaint loop: we rely on event-driven scheduleNativeUpdate().
  } else {
    step("init-render-loop:skip", `reason=sprites targets=${initializedSpriteTargets}`);
  }

  step("ingestion-ready", `manifests=${results.length} peakVisible=${peakMapsInViewport} firstTiles=${firstTilesLoaded}`);
  const stepTotals = new Map<string, { ms: number; count: number; ok: number; fail: number }>();
  for (const r of results) {
    for (const s of r.steps ?? []) {
      const entry = stepTotals.get(s.step) ?? { ms: 0, count: 0, ok: 0, fail: 0 };
      entry.ms += Number(s.ms) || 0;
      entry.count += 1;
      if (s.ok) entry.ok += 1;
      else entry.fail += 1;
      stepTotals.set(s.step, entry);
    }
  }
  if (stepTotals.size > 0) {
    const totalMs = Math.max(1, timer.getTotalMs());
    const summary = [...stepTotals.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10).map(([stepName, t]) => {
      const pct = Math.round((t.ms / totalMs) * 100);
      return `${stepName}=${Math.round(t.ms)}ms(${pct}%) n=${t.count} ok=${t.ok} fail=${t.fail}`;
    }).join(" | ");
    step("manifest-step-totals", summary);
  }

  emitRenderStats(true);
  if (debug) {
    logViewportVsFetchable("viewport-diff(final)");
    logVisibleNotFetchableReasons("viewport-reasons(final)");
  }
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log?.("INFO", `Layer "${label}" done: ${ok} ok, ${failed} failed | registered:${mapsAdded} imgInfos:${imageInfosAdded} firstTiles:${firstTilesLoaded} activeTiles:${tilesLoaded - tilesDeleted} tileErrs:${tileFetchErrors} annotationErrs:${annotationErrorCount} manifestsWithAnnotationErrs:${manifestsWithAnnotationErrors}`);
  step("run:done", `ok=${ok} failed=${failed} total=${Math.round(nowMs() - runStartedAt)}ms`);

  return results;
}

function emitIiifStep(log: IiifLog | undefined, layerLabel: string, step: string, detail?: string) {
  const message = `[IIIF] ${layerLabel} :: ${step}${detail ? ` :: ${detail}` : ""}`;
  log?.("INFO", message);
  console.info(message);
}

function createIiifRunTimer(opts: { log?: IiifLog; layerLabel: string }) {
  const { log, layerLabel } = opts;
  const startedAt = nowMs();
  let lastAt = startedAt;

  const step = (stepName: string, detail?: string) => {
    const at = nowMs();
    const deltaMs = at - lastAt;
    lastAt = at;
    const timing = `+${Math.round(deltaMs)}ms total=${Math.round(at - startedAt)}ms`;
    emitIiifStep(log, layerLabel, stepName, detail ? `${timing} :: ${detail}` : timing);
  };

  return {
    step,
    getTotalMs: () => nowMs() - startedAt,
  };
}
