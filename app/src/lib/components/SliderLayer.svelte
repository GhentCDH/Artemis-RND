<script lang="ts">
  import type { SliderSource } from '$lib/components/timeslider/types';

  export let src: SliderSource;
  export let enabled = true;
  export let isCurrent = false;
  export let hasOverlap = false;
  export let loading = false;
  export let isDimmed = false;
  export let bulgeDirection: 'above' | 'below' = 'above';
  export let sourceBlockStyle = '';
  export let onMeanderClick: (src: SliderSource, event: MouseEvent | KeyboardEvent) => void = () => {};
  export let onPillEnter: (src: SliderSource, event: MouseEvent) => void = () => {};
  export let onPillLeave: () => void = () => {};

  const viewBoxWidth = 100;
  const viewBoxHeight = 72;
  const axisYAbove = 64;
  const axisYBelow = 8;
  $: activeGradientId = `meander-active-gradient-${src.key}`;
  $: activeFalloffGradientId = `meander-active-falloff-gradient-${src.key}`;
  $: activeFalloffMaskId = `meander-active-falloff-mask-${src.key}`;

  function trackWaveFloor(lane: number): { primary: number; secondary: number } {
    if (lane === 1 || lane === 4) return { primary: 58, secondary: 46 };
    if (lane === 2 || lane === 3) return { primary: 30, secondary: 22 };
    return { primary: 34, secondary: 22 };
  }

  $: nominalAxisY = bulgeDirection === 'above' ? axisYAbove : axisYBelow;
  $: startY = nominalAxisY;
  $: endY = nominalAxisY;
  $: axisY = nominalAxisY;
  $: waveFloor = trackWaveFloor(src.lane);
  $: apexWave = waveFloor.primary * 0.65;
  $: apexY = bulgeDirection === 'above' ? axisY - apexWave : axisY + apexWave;
  $: meanderPath = [
    `M 0 ${startY}`,
    `C 25 ${startY}, 25 ${apexY}, 50 ${apexY}`,
    `C 75 ${apexY}, 75 ${endY}, 100 ${endY}`,
  ].join(' ');
  $: baseTimelinePath = `M 0 ${axisY} L 100 ${axisY}`;
  $: dotTrackY = apexY;
  $: dotTop = `${(dotTrackY / viewBoxHeight) * 100}%`;
  $: labelStyle = `top:${dotTop}`;

  function onSourceKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onMeanderClick(src, event);
  }

  function describeDebugTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    return [
      target.tagName.toLowerCase(),
      target.id ? `#${target.id}` : '',
      typeof target.className === 'string' && target.className ? `.${target.className.replace(/\s+/g, '.')}` : '',
    ].join('');
  }

  function onMeanderPathClick(event: MouseEvent) {
    console.log('[Artemis debug] meander click', {
      sourceKey: src.key,
      mainId: src.mainId,
      label: src.label,
      target: describeDebugTarget(event.target),
      currentTarget: describeDebugTarget(event.currentTarget),
      clientX: event.clientX,
      clientY: event.clientY,
      elementFromPoint: describeDebugTarget(document.elementFromPoint(event.clientX, event.clientY)),
      defaultPrevented: event.defaultPrevented,
    });
    onMeanderClick(src, event);
  }

</script>

<div
  class="source-pill-wrap"
  class:is-below={bulgeDirection === 'below'}
  data-source-key={src.key}
  role="group"
  aria-label={`${src.label} timeline controls`}
  style={sourceBlockStyle}
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
    on:keydown={onSourceKeydown}
  >
    <svg
      class="meander-svg"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={activeGradientId} x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="currentColor"></stop>
          <stop class="meander-active-stop" offset="50%"></stop>
          <stop offset="100%" stop-color="currentColor"></stop>
        </linearGradient>
        <linearGradient id={activeFalloffGradientId} x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="black"></stop>
          <stop offset="50%" stop-color="white"></stop>
          <stop offset="100%" stop-color="black"></stop>
        </linearGradient>
        <mask id={activeFalloffMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="72">
          <rect x="0" y="0" width="100" height="72" fill={`url(#${activeFalloffGradientId})`}></rect>
        </mask>
      </defs>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <path
        class="meander-hit"
        data-source-key={src.key}
        d={meanderPath}
        on:click={onMeanderPathClick}
        on:mouseenter={(event) => onPillEnter(src, event)}
        on:mouseleave={onPillLeave}
      ></path>
      <path class="meander-axis-redirect" d={baseTimelinePath}></path>
      <path class="meander-river" d={meanderPath}></path>
      <path class="meander-current" d={meanderPath} style={isCurrent ? `stroke:url(#${activeGradientId})` : ''}></path>
      <path class="meander-active-apex" d={meanderPath} mask={`url(#${activeFalloffMaskId})`}></path>
      <path class="meander-flow" d={meanderPath}></path>
    </svg>
    <span class="meander-label" style={labelStyle}>
      <span class="meander-label-text">
        <span class="meander-label-title">{src.label}</span>
      </span>
    </span>
    <span class="meander-dot" style={`top:${dotTop}`}></span>
  </button>
</div>

<style>
  .source-block:focus-visible {
    outline: 2px solid var(--control-focus-ring);
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
    appearance: none;
    z-index: 1;
    overflow: visible;
    padding: 0;
    margin: 0;
    pointer-events: none;
    color: var(--c);
    transition: opacity 200ms ease, filter 200ms ease;
  }

  .source-pill-wrap {
    position: absolute;
    top: -59px;
    height: 72px;
    width: var(--pill-width);
    min-width: var(--pill-min-width);
    pointer-events: none;
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

  .meander-hit {
    fill: none;
    stroke: transparent;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: var(--river-stroke-width);
    vector-effect: non-scaling-stroke;
    pointer-events: stroke;
    cursor: pointer;
  }

  .meander-river,
  .meander-axis-redirect,
  .meander-current,
  .meander-active-apex,
  .meander-flow {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    transition: opacity 200ms ease, stroke-width 200ms ease;
    pointer-events: none;
  }

  .meander-river {
    opacity: 0;
    stroke-width: 0;
  }

  .meander-axis-redirect {
    opacity: 0;
    stroke: var(--timeline-layer-color);
    stroke-width: calc(var(--river-stroke-width) * 0.42);
  }

  .meander-active-stop {
    stop-color: var(--timeline-layer-active-color);
  }

  .meander-current {
    opacity: 1;
    stroke: var(--timeline-layer-color);
    stroke-width: calc(var(--river-stroke-width) * 0.42);
  }

  .meander-active-apex {
    opacity: 0;
    stroke: var(--timeline-layer-active-color);
    stroke-width: calc(var(--river-stroke-width) * 0.62);
  }

  .meander-flow {
    opacity: 0;
    stroke: color-mix(in srgb, currentColor 28%, white);
    stroke-width: calc(var(--river-stroke-width) * 0.16);
    stroke-dasharray: calc(var(--river-stroke-width) * 0.08) calc(var(--river-stroke-width) * 0.62);
    stroke-dashoffset: 0;
  }

  .source-block.is-current .meander-river {
    stroke-width: 0;
  }

  .source-block.is-current .meander-axis-redirect {
    opacity: 1;
  }

  .source-block.is-current .meander-current {
    stroke: var(--timeline-layer-active-color);
    stroke-width: calc(var(--river-stroke-width) * 0.42);
  }

  .source-block.is-current .meander-active-apex {
    opacity: 1;
  }

  .source-block.is-current .meander-flow {
    opacity: 0.95;
    animation: meander-flow 1.1s linear infinite;
  }

  .source-block.is-dimmed .meander-river {
    opacity: 0;
  }

  .source-block.is-dimmed .meander-current {
    opacity: 0.38;
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
    border-radius: var(--radius-pill);
    background: currentColor;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-sizing: border-box;
    transition: width 200ms ease, height 200ms ease, opacity 200ms ease;
  }

  .source-block.is-current .meander-dot {
    width: 10px;
    height: 10px;
    background: var(--timeline-layer-active-color);
  }

  .meander-label {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: none;
    color: var(--timeline-layer-active-color);
    opacity: 0.9;
    z-index: 3;
  }

  .meander-label-text {
    position: absolute;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: max-content;
    transform: translateX(-50%);
    text-align: center;
    white-space: nowrap;
  }

  .meander-label-title {
    font-family: var(--font-ui);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.05;
    text-transform: uppercase;
  }

  .meander-label .meander-label-text {
    top: 10px;
  }

  .source-pill-wrap:not(.is-below) .meander-label .meander-label-text {
    top: auto;
    bottom: 10px;
  }
</style>
