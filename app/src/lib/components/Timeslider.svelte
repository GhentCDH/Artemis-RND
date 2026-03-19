<!-- app/src/lib/components/Timeslider.svelte -->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  const dispatch = createEventDispatcher<{
    mainToggle:     { mainId: string; enabled: boolean };
    sublayerChange: { subId: string; enabled: boolean };
  }>();

  // ─── Constants ─────────────────────────────────────────────────────────────

  const AXIS_START = 1680;
  const AXIS_END   = 1870;
  const AXIS_SPAN  = AXIS_END - AXIS_START;

  const SOURCES = [
    {
      key: 'hand', mainId: 'handdrawn', label: 'Hand drawn',
      start: 1700, end: 1715, color: '#8B7EC8', row: 1,
      sublayers: [
        { id: 'iiif',    subId: 'handdrawn-iiif',    label: 'IIIF sheets',         defaultOn: true  },
        { id: 'parcels', subId: 'handdrawn-parcels',  label: 'Parcels',              defaultOn: false },
        { id: 'water',   subId: 'handdrawn-water',    label: 'Water infrastructure', defaultOn: false },
      ],
    },
    {
      key: 'ferraris', mainId: 'ferraris', label: 'Ferraris',
      start: 1770, end: 1778, color: '#2E8B72', row: 1,
      sublayers: [
        { id: 'landuse', subId: 'ferraris-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'primitief', mainId: 'primitief', label: 'Primitief Kadaster',
      start: 1808, end: 1834, color: '#C07B28', row: 2,
      sublayers: [
        { id: 'iiif',    subId: 'primitief-iiif',      label: 'IIIF sheets', defaultOn: true  },
        { id: 'parcels', subId: 'primitief-parcels',   label: 'Parcels',     defaultOn: false },
        { id: 'landuse', subId: 'primitief-landusage', label: 'Land use',    defaultOn: false },
      ],
    },
    {
      key: 'vander', mainId: 'vandermaelen', label: 'Vandermaelen',
      start: 1846, end: 1854, color: '#C04A28', row: 1,
      sublayers: [
        { id: 'landuse', subId: 'vandermaelen-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'gereduceerd', label: 'Gereduceerd Kadaster',
      start: 1847, end: 1855, color: '#2A6FAA', row: 2,
      sublayers: [
        { id: 'iiif',    subId: 'gereduceerd-iiif',      label: 'IIIF sheets', defaultOn: true  },
        { id: 'parcels', subId: 'gereduceerd-parcels',   label: 'Parcels',     defaultOn: false },
        { id: 'landuse', subId: 'gereduceerd-landusage', label: 'Land use',    defaultOn: false },
      ],
    },
  ] as const;

  type SourceKey = typeof SOURCES[number]['key'];

  const AXIS_LABELS = [1700, 1750, 1800, 1850];
  const DOT_YEARS   = [1703, 1709, 1748, 1762, 1773, 1812, 1819, 1828, 1847, 1851];

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function pct(year: number): string {
    return `${((year - AXIS_START) / AXIS_SPAN) * 100}%`;
  }

  function widthPct(start: number, end: number): string {
    return `${((end - start) / AXIS_SPAN) * 100}%`;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  // Current scrubber position in years
  let sliderYear: number = AXIS_START;

  // Per-source enabled state — all on by default
  let enabledLayers: Record<string, boolean> = Object.fromEntries(
    SOURCES.map(s => [s.key, true])
  );

  // Sublayer toggle state — persists, initialized from defaultOn
  let sublayerState: Record<string, Record<string, boolean>> = Object.fromEntries(
    SOURCES.map(s => [
      s.key,
      Object.fromEntries(s.sublayers.map(sub => [sub.id, sub.defaultOn])),
    ])
  );

  // ─── Initialise map layers on mount ────────────────────────────────────────

  onMount(() => {
    for (const src of SOURCES) {
      // Enable the main layer (WMTS tile for ferraris/vander, IIIF group for others)
      dispatch('mainToggle', { mainId: src.mainId, enabled: true });
      // Enable only sublayers that are defaultOn (iiif=true for IIIF sources, rest false)
      for (const sub of src.sublayers) {
        if (sublayerState[src.key]?.[sub.id]) {
          dispatch('sublayerChange', { subId: sub.subId, enabled: true });
        }
      }
    }
  });

  // ─── Interactions ──────────────────────────────────────────────────────────

  function onSliderInput(e: Event) {
    sliderYear = parseFloat((e.target as HTMLInputElement).value);
  }

  function handlePillClick(key: SourceKey) {
    const wasEnabled = enabledLayers[key];
    enabledLayers = { ...enabledLayers, [key]: !wasEnabled };
    const src = SOURCES.find(s => s.key === key)!;

    dispatch('mainToggle', { mainId: src.mainId, enabled: !wasEnabled });

    if (wasEnabled) {
      // Disabling — turn off all sublayers on the map
      for (const sub of src.sublayers) {
        dispatch('sublayerChange', { subId: sub.subId, enabled: false });
      }
    } else {
      // Enabling — apply current sublayer state to the map
      for (const sub of src.sublayers) {
        dispatch('sublayerChange', {
          subId: sub.subId,
          enabled: sublayerState[key]?.[sub.id] ?? sub.defaultOn,
        });
      }
    }
  }

  function toggleSublayer(key: SourceKey, subId: string, localId: string) {
    const cur = sublayerState[key]?.[localId] ?? false;
    sublayerState = {
      ...sublayerState,
      [key]: { ...sublayerState[key], [localId]: !cur },
    };
    // Only affect map if main layer is currently enabled
    if (enabledLayers[key]) {
      dispatch('sublayerChange', { subId, enabled: !cur });
    }
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  // Sources whose date range the scrubber is currently over
  $: panelSources = SOURCES.filter(s => sliderYear >= s.start && sliderYear <= s.end);
  $: row1 = SOURCES.filter(s => s.row === 1);
  $: row2 = SOURCES.filter(s => s.row === 2);

  // Scrubber x position as percentage
  $: scrubberPct = ((sliderYear - AXIS_START) / AXIS_SPAN) * 100;
</script>

<!-- ── Floating sublayer panel (top-left, shown when scrubber is over a source) ── -->
{#if panelSources.length > 0}
  <div class="ts-overlay-panel">
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

<!-- ── Timeslider component ── -->
<div class="timeslider">

  <!-- Year axis labels -->
  <div class="ts-axis-labels">
    {#each AXIS_LABELS as yr}
      <span class="ts-year-label" style="left:{pct(yr)}">{yr}</span>
    {/each}
  </div>

  <!-- Track -->
  <div class="ts-track">

    <!-- Row 1: above axis -->
    <div class="ts-row ts-row--above">
      {#each row1 as src}
        {@const enabled = enabledLayers[src.key]}
        <!-- svelte-ignore a11y-interactive-supports-focus -->
        <div
          class="source-block"
          class:is-disabled={!enabled}
          style="left:{pct(src.start)};width:{widthPct(src.start,src.end)};min-width:fit-content;--c:{src.color};bottom:2px"
          role="button"
          tabindex="0"
          title="{src.label} ({src.start}–{src.end})"
          aria-pressed={enabled}
          on:click={() => handlePillClick(src.key)}
          on:keydown={(e) => e.key === 'Enter' && handlePillClick(src.key)}
        >
          <div class="block-pill">{src.label}</div>
        </div>
      {/each}
    </div>

    <!-- Axis line with scrubber and image dots -->
    <div class="ts-axis-line">

      <!-- Scrubber year label -->
      <span
        class="scrubber-label"
        style="left:{scrubberPct}%"
        aria-hidden="true"
      >{Math.round(sliderYear)}</span>

      <!-- Image dots -->
      {#each DOT_YEARS as yr}
        <button
          class="img-dot"
          style="left:{pct(yr)}"
          title="c. {yr}"
          aria-label="Historical image c. {yr}"
          on:click={() => console.log('[Timeslider] dot year:', yr)}
        ></button>
      {/each}

      <!-- Range input scrubber (sits on axis line, z-index above dots) -->
      <input
        class="ts-scrubber"
        type="range"
        min={AXIS_START}
        max={AXIS_END}
        step="1"
        value={sliderYear}
        on:input={onSliderInput}
        aria-label="Timeline year"
      />
    </div>

    <!-- Row 2: below axis -->
    <div class="ts-row ts-row--below">
      {#each row2 as src}
        {@const enabled = enabledLayers[src.key]}
        <!-- svelte-ignore a11y-interactive-supports-focus -->
        <div
          class="source-block"
          class:is-disabled={!enabled}
          style="left:{pct(src.start)};width:{widthPct(src.start,src.end)};min-width:fit-content;--c:{src.color};top:2px"
          role="button"
          tabindex="0"
          title="{src.label} ({src.start}–{src.end})"
          aria-pressed={enabled}
          on:click={() => handlePillClick(src.key)}
          on:keydown={(e) => e.key === 'Enter' && handlePillClick(src.key)}
        >
          <div class="block-pill">{src.label}</div>
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

  /* ── Year labels ─────────────────────────────────────────────────────────── */

  .ts-axis-labels {
    position: relative;
    height: 14px;
    margin-bottom: 6px;
  }

  .ts-year-label {
    position: absolute;
    transform: translateX(-50%);
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 10px;
    color: rgba(0,0,0,0.35);
    bottom: 0;
    white-space: nowrap;
    pointer-events: none;
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

  .ts-row--above { height: 22px; }
  .ts-row--below { height: 22px; }

  /* ── Axis line ───────────────────────────────────────────────────────────── */

  .ts-axis-line {
    position: relative;
    height: 1.5px;
    background: rgba(0,0,0,0.15);
    z-index: 1;
    overflow: visible;
  }

  /* ── Scrubber label (year under the cursor) ──────────────────────────────── */

  .scrubber-label {
    position: absolute;
    top: 8px;
    transform: translateX(-50%);
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 9px;
    color: rgba(0,0,0,0.5);
    white-space: nowrap;
    pointer-events: none;
    z-index: 6;
  }

  /* ── Range scrubber ──────────────────────────────────────────────────────── */

  .ts-scrubber {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 100%;
    height: 20px;
    margin: 0;
    padding: 0;
    z-index: 5;
    cursor: ew-resize;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
  }

  .ts-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 3px;
    height: 22px;
    border-radius: 1.5px;
    background: rgba(0,0,0,0.55);
    cursor: ew-resize;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
  }

  .ts-scrubber::-moz-range-thumb {
    width: 3px;
    height: 22px;
    border-radius: 1.5px;
    background: rgba(0,0,0,0.55);
    cursor: ew-resize;
    border: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
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
    z-index: 3;
    transition: transform 150ms ease;
  }

  .img-dot:hover { transform: translate(-50%, -50%) scale(1.5); }

  /* ── Source pills ────────────────────────────────────────────────────────── */

  .source-block {
    position: absolute;
    display: flex;
    cursor: pointer;
    z-index: 2;
    transition: opacity 200ms ease, filter 200ms ease;
  }

  .source-block.is-disabled {
    opacity: 0.3;
    filter: saturate(0);
  }

  .block-pill {
    height: 20px;
    border-radius: 10px;
    background: var(--c);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    font-family: 'DM Sans', 'Inter', sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: #ffffff;
    white-space: nowrap;
    flex-shrink: 0;
    transition: transform 120ms ease;
  }

  .source-block:hover:not(.is-disabled) .block-pill {
    transform: scaleY(1.08);
  }
</style>
