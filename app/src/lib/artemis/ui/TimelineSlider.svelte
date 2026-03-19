<!-- app/src/lib/artemis/ui/TimelineSlider.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MassartItem } from '$lib/artemis/types';

  export let items: MassartItem[] = [];
  export let center: number;
  export let windowSize: number = 4;

  const dispatch = createEventDispatcher<{ change: number }>();

  const EDGE_PAD = 5;

  $: parsedYears = items
    .map(i => (i.year ? parseInt(i.year, 10) : NaN))
    .filter(y => Number.isFinite(y) && y > 1000);

  $: minYear = parsedYears.length ? Math.min(...parsedYears) - EDGE_PAD : 1895;
  $: maxYear = parsedYears.length ? Math.max(...parsedYears) + EDGE_PAD : 1925;
  $: yearSpan = maxYear > minYear ? maxYear - minYear : 1;

  $: densityMap = parsedYears.reduce<Record<number, number>>((acc, y) => {
    acc[y] = (acc[y] ?? 0) + 1;
    return acc;
  }, {});
  $: winStart = center - windowSize / 2;
  $: winEnd = center + windowSize / 2;

  $: activeCount = parsedYears.filter(y => y >= winStart && y <= winEnd).length;

  function yearToPct(y: number): number {
    return ((y - minYear) / yearSpan) * 100;
  }

  function onSliderInput(e: Event) {
    dispatch('change', parseFloat((e.target as HTMLInputElement).value));
  }
</script>

<div class="tl-bar">
  <div class="tl-header">
    <span class="tl-title">Jean Massart</span>
    <span class="tl-active">{activeCount} photo{activeCount !== 1 ? 's' : ''} in window</span>
    <span class="tl-window-label">{Math.round(winStart)} – {Math.round(winEnd)}</span>
  </div>
  <div class="tl-track-area">
    <div class="tl-track">
      <div class="tl-dots-wrap">
        {#each Object.keys(densityMap) as yr}
          <div
            class="tl-dot"
            style="left:{yearToPct(parseInt(yr, 10))}%;"
            title="{yr}: {densityMap[parseInt(yr, 10)]}"
          ></div>
        {/each}
      </div>
      <input
        type="range"
        class="tl-input"
        min={minYear}
        max={maxYear}
        value={center}
        on:input={onSliderInput}
        aria-label="Timeline center year"
      />
    </div>
    <div class="tl-axis">
      <span class="tl-axis-end">{minYear}</span>
      <span class="tl-axis-end">{maxYear}</span>
    </div>
  </div>
</div>

<style>
  .tl-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 16px 8px;
    background: var(--panel-bg);
    border-top: 0.5px solid var(--panel-border);
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.08);
    user-select: none;
  }

  .tl-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tl-title {
    font-size: 11px;
    font-weight: 700;
    color: #f59e0b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .tl-active {
    font-size: 11px;
    color: var(--text-muted);
  }

  .tl-window-label {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .tl-track-area {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .tl-track {
    position: relative;
    height: 22px;
    display: flex;
    align-items: center;
  }

  /* rendered track line */
  .tl-track::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--panel-border);
    border-radius: 2px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .tl-dots-wrap {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .tl-dot {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f59e0b;
    pointer-events: none;
  }

  .tl-input {
    position: absolute;
    left: 0;
    width: 100%;
    height: 18px;
    margin: 0;
    padding: 0;
    z-index: 2;
    cursor: ew-resize;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
  }

  .tl-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f59e0b;
    border: 2.5px solid white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    cursor: ew-resize;
  }

  .tl-input::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f59e0b;
    border: 2.5px solid white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    cursor: ew-resize;
  }

  .tl-input::-webkit-slider-runnable-track {
    background: transparent;
  }

  .tl-input::-moz-range-track {
    background: transparent;
  }

  .tl-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
  }

  .tl-axis-end {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
