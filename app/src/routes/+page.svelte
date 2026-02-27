<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import type { RunResult, UILog } from "$lib/artemis/types";
  import { CancelToken } from "$lib/artemis/cancel";
  import { ensureMapContext, destroyMapContext } from "$lib/artemis/map/mapInit";
  import { runOneManifest, runOneFromAnnotationUrl } from "$lib/artemis/runner";
  import { expandInputsToManifests } from "$lib/artemis/iiif/crawl";

  // Bulk metrics (new)
  import {
    bulkSummary,
    startBulkRun,
    endBulkRun,
    resetBulkMetrics,
    ingestRunResult,
    fmtMs
  } from "$lib/artemis/metrics";

  type MirrorItem = {
    manifestUrl: string;
    localUrl?: string;
    ok: boolean;
    status?: number;
    error?: string;
    cached?: boolean;
  };

  let mapDiv: HTMLDivElement;

  let bulkInput = "";
  let mirrorEnabled = false;

  let status = "Idle";
  let isRunning = false;

  let results: RunResult[] = [];
  let mirrorReport: MirrorItem[] = [];

  let uiLogs: UILog[] = [];
  const MAX_UI_LOGS = 300;

  const cancelToken = new CancelToken();

  const RUN_TIMEOUT_MS = 30000;
  const APPLY_TIMEOUT_MS = 15000;

  function log(level: "INFO" | "WARN" | "ERROR", msg: string) {
    if (level === "ERROR") console.error(msg);
    else if (level === "WARN") console.warn(msg);
    else console.log(msg);

    uiLogs = [{ atISO: new Date().toISOString(), level, msg }, ...uiLogs].slice(0, MAX_UI_LOGS);
  }

  function parseBulk(text: string): string[] {
    return text
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s, idx, arr) => arr.indexOf(s) === idx);
  }

  async function ensureReady(localToken: number) {
    cancelToken.guard(localToken);

    if (!mapDiv) throw new Error("Map container not ready");

    await ensureMapContext(mapDiv, log);

    cancelToken.guard(localToken);
  }

  async function clearAllMaps() {
    const ctx = await ensureMapContext(mapDiv, log);

    const before = ctx.warped.getMapIds?.()?.length ?? 0;

    if (typeof (ctx.warped as any).clear === "function") {
      (ctx.warped as any).clear();
    } else {
      log("WARN", "WarpedMapLayer.clear() not found; cannot guarantee clean reruns");
    }

    const after = ctx.warped.getMapIds?.()?.length ?? 0;
    log("INFO", `Cleared warped layer: before=${before} after=${after}`);
  }

  async function mirrorManifests(manifests: string[]): Promise<MirrorItem[]> {
    const res = await fetch("/api/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifests })
    });

    if (!res.ok) {
      throw new Error(`Mirror failed: HTTP ${res.status} (is /api/mirror implemented?)`);
    }

    const payload = await res.json();
    return (payload?.results ?? []) as MirrorItem[];
  }

  async function runBulk() {
    const inputs = parseBulk(bulkInput);
    if (inputs.length === 0) return;

    const localToken = cancelToken.next();

    isRunning = true;
    results = [];
    mirrorReport = [];
    status = `Preparing ${inputs.length} input(s)…`;

    // Bulk metrics (new)
    resetBulkMetrics();
    startBulkRun(mirrorEnabled ? "mirror" : "direct");

    try {
      log("INFO", `Queue: inputs count=${inputs.length}`);
      await ensureReady(localToken);

      status = "Resolving inputs (collections -> manifests)…";
      log("INFO", status);

      const manifests = await expandInputsToManifests(inputs, (m) => {
        status = m;
        log("INFO", m);
      });

      cancelToken.guard(localToken);

      if (manifests.length === 0) {
        status = "No manifests resolved";
        log("WARN", status);
        return;
      }

      log("INFO", `Resolved manifests: ${manifests.length}`);
      status = `Resolved ${manifests.length} manifest(s)`;

      status = "Clearing previous maps…";
      await clearAllMaps();

      const ctx = await ensureMapContext(mapDiv, log);

      if (mirrorEnabled) {
        status = `Mirroring ${manifests.length} manifest(s)…`;
        log("INFO", "Mirror enabled: calling /api/mirror");

        mirrorReport = await mirrorManifests(manifests);

        const okItems = mirrorReport.filter((x) => x.ok && x.localUrl);
        const failed = mirrorReport.filter((x) => !x.ok);

        log("INFO", `Mirror done: ok=${okItems.length} failed=${failed.length}`);

        for (let i = 0; i < okItems.length; i++) {
          cancelToken.guard(localToken);

          const it = okItems[i];

          status = `Warp ${i + 1}/${okItems.length}: ${it.manifestUrl}`;
          log("INFO", status);

          const res = await runOneFromAnnotationUrl(
            it.manifestUrl,
            it.localUrl!,
            localToken,
            (t) => cancelToken.guard(t),
            ctx,
            log,
            {
              runTimeoutMs: RUN_TIMEOUT_MS,
              applyTimeoutMs: APPLY_TIMEOUT_MS
            }
          );

          results = [res, ...results];
          ingestRunResult(res); // Bulk metrics (new)

          await new Promise((r) => setTimeout(r, 20));
        }
      } else {
        for (let i = 0; i < manifests.length; i++) {
          cancelToken.guard(localToken);

          const u = manifests[i];

          status = `Run ${i + 1}/${manifests.length}: ${u}`;
          log("INFO", status);

          const res = await runOneManifest(
            u,
            localToken,
            (t) => cancelToken.guard(t),
            ctx,
            log,
            {
              runTimeoutMs: RUN_TIMEOUT_MS,
              applyTimeoutMs: APPLY_TIMEOUT_MS,
              clearBeforeAdd: false
            }
          );

          results = [res, ...results];
          ingestRunResult(res); // Bulk metrics (new)

          await new Promise((r) => setTimeout(r, 20));
        }
      }

      status = localToken === cancelToken.current() ? "Done" : "Cancelled";
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      status = `Bulk failed: ${msg}`;
      log("ERROR", status);
    } finally {
      endBulkRun(); // Bulk metrics (new)
      isRunning = false;
    }
  }

  function cancel() {
    cancelToken.next();
    isRunning = false;
    status = "Cancelling…";
    log("WARN", "Queue: cancel requested");
  }

  onMount(async () => {
    log("INFO", "UI mounted");

    try {
      await ensureMapContext(mapDiv, log);
      log("INFO", "Map ready");
    } catch (e: any) {
      log("ERROR", `Map init failed: ${e?.message ?? String(e)}`);
    }
  });

  onDestroy(() => {
    destroyMapContext();
  });
</script>

<div class="wrap">
  <div class="controls">
    <div class="row">
      <label for="bulkManifests">Manifest or Collection URLs (one per line)</label>

      <textarea
        id="bulkManifests"
        class="textarea"
        bind:value={bulkInput}
        placeholder="Paste IIIF manifest or collection URLs here, one per line"
        disabled={isRunning}
      ></textarea>

      <div class="rowButtons">
        <label class="chk">
          <input type="checkbox" bind:checked={mirrorEnabled} disabled={isRunning} />
          Mirror annotation data before warping
        </label>

        <button class="btn" on:click={runBulk} disabled={isRunning || parseBulk(bulkInput).length === 0}>
          Run
        </button>

        <button class="btn secondary" on:click={cancel} disabled={!isRunning}>
          Cancel
        </button>

        <div class="status">Status: {status}</div>
      </div>
    </div>
  </div>

  <div class="main">
    <div class="map" bind:this={mapDiv}></div>

    <div class="right">
      <!-- Bulk report (new) -->
      <div class="panel">
        <h3>Bulk report</h3>

        {#if !$bulkSummary || $bulkSummary.manifestCount === 0}
          <div class="muted">No bulk run yet.</div>
        {:else}
          <div class="muted">Mode: {$bulkSummary.label ?? "–"}</div>

          <table class="table">
            <tbody>
              <tr>
                <th>Start</th>
                <td class="mono">{$bulkSummary.startISO ?? "–"}</td>
              </tr>
              <tr>
                <th>End</th>
                <td class="mono">{$bulkSummary.endISO ?? "–"}</td>
              </tr>
              <tr>
                <th>Duration</th>
                <td class="mono">{fmtMs($bulkSummary.runDurationMs)}</td>
              </tr>
              <tr>
                <th>Manifests</th>
                <td>{$bulkSummary.manifestCount}</td>
              </tr>
              <tr>
                <th>OK</th>
                <td>{$bulkSummary.okCount}</td>
              </tr>
              <tr>
                <th>FAIL</th>
                <td>{$bulkSummary.failCount}</td>
              </tr>
              <tr>
                <th>Avg total per manifest</th>
                <td class="mono">{fmtMs($bulkSummary.avgManifestTotalMs)}</td>
              </tr>
            </tbody>
          </table>

          <h3 style="margin-top: 12px;">Average per step</h3>

          <table class="table">
            <thead>
              <tr>
                <th>step</th>
                <th>avg ms</th>
                <th>count</th>
                <th>ok</th>
              </tr>
            </thead>
            <tbody>
              {#each $bulkSummary.steps as s}
                <tr>
                  <td class="mono">{s.step}</td>
                  <td class="mono">{fmtMs(s.avgMs)}</td>
                  <td>{s.count}</td>
                  <td>{s.okCount}/{s.count}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <div class="panel">
        <h3>Runs (latest first)</h3>

        {#if results.length === 0}
          <div class="muted">No runs yet.</div>
        {:else}
          {#each results as r}
            <div class="card">
              <div class="cardTop">
                <div class="url">{r.manifestUrl}</div>

                <div class={"badge " + (r.ok ? "ok" : "bad")}>
                  {r.ok ? "OK" : "FAIL"} · {r.totalMs.toFixed(1)} ms
                </div>
              </div>

              {#if r.annotationUrl}
                <div class="muted">Annotation: {r.annotationUrl}</div>
              {/if}

              {#if r.error}
                <div class="error">Error: {r.error}</div>
              {/if}

              <table class="table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>ms</th>
                    <th>ok</th>
                    <th>detail</th>
                  </tr>
                </thead>

                <tbody>
                  {#each r.steps as s}
                    <tr>
                      <td class="mono">{s.step}</td>
                      <td class="mono">{s.ms.toFixed(1)}</td>
                      <td>{s.ok ? "yes" : "no"}</td>
                      <td class="mono">{s.detail ?? ""}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        {/if}
      </div>

      <div class="panel">
        <h3>Mirror report</h3>

        {#if mirrorReport.length === 0}
          <div class="muted">No mirror run yet.</div>
        {:else}
          <table class="table">
            <thead>
              <tr>
                <th>manifest</th>
                <th>ok</th>
                <th>cached</th>
                <th>localUrl</th>
                <th>error</th>
              </tr>
            </thead>

            <tbody>
              {#each mirrorReport as m}
                <tr>
                  <td class="mono" style="max-width: 260px; word-break: break-all;">
                    {m.manifestUrl}
                  </td>
                  <td>{m.ok ? "yes" : "no"}</td>
                  <td>{m.cached ? "yes" : "no"}</td>
                  <td class="mono" style="max-width: 220px; word-break: break-all;">
                    {m.localUrl ?? ""}
                  </td>
                  <td class="mono" style="max-width: 220px; word-break: break-all;">
                    {m.error ?? ""}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <div class="panel">
        <h3>Live log</h3>

        {#if uiLogs.length === 0}
          <div class="muted">No logs yet.</div>
        {:else}
          <div class="logWrap">
            {#each uiLogs as l}
              <div class={"logLine " + l.level.toLowerCase()}>
                <span class="mono">{l.atISO}</span>
                <span class="lvl">{l.level}</span>
                <span class="msg mono">{l.msg}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .wrap {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .controls {
    padding: 12px 14px;
    border-bottom: 1px solid #ddd;
    display: grid;
    gap: 12px;
  }

  .row {
    display: grid;
    gap: 6px;
  }

  label {
    font-size: 12px;
    opacity: 0.8;
  }

  .textarea {
    min-height: 110px;
    padding: 8px 10px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
  }

  .rowButtons {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .chk {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    opacity: 0.9;
  }

  .btn {
    padding: 8px 12px;
    border: 1px solid #222;
    background: #222;
    color: #fff;
    cursor: pointer;
  }

  .btn.secondary {
    background: #fff;
    color: #222;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .status {
    font-size: 12px;
    opacity: 0.8;
  }

  .main {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    min-height: 0;
  }

  .map {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .right {
    border-left: 1px solid #ddd;
    overflow: auto;
    min-height: 0;
    padding: 12px;
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .panel {
    border: 1px solid #ddd;
    padding: 10px;
  }

  h3 {
    margin: 0 0 10px 0;
    font-size: 14px;
  }

  .muted {
    font-size: 12px;
    opacity: 0.7;
  }

  .card {
    border: 1px solid #ddd;
    padding: 10px;
    margin-bottom: 10px;
  }

  .cardTop {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
    margin-bottom: 6px;
  }

  .url {
    font-size: 12px;
    word-break: break-all;
  }

  .badge {
    font-size: 11px;
    border: 1px solid #ddd;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .badge.ok {
    border-color: #2a7;
  }

  .badge.bad {
    border-color: #c33;
  }

  .error {
    margin-top: 6px;
    font-size: 12px;
    color: #c33;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 12px;
  }

  th,
  td {
    border-top: 1px solid #eee;
    padding: 6px 6px;
    vertical-align: top;
  }

  th {
    text-align: left;
    font-size: 11px;
    opacity: 0.8;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
  }

  .logWrap {
    max-height: 260px;
    overflow: auto;
    border: 1px solid #eee;
    padding: 6px;
  }

  .logLine {
    display: grid;
    grid-template-columns: 170px 56px 1fr;
    gap: 8px;
    padding: 2px 0;
    border-top: 1px solid #f3f3f3;
    font-size: 12px;
  }

  .logLine:first-child {
    border-top: 0;
  }

  .lvl {
    font-weight: 600;
    opacity: 0.8;
  }

  .logLine.error .lvl {
    color: #c33;
  }

  .logLine.warn .lvl {
    color: #b80;
  }

  .msg {
    word-break: break-word;
  }
</style>