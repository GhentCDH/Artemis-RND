// $lib/artemis/runner.ts
//
// Compiled-only runner (NO runtime Allmaps discovery):
// - Fetch compiled IIIF manifest from GitHub-hosted dataset
// - Fetch matching mirrored Allmaps annotation JSON (GitHub-hosted)
// - Normalize annotation payload (prefer .items if present)
// - Construct WarpedMapLayer
// - Add it to a provided MapLibre map
//
// Instrumented to debug "layer added but nothing renders":
// - Logs layer interface (onAdd/render/onRemove)
// - Wraps onAdd/onRemove to confirm MapLibre calls them
// - Adds layer (retry without beforeId if needed)
// - Keeps last added layer id for deterministic removal
//
// If after this you still see no map tiles AND no Allmaps events, the next step is:
// - onAdd not being called => your WarpedMapLayer instance is not a valid MapLibre custom layer in this version.
// - onAdd is called but you see maperror events => payload shape/content issue.

import type maplibregl from "maplibre-gl";
import { WarpedMapLayer } from "@allmaps/maplibre";
import type { RunResult } from "$lib/artemis/types";

type StepTiming = { step: string; ms: number; ok: boolean; detail?: string };

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
// Allmaps payload normalization (adapter point)
// ---------------------------------------------------------------------------

function normalizeAllmapsPayload(raw: unknown, log?: RunnerLog): unknown {
  if (Array.isArray(raw)) return raw;

  if (raw && typeof raw === "object") {
    const o = raw as any;

    if (Array.isArray(o.items)) {
      log?.("INFO", `Allmaps payload: using .items (${o.items.length})`);
      return o.items;
    }

    if (Array.isArray(o.georeferenceAnnotations)) {
      log?.("INFO", `Allmaps payload: using .georeferenceAnnotations (${o.georeferenceAnnotations.length})`);
      return o.georeferenceAnnotations;
    }
  }

  log?.("WARN", "Allmaps payload: unknown shape, passing through raw JSON");
  return raw;
}

// ---------------------------------------------------------------------------
// Warped layer lifecycle
// ---------------------------------------------------------------------------

let activeLayerId: string | null = null;

async function removeWarpedLayerIfPresent(map: maplibregl.Map, layerId: string, log?: RunnerLog) {
  await waitForMapReady(map);

  try {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
      log?.("INFO", `Removed existing layer id=${layerId}`);
    }
  } catch (e: any) {
    log?.("WARN", `Failed removing layer id=${layerId}: ${e?.message ?? String(e)}`);
  }
}

/**
 * Construct WarpedMapLayer across possible @allmaps/maplibre signatures.
 * IMPORTANT: do not override layer.id. Your install reports "warped-map-layer".
 */
function createWarpedMapLayer(manifestJson: unknown, georeferenceAnnotations: unknown, log?: RunnerLog) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor: any = WarpedMapLayer;

  const attempts: Array<{ name: string; build: () => any }> = [
    {
      name: "new WarpedMapLayer({ manifest, georeferenceAnnotations })",
      build: () =>
        new Ctor({
          manifest: manifestJson,
          georeferenceAnnotations
        })
    },
    {
      name: "new WarpedMapLayer({ manifest, annotation })",
      build: () =>
        new Ctor({
          manifest: manifestJson,
          annotation: georeferenceAnnotations
        })
    },
    {
      name: "new WarpedMapLayer({ annotations })",
      build: () =>
        new Ctor({
          annotations: georeferenceAnnotations
        })
    },
    {
      name: "new WarpedMapLayer(georeferenceAnnotations, { manifest })",
      build: () => new Ctor(georeferenceAnnotations, { manifest: manifestJson })
    },
    {
      name: "new WarpedMapLayer(georeferenceAnnotations)",
      build: () => new Ctor(georeferenceAnnotations)
    }
  ];

  const errors: string[] = [];

  for (const a of attempts) {
    try {
      const layer: any = a.build();
      log?.("INFO", `WarpedMapLayer ctor OK: ${a.name}`);

      const lid = typeof layer?.id === "string" ? layer.id : "(no id)";
      log?.("INFO", `WarpedMapLayer reports layer.id=${lid}`);

      return layer;
    } catch (e: any) {
      errors.push(`${a.name}: ${e?.message ?? String(e)}`);
    }
  }

  throw new Error(
    `Could not construct WarpedMapLayer (tried ${attempts.length} signatures).\n` + errors.join("\n")
  );
}

async function addWarpedLayer(opts: {
  map: maplibregl.Map;
  manifestJson: unknown;
  allmapsRaw: unknown;
  log?: RunnerLog;
}) {
  const { map, manifestJson, allmapsRaw, log } = opts;

  await waitForMapReady(map);

  // Remove previously added layer if we know its id
  if (activeLayerId) {
    await removeWarpedLayerIfPresent(map, activeLayerId, log);
    activeLayerId = null;
  }

  const georeferenceAnnotations = normalizeAllmapsPayload(allmapsRaw, log);

  const layer: any = createWarpedMapLayer(manifestJson, georeferenceAnnotations, log);

  const actualId = typeof layer?.id === "string" ? layer.id : null;
  if (!actualId) {
    throw new Error("WarpedMapLayer instance has no string `id`; cannot register with MapLibre.");
  }

  // If the layer uses a fixed id (yours does), ensure it isn't still present
  await removeWarpedLayerIfPresent(map, actualId, log);

  // Instrumentation: prove whether MapLibre calls onAdd/onRemove/render
  log?.(
    "INFO",
    `Layer interface: id=${actualId} type=${String(layer?.type)} onAdd=${typeof layer?.onAdd} render=${typeof layer?.render} onRemove=${typeof layer?.onRemove}`
  );

  if (typeof layer?.onAdd === "function") {
    const origOnAdd = layer.onAdd.bind(layer);
    layer.onAdd = (m: any, gl: any) => {
      log?.("INFO", `WarpedMapLayer.onAdd called (id=${actualId})`);
      return origOnAdd(m, gl);
    };
  } else {
    log?.("WARN", `WarpedMapLayer has no onAdd() (id=${actualId}).`);
  }

  if (typeof layer?.onRemove === "function") {
    const origOnRemove = layer.onRemove.bind(layer);
    layer.onRemove = (m: any, gl: any) => {
      log?.("INFO", `WarpedMapLayer.onRemove called (id=${actualId})`);
      return origOnRemove(m, gl);
    };
  }

  // Add at top. Retry without `beforeId` if MapLibre complains for custom layers.
  try {
    map.addLayer(layer);
  } catch (e: any) {
    log?.("ERROR", `map.addLayer failed: ${e?.message ?? String(e)}`);
    throw e;
  }

  map.triggerRepaint();

  activeLayerId = actualId;
  log?.("INFO", `Added WarpedMapLayer id=${actualId}`);

  if (!map.getLayer(actualId)) {
    log?.("ERROR", `MapLibre does not report the layer after addLayer (id=${actualId}).`);
  } else {
    log?.("INFO", `MapLibre reports layer present (id=${actualId}).`);
  }
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
      log?.("INFO", `Resolved entry ${entry.label} id=${entry.manifestAllmapsId}`);
    }

    // 3) Fetch compiled manifest
    const compiledManifestUrl = joinUrl(cfg.datasetBaseUrl, entry.compiledManifestPath);
    const manifestJson = await (async () => {
      const ts = nowMs();
      const mj = await fetchJson<unknown>(compiledManifestUrl, cfg.fetchTimeoutMs ?? 30000);
      pushStep("fetchCompiledManifest", ts, true);
      return mj;
    })();

    // 4) Fetch mirrored Allmaps annotation JSON
    if (!entry.mirroredAllmapsAnnotationPath || !entry.mirroredAllmapsAnnotationPath.trim()) {
      throw new Error(`Missing mirroredAllmapsAnnotationPath for ${entry.compiledManifestPath}`);
    }

    const mirroredAnnoUrl = joinUrl(cfg.datasetBaseUrl, entry.mirroredAllmapsAnnotationPath);
    const allmapsRaw = await (async () => {
      const ts = nowMs();
      const aj = await fetchJson<unknown>(mirroredAnnoUrl, cfg.fetchTimeoutMs ?? 30000);
      pushStep("fetchMirroredAllmapsAnnotation", ts, true);
      return aj;
    })();

    // 5) Render on map
    await (async () => {
      const ts = nowMs();
      await addWarpedLayer({ map, manifestJson, allmapsRaw, log });
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