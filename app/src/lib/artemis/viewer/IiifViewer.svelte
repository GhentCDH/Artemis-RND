<!-- IiifViewer.svelte — minimal inset IIIF document overlay with OpenSeadragon -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type OpenSeadragonType from "openseadragon";

  export let imageServiceUrl: string;
  export let title: string = "";
  export let sourceManifestUrl: string = "";
  export let manifestAllmapsUrl: string = "";

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
    {#if sourceManifestUrl || manifestAllmapsUrl}
      <div class="viewer-infobar">
        {#if sourceManifestUrl}
          <span class="viewer-infobar-url" title={sourceManifestUrl}>{sourceManifestUrl}</span>
          <button
            type="button"
            class="viewer-infobar-btn"
            on:click={async () => { try { await navigator.clipboard.writeText(sourceManifestUrl); } catch { /* ignore */ } }}
          >Copy URL</button>
        {/if}
        {#if manifestAllmapsUrl}
          <button
            type="button"
            class="viewer-infobar-btn"
            on:click={() => window.open(manifestAllmapsUrl, "_blank", "noopener,noreferrer")}
          >Allmaps</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .viewer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--viewer-backdrop);
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
    background: var(--viewer-bg);
    border-radius: 10px;
    border: 1px solid var(--panel-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-viewer);
  }

  .viewer-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    height: 44px;
    flex-shrink: 0;
    background: var(--viewer-topbar-bg);
    border-bottom: 0.5px solid var(--panel-border);
  }

  .viewer-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
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
    color: var(--text-muted);
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .viewer-close:hover {
    background: rgba(0, 0, 0, 0.06);
    color: var(--text-primary);
  }

  .viewer-body {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .viewer-infobar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    height: 36px;
    flex-shrink: 0;
    background: var(--viewer-bg);
    border-top: 0.5px solid var(--panel-border);
    overflow: hidden;
  }

  .viewer-infobar-url {
    flex: 1;
    font-size: 11px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .viewer-infobar-btn {
    flex-shrink: 0;
    padding: 4px 9px;
    font-size: 11px;
    border-radius: 4px;
    border: 0.5px solid var(--border-ui);
    background: var(--result-bg);
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .viewer-infobar-btn:hover {
    background: var(--result-hover);
    color: var(--text-primary);
  }

  /* Override OSD's default canvas background */
  :global(.viewer-body .openseadragon-container),
  :global(.viewer-body .openseadragon-canvas) {
    background: var(--viewer-canvas-bg) !important;
  }
</style>
