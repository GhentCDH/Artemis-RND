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
  export let showLeftPaneControls = true;
  export let showRightPaneControls = true;
  export let disabledPane: PaneId | null = null;
  export let leftYear: number | undefined = undefined;
  export let rightYear: number | undefined = undefined;

  const PANE_META: Record<PaneId, { label: string; color: string; badgeBg: string; badgeText: string; panelTint: string }> = {
    left: {
      label: 'Left',
      color: 'var(--pane-left-color)',
      badgeBg: 'var(--pane-left-badge-bg)',
      badgeText: 'var(--pane-left-badge-text)',
      panelTint: 'var(--pane-left-panel-tint)',
    },
    right: {
      label: 'Right',
      color: 'var(--pane-right-color)',
      badgeBg: 'var(--pane-right-badge-bg)',
      badgeText: 'var(--pane-right-badge-text)',
      panelTint: 'var(--pane-right-panel-tint)',
    },
  };

  const dispatch = createEventDispatcher<{
    mainToggle:     { mainId: string; enabled: boolean };
    sublayerChange: { subId: string; enabled: boolean };
    paneMainToggle: { pane: PaneId; mainId: string; enabled: boolean };
    paneSublayerChange: { pane: PaneId; subId: string; enabled: boolean };
    'open-viewer':  { title: string; sourceManifestUrl: string; imageServiceUrl: string };
    'focus-image':  { pane: PaneId; title: string; lon: number; lat: number };
    'year-change':  { pane: PaneId; year: number };
  }>();

  const SOURCES = [
    {
      key: 'hand', mainId: 'handdrawn', label: 'Hand drawn',
      start: 1700, end: 1715, repr: 1707, color: 'var(--layer-hand-color)', row: 1,
      sublayers: [
        { id: 'iiif', subId: 'handdrawn-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'handdrawn-parcels', label: 'Parcels', defaultOn: false },
        { id: 'water', subId: 'handdrawn-water', label: 'Water infrastructure', defaultOn: false },
      ],
    },
    {
      key: 'ferraris', mainId: 'ferraris', label: 'Ferraris',
      start: 1770, end: 1778, repr: 1774, color: 'var(--layer-ferraris-color)', row: 1,
      sublayers: [
        { id: 'wmts', subId: 'ferraris-wmts', label: 'Map', defaultOn: true },
        { id: 'landuse', subId: 'ferraris-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'primitief', mainId: 'primitief', label: 'Primitief Kadaster',
      start: 1808, end: 1834, repr: 1814, color: 'var(--layer-primitief-color)', row: 2,
      sublayers: [
        { id: 'iiif', subId: 'primitief-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'primitief-parcels', label: 'Parcels', defaultOn: false },
        { id: 'landuse', subId: 'primitief-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'vander', mainId: 'vandermaelen', label: 'Vandermaelen',
      start: 1846, end: 1854, repr: 1850, color: 'var(--layer-vander-color)', row: 2,
      sublayers: [
        { id: 'wmts', subId: 'vandermaelen-wmts', label: 'Map', defaultOn: true },
        { id: 'landuse', subId: 'vandermaelen-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'gereduceerd', label: 'Gereduceerd Kadaster',
      start: 1847, end: 1855, repr: 1851, color: 'var(--layer-gereduceerd-color)', row: 1,
      sublayers: [
        { id: 'iiif', subId: 'gereduceerd-iiif', label: 'Map', defaultOn: true },
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
  const SCRUBBER_THUMB_SIZE = 28;

  const defaultYear = 1774;

  let sliderYear = defaultYear;
  let trackWidth = 0;
  let localLeftYear = defaultYear;
  let localRightYear = defaultYear;
  let lastLeftYearProp: number | undefined = undefined;
  let lastRightYearProp: number | undefined = undefined;
  let dualPaneModePrev = dualPaneEnabled;
  let dualPaneYearsInitialized = dualPaneEnabled;

  let leftEnabledLayers: Record<string, boolean> = Object.fromEntries(
    SOURCES.map(s => [s.key, true])
  );

  let rightEnabledLayers: Record<string, boolean> = Object.fromEntries(
    SOURCES.map(s => [s.key, true])
  );

  let leftSublayerState: Record<string, Record<string, boolean>> = Object.fromEntries(
    SOURCES.map(s => [
      s.key,
      Object.fromEntries(s.sublayers.map(sub => [sub.id, sub.defaultOn])),
    ])
  );

  let rightSublayerState: Record<string, Record<string, boolean>> = Object.fromEntries(
    SOURCES.map(s => [
      s.key,
      Object.fromEntries(s.sublayers.map(sub => [sub.id, sub.defaultOn])),
    ])
  );

  let prevVisible: Record<string, boolean> = {};
  let prevPaneVisible: Record<PaneId, Record<string, boolean>> = { left: {}, right: {} };

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

  function scrubberCenterPx(year: number): number {
    if (trackWidth <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (year - axisStart) / axisSpan));
    const usableWidth = Math.max(0, trackWidth - SCRUBBER_THUMB_SIZE);
    return ratio * usableWidth + SCRUBBER_THUMB_SIZE / 2;
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

  function setSingleYear(year: number) {
    sliderYear = year;
    dispatch('year-change', { pane: 'left', year });
  }

  function yearFromTrackClientX(clientX: number, rect: DOMRect): number {
    const usableWidth = Math.max(1, rect.width - SCRUBBER_THUMB_SIZE);
    const offsetX = Math.max(0, Math.min(usableWidth, clientX - rect.left - SCRUBBER_THUMB_SIZE / 2));
    const ratio = offsetX / usableWidth;
    return Math.round(axisStart + ratio * axisSpan);
  }

  function closestPaneForTrackYear(year: number): PaneId {
    const candidates: PaneId[] = dualPaneEnabled
      ? (['left', 'right'] as PaneId[]).filter((pane) => disabledPane !== pane)
      : ['left'];

    if (candidates.length === 0) return 'left';
    if (candidates.length === 1) return candidates[0];

    const leftDistance = Math.abs(yearForPane('left') - year);
    const rightDistance = Math.abs(yearForPane('right') - year);
    return rightDistance <= leftDistance ? 'right' : 'left';
  }

  function jumpToYear(year: number): PaneId {
    if (!dualPaneEnabled) {
      setSingleYear(year);
      return 'left';
    }

    const pane = closestPaneForTrackYear(year);
    setPaneYear(pane, year);
    return pane;
  }

  function onTrackClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.img-dot, .ts-scrubber, .sub-menu, .sub-menu-header--toggle, .sub-pill, .sub-menu-checkbox-input')) return;

    const trackEl = (e.currentTarget as HTMLElement).closest('.ts-track') as HTMLElement | null;
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const nextYear = yearFromTrackClientX(e.clientX, rect);
    jumpToYear(nextYear);
  }

  function isDotNear(yr: number): boolean {
    if (!dualPaneEnabled) return Math.abs(yr - sliderYear) <= yearLeeway;
    return visiblePanes.some((pane) => Math.abs(yr - pane.year) <= yearLeeway);
  }

  function focusDot(items: MassartItem[], pane: PaneId = 'left') {
    const firstItem = items[0];
    if (firstItem && Number.isFinite(firstItem.lon) && Number.isFinite(firstItem.lat)) {
      dispatch('focus-image', {
        pane,
        title: firstItem.title,
        lon: Number(firstItem.lon),
        lat: Number(firstItem.lat),
      });
    }
  }

  function onPhotoDotClick(year: number, items: MassartItem[]) {
    const pane = jumpToYear(year);
    focusDot(items, pane);
  }

  function toggleLayerEnabled(pane: PaneId, key: SourceKey) {
    if (pane === 'right') {
      const wasEnabled = rightEnabledLayers[key];
      rightEnabledLayers = { ...rightEnabledLayers, [key]: !wasEnabled };
      return;
    }
    const wasEnabled = leftEnabledLayers[key];
    leftEnabledLayers = { ...leftEnabledLayers, [key]: !wasEnabled };
  }

  function paneSublayerState(pane: PaneId): Record<string, Record<string, boolean>> {
    return pane === 'right' ? rightSublayerState : leftSublayerState;
  }

  function isSublayerEnabled(pane: PaneId, key: SourceKey, localId: string): boolean {
    return paneSublayerState(pane)[key]?.[localId] ?? false;
  }

  function toggleSublayer(pane: PaneId, key: SourceKey, subId: string, localId: string) {
    const cur = isSublayerEnabled(pane, key, localId);
    if (pane === 'right') {
      rightSublayerState = {
        ...rightSublayerState,
        [key]: { ...rightSublayerState[key], [localId]: !cur },
      };
      const rightVisible = rightEnabledLayers[key] && rightVisibleSourceKeys.has(key);
      if (rightVisible) dispatch('paneSublayerChange', { pane: 'right', subId, enabled: !cur });
      return;
    }

    leftSublayerState = {
      ...leftSublayerState,
      [key]: { ...leftSublayerState[key], [localId]: !cur },
    };
    const leftVisible = leftEnabledLayers[key] && leftVisibleSourceKeys.has(key);
    if (leftVisible) dispatch('sublayerChange', { subId, enabled: !cur });
    if (leftVisible) dispatch('paneSublayerChange', { pane: 'left', subId, enabled: !cur });
  }

  function sourcePattern(key: SourceKey): string {
    if (key === 'hand') {
      return 'linear-gradient(135deg, rgba(255,255,255,0.22) 0 8%, transparent 8% 50%, rgba(255,255,255,0.18) 50% 58%, transparent 58% 100%)';
    }
    if (key === 'ferraris') {
      return 'repeating-linear-gradient(90deg, rgba(255,255,255,0.2) 0 2px, transparent 2px 14px), repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 12px)';
    }
    if (key === 'primitief') {
      return 'radial-gradient(circle at 25% 35%, rgba(255,255,255,0.2) 0 2px, transparent 2.5px), radial-gradient(circle at 72% 68%, rgba(255,255,255,0.16) 0 2px, transparent 2.5px), linear-gradient(145deg, transparent 0 44%, rgba(255,255,255,0.14) 44% 49%, transparent 49% 100%)';
    }
    if (key === 'vander') {
      return 'repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 2px, transparent 2px 12px), repeating-linear-gradient(45deg, rgba(255,255,255,0.1) 0 1px, transparent 1px 16px)';
    }
    return 'radial-gradient(circle at center, rgba(255,255,255,0.18) 0 2px, transparent 2.5px), radial-gradient(circle at center, rgba(255,255,255,0.12) 0 1px, transparent 1.5px)';
  }

  function sourcePatternSize(key: SourceKey): string {
    if (key === 'hand') return '22px 22px';
    if (key === 'ferraris') return '18px 18px, 18px 18px';
    if (key === 'primitief') return '28px 28px, 28px 28px, 24px 24px';
    if (key === 'vander') return '16px 16px, 24px 24px';
    return '18px 18px, 9px 9px';
  }

  function sourceBlockStyle(src: SourceDef): string {
    return `left:${pct(src.start, axisStart, axisSpan)};width:${widthPct(src.start, src.end, axisSpan)};--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)}`;
  }

  function sourceMenuStyle(src: SourceDef): string {
    return `--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)}`;
  }

  function sourceIsCurrentForKey(key: SourceKey): boolean {
    if (!activeSourceKeys.has(key)) return false;
    if (!dualPaneEnabled) return leftEnabledLayers[key];
    return leftEnabledLayers[key] || rightEnabledLayers[key];
  }

  function sourceHasOverlap(key: SourceKey): boolean {
    return activePanesBySource[key].length > 1;
  }

  onMount(() => {
    for (const src of SOURCES) {
      const visible = leftEnabledLayers[src.key] && leftVisibleSourceKeys.has(src.key);
      prevVisible[src.key] = visible;
      dispatch('mainToggle', { mainId: src.mainId, enabled: visible });
      prevPaneVisible.left[src.key] = visible;
      dispatch('paneMainToggle', { pane: 'left', mainId: src.mainId, enabled: visible });
      if (visible) {
        for (const sub of src.sublayers) {
          if (leftSublayerState[src.key]?.[sub.id]) {
            dispatch('sublayerChange', { subId: sub.subId, enabled: true });
            dispatch('paneSublayerChange', { pane: 'left', subId: sub.subId, enabled: true });
          }
        }
      }
      if (dualPaneEnabled) {
        const rightVisible = rightEnabledLayers[src.key] && rightVisibleSourceKeys.has(src.key);
        prevPaneVisible.right[src.key] = rightVisible;
        dispatch('paneMainToggle', { pane: 'right', mainId: src.mainId, enabled: rightVisible });
        if (rightVisible) {
          for (const sub of src.sublayers) {
            if (rightSublayerState[src.key]?.[sub.id]) {
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

  $: singlePanelSources = paneSourcesForYear(sliderYear);
  $: leftPanelSources = paneSourcesForYear(localLeftYear);
  $: rightPanelSources = dualPaneEnabled ? paneSourcesForYear(localRightYear) : [];
  $: leftVisibleSourceKeys = new Set<SourceKey>((dualPaneEnabled ? leftPanelSources : singlePanelSources).map((s) => s.key));
  $: rightVisibleSourceKeys = new Set<SourceKey>(rightPanelSources.map((s) => s.key));
  $: activeSourceKeys = dualPaneEnabled
    ? new Set<SourceKey>([...leftPanelSources, ...rightPanelSources].map((s) => s.key))
    : new Set<SourceKey>(singlePanelSources.map((s) => s.key));
  $: leftActiveVisibility = SOURCES.reduce<Record<SourceKey, boolean>>((acc, src) => {
    acc[src.key] = Boolean(leftEnabledLayers[src.key] && leftVisibleSourceKeys.has(src.key));
    return acc;
  }, {} as Record<SourceKey, boolean>);
  $: rightActiveVisibility = SOURCES.reduce<Record<SourceKey, boolean>>((acc, src) => {
    acc[src.key] = Boolean(dualPaneEnabled && rightEnabledLayers[src.key] && rightVisibleSourceKeys.has(src.key));
    return acc;
  }, {} as Record<SourceKey, boolean>);

  $: row1 = SOURCES.filter(s => s.row === 1);
  $: row2 = SOURCES.filter(s => s.row === 2);

  $: activePanesBySource = SOURCES.reduce<Record<SourceKey, PaneState[]>>((acc, src) => {
    const panes: PaneState[] = [];
    if ((dualPaneEnabled ? leftPanelSources : singlePanelSources).some((s) => s.key === src.key)) {
      panes.push({ id: 'left', year: localLeftYear, label: PANE_META.left.label, color: PANE_META.left.color });
    }
    if (dualPaneEnabled && rightPanelSources.some((s) => s.key === src.key)) {
      panes.push({ id: 'right', year: localRightYear, label: PANE_META.right.label, color: PANE_META.right.color });
    }
    acc[src.key] = panes;
    return acc;
  }, {} as Record<SourceKey, PaneState[]>);

  $: {
    for (const src of SOURCES) {
      const nowVisible = leftActiveVisibility[src.key];
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
              enabled: leftSublayerState[src.key]?.[sub.id] ?? sub.defaultOn,
            });
          }
        }
        prevVisible[src.key] = nowVisible;
      }

      const leftPaneVisible = leftActiveVisibility[src.key];
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
              enabled: leftSublayerState[src.key]?.[sub.id] ?? sub.defaultOn,
            });
          }
        }
        prevPaneVisible.left[src.key] = leftPaneVisible;
      }

      const rightPaneVisible = rightActiveVisibility[src.key];
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
              enabled: rightSublayerState[src.key]?.[sub.id] ?? sub.defaultOn,
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
  {#if showLeftPaneControls && leftPanelSources.length > 0}
    <div class="ts-sub-panel ts-sub-panel--left" transition:fade={{ duration: 140 }}>
      {#each leftPanelSources as src}
        <section class="sub-menu" class:is-layer-disabled={!leftEnabledLayers[src.key]} style={sourceMenuStyle(src)}>
          <label
            class="sub-menu-header sub-menu-header--toggle"
            class:is-disabled={!leftEnabledLayers[src.key]}
            title="{src.label} — global visibility"
          >
            <span class="sub-menu-swatch" style="--c:{src.color}"></span>
            <span class="sub-menu-title">{src.label}</span>
            <input
              class="sub-menu-checkbox-input"
              type="checkbox"
              checked={leftEnabledLayers[src.key]}
              aria-label="{src.label} layer visible in left pane"
              on:change={() => toggleLayerEnabled('left', src.key)}
            />
          </label>
          <div class="sub-menu-pills">
            {#each src.sublayers as sub}
              <button
                class="sub-pill"
                class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)}
                class:is-layer-disabled={!leftEnabledLayers[src.key]}
                style="--c:{src.color}"
                type="button"
                title="{src.label} — {sub.label}"
                on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}
              >{sub.label}</button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}

  {#if showRightPaneControls && rightPanelSources.length > 0}
    <div class="ts-sub-panel ts-sub-panel--right" transition:fade={{ duration: 140 }}>
      {#each rightPanelSources as src}
        <section class="sub-menu" class:is-layer-disabled={!rightEnabledLayers[src.key]} style={sourceMenuStyle(src)}>
          <label
            class="sub-menu-header sub-menu-header--toggle"
            class:is-disabled={!rightEnabledLayers[src.key]}
            title="{src.label} — global visibility"
          >
            <span class="sub-menu-swatch" style="--c:{src.color}"></span>
            <span class="sub-menu-title">{src.label}</span>
            <input
              class="sub-menu-checkbox-input"
              type="checkbox"
              checked={rightEnabledLayers[src.key]}
              aria-label="{src.label} layer visible in right pane"
              on:change={() => toggleLayerEnabled('right', src.key)}
            />
          </label>
          <div class="sub-menu-pills">
            {#each src.sublayers as sub}
              <button
                class="sub-pill"
                class:is-disabled={!isSublayerEnabled('right', src.key, sub.id)}
                class:is-layer-disabled={!rightEnabledLayers[src.key]}
                style="--c:{src.color}"
                type="button"
                title="{src.label} — {sub.label}"
                on:click={() => toggleSublayer('right', src.key, sub.subId, sub.id)}
              >{sub.label}</button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
{:else if showLeftPaneControls && singlePanelSources.length > 0}
  <div class="ts-sub-panel ts-sub-panel--left" transition:fade={{ duration: 140 }}>
    {#each singlePanelSources as src}
      <section class="sub-menu" class:is-layer-disabled={!leftEnabledLayers[src.key]} style={sourceMenuStyle(src)}>
        <label
          class="sub-menu-header sub-menu-header--toggle"
          class:is-disabled={!leftEnabledLayers[src.key]}
          title="{src.label} — global visibility"
        >
          <span class="sub-menu-swatch" style="--c:{src.color}"></span>
          <span class="sub-menu-title">{src.label}</span>
          <input
            class="sub-menu-checkbox-input"
            type="checkbox"
            checked={leftEnabledLayers[src.key]}
            aria-label="{src.label} layer visible"
            on:change={() => toggleLayerEnabled('left', src.key)}
          />
        </label>
        <div class="sub-menu-pills">
          {#each src.sublayers as sub}
            <button
              class="sub-pill"
              class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)}
              class:is-layer-disabled={!leftEnabledLayers[src.key]}
              style="--c:{src.color}"
              type="button"
              title="{src.label} — {sub.label}"
              on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}
            >{sub.label}</button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<div class="timeslider">
  <div class="ts-track" bind:clientWidth={trackWidth}>
    <button
      class="ts-track-hitarea"
      type="button"
      aria-label={dualPaneEnabled ? 'Jump nearest compare timeline thumb' : 'Jump timeline thumb'}
      on:click={onTrackClick}
    ></button>
    <div class="ts-row ts-row--above">
      {#each row1 as src}
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        <div
          class="source-block"
          class:is-disabled={!enabled}
          class:is-current={sourceIsCurrentForKey(src.key)}
          class:is-compare-overlap={sourceHasOverlap(src.key)}
          class:is-loading={loadingLayers[src.mainId]}
          style={sourceBlockStyle(src)}
          title={`${src.label} (${src.start}–${src.end})`}
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
            class:is-disabled={disabledPane === pane.id}
            style="left:{scrubberCenterPx(yearForPane(pane.id))}px;--pane-color:{pane.color};--pane-badge-bg:{PANE_META[pane.id].badgeBg};--pane-badge-text:{PANE_META[pane.id].badgeText}"
            aria-hidden="true"
          >{pane.label} · {Math.round(pane.year)}</span>
        {/each}
      {:else}
        <span
          class="scrubber-label scrubber-label--single"
          style="left:{scrubberCenterPx(sliderYear)}px"
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
          on:click={() => onPhotoDotClick(yr, items)}
        ></button>
      {/each}

      {#if dualPaneEnabled}
        {#each visiblePanes as pane}
          <input
            class="ts-scrubber"
            class:ts-scrubber--right={pane.id === 'right'}
            class:is-disabled={disabledPane === pane.id}
            style="--pane-color:{pane.color}"
            type="range"
            min={axisStart}
            max={axisEnd}
            step="1"
            value={yearForPane(pane.id)}
            disabled={disabledPane === pane.id}
            on:input={(e) => onSliderInput(pane.id, e)}
            aria-label="{pane.label} timeline year"
          />
        {/each}
      {:else}
        <input
          class="ts-scrubber ts-scrubber--single"
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
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        <div
          class="source-block"
          class:is-disabled={!enabled}
          class:is-current={sourceIsCurrentForKey(src.key)}
          class:is-compare-overlap={sourceHasOverlap(src.key)}
          class:is-loading={loadingLayers[src.mainId]}
          style={sourceBlockStyle(src)}
          title={`${src.label} (${src.start}–${src.end})`}
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
    background: var(--surface-floating);
    border: 0.5px solid var(--surface-outline-soft);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    pointer-events: all;
  }

  .ts-sub-panel--left {
    left: 12px;
    --pane-border: var(--pane-left-color);
    --pane-header-tint: var(--pane-left-panel-tint);
  }

  .ts-sub-panel--right {
    right: 12px;
    --pane-border: var(--pane-right-color);
    --pane-header-tint: var(--pane-right-panel-tint);
  }

  .sub-menu {
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

  .sub-menu-header--toggle {
    width: calc(100% + 20px);
    border: none;
    cursor: pointer;
    text-align: left;
    box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--sub-menu-border) 80%, transparent);
    transition: filter 160ms ease, box-shadow 160ms ease;
  }

  .sub-menu-header--toggle:hover,
  .sub-menu-header--toggle:focus-visible {
    filter: brightness(1.03);
    box-shadow:
      inset 0 -1px 0 color-mix(in srgb, var(--sub-menu-border) 80%, transparent),
      inset 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 80%, transparent);
  }

  .sub-menu-header--toggle:focus-visible {
    outline: 2px solid var(--surface-focus);
    outline-offset: 2px;
  }

  .sub-menu-header--toggle.is-disabled {
    filter: saturate(0.78) brightness(0.95);
  }

  .sub-menu-header::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      var(--sub-menu-header-overlay),
      var(--pattern);
    background-size: auto, var(--pattern-size);
    background-position: center, center;
    opacity: 0.9;
    pointer-events: none;
  }

  .sub-menu-swatch,
  .sub-menu-title,
  .sub-menu-checkbox-input {
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
    flex: 1 1 auto;
  }

  .sub-menu-checkbox-input {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1.5px solid color-mix(in srgb, var(--text-secondary) 36%, transparent);
    background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--surface-inset-strong) 70%, transparent),
      0 1px 2px rgba(0, 0, 0, 0.08);
    flex: 0 0 auto;
    cursor: pointer;
  }

  .sub-menu-checkbox-input:checked {
    border-color: color-mix(in srgb, var(--c) 72%, white);
    background: var(--c);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 32%, transparent),
      0 2px 6px rgba(0, 0, 0, 0.12);
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

  .sub-menu-checkbox-input:focus-visible {
    outline: 2px solid var(--surface-focus);
    outline-offset: 2px;
  }

  .sub-menu-header--toggle.is-disabled .sub-menu-checkbox-input {
    opacity: 0.9;
  }

  .sub-menu-pills {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sub-menu-disabled-note {
    margin-top: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-xs);
    background: var(--surface-muted);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.35;
    box-shadow: inset 0 0 0 1px var(--sub-menu-note-inset);
  }

  .sub-pill {
    position: relative;
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
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 80%, transparent) inset,
      0 4px 10px rgba(0, 0, 0, 0.10);
    overflow: hidden;
    transition: opacity 200ms ease, filter 200ms ease, box-shadow 200ms ease;
  }

  .sub-pill.is-disabled {
    opacity: 0.7;
    filter: saturate(0.72) brightness(0.96);
    box-shadow:
      0 0 0 1.5px var(--surface-outline),
      var(--shadow-sm);
    cursor: pointer;
  }

  .sub-pill.is-layer-disabled {
    opacity: 0.72;
    filter: saturate(0.76) brightness(0.96);
    box-shadow:
      0 0 0 1.5px var(--surface-outline),
      var(--shadow-sm);
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
    box-shadow:
      0 0 0 2px var(--pill-disabled-hover-inset) inset,
      var(--shadow-md);
  }

  .timeslider {
    background: var(--timeline-panel-bg);
    border: 0.5px solid var(--panel-border);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    user-select: none;
    font-family: var(--font-ui);
    box-shadow: var(--shadow-timeline);
    pointer-events: auto;
  }

  .ts-track {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .ts-track-hitarea {
    position: absolute;
    inset: 0;
    z-index: 1;
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }

  .ts-track-hitarea:focus-visible {
    outline: 2px solid var(--surface-focus);
    outline-offset: 4px;
    border-radius: var(--radius-md);
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
    padding: 0 9px;
    transition: opacity 200ms ease, filter 200ms ease, transform 200ms ease, box-shadow 200ms ease;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset,
      0 5px 12px rgba(0, 0, 0, 0.10);
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
    opacity: 0.66;
    filter: saturate(0.72) brightness(0.95);
    box-shadow:
      0 0 0 2px var(--surface-outline),
      var(--shadow-sm);
  }

  .source-block.is-disabled .block-label {
    color: var(--text-on-accent);
    text-shadow: var(--accent-text-shadow);
  }

  .source-block.is-disabled .block-date {
    color: var(--text-on-accent-muted);
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
    z-index: 3;
  }

  .ts-row--above .source-block.is-current {
    transform: translateY(-2px) scale(1.03, 1.18);
    transform-origin: bottom center;
    box-shadow:
      0 10px 22px rgba(0, 0, 0, 0.16),
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset,
      0 0 0 1px var(--pill-inset-active) inset;
  }

  .ts-row--below .source-block.is-current {
    transform: translateY(2px) scale(1.03, 1.18);
    transform-origin: top center;
    box-shadow:
      0 10px 22px rgba(0, 0, 0, 0.16),
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset,
      0 0 0 1px var(--pill-inset-active) inset;
  }

  .block-label {
    position: relative;
    z-index: 4;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 650;
    color: var(--text-on-accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-align: center;
    line-height: 1.2;
    letter-spacing: 0.01em;
  }

  .block-date {
    position: relative;
    z-index: 4;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 400;
    color: var(--text-on-accent-muted);
    white-space: nowrap;
    text-align: center;
    line-height: 1.2;
  }

  .ts-axis-line {
    position: relative;
    height: 8px;
    background: var(--timeline-track-bg);
    border-radius: var(--radius-pill);
    z-index: 8;
    overflow: visible;
    pointer-events: auto;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--surface-inset-strong) 80%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--surface-outline-soft) 90%, transparent);
  }


  .scrubber-label {
    position: absolute;
    bottom: calc(100% + 43px);
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--pane-badge-text);
    background: var(--pane-badge-bg);
    border: 2px solid var(--scrubber-badge-border);
    border-radius: 99px;
    padding: 6px 11px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 12;
    box-shadow:
      0 0 0 2px var(--scrubber-badge-ring),
      var(--shadow-md);
  }

  .scrubber-label.is-disabled {
    opacity: 0.42;
    filter: saturate(0.18);
  }

  .scrubber-label--single {
    color: var(--text-secondary);
    background: var(--surface-floating);
    border-color: var(--surface-outline-soft);
    border-radius: var(--radius-xs);
    padding: 3px 8px;
  }

  .scrubber-label--right {
    bottom: calc(100% + 70px);
  }

  .ts-scrubber {
    position: absolute;
    left: 0;
    top: 50%;
    height: 64px;
    transform: translateY(-50%);
    width: 100%;
    margin: 0;
    padding: 0;
    z-index: 11;
    cursor: ew-resize;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background: transparent;
    border: none;
    outline: none;
    accent-color: transparent;
    pointer-events: none;
  }

  .ts-scrubber.is-disabled {
    opacity: 0.34;
    filter: saturate(0.18);
  }

  .ts-scrubber--right {
    z-index: 10;
  }

  .ts-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 36px;
    height: 64px;
    border-radius: 18px;
    background-color: var(--scrubber-thumb-bg);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='64' viewBox='0 0 36 64'%3E%3Cpath d='M13 32 L8 27 M13 32 L8 37' stroke='%23555555' stroke-width='2.75' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M23 32 L28 27 M23 32 L28 37' stroke='%23555555' stroke-width='2.75' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
    border: 3.5px solid var(--pane-color);
    cursor: ew-resize;
    box-shadow:
      0 14px 28px rgba(0, 0, 0, 0.26),
      0 0 0 6px var(--scrubber-thumb-ring),
      0 0 0 1px var(--surface-inset-strong) inset,
      0 0 0 1px rgba(255, 255, 255, 0.7);
    pointer-events: auto;
  }

  .ts-scrubber.is-disabled::-webkit-slider-thumb {
    cursor: default;
    box-shadow:
      0 4px 10px rgba(0, 0, 0, 0.14),
      0 0 0 2px var(--surface-inset) inset;
  }

  .ts-scrubber::-webkit-slider-thumb:hover {
    box-shadow:
      0 16px 32px rgba(0, 0, 0, 0.30),
      0 0 0 7px var(--scrubber-thumb-ring-hover),
      0 0 0 1px var(--surface-inset-strong) inset,
      0 0 0 1px rgba(255, 255, 255, 0.78);
  }

  .ts-scrubber::-moz-range-thumb {
    -moz-appearance: none;
    width: 36px;
    height: 64px;
    border-radius: 18px;
    background-color: var(--scrubber-thumb-bg);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='64' viewBox='0 0 36 64'%3E%3Cpath d='M13 32 L8 27 M13 32 L8 37' stroke='%23555555' stroke-width='2.75' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3Cpath d='M23 32 L28 27 M23 32 L28 37' stroke='%23555555' stroke-width='2.75' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
    border: 3.5px solid var(--pane-color);
    cursor: ew-resize;
    box-shadow:
      0 14px 28px rgba(0, 0, 0, 0.26),
      0 0 0 6px var(--scrubber-thumb-ring),
      0 0 0 1px var(--surface-inset-strong) inset,
      0 0 0 1px rgba(255, 255, 255, 0.7);
    pointer-events: auto;
  }

  .ts-scrubber.is-disabled::-moz-range-thumb {
    cursor: default;
    box-shadow:
      0 4px 10px rgba(0, 0, 0, 0.14),
      0 0 0 2px var(--surface-inset) inset;
  }

  .ts-scrubber::-moz-focus-outer {
    border: 0;
  }

  .ts-scrubber--single {
    --pane-color: var(--surface-outline);
  }

  .ts-scrubber::-webkit-slider-runnable-track {
    height: 64px;
    background: transparent;
  }

  .ts-scrubber::-moz-range-track {
    height: 64px;
    background: transparent;
    border: none;
  }

  .ts-scrubber::-moz-range-progress {
    background: transparent;
    border: none;
  }

  .img-dot {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) scale(1);
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background-color: var(--photo-chip-bg);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'%3E%3Crect x='2.25' y='3' width='13.5' height='12' rx='2' fill='%23d4a84b'/%3E%3Ccircle cx='6.2' cy='7.1' r='1.35' fill='white'/%3E%3Cpath d='M4.2 13l3.1-3.2 2.1 2 2.2-2.5 2.2 3.7H4.2z' fill='white'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
    border: 1.5px solid var(--photo-chip-border);
    padding: 0;
    cursor: pointer;
    z-index: 9;
    pointer-events: auto;
    box-shadow: var(--photo-chip-shadow);
    transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
  }

  .img-dot:hover {
    transform: translate(-50%, -50%) scale(1.35);
    box-shadow: var(--photo-chip-shadow-hover);
  }

  .img-dot--multi {
    width: 20px;
    height: 20px;
    box-shadow: var(--photo-chip-shadow-multi);
  }

  .img-dot--near {
    width: 22px;
    height: 22px;
    background-color: var(--photo-chip-bg);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Crect x='2.5' y='3.25' width='17' height='15' rx='2.4' fill='%23f59e0b'/%3E%3Ccircle cx='7.7' cy='8.5' r='1.65' fill='white'/%3E%3Cpath d='M5.2 15.9l4-4.1 2.7 2.5 2.8-3.2 2.8 4.8H5.2z' fill='white'/%3E%3C/svg%3E");
    transform: translate(-50%, -50%) scale(1.18);
    box-shadow: var(--photo-chip-shadow-near);
  }

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

  .ts-tick--decade::before { height: 8px; background: var(--timeline-tick); }
  .ts-tick--century::before { height: 18px; background: var(--timeline-tick-strong); }

  .ts-tick-label {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--timeline-label);
    margin-top: 2px;
    white-space: nowrap;
  }

  .ts-tick--century .ts-tick-label {
    color: var(--timeline-label-strong);
    font-weight: 600;
  }
</style>
