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
const ALLMAPS_TRIGGER_ZOOM = 12.5;

// Viewport-driven loading (Phase 1): only canvases whose footprint intersects the current viewport
// expanded by this fraction on each side are triangulated. 0.5 → a 2×-linear margin, so a modest
// pan reveals already-loaded maps instead of blank/raster. Loaded maps are kept (no eviction).
const ALLMAPS_VIEWPORT_MARGIN = 0.5;
// How many entries (manifests) to triangulate per animation frame while draining the load queue —
// same yield-friendly cadence the old background batch used, so a big reconcile never blocks a frame.
const RECONCILE_CHUNK = 6;

// TEMP DIAGNOSTIC: when true, the pre-rendered sprite atlas is NOT fed to Allmaps, forcing it to
// fetch full-resolution IIIF tiles instead. Use to check whether Allmaps ever shows real IIIF detail
// (sharp = full-res works and sprites were masking it; blank/errors = the IIIF tile path is broken).
// Flip back to false for normal operation.
const DEBUG_SKIP_SPRITES = false;

// TEMP DIAGNOSTIC: subscribe to Allmaps' renderer events and log, per second, how many tiles came
// from real IIIF fetches (`maptileloaded`) vs the sprite atlas (`maptilesloadedfromsprites`), plus
// any tile fetch errors. Definitively answers "does Allmaps ever upgrade sprites → full-res tiles?".
const DEBUG_LOG_TILE_SOURCE = true;

function toAbsoluteUrl(baseUrl: string, maybePathOrUrl: string): string {
  if (/^https?:\/\//i.test(maybePathOrUrl)) return maybePathOrUrl;
  return joinUrl(baseUrl, maybePathOrUrl);
}

function squaredDistance(a: [number, number] | null, to: [number, number]): number {
  if (!a) return Number.POSITIVE_INFINITY;
  const dx = a[0] - to[0];
  const dy = a[1] - to[1];
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

// Geographic bounding box [minLon, minLat, maxLon, maxLat] of an entry, from its GCPs — used to test
// which entries intersect the viewport for viewport-driven loading. Null if it has no usable GCPs.
function getEntryGeoBbox(entry: { inlineMaps?: Array<{ raw: unknown }> }): [number, number, number, number] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  let found = false;
  for (const item of entry.inlineMaps ?? []) {
    const gcps = (item.raw as any)?.gcps;
    if (!Array.isArray(gcps)) continue;
    for (const gcp of gcps) {
      const geo = gcp?.geo;
      if (!Array.isArray(geo) || geo.length < 2) continue;
      const lon = Number(geo[0]);
      const lat = Number(geo[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      found = true;
    }
  }
  return found ? [minLon, minLat, maxLon, maxLat] : null;
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

  // TEMP: instrument Allmaps' renderer (an EventTarget) to report real-tile vs sprite-tile loads.
  // The renderer is created lazily in the layer's onAdd, so poll briefly until it exists.
  if (DEBUG_LOG_TILE_SOURCE) {
    for (const l of layers) {
      let tries = 0;
      const attach = () => {
        const renderer = (l as any).renderer as EventTarget | undefined;
        if (!renderer?.addEventListener) {
          if (tries++ < 50 && safeHasMapLayer(map, (l as any).id)) setTimeout(attach, 100);
          return;
        }
        let real = 0, fromSprites = 0, errors = 0, dirty = false;
        renderer.addEventListener("maptileloaded", () => { real++; dirty = true; });
        renderer.addEventListener("maptilesloadedfromsprites", () => { fromSprites++; dirty = true; });
        renderer.addEventListener("tilefetcherror", (e: any) => {
          errors++; dirty = true;
          log(`tile fetch ERROR: ${e?.error?.message ?? "?"} ${e?.data?.tileUrl ?? ""}`);
        });
        log(`tile-source logging attached`);
        const timer = setInterval(() => {
          if (!safeHasMapLayer(map, (l as any).id)) { clearInterval(timer); return; } // layer/style gone
          if (!dirty) return;
          dirty = false;
          log(`tiles source @ zoom ${map.getZoom().toFixed(1)}: ${real} real (IIIF) / ${fromSprites} from sprites / ${errors} errors`);
        }, 1000);
      };
      attach();
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
  // Set once viewport-driven loading starts; detaches the `moveend` reconcile listener on teardown.
  let detachMoveReconcile: (() => void) | null = null;

  // The pre-warped raster pyramid is the group's permanent **base** — it must sit BENEATH the
  // WarpedMapLayer so Allmaps' full-res warp renders on top of it (where loaded), with the raster
  // showing through only where Allmaps hasn't triangulated yet. (It is inserted with the warped
  // layer as `beforeId`; if it went on top it would occlude the IIIF detail with overzoomed tiles.)
  // Native MapLibre `raster` source, resolved synchronously from `layerInfo` (no manifest fetch):
  // MapLibre requests only the visible {z}/{x}/{y} tiles on demand. Its id joins `layerIds` (at the
  // bottom) so reorder/teardown track it like any other group layer.
  const warpedBaseLayerId = layerIds[0]; // bottom WarpedMapLayer; raster goes directly beneath it
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
        // beforeId = the WarpedMapLayer → raster is inserted directly beneath it (above the base map).
        map.addLayer({
          id: tilesLayerId,
          type: "raster",
          source: tilesSourceId,
          paint: { "raster-opacity": 0.85 },
        }, map.getLayer(warpedBaseLayerId) ? warpedBaseLayerId : undefined);
        // Front of layerIds = bottom of the group's stack, so reorderLayerGroups keeps it below warp.
        layerIds.unshift(tilesLayerId);
      }
      log(`tiles: raster base added beneath warp (z${tilesConfig.minZoom}-${tilesConfig.maxZoom}) +${(nowMs() - activationT0).toFixed(0)}ms`);
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
      // The raster pyramid is now the group's permanent base (it is NOT removed when Allmaps loads —
      // Allmaps loads viewport-driven on top of it), so this cleanup entry lives for the whole group
      // lifetime and only runs on full teardown. Its persistent presence is also what makes
      // `parkLayerGroup` always fully remove an IIIF group on toggle-off (see runtime.ts) — correct
      // now, since re-showing re-inits cheaply and only re-triangulates the viewport.
      runtime.activeLayerCleanup.set(groupId, () => {
        detachZoomTrigger();
        detachMoveReconcile?.();
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

  // ── Viewport-driven Allmaps loading (Phase 1) ──────────────────────────────────────────────────
  // Rather than triangulating every canvas at the trigger, load only those whose footprint intersects
  // the current viewport (+ margin), and reconcile again on every `moveend`. Loaded canvases are kept
  // (no eviction — panning back is instant); the raster pyramid stays as the permanent base so
  // not-yet-loaded areas always show something. See IIIF-OPTIMIZATION.md "Viewport-driven Allmaps".
  type SpatialItem = { item: Fetched; index: number; bbox: [number, number, number, number] | null; center: [number, number] | null };
  const spatialItems: SpatialItem[] = fetchedAll.map((item, index) => ({
    item,
    index,
    bbox: getEntryGeoBbox(item.entry),
    center: getEntryGeoCenter(item.entry),
  }));
  const loadedKeys = new Set<number>(); // entry indices already loaded or queued
  const pendingQueue: SpatialItem[] = [];
  let draining = false;
  let spritesUploaded = false;

  function currentCenter(): [number, number] | null {
    try { const c = map.getCenter(); return [c.lng, c.lat]; } catch { return null; }
  }

  function paddedViewportBounds(): [number, number, number, number] | null {
    try {
      const b = map.getBounds();
      const px = (b.getEast() - b.getWest()) * ALLMAPS_VIEWPORT_MARGIN;
      const py = (b.getNorth() - b.getSouth()) * ALLMAPS_VIEWPORT_MARGIN;
      return [b.getWest() - px, b.getSouth() - py, b.getEast() + px, b.getNorth() + py];
    } catch { return null; }
  }

  function bboxIntersects(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  }

  // The sprite atlas is a shared per-layer resource (like addImageInfos above) — upload it once,
  // before the first maps are added, so every canvas samples it as soon as it's triangulated.
  async function ensureSpritesUploaded(): Promise<void> {
    if (spritesUploaded) return;
    spritesUploaded = true;
    if (DEBUG_SKIP_SPRITES) {
      log(`warp: sprites SKIPPED (DEBUG_SKIP_SPRITES) — forcing full-res IIIF tile fetches`);
      return;
    }
    const t0 = nowMs();
    await initializeSpritesForItems(fetchedAll);
    log(`warp: sprite atlas uploaded ${(nowMs() - t0).toFixed(0)}ms`);
  }

  // Single drainer: triangulates the queue RECONCILE_CHUNK entries per frame, re-prioritising by the
  // current viewport centre between chunks so the nearest maps always load first even mid-pan. Bails
  // if the group is parked/removed (its layers leave activeLayersByGroup).
  async function drainQueue(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      await ensureSpritesUploaded();
      while (pendingQueue.length > 0) {
        if (!runtime.activeLayersByGroup.has(groupId)) break;
        const center = currentCenter();
        if (center) pendingQueue.sort((a, b) => squaredDistance(a.center, center) - squaredDistance(b.center, center));
        const chunk = pendingQueue.splice(0, RECONCILE_CHUNK);
        const t0 = nowMs();
        results.push(...await applyFetchedBatch(chunk.map((s) => s.item), 0, "parallel"));
        nativeUpdateAll();
        log(`warp: +${chunk.length} canvases ${(nowMs() - t0).toFixed(0)}ms (${pendingQueue.length} queued)`);
        if (pendingQueue.length > 0) await nextFrame();
      }
    } finally {
      draining = false;
    }
  }

  // Queue every not-yet-loaded entry intersecting the padded viewport, then kick the drainer. Only
  // runs while actually zoomed in — at overview the raster base suffices and a wide viewport would
  // otherwise pull in the whole collection.
  function reconcileViewport(): void {
    if (!runtime.activeLayersByGroup.has(groupId)) return;
    if (map.getZoom() < ALLMAPS_TRIGGER_ZOOM) return;
    const padded = paddedViewportBounds();
    if (!padded) return;
    let queued = 0;
    for (const s of spatialItems) {
      if (loadedKeys.has(s.index)) continue;
      // No bbox (entry without usable GCPs) → load it defensively rather than silently drop it.
      if (!s.bbox || bboxIntersects(s.bbox, padded)) {
        loadedKeys.add(s.index);
        pendingQueue.push(s);
        queued++;
      }
    }
    if (queued > 0) {
      log(`warp: viewport reconcile — queued ${queued} (${loadedKeys.size}/${spatialItems.length} total)`);
      void drainQueue();
    }
  }

  // Begin viewport-driven loading: reconcile the current view now, then on every settle. Idempotent
  // (guarded by `allmapsStarted`), detaches the one-shot zoom trigger, and registers the `moveend`
  // teardown so removeLayerGroup unhooks it.
  function startAllmaps(): void {
    if (allmapsStarted) return;
    allmapsStarted = true;
    detachZoomTrigger();
    log(`warp: start at zoom ${map.getZoom().toFixed(2)} — viewport-driven (margin ${ALLMAPS_VIEWPORT_MARGIN}×, ${spatialItems.length} canvases available)`);
    const onMoveEnd = () => reconcileViewport();
    map.on("moveend", onMoveEnd);
    detachMoveReconcile = () => {
      try { map.off("moveend", onMoveEnd); } catch { /* map torn down */ }
      detachMoveReconcile = null;
    };
    reconcileViewport();
  }

  // Start now if already zoomed in (e.g. a deep-linked/persistent URL that opens at reading zoom);
  // otherwise arm a one-shot zoom listener. The raster preview shows immediately either way.
  if (map.getZoom() >= ALLMAPS_TRIGGER_ZOOM) {
    log(`warp: already at zoom ${map.getZoom().toFixed(2)} (≥ ${ALLMAPS_TRIGGER_ZOOM}) — starting viewport loading`);
    startAllmaps();
  } else {
    log(`warp: deferred — armed zoom trigger at ≥ ${ALLMAPS_TRIGGER_ZOOM} (now ${map.getZoom().toFixed(2)}); tiles-only until then`);
    zoomTriggerHandler = () => {
      if (map.getZoom() >= ALLMAPS_TRIGGER_ZOOM) startAllmaps();
    };
    map.on("zoom", zoomTriggerHandler);
  }

  return results;
}
