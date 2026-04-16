<!-- app/src/lib/components/Timeslider.svelte -->
<script lang="ts">
  import { dev } from '$app/environment';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { MassartItem } from '$lib/artemis/types';
  import { MAIN_LAYER_LABELS, MAIN_LAYER_SHORT_LABELS, MAIN_LAYER_META } from '$lib/artemis/layerConfig';

  type PaneId = 'left' | 'right';
  type LayerMetadata = { title: string; info: string[] };

  export let massartItems: MassartItem[] = [];
  export let layerMetadataByMainId: Record<string, LayerMetadata> = {};
  export let yearLeeway: number = 3;
  export let loadingLayers: Record<string, boolean> = {};
  export let dualPaneEnabled = false;
  export let disabledPane: PaneId | null = null;
  export let leftYear: number | undefined = undefined;
  export let rightYear: number | undefined = undefined;
  export let searchFocusMainId: string | null = null;
  export let searchFocusYear: number | null = null;
  export let searchFocusNonce = 0;

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
      key: 'hand', mainId: 'HanddrawnCollection', label: MAIN_LAYER_LABELS.HanddrawnCollection,
      start: 1700, end: 1715, repr: 1707, color: 'var(--layer-hand-color)', lane: 1,
      sublayers: [
        { id: 'iiif', subId: 'HanddrawnCollection-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'HanddrawnCollection-parcels', label: 'Parcels', defaultOn: false },
        { id: 'water', subId: 'HanddrawnCollection-water', label: 'Water infrastructure', defaultOn: false },
      ],
    },
    {
      key: 'frickx', mainId: 'Frickx', label: MAIN_LAYER_LABELS.Frickx,
      start: 1712, end: 1712, repr: 1712, color: 'var(--layer-frickx-color)', lane: 3,
      sublayers: [
        { id: 'wmts', subId: 'Frickx-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'villaret', mainId: 'Villaret', label: MAIN_LAYER_LABELS.Villaret,
      start: 1745, end: 1748, repr: 1746, color: 'var(--layer-villaret-color)', lane: 4,
      sublayers: [
        { id: 'wmts', subId: 'Villaret-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'ferraris', mainId: 'Ferraris', label: MAIN_LAYER_LABELS.Ferraris,
      start: 1770, end: 1778, repr: 1774, color: 'var(--layer-ferraris-color)', lane: 2,
      sublayers: [
        { id: 'wmts', subId: 'Ferraris-wmts', label: 'Map', defaultOn: true },
        { id: 'landuse', subId: 'Ferraris-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'primitief', mainId: 'PrimitiefKadaster', label: MAIN_LAYER_LABELS.PrimitiefKadaster,
      start: 1808, end: 1834, repr: 1814, color: 'var(--layer-primitief-color)', lane: 3,
      sublayers: [
        { id: 'iiif', subId: 'PrimitiefKadaster-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'PrimitiefKadaster-parcels', label: 'Parcels', defaultOn: false },
        { id: 'landuse', subId: 'PrimitiefKadaster-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'vander', mainId: 'Vandermaelen', label: MAIN_LAYER_LABELS.Vandermaelen,
      start: 1846, end: 1854, repr: 1850, color: 'var(--layer-vander-color)', lane: 4,
      sublayers: [
        { id: 'wmts', subId: 'Vandermaelen-wmts', label: 'Map', defaultOn: true },
        { id: 'landuse', subId: 'Vandermaelen-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'GereduceerdeKadaster', label: MAIN_LAYER_LABELS.GereduceerdeKadaster,
      start: 1847, end: 1855, repr: 1851, color: 'var(--layer-gereduceerd-color)', lane: 1,
      sublayers: [
        { id: 'iiif', subId: 'GereduceerdeKadaster-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'GereduceerdeKadaster-parcels', label: 'Parcels', defaultOn: false },
        { id: 'landuse', subId: 'GereduceerdeKadaster-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'popp', mainId: 'Popp', label: MAIN_LAYER_LABELS.Popp,
      start: 1842, end: 1879, repr: 1860, color: 'var(--layer-popp-color)', lane: 2,
      sublayers: [
        { id: 'wmts', subId: 'Popp-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'ngi1873', mainId: 'NGI1873', label: MAIN_LAYER_LABELS.NGI1873,
      start: 1873, end: 1873, repr: 1873, color: 'var(--layer-ngi1873-color)', lane: 3,
      sublayers: [
        { id: 'wmts', subId: 'NGI1873-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'ngi1904', mainId: 'NGI1904', label: MAIN_LAYER_LABELS.NGI1904,
      start: 1904, end: 1904, repr: 1904, color: 'var(--layer-ngi1904-color)', lane: 1,
      sublayers: [
        { id: 'wmts', subId: 'NGI1904-wmts', label: 'Map', defaultOn: true },
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
  let trackEl: HTMLDivElement | null = null;
  let trackWidth = 0;
  let localLeftYear = defaultYear;
  let localRightYear = defaultYear;
  let lastLeftYearProp: number | undefined = undefined;
  let lastRightYearProp: number | undefined = undefined;
  let lastSearchFocusNonce = 0;
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
  let openInfoKey: string | null = null;
  let openMenuKey: SourceKey | null = null;
  let layerInfoModalKey: string | null = null;

  let hoveredSrc: SourceDef | null = null;
  let tooltipFixedStyle = '';
  let fullLabelFitsBySource: Partial<Record<SourceKey, boolean>> = {};
  let dragCleanup: (() => void) | null = null;
  let menuCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const MENU_CLOSE_DELAY_MS = 260;

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
    const visible = SOURCES.filter(
      s => year >= s.start - halfKnobYears && year <= s.end + halfKnobYears
    );
    return visible;
  }

  function setPaneYear(pane: PaneId, year: number, emit = true) {
    const prevYear = pane === 'left' ? localLeftYear : localRightYear;
    if (pane === 'left') {
      localLeftYear = year;
    } else {
      localRightYear = year;
    }
    if (emit) {
      dispatch('year-change', { pane, year });
    }
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

  function scrubberIndicatorStyle(year: number, color?: string, badgeBg?: string, badgeText?: string): string {
    const bits = [`left:${scrubberCenterPx(year)}px`];
    if (color) bits.push(`--pane-color:${color}`);
    if (badgeBg) bits.push(`--pane-badge-bg:${badgeBg}`);
    if (badgeText) bits.push(`--pane-badge-text:${badgeText}`);
    return bits.join(';');
  }

  function applyDraggedYear(pane: PaneId, clientX: number) {
    const trackEl = document.querySelector('.ts-track') as HTMLElement | null;
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const year = yearFromTrackClientX(clientX, rect);
    if (!dualPaneEnabled) {
      setSingleYear(year);
      return;
    }
    setPaneYear(pane, year);
  }

  function startKnobDrag(pane: PaneId, event: PointerEvent) {
    if (dualPaneEnabled && disabledPane === pane) return;
    event.preventDefault();
    dragCleanup?.();
    applyDraggedYear(pane, event.clientX);

    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      applyDraggedYear(pane, moveEvent.clientX);
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      dragCleanup = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    dragCleanup = onEnd;
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

  function jumpToSource(src: SourceDef, e: MouseEvent) {
    let targetYear: number = src.repr;
    const el = e.currentTarget as HTMLElement;
    const tEl = el.closest('.ts-track') as HTMLElement | null;
    if (tEl) {
      const rect = tEl.getBoundingClientRect();
      const rawYear = yearFromTrackClientX(e.clientX, rect);
      targetYear = Math.max(src.start, Math.min(src.end, rawYear));
    }

    const pane = jumpToYear(targetYear);
    setLayerEnabled(pane, src.key, true);

    const overlapping = paneSourcesForYear(targetYear)
      .filter((candidate) => candidate.key !== src.key);
    for (const candidate of overlapping) {
      setLayerEnabled(pane, candidate.key, false);
    }
  }

  function onPillEnter(src: SourceDef, e: MouseEvent) {
    hoveredSrc = src;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    if (src.lane <= 2) {
      tooltipFixedStyle = `left:${cx}px;top:${rect.top - 8}px;transform:translate(-50%,-100%)`;
    } else {
      tooltipFixedStyle = `left:${cx}px;top:${rect.bottom + 8}px;transform:translateX(-50%)`;
    }
  }

  function onPillLeave() {
    hoveredSrc = null;
  }

  function onTrackClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.source-pill-wrap, .source-menu-popover, .img-dot, .ts-scrubber, .sub-menu, .sub-menu-header--toggle, .sub-pill, .sub-menu-checkbox-input, .source-folder-tab')) return;

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

  function sourceByKey(key: SourceKey): SourceDef {
    return SOURCES.find((src) => src.key === key)!;
  }

  function sourceByMainId(mainId: string): SourceDef | undefined {
    return SOURCES.find((src) => src.mainId === mainId);
  }

  function infoKey(pane: PaneId, key: SourceKey, subId?: string): string {
    return subId ? `${pane}:${key}:${subId}` : `${pane}:${key}`;
  }

  function layerInfoKey(pane: PaneId, mainId: string): string {
    return `${pane}:${mainId}`;
  }

  function toggleInfo(key: string) {
    openInfoKey = openInfoKey === key ? null : key;
  }

  function isInfoOpen(key: string): boolean {
    return openInfoKey === key;
  }

  function onInfoButtonClick(event: MouseEvent, key: string) {
    event.stopPropagation();
    layerInfoModalKey = layerInfoModalKey === key ? null : key;
  }

  function closeLayerInfo(event?: MouseEvent | KeyboardEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    layerInfoModalKey = null;
  }

  function toggleMenu(event: MouseEvent, key: SourceKey) {
    event.stopPropagation();
    if (menuCloseTimer !== null) {
      clearTimeout(menuCloseTimer);
      menuCloseTimer = null;
    }
    openInfoKey = null;
    openMenuKey = openMenuKey === key ? null : key;
  }

  function closeMenu(key: SourceKey) {
    if (openMenuKey !== key) return;
    openMenuKey = null;
    openInfoKey = null;
  }

  function scheduleCloseMenu(key: SourceKey) {
    if (menuCloseTimer !== null) clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(() => {
      menuCloseTimer = null;
      closeMenu(key);
    }, MENU_CLOSE_DELAY_MS);
  }

  function cancelCloseMenu() {
    if (menuCloseTimer === null) return;
    clearTimeout(menuCloseTimer);
    menuCloseTimer = null;
  }

  function mainLayerInfoCard(mainId: string, fallbackTitle: string): LayerMetadata {
    const meta = layerMetadataByMainId[mainId];
    if (!meta) return { title: fallbackTitle, info: [] };
    return {
      title: meta.title?.trim() || fallbackTitle,
      info: Array.isArray(meta.info) ? meta.info.filter((paragraph) => typeof paragraph === 'string' && paragraph.trim()) : [],
    };
  }

  function setLayerEnabled(pane: PaneId, key: SourceKey, enabled: boolean) {
    const src = sourceByKey(key);
    const singleSub = src.sublayers.length === 1 ? src.sublayers[0] : null;

    if (pane === 'right') {
      if (rightEnabledLayers[key] === enabled && (!singleSub || rightSublayerState[key]?.[singleSub.id] === enabled)) {
        return;
      }
      rightEnabledLayers = { ...rightEnabledLayers, [key]: enabled };
      if (singleSub) {
        rightSublayerState = {
          ...rightSublayerState,
          [key]: { ...rightSublayerState[key], [singleSub.id]: enabled },
        };
      }
      return;
    }
    if (leftEnabledLayers[key] === enabled && (!singleSub || leftSublayerState[key]?.[singleSub.id] === enabled)) {
      return;
    }
    leftEnabledLayers = { ...leftEnabledLayers, [key]: enabled };
    if (singleSub) {
      leftSublayerState = {
        ...leftSublayerState,
        [key]: { ...leftSublayerState[key], [singleSub.id]: enabled },
      };
    }
  }

  function toggleLayerEnabled(pane: PaneId, key: SourceKey) {
    const nextEnabled = pane === 'right' ? !rightEnabledLayers[key] : !leftEnabledLayers[key];
    setLayerEnabled(pane, key, nextEnabled);
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
      if (rightVisible) {
        dispatch('paneSublayerChange', { pane: 'right', subId, enabled: !cur });
      }
      return;
    }

    leftSublayerState = {
      ...leftSublayerState,
      [key]: { ...leftSublayerState[key], [localId]: !cur },
    };
    const leftVisible = leftEnabledLayers[key] && leftVisibleSourceKeys.has(key);
    if (leftVisible) {
      dispatch('sublayerChange', { subId, enabled: !cur });
      dispatch('paneSublayerChange', { pane: 'left', subId, enabled: !cur });
    }
  }

  function sourcePattern(key: SourceKey): string {
    if (key === 'hand') {
      return 'linear-gradient(135deg, rgba(255,255,255,0.22) 0 8%, transparent 8% 50%, rgba(255,255,255,0.18) 50% 58%, transparent 58% 100%)';
    }
    if (key === 'ferraris') {
      return 'repeating-linear-gradient(90deg, rgba(255,255,255,0.2) 0 2px, transparent 2px 14px), repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 12px)';
    }
    if (key === 'frickx' || key === 'villaret') {
      return 'repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 2px, transparent 2px 11px), linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))';
    }
    if (key === 'primitief') {
      return 'radial-gradient(circle at 25% 35%, rgba(255,255,255,0.2) 0 2px, transparent 2.5px), radial-gradient(circle at 72% 68%, rgba(255,255,255,0.16) 0 2px, transparent 2.5px), linear-gradient(145deg, transparent 0 44%, rgba(255,255,255,0.14) 44% 49%, transparent 49% 100%)';
    }
    if (key === 'vander') {
      return 'repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 2px, transparent 2px 12px), repeating-linear-gradient(45deg, rgba(255,255,255,0.1) 0 1px, transparent 1px 16px)';
    }
    if (key === 'popp') {
      return 'repeating-linear-gradient(0deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 10px), repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 14px)';
    }
    if (key === 'ngi1873' || key === 'ngi1904') {
      return 'linear-gradient(135deg, rgba(255,255,255,0.18) 0 22%, transparent 22% 50%, rgba(255,255,255,0.1) 50% 72%, transparent 72% 100%)';
    }
    return 'radial-gradient(circle at center, rgba(255,255,255,0.18) 0 2px, transparent 2.5px), radial-gradient(circle at center, rgba(255,255,255,0.12) 0 1px, transparent 1.5px)';
  }

  function sourcePatternSize(key: SourceKey): string {
    if (key === 'hand') return '22px 22px';
    if (key === 'ferraris') return '18px 18px, 18px 18px';
    if (key === 'frickx' || key === 'villaret') return '16px 16px, 100% 100%';
    if (key === 'primitief') return '28px 28px, 28px 28px, 24px 24px';
    if (key === 'vander') return '16px 16px, 24px 24px';
    if (key === 'popp') return '12px 12px, 16px 16px';
    if (key === 'ngi1873' || key === 'ngi1904') return '24px 24px';
    return '18px 18px, 9px 9px';
  }

  function sourceShortLabel(src: SourceDef): string {
    return MAIN_LAYER_SHORT_LABELS[src.mainId] ?? src.label;
  }

  function sourceEstimatedLabelWidthPx(label: string): number {
    return Math.max(28, 10 + label.length * 7);
  }

  function sourceMinWidthPx(src: SourceDef): number {
    return sourceEstimatedLabelWidthPx(sourceShortLabel(src));
  }

  function sourceRenderedWidthPx(src: SourceDef): number {
    const inclusiveEnd = Math.max(src.start, src.end + 1);
    const spanYears = Math.max(1, inclusiveEnd - src.start);
    if (trackWidth <= 0) return sourceMinWidthPx(src);

    const usableWidth = trackWidth - SCRUBBER_THUMB_SIZE;
    const rangeWidthPx = (spanYears / axisSpan) * usableWidth;
    return Math.max(rangeWidthPx, sourceMinWidthPx(src));
  }

  function sourceDisplayLabel(src: SourceDef): string {
    return fullLabelFitsBySource[src.key] ? src.label : sourceShortLabel(src);
  }

  function pillCanFitFullLabel(el: HTMLElement): boolean {
    const styles = getComputedStyle(el);
    const availableWidth =
      el.clientWidth -
      parseFloat(styles.paddingLeft || '0') -
      parseFloat(styles.paddingRight || '0');
    const measureEl = el.querySelector<HTMLElement>('.block-label-measure');
    if (!measureEl) return false;
    return availableWidth >= measureEl.scrollWidth;
  }

  function measureSourceLabel(el: HTMLElement, src: SourceDef) {
    let rafId = 0;

    const update = () => {
      rafId = 0;
      const nextFits = pillCanFitFullLabel(el);
      if (fullLabelFitsBySource[src.key] === nextFits) return;
      fullLabelFitsBySource = { ...fullLabelFitsBySource, [src.key]: nextFits };
    };

    const scheduleUpdate = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(el);
    scheduleUpdate();

    return {
      update(nextSrc: SourceDef) {
        src = nextSrc;
        scheduleUpdate();
      },
      destroy() {
        if (rafId) cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
      }
    };
  }

  function sourceBlockStyle(src: SourceDef): string {
    const inclusiveEnd = Math.max(src.start, src.end + 1);
    const spanYears = Math.max(1, inclusiveEnd - src.start);
    if (trackWidth <= 0) {
      return `left:${pct(src.start, axisStart, axisSpan)};--pill-width:${widthPct(src.start, inclusiveEnd, axisSpan)};--pill-min-width:${sourceMinWidthPx(src)}px;--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)}`;
    }

    const halfThumb = SCRUBBER_THUMB_SIZE / 2;
    const usableWidth = trackWidth - SCRUBBER_THUMB_SIZE;
    const rangeWidthPx = (spanYears / axisSpan) * usableWidth;
    const widthPx = Math.max(rangeWidthPx, sourceMinWidthPx(src));
    const centerYear = src.start + spanYears / 2;
    const centerPx = ((centerYear - axisStart) / axisSpan) * usableWidth + halfThumb;
    const leftPx = Math.max(0, Math.min(trackWidth - widthPx, centerPx - widthPx / 2));
    return `left:${leftPx}px;--pill-width:${widthPx}px;--pill-min-width:${sourceMinWidthPx(src)}px;--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)}`;
  }

  function sourceMenuStyle(src: SourceDef, pane: PaneId = 'left'): string {
    const paneTint = pane === 'right' ? 'var(--pane-right-panel-tint)' : 'var(--pane-left-panel-tint)';
    return `--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)};--pane-header-tint:${paneTint}`;
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
    let trackRaf = 0;
    let trackResizeObserver: ResizeObserver | null = null;
    const syncTrackWidth = () => {
      trackWidth = trackEl?.clientWidth ?? 0;
    };
    const scheduleTrackWidthSync = () => {
      if (trackRaf) cancelAnimationFrame(trackRaf);
      trackRaf = requestAnimationFrame(syncTrackWidth);
    };

    scheduleTrackWidthSync();
    if (trackEl) {
      trackResizeObserver = new ResizeObserver(scheduleTrackWidthSync);
      trackResizeObserver.observe(trackEl);
    }

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

    return () => {
      if (trackRaf) cancelAnimationFrame(trackRaf);
      trackResizeObserver?.disconnect();
    };
  });

  onDestroy(() => {
    dragCleanup?.();
    cancelCloseMenu();
  });

  $: halfKnobYears = yearLeeway;

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

  $: if (searchFocusNonce !== lastSearchFocusNonce) {
    lastSearchFocusNonce = searchFocusNonce;
    if (searchFocusMainId) {
      const src = sourceByMainId(searchFocusMainId);
      const targetYear = searchFocusYear ?? src?.repr;
      if (src && targetYear != null) {
        setLayerEnabled('left', src.key, true);
        const overlapping = paneSourcesForYear(targetYear)
          .filter((candidate) => candidate.key !== src.key);
        for (const candidate of overlapping) {
          setLayerEnabled('left', candidate.key, false);
        }
      }
    }
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

  $: lane1 = SOURCES.filter(s => s.lane === 1);
  $: lane2 = SOURCES.filter(s => s.lane === 2);
  $: lane3 = SOURCES.filter(s => s.lane === 3);
  $: lane4 = SOURCES.filter(s => s.lane === 4);

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
            const shouldBeOn = leftSublayerState[src.key]?.[sub.id] ?? sub.defaultOn;
            dispatch('sublayerChange', {
              subId: sub.subId,
              enabled: shouldBeOn,
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

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && layerInfoModalKey) { layerInfoModalKey = null; } }} />

<div class="timeslider">
  <div class="ts-track" bind:this={trackEl}>
    {#if dualPaneEnabled}
      {#each visiblePanes as pane}
        <span
          class="ts-scrub-indicator"
          class:ts-scrub-indicator--right={pane.id === 'right'}
          class:is-disabled={disabledPane === pane.id}
          style={scrubberIndicatorStyle(yearForPane(pane.id), pane.color, PANE_META[pane.id].badgeBg, PANE_META[pane.id].badgeText)}
          aria-hidden="true"
        ></span>
        <span
          class="scrubber-label"
          class:scrubber-label--right={pane.id === 'right'}
          class:is-disabled={disabledPane === pane.id}
          style={scrubberIndicatorStyle(yearForPane(pane.id), pane.color, PANE_META[pane.id].badgeBg, PANE_META[pane.id].badgeText)}
          role="slider"
          tabindex={disabledPane === pane.id ? -1 : 0}
          aria-valuemin={axisStart}
          aria-valuemax={axisEnd}
          aria-valuenow={Math.round(pane.year)}
          aria-label={`${pane.label} timeline year`}
          on:pointerdown={(event) => startKnobDrag(pane.id, event)}
        >&lt; {Math.round(pane.year)} &gt;</span>
      {/each}
    {:else}
      <span
        class="ts-scrub-indicator ts-scrub-indicator--single"
        style={scrubberIndicatorStyle(sliderYear)}
        aria-hidden="true"
      ></span>
      <span
        class="scrubber-label scrubber-label--single"
        style={scrubberIndicatorStyle(sliderYear)}
        role="slider"
        tabindex="0"
        aria-valuemin={axisStart}
        aria-valuemax={axisEnd}
        aria-valuenow={Math.round(sliderYear)}
        aria-label="Timeline year"
        on:pointerdown={(event) => startKnobDrag('left', event)}
      >&lt; {Math.round(sliderYear)} &gt;</span>
    {/if}

    <button
      class="ts-track-hitarea"
      type="button"
      aria-label={dualPaneEnabled ? 'Jump nearest compare timeline thumb' : 'Jump timeline thumb'}
      on:click={onTrackClick}
    ></button>
    <div class="ts-row ts-row--lane-1">
      {#each lane1 as src}
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        <div class="source-pill-wrap" role="group" aria-label={`${src.label} timeline controls`} class:is-open={openMenuKey === src.key} style={sourceBlockStyle(src)} on:mouseenter={cancelCloseMenu} on:mouseleave={() => scheduleCloseMenu(src.key)}>
          <button
            class="source-block"
            class:is-disabled={!enabled}
            class:is-current={sourceIsCurrentForKey(src.key)}
            class:is-compare-overlap={sourceHasOverlap(src.key)}
            class:is-loading={loadingLayers[src.mainId]}
            type="button"
            title={`${src.label} · ${src.start}–${src.end}`}
            aria-label={`Jump to ${src.label} (${src.start}–${src.end})`}
            use:measureSourceLabel={src}
            on:click={(e) => jumpToSource(src, e)}
            on:mouseenter={(e) => onPillEnter(src, e)}
            on:mouseleave={onPillLeave}
          >
            <span class="block-label">{sourceDisplayLabel(src)}</span>
            <span class="block-label-measure" aria-hidden="true">{src.label}</span>
          </button>
          <button
            class="source-folder-tab"
            class:is-open={openMenuKey === src.key}
            type="button"
            aria-label={`Open ${src.label} sublayers`}
            aria-expanded={openMenuKey === src.key}
            on:click={(event) => toggleMenu(event, src.key)}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 7.5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if openMenuKey === src.key}
            {@const layerMeta = mainLayerInfoCard(src.mainId, src.label)}
            <div class="source-menu-popover" transition:fade={{ duration: 140 }}>
              {#if dualPaneEnabled}
                <section class="sub-menu sub-menu--compare" style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-compare-header">
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--left">
                      <input
                        class="sub-menu-checkbox-input"
                        type="checkbox"
                        checked={leftEnabledLayers[src.key]}
                        aria-label="{src.label} layer visible in left pane"
                        on:click|stopPropagation
                        on:change={() => toggleLayerEnabled('left', src.key)}
                      />
                      <span class="sub-menu-pane-check-label">Left</span>
                    </label>
                    <div class="sub-menu-compare-info">
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                      <div class="sub-menu-info-anchor sub-menu-info-anchor--compare">
                        <button
                          class="sub-menu-info-button"
                          type="button"
                          aria-label="{src.label} info"
                          title="{src.label} info"
                          aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)}
                          on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}
                        >i</button>
                        {#if isInfoOpen(infoKey('left', src.key))}
                          <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                            <div class="sub-menu-info-title">{layerMeta.title}</div>
                            {#each layerMeta.info as paragraph}
                              <p class="sub-menu-info-text">{paragraph}</p>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--right">
                      <span class="sub-menu-pane-check-label">Right</span>
                      <input
                        class="sub-menu-checkbox-input"
                        type="checkbox"
                        checked={rightEnabledLayers[src.key]}
                        aria-label="{src.label} layer visible in right pane"
                        on:click|stopPropagation
                        on:change={() => toggleLayerEnabled('right', src.key)}
                      />
                    </label>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-compare-grid">
                      {#each src.sublayers as sub}
                        <div class="sub-menu-compare-row">
                          <span class="sub-menu-compare-name">{sub.label}</span>
                          <div class="sub-menu-compare-controls sub-menu-compare-controls--split" style="--c:{src.color}">
                            <button
                              class="sub-pill sub-pill--split sub-pill--split-left"
                              class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)}
                              class:is-layer-disabled={!leftEnabledLayers[src.key]}
                              type="button"
                              title="{src.label} — Left {sub.label}"
                              on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}
                            >{sub.label}</button>
                            <button
                              class="sub-pill sub-pill--split sub-pill--split-right"
                              class:is-disabled={!isSublayerEnabled('right', src.key, sub.id)}
                              class:is-layer-disabled={!rightEnabledLayers[src.key]}
                              type="button"
                              title="{src.label} — Right {sub.label}"
                              on:click={() => toggleSublayer('right', src.key, sub.subId, sub.id)}
                            >{sub.label}</button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              {:else}
                <section class="sub-menu" class:is-layer-disabled={!leftEnabledLayers[src.key]} style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-header-row">
                    <button
                      class="sub-menu-header sub-menu-header--toggle"
                      class:is-disabled={!leftEnabledLayers[src.key]}
                      type="button"
                      title="{src.label} — global visibility"
                      on:click={() => toggleLayerEnabled('left', src.key)}
                    >
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                    </button>
                    <input
                      class="sub-menu-checkbox-input"
                      type="checkbox"
                      checked={leftEnabledLayers[src.key]}
                      aria-label="{src.label} layer visible in left pane"
                      on:click|stopPropagation
                      on:change={() => toggleLayerEnabled('left', src.key)}
                    />
                    <div class="sub-menu-info-anchor">
                      <button
                        class="sub-menu-info-button"
                        type="button"
                        aria-label="{src.label} info"
                        title="{src.label} info"
                        aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)}
                        on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}
                      >i</button>
                      {#if isInfoOpen(infoKey('left', src.key))}
                        <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                          <div class="sub-menu-info-title">{layerMeta.title}</div>
                          {#each layerMeta.info as paragraph}
                            <p class="sub-menu-info-text">{paragraph}</p>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                  {#if src.sublayers.length > 1}
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
                  {/if}
                </section>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="ts-row ts-row--lane-2">
      {#each lane2 as src}
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        <div class="source-pill-wrap" role="group" aria-label={`${src.label} timeline controls`} class:is-open={openMenuKey === src.key} style={sourceBlockStyle(src)} on:mouseenter={cancelCloseMenu} on:mouseleave={() => scheduleCloseMenu(src.key)}>
          <button
            class="source-block"
            class:is-disabled={!enabled}
            class:is-current={sourceIsCurrentForKey(src.key)}
            class:is-compare-overlap={sourceHasOverlap(src.key)}
            class:is-loading={loadingLayers[src.mainId]}
            type="button"
            title={`${src.label} · ${src.start}–${src.end}`}
            aria-label={`Jump to ${src.label} (${src.start}–${src.end})`}
            use:measureSourceLabel={src}
            on:click={(e) => jumpToSource(src, e)}
            on:mouseenter={(e) => onPillEnter(src, e)}
            on:mouseleave={onPillLeave}
          >
            <span class="block-label">{sourceDisplayLabel(src)}</span>
            <span class="block-label-measure" aria-hidden="true">{src.label}</span>
          </button>
          <button
            class="source-folder-tab"
            class:is-open={openMenuKey === src.key}
            type="button"
            aria-label={`Open ${src.label} sublayers`}
            aria-expanded={openMenuKey === src.key}
            on:click={(event) => toggleMenu(event, src.key)}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 7.5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if openMenuKey === src.key}
            {@const layerMeta = mainLayerInfoCard(src.mainId, src.label)}
            <div class="source-menu-popover" transition:fade={{ duration: 140 }}>
              {#if dualPaneEnabled}
                <section class="sub-menu sub-menu--compare" style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-compare-header">
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--left">
                      <input class="sub-menu-checkbox-input" type="checkbox" checked={leftEnabledLayers[src.key]} aria-label="{src.label} layer visible in left pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('left', src.key)} />
                      <span class="sub-menu-pane-check-label">Left</span>
                    </label>
                    <div class="sub-menu-compare-info">
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                      <div class="sub-menu-info-anchor sub-menu-info-anchor--compare">
                        <button class="sub-menu-info-button" type="button" aria-label="{src.label} info" title="{src.label} info" aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)} on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}>i</button>
                        {#if isInfoOpen(infoKey('left', src.key))}
                          <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                            <div class="sub-menu-info-title">{layerMeta.title}</div>
                            {#each layerMeta.info as paragraph}
                              <p class="sub-menu-info-text">{paragraph}</p>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--right">
                      <span class="sub-menu-pane-check-label">Right</span>
                      <input class="sub-menu-checkbox-input" type="checkbox" checked={rightEnabledLayers[src.key]} aria-label="{src.label} layer visible in right pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('right', src.key)} />
                    </label>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-compare-grid">
                      {#each src.sublayers as sub}
                        <div class="sub-menu-compare-row">
                          <span class="sub-menu-compare-name">{sub.label}</span>
                          <div class="sub-menu-compare-controls sub-menu-compare-controls--split" style="--c:{src.color}">
                            <button class="sub-pill sub-pill--split sub-pill--split-left" class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)} class:is-layer-disabled={!leftEnabledLayers[src.key]} type="button" title="{src.label} — Left {sub.label}" on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}>{sub.label}</button>
                            <button class="sub-pill sub-pill--split sub-pill--split-right" class:is-disabled={!isSublayerEnabled('right', src.key, sub.id)} class:is-layer-disabled={!rightEnabledLayers[src.key]} type="button" title="{src.label} — Right {sub.label}" on:click={() => toggleSublayer('right', src.key, sub.subId, sub.id)}>{sub.label}</button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              {:else}
                <section class="sub-menu" class:is-layer-disabled={!leftEnabledLayers[src.key]} style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-header-row">
                    <button class="sub-menu-header sub-menu-header--toggle" class:is-disabled={!leftEnabledLayers[src.key]} type="button" title="{src.label} — global visibility" on:click={() => toggleLayerEnabled('left', src.key)}>
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                    </button>
                    <input class="sub-menu-checkbox-input" type="checkbox" checked={leftEnabledLayers[src.key]} aria-label="{src.label} layer visible in left pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('left', src.key)} />
                    <div class="sub-menu-info-anchor">
                      <button class="sub-menu-info-button" type="button" aria-label="{src.label} info" title="{src.label} info" aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)} on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}>i</button>
                      {#if isInfoOpen(infoKey('left', src.key))}
                        <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                          <div class="sub-menu-info-title">{layerMeta.title}</div>
                          {#each layerMeta.info as paragraph}
                            <p class="sub-menu-info-text">{paragraph}</p>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-pills">
                      {#each src.sublayers as sub}
                        <button class="sub-pill" class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)} class:is-layer-disabled={!leftEnabledLayers[src.key]} style="--c:{src.color}" type="button" title="{src.label} — {sub.label}" on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}>{sub.label}</button>
                      {/each}
                    </div>
                  {/if}
                </section>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="ts-axis-line">
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
            value={pane.id === 'left' ? localLeftYear : localRightYear}
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
          bind:value={sliderYear}
          on:input={(e) => onSliderInput('left', e)}
          aria-label="Timeline year"
        />
      {/if}
    </div>

    <div class="ts-row ts-row--lane-3">
      {#each lane3 as src}
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        <div class="source-pill-wrap" role="group" aria-label={`${src.label} timeline controls`} class:is-open={openMenuKey === src.key} style={sourceBlockStyle(src)} on:mouseenter={cancelCloseMenu} on:mouseleave={() => scheduleCloseMenu(src.key)}>
          <button
            class="source-block"
            class:is-disabled={!enabled}
            class:is-current={sourceIsCurrentForKey(src.key)}
            class:is-compare-overlap={sourceHasOverlap(src.key)}
            class:is-loading={loadingLayers[src.mainId]}
            type="button"
            title={`${src.label} · ${src.start}–${src.end}`}
            aria-label={`Jump to ${src.label} (${src.start}–${src.end})`}
            use:measureSourceLabel={src}
            on:click={(e) => jumpToSource(src, e)}
            on:mouseenter={(e) => onPillEnter(src, e)}
            on:mouseleave={onPillLeave}
          >
            <span class="block-label">{sourceDisplayLabel(src)}</span>
            <span class="block-label-measure" aria-hidden="true">{src.label}</span>
          </button>
          <button
            class="source-folder-tab"
            class:is-open={openMenuKey === src.key}
            type="button"
            aria-label={`Open ${src.label} sublayers`}
            aria-expanded={openMenuKey === src.key}
            on:click={(event) => toggleMenu(event, src.key)}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 7.5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if openMenuKey === src.key}
            {@const layerMeta = mainLayerInfoCard(src.mainId, src.label)}
            <div class="source-menu-popover" transition:fade={{ duration: 140 }}>
              {#if dualPaneEnabled}
                <section class="sub-menu sub-menu--compare" style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-compare-header">
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--left">
                      <input class="sub-menu-checkbox-input" type="checkbox" checked={leftEnabledLayers[src.key]} aria-label="{src.label} layer visible in left pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('left', src.key)} />
                      <span class="sub-menu-pane-check-label">Left</span>
                    </label>
                    <div class="sub-menu-compare-info">
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                      <div class="sub-menu-info-anchor sub-menu-info-anchor--compare">
                        <button class="sub-menu-info-button" type="button" aria-label="{src.label} info" title="{src.label} info" aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)} on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}>i</button>
                        {#if isInfoOpen(infoKey('left', src.key))}
                          <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                            <div class="sub-menu-info-title">{layerMeta.title}</div>
                            {#each layerMeta.info as paragraph}
                              <p class="sub-menu-info-text">{paragraph}</p>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--right">
                      <span class="sub-menu-pane-check-label">Right</span>
                      <input class="sub-menu-checkbox-input" type="checkbox" checked={rightEnabledLayers[src.key]} aria-label="{src.label} layer visible in right pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('right', src.key)} />
                    </label>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-compare-grid">
                      {#each src.sublayers as sub}
                        <div class="sub-menu-compare-row">
                          <span class="sub-menu-compare-name">{sub.label}</span>
                          <div class="sub-menu-compare-controls sub-menu-compare-controls--split" style="--c:{src.color}">
                            <button class="sub-pill sub-pill--split sub-pill--split-left" class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)} class:is-layer-disabled={!leftEnabledLayers[src.key]} type="button" title="{src.label} — Left {sub.label}" on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}>{sub.label}</button>
                            <button class="sub-pill sub-pill--split sub-pill--split-right" class:is-disabled={!isSublayerEnabled('right', src.key, sub.id)} class:is-layer-disabled={!rightEnabledLayers[src.key]} type="button" title="{src.label} — Right {sub.label}" on:click={() => toggleSublayer('right', src.key, sub.subId, sub.id)}>{sub.label}</button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              {:else}
                <section class="sub-menu" class:is-layer-disabled={!leftEnabledLayers[src.key]} style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-header-row">
                    <button class="sub-menu-header sub-menu-header--toggle" class:is-disabled={!leftEnabledLayers[src.key]} type="button" title="{src.label} — global visibility" on:click={() => toggleLayerEnabled('left', src.key)}>
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                    </button>
                    <input class="sub-menu-checkbox-input" type="checkbox" checked={leftEnabledLayers[src.key]} aria-label="{src.label} layer visible in left pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('left', src.key)} />
                    <div class="sub-menu-info-anchor">
                      <button class="sub-menu-info-button" type="button" aria-label="{src.label} info" title="{src.label} info" aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)} on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}>i</button>
                      {#if isInfoOpen(infoKey('left', src.key))}
                        <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                          <div class="sub-menu-info-title">{layerMeta.title}</div>
                          {#each layerMeta.info as paragraph}
                            <p class="sub-menu-info-text">{paragraph}</p>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-pills">
                      {#each src.sublayers as sub}
                        <button class="sub-pill" class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)} class:is-layer-disabled={!leftEnabledLayers[src.key]} style="--c:{src.color}" type="button" title="{src.label} — {sub.label}" on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}>{sub.label}</button>
                      {/each}
                    </div>
                  {/if}
                </section>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="ts-row ts-row--lane-4">
      {#each lane4 as src}
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        <div class="source-pill-wrap" role="group" aria-label={`${src.label} timeline controls`} class:is-open={openMenuKey === src.key} style={sourceBlockStyle(src)} on:mouseenter={cancelCloseMenu} on:mouseleave={() => scheduleCloseMenu(src.key)}>
          <button
            class="source-block"
            class:is-disabled={!enabled}
            class:is-current={sourceIsCurrentForKey(src.key)}
            class:is-compare-overlap={sourceHasOverlap(src.key)}
            class:is-loading={loadingLayers[src.mainId]}
            type="button"
            title={`${src.label} · ${src.start}–${src.end}`}
            aria-label={`Jump to ${src.label} (${src.start}–${src.end})`}
            use:measureSourceLabel={src}
            on:click={(e) => jumpToSource(src, e)}
            on:mouseenter={(e) => onPillEnter(src, e)}
            on:mouseleave={onPillLeave}
          >
            <span class="block-label">{sourceDisplayLabel(src)}</span>
            <span class="block-label-measure" aria-hidden="true">{src.label}</span>
          </button>
          <button
            class="source-folder-tab"
            class:is-open={openMenuKey === src.key}
            type="button"
            aria-label={`Open ${src.label} sublayers`}
            aria-expanded={openMenuKey === src.key}
            on:click={(event) => toggleMenu(event, src.key)}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 7.5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if openMenuKey === src.key}
            {@const layerMeta = mainLayerInfoCard(src.mainId, src.label)}
            <div class="source-menu-popover" transition:fade={{ duration: 140 }}>
              {#if dualPaneEnabled}
                <section class="sub-menu sub-menu--compare" style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-compare-header">
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--left">
                      <input class="sub-menu-checkbox-input" type="checkbox" checked={leftEnabledLayers[src.key]} aria-label="{src.label} layer visible in left pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('left', src.key)} />
                      <span class="sub-menu-pane-check-label">Left</span>
                    </label>
                    <div class="sub-menu-compare-info">
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                      <div class="sub-menu-info-anchor sub-menu-info-anchor--compare">
                        <button class="sub-menu-info-button" type="button" aria-label="{src.label} info" title="{src.label} info" aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)} on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}>i</button>
                        {#if isInfoOpen(infoKey('left', src.key))}
                          <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                            <div class="sub-menu-info-title">{layerMeta.title}</div>
                            {#each layerMeta.info as paragraph}
                              <p class="sub-menu-info-text">{paragraph}</p>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <label class="sub-menu-pane-check sub-menu-pane-check--compare sub-menu-pane-check--right">
                      <span class="sub-menu-pane-check-label">Right</span>
                      <input class="sub-menu-checkbox-input" type="checkbox" checked={rightEnabledLayers[src.key]} aria-label="{src.label} layer visible in right pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('right', src.key)} />
                    </label>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-compare-grid">
                      {#each src.sublayers as sub}
                        <div class="sub-menu-compare-row">
                          <span class="sub-menu-compare-name">{sub.label}</span>
                          <div class="sub-menu-compare-controls sub-menu-compare-controls--split" style="--c:{src.color}">
                            <button class="sub-pill sub-pill--split sub-pill--split-left" class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)} class:is-layer-disabled={!leftEnabledLayers[src.key]} type="button" title="{src.label} — Left {sub.label}" on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}>{sub.label}</button>
                            <button class="sub-pill sub-pill--split sub-pill--split-right" class:is-disabled={!isSublayerEnabled('right', src.key, sub.id)} class:is-layer-disabled={!rightEnabledLayers[src.key]} type="button" title="{src.label} — Right {sub.label}" on:click={() => toggleSublayer('right', src.key, sub.subId, sub.id)}>{sub.label}</button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              {:else}
                <section class="sub-menu" class:is-layer-disabled={!leftEnabledLayers[src.key]} style={sourceMenuStyle(src, 'left')}>
                  <div class="sub-menu-header-row">
                    <button class="sub-menu-header sub-menu-header--toggle" class:is-disabled={!leftEnabledLayers[src.key]} type="button" title="{src.label} — global visibility" on:click={() => toggleLayerEnabled('left', src.key)}>
                      <span class="sub-menu-swatch" style="--c:{src.color}"></span>
                      <span class="sub-menu-title-wrap">
                        <span class="sub-menu-title">{src.label}</span>
                        <span class="sub-menu-title-meta">{MAIN_LAYER_META[src.mainId]?.date}</span>
                      </span>
                    </button>
                    <input class="sub-menu-checkbox-input" type="checkbox" checked={leftEnabledLayers[src.key]} aria-label="{src.label} layer visible in left pane" on:click|stopPropagation on:change={() => toggleLayerEnabled('left', src.key)} />
                    <div class="sub-menu-info-anchor">
                      <button class="sub-menu-info-button" type="button" aria-label="{src.label} info" title="{src.label} info" aria-expanded={layerInfoModalKey === layerInfoKey('left', src.mainId)} on:click={(event) => onInfoButtonClick(event, layerInfoKey('left', src.mainId))}>i</button>
                      {#if isInfoOpen(infoKey('left', src.key))}
                        <div class="sub-menu-info-card" transition:fade={{ duration: 120 }}>
                          <div class="sub-menu-info-title">{layerMeta.title}</div>
                          {#each layerMeta.info as paragraph}
                            <p class="sub-menu-info-text">{paragraph}</p>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                  {#if src.sublayers.length > 1}
                    <div class="sub-menu-pills">
                      {#each src.sublayers as sub}
                        <button class="sub-pill" class:is-disabled={!isSublayerEnabled('left', src.key, sub.id)} class:is-layer-disabled={!leftEnabledLayers[src.key]} style="--c:{src.color}" type="button" title="{src.label} — {sub.label}" on:click={() => toggleSublayer('left', src.key, sub.subId, sub.id)}>{sub.label}</button>
                      {/each}
                    </div>
                  {/if}
                </section>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if hoveredSrc}
  <div class="pill-hover-tip" style={tooltipFixedStyle} aria-hidden="true">
    <span class="pill-hover-tip-name">{hoveredSrc.label}</span>
    <span class="pill-hover-tip-range">{hoveredSrc.start}–{hoveredSrc.end}</span>
  </div>
{/if}

{#if layerInfoModalKey}
  {@const [paneStr, mainId] = layerInfoModalKey.split(':') as [string, string]}
  {@const layerMeta = mainId ? layerMetadataByMainId[mainId] : null}
  {#if layerMeta}
    <div
      class="layer-info-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close layer information"
      on:click={(event) => {
        if (event.target === event.currentTarget) layerInfoModalKey = null;
      }}
      on:keydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          layerInfoModalKey = null;
        }
      }}
    >
      <div
        class="layer-info-modal ui-panel-overlay"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label={layerMeta.title}
        on:click|stopPropagation
        on:keydown|stopPropagation
      >
        <div class="layer-info-head">
          <div>
            <div class="ui-label">Layer Info</div>
            <h2>{layerMeta.title}</h2>
          </div>
          <button class="ui-btn layer-info-close" type="button" on:click={closeLayerInfo}>Close</button>
        </div>
        <div class="layer-info-body">
          {#each layerMeta.info as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>
      </div>
    </div>
  {/if}
{/if}

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

  .sub-menu-header-toggles {
    display: flex;
    align-items: center;
    gap: 8px;
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

  .sub-menu-compare-header::after {
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
    border-radius: inherit;
  }

  .sub-menu-compare-info {
    grid-column: 2;
    position: relative;
    z-index: 1;
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

  .sub-menu-pane-check--compare.sub-menu-pane-check--left {
    grid-column: 1;
  }

  .sub-menu-pane-check--compare.sub-menu-pane-check--right {
    grid-column: 3;
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
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--surface-inset-strong) 70%, transparent),
      0 1px 2px rgba(0, 0, 0, 0.08);
    flex: 0 0 auto;
    cursor: pointer;
    align-self: center;
    position: relative;
    z-index: 2;
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
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 85%, transparent),
      0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .sub-menu-info-button:hover,
  .sub-menu-info-button:focus-visible {
    filter: brightness(1.03);
    outline: 2px solid var(--surface-focus);
    outline-offset: 2px;
  }

  .sub-menu-info-anchor {
    position: relative;
    display: flex;
    align-items: center;
    align-self: center;
    z-index: 4;
    flex: 0 0 auto;
  }

  .sub-menu-info-anchor--compare {
    margin-left: 0;
  }

  .sub-menu-info-card {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 6;
    width: min(280px, calc(100vw - 40px));
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface-floating) 96%, white);
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.45;
    box-shadow:
      inset 0 0 0 1px var(--sub-menu-note-inset),
      0 8px 18px rgba(0, 0, 0, 0.12);
  }

  .sub-menu-info-card::before {
    content: '';
    position: absolute;
    top: -6px;
    right: 14px;
    width: 12px;
    height: 12px;
    background: inherit;
    transform: rotate(45deg);
    box-shadow: -1px -1px 0 0 var(--sub-menu-note-inset);
  }

  .sub-menu-info-text {
    margin: 0;
  }

  .sub-menu-info-title {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--text-secondary) 70%, transparent);
  }

  .sub-menu-pills {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sub-menu-compare-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sub-menu-compare-row {
    display: block;
    gap: 0;
    align-items: center;
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
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 80%, transparent) inset,
      0 4px 10px rgba(0, 0, 0, 0.10);
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
    overflow: visible;
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
    z-index: 30;
    pointer-events: none;
  }

  .ts-row--lane-1,
  .ts-row--lane-2,
  .ts-row--lane-3,
  .ts-row--lane-4 {
    height: 19.5px;
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
    padding: 0 34px 0 8px;
    margin: 0;
    pointer-events: auto;
    transition: opacity 200ms ease, filter 200ms ease, transform 200ms ease, box-shadow 200ms ease;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset,
      0 5px 12px rgba(0, 0, 0, 0.10);
  }

  .source-pill-wrap {
    position: absolute;
    top: -16px;
    bottom: 0;
    width: var(--pill-width);
    min-width: var(--pill-min-width);
    pointer-events: auto;
  }

  .source-pill-wrap.is-open {
    z-index: 80;
  }

  .source-pill-wrap.is-open .source-block {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--c) 70%, white),
      0 12px 24px rgba(0, 0, 0, 0.18);
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
    box-shadow:
      0 1px 6px rgba(0, 0, 0, 0.14),
      0 0 0 1px color-mix(in srgb, white 38%, transparent) inset;
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
    box-shadow:
      0 1px 6px rgba(0, 0, 0, 0.12),
      0 0 0 2px color-mix(in srgb, var(--c) 55%, white);
  }

  .source-menu-popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    transform: none;
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

  .source-menu-pane {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source-menu-pane-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    align-self: flex-start;
    padding: 4px 8px;
    border-radius: var(--radius-pill);
  }

  .source-menu-pane-label--left {
    background: var(--pane-left-badge-bg);
    color: var(--pane-left-badge-text);
  }

  .source-menu-pane-label--right {
    background: var(--pane-right-badge-bg);
    color: var(--pane-right-badge-text);
  }

  .source-block:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--c) 68%, white);
    outline-offset: 2px;
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
    box-shadow:
      0 0 0 2px var(--surface-outline),
      var(--shadow-sm);
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

  .ts-row--lane-1 .source-block.is-current,
  .ts-row--lane-2 .source-block.is-current {
    transform: translateY(-2px) scale(1.03, 1.18);
    transform-origin: bottom center;
    box-shadow:
      0 10px 22px rgba(0, 0, 0, 0.16),
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset,
      0 0 0 1px var(--pill-inset-active) inset;
  }

  .ts-row--lane-3 .source-block.is-current,
  .ts-row--lane-4 .source-block.is-current {
    transform: translateY(2px) scale(1.03, 1.18);
    transform-origin: top center;
    box-shadow:
      0 10px 22px rgba(0, 0, 0, 0.16),
      0 0 0 1px color-mix(in srgb, var(--surface-outline-soft) 75%, transparent) inset,
      0 0 0 1px var(--pill-inset-active) inset;
  }

  .block-label {
    position: relative;
    display: block;
    z-index: 4;
    font-family: var(--font-ui);
    font-size: 9px;
    font-weight: 700;
    color: var(--text-on-accent);
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
    max-width: none;
    text-align: center;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    pointer-events: none;
  }

  .block-label-measure {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
    font-family: var(--font-ui);
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .ts-axis-line {
    position: relative;
    height: 10px;
    background: var(--timeline-track-bg);
    border-radius: var(--radius-pill);
    z-index: 20;
    isolation: isolate;
    overflow: visible;
    pointer-events: auto;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--surface-inset-strong) 80%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--surface-outline-soft) 90%, transparent);
  }

  .ts-scrub-indicator {
    position: absolute;
    top: -22px;
    bottom: 0;
    width: 4px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: var(--pane-color);
    z-index: 21;
    pointer-events: none;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--surface-raised) 42%, transparent),
      0 4px 10px color-mix(in srgb, var(--pane-color) 18%, transparent);
  }

  .ts-scrub-indicator--single {
    background: var(--text-secondary);
  }

  .ts-scrub-indicator.is-disabled {
    opacity: 0.4;
    filter: saturate(0.18);
  }


  .scrubber-label {
    position: absolute;
    top: -34px;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--pane-badge-text);
    background: var(--pane-badge-bg);
    border: 2px solid rgba(24, 18, 10, 0.82);
    border-radius: 99px;
    padding: 7px 12px;
    white-space: nowrap;
    pointer-events: auto;
    cursor: ew-resize;
    touch-action: none;
    z-index: 24;
    box-shadow:
      0 0 0 2px var(--scrubber-badge-ring),
      var(--shadow-md);
  }

  .scrubber-label.is-disabled {
    opacity: 0.42;
    filter: saturate(0.18);
    pointer-events: none;
    cursor: default;
  }

  .scrubber-label--single {
    color: var(--text-secondary);
    background: var(--surface-floating);
    border-radius: 999px;
    padding: 7px 12px;
  }

  .scrubber-label--right {
    top: -34px;
  }

  .ts-scrubber {
    position: absolute;
    left: 0;
    top: -40px;
    height: 42px;
    width: 100%;
    margin: 0;
    padding: 0;
    z-index: 25;
    cursor: ew-resize;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background: transparent;
    border: none;
    outline: none;
    accent-color: transparent;
    pointer-events: auto;
  }

  .ts-scrubber.is-disabled {
    opacity: 0.34;
    filter: saturate(0.18);
  }

  .ts-scrubber--right {
    z-index: 22;
  }

  .ts-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 72px;
    height: 34px;
    border-radius: 50%;
    background: transparent;
    border: none;
    cursor: ew-resize;
    box-shadow: none;
    pointer-events: auto;
  }

  .ts-scrubber.is-disabled::-webkit-slider-thumb {
    cursor: default;
    box-shadow: none;
  }

  .ts-scrubber::-webkit-slider-thumb:hover {
    box-shadow: none;
  }

  .ts-scrubber::-moz-range-thumb {
    -moz-appearance: none;
    width: 72px;
    height: 34px;
    border-radius: 50%;
    background: transparent;
    border: none;
    cursor: ew-resize;
    box-shadow: none;
    pointer-events: auto;
  }

  .ts-scrubber.is-disabled::-moz-range-thumb {
    cursor: default;
    box-shadow: none;
  }

  .ts-scrubber::-moz-focus-outer {
    border: 0;
  }

  .ts-scrubber--single {
    --pane-color: var(--surface-outline);
  }

  .ts-scrubber::-webkit-slider-runnable-track {
    height: 42px;
    background: transparent;
  }

  .ts-scrubber::-moz-range-track {
    height: 42px;
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

  :global(.pill-hover-tip) {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: 999px;
    background: var(--surface-floating);
    border: 1px solid var(--surface-outline-soft);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  :global(.pill-hover-tip-range) {
    opacity: 0.65;
  }

  /* Layer info modal (similar to site-info modal) */
  .layer-info-backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(17, 15, 11, 0.26);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 88px 20px 20px;
  }

  .layer-info-modal {
    width: min(760px, calc(100vw - 40px));
    max-height: min(72vh, 760px);
    overflow: auto;
    padding: 22px 24px 20px;
    color: var(--text-primary);
    /* Override ui-panel-overlay dark overlay bg with the warm panel surface */
    background: var(--surface-floating);
    backdrop-filter: blur(6px);
    border-color: var(--surface-outline-soft);
    box-shadow: 0 8px 32px rgba(40, 30, 10, 0.14), 0 2px 6px rgba(40, 30, 10, 0.08);
  }

  .layer-info-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--border-ui) 82%, transparent);
  }

  .layer-info-head h2 {
    margin: 6px 0 0;
    font-size: clamp(20px, 1.8vw, 26px);
    line-height: 1.08;
    letter-spacing: -0.02em;
    font-weight: 700;
  }

  .layer-info-close {
    flex: 0 0 auto;
  }

  .layer-info-body {
    font-family: var(--font-ui);
  }

  .layer-info-body p {
    margin: 0 0 14px;
    max-width: 64ch;
    font-size: 14px;
    line-height: 1.68;
    color: color-mix(in srgb, var(--text-primary) 94%, white 6%);
  }

  @media (max-width: 700px) {
    .layer-info-backdrop {
      padding: 60px 20px 20px;
    }

    .layer-info-modal {
      width: min(100vw - 24px, 760px);
      max-height: min(78vh, 760px);
      padding: 18px 18px 16px;
    }

    .layer-info-head {
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 12px;
    }

    .layer-info-head h2 {
      font-size: 20px;
    }
  }
</style>
