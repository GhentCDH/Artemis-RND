<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let min: number;
  export let max: number;
  export let start: number;
  export let end: number;
  export let step: number = 1;
  export let formatValue: (v: number) => string = (v) => String(v);

  const dispatch = createEventDispatcher<{ change: { start: number; end: number } }>();

  let trackEl: HTMLElement;

  $: startPct = ((start - min) / (max - min)) * 100;
  $: endPct = ((end - min) / (max - min)) * 100;

  function beginDrag(handle: 'start' | 'end', e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!trackEl) return;
      const rect = trackEl.getBoundingClientRect();
      // getBoundingClientRect returns visual (post-zoom) coords; ev.clientX is layout.
      // Scale clientX to visual so both are in the same coordinate space for pct calc.
      const cssZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const pct = Math.max(0, Math.min(1, (ev.clientX * cssZoom - rect.left) / rect.width));
      const val = Math.round((min + pct * (max - min)) / step) * step;

      if (handle === 'start') {
        start = Math.min(val, end - step);
      } else {
        end = Math.max(val, start + step);
      }
      dispatch('change', { start, end });
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp, { once: true });
  }
</script>

<div class="range-slider">
  <div class="rs-track" bind:this={trackEl}>
    <!-- inactive background -->
    <div class="rs-track-bg"></div>

    <!-- active fill segment -->
    <div
      class="rs-active-fill"
      style="left:{startPct}%; right:{100 - endPct}%"
    ></div>

    <!-- start thumb -->
    <div
      class="rs-thumb rs-thumb--start"
      style="left:{startPct}%"
      on:pointerdown={(e) => beginDrag('start', e)}
      role="slider"
      tabindex="0"
      aria-label="Start year"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={start}
    ></div>

    <!-- end thumb -->
    <div
      class="rs-thumb rs-thumb--end"
      style="left:{endPct}%"
      on:pointerdown={(e) => beginDrag('end', e)}
      role="slider"
      tabindex="0"
      aria-label="End year"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={end}
    ></div>
  </div>

  <!-- labels below track -->
  <div class="rs-labels">
    <span class="rs-label rs-label--start" style="left:{startPct}%">
      {formatValue(start)}
    </span>
    <span class="rs-label rs-label--end" style="left:{endPct}%">
      {formatValue(end)}
    </span>
  </div>
</div>

<style>
  .range-slider {
    display: flex;
    flex-direction: column;
    gap: 20px;
    user-select: none;
  }

  .rs-track {
    position: relative;
    height: 4px;
    background: var(--muted-surface-background);
    border-radius: var(--radius-pill);
    cursor: pointer;
  }

  .rs-track-bg {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-pill);
    background: var(--muted-surface-background);
  }

  .rs-active-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--button-primary-background);
    border-radius: var(--radius-pill);
    pointer-events: none;
    z-index: 1;
  }

  .rs-thumb {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    background: var(--window-background);
    border: 1.5px solid var(--border-ui);
    border-radius: var(--radius-pill);
    box-shadow: var(--control-shadow);
    cursor: grab;
    transition: border-color 150ms ease, box-shadow 150ms ease;
    z-index: 2;
  }

  .rs-thumb:hover {
    border-color: var(--control-border-hover);
  }

  .rs-thumb:active {
    cursor: grabbing;
    transform: translate(-50%, -50%) scale(1.2);
  }

  .rs-labels {
    position: relative;
    height: 16px;
    pointer-events: none;
  }

  .rs-label {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    line-height: 1.6;
  }
</style>
