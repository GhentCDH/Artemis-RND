<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { PreviewBubbleItem } from '$lib/artemis/types';
  import { loadManifestPreview } from '$lib/artemis/viewer/manifestPreview';

  export let item: PreviewBubbleItem;
  export let x = 0;
  export let y = 0;
  export let placeBelow = false;

  const dispatch = createEventDispatcher<{
    close: void;
    'open-viewer': { title: string; sourceManifestUrl: string; imageServiceUrl: string };
  }>();

  const BUBBLE_WIDTH = 280;
  const VIEWPORT_MARGIN = 12;
  const ARROW_OFFSET = 18;
  const BOTTOM_CLEARANCE = 28;
  const TOP_CLEARANCE = 240;
  const PREVIEW_MAX_HEIGHT = 220;
  const ENTRY_MIN_WIDTH = 220;
  const ENTRY_MAX_WIDTH = 360;
  const ENTRY_CHROME_WIDTH = 22;
  const BUBBLE_PADDING_X = 28;
  const BUBBLE_GAP_X = 12;
  const MULTI_ENTRY_WIDTH = 260;

  let previewUrl = '';
  let previewTitle = '';
  let imageServiceUrl = '';
  let loadingPreview = false;
  let loadError = '';
  let viewportWidth = 1200;
  let viewportHeight = 800;
  let previewByKey: Record<string, {
    previewUrl: string;
    previewTitle: string;
    imageServiceUrl: string;
    loading: boolean;
    loadError: string;
    previewWidth: number;
    previewHeight: number;
  }> = {};

  $: bubbleItems = item?.alternatives?.length ? item.alternatives : item ? [item] : [];
  $: currentItem = bubbleItems[0] ?? item;
  $: isMultiBubble = bubbleItems.length > 1;
  $: bubbleWidth = computeBubbleWidth(bubbleItems);

  $: clampedX = Math.min(
    Math.max(x, VIEWPORT_MARGIN + bubbleWidth / 2),
    viewportWidth - VIEWPORT_MARGIN - bubbleWidth / 2
  );
  $: clampedY = Math.min(
    Math.max(y, VIEWPORT_MARGIN + (placeBelow ? BOTTOM_CLEARANCE : TOP_CLEARANCE)),
    viewportHeight - VIEWPORT_MARGIN - (placeBelow ? TOP_CLEARANCE : BOTTOM_CLEARANCE)
  );
  $: bubbleTransform = placeBelow
    ? `translate(-50%, ${ARROW_OFFSET}px)`
    : `translate(-50%, calc(-100% - ${ARROW_OFFSET}px))`;
  $: if (bubbleItems.length > 0) {
    for (const bubbleItem of bubbleItems) {
      void fetchPreviewForItem(bubbleItem);
    }
  }

  function previewKey(bubbleItem: PreviewBubbleItem): string {
    return `${bubbleItem.manifestUrl}::${bubbleItem.imageServiceUrl ?? ''}`;
  }

  async function fetchPreviewForItem(bubbleItem: PreviewBubbleItem) {
    const key = previewKey(bubbleItem);
    if (previewByKey[key]?.loading || previewByKey[key]?.previewUrl || previewByKey[key]?.imageServiceUrl || previewByKey[key]?.loadError) return;
    previewByKey = {
      ...previewByKey,
      [key]: { previewUrl: '', previewTitle: '', imageServiceUrl: '', loading: true, loadError: '', previewWidth: 0, previewHeight: 0 }
    };
    try {
      if (bubbleItem.imageServiceUrl) {
        const normalized = bubbleItem.imageServiceUrl.replace(/\/$/, '');
        const previewUrl = `${normalized}/full/400,/0/default.jpg`;
        const dims = await loadImageDimensions(previewUrl);
        previewByKey = {
          ...previewByKey,
          [key]: {
            previewUrl,
            previewTitle: bubbleItem.title || '',
            imageServiceUrl: normalized,
            loading: false,
            loadError: '',
            previewWidth: dims.width,
            previewHeight: dims.height,
          }
        };
        return;
      }

      const preview = await loadManifestPreview(bubbleItem.manifestUrl);
      const dims = await loadImageDimensions(preview.previewUrl);
      previewByKey = {
        ...previewByKey,
        [key]: {
          previewUrl: preview.previewUrl,
          previewTitle: preview.title,
          imageServiceUrl: preview.imageServiceUrl,
          loading: false,
          loadError: '',
          previewWidth: dims.width,
          previewHeight: dims.height,
        }
      };
    } catch (err: any) {
      previewByKey = {
        ...previewByKey,
        [key]: {
          previewUrl: '',
          previewTitle: '',
          imageServiceUrl: '',
          loading: false,
          loadError: err?.message ?? 'Preview unavailable',
          previewWidth: 0,
          previewHeight: 0,
        }
      };
    }
  }

  function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
  }

  function getEntryWidth(bubbleItem: PreviewBubbleItem): number {
    if (isMultiBubble) return MULTI_ENTRY_WIDTH;
    const preview = previewByKey[previewKey(bubbleItem)];
    const width = preview?.previewWidth ?? 0;
    const height = preview?.previewHeight ?? 0;
    if (width > 0 && height > 0) {
      const scaled = (width / height) * PREVIEW_MAX_HEIGHT + ENTRY_CHROME_WIDTH;
      return Math.max(ENTRY_MIN_WIDTH, Math.min(ENTRY_MAX_WIDTH, Math.round(scaled)));
    }
    return 280;
  }

  function computeBubbleWidth(items: PreviewBubbleItem[]): number {
    if (items.length === 0) return BUBBLE_WIDTH;
    if (items.length > 1) {
      const columns = Math.min(items.length, 2);
      const contentWidth = columns * MULTI_ENTRY_WIDTH + Math.max(0, columns - 1) * BUBBLE_GAP_X;
      return Math.min(viewportWidth - VIEWPORT_MARGIN * 2, Math.max(BUBBLE_WIDTH, BUBBLE_PADDING_X + contentWidth));
    }
    const entryWidths = items.map((bubbleItem) => getEntryWidth(bubbleItem));
    const contentWidth = entryWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, items.length - 1) * BUBBLE_GAP_X;
    return Math.min(viewportWidth - VIEWPORT_MARGIN * 2, Math.max(BUBBLE_WIDTH, BUBBLE_PADDING_X + contentWidth));
  }

  function openViewer(bubbleItem: PreviewBubbleItem) {
    const preview = previewByKey[previewKey(bubbleItem)];
    dispatch('open-viewer', {
      title: bubbleItem.title || preview?.previewTitle || 'Untitled document',
      sourceManifestUrl: bubbleItem.manifestUrl,
      imageServiceUrl: bubbleItem.imageServiceUrl || preview?.imageServiceUrl || '',
    });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
  }

  function syncViewport() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
  }

  onMount(() => {
    syncViewport();
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', syncViewport);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', syncViewport);
    };
  });
</script>

<div
  class="image-collection-bubble-anchor"
  style="left:{clampedX}px;top:{clampedY}px;transform:{bubbleTransform}"
>
  <div class="image-collection-bubble" class:is-below={placeBelow} style={`width:${bubbleWidth}px;`}>
    <button class="ui-icon-btn image-collection-bubble-close" type="button" on:click={() => dispatch('close')} aria-label="Close">×</button>
    <div class="ui-mono image-collection-bubble-kicker">{currentItem?.kicker || item.kicker || 'Image Collection'}</div>
    {#if bubbleItems.length > 1}
      <div class="image-collection-bubble-group-title">{bubbleItems.length} map sheets at this location</div>
    {/if}
    <div class="image-collection-bubble-list" class:is-multi={isMultiBubble}>
      {#each bubbleItems as bubbleItem}
        {@const preview = previewByKey[previewKey(bubbleItem)]}
        <section class="image-collection-bubble-entry" style={`width:${getEntryWidth(bubbleItem)}px;`}>
          <div class="image-collection-bubble-title">{bubbleItem.title}</div>
          <div class="image-collection-bubble-meta">
            {#if bubbleItem.year}<span>{bubbleItem.year}</span>{/if}
            {#if bubbleItem.location}<span>{bubbleItem.location}</span>{/if}
          </div>
          <div class="image-collection-bubble-preview">
            {#if preview?.previewUrl}
              <img src={preview.previewUrl} alt={preview.previewTitle || bubbleItem.title} />
            {:else if preview?.loading}
              <div class="image-collection-bubble-status">Loading preview…</div>
            {:else}
              <div class="image-collection-bubble-status image-collection-bubble-status-error">{preview?.loadError || 'Preview unavailable'}</div>
            {/if}
          </div>
          <div class="image-collection-bubble-actions">
            <button class="ui-btn-primary" type="button" on:click={() => openViewer(bubbleItem)}>Open in viewer</button>
          </div>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .image-collection-bubble-anchor {
    position: fixed;
    z-index: 70;
    pointer-events: none;
  }

  .image-collection-bubble {
    position: relative;
    max-height: min(70vh, 760px);
    background: var(--bubble-bg);
    border: 1px solid var(--bubble-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: auto;
  }

  .image-collection-bubble-list {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .image-collection-bubble-list.is-multi {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 260px));
    justify-content: start;
  }

  .image-collection-bubble-entry {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 2px;
    flex: 0 0 auto;
    max-width: 100%;
  }

  .image-collection-bubble-list.is-multi .image-collection-bubble-entry {
    width: 100% !important;
  }

  @media (max-width: 620px) {
    .image-collection-bubble-list.is-multi {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .image-collection-bubble-entry {
    border: 1px solid var(--bubble-card-border);
    border-radius: var(--radius-sm);
    padding: 10px;
    background: var(--bubble-card-bg);
  }

  .image-collection-bubble::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: 18px;
    height: 18px;
    background: var(--bubble-bg);
    border-right: 1px solid var(--bubble-border);
    border-bottom: 1px solid var(--bubble-border);
    transform: translate(-50%, -9px) rotate(45deg);
  }

  .image-collection-bubble.is-below::after {
    top: auto;
    bottom: 100%;
    border-right: none;
    border-bottom: none;
    border-left: 1px solid var(--bubble-border);
    border-top: 1px solid var(--bubble-border);
    transform: translate(-50%, 9px) rotate(45deg);
  }

  /* Override ui-icon-btn: absolute position, bubble close color */
  .image-collection-bubble-close {
    position: absolute;
    top: 8px;
    right: 9px;
    color: var(--bubble-close);
    font-size: 18px;
    line-height: 1;
  }

  /* Override ui-mono: kicker-specific color and treatment */
  .image-collection-bubble-kicker {
    font-size: 11px;
    color: var(--bubble-kicker);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .image-collection-bubble-title {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.35;
    color: var(--bubble-title);
    padding-right: 18px;
  }

  .image-collection-bubble-group-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--bubble-meta-strong);
  }

  .image-collection-bubble-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    color: var(--bubble-meta);
  }

  .image-collection-bubble-meta span {
    padding: 3px 7px;
    background: var(--bubble-meta-chip-bg);
    border-radius: var(--radius-pill);
  }

  .image-collection-bubble-preview {
    overflow: hidden;
    min-height: 150px;
    max-height: 220px;
    border-radius: var(--radius-sm);
    background: var(--bubble-preview-bg);
    border: 1px solid var(--bubble-preview-border);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .image-collection-bubble-preview img {
    display: block;
    width: 100%;
    height: 100%;
    max-height: 220px;
    object-fit: contain;
    position: relative;
    z-index: 1;
  }

  .image-collection-bubble-status {
    padding: 24px 18px;
    text-align: center;
    font-size: 12px;
    color: var(--bubble-status);
    position: relative;
    z-index: 1;
  }

  .image-collection-bubble-status-error {
    color: var(--bubble-status-error);
  }

  .image-collection-bubble-actions {
    display: flex;
    justify-content: flex-end;
  }

</style>
