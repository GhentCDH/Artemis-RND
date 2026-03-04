// $lib/artemis/runner.ts
//
// Compiled-only runner — loads annotations from a GitHub Pages-hosted dataset.
// Fetches the index, resolves entries, and renders them via @allmaps/maplibre.

import type maplibregl from "maplibre-gl";
import { WarpedMapLayer } from "@allmaps/maplibre";
import type { RunResult, StepTiming } from "$lib/artemis/types";

export type CompiledIndexEntry = {
  label: string;
  sourceManifestUrl: string;
  compiledManifestPath: string;
  mirroredAllmapsAnnotationPath: string;
  canvasCount: number;
  manifestAllmapsId: string;
  manifestAllmapsUrl: string;
  manifestAllmapsStatus: number;
  canvasIds: string[];
};

export type CompiledIndex = {
  collectionUrl: string;
  generatedAt: string;
  totalManifests: number;
  georefManifests: number;
  mirroredOk: number;
  compiledOk: number;
  index: CompiledIndexEntry[];
};

export type CompiledRunnerConfig = {
  datasetBaseUrl: string;
  indexPath?: string; // default "index.json"
  fetchTimeoutMs?: number; // default 30000
};

type RunnerLog = (level: "INFO" | "WARN" | "ERROR", msg: string) => void;

function nowMs() {
  return performance.now();
}

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

function stemFromPathOrUrl(s: string) {
  const m = s.match(/\/([^\/]+)\.json$/);
  return m?.[1] ?? s;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
      throw new Error(`Expected JSON but got HTML from ${url} (wrong datasetBaseUrl?)`);
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(t);
  }
}

// ---- Index cache (fetch once) ----
let cachedIndex: CompiledIndex | null = null;

export function resetCompiledIndexCache() {
  cachedIndex = null;
}

export async function loadCompiledIndex(cfg: CompiledRunnerConfig): Promise<CompiledIndex> {
  if (cachedIndex) return cachedIndex;

  const indexUrl = joinUrl(cfg.datasetBaseUrl, cfg.indexPath ?? "index.json");
  cachedIndex = await fetchJson<CompiledIndex>(indexUrl, cfg.fetchTimeoutMs ?? 30000);
  return cachedIndex;
}

export function findEntryById(index: CompiledIndex, id: string): CompiledIndexEntry | null {
  return index.index.find((m) => m.compiledManifestPath.endsWith(`${id}.json`)) ?? null;
}

export function findEntryByCompiledManifestUrl(
  index: CompiledIndex,
  compiledManifestUrl: string
): CompiledIndexEntry | null {
  const id = stemFromPathOrUrl(compiledManifestUrl);
  return (
    index.index.find((m) => stemFromPathOrUrl(m.compiledManifestPath) === id) ??
    index.index.find((m) => m.compiledManifestPath.endsWith(`${id}.json`)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Map readiness
// ---------------------------------------------------------------------------

function waitForMapReady(map: maplibregl.Map): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();

  return new Promise((resolve) => {
    const onLoad = () => {
      map.off("load", onLoad);
      resolve();
    };
    map.on("load", onLoad);
  });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// IIIF tile cache
// Shared across all layers for the page lifetime. IIIF tile URLs are stable
// (same URL = same bytes), so caching eliminates re-fetches on pan/zoom.
// ---------------------------------------------------------------------------

const iiifTileCache = new Map<string, Promise<ArrayBuffer>>();

function cachedFetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string" ? input
    : input instanceof URL ? input.toString()
    : (input as Request).url;

  if (!iiifTileCache.has(url)) {
    iiifTileCache.set(
      url,
      fetch(input, init)
        .then((r) => {
          if (!r.ok) { iiifTileCache.delete(url); throw new Error(`HTTP ${r.status}`); }
          return r.arrayBuffer();
        })
        .catch((err) => { iiifTileCache.delete(url); throw err; })
    );
  }

  return iiifTileCache.get(url)!.then((buf) => new Response(buf));
}

// ---------------------------------------------------------------------------
// Allmaps payload normalization (adapter point)
// ---------------------------------------------------------------------------

function normalizeAllmapsPayload(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return { "@context": "http://www.w3.org/ns/anno.jsonld", type: "AnnotationPage", items: raw };
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Warped layer lifecycle
// ---------------------------------------------------------------------------

// Track all active layer IDs so we can clear them
let activeLayerIds: string[] = [];

async function removeLayerIfPresent(map: maplibregl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // ignore
  }
}

export async function clearAllWarpedLayers(map: maplibregl.Map) {
  await waitForMapReady(map);
  for (const id of activeLayerIds) await removeLayerIfPresent(map, id);
  activeLayerIds = [];
}

async function addWarpedLayer(opts: {
  map: maplibregl.Map;
  layerId: string;
  allmapsRaw: unknown;
  log?: RunnerLog;
}): Promise<void> {
  const { map, layerId, allmapsRaw, log } = opts;

  await removeLayerIfPresent(map, layerId);

  const layer = new WarpedMapLayer({ layerId } as any);

  try {
    map.addLayer(layer as any);
  } catch (e: any) {
    log?.("ERROR", `addLayer failed (${layerId}): ${e?.message ?? String(e)}`);
    throw e;
  }

  activeLayerIds.push(layerId);

  const results = await layer.addGeoreferenceAnnotation(
    normalizeAllmapsPayload(allmapsRaw),
    { fetchFn: cachedFetch } as any
  );
  const succeeded = results.filter((r): r is string => typeof r === "string");
  const failed = results.filter((r): r is Error => r instanceof Error);

  for (const err of failed) log?.("ERROR", `annotation error: ${err.message}`);

  if (succeeded.length === 0) throw new Error("No maps loaded from annotation.");

  map.triggerRepaint();
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runOneCompiledManifest(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;

  id?: string;
  compiledManifestUrl?: string;

  log?: RunnerLog;
}): Promise<RunResult> {
  const { cfg, map, log } = opts;

  const steps: StepTiming[] = [];
  const startedAtISO = new Date().toISOString();
  const t0 = nowMs();

  const pushStep = (step: string, tStart: number, ok: boolean, detail?: string) => {
    steps.push({ step, ms: nowMs() - tStart, ok, detail });
  };

  try {
    // 1) Load index
    {
      const ts = nowMs();
      await loadCompiledIndex(cfg);
      pushStep("loadIndex", ts, true);
    }

    const index = cachedIndex!;
    let entry: CompiledIndexEntry | null = null;

    // 2) Resolve entry
    {
      const ts = nowMs();

      if (opts.id) entry = findEntryById(index, opts.id);
      else if (opts.compiledManifestUrl) entry = findEntryByCompiledManifestUrl(index, opts.compiledManifestUrl);
      else throw new Error("Missing id or compiledManifestUrl");

      if (!entry) throw new Error("Manifest not found in index.json");

      pushStep("resolveIndexEntry", ts, true, entry.compiledManifestPath);
    }

    const compiledManifestUrl = joinUrl(cfg.datasetBaseUrl, entry.compiledManifestPath);

    // 3) Fetch mirrored Allmaps annotation JSON
    if (!entry.mirroredAllmapsAnnotationPath || !entry.mirroredAllmapsAnnotationPath.trim()) {
      return {
        manifestUrl: compiledManifestUrl,
        startedAtISO,
        totalMs: nowMs() - t0,
        steps,
        ok: false,
        error: "noAnnotation"
      } as RunResult;
    }

    const mirroredAnnoUrl = joinUrl(cfg.datasetBaseUrl, entry.mirroredAllmapsAnnotationPath);
    const allmapsRaw = await (async () => {
      const ts = nowMs();
      const aj = await fetchJson<unknown>(mirroredAnnoUrl, cfg.fetchTimeoutMs ?? 30000);
      pushStep("fetchMirroredAllmapsAnnotation", ts, true);
      return aj;
    })();

    // 5) Render on map
    const layerId = `warped-map-layer-${entry.manifestAllmapsId}`;
    await (async () => {
      const ts = nowMs();
      await clearAllWarpedLayers(map);
      await addWarpedLayer({ map, layerId, allmapsRaw, log });
      // Fit map to this layer's bounds
      const layer = map.getLayer(layerId) as any;
      const bounds = layer?.getBounds?.();
      if (bounds) map.fitBounds(bounds as any, { padding: 40, animate: false });
      pushStep("renderWarpedLayer", ts, true);
    })();

    const totalMs = nowMs() - t0;

    return {
      manifestUrl: compiledManifestUrl,
      annotationUrl: mirroredAnnoUrl,
      startedAtISO,
      totalMs,
      steps,
      ok: true
    } as RunResult;
  } catch (err: any) {
    const totalMs = nowMs() - t0;
    log?.("ERROR", `Runner failed: ${err?.message ?? String(err)}`);

    return {
      manifestUrl: opts.compiledManifestUrl ?? (opts.id ? `id:${opts.id}` : "unknown"),
      startedAtISO,
      totalMs,
      steps,
      ok: false,
      error: String(err?.message ?? err)
    } as RunResult;
  }
}

// ---------------------------------------------------------------------------
// Bulk runner — load all annotated entries onto the map
// ---------------------------------------------------------------------------

export async function runAllCompiledManifests(opts: {
  map: maplibregl.Map;
  cfg: CompiledRunnerConfig;
  log?: RunnerLog;
  onProgress?: (done: number, total: number, latest: RunResult) => void;
}): Promise<RunResult[]> {
  const { map, cfg, log } = opts;

  await waitForMapReady(map);
  await clearAllWarpedLayers(map);

  const index = await loadCompiledIndex(cfg);
  const entries = index.index;
  const results: RunResult[] = [];

  log?.("INFO", `Bulk run: ${entries.length} entries`);

  // Fire all annotation fetches immediately — GitHub Pages is a CDN, handles concurrency well.
  // By the time we reach each entry in the loop, its fetch is likely already resolved.
  const timeout = cfg.fetchTimeoutMs ?? 30000;
  const prefetch = new Map<string, Promise<unknown>>();
  for (const entry of entries) {
    const path = entry.mirroredAllmapsAnnotationPath?.trim();
    if (path) {
      const url = joinUrl(cfg.datasetBaseUrl, path);
      prefetch.set(url, fetchJson<unknown>(url, timeout).catch(() => null));
    }
  }

  // Single loop: register each layer then immediately fire its annotation load as a background task.
  // addLayer stays sequential (safe for WebGL); addGeoreferenceAnnotation runs concurrently across all entries.
  // Maps appear as each annotation resolves — progressive feedback from the first rAF cycle.
  const RAF_BATCH = 5;
  let done = 0;
  let fittedToFirst = false;
  const tasks: Promise<RunResult>[] = [];

  for (let i = 0; i < entries.length; i++) {
    if (i % RAF_BATCH === 0) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }

    const entry = entries[i];
    const compiledManifestUrl = joinUrl(cfg.datasetBaseUrl, entry.compiledManifestPath);
    const startedAtISO = new Date().toISOString();
    const t0 = nowMs();

    if (!entry.mirroredAllmapsAnnotationPath?.trim()) {
      const result: RunResult = {
        manifestUrl: compiledManifestUrl,
        startedAtISO,
        totalMs: 0,
        steps: [
          { step: "fetch_annotation", ms: 0, ok: true, detail: "skip:noAnnotation" },
          { step: "allmaps_apply_annotation", ms: 0, ok: true, detail: "skipped_noAnnotation" }
        ],
        ok: true
      };
      done++;
      opts.onProgress?.(done, entries.length, result);
      tasks.push(Promise.resolve(result));
      continue;
    }

    const layerId = `warped-map-layer-${entry.manifestAllmapsId}`;
    const mirroredAnnoUrl = joinUrl(cfg.datasetBaseUrl, entry.mirroredAllmapsAnnotationPath);

    await removeLayerIfPresent(map, layerId);
    const layer = new WarpedMapLayer({ layerId } as any);
    try {
      map.addLayer(layer as any);
      activeLayerIds.push(layerId);
    } catch (e: any) {
      log?.("ERROR", `addLayer failed (${layerId}): ${e?.message ?? String(e)}`);
      const result: RunResult = { manifestUrl: compiledManifestUrl, startedAtISO, totalMs: nowMs() - t0, steps: [], ok: false, error: String(e?.message ?? e) };
      done++;
      opts.onProgress?.(done, entries.length, result);
      tasks.push(Promise.resolve(result));
      continue;
    }

    // Fire annotation load immediately — do not await
    tasks.push((async (): Promise<RunResult> => {
      const steps: StepTiming[] = [];
      try {
        const ts = nowMs();
        const allmapsRaw = await (prefetch.get(mirroredAnnoUrl) ?? fetchJson<unknown>(mirroredAnnoUrl, timeout));
        prefetch.delete(mirroredAnnoUrl);
        if (!allmapsRaw) throw new Error("Annotation fetch failed");
        steps.push({ step: "fetch_annotation", ms: nowMs() - ts, ok: true, detail: `status=200` });

        const ts2 = nowMs();
        const annoResults = await layer.addGeoreferenceAnnotation(normalizeAllmapsPayload(allmapsRaw));
        const failed = annoResults.filter((r): r is Error => r instanceof Error);
        for (const err of failed) log?.("ERROR", `annotation error: ${err.message}`);
        if (!annoResults.some((r) => typeof r === "string")) throw new Error("No maps loaded from annotation.");
        const succeeded = annoResults.filter((r): r is string => typeof r === "string");
        steps.push({ step: "allmaps_apply_annotation", ms: nowMs() - ts2, ok: true, detail: `added=${succeeded.join(",")}` });

        map.triggerRepaint();

        if (!fittedToFirst) {
          const bounds = (map.getLayer(layerId) as any)?.getBounds?.();
          if (bounds) { map.fitBounds(bounds as any, { padding: 60, duration: 800 }); fittedToFirst = true; }
        }

        const result: RunResult = { manifestUrl: compiledManifestUrl, annotationUrl: mirroredAnnoUrl, startedAtISO, totalMs: nowMs() - t0, steps, ok: true };
        done++; opts.onProgress?.(done, entries.length, result);
        return result;
      } catch (err: any) {
        const result: RunResult = { manifestUrl: compiledManifestUrl, startedAtISO, totalMs: nowMs() - t0, steps, ok: false, error: String(err?.message ?? err) };
        done++; opts.onProgress?.(done, entries.length, result);
        return result;
      }
    })());
  }

  results.push(...(await Promise.all(tasks)));

  const ok = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => r.error === "noAnnotation").length;
  const failed = results.filter((r) => !r.ok && r.error !== "noAnnotation").length;
  log?.("INFO", `Bulk run done: ${ok} ok, ${skipped} skipped, ${failed} failed`);

  return results;
}