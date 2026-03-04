import { writable, derived, type Readable } from "svelte/store";
import type { RunResult } from "$lib/artemis/types";

export type StepAgg = {
  step: string;
  count: number;
  okCount: number;
  totalMs: number;
  avgMs: number;
};

export type BulkSummary = {
  label: string | undefined;
  startISO: string | undefined;
  endISO: string | undefined;
  runDurationMs: number | undefined;
  manifestCount: number;
  okCount: number;
  failCount: number;
  appliedCount: number;
  noAnnotationsCount: number;
  avgManifestTotalMs: number | undefined;
  avgAppliedTotalMs: number | undefined;
  steps: StepAgg[];
  stepsApplied: StepAgg[];
};

type BulkMetricsState = {
  startISO?: string;
  endISO?: string;
  startPerfMs?: number;
  endPerfMs?: number;
  observed: RunResult[];
  label?: string;
};

const bulkMetrics = writable<BulkMetricsState>({ observed: [] });

export function resetBulkMetrics() {
  bulkMetrics.set({ observed: [] });
}

export function startBulkRun(label?: string) {
  bulkMetrics.set({
    startISO: new Date().toISOString(),
    startPerfMs: performance.now(),
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
  bulkMetrics.update((s) => ({ ...s, observed: [r, ...s.observed] }));
}

function safeDiv(a: number, b: number) {
  return b === 0 ? 0 : a / b;
}

function classifyRun(r: RunResult) {
  if (!r.ok) return { kind: "failed" as const };

  const apply = r.steps.find((s) => s.step === "allmaps_apply_annotation");
  const fetch = r.steps.find((s) => s.step === "fetch_annotation");

  const applyDetail = String(apply?.detail ?? "");
  const fetchDetail = String(fetch?.detail ?? "");

  if (applyDetail.includes("added=")) return { kind: "applied" as const };

  if (
    applyDetail.startsWith("skipped") ||
    fetchDetail.includes("status=404") ||
    fetchDetail.startsWith("skip:")
  ) {
    return { kind: "noAnnotations" as const };
  }

  return { kind: "okOther" as const };
}

export const bulkSummary: Readable<BulkSummary> = derived(bulkMetrics, ($m) => {
  const manifests = $m.observed;

  let failedCount = 0;
  let appliedCount = 0;
  let noAnnotationsCount = 0;

  for (const r of manifests) {
    const c = classifyRun(r);
    if (c.kind === "failed") failedCount += 1;
    else if (c.kind === "applied") appliedCount += 1;
    else if (c.kind === "noAnnotations") noAnnotationsCount += 1;
  }

  const runDurationMs =
    $m.startPerfMs != null && $m.endPerfMs != null
      ? $m.endPerfMs - $m.startPerfMs
      : undefined;

  type StepAccum = { step: string; count: number; okCount: number; totalMs: number };
  const allMap = new Map<string, StepAccum>();
  const appliedMap = new Map<string, StepAccum>();

  for (const r of manifests) {
    const isApplied = classifyRun(r).kind === "applied";
    for (const s of r.steps ?? []) {
      const cur = allMap.get(s.step) ?? { step: s.step, count: 0, okCount: 0, totalMs: 0 };
      cur.count += 1;
      if (s.ok) cur.okCount += 1;
      cur.totalMs += s.ms ?? 0;
      allMap.set(s.step, cur);

      if (isApplied) {
        const acur = appliedMap.get(s.step) ?? { step: s.step, count: 0, okCount: 0, totalMs: 0 };
        acur.count += 1;
        if (s.ok) acur.okCount += 1;
        acur.totalMs += s.ms ?? 0;
        appliedMap.set(s.step, acur);
      }
    }
  }

  const toAggs = (m: Map<string, StepAccum>): StepAgg[] =>
    [...m.values()]
      .map((x) => ({ ...x, avgMs: safeDiv(x.totalMs, x.count) }))
      .sort((a, b) => b.avgMs - a.avgMs);

  const totalMsSum = manifests.reduce((a, r) => a + (r.totalMs ?? 0), 0);
  const applied = manifests.filter((r) => classifyRun(r).kind === "applied");
  const appliedMsSum = applied.reduce((a, r) => a + (r.totalMs ?? 0), 0);

  return {
    label: $m.label,
    startISO: $m.startISO,
    endISO: $m.endISO,
    runDurationMs,
    manifestCount: manifests.length,
    okCount: manifests.length - failedCount,
    failCount: failedCount,
    appliedCount,
    noAnnotationsCount,
    avgManifestTotalMs: manifests.length > 0 ? totalMsSum / manifests.length : undefined,
    avgAppliedTotalMs: applied.length > 0 ? appliedMsSum / applied.length : undefined,
    steps: toAggs(allMap),
    stepsApplied: toAggs(appliedMap)
  };
});

export function fmtMs(ms?: number) {
  if (ms == null) return "–";
  return `${ms.toFixed(1)} ms`;
}
