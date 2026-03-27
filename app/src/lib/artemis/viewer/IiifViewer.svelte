<!-- IiifViewer.svelte — minimal inset IIIF document overlay with OpenSeadragon -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type OpenSeadragonType from "openseadragon";
  import { extractImageServiceFromManifest } from '$lib/artemis/viewer/manifestPreview';

  export let imageServiceUrl: string;
  export let title: string = "";
  export let sourceManifestUrl: string = "";
  export let manifestAllmapsUrl: string = "";

  const dispatch = createEventDispatcher<{ close: void }>();

  let container: HTMLElement;
  let viewer: OpenSeadragonType.Viewer | undefined;
  let loadError = '';
  let loadingService = false;

  onMount(async () => {
    window.addEventListener("keydown", onKeyDown);

    let serviceUrl = imageServiceUrl;

    if (!serviceUrl && sourceManifestUrl) {
      loadingService = true;
      try {
        serviceUrl = await extractImageServiceFromManifest(sourceManifestUrl);
      } catch (e: any) {
        loadError = e?.message ?? 'Failed to resolve image service';
        loadingService = false;
        return;
      }
      loadingService = false;
    }

    if (!serviceUrl) {
      loadError = 'No image available for this item';
      return;
    }

    const OpenSeadragon = (await import("openseadragon")).default;
    viewer = OpenSeadragon({
      element: container,
      tileSources: `${serviceUrl}/info.json`,
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
    <div class="viewer-body" bind:this={container}>
      {#if loadingService}
        <div class="viewer-status">Loading image…</div>
      {:else if loadError}
        <div class="viewer-status viewer-error">{loadError}</div>
      {/if}
    </div>
    {#if sourceManifestUrl || manifestAllmapsUrl}
      <div class="viewer-infobar">
        {#if sourceManifestUrl}
          <span class="viewer-infobar-url" title={sourceManifestUrl}>{sourceManifestUrl}</span>
          <button
            type="button"
            class="viewer-infobar-btn viewer-infobar-btn--primary"
            on:click={async () => { try { await navigator.clipboard.writeText(sourceManifestUrl); } catch { /* ignore */ } }}
          >
            <svg class="viewer-infobar-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="5" y="3.5" width="8" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M6 2.5h3.5a1.5 1.5 0 0 1 1.5 1.5v0.5H6.5A1.5 1.5 0 0 0 5 6v5H4A1.5 1.5 0 0 1 2.5 9.5V4A1.5 1.5 0 0 1 4 2.5H6Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.1"/>
            </svg>
            <span>Manifest URL</span>
          </button>
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
    border-radius: var(--radius-md);
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
    border-radius: var(--radius-xs);
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
    position: relative;
  }

  .viewer-status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--text-muted);
  }

  .viewer-error {
    color: var(--text-error);
  }

  .viewer-infobar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    min-height: 56px;
    flex-shrink: 0;
    background: var(--viewer-bg);
    border-top: 0.5px solid var(--panel-border);
    overflow: hidden;
  }

  .viewer-infobar-url {
    flex: 1;
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .viewer-infobar-btn {
    flex-shrink: 0;
    min-height: 42px;
    padding: 10px 16px;
    font-size: 12px;
    font-weight: 700;
    border-radius: var(--radius-xs);
    border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
    background: color-mix(in srgb, var(--viewer-topbar-bg) 72%, white);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.15s, box-shadow 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .viewer-infobar-btn:hover {
    background: color-mix(in srgb, var(--viewer-topbar-bg) 86%, white);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .viewer-infobar-btn--primary {
    min-width: 136px;
  }

  .viewer-infobar-btn-icon {
    flex: 0 0 auto;
  }

  /* Override OSD's default canvas background */
  :global(.viewer-body .openseadragon-container),
  :global(.viewer-body .openseadragon-canvas) {
    background: var(--viewer-canvas-bg) !important;
  }
</style>
