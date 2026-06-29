<!-- IiifViewer.svelte — minimal inset IIIF document overlay with OpenSeadragon -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type OpenSeadragonType from "openseadragon";
  import type { SpriteRef } from '$lib/artemis/shared/types';
  import {
    loadManifestDetails,
    type IiifManifestDetails,
  } from '$lib/artemis/viewer/manifestPreview';

  export let imageServiceUrl: string;
  export let title: string = "";
  export let sourceManifestUrl: string = "";
  export let manifestAllmapsUrl: string = "";
  export let inline = false;
  export let mirrored = false;
  export let spriteRef: SpriteRef | undefined = undefined;
  export let placeholderWidth = 0;
  export let placeholderHeight = 0;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let container: HTMLElement;
  let viewer: OpenSeadragonType.Viewer | undefined;
  let loadError = '';
  let loadingService = false;
  let loadingMetadata = false;
  let metadataError = '';
  let manifestDetails: IiifManifestDetails | null = null;
  let metadataCollapsed = inline;
  let osdReady = false;
  let spriteDismissed = false;
  let spriteStyle = '';
  let OSD: typeof OpenSeadragonType | null = null;
  let _onTileLoaded: ((e: any) => void) | null = null;
  let _tileImageRef: OpenSeadragonType.TiledImage | null = null;
  let _resizeObserver: ResizeObserver | null = null;
  let containerWidth = 0;
  let containerHeight = 0;
  let isFullscreen = false;
  let viewerRoot: HTMLElement | undefined;

  function buildSpriteStyle(ref: SpriteRef): string {
    const maxWidth = Math.max(containerWidth, 320);
    const maxHeight = Math.max(containerHeight, 320);
    const sourceWidth = manifestDetails?.canvasWidth || placeholderWidth || ref.width;
    const sourceHeight = manifestDetails?.canvasHeight || placeholderHeight || ref.height;
    const fitScale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
    const dw = Math.max(1, Math.round(sourceWidth * fitScale));
    const dh = Math.max(1, Math.round(sourceHeight * fitScale));
    const scaleX = dw / ref.width;
    const scaleY = dh / ref.height;
    return [
      `width:${dw}px`,
      `height:${dh}px`,
      `background-image:url(${encodeURI(ref.sheetUrl)})`,
      `background-size:${Math.round(ref.sheetWidth * scaleX)}px ${Math.round(ref.sheetHeight * scaleY)}px`,
      `background-position:-${Math.round(ref.x * scaleX)}px -${Math.round(ref.y * scaleY)}px`,
    ].join(';');
  }

  function updateSpriteStyle() {
    spriteStyle = spriteRef ? buildSpriteStyle(spriteRef) : '';
  }

  function updateContainerSize() {
    containerWidth = Math.max(container?.clientWidth ?? 0, 0);
    containerHeight = Math.max(container?.clientHeight ?? 0, 0);
    updateSpriteStyle();
  }

  $: manifestDetails, placeholderWidth, placeholderHeight, spriteRef, updateSpriteStyle();

  onMount(async () => {
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    updateContainerSize();
    if (typeof ResizeObserver !== 'undefined') {
      _resizeObserver = new ResizeObserver(() => updateContainerSize());
      if (container) _resizeObserver.observe(container);
    }

    let serviceUrl = imageServiceUrl;

    if (!serviceUrl && sourceManifestUrl) {
      loadingService = true;
      try {
        const details = await loadManifestDetails(sourceManifestUrl);
        manifestDetails = details;
        serviceUrl = details.imageServiceUrl;
      } catch (e: any) {
        loadError = e?.message ?? 'Failed to resolve image service';
        loadingService = false;
        return;
      }
      loadingService = false;
    } else if (sourceManifestUrl) {
      loadingMetadata = true;
      try {
        manifestDetails = await loadManifestDetails(sourceManifestUrl);
      } catch (e: any) {
        metadataError = e?.message ?? 'Manifest metadata unavailable';
      } finally {
        loadingMetadata = false;
      }
    }

    if (!manifestDetails && sourceManifestUrl && !loadingMetadata) {
      loadingMetadata = true;
      try {
        manifestDetails = await loadManifestDetails(sourceManifestUrl);
      } catch (e: any) {
        metadataError = e?.message ?? 'Manifest metadata unavailable';
      } finally {
        loadingMetadata = false;
      }
    }

    if (!serviceUrl) {
      loadError = 'No image available for this item';
      return;
    }

    const OpenSeadragon = (await import("openseadragon")).default;
    OSD = OpenSeadragon;
    viewer = OpenSeadragon({
      element: container,
      tileSources: `${serviceUrl}/info.json`,
      drawer: 'canvas',
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
      crossOriginPolicy: 'Anonymous',
    } as OpenSeadragonType.Options);

    viewer.addOnceHandler('open', () => {
      // tile-drawn is not raised by the WebGL drawer; use fully-loaded-change instead.
      const item = viewer!.world.getItemAt(0);
      if (item) {
        _tileImageRef = item;
        _onTileLoaded = (e: any) => {
          if (e.fullyLoaded) {
            _tileImageRef?.removeHandler('fully-loaded-change', _onTileLoaded!);
            _onTileLoaded = null;
            setTimeout(() => { osdReady = true; }, 0);
          }
        };
        item.addHandler('fully-loaded-change', _onTileLoaded);
        if ((item as any).fullyLoaded) {
          item.removeHandler('fully-loaded-change', _onTileLoaded);
          _onTileLoaded = null;
          setTimeout(() => { osdReady = true; }, 0);
        }
      }
    });
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    _resizeObserver?.disconnect();
    if (_tileImageRef && _onTileLoaded) {
      _tileImageRef.removeHandler('fully-loaded-change', _onTileLoaded);
    }
    viewer?.destroy();
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !isFullscreen) dispatch("close");
  }

  async function toggleFullscreen() {
    if (!viewerRoot) return;

    try {
      if (!isFullscreen) {
        if (viewerRoot.requestFullscreen) {
          await viewerRoot.requestFullscreen();
        } else if ((viewerRoot as any).webkitRequestFullscreen) {
          await (viewerRoot as any).webkitRequestFullscreen();
        }
      } else {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if ((document as any).webkitFullscreenElement) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (err: any) {
      console.error('Fullscreen error:', err);
    }
  }

  function handleFullscreenChange() {
    isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
  }

  function resolveDisplayYear(): string {
    const candidates: string[] = [];

    if (manifestDetails) {
      for (const field of manifestDetails.metadata) {
        candidates.push(field.value);
      }
    }

    candidates.push(manifestDetails?.title ?? '', title);

    for (const candidate of candidates) {
      const match = candidate.match(/\b(1[6-9]\d{2}|20\d{2})\b/);
      if (match) return match[1];
    }

    return '';
  }
</script>

<div
  class="viewer-root"
  class:viewer-root--inline={inline}
  class:viewer-backdrop={!inline}
  class:viewer-root--fullscreen={isFullscreen}
  on:click|self={() => !inline && dispatch("close")}
  role="presentation"
  bind:this={viewerRoot}
>
  <div class="viewer-window" class:viewer-window--inline={inline}>
    {#if !inline}
      <div class="viewer-topbar">
        <span class="viewer-title">{title}</span>
        <div class="viewer-topbar-actions">
          <button class="ui-icon-btn viewer-close" type="button" on:click={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            {#if isFullscreen}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 5.5h3M2 2h4v4M14 10.5h-3M14 14h-4v-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 6V2h4M14 6v4h-4M2 10v4h4M14 10v-4h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {/if}
          </button>
          <button class="ui-icon-btn viewer-close" type="button" on:click={() => dispatch("close")} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    {/if}
    {#if inline}
      <div class="viewer-inline-header" class:viewer-inline-header--mirrored={mirrored}>
        <button class="viewer-fullscreen-btn" type="button" on:click={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          {#if isFullscreen}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 5.5h3M2 2h4v4M14 10.5h-3M14 14h-4v-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 6V2h4M14 6v4h-4M2 10v4h4M14 10v-4h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          {/if}
          <span>Fullscreen</span>
        </button>
        <div class="viewer-inline-header-copy">
          <div class="viewer-inline-title">{manifestDetails?.title || title || 'Untitled document'}</div>
          {#if resolveDisplayYear()}
            <div class="viewer-inline-year">{resolveDisplayYear()}</div>
          {/if}
        </div>
        <div class="viewer-inline-actions">
          <button
            class="ui-btn-primary"
            type="button"
            on:click={() => (metadataCollapsed = !metadataCollapsed)}
            aria-expanded={!metadataCollapsed}
            aria-label={metadataCollapsed ? 'Show metadata' : 'Hide metadata'}
          >{metadataCollapsed ? 'Metadata' : 'Hide metadata'}</button>
          <button class="ui-icon-btn viewer-close viewer-close--meta" type="button" on:click={() => dispatch("close")} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    {/if}
    <div
      class="viewer-main"
      class:viewer-main--mirrored={inline && mirrored}
      class:viewer-main--meta-collapsed={inline && metadataCollapsed}
    >
      <div class="viewer-body" class:viewer-body--mask-osd={!!spriteRef && !osdReady} bind:this={container}>
        {#if loadError}
          <div class="viewer-status viewer-error">{loadError}</div>
        {:else if !osdReady && !spriteRef && loadingService}
          <div class="viewer-status">Loading image…</div>
        {/if}
        {#if spriteRef && !spriteDismissed}
          <div
            class="viewer-sprite-placeholder"
            class:viewer-sprite-placeholder--fade={osdReady}
            on:transitionend={() => { spriteDismissed = true; }}
          >
            <div class="viewer-sprite-pre-open">
              <div
                class="viewer-sprite"
                style={spriteStyle}
              ></div>
            </div>
          </div>
        {/if}
      </div>
      <aside class="viewer-meta" class:viewer-meta--collapsed={inline && metadataCollapsed}>
        {#if inline && !metadataCollapsed}
          <div class="viewer-meta-topbar">
            <button
              class="ui-btn-primary"
              type="button"
              on:click={() => (metadataCollapsed = true)}
              aria-label="Hide metadata"
            >Hide metadata</button>
          </div>
        {/if}
        <div class="viewer-meta-scroll">
          <div class="viewer-meta-block">
            <div class="ui-label">Manifest</div>
            <div class="viewer-meta-heading">{manifestDetails?.title || title || 'Untitled document'}</div>
            {#if resolveDisplayYear()}
              <div class="viewer-meta-year">{resolveDisplayYear()}</div>
            {/if}
            {#if manifestDetails?.summary}
              <p class="viewer-meta-summary">{manifestDetails.summary}</p>
            {/if}
          </div>

          {#if loadingMetadata}
            <div class="ui-meta viewer-meta-status">Loading metadata…</div>
          {:else if metadataError}
            <div class="viewer-meta-status viewer-meta-status-error">{metadataError}</div>
          {:else if manifestDetails}
            {#if sourceManifestUrl || manifestAllmapsUrl}
              <div class="viewer-meta-actions">
                {#if sourceManifestUrl}
                  <button
                    type="button"
                    class="ui-btn-primary"
                    on:click={async () => { try { await navigator.clipboard.writeText(sourceManifestUrl); } catch { /* ignore */ } }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="flex-shrink: 0;">
                      <rect x="5" y="3.5" width="8" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
                      <path d="M6 2.5h3.5a1.5 1.5 0 0 1 1.5 1.5v0.5H6.5A1.5 1.5 0 0 0 5 6v5H4A1.5 1.5 0 0 1 2.5 9.5V4A1.5 1.5 0 0 1 4 2.5H6Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.1"/>
                    </svg>
                    <span>Copy manifest URL</span>
                  </button>
                {/if}
                {#if manifestAllmapsUrl}
                  <button
                    type="button"
                    class="ui-btn"
                    on:click={() => window.open(manifestAllmapsUrl, "_blank", "noopener,noreferrer")}
                  >Allmaps</button>
                {/if}
              </div>
            {/if}
            {#if manifestDetails.provider || manifestDetails.rights || manifestDetails.homepageUrl}
              <div class="viewer-meta-block">
                {#if manifestDetails.provider}
                  <div class="viewer-meta-row">
                    <span class="ui-label">Provider</span>
                    <span class="viewer-meta-value">{manifestDetails.provider}</span>
                  </div>
                {/if}
                {#if manifestDetails.rights}
                  <div class="viewer-meta-row">
                    <span class="ui-label">Rights</span>
                    <span class="viewer-meta-value">{manifestDetails.rights}</span>
                  </div>
                {/if}
                {#if manifestDetails.homepageUrl}
                  <div class="viewer-meta-row">
                    <span class="ui-label">Homepage</span>
                    <a class="viewer-meta-link" href={manifestDetails.homepageUrl} target="_blank" rel="noopener noreferrer">
                      Open source page
                    </a>
                  </div>
                {/if}
              </div>
            {/if}

            {#if manifestDetails.requiredStatement}
              <div class="viewer-meta-block">
                <div class="ui-label">{manifestDetails.requiredStatement.label}</div>
                <div class="viewer-meta-copy">{manifestDetails.requiredStatement.value}</div>
              </div>
            {/if}

            {#if manifestDetails.metadata.length > 0}
              <div class="viewer-meta-block">
                <div class="ui-label">Metadata</div>
                <dl class="viewer-meta-list">
                  {#each manifestDetails.metadata as field}
                    <div class="viewer-meta-entry">
                      <dt class="ui-label">{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  {/each}
                </dl>
              </div>
            {/if}
          {/if}
        </div>
      </aside>
    </div>
  </div>
</div>

<style>
  .viewer-root {
    width: 100%;
    height: 100%;
  }

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

  .viewer-root--inline {
    position: absolute;
    inset: 0;
    z-index: 2;
  }

  .viewer-window {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    background: var(--window-background);
    border-radius: var(--radius-md);
    border: 1px solid var(--window-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--window-shadow);
  }

  .viewer-window--inline {
    border-radius: 0;
    border: none;
    box-shadow: var(--viewer-inline-shadow);
  }

  .viewer-inline-header {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    background: color-mix(in srgb, var(--window-header-background) 92%, transparent);
    border: 1px solid var(--window-border);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(8px);
  }

  .viewer-fullscreen-btn {
    flex-shrink: 0;
    order: -2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px solid var(--window-border);
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 400;
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease;
  }

  .viewer-fullscreen-btn:hover {
    background: var(--button-background-hover);
  }

  .viewer-fullscreen-btn svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .viewer-inline-header-copy {
    min-width: 0;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 160px);
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    text-align: center;
    justify-content: center;
  }

  .viewer-inline-header--mirrored .viewer-inline-header-copy {
    align-items: flex-start;
    text-align: left;
  }

  .viewer-inline-actions {
    flex-shrink: 0;
    order: 0;
  }

  .viewer-inline-title {
    font-size: 12px;
    font-weight: 400;
    line-height: 1.1;
    color: var(--text-primary);
  }

  .viewer-inline-year,
  .viewer-meta-year {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .viewer-inline-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .viewer-inline-actions :global(.ui-btn-primary) {
    min-height: 26px;
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 400;
  }

  .viewer-inline-header--mirrored .viewer-inline-actions {
    order: -1;
  }

  .viewer-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    height: 44px;
    flex-shrink: 0;
    background: var(--window-header-background);
  }

  .viewer-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Override ui-icon-btn: viewer-specific padding and transition */
  .viewer-close {
    flex-shrink: 0;
    padding: 6px;
    transition: background 0.15s, color 0.15s;
  }

  .viewer-window--inline .viewer-close {
    padding: 4px;
    color: var(--text-primary);
  }

  .viewer-window--inline .viewer-close svg {
    width: 14px;
    height: 14px;
  }

  .viewer-body {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
    background: var(--viewer-body-bg);
    box-shadow: var(--viewer-side-shadow);
    z-index: 1;
  }

  .viewer-main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
  }

  .viewer-main--meta-collapsed {
    grid-template-columns: minmax(0, 1fr) 0;
  }

  .viewer-main--mirrored {
    grid-template-columns: 260px minmax(0, 1fr);
  }

  .viewer-main--mirrored.viewer-main--meta-collapsed {
    grid-template-columns: 0 minmax(0, 1fr);
  }

  .viewer-meta {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 12px 12px 14px;
    background: var(--viewer-meta-bg);
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 2;
  }

  .viewer-meta--collapsed {
    width: 0;
    padding: 0;
    gap: 0;
    border: none;
  }

  .viewer-main--mirrored .viewer-meta {
    order: 1;
  }

  .viewer-main--mirrored .viewer-body {
    order: 2;
    box-shadow: var(--viewer-side-shadow-mirrored);
  }

  .viewer-meta-topbar {
    display: flex;
    justify-content: flex-end;
    flex: 0 0 auto;
  }

  .viewer-meta-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-right: 2px;
  }

  .viewer-meta-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .viewer-meta-heading {
    font-size: 12px;
    font-weight: 400;
    line-height: 1.3;
    color: var(--text-primary);
  }

  .viewer-meta :global(.ui-label) {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: color-mix(in srgb, var(--text-primary) 62%, transparent);
  }

  .viewer-meta-summary,
  .viewer-meta-copy,
  .viewer-meta-value,
  .viewer-meta-entry dd {
    margin: 0;
    font-family: var(--font-readable);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.35;
    color: var(--text-readable);
    overflow-wrap: anywhere;
  }

  .viewer-meta-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .viewer-meta-link {
    font-family: var(--font-readable);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.35;
    color: var(--button-primary-background);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .viewer-meta-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .viewer-meta-entry {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-bottom: 9px;
    border-bottom: 1px solid color-mix(in srgb, var(--window-border) 54%, transparent);
  }

  .viewer-meta-entry:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .viewer-meta-status-error {
    color: var(--text-error);
  }

  .viewer-close--meta {
    padding: 4px;
    color: var(--text-primary);
  }

  .viewer-meta-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .viewer-meta-actions :global(.ui-btn-primary),
  .viewer-meta-actions :global(.ui-btn) {
    min-height: 28px;
    padding: 6px 9px;
    font-size: 11px;
    font-weight: 400;
    gap: 6px;
  }

  .viewer-sprite-placeholder {
    position: absolute;
    inset: 0;
    z-index: 2;
    opacity: 1;
    transition: opacity 600ms ease;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .viewer-sprite-placeholder--fade {
    opacity: 0;
  }

  .viewer-body--mask-osd :global(.openseadragon-container) {
    opacity: 0;
  }

  .viewer-sprite-pre-open {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .viewer-sprite {
    flex-shrink: 0;
    background-repeat: no-repeat;
  }

  .viewer-body :global(.openseadragon-container) {
    transition: opacity 220ms ease;
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

  /* Override OSD's default canvas background */
  :global(.viewer-body .openseadragon-container),
  :global(.viewer-body .openseadragon-canvas) {
    background: var(--window-background) !important;
  }

  .viewer-root--fullscreen {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }

  .viewer-root--fullscreen .viewer-window {
    border-radius: 0;
    border: none;
    box-shadow: none;
  }

  .viewer-topbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .viewer-topbar-actions .viewer-close:last-child {
    margin-left: auto;
  }

  @media (max-width: 900px) {
    .viewer-inline-header {
      top: 10px;
      left: 10px;
      right: 10px;
      padding: 10px 12px;
    }

    .viewer-main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .viewer-main--meta-collapsed {
      grid-template-rows: minmax(0, 1fr) 0;
    }

    .viewer-meta {
      max-height: 34vh;
      border-left: none;
      border-top: 0.5px solid var(--window-border);
    }

    .viewer-meta--collapsed {
      max-height: 0;
    }
  }
</style>
