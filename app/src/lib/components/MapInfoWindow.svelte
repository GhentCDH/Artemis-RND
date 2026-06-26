<script lang="ts">
  import { fade } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';

  export let isOpen = false;
  export let collectionKey: string | null = null;
  export let collectionName: string = '';
  export let collectionColor: string = '';
  export let collectionDate: string = '';
  export let sublayers: Array<{ id: string; subId: string; label: string; url?: string }> = [];
  export let pane: 'left' | 'right' = 'left';

  const dispatch = createEventDispatcher<{
    close: void;
    'sublayer-toggle': { sublayerId: string; enabled: boolean };
  }>();

  let sublayerState: Record<string, Record<string, boolean>> = {};
  let copiedSubId: string | null = null;
  let previousCollectionKey: string | null = null;
  $: currentSublayerState = collectionKey
    ? (sublayerState[collectionKey] ?? defaultSublayerState())
    : {};

  $: if (collectionKey !== previousCollectionKey) {
    previousCollectionKey = collectionKey;
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

</script>

{#if isOpen && collectionKey}
  <div class="map-info-window" class:is-right={pane === 'right'} transition:fade={{ duration: 180 }}>
    <!-- Header row -->
    <div class="window-header">
      <div class="header-left">
        <div class="collection-dot" style={`--c:${collectionColor}`}></div>
        <span class="collection-name">{collectionName}</span>
      </div>
      <button
        class="close-button"
        type="button"
        aria-label={`Close ${collectionName} info`}
        on:click={close}
      >×</button>
    </div>

    <!-- Period row -->
    <div class="period-row">{collectionDate}</div>

    <!-- Layers label -->
    <div class="layers-label">LAYERS</div>

    <!-- Sublayer rows -->
    <div class="sublayers-list">
      {#each sublayers as sub}
        <div class="sublayer-row">
          <span class="sublayer-name">{sub.label}</span>
          <div class="sublayer-controls">
            <button
              class="toggle-switch"
              class:is-enabled={currentSublayerState[sub.id] ?? false}
              type="button"
              aria-label={`Toggle ${sub.label} layer`}
              on:click={() => toggleSublayer(sub.id)}
            >
              <div class="toggle-thumb"></div>
            </button>
            {#if sub.url}
              <button
                class="copy-url-button"
                class:is-copied={copiedSubId === sub.id}
                type="button"
                title="Copy layer URL"
                aria-label={`Copy ${sub.label} URL`}
                on:click={() => copyUrl(sub.id)}
              >
                {#if copiedSubId === sub.id}
                  ✓
                {:else}
                  🔗
                {/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .map-info-window {
    position: fixed;
    top: 82px;
    left: 16px;
    z-index: 50;
    background: white;
    border: 0.5px solid rgba(0, 0, 0, 0.1);
    border-radius: var(--radius-md);
    box-shadow: none;
    min-width: 240px;
    max-width: 280px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .map-info-window.is-right {
    left: calc(50vw + 16px);
  }

  @media (max-width: 900px) {
    .map-info-window.is-right {
      left: 16px;
      top: 268px;
    }
  }

  .window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .collection-dot {
    flex: 0 0 10px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
  }

  .collection-name {
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close-button {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 150ms ease;
  }

  .close-button:hover {
    opacity: 0.6;
  }

  .period-row {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 18px;
  }

  .layers-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-top: 4px;
    margin-left: 0;
  }

  .sublayers-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sublayer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 4px;
  }

  .sublayer-name {
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sublayer-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }

  .toggle-switch {
    width: 32px;
    height: 18px;
    padding: 2px;
    background: rgba(0, 0, 0, 0.15);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: background 150ms ease;
  }

  .toggle-switch.is-enabled {
    background: var(--text-ok, #4a7a4a);
  }

  .toggle-thumb {
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 50%;
    transition: transform 150ms ease;
  }

  .toggle-switch.is-enabled .toggle-thumb {
    transform: translateX(14px);
  }

  .copy-url-button {
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: color 150ms ease;
  }

  .copy-url-button:hover {
    color: var(--text-primary);
  }

  .copy-url-button.is-copied {
    color: var(--text-ok, #4a7a4a);
  }
</style>
