<!-- app/src/lib/components/Timeslider.svelte -->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { MassartItem } from '$lib/artemis/types';

  export let massartItems: MassartItem[] = [];
  export let yearLeeway: number = 3;

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
      start: 1770, end: 1778, repr: 1774, color: '#2E8B72', row: 1,
      sublayers: [
        { id: 'landuse', subId: 'ferraris-landusage', label: 'Land use', defaultOn: false },
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
        { id: 'landuse', subId: 'vandermaelen-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'gereduceerd', label: 'Gereduceerd Kadaster',
      start: 1847, end: 1855, repr: 1851, color: '#2A6FAA', row: 2,
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

  function pct(year: number): string {
    return `${((year - axisStart) / axisSpan) * 100}%`;
  }

  function widthPct(start: number, end: number): string {
    return `${((end - start) / axisSpan) * 100}%`;
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

<!-- ── Floating sublayer panel (top-left, shown when scrubber is over a source) ── -->
{#if panelSources.length > 0}
  <div class="ts-overlay-panel" transition:fade={{ duration: 140 }}>
    {#each panelSources as src}
      <div class="overlay-source">
        <div class="overlay-header" style="color:{src.color}; border-color:{src.color}20">
          <span class="overlay-swatch" style="background:{src.color}"></span>
          <span class="overlay-name">{src.label}</span>
          <span class="overlay-date">{src.start}–{src.end}</span>
        </div>
        <div class="overlay-sublayers">
          {#each src.sublayers as sub}
            <label class="overlay-chip" style="--c:{src.color}">
              <input
                type="checkbox"
                checked={sublayerState[src.key]?.[sub.id] ?? false}
                on:change={() => toggleSublayer(src.key, sub.subId, sub.id)}
              />
              <span>{sub.label}</span>
            </label>
          {/each}
        </div>
      </div>
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
          class:is-active={panelSources.some(p => p.key === src.key)}
          style="left:{pct(src.start)};width:{widthPct(src.start,src.end)};--c:{src.color}"
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
        <span class="ts-tick ts-tick--{tick.kind}" style="left:{pct(tick.year)}">
          <span class="ts-tick-label">{tick.year}</span>
        </span>
      {/each}

      <!-- Massart photo dots (one per year, click opens popup) -->
      {#each [...massartByYear.entries()] as [yr, items]}
        <button
          class="img-dot"
          class:img-dot--multi={items.length > 1}
          class:img-dot--near={isDotNear(yr)}
          style="left:{pct(yr)}"
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
          class:is-active={panelSources.some(p => p.key === src.key)}
          style="left:{pct(src.start)};width:{widthPct(src.start,src.end)};--c:{src.color}"
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
  /* ── Overlay panel (fixed top-left) ─────────────────────────────────────── */

  .ts-overlay-panel {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 50;
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.1);
    border-radius: 10px;
    padding: 10px 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 190px;
    pointer-events: all;
    animation: panel-in 150ms ease both;
  }

  @keyframes panel-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .overlay-source {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .overlay-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding-bottom: 6px;
    border-bottom: 1px solid;
  }

  .overlay-swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .overlay-name {
    font-family: 'DM Sans', 'Inter', sans-serif;
    font-size: 12px;
    font-weight: 500;
    flex: 1;
  }

  .overlay-date {
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 10px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  .overlay-sublayers {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .overlay-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    font-family: 'DM Sans', 'Inter', sans-serif;
    font-size: 11px;
    color: #1a1a1a;
    white-space: nowrap;
    padding: 2px 0;
  }

  .overlay-chip input[type="checkbox"] {
    cursor: pointer;
    accent-color: var(--c);
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    margin: 0;
  }

  /* ── Timeslider shell ────────────────────────────────────────────────────── */

  .timeslider {
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.1);
    border-radius: 10px;
    padding: 12px 16px;
    user-select: none;
    font-family: 'DM Sans', 'Inter', sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06);
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
    border-radius: 4px;
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

  .source-block:hover:not(.is-disabled) {
    filter: brightness(1.09);
  }

  /* Active (scrubber overlapping): scale away from axis, rows grow outward */
  .ts-row--above .source-block.is-active {
    transform: scaleY(1.18);
    transform-origin: bottom center;
    box-shadow: 0 -3px 10px rgba(0,0,0,0.18);
    z-index: 3;
  }

  .ts-row--below .source-block.is-active {
    transform: scaleY(1.18);
    transform-origin: top center;
    box-shadow: 0 3px 10px rgba(0,0,0,0.18);
    z-index: 3;
  }

  .block-label {
    font-family: 'DM Sans', 'Inter', sans-serif;
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
    font-family: 'DM Mono', 'Courier New', monospace;
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
    height: 2px;
    background: rgba(0,0,0,0.15);
    z-index: 3;
    overflow: visible;
    pointer-events: none;
  }

  /* ── Scrubber year label (floats above the top row) ─────────────────────── */

  .scrubber-label {
    position: absolute;
    /* clear the top row (39px) plus a small gap */
    bottom: calc(100% + 43px);
    transform: translateX(-50%);
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 11px;
    font-weight: 500;
    color: rgba(0,0,0,0.65);
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.12);
    border-radius: 4px;
    padding: 1px 5px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 6;
    box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  }

  /* ── Range scrubber ──────────────────────────────────────────────────────── */

  .ts-scrubber {
    position: absolute;
    left: 0;
    top: 50%;
    height: 18px;
    transform: translateY(-50%);
    width: 100%;
    margin: 0;
    padding: 0;
    z-index: 5;
    cursor: ew-resize;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    pointer-events: auto;
  }

  .ts-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    border: 1.5px solid rgba(0,0,0,0.30);
    cursor: ew-resize;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.10);
  }

  .ts-scrubber::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    border: 1.5px solid rgba(0,0,0,0.30);
    cursor: ew-resize;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.10);
  }

  .ts-scrubber::-webkit-slider-runnable-track { background: transparent; }
  .ts-scrubber::-moz-range-track             { background: transparent; }

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
    z-index: 4;
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
    border-radius: 8px;
    padding: 10px 12px;
    min-width: 200px;
    max-width: 280px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.07);
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
    font-family: 'DM Mono', 'Courier New', monospace;
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
    font-family: 'DM Sans', 'Inter', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #1a1a1a;
    line-height: 1.4;
  }

  .dot-popup-location {
    font-family: 'DM Sans', 'Inter', sans-serif;
    font-size: 11px;
    color: rgba(0,0,0,0.45);
  }

  .dot-popup-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 11px;
    color: rgba(0,0,0,0.45);
  }

  .dot-popup-nav button {
    background: none;
    border: 0.5px solid rgba(0,0,0,0.2);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 13px;
    cursor: pointer;
    color: rgba(0,0,0,0.5);
  }

  .dot-popup-nav button:hover { background: rgba(0,0,0,0.05); color: #1a1a1a; }

  .dot-popup-open {
    margin-top: 2px;
    padding: 5px 10px;
    font-family: 'DM Sans', 'Inter', sans-serif;
    font-size: 11px;
    font-weight: 500;
    background: #1a1a1a;
    color: #ffffff;
    border: none;
    border-radius: 5px;
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
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 9px;
    color: rgba(0,0,0,0.38);
    margin-top: 2px;
    white-space: nowrap;
  }

  .ts-tick--century .ts-tick-label { color: rgba(0,0,0,0.65); font-weight: 600; }
</style>
