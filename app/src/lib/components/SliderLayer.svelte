<script lang="ts">
  import { fade } from 'svelte/transition';
  import { MAIN_LAYER_META } from '$lib/artemis/config/layers';
  import type { PaneId, SliderSource } from '$lib/components/timeslider/types';

  export let src: SliderSource;
  export let enabled = true;
  export let isOpen = false;
  export let isCurrent = false;
  export let hasOverlap = false;
  export let loading = false;
  export let dualPaneEnabled = false;
  export let leftEnabled = true;
  export let rightEnabled = true;
  export let sourceBlockStyle = '';
  export let sourceMenuStyle = '';
  export let layerInfoExpanded = false;
  export let onCancelCloseMenu: () => void = () => {};
  export let onScheduleCloseMenu: (key: string) => void = () => {};
  export let onJumpToSource: (src: SliderSource, event: MouseEvent) => void = () => {};
  export let onPillEnter: (src: SliderSource, event: MouseEvent) => void = () => {};
  export let onPillLeave: () => void = () => {};
  export let onToggleMenu: (event: MouseEvent, key: string) => void = () => {};
  export let onInfoButtonClick: (event: MouseEvent, key: string) => void = () => {};
  export let onToggleLayerEnabled: (pane: PaneId, key: string) => void = () => {};
  export let onToggleSublayer: (pane: PaneId, key: string, subId: string, localId: string) => void = () => {};
  export let isSublayerEnabled: (pane: PaneId, key: string, localId: string) => boolean = () => false;
  export let layerInfoKeyFor: (pane: PaneId, mainId: string) => string = () => '';

</script>

<div
  class="source-pill-wrap"
  data-source-key={src.key}
  role="group"
  aria-label={`${src.label} timeline controls`}
  class:is-open={isOpen}
  style={sourceBlockStyle}
  on:mouseenter={onCancelCloseMenu}
  on:mouseleave={() => onScheduleCloseMenu(src.key)}
>
  <button
    data-source-key={src.key}
    class="source-block"
    class:is-disabled={!enabled}
    class:is-current={isCurrent}
    class:is-compare-overlap={hasOverlap}
    class:is-loading={loading}
    type="button"
    title={`${src.label} · ${src.start}–${src.end}`}
    aria-label={`Jump to ${src.label} (${src.start}–${src.end})`}
    on:click={(event) => onJumpToSource(src, event)}
    on:mouseenter={(event) => onPillEnter(src, event)}
    on:mouseleave={onPillLeave}
  >
    <span class="block-label">{src.label}</span>
  </button>

  <button
    class="source-folder-tab"
    class:is-open={isOpen}
    type="button"
    aria-label={`Open ${src.label} sublayers`}
    aria-expanded={isOpen}
    on:click={(event) => onToggleMenu(event, src.key)}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 7.5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  {#if isOpen}
    <div class="source-menu-popover" transition:fade={{ duration: 140 }}>
      {#if dualPaneEnabled}
        <section class="sub-menu sub-menu--compare" style={sourceMenuStyle}>
          <div class="sub-menu-compare-header">
            <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--left">
              <input
                class="sub-menu-checkbox-input"
                type="checkbox"
                checked={leftEnabled}
                aria-label={`${src.label} layer visible in left pane`}
                on:click|stopPropagation
                on:change={() => onToggleLayerEnabled('left', src.key)}
              />
              <span class="sub-menu-pane-check-label">Left</span>
            </label>
            <div class="sub-menu-compare-info">
              <span class="sub-menu-swatch" style={`--c:${src.color}`}></span>
              <span class="sub-menu-title-wrap">
                <span class="sub-menu-title">{src.label}</span>
                <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
              </span>
              <div class="sub-menu-info-anchor sub-menu-info-anchor--compare">
                <button
                  class="sub-menu-info-button"
                  type="button"
                  aria-label={`${src.label} info`}
                  title={`${src.label} info`}
                  aria-expanded={layerInfoExpanded}
                  on:click={(event) => onInfoButtonClick(event, layerInfoKeyFor('left', src.mainId))}
                >i</button>
              </div>
            </div>
            <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--right">
              <span class="sub-menu-pane-check-label">Right</span>
              <input
                class="sub-menu-checkbox-input"
                type="checkbox"
                checked={rightEnabled}
                aria-label={`${src.label} layer visible in right pane`}
                on:click|stopPropagation
                on:change={() => onToggleLayerEnabled('right', src.key)}
              />
            </label>
          </div>
          {#if src.sublayers.length > 1}
            <div class="sub-menu-compare-grid">
              {#each src.sublayers as sub}
                <div class="sub-menu-compare-row">
                  <span class="sub-menu-compare-name">{sub.label}</span>
                  <div class="sub-menu-compare-controls sub-menu-compare-controls--split" style={`--c:${src.color}`}>
                    <button
                      class="sub-pill sub-pill--split sub-pill--split-left"
                      class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)}
                      class:is-layer-disabled={!leftEnabled}
                      type="button"
                      title={`${src.label} — Left ${sub.label}`}
                      on:click={() => onToggleSublayer('left', src.key, sub.subId, sub.id)}
                    >{sub.label}</button>
                    <button
                      class="sub-pill sub-pill--split sub-pill--split-right"
                      class:is-disabled={!isSublayerEnabled('right', src.key, sub.id)}
                      class:is-layer-disabled={!rightEnabled}
                      type="button"
                      title={`${src.label} — Right ${sub.label}`}
                      on:click={() => onToggleSublayer('right', src.key, sub.subId, sub.id)}
                    >{sub.label}</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {:else}
        <section class="sub-menu" class:is-layer-disabled={!leftEnabled} style={sourceMenuStyle}>
          <div class="sub-menu-header-row">
            <button
              class="sub-menu-header sub-menu-header--toggle"
              class:is-disabled={!leftEnabled}
              type="button"
              title={`${src.label} — global visibility`}
              on:click={() => onToggleLayerEnabled('left', src.key)}
            >
              <span class="sub-menu-swatch" style={`--c:${src.color}`}></span>
              <span class="sub-menu-title-wrap">
                <span class="sub-menu-title">{src.label}</span>
                <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
              </span>
            </button>
            <input
              class="sub-menu-checkbox-input"
              type="checkbox"
              checked={leftEnabled}
              aria-label={`${src.label} layer visible in left pane`}
              on:click|stopPropagation
              on:change={() => onToggleLayerEnabled('left', src.key)}
            />
            <div class="sub-menu-info-anchor">
              <button
                class="sub-menu-info-button"
                type="button"
                aria-label={`${src.label} info`}
                title={`${src.label} info`}
                aria-expanded={layerInfoExpanded}
                on:click={(event) => onInfoButtonClick(event, layerInfoKeyFor('left', src.mainId))}
              >i</button>
            </div>
          </div>
          {#if src.sublayers.length > 1}
            <div class="sub-menu-pills">
              {#each src.sublayers as sub}
                <button
                  class="sub-pill"
                  class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)}
                  class:is-layer-disabled={!leftEnabled}
                  style={`--c:${src.color}`}
                  type="button"
                  title={`${src.label} — ${sub.label}`}
                  on:click={() => onToggleSublayer('left', src.key, sub.subId, sub.id)}
                >{sub.label}</button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sub-menu {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 180px;
    padding: 10px;
    background: var(--surface-raised);
    border: 1px solid var(--sub-menu-border);
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 1px var(--surface-inset);
  }

  .sub-menu--compare {
    min-width: 248px;
  }

  .sub-menu.is-layer-disabled {
    background: var(--surface-disabled);
    border-color: var(--surface-outline-soft);
  }

  .sub-menu-header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -10px -10px 0;
    padding: 10px;
    background: var(--pane-header-tint, transparent);
    border-radius: calc(var(--radius-md) - 2px) calc(var(--radius-md) - 2px) 0 0;
    overflow: hidden;
  }

  .sub-menu-header-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: stretch;
  }

  .sub-menu-compare-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin: -10px -10px 0;
    padding: 10px;
    background: var(--pane-header-tint, transparent);
    border-radius: calc(var(--radius-md) - 2px) calc(var(--radius-md) - 2px) 0 0;
    overflow: visible;
    position: relative;
  }

  .sub-menu-compare-header::after,
  .sub-menu-header::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: var(--sub-menu-header-overlay), var(--pattern);
    background-size: auto, var(--pattern-size);
    background-position: center, center;
    opacity: 0.9;
    pointer-events: none;
    border-radius: inherit;
  }

  .sub-menu-compare-info {
    grid-column: 2;
    position: relative;
    z-index: var(--pill-z, 1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 0;
  }

  .sub-menu-pane-check {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
    min-height: 40px;
    padding: 0;
    border-radius: 0;
    background: transparent;
  }

  .sub-menu-pane-check--left {
    grid-column: 1;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pane-left-color) 18%, transparent);
  }

  .sub-menu-pane-check--right {
    grid-column: 3;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pane-right-color) 18%, transparent);
  }

  .sub-menu-pane-check--compare {
    justify-self: start;
    position: relative;
    z-index: 1;
  }

  .sub-menu-pane-check--compare.sub-menu-pane-check--right {
    justify-self: end;
  }

  .sub-menu--compare .sub-menu-pane-check--left,
  .sub-menu--compare .sub-menu-pane-check--right {
    box-shadow: none;
  }

  .sub-menu-pane-check-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .sub-menu-header--toggle {
    width: 100%;
    border: none;
    cursor: pointer;
    text-align: left;
    box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--sub-menu-border) 80%, transparent);
    transition: filter 160ms ease, box-shadow 160ms ease;
    margin: 0;
  }

  .sub-menu-header--toggle:hover,
  .sub-menu-header--toggle:focus-visible {
    filter: brightness(1.03);
    box-shadow:
      inset 0 -1px 0 color-mix(in srgb, var(--sub-menu-border) 80%, transparent),
      inset 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 80%, transparent);
  }

  .sub-menu-header--toggle:focus-visible,
  .sub-menu-checkbox-input:focus-visible,
  .sub-menu-info-button:hover,
  .sub-menu-info-button:focus-visible,
  .source-block:focus-visible {
    outline: 2px solid var(--surface-focus);
    outline-offset: 2px;
  }

  .sub-menu-header--toggle.is-disabled {
    filter: saturate(0.78) brightness(0.95);
  }

  .sub-menu-swatch,
  .sub-menu-title,
  .sub-menu-title-meta {
    position: relative;
    z-index: 1;
  }

  .sub-menu-swatch {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--c);
    box-shadow: 0 0 0 1px var(--sub-menu-swatch-ring);
    flex: 0 0 auto;
  }

  .sub-menu-title {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    line-height: 1.2;
  }

  .sub-menu-title-wrap {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .sub-menu--compare .sub-menu-title-wrap {
    justify-content: center;
    flex: 0 1 auto;
  }

  .sub-menu-title-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: color-mix(in srgb, var(--text-secondary) 72%, transparent);
    line-height: 1;
  }

  .sub-menu-checkbox-input {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1.5px solid color-mix(in srgb, var(--text-secondary) 36%, transparent);
    background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--surface-inset-strong) 70%, transparent), 0 1px 2px rgba(0, 0, 0, 0.08);
    flex: 0 0 auto;
    cursor: pointer;
    align-self: center;
    position: relative;
    z-index: 2;
  }

  .sub-menu-checkbox-input:checked {
    border-color: color-mix(in srgb, var(--c) 72%, white);
    background: var(--c);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 32%, transparent), 0 2px 6px rgba(0, 0, 0, 0.12);
  }

  .sub-menu-checkbox-input:checked::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 2px;
    width: 5px;
    height: 9px;
    border-right: 2px solid var(--text-on-accent);
    border-bottom: 2px solid var(--text-on-accent);
    transform: rotate(45deg);
  }

  .sub-menu-info-button {
    position: relative;
    z-index: 3;
    align-self: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface-floating) 94%, white);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 85%, transparent), 0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .sub-menu-info-anchor {
    position: relative;
    display: flex;
    align-items: center;
    align-self: center;
    z-index: 4;
    flex: 0 0 auto;
  }

  .sub-menu-pills,
  .sub-menu-compare-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sub-menu-compare-row {
    display: block;
  }

  .sub-menu-compare-name {
    display: none;
  }

  .sub-menu-compare-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .sub-menu-compare-controls--split {
    gap: 0;
    border-radius: var(--radius-xs);
    overflow: hidden;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 80%, transparent) inset, 0 4px 10px rgba(0, 0, 0, 0.10);
  }

  .sub-pill {
    position: relative;
    width: 100%;
    padding: 8px 16px;
    background: var(--c);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-xs);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    white-space: nowrap;
    text-align: center;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 80%, transparent) inset, 0 4px 10px rgba(0, 0, 0, 0.10);
    overflow: hidden;
    transition: opacity 200ms ease, filter 200ms ease, box-shadow 200ms ease;
  }

  .sub-pill--split {
    border-radius: 0;
    box-shadow: none;
    padding: 8px 10px;
    font-size: 12px;
  }

  .sub-pill--split-left {
    border-right: 1px solid color-mix(in srgb, var(--text-on-accent) 22%, transparent);
  }

  .sub-pill--split-right {
    border-left: 1px solid color-mix(in srgb, black 12%, transparent);
  }

  .sub-pill.is-disabled,
  .sub-pill.is-layer-disabled {
    opacity: 0.72;
    filter: saturate(0.76) brightness(0.96);
    box-shadow: 0 0 0 1.5px var(--surface-outline), var(--shadow-sm);
    cursor: pointer;
  }

  .sub-pill:hover:not(.is-disabled):not(.is-layer-disabled) {
    filter: brightness(1.04);
  }

  .sub-pill.is-disabled:hover,
  .sub-pill.is-layer-disabled:hover,
  .sub-pill.is-disabled:focus-visible,
  .sub-pill.is-layer-disabled:focus-visible {
    opacity: 0.72;
    filter: saturate(0.72) brightness(1.02);
    box-shadow: 0 0 0 2px var(--pill-disabled-hover-inset) inset, var(--shadow-md);
  }

  .source-block {
    position: absolute;
    top: 16px;
    right: 0;
    bottom: 0;
    left: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: var(--c);
    border: none;
    border-radius: var(--radius-xs);
    cursor: pointer;
    appearance: none;
    z-index: 1;
    overflow: visible;
    padding: 0 34px 0 10px;
    margin: 0;
    pointer-events: auto;
    transition: opacity 200ms ease, filter 200ms ease, box-shadow 200ms ease;
    box-shadow: var(--pill-shadow, 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset, 0 5px 12px rgba(0, 0, 0, 0.10));
  }

  .source-pill-wrap {
    position: absolute;
    top: -16px;
    bottom: 0;
    width: var(--pill-width);
    min-width: var(--pill-min-width);
    pointer-events: auto;
    transform: var(--pill-transform, none);
    transform-origin: var(--pill-transform-origin, center center);
    z-index: var(--pill-z, auto);
    animation: var(--pill-animation, none);
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform;
  }

  @keyframes pill-current-expand-top {
    0% {
      transform: translateY(-2px) scale(1.02, 1.14);
    }
    100% {
      transform: translateY(-4px) scale(1.08, 1.22);
    }
  }

  @keyframes pill-current-expand-bottom {
    0% {
      transform: translateY(2px) scale(1.02, 1.14);
    }
    100% {
      transform: translateY(4px) scale(1.08, 1.22);
    }
  }

  .source-pill-wrap.is-open {
    z-index: 80;
  }

  .source-pill-wrap.is-open .source-block {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 70%, white), 0 12px 24px rgba(0, 0, 0, 0.18);
  }

  .source-folder-tab {
    position: absolute;
    right: 3px;
    top: 50%;
    transform: translateY(-50%);
    width: 26px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--surface-outline-soft) 80%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--c) 68%, white 32%);
    color: var(--text-on-accent);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.14), 0 0 0 1px color-mix(in srgb, white 38%, transparent) inset;
    cursor: pointer;
    z-index: 3;
  }

  .source-folder-tab svg {
    transition: transform 160ms ease;
  }

  .source-folder-tab.is-open svg {
    transform: rotate(180deg);
  }

  .source-folder-tab.is-open {
    background: color-mix(in srgb, var(--c) 56%, white 44%);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12), 0 0 0 2px color-mix(in srgb, var(--c) 55%, white);
  }

  .source-menu-popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: max-content;
    max-width: min(320px, calc(100vw - 32px));
    pointer-events: auto;
  }

  .source-menu-popover::before {
    content: '';
    position: absolute;
    inset: -6px;
    border: 2px dashed color-mix(in srgb, var(--text-primary) 24%, transparent);
    border-radius: calc(var(--radius-md) + 4px);
    pointer-events: none;
  }

  .source-block::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: calc(var(--radius-xs) - 1px);
    box-shadow: inset 0 1px 0 var(--pill-sheen);
    pointer-events: none;
    z-index: 1;
  }

  .source-block.is-disabled {
    opacity: 0.5;
    filter: saturate(0.22) brightness(1.02) contrast(0.82);
    box-shadow: 0 0 0 2px var(--surface-outline), var(--shadow-sm);
  }

  .source-block.is-disabled .block-label {
    color: var(--text-on-accent);
    text-shadow: var(--accent-text-shadow);
  }

  .source-block.is-loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, var(--pill-shimmer) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: pill-shimmer 1.3s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes pill-shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .source-block.is-current {
    z-index: 2;
  }

  .block-label {
    position: relative;
    display: block;
    z-index: 4;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-on-accent);
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
    max-width: none;
    text-align: center;
    line-height: 1.1;
    letter-spacing: 0.01em;
    text-transform: none;
    pointer-events: none;
  }
</style>
