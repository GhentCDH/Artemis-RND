<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type maplibregl from "maplibre-gl";

  import { ensureMapContext, destroyMapContext } from "$lib/artemis/map/mapInit";
  import { attachAllmapsDebugEvents } from "$lib/artemis/debug/attachAllmapsDebugEvents";
  import { runAllCompiledManifests, resetCompiledIndexCache } from "$lib/artemis/runner";
  import { bulkSummary, startBulkRun, endBulkRun, resetBulkMetrics, ingestRunResult, fmtMs } from "$lib/artemis/metrics";

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

  let progress: { done: number; total: number } | null = null;

  async function run() {
    if (isRunning || !datasetBaseUrl.trim()) return;
    isRunning = true;
    progress = { done: 0, total: 0 };
    status = "Loading...";
    resetCompiledIndexCache();
    resetBulkMetrics();
    startBulkRun("mirror");

    try {
      await runAllCompiledManifests({
        map,
        cfg: { datasetBaseUrl: datasetBaseUrl.trim(), fetchTimeoutMs: 30000 },
        log,
        onProgress: (done, total, result) => {
          progress = { done, total };
          status = `${done} / ${total}`;
          ingestRunResult(result);
        }
      });
      status = `Done in ${fmtMs($bulkSummary?.runDurationMs)}`;
    } catch (e: any) {
      status = `Failed: ${e?.message ?? String(e)}`;
      log("ERROR", status);
    } finally {
      endBulkRun();
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

    {#if $bulkSummary && $bulkSummary.manifestCount > 0}
      <div class="metrics">
        <div class="metrics-title">Bulk report</div>

        <table class="mtable">
          <tbody>
            <tr><th>Duration</th><td>{fmtMs($bulkSummary.runDurationMs)}</td></tr>
            <tr><th>Manifests</th><td>{$bulkSummary.manifestCount}</td></tr>
            <tr><th>Applied</th><td class="ok">{$bulkSummary.appliedCount}</td></tr>
            <tr><th>No annotation</th><td class="muted">{$bulkSummary.noAnnotationsCount}</td></tr>
            <tr><th>Failed</th><td class="fail">{$bulkSummary.failCount}</td></tr>
            <tr><th>Avg total (all)</th><td>{fmtMs($bulkSummary.avgManifestTotalMs)}</td></tr>
            <tr><th>Avg total (applied)</th><td>{fmtMs($bulkSummary.avgAppliedTotalMs)}</td></tr>
          </tbody>
        </table>

        <div class="step-title">Steps — all runs</div>
        <table class="mtable">
          <thead><tr><th>step</th><th>avg ms</th><th>n</th><th>ok</th></tr></thead>
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

        <div class="step-title">Steps — applied only ({$bulkSummary.appliedCount})</div>
        {#if $bulkSummary.stepsApplied.length === 0}
          <div class="muted-text">No applied runs yet.</div>
        {:else}
          <table class="mtable">
            <thead><tr><th>step</th><th>avg ms</th><th>n</th><th>ok</th></tr></thead>
            <tbody>
              {#each $bulkSummary.stepsApplied as s}
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

  .step-title {
    font-size: 11px;
    font-weight: 600;
    margin: 8px 0 4px;
    opacity: 0.7;
  }

  .muted-text {
    font-size: 11px;
    opacity: 0.6;
  }

  .mtable {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    table-layout: fixed;
  }

  .mtable th, .mtable td {
    padding: 3px 4px;
    border-top: 1px solid #eee;
    text-align: left;
    overflow: hidden;
    word-break: break-all;
  }

  .mtable thead th {
    opacity: 0.6;
    font-weight: 600;
  }

  .mtable td.ok   { color: #2a7a2a; }
  .mtable td.fail { color: #c0392b; }
  .mtable td.muted { color: #999; }
  .mono { font-family: ui-monospace, "Courier New", monospace; }

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
