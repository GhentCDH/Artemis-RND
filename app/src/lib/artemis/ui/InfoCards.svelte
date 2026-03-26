<!-- Right-side floating info cards shown on IIIF map click and parcel click. -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { MAIN_LAYER_META } from '$lib/artemis/layerConfig';
  import type { IiifMapInfo, IiifPanelGroup, ParcelClickInfo, PinnedCard } from '$lib/artemis/types';

  export let pinnedCards: PinnedCard[] = [];
  export let iiifPanelGroups: IiifPanelGroup[] = [];
  export let parcelClickInfo: ParcelClickInfo | null = null;

  const dispatch = createEventDispatcher<{
    'unpin': number;
    'close-iiif': string;
    'close-parcel': void;
    'pin-iiif': IiifPanelGroup;
    'pin-parcel': void;
    'focus-iiif': IiifPanelGroup;
    'focus-parcel': ParcelClickInfo;
    'open-viewer': IiifMapInfo;
  }>();

  const PRIMITIEF_COLOR = MAIN_LAYER_META['primitief'].color;
</script>

<div class="info-cards">

  <!-- Pinned cards -->
  {#each pinnedCards as pinned, pi (pi)}
    {#if pinned.type === 'parcel'}
      <div class="info-card pinned" style="--group-color:{PRIMITIEF_COLOR};">
        <div class="info-card-header">
          <span class="swatch" style="background:{PRIMITIEF_COLOR};"></span>
          <span class="info-card-title">Parcel {pinned.info.parcelLabel}</span>
          <div class="info-card-actions">
            <button class="info-card-btn active" type="button" on:click={() => dispatch('unpin', pi)} aria-label="Unpin">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 2l-1 4H4l3 3-1 5 4-3 4 3-1-5 3-3H10L9 2z" fill="currentColor"/></svg>
            </button>
            <button class="info-card-btn" type="button" on:click={() => dispatch('focus-parcel', pinned.info)} aria-label="Focus">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
            <button class="info-card-close" type="button" on:click={() => dispatch('unpin', pi)} aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <div class="parcel-detail-block">
          <div class="parcel-detail-row">
            <span class="parcel-detail-key">Leaf</span>
            <span class="parcel-detail-val mono">{pinned.info.leafId}</span>
          </div>
          {#each Object.entries(pinned.info.properties).filter(([k, v]) => !k.startsWith('_') && String(v ?? '').trim() && k !== 'parcel_number' && k !== 'parcel_index') as [k, v]}
            <div class="parcel-detail-row">
              <span class="parcel-detail-key">{k.replace(/_/g, ' ')}</span>
              <span class="parcel-detail-val">{v}</span>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="info-card pinned" style="--group-color:{pinned.group.layerColor};">
        <div class="info-card-header">
          <span class="swatch" style="background:{pinned.group.layerColor};"></span>
          <span class="info-card-title">{pinned.group.layerLabel}</span>
          {#if pinned.group.items.length > 1}
            <span class="group-count">{pinned.group.items.length}</span>
          {/if}
          <div class="info-card-actions">
            <button class="info-card-btn active" type="button" on:click={() => dispatch('unpin', pi)} aria-label="Unpin">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 2l-1 4H4l3 3-1 5 4-3 4 3-1-5 3-3H10L9 2z" fill="currentColor"/></svg>
            </button>
            <button class="info-card-btn" type="button" on:click={() => dispatch('focus-iiif', pinned.group)} aria-label="Focus">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
            <button class="info-card-close" type="button" on:click={() => dispatch('unpin', pi)} aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        {#each pinned.group.items as item (item.sourceManifestUrl)}
          <button type="button" class="iiif-map-row" on:click={() => dispatch('open-viewer', item)}>
            {#if item.imageServiceUrl}
              <img class="iiif-thumb" src="{item.imageServiceUrl}/full/!56,56/0/default.jpg" alt="" loading="lazy" />
            {:else}
              <div class="iiif-thumb-placeholder"></div>
            {/if}
            <span class="iiif-map-row-title">{item.title}</span>
            <svg class="iiif-map-row-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        {/each}
      </div>
    {/if}
  {/each}

  <!-- Current (unpinned) parcel card -->
  {#if parcelClickInfo}
    <div class="info-card" style="--group-color:{PRIMITIEF_COLOR};">
      <div class="info-card-header">
        <span class="swatch" style="background:{PRIMITIEF_COLOR};"></span>
        <span class="info-card-title">Parcel {parcelClickInfo.parcelLabel}</span>
        <div class="info-card-actions">
          <button class="info-card-btn" type="button" on:click={() => dispatch('pin-parcel')} aria-label="Pin">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 2l-1 4H4l3 3-1 5 4-3 4 3-1-5 3-3H10L9 2z" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>
          </button>
          <button class="info-card-btn" type="button" on:click={() => dispatch('focus-parcel', parcelClickInfo!)} aria-label="Focus">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="info-card-close" type="button" on:click={() => dispatch('close-parcel')} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div class="parcel-detail-block">
        <div class="parcel-detail-row">
          <span class="parcel-detail-key">Leaf</span>
          <span class="parcel-detail-val mono">{parcelClickInfo.leafId}</span>
        </div>
        {#each Object.entries(parcelClickInfo.properties).filter(([k, v]) => !k.startsWith('_') && String(v ?? '').trim() && k !== 'parcel_number' && k !== 'parcel_index') as [k, v]}
          <div class="parcel-detail-row">
            <span class="parcel-detail-key">{k.replace(/_/g, ' ')}</span>
            <span class="parcel-detail-val">{v}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Current (unpinned) IIIF cards -->
  {#each iiifPanelGroups as group (group.layerLabel)}
    <div class="info-card" style="--group-color:{group.layerColor};">
      <div class="info-card-header">
        <span class="swatch" style="background:{group.layerColor};"></span>
        <span class="info-card-title">{group.layerLabel}</span>
        {#if group.items.length > 1}
          <span class="group-count">{group.items.length}</span>
        {/if}
        <div class="info-card-actions">
          <button class="info-card-btn" type="button" on:click={() => dispatch('pin-iiif', group)} aria-label="Pin">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 2l-1 4H4l3 3-1 5 4-3 4 3-1-5 3-3H10L9 2z" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>
          </button>
          <button class="info-card-btn" type="button" on:click={() => dispatch('focus-iiif', group)} aria-label="Focus">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="info-card-close" type="button" on:click={() => dispatch('close-iiif', group.layerLabel)} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      {#each group.items as item (item.sourceManifestUrl)}
        <button type="button" class="iiif-map-row" on:click={() => dispatch('open-viewer', item)}>
          {#if item.imageServiceUrl}
            <img class="iiif-thumb" src="{item.imageServiceUrl}/full/!56,56/0/default.jpg" alt="" loading="lazy" />
          {:else}
            <div class="iiif-thumb-placeholder"></div>
          {/if}
          <span class="iiif-map-row-title">{item.title}</span>
          <svg class="iiif-map-row-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      {/each}
    </div>
  {/each}

</div>

<style>
  .info-cards {
    position: absolute;
    top: 14px;
    right: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: calc(100dvh - 28px);
    overflow-y: auto;
    pointer-events: none;
  }

  .info-card {
    pointer-events: all;
    width: min(300px, 92vw);
    background: var(--panel-bg);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    border: 1px solid var(--panel-border);
    border-right: none;
    box-shadow: var(--shadow-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .info-card.pinned {
    border-color: var(--group-color, var(--panel-border));
  }

  .info-card-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    background: var(--card-bg);
    background: color-mix(in srgb, var(--group-color, #aaa) 10%, var(--card-bg));
    border-bottom: 0.5px solid var(--panel-border);
    flex-shrink: 0;
  }

  .info-card-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--group-color, #555);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  }

  .info-card-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .info-card-btn,
  .info-card-close {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 3px;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .info-card-btn:hover,
  .info-card-close:hover {
    color: var(--text-primary);
    background: rgba(0, 0, 0, 0.06);
  }

  .info-card-btn.active { color: var(--group-color, #555); }

  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .group-count {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--group-color, #aaa) 15%, var(--card-bg));
    color: var(--group-color, #555);
  }

  .iiif-map-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--radius-xs);
    border: none;
    background: none;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
    width: 100%;
  }

  .iiif-map-row:hover {
    background: color-mix(in srgb, var(--group-color, #aaa) 10%, var(--card-bg));
  }

  .iiif-thumb {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--radius-xs);
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.06);
  }

  .iiif-thumb-placeholder {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-xs);
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  .iiif-map-row-title {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .iiif-map-row-arrow {
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0.5;
  }

  /* Parcel detail */
  .parcel-detail-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
  }

  .parcel-detail-row {
    display: flex;
    gap: 8px;
    padding: 4px 8px;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--group-color, #aaa) 7%, var(--card-bg));
    font-size: 12px;
    line-height: 1.4;
  }

  .parcel-detail-key {
    flex-shrink: 0;
    width: 90px;
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .parcel-detail-val {
    flex: 1;
    color: var(--text-primary);
    word-break: break-all;
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
