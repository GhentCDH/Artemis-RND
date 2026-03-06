<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type maplibregl from "maplibre-gl";

  import {
    ensureMapContext,
    destroyMapContext,
    setHistCartLayerVisible,
    isHistCartLayerVisible,
    setHistCartLayerOpacity
  } from "$lib/artemis/map/mapInit";
  import { attachAllmapsDebugEvents } from "$lib/artemis/debug/attachAllmapsDebugEvents";
  import {
    loadCompiledIndex,
    runLayerGroup,
    removeLayerGroup,
    setLayerGroupOpacity,
    getLayerGroupLayerIds,
    resetCompiledIndexCache,
    getIiifCacheStats,
    getLayerGroupId,
    type LayerInfo,
    type CompiledIndex,
    type CompiledRunnerConfig,
    type LayerRenderStats
  } from "$lib/artemis/runner";
  import {
    bulkSummary, startBulkRun, endBulkRun, resetBulkMetrics, ingestRunResult, fmtMs
  } from "$lib/artemis/metrics";

  let mapDiv: HTMLElement;
  let map: maplibregl.Map;

  const DEFAULT_BASE_URL = "https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build";
  let datasetBaseUrl = DEFAULT_BASE_URL;

  type LogLine = { atISO: string; level: "INFO" | "WARN" | "ERROR"; msg: string };
  let logs: LogLine[] = [];
  const MAX_LOGS = 2000;

  function log(level: "INFO" | "WARN" | "ERROR", msg: string) {
    logs = [{ atISO: new Date().toISOString(), level, msg }, ...logs].slice(0, MAX_LOGS);
  }

  // Layer state
  type UILayerInfo = LayerInfo & { uiLayerId: string };
  let layers: UILayerInfo[] = [];
  let layerEnabled: Record<string, boolean> = {};
  let layerLoading: Record<string, boolean> = {};
  let layerProgress: Record<string, { done: number; total: number }> = {};
  let layerRenderStats: Record<string, LayerRenderStats> = {};
  let layerOpacity: Record<string, number> = {};
  let indexError: string | null = null;
  let indexLoading = false;
  let debugMenuOpen = false;
  type HistCartLayerKey = "ferraris" | "vandermaelen";
  let wmtsEnabled: Record<HistCartLayerKey, boolean> = {
    ferraris: false,
    vandermaelen: false
  };
  let wmtsOpacity: Record<HistCartLayerKey, number> = {
    ferraris: 1,
    vandermaelen: 1
  };
  type StackItem = {
    id: string;
    type: "iiif" | "wmts";
    label: string;
    layerId: string;
  };
  const WMTS_STACK_LAYER_ID: Record<HistCartLayerKey, string> = {
    ferraris: "wmts:ferraris",
    vandermaelen: "wmts:vandermaelen"
  };
  let stackItems: StackItem[] = [];
  let draggedStackItemId: string | null = null;

  function clampOpacity(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  function rebuildStackItems() {
    const iiifItems: StackItem[] = layers.map((layerInfo) => ({
      id: layerInfo.uiLayerId,
      type: "iiif",
      label: layerName(layerInfo),
      layerId: layerInfo.uiLayerId
    }));
    // UI order is top -> bottom.
    const defaults: StackItem[] = [
      ...iiifItems.toReversed(),
      { id: WMTS_STACK_LAYER_ID.vandermaelen, type: "wmts", label: "Vandermaelen 1846", layerId: "vandermaelen" },
      { id: WMTS_STACK_LAYER_ID.ferraris, type: "wmts", label: "Ferraris 1771", layerId: "ferraris" }
    ];

    if (stackItems.length < 1) {
      stackItems = defaults;
      return;
    }

    const previousOrder = new Map(stackItems.map((item, idx) => [item.id, idx]));
    stackItems = defaults.sort((a, b) => (previousOrder.get(a.id) ?? 9999) - (previousOrder.get(b.id) ?? 9999));
  }

  function isStackItemEnabled(item: StackItem): boolean {
    if (item.type === "wmts") return wmtsEnabled[item.layerId as HistCartLayerKey];
    return !!layerEnabled[item.layerId];
  }

  function applyLayerStackOrder() {
    if (!map || !map.isStyleLoaded()) return;
    const applyOnce = () => {
      // Build concrete layer id order bottom -> top, then move each to top in sequence.
      const orderedLayerIds: string[] = [];
      for (const item of [...stackItems].reverse()) {
        if (!isStackItemEnabled(item)) continue;
        if (item.type === "wmts") {
          orderedLayerIds.push(`histcart-${item.layerId}-layer`);
        } else {
          orderedLayerIds.push(...getLayerGroupLayerIds(item.layerId));
        }
      }
      for (const id of orderedLayerIds) {
        try {
          if (map.getLayer(id)) map.moveLayer(id);
        } catch {
          // ignore transient move errors while layers are mounting/unmounting
        }
      }
    };
    applyOnce();
  }

  function onStackDragStart(itemId: string) {
    draggedStackItemId = itemId;
  }

  function onStackDrop(targetItemId: string) {
    if (!draggedStackItemId || draggedStackItemId === targetItemId) {
      draggedStackItemId = null;
      return;
    }

    const current = [...stackItems];
    const from = current.findIndex((x) => x.id === draggedStackItemId);
    const to = current.findIndex((x) => x.id === targetItemId);
    if (from < 0 || to < 0) {
      draggedStackItemId = null;
      return;
    }

    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    stackItems = current;
    draggedStackItemId = null;
    applyLayerStackOrder();
  }

  function getLayerInfoFromStackItem(item: StackItem): UILayerInfo | undefined {
    if (item.type !== "iiif") return undefined;
    return layers.find((layer) => layer.uiLayerId === item.layerId);
  }

  function isStackItemLoading(item: StackItem): boolean {
    if (item.type !== "iiif") return false;
    return layerLoading[item.layerId] ?? false;
  }

  function getStackItemOpacity(item: StackItem): number {
    if (item.type === "wmts") return wmtsOpacity[item.layerId as HistCartLayerKey] ?? 1;
    return layerOpacity[item.layerId] ?? 1;
  }

  function getStackItemProgress(item: StackItem): { done: number; total: number } | undefined {
    if (item.type !== "iiif") return undefined;
    return layerProgress[item.layerId];
  }

  function getStackItemCounts(item: StackItem): string {
    if (item.type === "wmts") return `${Math.round(getStackItemOpacity(item) * 100)}%`;
    const layerInfo = getLayerInfoFromStackItem(item);
    if (!layerInfo) return "";
    return `${layerInfo.georefCount}/${layerInfo.manifestCount}`;
  }

  async function onStackItemToggle(item: StackItem, nextEnabled: boolean) {
    if (item.type === "wmts") {
      onWmtsSetEnabled(item.layerId as HistCartLayerKey, nextEnabled);
      return;
    }
    const layerInfo = getLayerInfoFromStackItem(item);
    if (!layerInfo) return;
    await setIiifLayerEnabled(layerInfo, nextEnabled);
  }

  function onStackItemOpacityInput(item: StackItem, rawValue: string) {
    if (item.type === "wmts") {
      onWmtsOpacityInput(item.layerId as HistCartLayerKey, rawValue);
      return;
    }
    onLayerOpacityInput(item.layerId, rawValue);
  }

  function cleanLayerLabel(label: string): string {
    return label.replace(/^\s*artemis\s*[-–—:]\s*/i, "").trim();
  }

  function layerName(layerInfo: UILayerInfo): string {
    if (layerInfo.renderLayerLabel?.trim()) return cleanLayerLabel(layerInfo.renderLayerLabel.trim());
    if (layerInfo.renderLayerKey?.trim()) {
      const base = cleanLayerLabel(layerInfo.sourceCollectionLabel);
      const key = layerInfo.renderLayerKey.trim();
      // For hidden sub-layers just show the key to keep it compact
      if (layerInfo.hidden) return key;
      return `${base} (${key})`;
    }
    return cleanLayerLabel(layerInfo.sourceCollectionLabel);
  }

  function cfg(): CompiledRunnerConfig {
    return { datasetBaseUrl: normalizeDatasetBaseUrl(datasetBaseUrl.trim()), fetchTimeoutMs: 30000 };
  }

  function normalizeDatasetBaseUrl(input: string): string {
    let url = input.trim();
    if (!url) return url;

    // Accept pasted GitHub blob URL to index.json and map it to raw build base.
    // Example:
    // https://github.com/GhentCDH/Artemis-RnD-Data/blob/master/build/index.json
    // -> https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build
    const blobMatch = url.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)\/index\.json\/?$/i
    );
    if (blobMatch) {
      const [, owner, repo, ref, buildPath] = blobMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${buildPath}`.replace(/\/+$/, "");
    }

    // Accept raw index.json URL and convert to base build path.
    url = url.replace(/\/index\.json\/?$/i, "");
    return url.replace(/\/+$/, "");
  }

  function normalizeSourceLayers(index: CompiledIndex): UILayerInfo[] {
    const baseLayers = index.renderLayers ?? [];
    if (baseLayers.length === 0) {
      throw new Error("index.json has no renderLayers; viewer requires renderLayers for layer toggles.");
    }
    return baseLayers
      .map((layer) => ({
        ...layer,
        sourceCollectionLabel: cleanLayerLabel(layer.sourceCollectionLabel),
        renderLayerLabel: layer.renderLayerLabel ? cleanLayerLabel(layer.renderLayerLabel) : layer.renderLayerLabel,
        uiLayerId: getLayerGroupId(layer)
      }));
  }

  async function fetchIndex() {
    indexLoading = true;
    indexError = null;
    resetCompiledIndexCache();

    try {
      const index = await loadCompiledIndex(cfg());
      layers = normalizeSourceLayers(index);
      layerEnabled = {};
      layerOpacity = {};
      for (const l of layers) layerEnabled[l.uiLayerId] = false;
      for (const l of layers) layerOpacity[l.uiLayerId] = 1;
      rebuildStackItems();
      const firstLayer = layers[0];
      if (firstLayer) {
        layerEnabled[firstLayer.uiLayerId] = true;
        await loadLayer(firstLayer);
      }
    } catch (e: any) {
      indexError = e?.message ?? String(e);
      log("ERROR", `Index fetch failed: ${indexError}`);
    } finally {
      indexLoading = false;
    }
  }

  async function loadLayer(layerInfo: UILayerInfo) {
    const gid = layerInfo.uiLayerId;
    layerLoading = { ...layerLoading, [gid]: true };
    layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
    startBulkRun("mirror");

    try {
      await runLayerGroup({
        map,
        cfg: cfg(),
        layerInfo,
        log,
        onRenderStats: (stats) => {
          layerRenderStats = { ...layerRenderStats, [gid]: stats };
        },
        onProgress: (done, total, result) => {
          layerProgress = { ...layerProgress, [gid]: { done, total } };
          ingestRunResult(result);
        }
      });
    } catch (e: any) {
      log("ERROR", `Layer load failed: ${e?.message ?? String(e)}`);
      layerEnabled = { ...layerEnabled, [gid]: false };
    } finally {
      // Always clear loading state even if reordering/opacities throw.
      layerLoading = { ...layerLoading, [gid]: false };
      layerProgress = { ...layerProgress, [gid]: { done: 0, total: 0 } };
      try {
        setLayerGroupOpacity(map, gid, layerOpacity[gid] ?? 1);
        applyLayerStackOrder();
      } finally {
        endBulkRun();
      }
      if (!layerEnabled[gid]) {
        const next = { ...layerRenderStats };
        delete next[gid];
        layerRenderStats = next;
      }
    }
  }

  // Unload a layer and update enabled/stats state.
  async function unloadLayer(layerInfo: UILayerInfo) {
    const gid = layerInfo.uiLayerId;
    await removeLayerGroup(map, gid);
    layerEnabled = { ...layerEnabled, [gid]: false };
    const next = { ...layerRenderStats };
    delete next[gid];
    layerRenderStats = next;
  }

  async function setIiifLayerEnabled(layerInfo: UILayerInfo, nextEnabled: boolean) {
    const gid = layerInfo.uiLayerId;
    const enabled = !!layerEnabled[gid];
    if (enabled === nextEnabled) return;

    if (nextEnabled) {
      layerEnabled = { ...layerEnabled, [gid]: true };
      // Sub-layer being enabled: unload the parent default layer (same source, same maps).
      // Parent being enabled: unload any active sub-layers for the same source.
      // Without this, the same maps land in two WarpedMapLayers simultaneously → visual artifacts.
      if (layerInfo.parentRenderLayerKey) {
        // This is a sub-layer — find and unload the parent.
        const parent = layers.find(
          (l) => l.sourceCollectionUrl === layerInfo.sourceCollectionUrl &&
                 l.renderLayerKey === layerInfo.parentRenderLayerKey
        );
        if (parent && layerEnabled[parent.uiLayerId]) {
          log("INFO", `Unloading parent layer "${layerName(parent)}" to avoid overlap with sub-layer`);
          await unloadLayer(parent);
        }
      } else if (layerInfo.renderLayerKey === "default") {
        // Parent being re-enabled — unload any active sub-layers for the same source.
        const subLayers = layers.filter(
          (l) => l.sourceCollectionUrl === layerInfo.sourceCollectionUrl &&
                 l.parentRenderLayerKey === "default"
        );
        for (const sub of subLayers) {
          if (layerEnabled[sub.uiLayerId]) {
            log("INFO", `Unloading sub-layer "${layerName(sub)}" to avoid overlap with parent`);
            await unloadLayer(sub);
          }
        }
      }
      await loadLayer(layerInfo);
    } else {
      await removeLayerGroup(map, gid);
      layerEnabled = { ...layerEnabled, [gid]: false };
      const next = { ...layerRenderStats };
      delete next[gid];
      layerRenderStats = next;
      log("INFO", `Layer "${layerName(layerInfo)}" removed`);
      applyLayerStackOrder();
    }
  }

  async function reloadIndex() {
    // Remove all layers before reloading
    for (const l of layers) {
      await removeLayerGroup(map, l.uiLayerId);
    }
    layers = [];
    layerEnabled = {};
    layerRenderStats = {};
    resetBulkMetrics();
    await fetchIndex();
  }

  function onWmtsSetEnabled(layerKey: HistCartLayerKey, nextEnabled: boolean) {
    if (wmtsEnabled[layerKey] === nextEnabled) return;
    wmtsEnabled = { ...wmtsEnabled, [layerKey]: nextEnabled };

    const apply = () => {
      setHistCartLayerVisible(map, layerKey, nextEnabled);
      if (nextEnabled) setHistCartLayerOpacity(map, layerKey, wmtsOpacity[layerKey]);
      const status = isHistCartLayerVisible(map, layerKey) ? "enabled" : "disabled";
      log("INFO", `WMTS "${layerKey}" ${status}`);
      if (nextEnabled) {
        // Band-aid fix: WMTS can ignore intended order on first add.
        // We replicate the proven manual workaround: move it to top first,
        // then restore the configured stack order.
        const original = [...stackItems];
        const wmtsId = WMTS_STACK_LAYER_ID[layerKey];
        const idx = original.findIndex((item) => item.id === wmtsId);
        if (idx >= 0) {
          const temp = [...original];
          const [wmtsItem] = temp.splice(idx, 1);
          temp.unshift(wmtsItem);
          stackItems = temp;
          applyLayerStackOrder();
          stackItems = original;
          requestAnimationFrame(() => applyLayerStackOrder());
          return;
        }
      }
      applyLayerStackOrder();
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }

  function onLayerOpacityInput(layerId: string, rawValue: string) {
    const value = clampOpacity(Number(rawValue));
    layerOpacity = { ...layerOpacity, [layerId]: value };
    if (layerEnabled[layerId]) setLayerGroupOpacity(map, layerId, value);
  }

  function onWmtsOpacityInput(layerKey: HistCartLayerKey, rawValue: string) {
    const value = clampOpacity(Number(rawValue));
    wmtsOpacity = { ...wmtsOpacity, [layerKey]: value };
    if (wmtsEnabled[layerKey]) setHistCartLayerOpacity(map, layerKey, value);
  }

  onMount(async () => {
    map = ensureMapContext(mapDiv);
    attachAllmapsDebugEvents(map, log);
    map.on("load", () => applyLayerStackOrder());
    await fetchIndex();
  });

  onDestroy(() => {
    destroyMapContext();
  });
</script>

<div class="wrap">
  <main class="map-shell">
    <div class="map-canvas" bind:this={mapDiv}></div>

    {#if layers.length > 0}
      <section class="map-layers-panel">
        <div class="section-title">Layers (Top to Bottom)</div>
        <div class="stack-list" role="list">
          {#each stackItems as item}
            {@const enabled = isStackItemEnabled(item)}
            {@const loading = isStackItemLoading(item)}
            <div
              class="stack-item"
              role="listitem"
              on:dragover={(e) => e.preventDefault()}
              on:drop={() => onStackDrop(item.id)}
              on:dragend={() => (draggedStackItemId = null)}
            >
              <div class="stack-head">
                <label class="layer-label" class:loading>
                  <input
                    type="checkbox"
                    checked={enabled}
                    on:change={(e) => onStackItemToggle(item, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  <button
                    type="button"
                    class="stack-grip mono"
                    draggable="true"
                    on:dragstart={() => onStackDragStart(item.id)}
                  >::</button>
                  <span class="stack-label">{item.label}</span>
                  <span class="layer-counts">{getStackItemCounts(item)}</span>
                </label>
              </div>
              <div class="opacity-row">
                <input
                  class="opacity-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={getStackItemOpacity(item)}
                  on:input={(e) => onStackItemOpacityInput(item, (e.currentTarget as HTMLInputElement).value)}
                />
                <span class="opacity-value mono">{Math.round(getStackItemOpacity(item) * 100)}%</span>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <button class="debug-toggle" type="button" on:click={() => (debugMenuOpen = !debugMenuOpen)}>
      {debugMenuOpen ? "Hide Debug Menu" : "Show Debug Menu"}
    </button>

    {#if debugMenuOpen}
      <aside class="debug-menu">
        <div class="debug-menu-head">
          <h2>Debug Menu</h2>
          <button type="button" class="debug-close" on:click={() => (debugMenuOpen = false)}>Close</button>
        </div>

        <div class="field">
          <label for="datasetBaseUrl">Dataset URL</label>
          <input
            id="datasetBaseUrl"
            bind:value={datasetBaseUrl}
            spellcheck="false"
            disabled={indexLoading}
          />
        </div>

        <button
          type="button"
          class="reload-btn"
          on:click={reloadIndex}
          disabled={indexLoading}
        >
          {indexLoading ? "Loading…" : "Reload Index"}
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
                <tr><th>Problematic manifests</th><td class={$bulkSummary.problematicCount > 0 ? "fail" : "ok"}>{$bulkSummary.problematicCount}</td></tr>
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
  </main>
</div>

<style>
  .wrap {
    height: 100vh;
  }

  .map-shell {
    position: relative;
    width: 100%;
    height: 100vh;
  }

  .map-canvas {
    width: 100%;
    height: 100%;
  }

  .map-layers-panel {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 2;
    width: min(420px, calc(100vw - 28px));
    max-height: calc(100vh - 28px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #d8d8d8;
    background: rgba(255, 255, 255, 0.93);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .debug-toggle {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 3;
    border: 1px solid #d1d1d1;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.95);
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 3px 14px rgba(0, 0, 0, 0.12);
  }

  .debug-menu {
    position: absolute;
    top: 52px;
    right: 14px;
    z-index: 2;
    width: min(360px, calc(100vw - 28px));
    max-height: calc(100vh - 66px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid #d8d8d8;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .debug-menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .debug-close {
    border: 1px solid #d1d1d1;
    border-radius: 6px;
    background: #fff;
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .problem-list {
    display: grid;
    gap: 6px;
    margin-bottom: 6px;
  }

  .problem-item {
    border: 1px solid #e8d6d6;
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff7f7;
    display: grid;
    gap: 2px;
  }

  .problem-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .problem-error {
    color: #8b1f1f;
    font-size: 12px;
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

  input:not([type="checkbox"]) {
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
    font-size: 12px;
  }

  .reload-btn {
    padding: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .reload-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error-msg {
    font-size: 11px;
    color: #c0392b;
    word-break: break-all;
  }

  /* Layers */
  .layers-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 800;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .layer-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .layer-row-sub {
    margin-left: 18px;
    border-left: 2px solid #e0e0e0;
    padding-left: 6px;
  }

  .layer-label {
    display: grid;
    grid-template-columns: 18px 18px minmax(120px, 1fr) max-content;
    align-items: center;
    column-gap: 8px;
    font-size: 12px;
    opacity: 1;
    cursor: pointer;
    user-select: none;
    width: 100%;
  }

  .layer-label-sub {
    font-size: 11px;
    opacity: 0.8;
  }

  .layer-label.loading {
    opacity: 0.6;
  }

  .layer-name {
    flex: 1;
    font-weight: 700;
  }

  .layer-counts {
    font-size: 10px;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
    min-width: 52px;
    text-align: right;
  }

  .opacity-row {
    margin-left: 52px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .opacity-slider {
    flex: 1;
  }

  .opacity-value {
    width: 40px;
    font-size: 11px;
    color: #666;
    text-align: right;
  }

  .stack-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 4px;
  }

  .stack-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px solid #e4e4e4;
    border-radius: 6px;
    background: #fafafa;
    user-select: none;
  }

  .stack-item-loading {
    opacity: 0.45;
  }

  .stack-grip {
    color: #888;
    width: 18px;
    cursor: grab;
    border: 0;
    background: transparent;
    padding: 0;
    line-height: 1;
  }

  .stack-grip:active {
    cursor: grabbing;
  }

  .stack-label {
    font-size: 12px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layer-progress {
    position: relative;
    height: 12px;
    background: #eee;
    border-radius: 3px;
    overflow: hidden;
    margin-left: 20px;
  }

  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: #4a90d9;
    transition: width 0.15s;
  }

  .layer-progress span {
    position: relative;
    font-size: 9px;
    padding: 0 4px;
    line-height: 12px;
  }

  .layer-progress-spinner {
    font-size: 10px;
    color: #4a90d9;
    margin-left: 20px;
  }

  .layer-sublayer {
    font-size: 11px;
    color: #888;
    margin-top: 1px;
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

  .cache-stats {
    padding: 6px 8px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ok { color: #2a7a2a; }

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

  @media (max-width: 900px) {
    .map-layers-panel {
      top: 10px;
      left: 10px;
      width: calc(100vw - 20px);
      max-height: 42vh;
    }

    .debug-toggle {
      top: 10px;
      right: 10px;
    }

    .debug-menu {
      top: 48px;
      right: 10px;
      width: calc(100vw - 20px);
      max-height: calc(58vh - 48px);
    }
  }
</style>
