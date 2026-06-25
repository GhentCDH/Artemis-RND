<script lang="ts">
  import type { SliderSource } from '$lib/components/timeslider/types';

  export let src: SliderSource;
  export let enabled = true;
  export let isCurrent = false;
  export let hasOverlap = false;
  export let loading = false;
  export let isDimmed = false;
  export let meanderColor = '';
  export let bulgeDirection: 'above' | 'below' = 'above';
  export let meanderWidth = 300;
  export let startAxisOffset = 0;
  export let endAxisOffset = 0;
  export let centerAxisOffset = 0;
  export let sourceBlockStyle = '';
  export let onMeanderClick: (src: SliderSource, event: MouseEvent) => void = () => {};
  export let onPillEnter: (src: SliderSource, event: MouseEvent) => void = () => {};
  export let onPillLeave: () => void = () => {};

  const viewBoxWidth = 100;
  const viewBoxHeight = 72;
  const axisYAbove = 64;
  const axisYBelow = 8;
  const minPrimaryWave = 7;
  const maxPrimaryWave = 30;
  const minSecondaryWave = 4;
  const maxSecondaryWave = 14;

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start: number, end: number, progress: number): number {
    return start + (end - start) * progress;
  }

  function hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededUnit(seed: number, salt: number): number {
    let value = seed + Math.imul(salt, 374761393);
    value = Math.imul(value ^ (value >>> 15), 2246822519);
    value = Math.imul(value ^ (value >>> 13), 3266489917);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function seededRange(seed: number, salt: number, min: number, max: number): number {
    return lerp(min, max, seededUnit(seed, salt));
  }

  function trackWaveFloor(lane: number): { primary: number; secondary: number } {
    if (lane === 1 || lane === 4) return { primary: 58, secondary: 46 };
    if (lane === 2 || lane === 3) return { primary: 46, secondary: 32 };
    return { primary: 34, secondary: 22 };
  }

  $: nominalAxisY = bulgeDirection === 'above' ? axisYAbove : axisYBelow;
  $: startY = nominalAxisY + startAxisOffset;
  $: endY = nominalAxisY + endAxisOffset;
  $: axisY = nominalAxisY + centerAxisOffset;
  $: waveProgress = clamp((meanderWidth - 24) / 96, 0, 1);
  $: waveFloor = trackWaveFloor(src.lane);
  $: subtleWave = Math.max(2, Math.min(4, (meanderWidth - 24) / 100));
  $: meanderSeed = hashString(`${src.key}:${src.start}:${src.end}:${bulgeDirection}`);
  $: apexWave = seededRange(meanderSeed, 1, 20, 32);
  $: apexY = bulgeDirection === 'above' ? axisY - apexWave : axisY + apexWave;
  $: leftWobbleOffset = seededRange(meanderSeed, 2, 0, subtleWave);
  $: rightWobbleOffset = seededRange(meanderSeed, 3, 0, subtleWave);
  $: meanderPath = [
    `M 0 ${startY}`,
    `C 25 ${startY + (bulgeDirection === 'above' ? -leftWobbleOffset : leftWobbleOffset)}, 25 ${apexY}, 50 ${apexY}`,
    `C 75 ${apexY}, 75 ${endY + (bulgeDirection === 'above' ? -rightWobbleOffset : rightWobbleOffset)}, 100 ${endY}`,
  ].join(' ');
  $: dotTrackY = apexY;
  $: dotTop = `${(dotTrackY / viewBoxHeight) * 100}%`;
</script>

<div
  class="source-pill-wrap"
  class:is-below={bulgeDirection === 'below'}
  data-source-key={src.key}
  role="group"
  aria-label={`${src.label} timeline controls`}
  style={`${sourceBlockStyle};--meander-color:${meanderColor || src.color}`}
>
  <button
    data-source-key={src.key}
    class="source-block"
    class:is-disabled={!enabled}
    class:is-current={isCurrent}
    class:is-compare-overlap={hasOverlap}
    class:is-loading={loading}
    class:is-dimmed={isDimmed}
    type="button"
    title={`${src.label} · ${src.start}–${src.end}`}
    aria-label={`Toggle ${src.label} (${src.start}–${src.end})`}
    on:click={(event) => onMeanderClick(src, event)}
    on:mouseenter={(event) => onPillEnter(src, event)}
    on:mouseleave={onPillLeave}
  >
    <svg
      class="meander-svg"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path class="meander-river" d={meanderPath}></path>
      <path class="meander-current" d={meanderPath}></path>
      <path class="meander-flow" d={meanderPath}></path>
    </svg>
    <span class="meander-dot" style={`top:${dotTop}`}></span>
  </button>
</div>

<style>
  .source-block:focus-visible {
    outline: 2px solid var(--surface-focus);
    outline-offset: 2px;
  }

  .source-block {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    height: 72px;
    box-sizing: border-box;
    display: block;
    background: transparent;
    border: none;
    cursor: pointer;
    appearance: none;
    z-index: 1;
    overflow: visible;
    padding: 0;
    margin: 0;
    pointer-events: auto;
    color: var(--meander-color, var(--c));
    transition: opacity 200ms ease, filter 200ms ease;
  }

  .source-pill-wrap {
    position: absolute;
    top: -59px;
    height: 72px;
    width: var(--pill-width);
    min-width: var(--pill-min-width);
    pointer-events: auto;
    transform: var(--pill-wrapper-transform, translateX(-50%));
    z-index: var(--pill-z, auto);
  }

  .source-pill-wrap.is-below {
    top: -3px;
  }

  .source-block.is-disabled {
    opacity: 0.5;
    filter: saturate(0.22) brightness(1.02) contrast(0.82);
  }

  .source-block.is-loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, var(--pill-shimmer) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: pill-shimmer 1.3s ease-in-out infinite;
    clip-path: inset(0 round 999px);
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

  .source-block.is-dimmed {
    filter: saturate(0.36) contrast(0.9);
  }

  .meander-svg {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .meander-river,
  .meander-current,
  .meander-flow {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    transition: opacity 200ms ease, stroke-width 200ms ease;
  }

  .meander-river {
    opacity: 0.24;
    stroke-width: var(--river-stroke-width);
  }

  .meander-current {
    opacity: 0.92;
    stroke-width: calc(var(--river-stroke-width) * 0.42);
  }

  .meander-flow {
    opacity: 0;
    stroke: color-mix(in srgb, currentColor 28%, white);
    stroke-width: calc(var(--river-stroke-width) * 0.16);
    stroke-dasharray: calc(var(--river-stroke-width) * 0.08) calc(var(--river-stroke-width) * 0.62);
    stroke-dashoffset: 0;
  }

  .source-block.is-current .meander-river {
    stroke-width: var(--river-stroke-width);
  }

  .source-block.is-current .meander-current {
    stroke-width: calc(var(--river-stroke-width) * 0.52);
  }

  .source-block.is-current .meander-flow {
    opacity: 0.95;
    animation: meander-flow 1.1s linear infinite;
  }

  .source-block.is-dimmed .meander-river {
    opacity: 0.12;
  }

  .source-block.is-dimmed .meander-current {
    opacity: 0.25;
  }

  @keyframes meander-flow {
    from { stroke-dashoffset: 0; }
    to { stroke-dashoffset: -32; }
  }

  @media (prefers-reduced-motion: reduce) {
    .source-block.is-current .meander-flow {
      animation: none;
    }
  }

  .meander-dot {
    position: absolute;
    left: 50%;
    width: 7px;
    height: 7px;
    border: 1.5px solid #fff;
    border-radius: 999px;
    background: currentColor;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-sizing: border-box;
    transition: width 200ms ease, height 200ms ease, opacity 200ms ease;
  }

  .source-block.is-current .meander-dot {
    width: 10px;
    height: 10px;
  }
</style>
