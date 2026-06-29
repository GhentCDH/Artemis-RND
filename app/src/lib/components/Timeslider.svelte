<!-- app/src/lib/components/Timeslider.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import type { MassartItem } from '$lib/artemis/shared/types';
  import { MAIN_LAYER_LABELS, MAIN_LAYER_META, SUB_LAYER_DEFS } from '$lib/artemis/config/layers';
  import SliderLayer from '$lib/components/SliderLayer.svelte';
  import type { LayerMetadata, PaneId, SliderSource, CollectionInfo } from '$lib/components/timeslider/types';

  export let layerMetadataByMainId: Record<string, LayerMetadata> = {};
  export let massartItems: MassartItem[] = [];
  export let loadingLayers: Record<string, boolean> = {};
  export let dualPaneEnabled = false;
  export let searchFocusMainId: string | null = null;
  export let initialLeftMainId: string | null = null;
  export let initialRightMainId: string | null = null;
  export let searchFocusNonce = 0;
  export let activeCollection: CollectionInfo | null = null;
  export let rightActiveCollection: CollectionInfo | null = null;
  export let clearLeftCollectionNonce = 0;
  export let clearRightCollectionNonce = 0;

  const dispatch = createEventDispatcher<{
    mainToggle:     { mainId: string; enabled: boolean };
    sublayerChange: { subId: string; enabled: boolean };
    paneMainToggle: { pane: PaneId; mainId: string; enabled: boolean };
    paneSublayerChange: { pane: PaneId; subId: string; enabled: boolean };
    'active-collection-change': { key: string | null; pane?: PaneId };
    'open-viewer':  { title: string; sourceManifestUrl: string; imageServiceUrl: string };
    'focus-image':  { pane: PaneId; title: string; lon: number; lat: number };
  }>();

  const SOURCES: SliderSource[] = [
    {
      key: 'hand', mainId: 'HanddrawnCollection', label: MAIN_LAYER_LABELS.HanddrawnCollection,
      start: 1700, end: 1715, repr: 1707, color: 'var(--timeline-layer-color)', lane: 1,
      sublayers: [
        { id: 'iiif', subId: 'HanddrawnCollection-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'HanddrawnCollection-parcels', label: 'Parcels', defaultOn: false },
      ],
    },
    {
      key: 'frickx', mainId: 'Frickx', label: MAIN_LAYER_LABELS.Frickx,
      start: 1712, end: 1712, repr: 1712, color: 'var(--timeline-layer-color)', lane: 3,
      sublayers: [
        { id: 'wmts', subId: 'Frickx-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'villaret', mainId: 'Villaret', label: MAIN_LAYER_LABELS.Villaret,
      start: 1745, end: 1748, repr: 1746, color: 'var(--timeline-layer-color)', lane: 4,
      sublayers: [
        { id: 'wmts', subId: 'Villaret-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'ferraris', mainId: 'Ferraris', label: MAIN_LAYER_LABELS.Ferraris,
      start: 1770, end: 1778, repr: 1774, color: 'var(--timeline-layer-color)', lane: 2,
      sublayers: [
        { id: 'wmts', subId: 'Ferraris-wmts', label: 'Map', defaultOn: true },
        { id: 'landuse', subId: 'Ferraris-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'primitief', mainId: 'PrimitiefKadaster', label: MAIN_LAYER_LABELS.PrimitiefKadaster,
      start: 1808, end: 1834, repr: 1814, color: 'var(--timeline-layer-color)', lane: 3,
      sublayers: [
        { id: 'iiif', subId: 'PrimitiefKadaster-iiif', label: 'Map', defaultOn: true },
        { id: 'parcels', subId: 'PrimitiefKadaster-parcels', label: 'Parcels', defaultOn: false },
      ],
    },
    {
      key: 'vander', mainId: 'Vandermaelen', label: MAIN_LAYER_LABELS.Vandermaelen,
      start: 1846, end: 1854, repr: 1850, color: 'var(--timeline-layer-color)', lane: 4,
      sublayers: [
        { id: 'wmts', subId: 'Vandermaelen-wmts', label: 'Map', defaultOn: true },
        { id: 'landuse', subId: 'Vandermaelen-landusage', label: 'Land use', defaultOn: false },
      ],
    },
    {
      key: 'gered', mainId: 'GereduceerdeKadaster', label: MAIN_LAYER_LABELS.GereduceerdeKadaster,
      start: 1847, end: 1855, repr: 1851, color: 'var(--timeline-layer-color)', lane: 1,
      sublayers: [
        { id: 'iiif', subId: 'GereduceerdeKadaster-iiif', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'popp', mainId: 'Popp', label: MAIN_LAYER_LABELS.Popp,
      start: 1842, end: 1879, repr: 1860, color: 'var(--timeline-layer-color)', lane: 2,
      sublayers: [
        { id: 'wmts', subId: 'Popp-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'ngi1873', mainId: 'NGI1873', label: MAIN_LAYER_LABELS.NGI1873,
      start: 1873, end: 1873, repr: 1873, color: 'var(--timeline-layer-color)', lane: 3,
      sublayers: [
        { id: 'wmts', subId: 'NGI1873-wmts', label: 'Map', defaultOn: true },
      ],
    },
    {
      key: 'ngi1904', mainId: 'NGI1904', label: MAIN_LAYER_LABELS.NGI1904,
      start: 1904, end: 1904, repr: 1904, color: 'var(--timeline-layer-color)', lane: 1,
      sublayers: [
        { id: 'wmts', subId: 'NGI1904-wmts', label: 'Map', defaultOn: true },
      ],
    },
  ];

  type SourceDef = SliderSource;
  type SourceKey = SourceDef['key'];
  type BulgeDirection = 'above' | 'below';
  const TIMELINE_AXIS_START = 1690;
  const TIMELINE_AXIS_END = 1930;
  const MEANDER_MIN_WIDTH_PX = 24;
  const MEANDER_MIN_SPAN_YEARS = 15;
  const MEANDER_DIRECTIONS: Partial<Record<SourceKey, BulgeDirection>> = {
    hand: 'above',
    ferraris: 'below',
    primitief: 'above',
    vander: 'below',
    gered: 'above',
  };

  let trackEl: HTMLDivElement | null = null;
  let trackWidth = 0;
  let lastSearchFocusNonce = 0;

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
  let layerInfoModalKey: string | null = null;
  let leftActiveSourceKey: string | null = null;
  let rightActiveSourceKey: string | null = null;
  let nextComparePane: PaneId = 'left';
  let lastPublishedLeftCollectionKey: string | null = null;
  let lastPublishedRightCollectionKey: string | null = null;
  let lastClearLeftCollectionNonce = 0;
  let lastClearRightCollectionNonce = 0;

  let hoveredSrc: SourceDef | null = null;
  let tooltipFixedStyle = '';

  // Hardcoded stable axis bounds:
  // historical map eras start at 1700; current Massart dataset spans 1904-1912.
  // We keep the decade-padded range fixed to avoid runtime layout churn.
  const axisStart = TIMELINE_AXIS_START;
  const axisEnd = TIMELINE_AXIS_END;
  const axisSpan = axisEnd - axisStart;

  function buildTicks(start: number, end: number): number[] {
    const years: number[] = [];
    for (let y = Math.ceil(start / 50) * 50; y <= end; y += 50) {
      years.push(y);
    }
    return years;
  }

  $: ticks = buildTicks(axisStart, axisEnd);

  function pct(year: number, aStart: number, aSpan: number): string {
    return `${((year - aStart) / aSpan) * 100}%`;
  }

  function axisTickStyle(year: number): string {
    return `left:${pct(year, axisStart, axisSpan)}`;
  }

  function axisCurvePath(): string {
    return 'M 0 14 L 100 14';
  }

  $: axisPath = axisCurvePath();

  function widthPct(start: number, end: number, aSpan: number): string {
    return `${((end - start) / aSpan) * 100}%`;
  }

  function onPillEnter(src: SourceDef, e: MouseEvent) {
    hoveredSrc = src;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    // getBoundingClientRect is in visual (post-zoom) coords; position:fixed uses layout
    // coords (html zoom scales fixed children too). Divide to convert.
    const cssZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const cx = (rect.left + rect.width / 2) / cssZoom;
    if (sourceBulgeDirection(src) === 'above') {
      tooltipFixedStyle = `left:${cx}px;top:${rect.bottom / cssZoom + 8}px;transform:translateX(-50%)`;
    } else {
      tooltipFixedStyle = `left:${cx}px;top:${rect.top / cssZoom - 8}px;transform:translate(-50%,-100%)`;
    }
  }

  function onPillLeave() {
    hoveredSrc = null;
  }

  function distanceToPath(path: SVGPathElement, clientX: number, clientY: number): number {
    const ctm = path.getScreenCTM();
    if (!ctm) return Number.POSITIVE_INFINITY;
    const totalLength = path.getTotalLength();
    const samples = 56;
    let nearest = Number.POSITIVE_INFINITY;

    for (let i = 0; i <= samples; i += 1) {
      const point = path.getPointAtLength((totalLength * i) / samples);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(ctm);
      const dx = screenPoint.x - clientX;
      const dy = screenPoint.y - clientY;
      const distance = Math.hypot(dx, dy);
      if (distance < nearest) nearest = distance;
    }

    return nearest;
  }

  function nearestSourceFromClick(event: MouseEvent, fallback: SourceDef): SourceDef {
    if (!trackEl) return fallback;
    const paths = Array.from(trackEl.querySelectorAll<SVGPathElement>('.meander-hit'));
    let bestSource = fallback;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const path of paths) {
      const sourceKey = path.dataset.sourceKey as SourceKey | undefined;
      if (!sourceKey) continue;
      const distance = distanceToPath(path, event.clientX, event.clientY);
      if (distance < bestDistance) {
        const source = sourceByKey(sourceKey);
        if (source) {
          bestSource = source;
          bestDistance = distance;
        }
      }
    }

    return bestDistance <= 18 ? bestSource : fallback;
  }

  function onMeanderClick(src: SourceDef, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    const clickedSource = e instanceof MouseEvent ? nearestSourceFromClick(e, src) : src;
    const key = clickedSource.key;
    if (!dualPaneEnabled) {
      leftActiveSourceKey = leftActiveSourceKey === key ? null : key;
      rightActiveSourceKey = null;
      return;
    }

    if (leftActiveSourceKey === key) {
      leftActiveSourceKey = null;
      nextComparePane = 'left';
      return;
    }
    if (rightActiveSourceKey === key) {
      rightActiveSourceKey = null;
      nextComparePane = 'right';
      return;
    }

    let targetPane = nextComparePane;
    if (!leftActiveSourceKey) {
      targetPane = 'left';
    } else if (!rightActiveSourceKey) {
      targetPane = 'right';
    }

    if (targetPane === 'right') {
      rightActiveSourceKey = key;
      leftActiveSourceKey = leftActiveSourceKey === key ? null : leftActiveSourceKey;
      nextComparePane = 'left';
    } else {
      leftActiveSourceKey = key;
      rightActiveSourceKey = rightActiveSourceKey === key ? null : rightActiveSourceKey;
      nextComparePane = 'right';
    }
  }

  function sourceByKey(key: SourceKey): SourceDef {
    return SOURCES.find((src) => src.key === key)!;
  }

  function sourceByMainId(mainId: string): SourceDef | undefined {
    return SOURCES.find((src) => src.mainId === mainId);
  }

  function buildCollectionInfo(src: SourceDef): CollectionInfo {
    const meta = MAIN_LAYER_META[src.mainId];
    const layerInfo = mainLayerInfoCard(src.mainId, src.label);
    return {
      key: src.key,
      mainId: src.mainId,
      name: src.label,
      color: src.color,
      dateRange: meta?.date ?? `${src.start}–${src.end}`,
      info: layerInfo.info.join('\n\n'),
      sublayers: src.sublayers.map(sub => ({
        id: sub.id,
        subId: sub.subId,
        label: sub.label,
        kind: SUB_LAYER_DEFS[sub.subId]?.kind,
        url: undefined,
      })),
    };
  }

  function layerInfoKey(pane: PaneId, mainId: string): string {
    return `${pane}:${mainId}`;
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
      const rightVisible = rightEnabledLayers[key] && rightActiveSourceKey === key;
      if (rightVisible) {
        dispatch('paneSublayerChange', { pane: 'right', subId, enabled: !cur });
      }
      return;
    }

    leftSublayerState = {
      ...leftSublayerState,
      [key]: { ...leftSublayerState[key], [localId]: !cur },
    };
    const leftVisible = leftEnabledLayers[key] && leftActiveSourceKey === key;
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

  function sourceMinWidthPx(_src: SourceDef): number {
    return MEANDER_MIN_WIDTH_PX;
  }

  function sourceBulgeDirection(src: SourceDef): BulgeDirection {
    return MEANDER_DIRECTIONS[src.key] ?? (src.lane <= 2 ? 'above' : 'below');
  }

  function sourceVisualYearRange(src: SourceDef): { start: number; end: number; center: number } {
    const center = (src.start + src.end) / 2;
    const span = Math.max(src.end - src.start, MEANDER_MIN_SPAN_YEARS);
    return {
      start: center - span / 2,
      end: center + span / 2,
      center,
    };
  }

  function visualRangesOverlap(a: SourceDef, b: SourceDef): boolean {
    const aRange = sourceVisualYearRange(a);
    const bRange = sourceVisualYearRange(b);
    return aRange.start < bRange.end && bRange.start < aRange.end;
  }

  function assignTimelineLanes(sources: SourceDef[]): SourceDef[] {
    const assignedByKey = new Map<SourceKey, number>();

    for (const direction of ['above', 'below'] as const) {
      const innerLane = direction === 'above' ? 2 : 3;
      const outerLane = direction === 'above' ? 1 : 4;
      const innerLaneSources: SourceDef[] = [];

      const directionSources = sources
        .filter((source) => sourceBulgeDirection(source) === direction)
        .sort((a, b) => sourceVisualYearRange(a).start - sourceVisualYearRange(b).start);

      for (const source of directionSources) {
        const collidesWithInner = innerLaneSources.some((innerSource) => visualRangesOverlap(source, innerSource));
        if (collidesWithInner) {
          assignedByKey.set(source.key, outerLane);
        } else {
          assignedByKey.set(source.key, innerLane);
          innerLaneSources.push(source);
        }
      }
    }

    return sources.map((source) => ({
      ...source,
      lane: assignedByKey.get(source.key) ?? source.lane,
    }));
  }

  function sourceBlockStyle(src: SourceDef, isCurrent: boolean): string {
    const visualRange = sourceVisualYearRange(src);
    const wrapperTransform = 'translateX(-50%)';
    const currentZ = isCurrent ? '28' : '26';
    if (trackWidth <= 0) {
      return `left:${pct(visualRange.center, axisStart, axisSpan)};--pill-width:${widthPct(visualRange.start, visualRange.end, axisSpan)};--pill-min-width:${sourceMinWidthPx(src)}px;--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)};--pill-wrapper-transform:${wrapperTransform};--pill-z:${currentZ}`;
    }

    const startPx = ((visualRange.start - axisStart) / axisSpan) * trackWidth;
    const endPx = ((visualRange.end - axisStart) / axisSpan) * trackWidth;
    const rangeWidthPx = Math.abs(endPx - startPx);
    const widthPx = Math.max(rangeWidthPx, sourceMinWidthPx(src));
    const centerPx = (startPx + endPx) / 2;
    const clampedCenterPx = Math.max(widthPx / 2, Math.min(trackWidth - widthPx / 2, centerPx));
    return `left:${clampedCenterPx}px;--pill-width:${widthPx}px;--pill-min-width:${sourceMinWidthPx(src)}px;--c:${src.color};--pattern:${sourcePattern(src.key)};--pattern-size:${sourcePatternSize(src.key)};--pill-wrapper-transform:${wrapperTransform};--pill-z:${currentZ}`;
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

    // Measure once immediately so pill positioning does not switch from the
    // percentage fallback to pixel positioning on first interaction.
    syncTrackWidth();
    void tick().then(syncTrackWidth);
    if (browser && 'fonts' in document) {
      void (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => {
        syncTrackWidth();
      });
    }
    scheduleTrackWidthSync();
    if (trackEl) {
      trackResizeObserver = new ResizeObserver(scheduleTrackWidthSync);
      trackResizeObserver.observe(trackEl);
    }

    // Restore active layers from URL state if provided.
    const leftInitSrc = initialLeftMainId ? SOURCES.find(s => s.mainId === initialLeftMainId) : null;
    if (leftInitSrc) leftActiveSourceKey = leftInitSrc.key;
    const rightInitSrc = initialRightMainId ? SOURCES.find(s => s.mainId === initialRightMainId) : null;
    if (rightInitSrc) rightActiveSourceKey = rightInitSrc.key;

    for (const src of SOURCES) {
      const visible = leftActiveSourceKey === src.key;
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
        const rightVisible = rightActiveSourceKey === src.key;
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

  $: if (searchFocusNonce !== lastSearchFocusNonce) {
    lastSearchFocusNonce = searchFocusNonce;
    if (searchFocusMainId) {
      const src = sourceByMainId(searchFocusMainId);
      if (src) {
        leftActiveSourceKey = src.key;
      }
    }
  }

  $: leftActiveVisibility = SOURCES.reduce<Record<SourceKey, boolean>>((acc, src) => {
    acc[src.key] = Boolean(leftEnabledLayers[src.key] && leftActiveSourceKey === src.key);
    return acc;
  }, {} as Record<SourceKey, boolean>);
  $: rightActiveVisibility = SOURCES.reduce<Record<SourceKey, boolean>>((acc, src) => {
    acc[src.key] = Boolean(dualPaneEnabled && rightEnabledLayers[src.key] && rightActiveSourceKey === src.key);
    return acc;
  }, {} as Record<SourceKey, boolean>);

  $: timelineSources = assignTimelineLanes(SOURCES);
  $: lanes = [1, 2, 3, 4].map((lane) => ({
    lane,
    sources: timelineSources.filter((source) => source.lane === lane),
  }));
  $: topLanes = lanes
    .map(({ lane, sources }) => ({
      lane,
      sources: sources.filter((source) => sourceBulgeDirection(source) === 'above'),
    }))
    .filter(({ sources }) => sources.length > 0);
  $: bottomLanes = lanes
    .map(({ lane, sources }) => ({
      lane,
      sources: sources.filter((source) => sourceBulgeDirection(source) === 'below'),
    }))
    .filter(({ sources }) => sources.length > 0);


  $: if (!dualPaneEnabled && rightActiveSourceKey) {
    rightActiveSourceKey = null;
  }

  $: if (clearLeftCollectionNonce !== lastClearLeftCollectionNonce) {
    lastClearLeftCollectionNonce = clearLeftCollectionNonce;
    leftActiveSourceKey = null;
  }

  $: if (clearRightCollectionNonce !== lastClearRightCollectionNonce) {
    lastClearRightCollectionNonce = clearRightCollectionNonce;
    rightActiveSourceKey = null;
  }

  $: {
    const nextCollection = leftActiveSourceKey
      ? buildCollectionInfo(sourceByKey(leftActiveSourceKey))
      : null;
    const nextKey = nextCollection?.key ?? null;
    if (nextKey !== lastPublishedLeftCollectionKey) {
      activeCollection = nextCollection;
      lastPublishedLeftCollectionKey = nextKey;
      dispatch('active-collection-change', { key: nextKey, pane: 'left' });
    }
  }

  $: {
    const nextCollection = dualPaneEnabled && rightActiveSourceKey
      ? buildCollectionInfo(sourceByKey(rightActiveSourceKey))
      : null;
    const nextKey = nextCollection?.key ?? null;
    if (nextKey !== lastPublishedRightCollectionKey) {
      rightActiveCollection = nextCollection;
      lastPublishedRightCollectionKey = nextKey;
      dispatch('active-collection-change', { key: nextKey, pane: 'right' });
    }
  }

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
    {#each topLanes as lane}
      <div class={`ts-row ts-row--lane-${lane.lane}`}></div>
    {/each}
    
    <div class="ts-axis-line">
      <svg class="ts-axis-river" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path class="ts-axis-river-bank" d={axisPath}></path>
        <path class="ts-axis-river-current" d={axisPath}></path>
      </svg>

      {#each timelineSources as src}
        {@const enabled = !dualPaneEnabled ? leftEnabledLayers[src.key] : (leftEnabledLayers[src.key] || rightEnabledLayers[src.key])}
        {@const isCurrent = leftActiveSourceKey === src.key || (dualPaneEnabled && rightActiveSourceKey === src.key)}
        {@const hasActiveSelection = leftActiveSourceKey !== null || (dualPaneEnabled && rightActiveSourceKey !== null)}
        <SliderLayer
          {src}
          {enabled}
          {isCurrent}
          isDimmed={hasActiveSelection && !isCurrent}
          bulgeDirection={sourceBulgeDirection(src)}
          hasOverlap={false}
          loading={loadingLayers[src.mainId]}
          sourceBlockStyle={sourceBlockStyle(src, isCurrent)}
          onMeanderClick={onMeanderClick}
          onPillEnter={onPillEnter}
          onPillLeave={onPillLeave}
        />
      {/each}

    </div>

    {#each bottomLanes as lane}
      <div class={`ts-row ts-row--lane-${lane.lane}`}></div>
    {/each}

    <div class="ts-ticks" aria-hidden="true">
      {#each ticks as tick}
        <span class="ts-tick" style={axisTickStyle(tick)}>
          <span class="ts-tick-label">{tick}</span>
        </span>
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
  .timeslider {
    background: var(--window-background);
    border: 0.5px solid var(--window-border);
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 0;
    padding: 12px 16px 10px;
    user-select: none;
    font-family: var(--font-ui);
    box-shadow: var(--window-shadow);
    pointer-events: auto;
  }

  .ts-track {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding-bottom: 15px;
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
    height: 24px;
  }

  .ts-axis-line {
    position: relative;
    height: 10px;
    background: transparent;
    z-index: 20;
    isolation: isolate;
    overflow: visible;
    pointer-events: auto;
  }

  .ts-axis-river {
    position: absolute;
    left: -64px;
    top: -9px;
    width: calc(100% + 128px);
    height: 28px;
    overflow: visible;
    pointer-events: none;
    z-index: 0;
  }

  .ts-axis-river-bank,
  .ts-axis-river-current {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .ts-axis-river-bank {
    opacity: 0;
    stroke-width: 0;
  }

  .ts-axis-river-current {
    stroke: var(--timeline-layer-color);
    stroke-width: calc(var(--river-stroke-width) * 0.42);
    opacity: 1;
  }

  .ts-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
    width: var(--timeline-tick-line-width);
    pointer-events: none;
    z-index: 1;
  }

  .ts-tick::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: var(--timeline-tick-label-gap);
    left: 50%;
    width: var(--timeline-tick-line-width);
    transform: translateX(-50%);
    background: var(--timeline-tick-line-color);
  }

  .ts-ticks {
    position: absolute;
    inset: 0;
    z-index: 35;
    pointer-events: none;
  }

  .ts-tick-label {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translate(-50%, var(--timeline-tick-label-offset-y));
    font-family: var(--timeline-tick-label-font);
    font-size: var(--timeline-tick-label-size);
    color: var(--timeline-tick-label-color);
    white-space: nowrap;
  }

  :global(.pill-hover-tip) {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: var(--radius-pill);
    background: var(--window-background);
    border: 1px solid var(--window-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08);
    font-family: var(--font-ui);
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
    /* Override ui-panel-overlay with the warm panel surface */
    background: var(--window-background);
    backdrop-filter: blur(6px);
    border-color: var(--window-border);
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
    font-family: var(--font-readable);
  }

  .layer-info-body p {
    margin: 0 0 14px;
    max-width: 64ch;
    font-size: var(--text-readable-size);
    line-height: var(--text-readable-line-height);
    color: var(--text-readable);
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
