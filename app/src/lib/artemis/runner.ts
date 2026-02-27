// src/lib/artemis/runner.ts
import type { RunResult, StepTiming } from "./types";
import { isoNow, nowMs, withTimeout } from "./timing";
import { buildAllmapsAnnotationUrl } from "./allmaps";
import type { MapContext } from "./map/mapContext";

type RunnerOpts = {
  runTimeoutMs: number;
  applyTimeoutMs: number;

  /**
   * Normally OFF for bulk runs (page clears once before the loop).
   * Can be turned ON if you ever want "replace per item".
   */
  clearBeforeAdd?: boolean;
};

type StepResult = { ok: boolean; detail?: string };

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function clearWarpedIfRequested(ctx: MapContext, enabled: boolean) {
  if (!enabled) return;

  if (typeof (ctx.warped as any).clear === "function") {
    (ctx.warped as any).clear();
    await nextFrame();
    return;
  }

  const ids: string[] = ctx.warped.getMapIds?.() ?? [];

  const remove =
    (ctx.warped as any).removeGeoreferencedMapById ??
    (ctx.warped as any).removeWarpedMapById ??
    null;

  if (typeof remove === "function") {
    for (const id of ids) {
      await remove.call(ctx.warped, id);
    }
    await nextFrame();
  }
}

function makeStepRecorder(steps: StepTiming[]) {
  return async (name: string, fn: () => Promise<StepResult>) => {
    const s0 = nowMs();

    try {
      const r = await fn();
      steps.push({ step: name, ms: nowMs() - s0, ok: r.ok, detail: r.detail });
      return r;
    } catch (e: any) {
      steps.push({
        step: name,
        ms: nowMs() - s0,
        ok: false,
        detail: e?.message ?? String(e)
      });
      throw e;
    }
  };
}

/**
 * Public: run from a manifest URL (computes annotation URL, then runs).
 */
export async function runOneManifest(
  manifestUrl: string,
  localToken: number,
  guardCancel: (t: number) => void,
  ctx: MapContext,
  log: (level: "INFO" | "WARN" | "ERROR", msg: string) => void,
  opts: RunnerOpts
): Promise<RunResult> {
  const startedAtISO = isoNow();
  const steps: StepTiming[] = [];
  const t0 = nowMs();

  const step = makeStepRecorder(steps);

  try {
    log("INFO", `RUN start: ${manifestUrl}`);
    guardCancel(localToken);

    const gen = await step("allmaps_generate_id", async () => {
      const { id, url } = await buildAllmapsAnnotationUrl(manifestUrl);
      return { ok: true, detail: `${id} :: ${url}` };
    });

    const parts = (gen.detail ?? "").split("::").map((s) => s.trim());
    const annotationUrl = parts[1];

    if (!annotationUrl) throw new Error("Invalid annotation URL");

    return await runOneFromAnnotationUrlImpl(
      manifestUrl,
      annotationUrl,
      localToken,
      guardCancel,
      ctx,
      log,
      opts,
      steps,
      startedAtISO,
      t0
    );
  } catch (e: any) {
    const totalMs = nowMs() - t0;
    const msg = e?.message ?? String(e);

    log("ERROR", `RUN fail (${totalMs.toFixed(1)}ms): ${manifestUrl} :: ${msg}`);

    return {
      manifestUrl,
      startedAtISO,
      totalMs,
      steps,
      ok: false,
      error: msg
    };
  }
}

/**
 * Public: run from a known annotation URL (Allmaps URL or mirrored local URL).
 */
export async function runOneFromAnnotationUrl(
  manifestUrl: string,
  annotationUrl: string,
  localToken: number,
  guardCancel: (t: number) => void,
  ctx: MapContext,
  log: (level: "INFO" | "WARN" | "ERROR", msg: string) => void,
  opts: RunnerOpts
): Promise<RunResult> {
  const startedAtISO = isoNow();
  const steps: StepTiming[] = [];
  const t0 = nowMs();

  return runOneFromAnnotationUrlImpl(
    manifestUrl,
    annotationUrl,
    localToken,
    guardCancel,
    ctx,
    log,
    opts,
    steps,
    startedAtISO,
    t0
  );
}

/**
 * Internal shared implementation so both public functions behave identically.
 */
async function runOneFromAnnotationUrlImpl(
  manifestUrl: string,
  annotationUrl: string,
  localToken: number,
  guardCancel: (t: number) => void,
  ctx: MapContext,
  log: (level: "INFO" | "WARN" | "ERROR", msg: string) => void,
  opts: RunnerOpts,
  steps: StepTiming[],
  startedAtISO: string,
  t0: number
): Promise<RunResult> {
  const step = makeStepRecorder(steps);

  try {
    await withTimeout(
      (async () => {
        guardCancel(localToken);

        await step("allmaps_clear_previous", async () => {
          const before = ctx.warped.getMapIds?.()?.length ?? 0;

          await clearWarpedIfRequested(ctx, !!opts.clearBeforeAdd);

          const after = ctx.warped.getMapIds?.()?.length ?? 0;

          if (!opts.clearBeforeAdd) return { ok: true, detail: "skipped" };
          return { ok: true, detail: `before=${before} after=${after}` };
        });

        guardCancel(localToken);

        await step("fetch_annotation", async () => {
          const res = await fetch(annotationUrl);
          return { ok: res.ok, detail: `status=${res.status}` };
        });

        guardCancel(localToken);

        await step("allmaps_apply_annotation", async () => {
          const added = await withTimeout(
            ctx.warped.addGeoreferenceAnnotationByUrl(annotationUrl),
            opts.applyTimeoutMs,
            "apply"
          );

          const addedIds = Array.isArray(added) ? added.map(String) : [String(added)];
          const total = ctx.warped.getMapIds?.()?.length ?? 0;

          return { ok: true, detail: `added=${addedIds.join(",")} total=${total}` };
        });

        guardCancel(localToken);

        await step("map_fit_bounds", async () => {
          const bounds = ctx.warped.getBounds?.();
          if (bounds) ctx.map.fitBounds(bounds as any, { padding: 40, duration: 0 });
          return { ok: true, detail: bounds ? "ok" : "no_bounds" };
        });
      })(),
      opts.runTimeoutMs,
      "run"
    );

    const totalMs = nowMs() - t0;
    log("INFO", `RUN ok (${totalMs.toFixed(1)}ms): ${manifestUrl}`);

    return {
      manifestUrl,
      annotationUrl,
      startedAtISO,
      totalMs,
      steps,
      ok: true
    };
  } catch (e: any) {
    const totalMs = nowMs() - t0;
    const msg = e?.message ?? String(e);

    log("ERROR", `RUN fail (${totalMs.toFixed(1)}ms): ${manifestUrl} :: ${msg}`);

    return {
      manifestUrl,
      annotationUrl,
      startedAtISO,
      totalMs,
      steps,
      ok: false,
      error: msg
    };
  }
}