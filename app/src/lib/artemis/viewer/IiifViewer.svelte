<!-- IiifViewer.svelte — minimal inset IIIF document overlay with OpenSeadragon -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type OpenSeadragonType from "openseadragon";
  import type { IiifMapInfo } from '$lib/artemis/types';
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
  export let historyItems: IiifMapInfo[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    'select-history': IiifMapInfo;
  }>();

  let container: HTMLElement;
  let viewer: OpenSeadragonType.Viewer | undefined;
  let loadError = '';
  let loadingService = false;
  let loadingMetadata = false;
  let metadataError = '';
  let manifestDetails: IiifManifestDetails | null = null;

  onMount(async () => {
    window.addEventListener("keydown", onKeyDown);

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

<div
  class="viewer-root"
  class:viewer-root--inline={inline}
  class:viewer-backdrop={!inline}
  on:click|self={() => !inline && dispatch("close")}
  role="presentation"
>
  <div class="viewer-window" class:viewer-window--inline={inline}>
    {#if !inline}
      <div class="viewer-topbar">
        <span class="viewer-title">{title}</span>
        <button class="viewer-close" type="button" on:click={() => dispatch("close")} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    {/if}
    <div class="viewer-main" class:viewer-main--mirrored={inline && mirrored}>
      <div class="viewer-body" bind:this={container}>
        {#if loadingService}
          <div class="viewer-status">Loading image…</div>
        {:else if loadError}
          <div class="viewer-status viewer-error">{loadError}</div>
        {/if}
      </div>
      <aside class="viewer-meta">
        {#if inline}
          <div class="viewer-meta-topbar">
            <button class="viewer-close viewer-close--meta" type="button" on:click={() => dispatch("close")} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        {/if}
        {#if inline && historyItems.length > 1}
          <div class="viewer-history viewer-history--sidebar">
            <div class="viewer-history-label">Recent manifests</div>
            <div class="viewer-history-list">
              {#each historyItems as item}
                <button
                  type="button"
                  class="viewer-history-chip"
                  class:is-active={item.sourceManifestUrl === sourceManifestUrl && (item.imageServiceUrl ?? '') === (imageServiceUrl ?? '')}
                  on:click={() => dispatch('select-history', item)}
                >{item.title}</button>
              {/each}
            </div>
          </div>
        {/if}
        <div class="viewer-meta-scroll">
          <div class="viewer-meta-block">
            <div class="viewer-meta-label">Manifest</div>
            <div class="viewer-meta-heading">{manifestDetails?.title || title || 'Untitled document'}</div>
            {#if manifestDetails?.summary}
              <p class="viewer-meta-summary">{manifestDetails.summary}</p>
            {/if}
          </div>

          {#if loadingMetadata}
            <div class="viewer-meta-status">Loading metadata…</div>
          {:else if metadataError}
            <div class="viewer-meta-status viewer-meta-status-error">{metadataError}</div>
          {:else if manifestDetails}
            {#if sourceManifestUrl || manifestAllmapsUrl}
              <div class="viewer-meta-actions">
                {#if sourceManifestUrl}
                  <button
                    type="button"
                    class="viewer-infobar-btn viewer-infobar-btn--primary"
                    on:click={async () => { try { await navigator.clipboard.writeText(sourceManifestUrl); } catch { /* ignore */ } }}
                  >
                    <svg class="viewer-infobar-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="5" y="3.5" width="8" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
                      <path d="M6 2.5h3.5a1.5 1.5 0 0 1 1.5 1.5v0.5H6.5A1.5 1.5 0 0 0 5 6v5H4A1.5 1.5 0 0 1 2.5 9.5V4A1.5 1.5 0 0 1 4 2.5H6Z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.1"/>
                    </svg>
                    <span>Copy manifest URL</span>
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
            {#if manifestDetails.provider || manifestDetails.rights || manifestDetails.homepageUrl}
              <div class="viewer-meta-block">
                {#if manifestDetails.provider}
                  <div class="viewer-meta-row">
                    <span class="viewer-meta-key">Provider</span>
                    <span class="viewer-meta-value">{manifestDetails.provider}</span>
                  </div>
                {/if}
                {#if manifestDetails.rights}
                  <div class="viewer-meta-row">
                    <span class="viewer-meta-key">Rights</span>
                    <span class="viewer-meta-value">{manifestDetails.rights}</span>
                  </div>
                {/if}
                {#if manifestDetails.homepageUrl}
                  <div class="viewer-meta-row">
                    <span class="viewer-meta-key">Homepage</span>
                    <a class="viewer-meta-link" href={manifestDetails.homepageUrl} target="_blank" rel="noopener noreferrer">
                      Open source page
                    </a>
                  </div>
                {/if}
              </div>
            {/if}

            {#if manifestDetails.requiredStatement}
              <div class="viewer-meta-block">
                <div class="viewer-meta-label">{manifestDetails.requiredStatement.label}</div>
                <div class="viewer-meta-copy">{manifestDetails.requiredStatement.value}</div>
              </div>
            {/if}

            {#if manifestDetails.metadata.length > 0}
              <div class="viewer-meta-block">
                <div class="viewer-meta-label">Metadata</div>
                <dl class="viewer-meta-list">
                  {#each manifestDetails.metadata as field}
                    <div class="viewer-meta-entry">
                      <dt>{field.label}</dt>
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
    background: var(--viewer-bg);
    border-radius: var(--radius-md);
    border: 1px solid var(--panel-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-viewer);
  }

  .viewer-window--inline {
    border-radius: 0;
    border: none;
    box-shadow: var(--viewer-inline-shadow);
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

  .viewer-window--inline .viewer-close {
    padding: 8px;
    color: var(--text-primary);
  }

  .viewer-window--inline .viewer-close svg {
    width: 18px;
    height: 18px;
  }

  .viewer-close:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
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
    grid-template-columns: minmax(0, 1fr) 320px;
  }

  .viewer-main--mirrored {
    grid-template-columns: 320px minmax(0, 1fr);
  }

  .viewer-meta {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 18px 18px 20px;
    background: var(--viewer-meta-bg);
    display: flex;
    flex-direction: column;
    gap: 16px;
    z-index: 2;
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
    gap: 16px;
    padding-right: 2px;
  }

  .viewer-meta-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .viewer-meta-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .viewer-meta-heading {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
    color: var(--text-primary);
  }

  .viewer-meta-summary,
  .viewer-meta-copy,
  .viewer-meta-value,
  .viewer-meta-entry dd {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .viewer-meta-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .viewer-meta-key,
  .viewer-meta-entry dt {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .viewer-meta-link {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .viewer-meta-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .viewer-meta-entry {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .viewer-meta-status {
    font-size: 12px;
    color: var(--text-muted);
  }

  .viewer-meta-status-error {
    color: var(--text-error);
  }

  .viewer-history {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .viewer-history--sidebar {
    flex: 0 0 auto;
    padding-top: 8px;
  }

  .viewer-close--meta {
    padding: 8px;
    color: var(--text-primary);
  }

  .viewer-meta-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .viewer-history-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .viewer-history-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .viewer-history-chip {
    max-width: 100%;
    padding: 7px 11px;
    border-radius: 999px;
    border: 1px solid var(--viewer-chip-border);
    background: var(--viewer-chip-bg);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .viewer-history-chip:hover,
  .viewer-history-chip.is-active {
    background: var(--viewer-chip-bg-hover);
    color: var(--text-primary);
    border-color: var(--viewer-chip-border-hover);
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

  .viewer-infobar-btn {
    flex-shrink: 0;
    min-height: 38px;
    padding: 9px 14px;
    font-size: 12px;
    font-weight: 700;
    border-radius: var(--radius-xs);
    border: none;
    background: var(--viewer-action-bg);
    color: var(--text-primary);
    box-shadow: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .viewer-infobar-btn:hover {
    background: var(--viewer-action-bg-hover);
    transform: translateY(-1px);
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

  @media (max-width: 900px) {
    .viewer-main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .viewer-meta {
      max-height: 34vh;
      border-left: none;
      border-top: 0.5px solid var(--panel-border);
    }
  }
</style>
