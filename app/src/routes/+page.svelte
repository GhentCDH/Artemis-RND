<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import maplibregl from "maplibre-gl";
  import { WarpedMapLayer } from "@allmaps/maplibre";
  import { generateId } from "@allmaps/id";

  type StepTiming = {
    step: string;
    ms: number;
    ok: boolean;
    detail?: string;
  };

  type RunResult = {
    manifestUrl: string;
    annotationUrl?: string;
    startedAtISO: string;
    totalMs: number;
    steps: StepTiming[];
    ok: boolean;
    error?: string;
  };

  let mapDiv: HTMLDivElement;

  // UI inputs
  let manifestUrlInput =
    "https://iiif.ghentcdh.ugent.be/iiif/manifests/gereduceerd_kadaster:Termonde:Appels";
  let bulkInput = "";
  let status = "Idle";
  let isRunning = false;

  // Results
  let results: RunResult[] = [];

  // Map state
  let map: maplibregl.Map | null = null;
  let warpedMapLayer: WarpedMapLayer | null = null;

  // Simple cancel mechanism
  let runToken = 0;

  async function tlog(tag: string, message: string) {
    try {
      await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, message, time: new Date().toISOString() })
      });
    } catch {
      // ignore
    }
  }

  function nowMs() {
    return performance.now();
  }

  function parseBulk(text: string): string[] {
    return text
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // remove obvious duplicates while preserving order
      .filter((s, idx, arr) => arr.indexOf(s) === idx);
  }

  function ensureMap() {
    if (map) return;

    map = new maplibregl.Map({
      container: mapDiv,
      style: "https://demotiles.maplibre.org/style.json",
      center: [4.35, 50.85],
      zoom: 10,
      maxPitch: 0
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
  }

  async function waitForMapLoad(localToken: number) {
    if (!map) throw new Error("Map not initialized");

    if (map.loaded()) return;

    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onErr = (e: any) => {
        cleanup();
        reject(e);
      };
      const cleanup = () => {
        map?.off("load", onLoad);
        map?.off("error", onErr);
      };

      map.on("load", onLoad);
      map.on("error", onErr);

      // cancellation guard
      const check = () => {
        if (localToken !== runToken) {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  function resetWarpedLayer() {
    // Remove previous layer cleanly to avoid stacking memory/state.
    if (!map) return;

    try {
      // WarpedMapLayer is a custom layer; MapLibre removeLayer works by id.
      // The plugin layerId is the id passed in constructor.
      if (map.getLayer("warped-map-layer")) {
        map.removeLayer("warped-map-layer");
      }
    } catch {
      // ignore
    }

    warpedMapLayer = new WarpedMapLayer({ layerId: "warped-map-layer" });
    // TS friction between plugin types and MapLibre types: safe cast for prototype work.
    map.addLayer(warpedMapLayer as any);
  }

  async function benchmarkOne(manifestUrl: string, localToken: number): Promise<RunResult> {
    const startedAtISO = new Date().toISOString();
    const steps: StepTiming[] = [];
    const t0 = nowMs();

    const pushStep = (step: string, ms: number, ok: boolean, detail?: string) => {
      steps.push({ step, ms, ok, detail });
    };

    const guardCancel = () => {
      if (localToken !== runToken) throw new Error("Cancelled");
    };

    try {
      status = `Running: ${manifestUrl}`;
      await tlog("RUN", `Start manifest: ${manifestUrl}`);

      // Step: map init
      {
        const s0 = nowMs();
        ensureMap();
        guardCancel();
        const ms = nowMs() - s0;
        pushStep("map_init", ms, true);
        await tlog("STEP", `map_init ${ms.toFixed(1)}ms`);
      }

      // Step: wait map load (first time only)
      {
        const s0 = nowMs();
        await waitForMapLoad(localToken);
        guardCancel();
        const ms = nowMs() - s0;
        pushStep("map_load_wait", ms, true);
        await tlog("STEP", `map_load_wait ${ms.toFixed(1)}ms`);
      }

      // Step: generate allmaps id
      let annotationUrl = "";
      {
        const s0 = nowMs();
        const id = await generateId(manifestUrl);
        guardCancel();
        annotationUrl = `https://annotations.allmaps.org/manifests/${id}`;
        const ms = nowMs() - s0;
        pushStep("allmaps_generate_id", ms, true, id);
        await tlog("STEP", `allmaps_generate_id ${ms.toFixed(1)}ms id=${id}`);
      }

      // Step: fetch annotation (so you can measure dependency on allmaps service)
      {
        const s0 = nowMs();
        const r = await fetch(annotationUrl);
        guardCancel();
        const ms = nowMs() - s0;
        const ok = r.ok;
        pushStep("allmaps_fetch_annotation", ms, ok, `status=${r.status}`);
        await tlog("STEP", `allmaps_fetch_annotation ${ms.toFixed(1)}ms status=${r.status}`);
        if (!r.ok) throw new Error(`Annotation fetch failed: ${r.status}`);
      }

      // Step: reset layer + add layer
      {
        const s0 = nowMs();
        resetWarpedLayer();
        guardCancel();
        const ms = nowMs() - s0;
        pushStep("map_add_warped_layer", ms, true);
        await tlog("STEP", `map_add_warped_layer ${ms.toFixed(1)}ms`);
      }

      // Step: load annotation into layer (warping setup)
      {
        const s0 = nowMs();
        await warpedMapLayer!.addGeoreferenceAnnotationByUrl(annotationUrl);
        guardCancel();
        const ms = nowMs() - s0;
        pushStep("allmaps_apply_annotation", ms, true);
        await tlog("STEP", `allmaps_apply_annotation ${ms.toFixed(1)}ms`);
      }

      // Step: fit bounds (optional UX step)
      {
        const s0 = nowMs();
        const bounds = warpedMapLayer!.getBounds();
        if (bounds) {
          map!.fitBounds(bounds as any, { padding: 40, duration: 0 });
        }
        guardCancel();
        const ms = nowMs() - s0;
        pushStep("map_fit_bounds", ms, true, bounds ? "ok" : "no_bounds");
        await tlog("STEP", `map_fit_bounds ${ms.toFixed(1)}ms`);
      }

      const totalMs = nowMs() - t0;
      await tlog("RUN", `Done manifest in ${totalMs.toFixed(1)}ms: ${manifestUrl}`);

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
      await tlog("ERROR", `Manifest failed in ${totalMs.toFixed(1)}ms: ${manifestUrl} :: ${msg}`);

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

  async function runQueue(urls: string[]) {
    // Increment token so any previous run cancels
    runToken += 1;
    const localToken = runToken;

    isRunning = true;
    results = [];
    status = `Queued ${urls.length} manifest(s)`;
    await tlog("QUEUE", `Queue size: ${urls.length}`);

    // Sequential: load -> report -> load -> report ...
    for (let i = 0; i < urls.length; i++) {
      if (localToken !== runToken) break;

      const u = urls[i];
      status = `(${i + 1}/${urls.length}) ${u}`;
      await tlog("QUEUE", `Processing ${i + 1}/${urls.length}`);

      const res = await benchmarkOne(u, localToken);
      results = [res, ...results];

      // Small breath to keep UI responsive when you do big batches
      await new Promise((r) => setTimeout(r, 30));
    }

    if (localToken === runToken) {
      status = "Done";
      await tlog("QUEUE", "Queue complete");
    } else {
      status = "Cancelled";
      await tlog("QUEUE", "Queue cancelled");
    }

    isRunning = false;
  }

  function goSingle() {
    const u = manifestUrlInput.trim();
    if (!u) return;
    runQueue([u]);
  }

  function goBulk() {
    const urls = parseBulk(bulkInput);
    if (urls.length === 0) return;
    runQueue(urls);
  }

  function cancel() {
    runToken += 1;
    isRunning = false;
    status = "Cancelling…";
  }

  onMount(async () => {
    await tlog("BOOT", "UI mounted");
  });

  onDestroy(() => {
    try {
      map?.remove();
    } catch {
      // ignore
    }
  });
</script>

<div class="wrap">
  <div class="controls">
    <div class="row">
      <label>Single 3IF manifest URL</label>
      <input
        class="input"
        bind:value={manifestUrlInput}
        placeholder="https://…/iiif/manifests/…"
        disabled={isRunning}
      />
      <button class="btn" on:click={goSingle} disabled={isRunning || !manifestUrlInput.trim()}>
        Go
      </button>
    </div>

    <div class="row">
      <label>Bulk manifest URLs (one per line)</label>
      <textarea
        class="textarea"
        bind:value={bulkInput}
        placeholder="Paste many manifest URLs here, one per line"
        disabled={isRunning}
      />
      <div class="rowButtons">
        <button class="btn" on:click={goBulk} disabled={isRunning || parseBulk(bulkInput).length === 0}>
          Run bulk
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

    <div class="report">
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

  .input {
    padding: 8px 10px;
    font-size: 14px;
  }

  .textarea {
    min-height: 90px;
    padding: 8px 10px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  .rowButtons {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
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

  .report {
    border-left: 1px solid #ddd;
    padding: 12px;
    overflow: auto;
    min-height: 0;
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

  th, td {
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
</style>