// src/lib/artemis/metrics.ts
import { writable, derived } from "svelte/store";
import type { RunResult, StepTiming } from "$lib/artemis/types";

export type StepAgg = {
  step: string;
  count: number; // number of manifests that reported this step
  okCount: number; // number of ok occurrences
  totalMs: number; // sum of ms across occurrences
  avgMs: number; // totalMs / count
};

export type BulkMetricsState = {
  // Wall clock (for UI)
  startISO?: string;
  endISO?: string;

  // Perf clock (for precise durations)
  startPerfMs?: number;
  endPerfMs?: number;

  // Observed per-manifest run results
  observed: RunResult[];

  // Optional: status label if you want
  label?: string;
};

const initialState: BulkMetricsState = {
  observed: []
};

export const bulkMetrics = writable<BulkMetricsState>({ ...initialState });

export function resetBulkMetrics() {
  bulkMetrics.set({ ...initialState });
}

export function startBulkRun(label?: string) {
  bulkMetrics.set({
    startISO: new Date().toISOString(),
    startPerfMs: performance.now(),
    endISO: undefined,
    endPerfMs: undefined,
    observed: [],
    label
  });
}

export function endBulkRun() {
  bulkMetrics.update((s) => ({
    ...s,
    endISO: new Date().toISOString(),
    endPerfMs: performance.now()
  }));
}

export function ingestRunResult(r: RunResult) {
  bulkMetrics.update((s) => ({
    ...s,
    observed: [r, ...s.observed] // newest first, matches your UI
  }));
}

function safeDiv(a: number, b: number) {
  return b === 0 ? 0 : a / b;
}

function findStep(r: RunResult, name: string): StepTiming | undefined {
  return (r.steps ?? []).find((s) => s.step === name);
}

/**
 * Classify run outcome:
 * - failed: r.ok === false
 * - noManifests: explicit marker (you can emit this in synthetic results, or mirror report)
 * - noAnnotations: we attempted lookup and found none (404 or "no usable annotations")
 * - applied: we actually added a map
 * - okOther: ok but neither clearly applied nor clearly "no annotations" (edge cases)
 *
 * This keeps "skipped because not georeferenced" separate from true failures.
 */
function classifyRun(r: RunResult) {
  if (!r.ok) return { kind: "failed" as const };

  const apply = findStep(r, "allmaps_apply_annotation");
  const fetch = findStep(r, "fetch_annotation");
  const usable = findStep(r, "detect_usable_annotations");

  const applyDetail = String(apply?.detail ?? "");
  const fetchDetail = String(fetch?.detail ?? "");
  const usableDetail = String(usable?.detail ?? "");

  // Applied if apply step reports added=
  if (applyDetail.includes("added=")) return { kind: "applied" as const };

  // "No annotations" if:
  // - apply step explicitly skipped, or
  // - fetch step says skip:status=404, or
  // - usability step says skip:...
  if (
    applyDetail.startsWith("skipped") ||
    applyDetail.includes("skipped_") ||
    fetchDetail.includes("status=404") ||
    fetchDetail.startsWith("skip:") ||
    usableDetail.startsWith("skip:")
  ) {
    return { kind: "noAnnotations" as const };
  }

  // Optional explicit marker if you create synthetic results
  // (not required, but supported)
  const marker = findStep(r, "input_manifest_present");
  if (String(marker?.detail ?? "").startsWith("no_manifests")) {
    return { kind: "noManifests" as const };
  }

  return { kind: "okOther" as const };
}

export const bulkSummary = derived(bulkMetrics, ($m) => {
  const manifests = $m.observed;

  // Outcome counts
  let failedCount = 0;
  let appliedCount = 0;
  let noAnnotationsCount = 0;
  let noManifestsCount = 0;
  let okOtherCount = 0;

  for (const r of manifests) {
    const c = classifyRun(r);
    if (c.kind === "failed") failedCount += 1;
    else if (c.kind === "applied") appliedCount += 1;
    else if (c.kind === "noAnnotations") noAnnotationsCount += 1;
    else if (c.kind === "noManifests") noManifestsCount += 1;
    else okOtherCount += 1;
  }

  const okCount = manifests.length - failedCount;

  const runDurationMs =
    $m.startPerfMs != null && $m.endPerfMs != null ? $m.endPerfMs - $m.startPerfMs : undefined;

  // Aggregate by step name across all manifests
  const map = new Map<string, { step: string; count: number; okCount: number; totalMs: number }>();

  for (const r of manifests) {
    for (const s of r.steps ?? []) {
      const key = s.step;
      const cur = map.get(key) ?? { step: key, count: 0, okCount: 0, totalMs: 0 };

      cur.count += 1;
      if (s.ok) cur.okCount += 1;
      cur.totalMs += s.ms ?? 0;

      map.set(key, cur);
    }
  }

  const stepAggs: StepAgg[] = [...map.values()].map((x) => ({
    ...x,
    avgMs: safeDiv(x.totalMs, x.count)
  }));

  // Stable order: highest average first (usually what you care about)
  stepAggs.sort((a, b) => b.avgMs - a.avgMs);

  // Averages
  const totalMsSum = manifests.reduce((acc, r) => acc + (r.totalMs ?? 0), 0);
  const avgManifestTotalMs = manifests.length > 0 ? totalMsSum / manifests.length : undefined;

  // Average for applied-only (often the metric you care about)
  const applied = manifests.filter((r) => classifyRun(r).kind === "applied");
  const appliedMsSum = applied.reduce((acc, r) => acc + (r.totalMs ?? 0), 0);
  const avgAppliedTotalMs = applied.length > 0 ? appliedMsSum / applied.length : undefined;

  return {
    label: $m.label,
    startISO: $m.startISO,
    endISO: $m.endISO,
    runDurationMs,

    manifestCount: manifests.length,

    // Outcome breakdown (requested)
    okCount, // includes applied + skips
    failCount: failedCount,
    appliedCount,
    noAnnotationsCount,
    noManifestsCount,
    okOtherCount,

    // Averages
    avgManifestTotalMs,
    avgAppliedTotalMs,

    steps: stepAggs
  };
});

export function fmtMs(ms?: number) {
  if (ms == null) return "–";
  return `${ms.toFixed(1)} ms`;
}