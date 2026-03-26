<!-- Debug toggle button + expandable debug panel (top-right). -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { bulkSummary, fmtMs } from '$lib/artemis/metrics';
  import { getIiifCacheStats } from '$lib/artemis/runner';
  import type { UILog } from '$lib/artemis/types';
  import type { LayerRenderStats } from '$lib/artemis/runner';

  export let datasetBaseUrl: string;
  export let indexLoading: boolean;
  export let indexError: string | null;
  export let logs: UILog[] = [];
  export let layerRenderStats: Record<string, LayerRenderStats> = {};
  export let layerProgress: Record<string, { done: number; total: number }> = {};

  const dispatch = createEventDispatcher<{ reload: void }>();

  let open = false;
</script>

<button class="debug-toggle" type="button" on:click={() => (open = !open)}>
  {open ? 'Hide Debug Menu' : 'Show Debug Menu'}
</button>

{#if open}
  <aside class="debug-menu">
    <div class="debug-menu-head">
      <h2>Debug Menu</h2>
      <button type="button" class="debug-close" on:click={() => (open = false)}>Close</button>
    </div>

    <div class="field">
      <label for="datasetBaseUrl">Dataset URL</label>
      <input id="datasetBaseUrl" bind:value={datasetBaseUrl} spellcheck="false" disabled={indexLoading} />
    </div>

    <button type="button" class="reload-btn" on:click={() => dispatch('reload')} disabled={indexLoading}>
      {indexLoading ? 'Loading…' : 'Reload Index'}
    </button>

    {#if indexError}
      <div class="error-msg">{indexError}</div>
    {/if}

    {#if $bulkSummary && $bulkSummary.manifestCount > 0}
      <div class="metrics">
        <div class="metrics-title">Bulk report</div>
        <table class="mtable">
          <tbody>
            <tr><th>Duration</th><td>{fmtMs($bulkSummary.runDurationMs)}</td></tr>
            <tr><th>Manifests</th><td>{$bulkSummary.manifestCount}</td></tr>
            <tr><th>Applied</th><td class="ok">{$bulkSummary.appliedCount}</td></tr>
            <tr><th>No annotation</th><td class="muted">{$bulkSummary.noAnnotationsCount}</td></tr>
            <tr><th>Problematic manifests</th><td class={$bulkSummary.problematicCount > 0 ? 'fail' : 'ok'}>{$bulkSummary.problematicCount}</td></tr>
            <tr><th>Failed</th><td class="fail">{$bulkSummary.failCount}</td></tr>
            <tr><th>Avg total (all)</th><td>{fmtMs($bulkSummary.avgManifestTotalMs)}</td></tr>
            <tr><th>Avg total (applied)</th><td>{fmtMs($bulkSummary.avgAppliedTotalMs)}</td></tr>
          </tbody>
        </table>

        {#if $bulkSummary.problematicCount > 0}
          <div class="step-title">Problem manifests ({$bulkSummary.problematicCount})</div>
          <div class="problem-list">
            {#each $bulkSummary.problematicManifests as p}
              <div class="problem-item">
                <div class="problem-head">
                  <span class="mono">{p.annotationErrorCount}x</span>
                  <span>{p.manifestLabel}</span>
                </div>
                <a href={p.sourceManifestUrl} target="_blank" rel="noreferrer">source manifest</a>
                {#if p.allmapsManifestUrl}
                  <a href={p.allmapsManifestUrl} target="_blank" rel="noreferrer">allmaps manifest</a>
                {/if}
                {#if p.annotationErrors.length > 0}
                  <div class="problem-error mono">{p.annotationErrors[0]}</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

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

    {#if Object.keys(layerRenderStats).length > 0}
      {@const totalVisible = Object.values(layerRenderStats).reduce((s, r) => s + r.visibleMaps, 0)}
      {@const totalRegistered = Object.values(layerRenderStats).reduce((s, r) => s + r.registeredMaps, 0)}
      {@const totalPending = Object.values(layerProgress).reduce((s, p) => s + Math.max(0, p.total - p.done), 0)}
      <div class="metrics">
        <div class="metrics-title">Map render state</div>
        <table class="mtable">
          <tbody>
            <tr><th>In viewport</th><td class="ok">{totalVisible}</td></tr>
            <tr><th>Registered</th><td>{totalRegistered}</td></tr>
            <tr><th>Pending</th><td class={totalPending > 0 ? 'muted' : 'ok'}>{totalPending}</td></tr>
          </tbody>
        </table>
      </div>
    {/if}

    <details class="log-details debug-details">
      <summary>Tile cache</summary>
      <div class="cache-stats">
        <div>Cached entries: <strong>{getIiifCacheStats().size}</strong></div>
        <div>Hits: <strong class="ok">{getIiifCacheStats().hits}</strong> / Misses: <strong>{getIiifCacheStats().misses}</strong></div>
      </div>
    </details>

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
{/if}

<style>
  .debug-toggle {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 3;
    border: 1px solid var(--border-ui);
    border-radius: var(--radius-xs);
    background: var(--overlay-bg);
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-debug);
  }

  .debug-menu {
    position: absolute;
    top: 52px;
    right: 14px;
    z-index: 2;
    width: min(360px, calc(100vw - 28px));
    max-height: calc(100dvh - 66px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-ui);
    background: var(--overlay-bg);
    backdrop-filter: blur(4px);
    box-shadow: var(--shadow-lg);
  }

  .debug-menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h2 { margin: 0; font-size: 16px; font-weight: 600; }

  .debug-close {
    border: 1px solid var(--border-ui);
    border-radius: var(--radius-xs);
    background: var(--card-bg);
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .field { display: flex; flex-direction: column; gap: 4px; }

  label { font-size: 11px; opacity: 0.7; }

  input:not([type='checkbox']) {
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
    font-size: 12px;
  }

  .reload-btn { padding: 8px; font-size: 13px; font-weight: 500; cursor: pointer; }
  .reload-btn:disabled { opacity: 0.5; cursor: default; }

  .error-msg { font-size: 11px; color: var(--text-error); word-break: break-all; }

  .metrics {
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xs);
    padding: 10px;
    font-size: 12px;
  }

  .metrics-title { font-weight: 600; margin-bottom: 8px; font-size: 12px; }

  .step-title { font-size: 11px; font-weight: 600; margin: 8px 0 4px; opacity: 0.7; }
  .muted-text { font-size: 11px; opacity: 0.6; }

  .mtable {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    table-layout: fixed;
  }

  .mtable th, .mtable td {
    padding: 3px 4px;
    border-top: 1px solid var(--border-light);
    text-align: left;
    overflow: hidden;
    word-break: break-all;
  }

  .mtable thead th { opacity: 0.6; font-weight: 600; }
  .mtable td.ok   { color: var(--text-ok); }
  .mtable td.fail { color: var(--text-error); }
  .mtable td.muted { color: var(--text-muted); }

  .ok { color: var(--text-ok); }

  .problem-list { display: grid; gap: 6px; margin-bottom: 6px; }

  .problem-item {
    border: 1px solid var(--problem-border);
    border-radius: var(--radius-xs);
    padding: 6px 8px;
    background: var(--problem-bg);
    display: grid;
    gap: 2px;
  }

  .problem-head { display: flex; gap: 8px; align-items: baseline; }
  .problem-error { color: var(--problem-error-color); font-size: 12px; }

  .log-details {
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xs);
  }

  .log-details summary {
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    color: var(--text-muted-log);
  }

  .log-details[open] summary { border-bottom: 1px solid var(--border-light); }

  .logs {
    max-height: 260px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px;
  }

  .log-line {
    display: flex;
    gap: 6px;
    padding: 1px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .log-line.ERROR .msg { color: var(--text-error); }
  .log-line.WARN  .msg { color: var(--text-warn); }

  .ts { opacity: 0.5; flex-shrink: 0; }
  .msg { white-space: pre-wrap; word-break: break-all; }

  .cache-stats {
    padding: 6px 8px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 900px) {
    .debug-toggle { top: 62px; right: 10px; }
    .debug-menu { top: 100px; right: 10px; width: calc(100vw - 20px); max-height: calc(58vh - 100px); }
  }
</style>
