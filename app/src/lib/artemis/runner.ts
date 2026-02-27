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

  /**
   * If true, we prefetch the annotation JSON and apply using a blob: URL.
   * This avoids a second network fetch inside addGeoreferenceAnnotationByUrl().
   *
   * Keep this ON for clean benchmarking and for mirror mode resilience.
   */
  applyViaBlobUrl?: boolean;
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

function mustOk(r: StepResult, ctxMsg: string) {
  if (!r.ok) throw new Error(ctxMsg + (r.detail ? ` (${r.detail})` : ""));
}

function isLikelyAnnotationShapeError(msg: string) {
  return (
    msg.includes("Invalid literal value") ||
    msg.includes("expected \"Annotation\"") ||
    msg.includes("expected: \"Annotation\"") ||
    (msg.includes("path") && msg.includes("\"type\"")) ||
    (msg.includes("Required") && (msg.includes("\"target\"") || msg.includes("\"body\"")))
  );
}

type UsableCheck = { usable: boolean; reason: string; count: number };

function checkUsableAnnotations(json: any): UsableCheck {
  if (!json || typeof json !== "object") {
    return { usable: false, reason: "not_object", count: 0 };
  }

  const t = String((json as any).type ?? "");

  if (t === "AnnotationPage" && Array.isArray((json as any).items)) {
    const items = (json as any).items as any[];

    const valid = items.filter((it) => {
      if (!it || typeof it !== "object") return false;
      const itType = String((it as any).type ?? "");
      if (itType !== "Annotation") return false;
      if (!(it as any).target) return false;
      if (!(it as any).body) return false;
      return true;
    });

    if (valid.length === 0) {
      return { usable: false, reason: "annotation_page_no_valid_items", count: 0 };
    }

    return { usable: true, reason: "annotation_page_items", count: valid.length };
  }

  if (t === "Annotation") {
    const hasTarget = !!(json as any).target;
    const hasBody = !!(json as any).body;
    if (!hasTarget || !hasBody) {
      return { usable: false, reason: "annotation_missing_body_or_target", count: 0 };
    }
    return { usable: true, reason: "single_annotation", count: 1 };
  }

  return { usable: false, reason: `unknown_type:${t || "none"}`, count: 0 };
}

function makeJsonBlobUrl(jsonText: string): string {
  const blob = new Blob([jsonText], { type: "application/json" });
  return URL.createObjectURL(blob);
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
 *
 * Clean runner policy:
 * - Always fetch + parse once (needed for resilience + "is there anything to apply?")
 * - Apply via blob URL by default to avoid second NETWORK fetch during apply
 * - Missing/invalid annotations => SKIP (ok=true, apply step says skipped)
 * - True apply failures => FAIL
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

  const applyViaBlobUrl = opts.applyViaBlobUrl !== false; // default true

  let fetchedText: string | null = null;
  let fetchedJson: any = null;

  let skipApply = false;
  let skipReason = "";

  let blobUrl: string | null = null;

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

        const fetchRes = await step("fetch_annotation", async () => {
          const res = await fetch(annotationUrl, { cache: "default" });
          const text = await res.text();
          fetchedText = text;

          if (res.status === 404) {
            skipApply = true;
            skipReason = "allmaps_404";
            return { ok: true, detail: `skip:status=404 bytes=${text.length}` };
          }

          return { ok: res.ok, detail: `status=${res.status} bytes=${text.length}` };
        });

        if (!skipApply) mustOk(fetchRes, "Annotation fetch failed");

        guardCancel(localToken);

        // 2) Parse once
        const parseRes = await step("parse_annotation_json", async () => {
          if (fetchedText == null) return { ok: false, detail: "no_text" };

          try {
            fetchedJson = JSON.parse(fetchedText);
            return { ok: true, detail: "ok" };
          } catch {
            const snippet = fetchedText.slice(0, 180).replace(/\s+/g, " ").trim();
            return { ok: false, detail: `json_parse_failed :: ${snippet}` };
          }
        });
        mustOk(parseRes, "Annotation JSON parse failed");

        guardCancel(localToken);

        // 3) Check usability and decide SKIP vs apply
        const usableRes = await step("detect_usable_annotations", async () => {
          const usable = checkUsableAnnotations(fetchedJson);

          if (!usable.usable) {
            skipApply = true;
            skipReason = `no_usable_annotations:${usable.reason}`;
            return { ok: true, detail: `skip:${usable.reason}` };
          }

          return { ok: true, detail: `usable:${usable.reason} count=${usable.count}` };
        });
        mustOk(usableRes, "Annotation usability check failed");

        guardCancel(localToken);

        // 4) Apply (prefer blob URL so apply doesn't hit network again)
        await step("allmaps_apply_annotation", async () => {
          if (skipApply) return { ok: true, detail: `skipped_${skipReason || "no_usable_annotations"}` };

          const urlToApply = (() => {
            if (!applyViaBlobUrl) return annotationUrl;
            if (!fetchedText) return annotationUrl;
            blobUrl = makeJsonBlobUrl(fetchedText);
            return blobUrl;
          })();

          try {
            const added = await withTimeout(
              ctx.warped.addGeoreferenceAnnotationByUrl(urlToApply),
              opts.applyTimeoutMs,
              "apply"
            );

            const addedIds = Array.isArray(added) ? added.map(String) : [String(added)];
            const total = ctx.warped.getMapIds?.()?.length ?? 0;

            const src = urlToApply.startsWith("blob:") ? "blob" : "url";
            return { ok: true, detail: `src=${src} added=${addedIds.join(",")} total=${total}` };
          } catch (e: any) {
            const msg = e?.message ?? String(e);

            // If the plugin rejects the shape, treat as SKIP (not FAIL)
            if (isLikelyAnnotationShapeError(msg)) {
              skipApply = true;
              skipReason = "plugin_validation";
              return { ok: true, detail: `skipped_plugin_validation :: ${msg}` };
            }

            // Otherwise: real failure
            return { ok: false, detail: msg };
          }
        });

        // Enforce fail if apply step truly failed.
        const lastApply = steps.find((s) => s.step === "allmaps_apply_annotation");
        if (lastApply && !lastApply.ok) {
          throw new Error(`Apply failed (${lastApply.detail ?? "no detail"})`);
        }

        guardCancel(localToken);

        await step("map_fit_bounds", async () => {
          if (skipApply) return { ok: true, detail: "skipped" };

          const bounds = ctx.warped.getBounds?.();
          if (bounds) ctx.map.fitBounds(bounds as any, { padding: 40, duration: 0 });
          return { ok: true, detail: bounds ? "ok" : "no_bounds" };
        });
      })(),
      opts.runTimeoutMs,
      "run"
    );

    const totalMs = nowMs() - t0;

    if (skipApply) log("WARN", `RUN skip (${totalMs.toFixed(1)}ms): ${manifestUrl} :: ${skipReason || "no usable annotations"}`);
    else log("INFO", `RUN ok (${totalMs.toFixed(1)}ms): ${manifestUrl}`);

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
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}