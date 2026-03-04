<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type maplibregl from "maplibre-gl";

  import { ensureMapContext, destroyMapContext } from "$lib/artemis/map/mapInit";
  import { attachAllmapsDebugEvents } from "$lib/artemis/debug/attachAllmapsDebugEvents";
  import { runAllCompiledManifests, resetCompiledIndexCache } from "$lib/artemis/runner";
  import type { RunResult } from "$lib/artemis/types";

  let mapDiv: HTMLElement;
  let map: maplibregl.Map;

  let datasetBaseUrl = "https://y2gkcsdef.github.io/ArtemisTestData";
  let isRunning = false;
  let status = "Idle";

  type LogLine = { atISO: string; level: "INFO" | "WARN" | "ERROR"; msg: string };
  let logs: LogLine[] = [];
  const MAX_LOGS = 500;

  function log(level: "INFO" | "WARN" | "ERROR", msg: string) {
    logs = [{ atISO: new Date().toISOString(), level, msg }, ...logs].slice(0, MAX_LOGS);
  }

  // --- Metrics ---
  type Metrics = {
    ok: number;
    skipped: number;
    failed: number;
    totalMs: number;
    avgFetchMs: number | null;
    avgRenderMs: number | null;
  };
  let metrics: Metrics | null = null;
  let progress: { done: number; total: number } | null = null;

  function computeMetrics(results: RunResult[], totalMs: number): Metrics {
    const ok = results.filter((r) => r.ok);
    const avg = (step: string) => {
      const times = ok.map((r) => r.steps.find((s) => s.step === step)?.ms).filter((v): v is number => v !== undefined);
      return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    };
    return {
      ok: ok.length,
      skipped: results.filter((r) => r.error === "noAnnotation").length,
      failed: results.filter((r) => !r.ok && r.error !== "noAnnotation").length,
      totalMs,
      avgFetchMs: avg("fetchAnnotation"),
      avgRenderMs: avg("addLayer")
    };
  }

  async function run() {
    if (isRunning || !datasetBaseUrl.trim()) return;
    isRunning = true;
    metrics = null;
    progress = { done: 0, total: 0 };
    status = "Loading...";
    resetCompiledIndexCache();

    try {
      const t0 = performance.now();
      const results = await runAllCompiledManifests({
        map,
        cfg: { datasetBaseUrl: datasetBaseUrl.trim(), fetchTimeoutMs: 30000 },
        log,
        onProgress: (done, total) => {
          progress = { done, total };
          status = `${done} / ${total}`;
        }
      });
      const totalMs = performance.now() - t0;
      metrics = computeMetrics(results, totalMs);
      status = `Done in ${(totalMs / 1000).toFixed(1)}s`;
    } catch (e: any) {
      status = `Failed: ${e?.message ?? String(e)}`;
      log("ERROR", status);
    } finally {
      isRunning = false;
      progress = null;
    }
  }

  onMount(() => {
    map = ensureMapContext(mapDiv);
    attachAllmapsDebugEvents(map, log);
  });

  onDestroy(() => {
    destroyMapContext();
  });
</script>

<div class="wrap">
  <aside class="sidebar">
    <h2>Artemis</h2>

    <div class="field">
      <label for="datasetBaseUrl">Dataset URL</label>
      <input
        id="datasetBaseUrl"
        bind:value={datasetBaseUrl}
        spellcheck="false"
        disabled={isRunning}
      />
    </div>

    <button type="button" class="run-btn" on:click={run} disabled={isRunning || !datasetBaseUrl.trim()}>
      {isRunning ? "Running…" : "Load & Run All"}
    </button>

    {#if progress}
      <div class="progress">
        <div class="bar" style="width: {progress.total ? (progress.done / progress.total) * 100 : 0}%"></div>
        <span>{progress.done} / {progress.total}</span>
      </div>
    {/if}

    <div class="status" class:running={isRunning}>{status}</div>

    {#if metrics}
      <div class="metrics">
        <div class="metrics-title">Metrics</div>
        <div class="metric-row">
          <span class="label">Total time</span>
          <span class="value">{(metrics.totalMs / 1000).toFixed(2)}s</span>
        </div>
        <div class="metric-row">
          <span class="label">Loaded</span>
          <span class="value ok">{metrics.ok}</span>
        </div>
        <div class="metric-row">
          <span class="label">Skipped</span>
          <span class="value muted">{metrics.skipped}</span>
        </div>
        <div class="metric-row">
          <span class="label">Failed</span>
          <span class="value fail">{metrics.failed}</span>
        </div>
        {#if metrics.avgFetchMs !== null}
          <div class="metric-row">
            <span class="label">Avg fetch</span>
            <span class="value">{metrics.avgFetchMs}ms</span>
          </div>
        {/if}
        {#if metrics.avgRenderMs !== null}
          <div class="metric-row">
            <span class="label">Avg render</span>
            <span class="value">{metrics.avgRenderMs}ms</span>
          </div>
        {/if}
      </div>
    {/if}

    <details class="log-details">
      <summary>Logs {#if logs.length}({logs.length}){/if}</summary>
      <div class="logs">
        {#each logs as l}
          <div class="log-line {l.level}">
            <span class="ts">{l.atISO.slice(11, 23)}</span>
            <span class="msg">{l.msg}</span>
          </div>
        {/each}
      </div>
    </details>
  </aside>

  <main class="map" bind:this={mapDiv}></main>
</div>

<style>
  .wrap {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100vh;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-right: 1px solid #ddd;
    overflow: auto;
  }

  .map {
    height: 100vh;
    width: 100%;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    font-size: 11px;
    opacity: 0.7;
  }

  input {
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
    font-size: 12px;
  }

  .run-btn {
    padding: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .run-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .progress {
    position: relative;
    height: 16px;
    background: #eee;
    border-radius: 3px;
    overflow: hidden;
  }

  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: #4a90d9;
    transition: width 0.15s;
  }

  .progress span {
    position: relative;
    font-size: 10px;
    padding: 0 5px;
    line-height: 16px;
  }

  .status {
    font-size: 12px;
    color: #555;
  }

  .status.running {
    color: #4a90d9;
  }

  /* Metrics */
  .metrics {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10px;
    font-size: 12px;
  }

  .metrics-title {
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .metric-row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
  }

  .metric-row .label {
    color: #666;
  }

  .metric-row .value {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .value.ok   { color: #2a7a2a; }
  .value.fail { color: #c0392b; }
  .value.muted { color: #999; }

  /* Logs */
  .log-details {
    border: 1px solid #eee;
    border-radius: 3px;
  }

  .log-details summary {
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    color: #666;
  }

  .log-details[open] summary {
    border-bottom: 1px solid #eee;
  }

  .logs {
    max-height: 260px;
    overflow: auto;
    font-family: ui-monospace, "Courier New", monospace;
    font-size: 11px;
    padding: 6px;
  }

  .log-line {
    display: flex;
    gap: 6px;
    padding: 1px 0;
    border-bottom: 1px solid #f5f5f5;
  }

  .log-line.ERROR .msg { color: #c0392b; }
  .log-line.WARN  .msg { color: #b7800a; }

  .ts {
    opacity: 0.5;
    flex-shrink: 0;
  }

  .msg {
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
