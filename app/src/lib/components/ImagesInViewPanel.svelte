<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import Button from '$lib/artemis/ui/primitives/Button.svelte';
  import Window from '$lib/artemis/ui/primitives/Window.svelte';
  import RangeSlider from '$lib/artemis/ui/primitives/RangeSlider.svelte';
  import type { SpriteRef, PreviewBubbleItem } from '$lib/artemis/shared/types';

  export let items: Array<{ title: string; year?: string; spriteRef?: SpriteRef; manifestUrl?: string; imageServiceUrl?: string; mmsId?: string }> = [];
  export let forceClose = false;

  const dispatch = createEventDispatcher<{
    click: PreviewBubbleItem;
    open: void;
    close: void;
  }>();

  const THUMB_W = 48;
  const THUMB_H = 36;

  let isOpen = false;
  let filterStart = 0;
  let filterEnd = 0;

  function togglePanel() {
    isOpen = !isOpen;
  }

  function closePanel() {
    isOpen = false;
  }

  function scale(s: SpriteRef): number {
    return Math.min(THUMB_H / s.height, THUMB_W / s.width);
  }

  // Compute available year range from items
  $: yearValues = items
    .map(i => parseInt(i.year ?? ''))
    .filter(y => isFinite(y));

  $: yearMin = yearValues.length > 0 ? Math.min(...yearValues) : 0;
  $: yearMax = yearValues.length > 0 ? Math.max(...yearValues) : 0;

  // Initialize filter range when available range changes
  $: {
    if (isFinite(yearMin) && isFinite(yearMax) && yearMin !== yearMax) {
      filterStart = yearMin;
      filterEnd = yearMax;
    }
  }

  // Filter items by year range
  $: filteredItems = items.filter(item => {
    const y = parseInt(item.year ?? '');
    if (!isFinite(y)) return false;
    return y >= filterStart && y <= filterEnd;
  });

  // Show slider only if there are at least 2 distinct years
  $: hasYearRange = yearMin !== yearMax && yearValues.length >= 2;

  // Close panel when forceClose signal is triggered
  $: if (forceClose && isOpen) {
    closePanel();
  }

  // Emit open/close events when panel visibility changes
  $: if (isOpen) {
    dispatch('open');
  } else {
    dispatch('close');
  }

  function handleItemClick(item: any) {
    const bubbleItem: PreviewBubbleItem = {
      title: item.title,
      manifestUrl: item.manifestUrl,
      imageServiceUrl: item.imageServiceUrl,
      year: item.year,
      location: item.location,
      spriteRef: item.spriteRef,
    };
    dispatch('click', bubbleItem);
    closePanel();
  }

  function handleItemKeydown(item: any, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleItemClick(item);
    }
  }
</script>

<div class="images-panel-container">
  <!-- Button on the right side -->
  <Button
    class="images-button"
    variant="toolbar"
    aria-label="Toggle images in view panel"
    aria-expanded={isOpen}
    on:click={togglePanel}
  >
    <span class="images-button-icon">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
      </svg>
    </span>
    <span class="images-button-text">
      Images {#if items.length > 0}<span class="count">{items.length}</span>{/if}
    </span>
  </Button>

  <!-- Expandable Panel -->
  {#if isOpen}
    <div transition:fade={{ duration: 180 }}>
      <Window
        class="images-panel"
        title="Images in view"
        variant="docked"
        placement="right"
        showClose={true}
        closeLabel="Close images panel"
        closeOnEscape={true}
        on:close={closePanel}
      >
        {#if hasYearRange}
          <div class="filter-bar">
            <RangeSlider
              min={yearMin}
              max={yearMax}
              bind:start={filterStart}
              bind:end={filterEnd}
            />
          </div>
        {/if}

        <div class="panel-content">
          {#if items.length === 0}
            <p class="empty-text">No images in this view</p>
          {:else if filteredItems.length === 0}
            <p class="empty-text">No images in selected year range</p>
          {:else}
            <div class="images-list">
              {#each filteredItems as item}
                <div
                  class="images-entry"
                  role="button"
                  tabindex="0"
                  on:click={() => handleItemClick(item)}
                  on:keydown={(e) => handleItemKeydown(item, e)}
                >
                  {#if item.spriteRef}
                    <div
                      class="thumb"
                      style="width:{THUMB_W}px; height:{THUMB_H}px;
                              background-image:url({encodeURI(item.spriteRef.sheetUrl)});
                              background-size:{Math.round(item.spriteRef.sheetWidth * scale(item.spriteRef))}px {Math.round(item.spriteRef.sheetHeight * scale(item.spriteRef))}px;
                              background-position:-{Math.round(item.spriteRef.x * scale(item.spriteRef))}px -{Math.round(item.spriteRef.y * scale(item.spriteRef))}px;"
                    ></div>
                  {:else}
                    <div class="thumb thumb--placeholder"></div>
                  {/if}
                  <div class="meta">
                    <span class="entry-title">{item.title}</span>
                    {#if item.year}<span class="entry-year">{item.year}</span>{/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </Window>
    </div>
  {/if}
</div>

<style>
  .images-panel-container {
    position: fixed;
    top: calc(16px + 8vh);
    right: 16px;
    z-index: 51;
  }

  :global(.images-button) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: white;
    border: 0.5px solid rgba(0, 0, 0, 0.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  :global(.images-button:hover) {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    border-color: rgba(0, 0, 0, 0.15);
  }

  .images-button-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    color: #5c6fb1;
  }

  .images-button-icon svg {
    width: 100%;
    height: 100%;
  }

  .images-button-text {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.1;
  }

  :global(.images-panel) {
    position: fixed;
    top: calc(16px + 5vh);
    right: 16px;
    width: 15vw;
    max-height: calc(100vh - 280px);
    z-index: 98;
    background: rgba(255, 255, 255, 0.95) !important;
    backdrop-filter: blur(12px);
  }

  :global(.images-panel .artemis-window-header) {
    padding: 16px;
    border-bottom-color: rgba(0, 0, 0, 0.1);
    background: white;
  }

  :global(.images-panel .artemis-window-heading h2) {
    font-size: 14px;
    font-weight: 600;
  }

  :global(.images-panel .artemis-window-body) {
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: white;
    padding: 0;
  }

  .filter-bar {
    flex: 0 0 auto;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: white;
  }

  .panel-content {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 10px 12px;
  }

  .empty-text {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .images-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .images-entry {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px;
    border-radius: var(--radius-xs);
    transition: background 150ms ease;
    cursor: pointer;
  }

  .images-entry:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .thumb {
    flex: 0 0 auto;
    width: 48px;
    height: 36px;
    border-radius: var(--radius-xs);
    background-size: cover;
    background-position: center;
    border: 0.5px solid rgba(0, 0, 0, 0.08);
  }

  .thumb--placeholder {
    background: linear-gradient(135deg, #e5e7eb 0%, #f3f4f6 100%);
  }

  .meta {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    justify-content: center;
  }

  .entry-title {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-year {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .count {
    display: inline-block;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: var(--radius-pill);
    background: #5c6fb1;
    color: white;
    font-size: 11px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
    margin-left: 4px;
  }
</style>
