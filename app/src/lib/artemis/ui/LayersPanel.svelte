<!-- Left slide-out panel listing historical map era layers with toggles, opacity, and sublayers. -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    MAIN_LAYER_ORDER, MAIN_LAYER_META, MAIN_LAYER_LABELS,
    MAIN_LAYER_SUBS, SUB_LAYER_DEFS,
    type MainLayerId,
  } from '$lib/artemis/layerConfig';

  export let mainLayerOrder: MainLayerId[] = [...MAIN_LAYER_ORDER];
  export let mainLayerEnabled: Record<string, boolean> = {};
  export let mainLayerLoading: Record<string, boolean> = {};
  export let mainLayerOpacity: Record<string, number> = {};
  export let subLayerEnabled: Record<string, boolean> = {};
  export let subLayerLoading: Record<string, boolean> = {};
  /** maps mainId → uiLayerId of its IIIF sublayer (for progress lookups) */
  export let iiifGroupIds: Record<string, string> = {};
  export let layerProgress: Record<string, { done: number; total: number }> = {};
  export let collapsed = false;
  export let activeLayerCount = 0;

  const dispatch = createEventDispatcher<{
    'toggle-main': { mainId: string; enabled: boolean };
    'toggle-sub':  { subId: string; enabled: boolean };
    'move-up':     { mainId: string };
    'move-down':   { mainId: string };
    'set-opacity': { mainId: string; value: string };
    'toggle-collapsed': void;
  }>();

  // Accordion expand state is local UI — reset when reordering
  let expanded: Record<string, boolean> = {};

  function toggleExpand(mainId: string) {
    const cur = expanded[mainId];
    expanded = {};
    if (!cur) expanded = { [mainId]: true };
  }

  function moveUp(mainId: string) {
    expanded = {};
    dispatch('move-up', { mainId });
  }

  function moveDown(mainId: string) {
    expanded = {};
    dispatch('move-down', { mainId });
  }
</script>

<div class="layers-panel-wrapper" class:collapsed>
  <section class="map-layers-panel">
    <div class="panel-header">
      <span class="panel-title">Historical layers</span>
      <span class="panel-count">{activeLayerCount} active</span>
    </div>
    <div class="panel-list">
      {#each mainLayerOrder as mainId (mainId)}
        {@const enabled = mainLayerEnabled[mainId] ?? false}
        {@const loading = mainLayerLoading[mainId] ?? false}
        {@const isExpanded = expanded[mainId] ?? false}
        {@const opacity = mainLayerOpacity[mainId] ?? 1}
        {@const subs = MAIN_LAYER_SUBS[mainId] ?? []}
        {@const isFirst = mainLayerOrder[0] === mainId}
        {@const isLast = mainLayerOrder[mainLayerOrder.length - 1] === mainId}
        {@const meta = MAIN_LAYER_META[mainId]}
        {@const iiifGid = iiifGroupIds[mainId] ?? ''}
        {@const progress = iiifGid ? (layerProgress[iiifGid] ?? null) : null}

        <div class="era-card" style="--layer-color:{meta.color}; --toggle-on:{meta.color};">
          <div class="era-header">
            <div class="order-arrows">
              <button class="arrow-btn" type="button" disabled={isFirst}
                on:click={() => moveUp(mainId)} aria-label="Move up">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 7l3-4 3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="arrow-btn" type="button" disabled={isLast}
                on:click={() => moveDown(mainId)} aria-label="Move down">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 4 3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>

            <button class="era-swatch" type="button"
              style="background-color:{meta.color};"
              on:click={() => toggleExpand(mainId)}
              aria-label="Toggle sublayers">
              {#if mainId === 'Ferraris'}
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                  {#each [4,9,14,19,24,29] as y}
                    <line x1="0" y1={y} x2="34" y2={y} stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                  {/each}
                </svg>
              {:else if mainId === 'Vandermaelen'}
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                  {#each [6,12,18,24,30] as v}
                    <line x1={v} y1="0" x2={v} y2="34" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                    <line x1="0" y1={v} x2="34" y2={v} stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                  {/each}
                </svg>
              {:else if mainId === 'PrimitiefKadaster'}
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                  {#each [0,8,16,24,32,40] as d}
                    <line x1={d-8} y1="0" x2={d+8} y2="34" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                  {/each}
                </svg>
              {:else if mainId === 'GereduceerdeKadaster'}
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                  {#each [6,12,18,24,30] as v}
                    <line x1={v} y1="0" x2={v} y2="34" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                    <line x1="0" y1={v} x2="34" y2={v} stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                  {/each}
                  {#each [0,8,16,24,32,40] as d}
                    <line x1={d-8} y1="0" x2={d+8} y2="34" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                  {/each}
                </svg>
              {:else}
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                  <path d="M0 20 Q8 14 17 20 Q26 26 34 20" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" fill="none"/>
                  <path d="M0 27 Q8 21 17 27 Q26 33 34 27" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" fill="none"/>
                </svg>
              {/if}
            </button>

            <button class="era-meta" type="button" on:click={() => toggleExpand(mainId)}>
              <span class="era-name">{MAIN_LAYER_LABELS[mainId]}</span>
              <span class="era-date">{meta.date}</span>
            </button>

            <div class="era-controls">
              <button
                class="toggle-pill"
                class:on={enabled}
                class:loading
                type="button"
                disabled={loading}
                on:click={() => dispatch('toggle-main', { mainId, enabled: !enabled })}
                aria-label={enabled ? 'Disable' : 'Enable'}
              ></button>
              <button class="chevron-btn" type="button"
                class:open={isExpanded}
                on:click={() => toggleExpand(mainId)}
                aria-label="Toggle sublayers">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4.5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>

          {#if loading && progress && progress.total > 0}
            {@const pct = Math.round((progress.done / progress.total) * 100)}
            <div class="era-progress">
              <div class="era-progress-bar" style="width:{pct}%"></div>
              <span class="era-progress-label">{progress.done}/{progress.total}</span>
            </div>
          {:else if loading}
            <div class="era-progress-spinner">Loading…</div>
          {/if}

          {#if isExpanded}
            <div class="sublayer-panel">
              {#each subs.filter(s => SUB_LAYER_DEFS[s]?.kind !== 'iiif') as subId (subId)}
                {@const subEnabled = subLayerEnabled[subId] ?? false}
                {@const subLoading = subLayerLoading[subId] ?? false}
                {@const subDef = SUB_LAYER_DEFS[subId]}
                <div class="sublayer-item">
                  <span class="sublayer-dot"></span>
                  <span class="sublayer-name">{subDef?.label ?? subId}</span>
                  <span class="sublayer-badge kind-{subDef?.kind ?? 'geojson'}">
                    {subDef?.kind === 'searchable' ? 'Searchable' : (subDef?.kind?.toUpperCase() ?? '')}
                  </span>
                  {#if subDef?.kind !== 'searchable'}
                    <button
                      class="toggle-pill small"
                      class:on={subEnabled}
                      class:loading={subLoading}
                      type="button"
                      disabled={subLoading}
                      on:click={() => dispatch('toggle-sub', { subId, enabled: !subEnabled })}
                      aria-label={subEnabled ? 'Disable' : 'Enable'}
                    ></button>
                  {/if}
                </div>
              {/each}
              <div class="opacity-row">
                <input class="opacity-slider" type="range" min="0" max="1" step="0.01"
                  value={opacity}
                  on:input={(e) => dispatch('set-opacity', { mainId, value: (e.currentTarget as HTMLInputElement).value })} />
                <span class="opacity-value mono">{Math.round(opacity * 100)}%</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <button
    class="layers-panel-tab"
    type="button"
    on:click={() => dispatch('toggle-collapsed')}
    aria-label={collapsed ? 'Expand layers' : 'Collapse layers'}
  >
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class:flipped={collapsed}>
      <path d="M7.5 2l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
</div>

<style>
  .layers-panel-wrapper {
    position: absolute;
    top: 14px;
    left: 0;
    z-index: 2;
    display: flex;
    align-items: flex-start;
    transform: translateX(0);
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .layers-panel-wrapper.collapsed {
    transform: translateX(calc(-100% + 32px));
  }

  .map-layers-panel {
    width: min(320px, calc(100vw - 14px));
    max-height: calc(100dvh - 28px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border-radius: 0 8px 8px 0;
    border: 1px solid var(--panel-border);
    border-left: none;
    box-shadow: var(--shadow-md);
  }

  .layers-panel-tab {
    flex-shrink: 0;
    margin-top: 24px;
    width: 32px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-left: none;
    border-radius: 0 8px 8px 0;
    cursor: pointer;
    color: var(--text-muted);
    box-shadow: 3px 0 8px rgba(0,0,0,0.08);
  }

  .layers-panel-tab:hover { color: var(--text-primary); }

  .layers-panel-tab svg {
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .layers-panel-tab svg.flipped { transform: rotate(180deg); }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 8px;
    border-bottom: 0.5px solid var(--panel-border);
    background: var(--panel-bg);
    border-radius: 8px 8px 0 0;
  }

  .panel-title { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .panel-count { font-size: 11px; color: var(--text-muted); }

  .panel-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    overflow-y: auto;
  }

  .era-card {
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--layer-color) 28%, transparent);
    border-left: 3px solid var(--layer-color);
    border-radius: 8px;
    background: var(--card-bg);
    overflow: hidden;
  }

  .era-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--layer-color) 9%, var(--card-bg));
  }

  .order-arrows { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }

  .arrow-btn {
    border: 0;
    background: transparent;
    padding: 1px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    transition: color 0.1s;
  }

  .arrow-btn:hover:not(:disabled) { color: var(--layer-color); }
  .arrow-btn:disabled { opacity: 0.2; cursor: default; }

  .era-swatch {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 0;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s;
  }

  .era-swatch:hover { opacity: 0.88; }

  .era-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .era-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--layer-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }

  .era-date { font-size: 11px; color: var(--text-muted); }

  .era-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

  .toggle-pill {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    border: 0;
    background: var(--toggle-off);
    cursor: pointer;
    position: relative;
    transition: background 0.18s;
    flex-shrink: 0;
  }

  .toggle-pill::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--toggle-thumb);
    transition: transform 0.18s;
    box-shadow: var(--shadow-sm);
  }

  .toggle-pill.on { background: var(--toggle-on); }
  .toggle-pill.on::after { transform: translateX(14px); }
  .toggle-pill.loading { opacity: 0.5; cursor: default; }

  .toggle-pill.small { width: 26px; height: 15px; border-radius: 7.5px; }
  .toggle-pill.small::after { width: 9px; height: 9px; top: 3px; left: 3px; }
  .toggle-pill.small.on::after { transform: translateX(11px); }

  .chevron-btn {
    border: 0;
    background: transparent;
    padding: 2px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    border-radius: 3px;
    transition: transform 0.18s, color 0.1s;
  }

  .chevron-btn.open { transform: rotate(180deg); }
  .chevron-btn:hover { color: var(--layer-color); }

  .sublayer-panel {
    border-top: 1px solid color-mix(in srgb, var(--layer-color) 20%, transparent);
    background: color-mix(in srgb, var(--layer-color) 5%, var(--card-bg));
    padding: 6px 0 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sublayer-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px 5px 14px;
    border-radius: 5px;
    transition: background 0.1s;
  }

  .sublayer-item:hover {
    background: color-mix(in srgb, var(--layer-color) 12%, var(--card-bg));
  }

  .sublayer-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--layer-color);
  }

  .sublayer-name { font-size: 12px; color: var(--text-primary); flex: 1; }

  .sublayer-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    letter-spacing: 0.01em;
  }

  .sublayer-badge.kind-iiif        { background: var(--badge-iiif-bg);   color: var(--badge-iiif-color); }
  .sublayer-badge.kind-geojson,
  .sublayer-badge.kind-wmts,
  .sublayer-badge.kind-wms         { background: var(--badge-geo-bg);    color: var(--badge-geo-color); }
  .sublayer-badge.kind-searchable  { background: var(--badge-search-bg); color: var(--badge-search-color); }

  .opacity-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 2px 14px;
  }

  .opacity-slider { flex: 1; accent-color: var(--layer-color); }

  .opacity-value {
    width: 36px;
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
    background: transparent;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }

  .era-progress {
    position: relative;
    height: 12px;
    background: var(--progress-bg);
    margin: 0 10px 6px;
    border-radius: 3px;
    overflow: hidden;
  }

  .era-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--layer-color);
    transition: width 0.15s;
  }

  .era-progress-label {
    position: relative;
    font-size: 9px;
    padding: 0 4px;
    line-height: 12px;
  }

  .era-progress-spinner {
    font-size: 10px;
    color: var(--spinner-color);
    padding: 2px 10px 6px;
  }

  @media (max-width: 900px) {
    .layers-panel-wrapper { top: 62px; }
    .map-layers-panel { width: calc(100vw - 14px); max-height: 42vh; }
  }
</style>
