<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { MassartItem } from '$lib/artemis/types';
  import { loadManifestPreview } from '$lib/artemis/viewer/manifestPreview';

  export let item: MassartItem;
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

  let previewUrl = '';
  let previewTitle = '';
  let imageServiceUrl = '';
  let loadingPreview = false;
  let loadError = '';
  let viewportWidth = 1200;
  let viewportHeight = 800;

  $: clampedX = Math.min(
    Math.max(x, VIEWPORT_MARGIN + BUBBLE_WIDTH / 2),
    viewportWidth - VIEWPORT_MARGIN - BUBBLE_WIDTH / 2
  );
  $: clampedY = Math.min(
    Math.max(y, VIEWPORT_MARGIN + (placeBelow ? BOTTOM_CLEARANCE : TOP_CLEARANCE)),
    viewportHeight - VIEWPORT_MARGIN - (placeBelow ? TOP_CLEARANCE : BOTTOM_CLEARANCE)
  );
  $: bubbleTransform = placeBelow
    ? `translate(-50%, ${ARROW_OFFSET}px)`
    : `translate(-50%, calc(-100% - ${ARROW_OFFSET}px))`;
  $: if (item?.manifestUrl) {
    void fetchPreview(item.manifestUrl);
  }

  async function fetchPreview(manifestUrl: string) {
    loadingPreview = true;
    loadError = '';
    previewUrl = '';
    previewTitle = '';
    imageServiceUrl = '';

    try {
      const preview = await loadManifestPreview(manifestUrl);
      if (item.manifestUrl !== manifestUrl) return;
      previewUrl = preview.previewUrl;
      previewTitle = preview.title;
      imageServiceUrl = preview.imageServiceUrl;
    } catch (err: any) {
      if (item.manifestUrl !== manifestUrl) return;
      loadError = err?.message ?? 'Preview unavailable';
    } finally {
      if (item.manifestUrl === manifestUrl) loadingPreview = false;
    }
  }

  function openViewer() {
    dispatch('open-viewer', {
      title: item.title || previewTitle || 'Untitled document',
      sourceManifestUrl: item.manifestUrl,
      imageServiceUrl,
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
  <div class="image-collection-bubble" class:is-below={placeBelow}>
    <button class="image-collection-bubble-close" type="button" on:click={() => dispatch('close')} aria-label="Close">×</button>
    <div class="image-collection-bubble-kicker">Image Collection</div>
    <div class="image-collection-bubble-title">{item.title}</div>
    <div class="image-collection-bubble-meta">
      {#if item.year}<span>{item.year}</span>{/if}
      {#if item.location}<span>{item.location}</span>{/if}
    </div>

    <div class="image-collection-bubble-preview">
      {#if previewUrl}
        <img src={previewUrl} alt={previewTitle || item.title} />
      {:else if loadingPreview}
        <div class="image-collection-bubble-status">Loading preview…</div>
      {:else}
        <div class="image-collection-bubble-status image-collection-bubble-status-error">{loadError || 'Preview unavailable'}</div>
      {/if}
    </div>

    <div class="image-collection-bubble-actions">
      <button class="image-collection-bubble-open" type="button" on:click={openViewer}>Open in viewer</button>
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
    width: 280px;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: auto;
  }

  .image-collection-bubble::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: 18px;
    height: 18px;
    background: rgba(255, 255, 255, 0.98);
    border-right: 1px solid rgba(0, 0, 0, 0.12);
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    transform: translate(-50%, -9px) rotate(45deg);
  }

  .image-collection-bubble.is-below::after {
    top: auto;
    bottom: 100%;
    border-right: none;
    border-bottom: none;
    border-left: 1px solid rgba(0, 0, 0, 0.12);
    border-top: 1px solid rgba(0, 0, 0, 0.12);
    transform: translate(-50%, 9px) rotate(45deg);
  }

  .image-collection-bubble-close {
    position: absolute;
    top: 8px;
    right: 9px;
    border: none;
    background: transparent;
    color: rgba(0,0,0,0.4);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .image-collection-bubble-kicker {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #9a7b2f;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .image-collection-bubble-title {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.35;
    color: #1a1a1a;
    padding-right: 18px;
  }

  .image-collection-bubble-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    color: rgba(0,0,0,0.6);
  }

  .image-collection-bubble-meta span {
    padding: 3px 7px;
    background: rgba(0,0,0,0.05);
    border-radius: var(--radius-pill);
  }

  .image-collection-bubble-preview {
    overflow: hidden;
    min-height: 150px;
    border-radius: var(--radius-sm);
    background: #f2efe9;
    border: 1px solid rgba(0,0,0,0.08);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .image-collection-bubble-preview img {
    display: block;
    width: 100%;
    height: auto;
  }

  .image-collection-bubble-status {
    padding: 24px 18px;
    text-align: center;
    font-size: 12px;
    color: rgba(0,0,0,0.55);
  }

  .image-collection-bubble-status-error {
    color: rgba(132, 43, 43, 0.82);
  }

  .image-collection-bubble-actions {
    display: flex;
    justify-content: flex-end;
  }

  .image-collection-bubble-open {
    border: none;
    border-radius: var(--radius-pill);
    padding: 9px 14px;
    background: #1f1f1f;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .image-collection-bubble-open:hover {
    background: #333333;
  }
</style>
