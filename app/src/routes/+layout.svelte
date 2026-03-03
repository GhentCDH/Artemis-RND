<!-- src/routes/+page.svelte
     Compiled-only viewer page:
     - Loads dataset index.json from a GitHub Pages base URL
     - Lets you pick an entry
     - Runs the compiled runner which fetches manifest + mirrored Allmaps annotation and renders WarpedMapLayer
     - Attaches Allmaps debug events (optional but recommended)

     This page is written to avoid:
     - "no request" issues (buttons are type="button", no form submit)
     - a11y label warnings (labels have for= and controls have id=)
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type maplibregl from "maplibre-gl";

  import { ensureMapContext, destroyMapContext } from "$lib/artemis/map/mapInit";
  import { attachAllmapsDebugEvents } from "$lib/artemis/debug/attachAllmapsDebugEvents";

  import type { CompiledIndex, CompiledIndexEntry, CompiledRunnerConfig } from "$lib/artemis/runner";
  import { loadCompiledIndex, runOneCompiledManifest } from "$lib/artemis/runner";

  let mapDiv: HTMLDivElement;
  let map: maplibregl.Map;

  // Hardcode a sane default so "Load index" always produces a request.
  // You can still overwrite it in the UI.
  let datasetBaseUrl = "https://y2gkcsdef.github.io/ArtemisTestData";

  let status = "Idle";
  let isRunning = false;

  let index: CompiledIndex | null = null;
  let entries: CompiledIndexEntry[] = [];
  let selectedId: string | null = null;

  type LogLine = { atISO: string; level: "INFO" | "WARN" | "ERROR"; msg: string };
  let logs: LogLine[] = [];
  const MAX_LOGS = 500;

  function log(level: "INFO" | "WARN" | "ERROR", msg: string) {
    logs = [{ atISO: new Date().toISOString(), level, msg }, ...logs].slice(0, MAX_LOGS);
  }

  function idFromCompiledManifestPath(p: string) {
    // "manifests/bcff5b3828d4900a.json" -> "bcff5b3828d4900a"
    const m = p.match(/\/([^\/]+)\.json$/);
    return m?.[1] ?? p;
  }

  async function loadIndex() {
    // This log is your “proof” the click handler is firing.
    log("INFO", `loadIndex() base=${datasetBaseUrl}`);

    if (!datasetBaseUrl.trim()) {
      status = "Missing dataset base URL";
      log("ERROR", status);
      return;
    }

    isRunning = true;
    status = "Loading index.json...";
    try {
      const cfg: CompiledRunnerConfig = {
        datasetBaseUrl: datasetBaseUrl.trim(),
        indexPath: "index.json",
        fetchTimeoutMs: 30000
      };

      const raw = await loadCompiledIndex(cfg);
      index = raw;

      // Accept both shapes just in case:
      // - { index: [...] } (your current dataset)
      // - { manifests: [...] } (older drafts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (raw as any).index ?? (raw as any).manifests ?? [];
      entries = Array.isArray(list) ? (list as CompiledIndexEntry[]) : [];

      selectedId = entries[0] ? idFromCompiledManifestPath(entries[0].compiledManifestPath) : null;

      status = `Loaded ${entries.length} entries`;
      log("INFO", status);

      // If you load 0 entries, the next thing to check is the network request for /index.json.
      if (entries.length === 0) {
        log("WARN", "Index loaded but contained 0 entries. Check JSON shape in /index.json.");
      }
    } catch (e: any) {
      status = `Index load failed: ${e?.message ?? String(e)}`;
      log("ERROR", status);
    } finally {
      isRunning = false;
    }
  }

  async function runSelected() {
    if (!selectedId) return;
    if (isRunning) return;

    isRunning = true;
    status = `Running ${selectedId}...`;
    log("INFO", status);

    try {
      const cfg: CompiledRunnerConfig = {
        datasetBaseUrl: datasetBaseUrl.trim(),
        indexPath: "index.json",
        fetchTimeoutMs: 30000
      };

      const r = await runOneCompiledManifest({
        map,
        cfg,
        id: selectedId,
        log
      });

      status = r.ok ? `OK (${Math.round(r.totalMs)}ms)` : `FAIL: ${r.error ?? "unknown error"}`;
      log(r.ok ? "INFO" : "ERROR", status);
    } catch (e: any) {
      status = `Run failed: ${e?.message ?? String(e)}`;
      log("ERROR", status);
    } finally {
      isRunning = false;
    }
  }

  function clearLogs() {
    logs = [];
    log("INFO", "Logs cleared");
  }

  onMount(() => {
    map = ensureMapContext(mapDiv);
    attachAllmapsDebugEvents(map, log);

    // Autoload on startup so you instantly see a request in Network.
    // If you don't want this behavior, comment it out.
    void loadIndex();
  });

  onDestroy(() => {
    destroyMapContext();
  });
</script>

<div class="wrap">
  <aside class="sidebar">
    <h2>Compiled Viewer</h2>

    <div class="field">
      <label for="datasetBaseUrl">Dataset base URL</label>
      <input
        id="datasetBaseUrl"
        bind:value={datasetBaseUrl}
        placeholder="https://y2gkcsdef.github.io/ArtemisTestData"
        spellcheck="false"
      />
    </div>

    <div class="buttons">
      <button type="button" on:click={loadIndex} disabled={isRunning || !datasetBaseUrl.trim()}>
        Load index
      </button>

      <button type="button" on:click={runSelected} disabled={isRunning || !selectedId}>
        Run
      </button>

      <button type="button" on:click={clearLogs} disabled={isRunning}>
        Clear logs
      </button>
    </div>

    <div class="status">{status}</div>

    <div class="field">
      <label for="entrySelect">Entry</label>
      <select
        id="entrySelect"
        bind:value={selectedId}
        disabled={!entries.length || isRunning}
        size="10"
      >
        {#each entries as e}
          {@const id = idFromCompiledManifestPath(e.compiledManifestPath)}
          <option value={id}>
            {e.label} ({e.canvasCount})
          </option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="logPanel">Logs</label>
      <div id="logPanel" class="logs" aria-label="logs">
        {#each logs as l}
          <div class={"log " + l.level}>
            <div class="ts">{l.atISO}</div>
            <div class="msg">{l.level}: {l.msg}</div>
          </div>
        {/each}
      </div>
    </div>
  </aside>

  <main class="map" bind:this={mapDiv} />
</div>

<style>
  .wrap {
    display: grid;
    grid-template-columns: 390px 1fr;
    height: 100vh;
  }

  .sidebar {
    padding: 12px;
    border-right: 1px solid #ddd;
    overflow: auto;
  }

  .map {
    height: 100vh;
  }

  h2 {
    margin: 0 0 12px 0;
    font-size: 18px;
  }

  .field {
    margin-bottom: 12px;
  }

  label {
    display: block;
    font-size: 12px;
    margin-bottom: 4px;
    opacity: 0.85;
  }

  input,
  select {
    width: 100%;
    box-sizing: border-box;
  }

  input {
    padding: 6px 8px;
  }

  select {
    padding: 6px 8px;
  }

  .buttons {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  button {
    padding: 6px 10px;
  }

  .status {
    font-size: 13px;
    padding: 6px 0;
    margin-bottom: 12px;
  }

  .logs {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 12px;
    max-height: 320px;
    overflow: auto;
    border: 1px solid #eee;
    padding: 6px;
    background: white;
  }

  .log {
    padding: 4px 0;
    border-bottom: 1px solid #f3f3f3;
  }

  .ts {
    opacity: 0.7;
  }

  .msg {
    white-space: pre-wrap;
  }
</style>