<!-- IiifViewer.svelte — minimal inset IIIF document overlay with OpenSeadragon -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type OpenSeadragonType from "openseadragon";

  export let imageServiceUrl: string;
  export let title: string = "";

  const dispatch = createEventDispatcher<{ close: void }>();

  let container: HTMLElement;
  let viewer: OpenSeadragonType.Viewer | undefined;

  onMount(async () => {
    window.addEventListener("keydown", onKeyDown);

    const OpenSeadragon = (await import("openseadragon")).default;
    viewer = OpenSeadragon({
      element: container,
      tileSources: `${imageServiceUrl}/info.json`,
      showNavigationControl: false,
      showZoomControl: false,
      showHomeControl: false,
      showFullPageControl: false,
      showSequenceControl: false,
      animationTime: 0.3,
      springStiffness: 10,
      visibilityRatio: 0.5,
      minZoomLevel: 0.1,
      gestureSettingsMouse: { scrollToZoom: true },
    } as OpenSeadragonType.Options);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
    viewer?.destroy();
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") dispatch("close");
  }
</script>

<!-- Backdrop dims the map behind -->
<div class="viewer-backdrop" on:click|self={() => dispatch("close")} role="presentation">
  <div class="viewer-window">
    <div class="viewer-topbar">
      <span class="viewer-title">{title}</span>
      <button class="viewer-close" type="button" on:click={() => dispatch("close")} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="viewer-body" bind:this={container}></div>
  </div>
</div>

<style>
  .viewer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px;
    box-sizing: border-box;
  }

  .viewer-window {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    background: #1a1a1d;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
  }

  .viewer-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    height: 44px;
    flex-shrink: 0;
    background: #232326;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .viewer-title {
    font-size: 13px;
    font-weight: 600;
    color: #e8e8e8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .viewer-close {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 6px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.5);
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .viewer-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e8e8e8;
  }

  .viewer-body {
    flex: 1;
    overflow: hidden;
  }

  /* Override OSD's default canvas background */
  :global(.viewer-body .openseadragon-container),
  :global(.viewer-body .openseadragon-canvas) {
    background: #1a1a1d !important;
  }
</style>
