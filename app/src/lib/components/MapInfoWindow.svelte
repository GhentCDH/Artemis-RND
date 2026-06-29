<script lang="ts">
  import { fade } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';
  import Button from '$lib/artemis/ui/primitives/Button.svelte';
  import Window from '$lib/artemis/ui/primitives/Window.svelte';
  import type { SubLayerKind } from '$lib/artemis/config/layers';

  export let isOpen = false;
  export let collectionKey: string | null = null;
  export let collectionName: string = '';
  export let collectionColor: string = '';
  export let collectionDate: string = '';
  export let collectionInfo: string = '';
  export let sublayers: Array<{ id: string; subId: string; label: string; kind?: SubLayerKind; url?: string }> = [];
  export let pane: 'left' | 'right' = 'left';

  const dispatch = createEventDispatcher<{
    close: void;
    'sublayer-toggle': { sublayerId: string; enabled: boolean };
  }>();

  let sublayerState: Record<string, Record<string, boolean>> = {};
  let copiedSubId: string | null = null;
  let previousCollectionKey: string | null = null;
  let openInfoSubId: string | null = null;
  $: currentSublayerState = collectionKey
    ? (sublayerState[collectionKey] ?? defaultSublayerState())
    : {};

  $: if (collectionKey !== previousCollectionKey) {
    previousCollectionKey = collectionKey;
    openInfoSubId = null;
    if (collectionKey) {
      resetSublayersToDefaults(collectionKey);
    }
  }

  function defaultSublayerState() {
    return Object.fromEntries(
      sublayers.map((sub) => [sub.id, sub.id === 'iiif' || sub.id === 'wmts'])
    );
  }

  function resetSublayersToDefaults(key: string) {
    sublayerState = {
      ...sublayerState,
      [key]: defaultSublayerState(),
    };
  }

  function toggleSublayer(localId: string) {
    if (!collectionKey) return;
    const collectionState = sublayerState[collectionKey] ?? defaultSublayerState();
    const newState = !collectionState[localId];
    sublayerState = {
      ...sublayerState,
      [collectionKey]: {
        ...collectionState,
        [localId]: newState,
      },
    };
    const sub = sublayers.find(s => s.id === localId);
    if (sub) {
      dispatch('sublayer-toggle', { sublayerId: sub.subId, enabled: newState });
    }
  }

  function copyUrl(subId: string) {
    const sub = sublayers.find(s => s.id === subId);
    if (!sub?.url) return;
    navigator.clipboard.writeText(sub.url).then(() => {
      copiedSubId = subId;
      setTimeout(() => {
        copiedSubId = null;
      }, 1200);
    });
  }

  function close() {
    dispatch('close');
  }

  function sourceTypeLabel(kind?: SubLayerKind) {
    if (!kind) return 'Link';
    if (kind === 'geojson') return 'GEOJSON';
    return kind.toUpperCase();
  }

  function toggleInfo(subId: string) {
    openInfoSubId = openInfoSubId === subId ? null : subId;
  }

</script>

<div class="map-info-window-container" class:is-open={isOpen && collectionKey}>
    <Window
      class={`map-info-window ${pane === 'right' ? 'is-right' : ''}`}
      variant="floating"
      placement={pane}
      showClose={true}
      closeLabel={`Close ${collectionName} info`}
      on:close={close}
    >
      <div slot="header" class="header-left">
        <div class="collection-dot" style={`--c:${collectionColor}`}></div>
        <div class="header-text">
          <span class="collection-name">{collectionName}</span>
          <span class="collection-date">{collectionDate}</span>
        </div>
      </div>

      <!-- Sublayer rows -->
      <div class="sublayers-list">
        <svg class="sublayer-wave" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M 0 14 C 18 14, 18 6, 36 6 S 54 14, 72 14 S 90 6, 108 6"></path>
        </svg>
        {#each sublayers as sub}
          <div class="sublayer-row-wrap">
            <div class="sublayer-row">
              <div class="sublayer-actions">
                <span class="sublayer-label">{sub.label}</span>
                <button
                  class="sublayer-switch"
                  class:is-on={currentSublayerState[sub.id] ?? false}
                  type="button"
                  role="switch"
                  aria-checked={currentSublayerState[sub.id] ? 'true' : 'false'}
                  aria-label={`Turn ${sub.label} layer ${currentSublayerState[sub.id] ? 'off' : 'on'}`}
                  on:click={() => toggleSublayer(sub.id)}
                >
                  <span class="sublayer-switch-track" aria-hidden="true">
                    <span class="sublayer-switch-thumb"></span>
                  </span>
                </button>
                <Button
                  class="sublayer-copy"
                  variant="chrome"
                  active={copiedSubId === sub.id}
                  title="Copy layer source"
                  aria-label={`Copy ${sub.label} source`}
                  on:click={() => copyUrl(sub.id)}
                >
                  {#if copiedSubId === sub.id}
                    Copied
                  {:else}
                    <svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <rect x="5" y="5" width="8" height="8" rx="1.2"></rect>
                      <path d="M3 10.5V3.8C3 3.4 3.4 3 3.8 3h6.7"></path>
                    </svg>
                    {sourceTypeLabel(sub.kind)}
                  {/if}
                </Button>
              </div>
              <Button
                class="info-dropdown-toggle"
                variant="chrome"
                iconOnly={true}
                active={openInfoSubId === sub.id}
                aria-label={`Toggle ${sub.label} info`}
                on:click={() => toggleInfo(sub.id)}
              >
                <svg class="info-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="8" cy="8" r="6.25"></circle>
                  <path d="M8 7.1v4.1"></path>
                  <path d="M8 4.8h.01"></path>
                </svg>
              </Button>
            </div>
          </div>
        {/each}
      </div>
    </Window>
  </div>

<style>
  .map-info-window-container {
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
  }

  .map-info-window-container.is-open {
    opacity: 1;
    pointer-events: auto;
  }

  :global(.map-info-window) {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 52;
    min-width: 220px;
    max-width: 290px;
    overflow: visible;
  }

  :global(.map-info-window.is-right) {
    left: 50%;
    transform: translateX(16px);
  }

  @media (max-width: 900px) {
    :global(.map-info-window.is-right) {
      left: 16px;
      top: 16px;
    }
  }

  :global(.map-info-window .artemis-window-header) {
    padding: 12px 14px 2px;
    border-bottom: 0;
    background: transparent;
  }

  :global(.map-info-window .artemis-window-actions) {
    align-self: flex-start;
  }

  :global(.map-info-window .artemis-window-actions .artemis-button) {
    width: 20px;
    height: 20px;
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 18px;
    font-weight: 400;
    box-shadow: none;
  }

  :global(.map-info-window .artemis-window-actions .artemis-button:hover:not(:disabled)) {
    background: transparent;
    color: var(--text-primary);
  }

  .header-left {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }

  .collection-dot {
    flex: 0 0 10px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
    margin-top: calc((15px * 1.2 - 10px) / 2);
  }

  .header-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .collection-name {
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .collection-date {
    font-family: var(--font-ui);
    font-size: 12px;
    color: color-mix(in srgb, var(--button-primary-background) 82%, var(--text-primary));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.map-info-window .artemis-window-body) {
    padding: 4px 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  :global(.map-info-window .info-dropdown-toggle) {
    width: 22px;
    height: 22px;
    padding: 0;
    min-height: 0;
    border: 0;
    background: transparent;
    color: color-mix(in srgb, var(--text-muted) 52%, transparent);
    box-shadow: none;
  }

  :global(.map-info-window .info-dropdown-toggle:hover:not(:disabled)) {
    background: transparent;
    color: var(--text-muted);
    border: 0;
    box-shadow: none;
  }

  :global(.map-info-window .info-dropdown-toggle.is-active) {
    background: transparent;
    border: 0;
    color: var(--text-muted);
    box-shadow: none;
  }

  .info-icon {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.45;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .info-dropdown-content {
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.02);
    border-radius: var(--radius-xs);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  .sublayers-list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    isolation: isolate;
  }

  .sublayer-wave {
    position: absolute;
    left: -38px;
    right: -38px;
    bottom: 10px;
    width: calc(100% + 76px);
    height: 28px;
    z-index: 0;
    overflow: visible;
    pointer-events: none;
  }

  .sublayer-wave path {
    fill: none;
    stroke: color-mix(in srgb, var(--button-primary-background) 18%, transparent);
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .sublayer-row {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    min-height: 30px;
  }

  .sublayer-row-wrap {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sublayer-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    position: relative;
    z-index: 2;
  }

  .sublayer-label {
    flex: 0 0 70px;
    width: 70px;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sublayer-switch {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
  }

  .sublayer-switch:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--button-primary-background) 65%, transparent);
    outline-offset: 3px;
    border-radius: 999px;
  }

  .sublayer-switch-track {
    position: relative;
    width: 34px;
    height: 18px;
    border-radius: 999px;
    background: var(--button-inactive-tint-background);
    border: 1px solid var(--button-inactive-tint-border);
    transition:
      background 150ms ease,
      border-color 150ms ease;
  }

  .sublayer-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-muted);
    transition:
      transform 150ms ease,
      background 150ms ease;
  }

  .sublayer-switch.is-on .sublayer-switch-track {
    border-color: var(--button-primary-background);
    background: color-mix(in srgb, var(--button-primary-background) 24%, transparent);
  }

  .sublayer-switch.is-on .sublayer-switch-thumb {
    transform: translateX(16px);
    background: var(--button-primary-background);
  }

  .sublayer-switch:hover .sublayer-switch-track {
    border-color: var(--control-border-hover);
  }

  :global(.map-info-window .sublayer-copy) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 2px 0;
    border: 0;
    background: transparent;
    color: color-mix(in srgb, var(--button-primary-background) 90%, #1f5f8b);
    box-shadow: none;
    font-size: 12px;
    font-weight: 500;
    gap: 6px;
  }

  :global(.map-info-window .sublayer-copy:hover:not(:disabled)),
  :global(.map-info-window .sublayer-copy.is-active) {
    border: 0;
    background: transparent;
    color: var(--button-primary-background-hover);
    box-shadow: none;
  }

  .copy-icon {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
