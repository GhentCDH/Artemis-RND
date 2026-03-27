<!-- app/src/lib/components/Timeslider.svelte -->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { MassartItem } from '$lib/artemis/types';

  type PaneId = 'left' | 'right';

  export let massartItems: MassartItem[] = [];
  export let yearLeeway: number = 3;
  export let loadingLayers: Record<string, boolean> = {};
  export let dualPaneEnabled = false;
  export let leftYear: number | undefined = undefined;
  export let rightYear: number | undefined = undefined;

  const PANE_META: Record<PaneId, { label: string; color: string }> = {
    left: { label: 'Left', color: '#1F6FEB' },
    right: { label: 'Right', color: '#D97706' },
  };

  const dispatch = createEventDispatcher<{
    mainToggle:     { mainId: string; enabled: boolean };
    sublayerChange: { subId: string; enabled: boolean };
    paneMainToggle: { pane: PaneId; mainId: string; enabled: boolean };
    paneSublayerChange: { pane: PaneId; subId: string; enabled: boolean };
    'open-viewer':  { title: string; sourceManifestUrl: string; imageServiceUrl: string };
    'year-change':  { pane: PaneId; year: number };
  }>();

  const SOURCES = [
    {
      key: 'hand', mainId: 'handdrawn', label: 'Hand drawn',
      start: 1700, end: 1715, repr: 1707, color: '#8B7EC8', row: 1,
      sublayers: [
        { id: 'iiif', subId: 'handdrawn-iiif', label: 'IIIF sheets', defaultOn: true },
        { id: 'parcels', subId: 'handdrawn-parcels', label: 'Parcels', defaultOn: false },
        { id: 'water', subId: 'handdrawn-water', label: 'Water infrastructure', defaultOn: false },
      ],
    },
    {
      key: 'ferraris', mainId: 'ferraris', label: 'Ferraris',
      start: 1770, end: 1778, repr: 1774, color: '#B8860B', row: 1,
      sublayers: [
        { id: 'wmts', subId: 'ferraris-wmts', label: 'Map tiles', defaultOn: true },
        { id: 'landuse', subId: 'ferraris-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'primitief', mainId: 'primitief', label: 'Primitief Kadaster',
      start: 1808, end: 1834, repr: 1814, color: '#C07B28', row: 2,
      sublayers: [
        { id: 'iiif', subId: 'primitief-iiif', label: 'IIIF sheets', defaultOn: true },
        { id: 'parcels', subId: 'primitief-parcels', label: 'Parcels', defaultOn: false },
        { id: 'landuse', subId: 'primitief-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'vander', mainId: 'vandermaelen', label: 'Vandermaelen',
      start: 1846, end: 1854, repr: 1850, color: '#C04A28', row: 1,
      sublayers: [
        { id: 'wmts', subId: 'vandermaelen-wmts', label: 'Map tiles', defaultOn: true },
        { id: 'landuse', subId: 'vandermaelen-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'gereduceerd', label: 'Gereduceerd Kadaster',
      start: 1847, end: 1855, repr: 1851, color: '#9440A0', row: 2,
      sublayers: [
        { id: 'iiif', subId: 'gereduceerd-iiif', label: 'IIIF sheets', defaultOn: true },
        { id: 'parcels', subId: 'gereduceerd-parcels', label: 'Parcels', defaultOn: false },
        { id: 'landuse', subId: 'gereduceerd-landusage', label: 'Land use', defaultOn: false },
      ],
    },
  ] as const;

  type SourceDef = typeof SOURCES[number];
  type SourceKey = SourceDef['key'];
  type PaneState = { id: PaneId; year: number; label: string; color: string };
  const TIMELINE_AXIS_START = 1690;
  const TIMELINE_AXIS_END = 1930;

  const defaultYear = Math.round(
    (Math.min(...SOURCES.map(s => s.start)) + Math.max(...SOURCES.map(s => s.end))) / 2
  );

  let sliderYear = defaultYear;
  let trackWidth = 0;
  let localLeftYear = defaultYear;
  let localRightYear = defaultYear;
  let lastLeftYearProp: number | undefined = undefined;
  let lastRightYearProp: number | undefined = undefined;
  let dualPaneModePrev = dualPaneEnabled;
  let dualPaneYearsInitialized = dualPaneEnabled;

  let enabledLayers: Record<string, boolean> = Object.fromEntries(
    SOURCES.map(s => [s.key, true])
  );

  let sublayerState: Record<string, Record<string, boolean>> = Object.fromEntries(
    SOURCES.map(s => [
      s.key,
      Object.fromEntries(s.sublayers.map(sub => [sub.id, sub.defaultOn])),
    ])
  );

  let prevVisible: Record<string, boolean> = {};
  let prevPaneVisible: Record<PaneId, Record<string, boolean>> = { left: {}, right: {} };

  let popupItems: MassartItem[] = [];
  let popupIdx = 0;
  let popupX = 0;
  let popupY = 0;

  $: massartByYear = massartItems.reduce<Map<number, MassartItem[]>>((acc, item) => {
    const y = parseInt(item.year ?? '0', 10);
    if (y > 1000) {
      const arr = acc.get(y) ?? [];
      arr.push(item);
      acc.set(y, arr);
    }
    return acc;
  }, new Map());

  // Hardcoded stable axis bounds:
  // historical map eras start at 1700; current Massart dataset spans 1904-1912.
  // We keep the decade-padded range fixed to avoid runtime layout churn.
  const axisStart = TIMELINE_AXIS_START;
  const axisEnd = TIMELINE_AXIS_END;
  const axisSpan = axisEnd - axisStart;

  type TickKind = 'century' | 'decade';

  function buildTicks(start: number, end: number): { year: number; kind: TickKind }[] {
    const result: { year: number; kind: TickKind }[] = [];
    for (let y = Math.ceil(start / 10) * 10; y <= end; y += 10) {
      result.push({ year: y, kind: y % 100 === 0 ? 'century' : 'decade' });
    }
    return result;
  }

  $: ticks = buildTicks(axisStart, axisEnd);

  function pct(year: number, aStart: number, aSpan: number): string {
    return `${((year - aStart) / aSpan) * 100}%`;
  }

  function widthPct(start: number, end: number, aSpan: number): string {
    return `${((end - start) / aSpan) * 100}%`;
  }

  function paneSourcesForYear(year: number): SourceDef[] {
    return SOURCES.filter(
      s => year >= s.start - halfKnobYears && year <= s.end + halfKnobYears
    );
  }

  function setPaneYear(pane: PaneId, year: number, emit = true) {
    if (pane === 'left') {
      localLeftYear = year;
    } else {
      localRightYear = year;
    }
    if (emit) dispatch('year-change', { pane, year });
  }

  function yearForPane(pane: PaneId): number {
    if (!dualPaneEnabled) return sliderYear;
    return pane === 'left' ? localLeftYear : localRightYear;
  }

  function scrubberPctForPane(pane: PaneId): number {
    return ((yearForPane(pane) - axisStart) / axisSpan) * 100;
  }

  function onSliderInput(pane: PaneId, e: Event) {
    const year = parseFloat((e.target as HTMLInputElement).value);
    if (!dualPaneEnabled) {
      sliderYear = year;
      dispatch('year-change', { pane: 'left', year });
      return;
    }
    setPaneYear(pane, year);
  }

  function isDotNear(yr: number): boolean {
    if (!dualPaneEnabled) return Math.abs(yr - sliderYear) <= yearLeeway;
    return visiblePanes.some((pane) => Math.abs(yr - pane.year) <= yearLeeway);
  }

  function openDotPopup(e: MouseEvent, items: MassartItem[]) {
    popupItems = items;
    popupIdx = 0;
    popupX = e.clientX;
    popupY = e.clientY;
    e.stopPropagation();
  }

  function closePopup() {
    popupItems = [];
  }

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

  function handleBlockClick(key: SourceKey) {
    const wasEnabled = enabledLayers[key];
    enabledLayers = { ...enabledLayers, [key]: !wasEnabled };
    const src = SOURCES.find(s => s.key === key)!;
    if (!wasEnabled) {
      if (dualPaneEnabled) {
        setPaneYear('left', src.repr);
      } else {
        sliderYear = src.repr;
        dispatch('year-change', { pane: 'left', year: sliderYear });
      }
    }
  }

  function toggleSublayer(key: SourceKey, subId: string, localId: string) {
    const cur = sublayerState[key]?.[localId] ?? false;
    sublayerState = {
      ...sublayerState,
      [key]: { ...sublayerState[key], [localId]: !cur },
    };
    const leftVisible = enabledLayers[key] && leftVisibleSourceKeys.has(key);
    if (leftVisible) dispatch('sublayerChange', { subId, enabled: !cur });
    if (leftVisible) dispatch('paneSublayerChange', { pane: 'left', subId, enabled: !cur });
    if (dualPaneEnabled) {
      const rightVisible = enabledLayers[key] && rightVisibleSourceKeys.has(key);
      if (rightVisible) dispatch('paneSublayerChange', { pane: 'right', subId, enabled: !cur });
    }
  }

  function sourceBlockStyle(src: SourceDef): string {
    return `left:${pct(src.start, axisStart, axisSpan)};width:${widthPct(src.start, src.end, axisSpan)};--c:${src.color};--accent:${sourceAccent[src.key]}`;
  }

  function sourceIsCurrentForKey(key: SourceKey): boolean {
    return enabledLayers[key] && activeSourceKeys.has(key);
  }

  function sourceHasOverlap(key: SourceKey): boolean {
    return activePanesBySource[key].length > 1;
  }

  onMount(() => {
    for (const src of SOURCES) {
      const visible = enabledLayers[src.key] && leftVisibleSourceKeys.has(src.key);
      prevVisible[src.key] = visible;
      dispatch('mainToggle', { mainId: src.mainId, enabled: visible });
      prevPaneVisible.left[src.key] = visible;
      dispatch('paneMainToggle', { pane: 'left', mainId: src.mainId, enabled: visible });
      if (visible) {
        for (const sub of src.sublayers) {
          if (sublayerState[src.key]?.[sub.id]) {
            dispatch('sublayerChange', { subId: sub.subId, enabled: true });
            dispatch('paneSublayerChange', { pane: 'left', subId: sub.subId, enabled: true });
          }
        }
      }
      if (dualPaneEnabled) {
        const rightVisible = enabledLayers[src.key] && rightVisibleSourceKeys.has(src.key);
        prevPaneVisible.right[src.key] = rightVisible;
        dispatch('paneMainToggle', { pane: 'right', mainId: src.mainId, enabled: rightVisible });
        if (rightVisible) {
          for (const sub of src.sublayers) {
            if (sublayerState[src.key]?.[sub.id]) {
              dispatch('paneSublayerChange', { pane: 'right', subId: sub.subId, enabled: true });
            }
          }
        }
      }
    }
  });

  $: halfKnobYears = trackWidth > 0 ? (9 / trackWidth) * axisSpan : 3;

  $: if (leftYear != null && leftYear !== lastLeftYearProp) {
    lastLeftYearProp = leftYear;
    if (dualPaneEnabled) {
      localLeftYear = leftYear;
    } else {
      sliderYear = leftYear;
    }
  }

  $: if (rightYear != null && rightYear !== lastRightYearProp) {
    lastRightYearProp = rightYear;
    localRightYear = rightYear;
  }

  $: if (dualPaneEnabled !== dualPaneModePrev) {
    if (dualPaneEnabled) {
      if (!dualPaneYearsInitialized) {
        localLeftYear = sliderYear;
        localRightYear = rightYear ?? sliderYear;
        dualPaneYearsInitialized = true;
      }
    } else {
      sliderYear = localLeftYear;
    }
    dualPaneModePrev = dualPaneEnabled;
  }

  $: visiblePanes = (dualPaneEnabled
    ? [
        { id: 'left', year: localLeftYear, label: PANE_META.left.label, color: PANE_META.left.color },
        { id: 'right', year: localRightYear, label: PANE_META.right.label, color: PANE_META.right.color },
      ]
    : []) as PaneState[];

  $: leftPanelSources = paneSourcesForYear(localLeftYear);
  $: rightPanelSources = dualPaneEnabled ? paneSourcesForYear(localRightYear) : [];
  $: leftVisibleSourceKeys = new Set<SourceKey>((dualPaneEnabled ? leftPanelSources : paneSourcesForYear(sliderYear)).map((s) => s.key));
  $: rightVisibleSourceKeys = new Set<SourceKey>(rightPanelSources.map((s) => s.key));
  $: activeSourceKeys = dualPaneEnabled
    ? new Set<SourceKey>([...leftPanelSources, ...rightPanelSources].map((s) => s.key))
    : new Set<SourceKey>(paneSourcesForYear(sliderYear).map((s) => s.key));

  $: singlePanelSources = paneSourcesForYear(sliderYear);
  $: row1 = SOURCES.filter(s => s.row === 1);
  $: row2 = SOURCES.filter(s => s.row === 2);

  $: activePanesBySource = SOURCES.reduce<Record<SourceKey, PaneState[]>>((acc, src) => {
    const panes: PaneState[] = [];
    if ((dualPaneEnabled ? leftPanelSources : paneSourcesForYear(sliderYear)).some((s) => s.key === src.key)) {
      panes.push({ id: 'left', year: localLeftYear, label: PANE_META.left.label, color: PANE_META.left.color });
    }
    if (dualPaneEnabled && rightPanelSources.some((s) => s.key === src.key)) {
      panes.push({ id: 'right', year: localRightYear, label: PANE_META.right.label, color: PANE_META.right.color });
    }
    acc[src.key] = panes;
    return acc;
  }, {} as Record<SourceKey, PaneState[]>);

  $: sourceAccent = SOURCES.reduce<Record<SourceKey, string>>((acc, src) => {
    const panes = activePanesBySource[src.key];
    acc[src.key] = panes.length > 1
      ? `linear-gradient(90deg, ${panes[0].color} 0%, ${panes[0].color} 48%, ${panes[1].color} 52%, ${panes[1].color} 100%)`
      : panes[0]?.color ?? src.color;
    return acc;
  }, {} as Record<SourceKey, string>);

  $: {
    for (const src of SOURCES) {
      const nowVisible = enabledLayers[src.key] && leftVisibleSourceKeys.has(src.key);
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

      const leftPaneVisible = enabledLayers[src.key] && leftVisibleSourceKeys.has(src.key);
      if (prevPaneVisible.left[src.key] !== undefined && prevPaneVisible.left[src.key] !== leftPaneVisible) {
        dispatch('paneMainToggle', { pane: 'left', mainId: src.mainId, enabled: leftPaneVisible });
        if (!leftPaneVisible) {
          for (const sub of src.sublayers) {
            dispatch('paneSublayerChange', { pane: 'left', subId: sub.subId, enabled: false });
          }
        } else {
          for (const sub of src.sublayers) {
            dispatch('paneSublayerChange', {
              pane: 'left',
              subId: sub.subId,
              enabled: sublayerState[src.key]?.[sub.id] ?? sub.defaultOn,
            });
          }
        }
        prevPaneVisible.left[src.key] = leftPaneVisible;
      }

      const rightPaneVisible = dualPaneEnabled && enabledLayers[src.key] && rightVisibleSourceKeys.has(src.key);
      if (dualPaneEnabled && prevPaneVisible.right[src.key] !== undefined && prevPaneVisible.right[src.key] !== rightPaneVisible) {
        dispatch('paneMainToggle', { pane: 'right', mainId: src.mainId, enabled: rightPaneVisible });
        if (!rightPaneVisible) {
          for (const sub of src.sublayers) {
            dispatch('paneSublayerChange', { pane: 'right', subId: sub.subId, enabled: false });
          }
        } else {
          for (const sub of src.sublayers) {
            dispatch('paneSublayerChange', {
              pane: 'right',
              subId: sub.subId,
              enabled: sublayerState[src.key]?.[sub.id] ?? sub.defaultOn,
            });
          }
        }
        prevPaneVisible.right[src.key] = rightPaneVisible;
      }
      if (!dualPaneEnabled) {
        prevPaneVisible.right[src.key] = false;
      }
    }
  }
</script>

{#if dualPaneEnabled}
  {#if leftPanelSources.length > 0}
    <div class="ts-sub-panel ts-sub-panel--left" transition:fade={{ duration: 140 }}>
      {#each leftPanelSources as src}
        <section class="sub-menu" class:is-layer-disabled={!enabledLayers[src.key]}>
          <div class="sub-menu-header">
            <span class="sub-menu-swatch" style="--c:{src.color}"></span>
            <span class="sub-menu-title">{src.label}</span>
          </div>
          <div class="sub-menu-pills">
            {#each src.sublayers as sub}
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

  {#if rightPanelSources.length > 0}
    <div class="ts-sub-panel ts-sub-panel--right" transition:fade={{ duration: 140 }}>
      {#each rightPanelSources as src}
        <section class="sub-menu" class:is-layer-disabled={!enabledLayers[src.key]}>
          <div class="sub-menu-header">
            <span class="sub-menu-swatch" style="--c:{src.color}"></span>
            <span class="sub-menu-title">{src.label}</span>
          </div>
          <div class="sub-menu-pills">
            {#each src.sublayers as sub}
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
{:else if singlePanelSources.length > 0}
  <div class="ts-sub-panel ts-sub-panel--left" transition:fade={{ duration: 140 }}>
    {#each singlePanelSources as src}
      <section class="sub-menu" class:is-layer-disabled={!enabledLayers[src.key]}>
        <div class="sub-menu-header">
          <span class="sub-menu-swatch" style="--c:{src.color}"></span>
          <span class="sub-menu-title">{src.label}</span>
        </div>
        <div class="sub-menu-pills">
          {#each src.sublayers as sub}
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

{#if popupItems.length > 0}
  {@const item = popupItems[popupIdx]}
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

<div class="timeslider">
  <div class="ts-track" bind:clientWidth={trackWidth}>
    <div class="ts-row ts-row--above">
      {#each row1 as src}
        {@const enabled = enabledLayers[src.key]}
        <div
          class="source-block"
          class:is-disabled={!enabled}
          class:is-current={sourceIsCurrentForKey(src.key)}
          class:is-compare-overlap={sourceHasOverlap(src.key)}
          class:is-loading={loadingLayers[src.mainId]}
          style={sourceBlockStyle(src)}
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

    <div class="ts-axis-line">
      {#if dualPaneEnabled}
        {#each visiblePanes as pane}
          <span
            class="scrubber-label"
            class:scrubber-label--right={pane.id === 'right'}
            style="left:{scrubberPctForPane(pane.id)}%;--pane-color:{pane.color}"
            aria-hidden="true"
          >{pane.label} {Math.round(pane.year)}</span>
        {/each}
      {:else}
        <span
          class="scrubber-label"
          style="left:{((sliderYear - axisStart) / axisSpan) * 100}%;--pane-color:{PANE_META.left.color}"
          aria-hidden="true"
        >{Math.round(sliderYear)}</span>
      {/if}

      {#each ticks as tick}
        <span class="ts-tick ts-tick--{tick.kind}" style="left:{pct(tick.year,axisStart,axisSpan)}">
          <span class="ts-tick-label">{tick.year}</span>
        </span>
      {/each}

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

      {#if dualPaneEnabled}
        {#each visiblePanes as pane}
          <input
            class="ts-scrubber"
            class:ts-scrubber--right={pane.id === 'right'}
            style="--pane-color:{pane.color}"
            type="range"
            min={axisStart}
            max={axisEnd}
            step="1"
            value={yearForPane(pane.id)}
            on:input={(e) => onSliderInput(pane.id, e)}
            aria-label="{pane.label} timeline year"
          />
        {/each}
      {:else}
        <input
          class="ts-scrubber"
          style="--pane-color:{PANE_META.left.color}"
          type="range"
          min={axisStart}
          max={axisEnd}
          step="1"
          value={sliderYear}
          on:input={(e) => onSliderInput('left', e)}
          aria-label="Timeline year"
        />
      {/if}
    </div>

    <div class="ts-row ts-row--below">
      {#each row2 as src}
        {@const enabled = enabledLayers[src.key]}
        <div
          class="source-block"
          class:is-disabled={!enabled}
          class:is-current={sourceIsCurrentForKey(src.key)}
          class:is-compare-overlap={sourceHasOverlap(src.key)}
          class:is-loading={loadingLayers[src.mainId]}
          style={sourceBlockStyle(src)}
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
  </div>
</div>

<style>
  .ts-sub-panel {
    position: fixed;
    top: 12px;
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

  .ts-sub-panel--left {
    left: 12px;
  }

  .ts-sub-panel--right {
    right: 12px;
  }

  .sub-menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 180px;
    padding: 10px;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: var(--radius-md);
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

  .timeslider {
    background: #ffffff;
    border: 0.5px solid rgba(0,0,0,0.1);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    user-select: none;
    font-family: var(--font-ui);
    box-shadow: var(--shadow-md);
    pointer-events: auto;
  }

  .ts-track {
    display: flex;
    flex-direction: column;
  }

  .ts-row {
    position: relative;
    overflow: visible;
  }

  .ts-row--above { height: 39px; }
  .ts-row--below { height: 39px; }

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
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .source-block:hover:not(.is-disabled) {
    filter: brightness(1.09);
  }

  .source-block.is-current {
    z-index: 3;
  }

  .source-block.is-compare-overlap {
    background: var(--accent);
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

  .ts-axis-line {
    position: relative;
    height: 6px;
    background: linear-gradient(90deg, rgba(0,0,0,0.12), rgba(0,0,0,0.18));
    border-radius: var(--radius-pill);
    z-index: 8;
    overflow: visible;
    pointer-events: none;
  }

  .scrubber-label {
    position: absolute;
    bottom: calc(100% + 43px);
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--pane-color);
    background: #ffffff;
    border: 1px solid color-mix(in srgb, var(--pane-color) 38%, white);
    border-radius: var(--radius-xs);
    padding: 3px 8px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 12;
    box-shadow: var(--shadow-md);
  }

  .scrubber-label--right {
    bottom: calc(100% + 70px);
  }

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
    pointer-events: none;
  }

  .ts-scrubber--right {
    z-index: 10;
  }

  .ts-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #f4f0e8);
    border: 2px solid color-mix(in srgb, var(--pane-color) 72%, white);
    cursor: ew-resize;
    box-shadow: var(--shadow-card);
    pointer-events: auto;
  }

  .ts-scrubber::-moz-range-thumb {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #f4f0e8);
    border: 2px solid color-mix(in srgb, var(--pane-color) 72%, white);
    cursor: ew-resize;
    box-shadow: var(--shadow-card);
    pointer-events: auto;
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

  .img-dot--multi {
    width: 9px;
    height: 9px;
    box-shadow: 0 0 0 2px rgba(212, 168, 75, 0.4);
  }

  .img-dot--near {
    background: #f59e0b;
    transform: translate(-50%, -50%) scale(1.4);
    box-shadow: 0 0 0 2.5px rgba(245, 158, 11, 0.35);
  }

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

  .ts-tick--decade::before { height: 8px; background: rgba(0,0,0,0.22); }
  .ts-tick--century::before { height: 18px; background: rgba(0,0,0,0.55); }

  .ts-tick-label {
    font-family: var(--font-mono);
    font-size: 9px;
    color: rgba(0,0,0,0.38);
    margin-top: 2px;
    white-space: nowrap;
  }

  .ts-tick--century .ts-tick-label {
    color: rgba(0,0,0,0.65);
    font-weight: 600;
  }
</style>
