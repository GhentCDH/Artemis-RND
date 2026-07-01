import { WarpedMapLayer } from "@allmaps/maplibre";
import type maplibregl from "maplibre-gl";
import type { RunResult, StepTiming, SpriteRef } from "$lib/artemis/shared/types";
import { fetchJson, joinUrl, nowMs } from "$lib/artemis/shared/utils";
import { getAllmapsDebugMapOptions } from "$lib/artemis/config/allmapsDebug";
import {
  loadNewIiifEntries,
  resolveTilesConfig,
  resolveMasksPath,
  type CompiledRunnerConfig,
  type LayerInfo,
} from "./bundleLoader";
import { toIiifTileTemplate, prefetchIiifTileManifest } from "./tileProtocol";
import {
  getLayerGroupId,
  getMaskLayerIds,
  getPaneRuntime,
  removeLayerGroup,
  removeMaplibreLayer,
  safeHasMapLayer,
  waitForMapReady,
  type PaneRuntimeId,
} from "./runtime";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Map zoom at/above which the (expensive) Allmaps mesh-warping pipeline is loaded for a group.
// Below this the pre-warped raster tile pyramid is the renderer on its own — visually equivalent
// to Allmaps at overview zoom, but free of the multi-second triangulation cost. 11.5 sits just
// below the pyramid's native max detail (z12), giving triangulation a head start before the user
// reaches zooms where the raster starts to soften and Allmaps' full-resolution warp is worth it.
const ALLMAPS_TRIGGER_ZOOM = 11.5;

function toAbsoluteUrl(baseUrl: string, maybePathOrUrl: string): string {
  if (/^https?:\/\//i.test(maybePathOrUrl)) return maybePathOrUrl;
  return joinUrl(baseUrl, maybePathOrUrl);
}

function scoreEntryForViewport(
  entry: { inlineMaps?: Array<{ raw: unknown }> },
  viewportCenter: [number, number] | null
): number {
  if (!viewportCenter) return Number.POSITIVE_INFINITY;
  const entryCenter = getEntryGeoCenter(entry);
  if (!entryCenter) return Number.POSITIVE_INFINITY;
  const dx = entryCenter[0] - viewportCenter[0];
  const dy = entryCenter[1] - viewportCenter[1];
  return dx * dx + dy * dy;
}

function getEntryGeoCenter(entry: { inlineMaps?: Array<{ raw: unknown }> }): [number, number] | null {
  const coords: Array<[number, number]> = [];
  for (const item of entry.inlineMaps ?? []) {
    const gcps = (item.raw as any)?.gcps;
    if (!Array.isArray(gcps)) continue;
    for (const gcp of gcps) {
      const geo = gcp?.geo;
      if (!Array.isArray(geo) || geo.length < 2) continue;
      const lon = Number(geo[0]);
      const lat = Number(geo[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) coords.push([lon, lat]);
    }
  }
  if (coords.length === 0) return null;
  const [sumLon, sumLat] = coords.reduce(([accLon, accLat], [lon, lat]) => [accLon + lon, accLat + lat], [0, 0]);
  return [sumLon / coords.length, sumLat / coords.length];
}

export async function initializeLayerGroup(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;
  layerInfo: LayerInfo;
  paneId?: PaneRuntimeId;
  initialRenderMaps?: boolean;
  spriteOnly?: boolean;
  parallelLoading?: boolean;
  spriteDebugMode?: boolean;
  /** Skip the Allmaps pipeline entirely — gr_sprite WebGL layer stays visible. Use to benchmark the placeholder phase in isolation. */
  grSpriteOnly?: boolean;
}): Promise<RunResult[]> {
  const { map, cfg, layerInfo, paneId = "main", initialRenderMaps = true, spriteOnly = false, parallelLoading = false, spriteDebugMode = false, grSpriteOnly = false } = opts;
  const runtime = getPaneRuntime(paneId);
  const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;

  // Step timing/logging: every stage of activation logs a `[IIIF <layer> · <pane>] step … Nms`
  // line so the load pipeline (tiles → bundle → zoom trigger → warp batches) is profilable in the
  // browser console. `nowMs()` is a monotonic performance.now() from shared utils.
  const logTag = `[IIIF ${layerLabel} · ${paneId}]`;
  const activationT0 = nowMs();
  const log = (msg: string) => console.log(`${logTag} ${msg}`);

  await waitForMapReady(map);

  const groupId = getLayerGroupId(layerInfo);

  if (runtime.parkedLayersByGroup.has(groupId)) {
    const parked = runtime.parkedLayersByGroup.get(groupId)!;
    runtime.parkedLayersByGroup.delete(groupId);
    runtime.activeLayersByGroup.set(groupId, parked.layerIds);
    runtime.activeWarpedLayersByGroup.set(groupId, parked.warpedLayers);
    return [];
  }

  await removeLayerGroup(map, groupId, paneId);

  if (!layerInfo.geomapsPath) {
    throw new Error(`IIIF layer "${layerLabel}" has no geomapsPath`);
  }

  const timeout = cfg.fetchTimeoutMs ?? 30000;
  // Don't await yet: the geomaps bundle fetch (+ its own sequential regular-sprites-json fetch)
  // shouldn't block WarpedMapLayer/tile-placeholder setup below, since neither depends on it.
  const loadedPromise = loadNewIiifEntries(cfg, layerInfo, timeout, spriteDebugMode);

  // Pre-warped tile pyramid mode: show near-instant preview tiles, then progressively warp via
  // Allmaps underneath. WarpedMapLayer goes in first (bottom of stack)
  const results: RunResult[] = [];
  const chunkCount = 1;
  const layerIds = Array.from({ length: chunkCount }, (_, i) => `warped-layer-${groupId.replace(/\//g, "-")}${chunkCount > 1 ? `-${i}` : ""}`);
  const layers: WarpedMapLayer[] = [];
  const allmapsMapOptions = getAllmapsDebugMapOptions(layerInfo);
  for (let i = 0; i < chunkCount; i++) {
    await removeMaplibreLayer(map, layerIds[i]);
    const l = new WarpedMapLayer({ layerId: layerIds[i] } as any);
    try {
      map.addLayer(l as any);
      layers.push(l);
    } catch (e: any) {
      return [];
    }
  }
  // Deferred-Allmaps trigger state (see ALLMAPS_TRIGGER_ZOOM). The pipeline is loaded lazily on
  // zoom-in rather than eagerly on activation; `detachZoomTrigger` is folded into the raster
  // cleanup below so tearing down the group (or removeLayerGroup) also unhooks the pending trigger.
  let allmapsStarted = false;
  let zoomTriggerHandler: (() => void) | null = null;
  const detachZoomTrigger = () => {
    if (!zoomTriggerHandler) return;
    try {
      map.off("zoom", zoomTriggerHandler);
    } catch {
      // ignore — map may already be torn down
    }
    zoomTriggerHandler = null;
  };

  // The pre-warped raster tile pyramid goes on top — it's the group's base renderer while Allmaps
  // is deferred, and masks WarpedMapLayer once Allmaps does load underneath. Native MapLibre
  // `raster` source, resolved synchronously from `layerInfo` (no manifest fetch): MapLibre requests
  // only the visible {z}/{x}/{y} tiles on demand. Its id joins `layerIds` so reorder/teardown track
  // it like any other group layer.
  const tilesConfig = resolveTilesConfig(layerInfo);
  const tilesSourceId = `iiif-tiles-source-${groupId.replace(/\//g, "-")}`;
  const tilesLayerId = `iiif-tiles-layer-${groupId.replace(/\//g, "-")}`;
  // One-shot listener that logs when the first preview tile actually paints (raster sources over
  // irregular coverage 404 on tiles outside the surveyed extent — expected and harmless — so we
  // report the first tile that loads, not source metadata). Detached on teardown or after firing.
  let detachTilesProbe: (() => void) | null = null;
  if (tilesConfig) {
    try {
      const tilesT0 = nowMs();
      // Warm the pyramid's tiles_manifest.json so the `iiiftiles://` protocol can gate the very
      // first tile requests (missing tiles answered transparently → no 404s in the console).
      const tilesHttpTemplate = joinUrl(cfg.datasetBaseUrl, tilesConfig.template);
      prefetchIiifTileManifest(tilesHttpTemplate.replace(/\{z\}\/\{x\}\/\{y\}\.webp.*$/, "tiles_manifest.json"));
      if (!map.getSource(tilesSourceId)) {
        map.addSource(tilesSourceId, {
          type: "raster",
          tiles: [toIiifTileTemplate(tilesHttpTemplate)],
          tileSize: 256,
          minzoom: tilesConfig.minZoom,
          maxzoom: tilesConfig.maxZoom,
        });
      }
      if (!map.getLayer(tilesLayerId)) {
        map.addLayer({
          id: tilesLayerId,
          type: "raster",
          source: tilesSourceId,
          paint: { "raster-opacity": 0.85 },
        });
        layerIds.push(tilesLayerId);
      }
      log(`tiles: raster placeholder added (z${tilesConfig.minZoom}-${tilesConfig.maxZoom}) +${(nowMs() - activationT0).toFixed(0)}ms`);
      const onTilesData = (e: any) => {
        if (e?.sourceId !== tilesSourceId || !e?.tile) return;
        log(`tiles: first tile painted ${(nowMs() - tilesT0).toFixed(0)}ms`);
        detachTilesProbe?.();
      };
      detachTilesProbe = () => {
        try { map.off("sourcedata", onTilesData); } catch { /* map torn down */ }
        detachTilesProbe = null;
      };
      map.on("sourcedata", onTilesData);
      // The presence of this cleanup entry is also how `parkLayerGroup` detects that Allmaps is
      // still deferred for this group (nothing expensive triangulated yet) — startAllmaps() deletes
      // it once the pipeline runs.
      runtime.activeLayerCleanup.set(groupId, () => {
        detachZoomTrigger();
        detachTilesProbe?.();
        if (map.getLayer(tilesLayerId)) map.removeLayer(tilesLayerId);
        if (map.getSource(tilesSourceId)) map.removeSource(tilesSourceId);
      });
    } catch {
      // non-fatal — continue to normal Allmaps loading without placeholders
    }
  }

  // Pre-baked canvas-footprint vector tiles (PMTiles) — replaces building clickable outlines from
  // Allmaps' live geoMask geometry. Static data, independent of Allmaps triangulation progress, so
  // hover/click work the instant this source loads regardless of how far Allmaps has gotten below.
  // Persistent for the group's whole lifetime (unlike the transient tile placeholder above).
  //
  // Only an invisible `fill` layer is added here, purely for `queryRenderedFeatures` hit-testing.
  // There is deliberately no filtered vector `line` layer for the hover outline: `manifestUrl` is
  // NOT guaranteed unique per canvas (a manifest can have multiple canvases, e.g. 111 features but
  // only 103 distinct manifestUrls for Gereduceerd Kadaster) — filtering a shared line layer by
  // that property would highlight every sibling canvas sharing a manifest, not just the hovered
  // one. Instead, callers draw the hover outline from the exact queried feature's own geometry via
  // a single shared GeoJSON layer (`setIiifMaskHover` in mapInit.ts) — see ArtemisApp.svelte.
  const masksPath = resolveMasksPath(layerInfo);
  const { sourceId: masksSourceId, fillLayerId: masksFillLayerId } = getMaskLayerIds(groupId);
  if (masksPath) {
    try {
      if (!map.getSource(masksSourceId)) {
        map.addSource(masksSourceId, {
          type: "vector",
          url: `pmtiles://${joinUrl(cfg.datasetBaseUrl, masksPath)}`,
        });
      }
      if (!map.getLayer(masksFillLayerId)) {
        map.addLayer({
          id: masksFillLayerId,
          type: "fill",
          source: masksSourceId,
          "source-layer": "masks",
          paint: { "fill-opacity": 0 },
        });
        layerIds.push(masksFillLayerId);
      }
    } catch {
      // non-fatal — continue without clickable mask outlines
    }
  }

  runtime.activeLayersByGroup.set(groupId, layerIds);
  runtime.activeWarpedLayersByGroup.set(groupId, layers);

  const loaded = await loadedPromise;
  const infoByServiceUrl = loaded.infoByServiceUrl;
  const entriesUnfiltered = loaded.entries;
  const entries = entriesUnfiltered.filter((entry) => {
    if (layerInfo.renderLayerKey === "verzamelblad") return entry.isVerzamelblad === true;
    if (layerInfo.renderLayerKey === "default") return entry.isVerzamelblad !== true;
    return true;
  });
  const canvasCount = entries.reduce((sum, e) => sum + (e.inlineMaps?.length ?? 0), 0);
  log(`bundle: loaded ${entries.length} manifests / ${canvasCount} canvases in ${(nowMs() - activationT0).toFixed(0)}ms`);

  // Index manifest info by sourceManifestUrl too (not just by Allmaps mapId below) — available
  // immediately from the bundle, independent of Allmaps triangulation timing, so mask-based clicks
  // can open the viewer even before Allmaps has processed that canvas.
  //
  // Also index per canvas by every identifier a mask feature's `imageId` might carry (its
  // `canvasAllmapsId` and its `imageServiceUrl`): a `manifestUrl` alone can't disambiguate which
  // canvas was clicked when several canvases share one manifest (e.g. up to 13 for Primitief
  // Kadaster), so clicks resolve by canvas key first and carry that canvas's own imageServiceUrl.
  for (const entry of entries) {
    if (!entry.sourceManifestUrl) continue;
    const firstMap = entry.inlineMaps?.[0];
    runtime.sourceManifestUrlToManifestInfo.set(entry.sourceManifestUrl, {
      sourceManifestUrl: entry.sourceManifestUrl,
      label: entry.label,
      compiledManifestPath: entry.compiledManifestPath,
      manifestAllmapsUrl: entry.manifestAllmapsUrl,
      spriteRef: firstMap?.spriteRef,
      placeholderWidth: firstMap?.placeholderWidth,
      placeholderHeight: firstMap?.placeholderHeight,
    });
    for (const canvasMap of entry.inlineMaps ?? []) {
      const canvasInfo = {
        sourceManifestUrl: entry.sourceManifestUrl,
        label: entry.label,
        compiledManifestPath: entry.compiledManifestPath,
        manifestAllmapsUrl: entry.manifestAllmapsUrl,
        imageServiceUrl: canvasMap.imageServiceUrl,
        spriteRef: canvasMap.spriteRef,
        placeholderWidth: canvasMap.placeholderWidth,
        placeholderHeight: canvasMap.placeholderHeight,
      };
      for (const key of [canvasMap.canvasAllmapsId, canvasMap.imageServiceUrl]) {
        if (key) runtime.canvasKeyToManifestInfo.set(key, canvasInfo);
      }
    }
  }

  if (grSpriteOnly) return results;

  function nativeUpdateAll() {
    if (!safeHasMapLayer(map, layerIds[0])) return;
    for (const l of layers) (l as any).nativeUpdate?.();
  }

  type FetchedGeoreferencedMap =
    | { url: string; raw: unknown; fetchMs: number; canvasAllmapsId?: string; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number }
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
  type Fetched = { entry: any; maps: FetchedGeoreferencedMap[]; sprites: FetchedSprite[] } | { entry: any; error: string };

  try {
    const valid = [...infoByServiceUrl.entries()].map(([serviceUrl, info]) => ({ ...info, "@id": serviceUrl, id: serviceUrl })).filter(Boolean);
    if (valid.length > 0) {
      for (const l of layers) (l as any).addImageInfos?.(valid);
    }
  } catch (e: any) {
    void e;
  }

  const fetchedAll = await Promise.all(entries.map(async (entry): Promise<Fetched> => {
    if (!entry.inlineMaps?.length) return { entry, error: "noGeoreferencedMap" };
    return {
      entry,
      maps: entry.inlineMaps.map((a) => ({
        url: a.url,
        raw: a.raw,
        fetchMs: 0,
        canvasAllmapsId: a.canvasAllmapsId,
        spriteRef: a.spriteRef,
        placeholderWidth: a.placeholderWidth,
        placeholderHeight: a.placeholderHeight,
      })),
      sprites: entry.inlineSprites ?? [],
    };
  }));

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
            allmapsManifestUrl: item.entry.manifestAllmapsUrl,
            startedAtISO,
            totalMs: 0,
            steps: [{ step: "fetch_georeferenced_map", ms: 0, ok: item.error === "noGeoreferencedMap", detail: item.error }],
            ok: item.error === "noGeoreferencedMap",
            error: item.error === "noGeoreferencedMap" ? undefined : item.error,
          };
        }

        const allmapsManifestUrl = item.entry.manifestAllmapsUrl;
        if (!allmapsManifestUrl) {
          throw new Error(
            `Missing manifestAllmapsUrl for "${item.entry.label}" (${item.entry.sourceManifestUrl}). ` +
              `This should come from the geomaps JSON (resource.partOf…id).`
          );
        }

        const okMaps = item.maps.filter((a): a is { url: string; raw: unknown; fetchMs: number; canvasAllmapsId?: string; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number } => "raw" in a);
        const failedMaps = item.maps.filter((a): a is { url: string; error: string } => "error" in a);

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
            allmapsManifestUrl,
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: false,
            error: `All georeferenced map loads failed (${failedMaps.length})`,
          };
        }

        try {
          const ts2 = nowMs();
          const mapResults = await Promise.allSettled(okMaps.map((a) => targetLayer.addGeoreferencedMap(a.raw, allmapsMapOptions)));
          const allmapsResults: Array<string | Error> = [];
          for (const result of mapResults) {
            if (result.status === "fulfilled") allmapsResults.push(result.value);
            else allmapsResults.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
          }
          const failed = allmapsResults.filter((r): r is Error => r instanceof Error);
          const failedMessages = failed.map((err) => err.message);
          if (!allmapsResults.some((r) => typeof r === "string")) throw new Error("No maps loaded from georeferenced maps.");
          const succeeded = allmapsResults.filter((r): r is string => typeof r === "string");
          const applyMs = nowMs() - ts2;
          for (let resultIndex = 0; resultIndex < allmapsResults.length; resultIndex++) {
            const mapId = allmapsResults[resultIndex];
            if (typeof mapId !== "string") continue;
            const sourceMap = okMaps[resultIndex];
            runtime.mapIdToManifestInfo.set(mapId, {
              sourceManifestUrl: item.entry.sourceManifestUrl,
              label: item.entry.label,
              compiledManifestPath: item.entry.compiledManifestPath,
              manifestAllmapsUrl: allmapsManifestUrl,
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
            allmapsManifestUrl,
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
            allmapsManifestUrl: item.entry.manifestAllmapsUrl,
            startedAtISO,
            totalMs: nowMs() - t0,
            steps,
            ok: false,
            error: String(err?.message ?? err),
          };
        }
      })();

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
      const spriteGroupsByLayer = getSpriteGroups(items);
      const totalSpriteTargets = spriteGroupsByLayer.reduce((sum, groups) => sum + groups.size, 0);
      initializedSpriteTargets = totalSpriteTargets;
      if (totalSpriteTargets > 0) {
        await Promise.all(
          spriteGroupsByLayer.flatMap((groups, index) =>
            [...groups.values()].map(async (group, groupIndex) => {
              void groupIndex;
              await layers[index].addSprites(group.sprites as any, group.imageUrl, group.imageSize);
            })
          )
        );
      }
    } catch (e: any) {
      void e;
    }
  }

  // The expensive part (per-canvas triangulation via addGeoreferencedMap + sprites) — run once,
  // lazily, when the user zooms in past ALLMAPS_TRIGGER_ZOOM. Until then the raster pyramid above
  // is the sole renderer. Idempotent: guarded by `allmapsStarted` and detaches its own trigger.
  async function startAllmaps(): Promise<void> {
    if (allmapsStarted) return;
    allmapsStarted = true;
    detachZoomTrigger();
    const warpT0 = nowMs();
    const bootstrapCount = bootstrapFetched.reduce((s, f) => s + ("maps" in f ? f.maps.length : 0), 0);
    const backgroundCount = backgroundFetched.reduce((s, f) => s + ("maps" in f ? f.maps.length : 0), 0);
    log(`warp: start at zoom ${map.getZoom().toFixed(2)} — triangulating ${bootstrapCount + backgroundCount} canvases`);

    if (parallelLoading) {
      results.push(...await applyFetchedBatch(fetchedAll, 0, "parallel"));
      log(`warp: all ${bootstrapCount + backgroundCount} canvases (parallel) ${(nowMs() - warpT0).toFixed(0)}ms`);
    } else {
      const bootT0 = nowMs();
      results.push(...await applyFetchedBatch(bootstrapFetched, 0, "sequential"));
      log(`warp: bootstrap ${bootstrapCount} canvases ${(nowMs() - bootT0).toFixed(0)}ms`);
      const bgT0 = nowMs();
      results.push(...await applyFetchedBatch(backgroundFetched, bootstrapFetched.length, "chunked"));
      log(`warp: background ${backgroundCount} canvases ${(nowMs() - bgT0).toFixed(0)}ms`);
    }

    const spriteT0 = nowMs();
    await initializeSpritesForItems(fetchedAll);
    log(`warp: sprites ${(nowMs() - spriteT0).toFixed(0)}ms`);

    // Allmaps is ready — remove the raster tile placeholder layer/source. Clearing the cleanup
    // entry also flips this group out of the "Allmaps deferred" state that parkLayerGroup checks.
    if (map.getLayer(tilesLayerId)) map.removeLayer(tilesLayerId);
    if (map.getSource(tilesSourceId)) map.removeSource(tilesSourceId);
    detachTilesProbe?.();
    runtime.activeLayerCleanup.delete(groupId);

    nativeUpdateAll();
    log(`warp: ready in ${(nowMs() - warpT0).toFixed(0)}ms — placeholder removed, WarpedMapLayer live`);
  }

  // Load Allmaps now if the map is already zoomed in (e.g. a deep-linked/persistent URL that opens
  // at reading zoom); otherwise arm a one-shot zoom listener. Fire-and-forget in both branches so
  // the layer's raster preview appears immediately either way — callers don't await triangulation.
  if (map.getZoom() >= ALLMAPS_TRIGGER_ZOOM) {
    log(`warp: already at zoom ${map.getZoom().toFixed(2)} (≥ ${ALLMAPS_TRIGGER_ZOOM}) — loading Allmaps immediately`);
    void startAllmaps();
  } else {
    log(`warp: deferred — armed zoom trigger at ≥ ${ALLMAPS_TRIGGER_ZOOM} (now ${map.getZoom().toFixed(2)}); tiles-only until then`);
    zoomTriggerHandler = () => {
      if (map.getZoom() >= ALLMAPS_TRIGGER_ZOOM) void startAllmaps();
    };
    map.on("zoom", zoomTriggerHandler);
  }

  return results;
}
