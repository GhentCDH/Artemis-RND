import { WarpedMapLayer } from "@allmaps/maplibre";
import type maplibregl from "maplibre-gl";
import type { RunResult, StepTiming, SpriteRef } from "$lib/artemis/shared/types";
import { joinUrl, nowMs } from "$lib/artemis/shared/utils";
import { getAllmapsDebugMapOptions } from "$lib/artemis/config/allmapsDebug";
import {
  loadNewIiifEntries,
  type CompiledRunnerConfig,
  type LayerInfo,
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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
}): Promise<RunResult[]> {
  const { map, cfg, layerInfo, paneId = "main", initialRenderMaps = true, spriteOnly = false, parallelLoading = false, spriteDebugMode = false } = opts;
  const runtime = getPaneRuntime(paneId);
  const layerLabel = layerInfo.renderLayerLabel?.trim() || layerInfo.sourceCollectionLabel;
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
  const loaded = await loadNewIiifEntries(cfg, layerInfo, timeout, spriteDebugMode);
  const infoByServiceUrl = loaded.infoByServiceUrl;
  const entriesUnfiltered = loaded.entries;
  const entries = entriesUnfiltered.filter((entry) => {
    if (layerInfo.renderLayerKey === "verzamelblad") return entry.isVerzamelblad === true;
    if (layerInfo.renderLayerKey === "default") return entry.isVerzamelblad !== true;
    return true;
  });

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
      l.setLayerOptions({ visible: false } as any);
      layers.push(l);
    } catch (e: any) {
      return [];
    }
  }
  runtime.activeLayersByGroup.set(groupId, layerIds);
  runtime.activeWarpedLayersByGroup.set(groupId, layers);

  function nativeUpdateAll() {
    if (!safeHasMapLayer(map, layerIds[0])) return;
    for (const l of layers) (l as any).nativeUpdate?.();
  }

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

        const okMaps = item.maps.filter((a): a is { url: string; raw: unknown; fetchMs: number; spriteRef?: SpriteRef; placeholderWidth?: number; placeholderHeight?: number } => "raw" in a);
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

  if (parallelLoading) {
    results.push(...await applyFetchedBatch(fetchedAll, 0, "parallel"));
  } else {
    results.push(...await applyFetchedBatch(bootstrapFetched, 0, "sequential"));
    results.push(...await applyFetchedBatch(backgroundFetched, bootstrapFetched.length, "chunked"));
  }

  await initializeSpritesForItems(fetchedAll);

  if (initialRenderMaps && !spriteOnly) {
    for (const layer of layers) {
      layer.setLayerOptions({ visible: true } as any);
    }
  }
  nativeUpdateAll();

  return results;
}
