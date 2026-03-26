<!-- app/src/lib/components/Timeslider.svelte -->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { MassartItem } from '$lib/artemis/types';

  export let massartItems: MassartItem[] = [];
  export let yearLeeway: number = 3;
  export let loadingLayers: Record<string, boolean> = {};

  const dispatch = createEventDispatcher<{
    mainToggle:     { mainId: string; enabled: boolean };
    sublayerChange: { subId: string; enabled: boolean };
    'open-viewer':  { title: string; sourceManifestUrl: string; imageServiceUrl: string };
    'year-change':  { year: number };
  }>();

  const SOURCES = [
    {
      key: 'hand', mainId: 'handdrawn', label: 'Hand drawn',
      start: 1700, end: 1715, repr: 1707, color: '#8B7EC8', row: 1,
      sublayers: [
        { id: 'iiif',    subId: 'handdrawn-iiif',    label: 'IIIF sheets',         defaultOn: true  },
        { id: 'parcels', subId: 'handdrawn-parcels',  label: 'Parcels',              defaultOn: false },
        { id: 'water',   subId: 'handdrawn-water',    label: 'Water infrastructure', defaultOn: false },
      ],
    },
    {
      key: 'ferraris', mainId: 'ferraris', label: 'Ferraris',
      start: 1770, end: 1778, repr: 1774, color: '#B8860B', row: 1,
      sublayers: [
        { id: 'wmts',    subId: 'ferraris-wmts',      label: 'Map tiles', defaultOn: true  },
        { id: 'landuse', subId: 'ferraris-landusage',  label: 'Land use',  defaultOn: false },
      ],
    },
    {
      key: 'primitief', mainId: 'primitief', label: 'Primitief Kadaster',
      start: 1808, end: 1834, repr: 1814, color: '#C07B28', row: 2,
      sublayers: [
        { id: 'iiif',    subId: 'primitief-iiif',      label: 'IIIF sheets', defaultOn: true  },
        { id: 'parcels', subId: 'primitief-parcels',   label: 'Parcels',     defaultOn: false },
        { id: 'landuse', subId: 'primitief-landusage', label: 'Land use',    defaultOn: false },
      ],
    },
    {
      key: 'vander', mainId: 'vandermaelen', label: 'Vandermaelen',
      start: 1846, end: 1854, repr: 1850, color: '#C04A28', row: 1,
      sublayers: [
        { id: 'wmts',    subId: 'vandermaelen-wmts',      label: 'Map tiles', defaultOn: true  },
        { id: 'landuse', subId: 'vandermaelen-landusage',  label: 'Land use',  defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'gereduceerd', label: 'Gereduceerd Kadaster',
      start: 1847, end: 1855, repr: 1851, color: '#9440A0', row: 2,
      sublayers: [
        { id: 'iiif',    subId: 'gereduceerd-iiif',      label: 'IIIF sheets', defaultOn: true  },
        { id: 'parcels', subId: 'gereduceerd-parcels',   label: 'Parcels',     defaultOn: false },
        { id: 'landuse', subId: 'gereduceerd-landusage', label: 'Land use',    defaultOn: false },
      ],
    },
  ] as const;

  type SourceKey = typeof SOURCES[number]['key'];

  // ─── Massart data ──────────────────────────────────────────────────────────

  // Group Massart items by integer year for dot rendering.
  $: massartByYear = massartItems.reduce<Map<number, MassartItem[]>>((acc, item) => {
    const y = parseInt(item.year ?? '0', 10);
    if (y > 1000) {
      const arr = acc.get(y) ?? [];
      arr.push(item);
      acc.set(y, arr);
    }
    return acc;
  }, new Map());

  // ─── Dynamic axis ──────────────────────────────────────────────────────────
  // Derived from SOURCES config + any loaded external data (Massart years).
  // Rounded outward to the nearest decade with a small margin.

  $: _massartYears = [...massartByYear.keys()];
  $: _allMax = Math.max(...SOURCES.map(s => s.end), ..._massartYears);
  $: _allMin = Math.min(...SOURCES.map(s => s.start));
  $: axisStart = Math.floor((_allMin - 10) / 10) * 10;
  $: axisEnd   = Math.ceil((_allMax  + 10) / 10) * 10;
  $: axisSpan  = axisEnd > axisStart ? axisEnd - axisStart : 1;

  // ─── Tick marks ────────────────────────────────────────────────────────────

  type TickKind = 'century' | 'decade';

  function buildTicks(start: number, end: number): { year: number; kind: TickKind }[] {
    const result: { year: number; kind: TickKind }[] = [];
    for (let y = Math.ceil(start / 10) * 10; y <= end; y += 10) {
      result.push({ year: y, kind: y % 100 === 0 ? 'century' : 'decade' });
    }
    return result;
  }

  $: ticks = buildTicks(axisStart, axisEnd);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function pct(year: number, aStart: number, aSpan: number): string {
    return `${((year - aStart) / aSpan) * 100}%`;
  }

  function widthPct(start: number, end: number, aSpan: number): string {
    return `${((end - start) / aSpan) * 100}%`;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  // Initial position: midpoint of the SOURCES range.
  let sliderYear: number = Math.round(
    (Math.min(...SOURCES.map(s => s.start)) + Math.max(...SOURCES.map(s => s.end))) / 2
  );
  let trackWidth = 0;

  let enabledLayers: Record<string, boolean> = Object.fromEntries(
    SOURCES.map(s => [s.key, true])
  );

  let sublayerState: Record<string, Record<string, boolean>> = Object.fromEntries(
    SOURCES.map(s => [
      s.key,
      Object.fromEntries(s.sublayers.map(sub => [sub.id, sub.defaultOn])),
    ])
  );

  // ─── Visibility tracking ───────────────────────────────────────────────────

  let prevVisible: Record<string, boolean> = {};
  onMount(async () => {
    // Dispatch initial layer visibility state.
    for (const src of SOURCES) {
      const isOver = panelSources.some(p => p.key === src.key);
      const visible = enabledLayers[src.key] && isOver;
      prevVisible[src.key] = visible;
      dispatch('mainToggle', { mainId: src.mainId, enabled: visible });
      if (visible) {
        for (const sub of src.sublayers) {
          if (sublayerState[src.key]?.[sub.id]) {
            dispatch('sublayerChange', { subId: sub.subId, enabled: true });
          }
        }
      }
    }
  });

  // ─── Dot popup ─────────────────────────────────────────────────────────────

  let popupItems: MassartItem[] = [];
  let popupIdx = 0;
  let popupX = 0;
  let popupY = 0;

  function openDotPopup(e: MouseEvent, items: MassartItem[]) {
    popupItems = items;
    popupIdx = 0;
    popupX = e.clientX;
    popupY = e.clientY;
    e.stopPropagation();
  }

  function closePopup() { popupItems = []; }

  function openInViewer() {
    const item = popupItems[popupIdx];
    if (!item) return;
    dispatch('open-viewer', {
      title: item.title,
      sourceManifestUrl: item.manifestUrl,
      imageServiceUrl: '',
    });
    closePopup();
  }

  // ─── Interactions ──────────────────────────────────────────────────────────

  function onSliderInput(e: Event) {
    sliderYear = parseFloat((e.target as HTMLInputElement).value);
    dispatch('year-change', { year: sliderYear });
  }

  // Dot is "near" the scrubber if its year is within yearLeeway of sliderYear.
  function isDotNear(yr: number): boolean {
    return Math.abs(yr - sliderYear) <= yearLeeway;
  }

  function handleBlockClick(key: SourceKey) {
    const wasEnabled = enabledLayers[key];
    enabledLayers = { ...enabledLayers, [key]: !wasEnabled };
    const src = SOURCES.find(s => s.key === key)!;
    if (!wasEnabled) sliderYear = src.repr;
  }

  function toggleSublayer(key: SourceKey, subId: string, localId: string) {
    const cur = sublayerState[key]?.[localId] ?? false;
    sublayerState = {
      ...sublayerState,
      [key]: { ...sublayerState[key], [localId]: !cur },
    };
    const isVisible = enabledLayers[key] && panelSources.some(p => p.key === key);
    if (isVisible) dispatch('sublayerChange', { subId, enabled: !cur });
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  $: halfKnobYears = trackWidth > 0 ? (9 / trackWidth) * axisSpan : 3;

  $: panelSources = SOURCES.filter(
    s => sliderYear >= s.start - halfKnobYears && sliderYear <= s.end + halfKnobYears
  );
  $: row1 = SOURCES.filter(s => s.row === 1);
  $: row2 = SOURCES.filter(s => s.row === 2);

  // ─── Sync map visibility ───────────────────────────────────────────────────

  $: {
    const activeSet = new Set(panelSources.map(s => s.key));
    for (const src of SOURCES) {
      const nowVisible = enabledLayers[src.key] && activeSet.has(src.key);
      if (prevVisible[src.key] !== undefined && prevVisible[src.key] !== nowVisible) {
        dispatch('mainToggle', { mainId: src.mainId, enabled: nowVisible });
        if (!nowVisible) {
          for (const sub of src.sublayers) {
            dispatch('sublayerChange', { subId: sub.subId, enabled: false });
          }
        } else {
          for (const sub of src.sublayers) {
            dispatch('sublayerChange', {
              subId: sub.subId,
              enabled: sublayerState[src.key]?.[sub.id] ?? sub.defaultOn,
            });
          }
        }
        prevVisible[src.key] = nowVisible;
      }
    }
  }

  $: scrubberPct = ((sliderYear - axisStart) / axisSpan) * 100;
</script>

<!-- ── Floating sublayer pills (top-left, shown when scrubber is over a source) ── -->
{#if panelSources.length > 0}
  <div class="ts-sub-panel" transition:fade={{ duration: 140 }}>
    {#each panelSources as src}
      <section class="sub-menu" class:is-layer-disabled={!enabledLayers[src.key]}>
        <div class="sub-menu-header">
          <span class="sub-menu-swatch" style="--c:{src.color}"></span>
          <span class="sub-menu-title">{src.label}</span>
        </div>
        <div class="sub-menu-pills">
          {#each src.sublayers as sub}
            <!-- svelte-ignore a11y-interactive-supports-focus -->
            <button
              class="sub-pill"
              class:is-disabled={!(sublayerState[src.key]?.[sub.id] ?? false)}
              class:is-layer-disabled={!enabledLayers[src.key]}
              style="--c:{src.color}"
              type="button"
              title="{src.label} — {sub.label}"
              on:click={() => toggleSublayer(src.key, sub.subId, sub.id)}
            >{sub.label}</button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<!-- ── Massart dot popup ── -->
{#if popupItems.length > 0}
  {@const item = popupItems[popupIdx]}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="dot-popup" style="left:{popupX}px;top:{popupY}px" transition:fade={{ duration: 120 }}>
    <div class="dot-popup-header">
      <span class="dot-popup-year">{item.year}</span>
      <button class="dot-popup-close" type="button" on:click={closePopup} aria-label="Close">×</button>
    </div>
    <div class="dot-popup-title">{item.title}</div>
    {#if item.location}<div class="dot-popup-location">{item.location}</div>{/if}
    {#if popupItems.length > 1}
      <div class="dot-popup-nav">
        <button type="button" on:click={() => popupIdx = (popupIdx - 1 + popupItems.length) % popupItems.length}>‹</button>
        <span>{popupIdx + 1} / {popupItems.length}</span>
        <button type="button" on:click={() => popupIdx = (popupIdx + 1) % popupItems.length}>›</button>
      </div>
    {/if}
    <button class="dot-popup-open" type="button" on:click={openInViewer}>Open in viewer</button>
  </div>
{/if}

<!-- ── Timeslider component ── -->
<div class="timeslider">
  <div class="ts-track" bind:clientWidth={trackWidth}>

    <!-- Row 1: above axis — blocks anchor to bottom (touching the axis) and fill upward -->
    <div class="ts-row ts-row--above">
      {#each row1 as src}
        {@const enabled = enabledLayers[src.key]}
        <!-- svelte-ignore a11y-interactive-supports-focus -->
        <div
          class="source-block"
          class:is-disabled={!enabled}
          class:is-current={enabled && panelSources.some(p => p.key === src.key)}
          class:is-loading={loadingLayers[src.mainId]}
          style="left:{pct(src.start,axisStart,axisSpan)};width:{widthPct(src.start,src.end,axisSpan)};--c:{src.color}"
          role="button"
          tabindex="0"
          title="{src.label} ({src.start}–{src.end})"
          aria-pressed={enabled}
          on:click={() => handleBlockClick(src.key)}
          on:keydown={(e) => e.key === 'Enter' && handleBlockClick(src.key)}
        >
          <span class="block-label">{src.label}</span>
          <span class="block-date">{src.start}–{src.end}</span>
        </div>
      {/each}
    </div>

    <!-- Axis line with scrubber, image dots, and collapsed hatched segments -->
    <div class="ts-axis-line">

      <!-- Scrubber year label -->
      <span
        class="scrubber-label"
        style="left:{scrubberPct}%"
        aria-hidden="true"
      >{Math.round(sliderYear)}</span>

      <!-- Tick marks (decades, centuries) -->
      {#each ticks as tick}
        <span class="ts-tick ts-tick--{tick.kind}" style="left:{pct(tick.year,axisStart,axisSpan)}">
          <span class="ts-tick-label">{tick.year}</span>
        </span>
      {/each}

      <!-- Massart photo dots (one per year, click opens popup) -->
      {#each [...massartByYear.entries()] as [yr, items]}
        <button
          class="img-dot"
          class:img-dot--multi={items.length > 1}
          class:img-dot--near={isDotNear(yr)}
          style="left:{pct(yr,axisStart,axisSpan)}"
          title="{yr} · {items.length} photo{items.length > 1 ? 's' : ''}"
          aria-label="Massart photos {yr}"
          on:click={(e) => openDotPopup(e, items)}
        ></button>
      {/each}

      <!-- Range input scrubber (sits on axis line, z-index above everything) -->
      <input
        class="ts-scrubber"
        type="range"
        min={axisStart}
        max={axisEnd}
        step="1"
        value={sliderYear}
        on:input={onSliderInput}
        aria-label="Timeline year"
      />
    </div>

    <!-- Row 2: below axis — blocks anchor to top (touching the axis) and fill downward -->
    <div class="ts-row ts-row--below">
      {#each row2 as src}
        {@const enabled = enabledLayers[src.key]}
        <!-- svelte-ignore a11y-interactive-supports-focus -->
        <div
          class="source-block"
          class:is-disabled={!enabled}
          class:is-current={enabled && panelSources.some(p => p.key === src.key)}
          class:is-loading={loadingLayers[src.mainId]}
          style="left:{pct(src.start,axisStart,axisSpan)};width:{widthPct(src.start,src.end,axisSpan)};--c:{src.color}"
          role="button"
          tabindex="0"
          title="{src.label} ({src.start}–{src.end})"
          aria-pressed={enabled}
          on:click={() => handleBlockClick(src.key)}
          on:keydown={(e) => e.key === 'Enter' && handleBlockClick(src.key)}
        >
          <span class="block-label">{src.label}</span>
          <span class="block-date">{src.start}–{src.end}</span>
        </div>
      {/each}
    </div>

  </div><!-- /ts-track -->
</div>

<style>
  /* ── Sublayer pills (fixed top-left) ────────────────────────────────────── */

  .ts-sub-panel {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.96);
    border: 0.5px solid rgba(0, 0, 0, 0.12);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    pointer-events: all;
  }

  .sub-menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 180px;
    padding: 10px;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5);
  }

  .sub-menu.is-layer-disabled {
    background: rgba(248, 248, 248, 0.98);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .sub-menu-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sub-menu-swatch {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--c);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    flex: 0 0 auto;
  }

  .sub-menu-title {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 700;
    color: rgba(0,0,0,0.72);
    line-height: 1.2;
  }

  .sub-menu-pills {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sub-pill {
    padding: 9px 18px;
    background: var(--c);
    color: #ffffff;
    border: none;
    border-radius: var(--radius-xs);
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    text-align: center;
    box-shadow: var(--shadow-sm);
    transition: opacity 200ms ease, filter 200ms ease, box-shadow 200ms ease;
  }

  .sub-pill.is-disabled {
    opacity: 0.45;
    filter: saturate(0.35);
    box-shadow: none;
  }

  .sub-pill.is-layer-disabled {
    opacity: 0.55;
    filter: saturate(0.5) brightness(0.94);
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }

  .sub-pill:hover:not(.is-disabled):not(.is-layer-disabled) {
    filter: brightness(1.09);
  }

  /* ── Timeslider shell ────────────────────────────────────────────────────── */

  .timeslider {
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.1);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    user-select: none;
    font-family: var(--font-ui);
    box-shadow: var(--shadow-md);
  }

  /* ── Track ───────────────────────────────────────────────────────────────── */

  .ts-track {
    display: flex;
    flex-direction: column;
  }

  /* ── Rows ────────────────────────────────────────────────────────────────── */

  .ts-row {
    position: relative;
    overflow: visible;
  }

  .ts-row--above { height: 39px; }
  .ts-row--below { height: 39px; }

  /* ── Source blocks — fill full row height, rectangular landing zones ─────── */

  .source-block {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: var(--c);
    border-radius: var(--radius-xs);
    cursor: pointer;
    z-index: 2;
    overflow: hidden;
    padding: 0 10px;
    transition: opacity 200ms ease, filter 200ms ease, transform 200ms ease, box-shadow 200ms ease;
  }

  .source-block.is-disabled {
    opacity: 0.28;
    filter: saturate(0);
  }

  .source-block.is-loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: pill-shimmer 1.3s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes pill-shimmer {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .source-block:hover:not(.is-disabled) {
    filter: brightness(1.09);
  }

  /* Active (scrubber overlapping): scale away from axis, rows grow outward */
  .source-block.is-current {
    z-index: 3;
  }

  .ts-row--above .source-block.is-current {
    transform: scaleY(1.18);
    transform-origin: bottom center;
    box-shadow: 0 -3px 10px rgba(0,0,0,0.18);
  }

  .ts-row--below .source-block.is-current {
    transform: scaleY(1.18);
    transform-origin: top center;
    box-shadow: 0 3px 10px rgba(0,0,0,0.18);
  }

  .block-label {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 700;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-align: center;
    line-height: 1.2;
    letter-spacing: 0.01em;
  }

  .block-date {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    color: rgba(255,255,255,0.65);
    white-space: nowrap;
    text-align: center;
    line-height: 1.2;
  }

  /* ── Axis line ───────────────────────────────────────────────────────────── */

  .ts-axis-line {
    position: relative;
    height: 6px;
    background: linear-gradient(90deg, rgba(0,0,0,0.12), rgba(0,0,0,0.18));
    border-radius: var(--radius-pill);
    z-index: 8;
    overflow: visible;
    pointer-events: none;
  }

  /* ── Scrubber year label (floats above the top row) ─────────────────────── */

  .scrubber-label {
    position: absolute;
    /* clear the top row (39px) plus a small gap */
    bottom: calc(100% + 43px);
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: rgba(0,0,0,0.65);
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.12);
    border-radius: var(--radius-xs);
    padding: 3px 8px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 12;
    box-shadow: var(--shadow-md);
  }

  /* ── Range scrubber ──────────────────────────────────────────────────────── */

  .ts-scrubber {
    position: absolute;
    left: 0;
    top: 50%;
    height: 28px;
    transform: translateY(-50%);
    width: 100%;
    margin: 0;
    padding: 0;
    z-index: 11;
    cursor: ew-resize;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    pointer-events: auto;
  }

  .ts-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #f4f0e8);
    border: 2px solid rgba(192,123,40,0.55);
    cursor: ew-resize;
    box-shadow: var(--shadow-card);
  }

  .ts-scrubber::-moz-range-thumb {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #f4f0e8);
    border: 2px solid rgba(192,123,40,0.55);
    cursor: ew-resize;
    box-shadow: var(--shadow-card);
  }

  .ts-scrubber::-webkit-slider-runnable-track {
    height: 28px;
    background: transparent;
  }

  .ts-scrubber::-moz-range-track {
    height: 28px;
    background: transparent;
    border: none;
  }

  /* ── Image dots ──────────────────────────────────────────────────────────── */

  .img-dot {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) scale(1);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #D4A84B;
    border: 1.5px solid #ffffff;
    padding: 0;
    cursor: pointer;
    z-index: 9;
    pointer-events: auto;
    transition: transform 150ms ease;
  }

  .img-dot:hover { transform: translate(-50%, -50%) scale(1.5); }

  /* Multi-photo year: slightly larger dot with a ring */
  .img-dot--multi {
    width: 9px;
    height: 9px;
    box-shadow: 0 0 0 2px rgba(212, 168, 75, 0.4);
  }

  /* Dot within yearLeeway of the scrubber: brighten */
  .img-dot--near {
    background: #f59e0b;
    transform: translate(-50%, -50%) scale(1.4);
    box-shadow: 0 0 0 2.5px rgba(245, 158, 11, 0.35);
  }

  /* ── Dot popup ────────────────────────────────────────────────────────────── */

  .dot-popup {
    position: fixed;
    transform: translate(-50%, calc(-100% - 14px));
    z-index: 60;
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.12);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    min-width: 200px;
    max-width: 280px;
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: all;
  }

  .dot-popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .dot-popup-year {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: #D4A84B;
  }

  .dot-popup-close {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 16px;
    line-height: 1;
    color: rgba(0,0,0,0.35);
    cursor: pointer;
    flex-shrink: 0;
  }

  .dot-popup-close:hover { color: rgba(0,0,0,0.7); }

  .dot-popup-title {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    color: #1a1a1a;
    line-height: 1.4;
  }

  .dot-popup-location {
    font-family: var(--font-ui);
    font-size: 11px;
    color: rgba(0,0,0,0.45);
  }

  .dot-popup-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: rgba(0,0,0,0.45);
  }

  .dot-popup-nav button {
    background: none;
    border: 0.5px solid rgba(0,0,0,0.2);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
    font-size: 13px;
    cursor: pointer;
    color: rgba(0,0,0,0.5);
  }

  .dot-popup-nav button:hover { background: rgba(0,0,0,0.05); color: #1a1a1a; }

  .dot-popup-open {
    margin-top: 2px;
    padding: 5px 10px;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    background: #1a1a1a;
    color: #ffffff;
    border: none;
    border-radius: var(--radius-xs);
    cursor: pointer;
    align-self: flex-start;
    transition: background 0.15s;
  }

  .dot-popup-open:hover { background: #333333; }

  /* ── Tick marks ───────────────────────────────────────────────────────────── */

  .ts-tick {
    position: absolute;
    top: 100%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    z-index: 1;
  }

  .ts-tick::before {
    content: '';
    display: block;
    width: 1px;
  }

  .ts-tick--decade::before  { height: 8px;  background: rgba(0,0,0,0.22); }
  .ts-tick--century::before { height: 18px; background: rgba(0,0,0,0.55); }

  .ts-tick-label {
    font-family: var(--font-mono);
    font-size: 9px;
    color: rgba(0,0,0,0.38);
    margin-top: 2px;
    white-space: nowrap;
  }

  .ts-tick--century .ts-tick-label { color: rgba(0,0,0,0.65); font-weight: 600; }
</style>
