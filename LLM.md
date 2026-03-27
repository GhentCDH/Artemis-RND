# Artemis-RnD — LLM Context

_Last updated: 2026-03-27 (performance pass + bug fixes: annotation loop yield, WMTS startup re-sync, gereduceerd/vandermaelen z-order)_

## What this repo is

Artemis-RnD is a SvelteKit viewer and test harness for historical Belgian maps. It consumes preprocessed data from the companion repo `GhentCDH/Artemis-RnD-Data`, renders warped IIIF layers with Allmaps on a MapLibre map, overlays WMTS/WMS/GeoJSON layers, and supports manifest/toponym search plus IIIF viewing.

This repo is the viewer, not the data pipeline.

## Current repo state

- Active branch: `swipeslider`
- Active UI: `app/src/lib/components/Timeslider.svelte`
- Legacy UI files still present but not mounted: `app/src/lib/artemis/ui/LayersPanel.svelte`, `app/src/lib/artemis/ui/TimelineSlider.svelte`
- Default dataset URL in code: `https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build`
- `+page.svelte` also loads `Massart/index.json` and syncs timeline dots with map pins
- `FEATURE_FLAGS.startupPreloadScreen` is currently `false` — startup warmup is disabled; IIIF layers load on first scrub
- `FEATURE_FLAGS.debugMenu` is currently `false` — all `log()` calls are no-ops in production

## Tech stack

- SvelteKit 2 + Svelte 5
- TypeScript + Vite + pnpm
- MapLibre GL 5
- `@allmaps/maplibre` `1.0.0-beta.42`
- `@allmaps/id` `1.0.0-beta.37`
- `openseadragon` `6.0.1`

## High-value files

| File | Purpose |
|---|---|
| `app/src/routes/+page.svelte` | Main shell: map init, dataset loading, layer toggles, hover/click handling, search wiring, viewer state, Massart loading |
| `app/src/lib/components/Timeslider.svelte` | Active timeline UI: era pills, single/dual scrubbers, per-pane sublayer menus, timeline dots, viewer-open events |
| `app/src/lib/artemis/runner.ts` | Core IIIF runner: loads compiled index + annotations, builds `WarpedMapLayer`s, parks/restores/removes groups, emits render stats, stores pane-scoped runtime state |
| `app/src/lib/artemis/map/mapInit.ts` | MapLibre setup and helpers for WMTS/WMS/GeoJSON/hover masks/Massart pins |
| `app/src/lib/artemis/layerConfig.ts` | Main layer IDs, labels, colors, sublayer definitions, initial state factories |
| `app/src/lib/artemis/layerGroups.ts` | Tracks active parked/restored IIIF layer groups |
| `app/src/lib/artemis/types.ts` | Shared UI/data types including `IiifMapInfo`, `PinnedCard`, `MassartItem`, `PreviewBubbleItem` |
| `app/src/lib/artemis/ui/ToponymSearch.svelte` | Unified search overlay |
| `app/src/lib/artemis/ui/InfoCards.svelte` | Current floating cards for parcel click state and pinned items; no longer used for transient IIIF click results |
| `app/src/lib/artemis/ui/DebugMenu.svelte` | Internal debug surface for dataset URL override, reload controls, logs, render stats; gated by `FEATURE_FLAGS.debugMenu` in `+page.svelte` |
| `app/src/lib/artemis/ui/ImageCollectionBubble.svelte` | Anchored popup for image-collection pins with preview + explicit viewer-open action |
| `app/src/lib/artemis/viewer/IiifViewer.svelte` | IIIF viewer overlay |
| `app/src/lib/artemis/viewer/manifestPreview.ts` | Shared manifest parsing helper for preview thumbnails and image-service extraction |

## Layer model

### Main layers

| ID | Label | Date | Color | Backing type |
|---|---|---|---|---|
| `ferraris` | Ferraris | 1771 | `#6aaa5a` | WMTS |
| `vandermaelen` | Vandermaelen | 1846 | `#c45000` | WMTS |
| `primitief` | Primitief kadaster | 1808-1834 | `#c97a2e` | IIIF |
| `gereduceerd` | Gereduceerd kadaster | 1847-1855 | `#a0b020` | IIIF |
| `handdrawn` | Hand drawn collection | 19th c. | `#888780` | IIIF |

### Sublayer kinds

- `wmts`: HISTCART base layers
- `wms`: land usage overlays
- `iiif`: Allmaps `WarpedMapLayer`
- `geojson`: parcels / land usage / water overlays
- `searchable`: search-only, no rendered layer

### Important state detail

`layerConfig.ts` initializes all main and sublayers to `false`, but the live initial visible state is driven by `Timeslider.svelte` via `mainToggle` and `sublayerChange` events on mount. The slider's current year determines which eras are active.

For IIIF main layers, visible state is still reconciled in `+page.svelte` through `scheduleIiifMainLayerSync(mainId)` rather than trusting raw UI event order.

## Timeslider

`app/src/lib/components/Timeslider.svelte` is the live timeline control.

### Era sources in the component

| key | mainId | Label | Range | Representative year |
|---|---|---|---|---|
| `hand` | `handdrawn` | Hand drawn | 1700-1715 | 1707 |
| `ferraris` | `ferraris` | Ferraris | 1770-1778 | 1774 |
| `primitief` | `primitief` | Primitief Kadaster | 1808-1834 | 1814 |
| `vander` | `vandermaelen` | Vandermaelen | 1846-1854 | 1850 |
| `gered` | `gereduceerd` | Gereduceerd Kadaster | 1847-1855 | 1851 |

### Behavior

- Scrubbing over an era pill makes that era visible if its local enabled state is on
- Clicking an era pill toggles that main layer; enabling jumps the scrubber to the era's representative year
- Enabled pills stay expanded while active; disabled pills do not expand
- In single-pane mode, a floating white panel shows grouped sublayer menus for eras currently under the scrubber
- In dual-pane mode, each pane gets its own sublayer menu based on that pane's scrubber position; the menu no longer follows whichever scrubber is visually on top
- Overlapping eras render as separate vertically stacked submenus, each labeled by layer
- If a main layer is disabled, all sublayer pills in that layer's submenu are slightly muted even if locally toggled on
- `loadingLayers` passed from `+page.svelte` adds a shimmer state to era pills during IIIF load/restore work
- The scrubber is intentionally visually dominant: thicker rail, larger thumb, higher z-index than pills/ticks
- The axis range is reactive and expands to include loaded Massart years
- Massart items are grouped by year and rendered as clickable dots on the same timeline
- Clicking a timeline dot opens a small dot popup with metadata and an `Open in viewer` button
- Dual-pane mode uses fixed viewport-identity colours distinct from dataset colours
- Left viewport identity color is teal; right viewport identity color is purple
- Split/swipe scrubber years persist across mode toggles

### Events dispatched

- `mainToggle: { mainId, enabled }`
- `sublayerChange: { subId, enabled }`
- `year-change: { pane, year }`
- `open-viewer: { title, sourceManifestUrl, imageServiceUrl }`

## Dual-pane modes

`+page.svelte` now uses `viewMode: 'single' | 'split' | 'swipe'`.

Current behavior:

- `split`: two half-width panes side by side, each with the same synced location/camera
- `swipe`: both maps occupy the full stage and the right pane is revealed with a draggable mask
- the app creates an independent right-side `MapLibre` instance for both dual-pane modes
- left and right panes have independent selected years but synchronized camera state
- pane-specific IIIF loading uses pane-scoped runner runtime state (`main` vs `right`)
- the right pane has its own IIIF hover/click interaction path and its own anchored preview bubble positioning
- left/right year state and right-pane desired visibility state persist across dual-pane toggles
- when dual-pane mode is torn down, `runner.ts` right-pane runtime state must be reset; otherwise stale parked/active group bookkeeping can suppress IIIF reload on the next enable
- search remains global rather than pane-scoped

## Data flow

1. `+page.svelte` loads `{baseUrl}/index.json` through `loadCompiledIndex()`
2. It normalizes `renderLayers` into UI layer entries; `renderLayers` is required for the viewer
3. It loads `{baseUrl}/Toponyms/index.json` for search
4. It loads `{baseUrl}/Massart/index.json` for timeline dots and map pins
5. On first successful load, `+page.svelte` warms all IIIF main layers once by calling `loadIiifLayer()` and immediately `parkLayerGroup()` on each loaded group
6. Toggling an IIIF layer calls `runLayerGroup()` or restores a parked group, depending on what has already been warmed/loaded
7. Toggling off usually parks the group instead of destroying it so restore is fast

### Layer group ID

`getLayerGroupId(layerInfo)` returns:

```ts
`${compiledCollectionPath}::${renderLayerKey ?? 'all'}`
```

## Data contracts

### `build/index.json`

Expected shape:

```ts
{
  generatedAt: string;
  totalManifests: number;
  georefManifests: number;
  compiledOk: number;
  layers: LayerInfo[];
  renderLayers?: LayerInfo[];
  index: CompiledIndexEntry[];
}
```

Important detail: this viewer effectively requires `renderLayers`; `+page.svelte` throws if it is absent.

### `build/Massart/index.json`

Loaded separately from the compiled index:

```ts
{
  generatedAt: string;
  totalItems: number;
  coordsAvailable: number;
  items: Array<{
    title: string;
    year?: string;
    location?: string;
    lat?: number;
    lon?: number;
    manifestUrl: string;
    mmsId: string;
    repId: string;
  }>;
}
```

Massart items are not georeferenced Allmaps layers. They are used for timeline dots, map pins, anchored image-collection bubbles, and viewer-opening. Do not try to drive them from `index.json`.

## Map interaction

- IIIF hover uses warped-map geo masks
- Primitive parcels use rendered-feature hover/click
- Clicking IIIF maps no longer opens transient `InfoCards`; it opens `ImageCollectionBubble.svelte` with manifest preview content
- Clicking image-collection map pins also opens `ImageCollectionBubble.svelte`
- The image-collection bubble is anchored to map coordinates, follows map movement while the source item remains on screen, flips below the anchor near the top edge, and closes if the source item moves offscreen
- In compare mode, bubble positioning is pane-aware; right-pane interactions project against the right map canvas rather than the left one
- `InfoCards.svelte` still supports parcel click state plus pinned items and focus/fly-to actions

## Startup warmup

`+page.svelte` now shows a blocking startup overlay labeled `Preparing Maps` during first-load IIIF warmup.

Current behavior:

- The overlay is purely presentational; it does not show numeric progress anymore
- The viewer warms the three IIIF mains (`primitief`, `gereduceerd`, `handdrawn`) by loading and immediately parking them
- The goal is to pay the first-load manifest/annotation cost upfront so later era activation restores from park
- `reloadIndex()` currently disables this startup warmup path by setting `initialWarmupPending = false`; the preload overlay is therefore a first-app-load behavior, not a repeated reload behavior

## ImageCollection bubble flow

Internally, the popup attached to non-georeferenced photo/document pins should be referred to as `ImageCollection`, not `MassartBubble`.

Current flow:

- `setMassartPins()` still provides the underlying map source/layers because the data still comes from `Massart/index.json`
- map pin click in `+page.svelte` finds the `MassartItem`, opens `ImageCollectionBubble.svelte`, and stores the pin lon/lat plus source pane
- IIIF map click in `+page.svelte` now builds a `PreviewBubbleItem` from the clicked manifest and opens the same bubble flow
- `ImageCollectionBubble.svelte` fetches preview metadata through `manifestPreview.ts`
- the bubble shows title, year/location chips when available, preview image, and an explicit `Open in viewer` button
- `manifestPreview.ts` is the shared helper for:
  - extracting image service URLs from IIIF v2/v3 manifests
  - deriving preview thumbnails when the manifest includes `thumbnail`
  - falling back to `{imageService}/full/400,/0/default.jpg`

## External services

- Dataset build: `https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build`
- HISTCART WMTS: `https://geo.api.vlaanderen.be/HISTCART/wmts`
- INBO WMS: `https://geo.api.vlaanderen.be/INBO/wms`

## Known relevant gotchas

### Timeslider -> IIIF sync model

The current `slider` branch no longer relies on `toggleMainLayer()` and `toggleSubLayer()` racing correctly for IIIF layers.

Current model in `+page.svelte`:

- both Timeslider events still update desired state:
  - `mainLayerEnabled[mainId]`
  - `subLayerEnabled[subId]`
- actual IIIF visibility/load work is serialized through `scheduleIiifMainLayerSync(mainId)`
- `syncIiifMainLayer(mainId)` is the only path that decides:
  - whether the IIIF group should be visible
  - whether to restore an already loaded group
  - whether to call `loadIiifLayer()`
  - whether to park the group after state changed during load

This was introduced because mental reasoning about the dual event stream from `Timeslider.svelte` was unreliable; the page now reconciles final desired state instead of depending on event order.

### IIIF toggle race on restore

This branch still includes the earlier restore-race fix in `+page.svelte`: `mainLayerLoading[mainId]` is set before awaiting restore/load work, including parked-group restore. Without that, `mainToggle` and `sublayerChange` could both call `runLayerGroup()` and tear down each other's work.

Related state involved:

- `mainLayerLoading`
- `iiifSyncByMain`
- `pendingPark`
- parked layer groups in `runner.ts` / `layerGroups.ts`

### First IIIF scrub load stall: fixed 2026-03-26

The actual cause of the "scrub onto an IIIF pill and nothing renders" bug was not the Timeslider visibility state once the sync model was cleaned up. The load reached `runLayerGroup()` and then stalled in `waitForMapReady()`.

Root cause in `app/src/lib/artemis/runner.ts`:

- `waitForMapReady(map)` only resolved if:
  - `map.isStyleLoaded()` was already true, or
  - a future `load` event fired
- on an already-mounted MapLibre instance, `load` is one-shot and may have fired long before the first IIIF enable
- result: `runLayerGroup()` could wait forever even though the map was already visible and usable

Fix:

- `waitForMapReady()` now treats the map as ready when any usable style state is present
- it also listens to `styledata` and `idle`, not only `load`
- it re-checks readiness immediately after listeners are attached to avoid missing a transition between the initial guard and subscription

Observed debug trace before the fix:

- `[syncIiif] primitief target=true parked=false loaded=false`
- `[loadIiif] start ...`
- `[runLayerGroup] start ...`
- `[runLayerGroup] waiting for map ready ...`
- then silence forever

After the fix, first-scrub IIIF load proceeds normally.

### Debug logs currently present

Temporary but currently useful instrumentation remains in place:

- `+page.svelte`
  - `[TS→] ...` for Timeslider events
  - `[toggleMain] ...`
  - `[toggleSub] ...`
  - `[syncIiif] ...`
  - `[loadIiif] ...`
- `runner.ts`
  - `[runLayerGroup] ...` startup / map-ready / compiled-collection boundaries

These logs were added specifically to debug the IIIF non-rendering issue on the `slider` branch.

### First-load IIIF warmup: current behavior

The current UI now preloads IIIF layer groups on first startup.

Operational detail:

- warmup runs inside `fetchIndex()` after `layers` and `groupIdToMainId` are ready
- it iterates IIIF-capable mains, calls `loadIiifLayer(info)`, then `parkLayerGroup(map, gid)`
- after warmup, the deferred desired-state replay still runs, so layers that should begin visible are restored/shown through the normal sync path
- this is intentionally a UI/runtime warmup, not an offline service-worker style precache

### Transformation mismatch: TPS vs polynomial

Allmaps can silently downgrade large TPS warps to polynomial. If parcel extraction in `Artemis-RnD-Data` uses a different transformation than the renderer, parcel overlays can drift relative to the rendered warped maps. This is primarily a pipeline consistency issue, not a viewer-only bug.

### Dataset URL normalization

`normalizeDatasetBaseUrl()` in `+page.svelte` converts pasted GitHub blob URLs to `raw.githubusercontent.com` and strips trailing `/index.json`.

### Current visual system

Mounted UI now relies on shared tokens from `app/src/lib/theme.css` for consistency.

Useful current tokens:

- `--font-ui`
- `--font-mono`
- `--radius-xs` / `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill`
- `--shadow-sm` / `--shadow-md` / `--shadow-card`

Active mounted components were normalized onto these tokens:

- `+page.svelte` startup overlay
- `Timeslider.svelte`
- `ToponymSearch.svelte`
- `InfoCards.svelte`
- `DebugMenu.svelte`
- `ImageCollectionBubble.svelte`
- `IiifViewer.svelte`

Recent consistency decision:

- interactive action buttons and timeline controls should prefer the tighter `--radius-xs` treatment instead of ad hoc pill rounding
- panel surfaces such as the timeslider submenu cards and image bubble should align on `--radius-md`

## Legacy / stale files

- `app/src/lib/artemis/ui/LayersPanel.svelte` and `app/src/lib/artemis/ui/TimelineSlider.svelte` still exist but are not the active UI
- `app/src/lib/artemis/timeEras.ts` describes the older timeline-zone model and does not reflect the current mounted `Timeslider.svelte` behavior

## Performance review: 2026-03-27

This section records the current highest-probability causes of slowdown in the base prototype, especially in `split` and `swipe` modes, plus the recommended execution order for fixes.

### Observed architectural cost centers

#### 1. Dual-pane mode doubles the expensive runtime, not just the DOM

`+page.svelte` creates a second independent `MapLibre` instance for both `split` and `swipe`, and `runner.ts` maintains separate pane runtimes (`main` and `right`).

Implication:

- compare mode duplicates:
  - map render work
  - IIIF hover hit-testing
  - IIIF layer park/restore bookkeeping
  - event listeners
  - image-info warmup
  - tile fetching and cache pressure
- `swipe` is visually one stage, but operationally still two full maps

Files:

- `app/src/routes/+page.svelte`
- `app/src/lib/artemis/runner.ts`

#### 2. Hover work is currently CPU-heavy and runs on every pointer move

Main pane `mousemove` currently does both:

- `queryRenderedFeatures()` for parcels
- full `hitTestAllWarpedMaps()` across every active warped map, using bbox checks plus point-in-polygon against geo masks

Right pane repeats the IIIF hover path independently.

This is one of the clearest reasons split/swipe gets worse: the app pays this cost once per map instance, per pointer move.

Files:

- `app/src/routes/+page.svelte`
- `app/src/lib/artemis/runner.ts`

#### 3. `Timeslider.svelte` recomputes and dispatches more than necessary

The live slider is small in file size but high in reactive churn:

- multiple derived sets/arrays are rebuilt on each year change
- the large reactive block re-scans all sources and can dispatch many toggle events when visibility windows shift
- `bind:clientWidth` drives `halfKnobYears`, which feeds visibility calculations
- dual-pane mode duplicates visibility/submenu logic

This likely is not the single worst bottleneck, but it adds steady UI-thread churn during scrubbing and makes downstream map orchestration noisier.

File:

- `app/src/lib/components/Timeslider.svelte`

#### 4. Z-order work is repeated by sweeping all layers

`applyZOrder()` and `applyZOrderForPane()` repeatedly iterate every main layer and sublayer, calling `moveLayer()` where layers exist.

This happens after many toggle/sync operations. In compare mode it happens for both panes.

The current implementation is correct but brute-force.

File:

- `app/src/routes/+page.svelte`

#### 5. Runner instrumentation and keepalive are useful, but expensive

`runner.ts` currently attaches many per-layer event listeners, emits frequent stats/logs, prefetches all annotation JSONs, pre-warms image infos, and then runs a `setInterval()` keepalive that repeatedly calls `nativeUpdate()` until it decides loading has settled.

This is valuable for debugging first-load/render issues, but it is not cheap:

- per-layer listeners scale with each loaded group and each pane
- logging itself causes large object/array churn in the UI
- `nativeUpdate()` keepalive remains active for up to 90s per load

Files:

- `app/src/lib/artemis/runner.ts`
- `app/src/routes/+page.svelte`

#### 6. UI logging currently amplifies reactive cost

`log()` prepends into a large `logs` array and slices it every time. During noisy runner activity, this can force frequent Svelte updates and object churn even when the debug menu is disabled.

File:

- `app/src/routes/+page.svelte`

#### 7. Some helpers rebuild source data instead of updating incrementally

`setMassartPins()` rebuilds the full GeoJSON source payload each time it is called, even though year changes only require filter updates once the source exists.

This is probably a secondary issue, but it is easy savings.

File:

- `app/src/lib/artemis/map/mapInit.ts`

### Likely top bottlenecks in practice

If performance is notably worse during compare modes and active scrubbing, the most likely order is:

1. per-pointer hover hit-testing across active warped maps
2. second `MapLibre` + `Allmaps` runtime in split/swipe
3. runner keepalive/logging/event-listener overhead during and after loads
4. repeated Svelte reactive/state churn in `Timeslider.svelte`
5. repeated full-layer z-order sweeps

### Optimization plan

#### Phase 1: measure and de-noise without changing behavior

Goal: make hotspots visible and remove debug overhead that now affects the prototype itself.

- Gate almost all runner debug logging behind `FEATURE_FLAGS.debugMenu` or a dedicated `performanceDebug` flag.
- Short-circuit `log()` when debug UI is off, or store logs in a non-reactive ring buffer until the menu is opened.
- Add lightweight timing markers around:
  - main-pane hover handler
  - right-pane hover handler
  - `applyZOrder()`
  - `syncIiifMainLayer()`
  - `syncRightIiifMainLayer()`
  - `runLayerGroup()`
- Record active counts for:
  - total active warped maps per pane
  - hover-tested warped maps per pointer event
  - live keepalive intervals

Expected outcome:

- enough evidence to tell whether the app is mostly CPU-bound in hover, reactive churn, or runner keepalive

#### Phase 2: cut hover-path cost first

Goal: reduce the work paid on every pointer move.

- Throttle IIIF hover handling to one pass per animation frame using `requestAnimationFrame`.
- Skip hover recomputation when the pointer stays within a tiny pixel delta and the map camera has not changed.
- Precompute a cheaper hit-test structure per active warped map:
  - keep bbox fast path
  - cache simplified masks or prepared polygon data if possible
- Avoid rebuilding hover-mask GeoJSON if the hovered map IDs did not change.
- Consider disabling parcel `queryRenderedFeatures()` while the map is actively moving, then restoring it on idle.
- Apply the same throttle strategy to the right pane.

Expected outcome:

- noticeably smoother pointer interaction
- largest single improvement for split/swipe if hover is the current hot path

#### Phase 3: simplify `Timeslider.svelte` state transitions

Goal: reduce reactive recomputation and redundant event dispatch during scrubbing.

- Replace the many reactive `reduce/filter/new Set` derivations with memoized or explicitly recomputed structures driven only by year or mode changes.
- Collapse the large dispatch block into a diff-based update function that only emits actual visibility transitions.
- Precompute static values once:
  - `row1`
  - `row2`
  - tick list
  - source lookup by key
- Revisit `bind:clientWidth` usage; if possible, move overlap tolerance to CSS or compute it only on resize, not as part of normal scrub reactivity.
- Ensure left-pane events are not dispatched twice when single-pane mode mirrors left state.

Expected outcome:

- less main-thread churn while dragging the scrubber
- fewer downstream layer sync calls

#### Phase 4: make layer ordering incremental

Goal: stop re-sweeping all layers after every small visibility change.

- Replace `applyZOrder()` full passes with targeted moves for the layer or group that actually changed.
- Maintain a pane-specific ordered list of currently mounted layer IDs/groups and only reconcile diffs.
- Avoid `moveLayer()` calls when the layer is already at the correct relative position.

Expected outcome:

- lower MapLibre style mutation overhead, especially in compare mode

#### Phase 5: reduce runner steady-state cost

Goal: keep the warmup/load reliability work, but stop paying so much after the layer is usable.

- Make runner debug listeners opt-in outside active debugging sessions.
- Revisit keepalive:
  - shorten budget aggressively for parked or already-restored layers
  - stop after viewport-visible success instead of waiting for broad completeness where acceptable
  - prefer `requestAnimationFrame` or a smaller bounded repaint burst over long `setInterval()` lifetimes
- Cap concurrent annotation/info fetches instead of unbounded `Promise.all()` if network bursts are causing UI starvation.
- Cache compiled collection manifest membership so repeated restores/reloads do not rebuild entry lookup maps every time.
- Investigate storing a precomputed `mapId -> bbox/mask metadata` structure when annotations are applied, so later hover does not walk renderer internals repeatedly.

Expected outcome:

- faster settle time after enabling a layer
- less background work lingering after load

#### Phase 6: trim compare-mode architecture cost

Goal: improve split/swipe beyond tactical fixes.

- Verify whether `swipe` truly needs two full `MapLibre` instances or whether a shared base map plus pane-specific IIIF overlays can approximate the same UX.
- If two maps remain required, aggressively reduce right-pane work:
  - no duplicate nonessential debug listeners
  - no duplicate source rebuilds where filters suffice
  - defer right-pane IIIF warm/restore until first actual visibility need
- Consider lowering right-pane interaction fidelity while dragging the swipe divider, then restoring on release.

Expected outcome:

- structural improvement in split/swipe rather than only micro-optimizations

### Recommended implementation order

1. Phase 1 measurement and log gating
2. Phase 2 hover throttling/caching
3. Phase 3 `Timeslider.svelte` diff-based state updates
4. Phase 4 incremental z-order
5. Phase 5 runner keepalive/debug trimming
6. Phase 6 compare-mode architecture changes

### Fast wins

These are the lowest-risk first edits once implementation begins:

- disable reactive UI log churn when debug menu is off
- throttle both hover handlers with `requestAnimationFrame`
- stop rebuilding Massart GeoJSON on year-only changes
- precompute static slider data outside reactive blocks
- reduce or gate runner event logging

### Important constraint

The current prototype intentionally uses park/restore to hide IIIF layer startup cost. Optimizations should preserve that behavior unless a replacement strategy is measured to be better. The main target is repeated runtime work after initial load, not removal of the warm-cache model itself.

### Applied optimizations — 2026-03-27

The following changes were made in this session. Each is incremental and non-breaking.

#### ✅ `log()` no-op when `debugMenu` is off

`app/src/routes/+page.svelte` — `log()` now returns immediately when `FEATURE_FLAGS.debugMenu` is `false`. All `[TS→]`, `[syncIiif]`, `[runLayerGroup]`, etc. log calls cost nothing in production: no array allocation, no `Date` construction, no Svelte reactive assignment.

#### ✅ RAF-throttle both hover handlers

`app/src/routes/+page.svelte` — Both the left-pane `onMouseMove` and the right-pane handler inside `attachRightIiifHandlers` now use a `requestAnimationFrame` gate. Each `mousemove` event stores the latest pointer position but only schedules one RAF per frame. `hitTestAllWarpedMaps` and `queryRenderedFeatures` run at most once per frame (~60 fps) instead of on every raw pointer event. MapLibre's `PointLike` constraint handled by storing `{x, y}` and passing `[x, y]` tuples to the API calls.

#### ✅ Cache entry lookup maps in runner.ts

`app/src/lib/artemis/runner.ts` — `entryByAbsoluteManifestUrl` and `entryByRelativeManifestPath` are now module-level cached maps (`cachedEntryByAbsoluteUrl`, `cachedEntryByRelativePath`, `cachedEntryMapsBaseUrl`). They are built once per base URL on first `runLayerGroup` call and invalidated in `resetCompiledIndexCache()`. Previously rebuilt from the full index on every call, including when the right pane loaded the same layer independently.

#### ✅ Timeslider: `paneSourcesForYear(sliderYear)` called once per reactive cycle

`app/src/lib/components/Timeslider.svelte` — `singlePanelSources` declaration moved to before the other derived values. `leftVisibleSourceKeys`, `activeSourceKeys`, and `activePanesBySource` now reference `singlePanelSources` instead of calling `paneSourcesForYear(sliderYear)` inline. Eliminates 3 redundant calls per scrub event in single-pane mode.

#### ✅ Gate runner keepalive diagnostics behind `debug` flag

`app/src/lib/artemis/runner.ts` — `runLayerGroup` now accepts a `debug?: boolean` opt (defaults to `false`). `logViewportVsFetchable` and `logVisibleNotFetchableReasons` — which build intermediate maps and iterate `inViewportMapIds` — are only called when `debug` is `true`. The annotation strategy analysis block is also gated. `nativeUpdate()` and all keepalive termination logic are unchanged. Both `loadIiifLayer` and `loadIiifLayerForRight` in `+page.svelte` pass `debug: FEATURE_FLAGS.debugMenu`.

#### ✅ Annotation loop macrotask yield

`app/src/lib/artemis/runner.ts` — The `addGeoreferenceAnnotation` serialization loop now yields a real macrotask (`setTimeout(0)`) every 15 entries. Before this fix, even though each call was `await`ed, they resolved as microtasks so the browser never got a chance to render a frame or process input events during the loop. The result was a 1–2s UI freeze (frozen scrubber, unresponsive map) on first IIIF layer load. The yield interval of 15 is a balance: frequent enough to keep the UI responsive, infrequent enough not to measurably slow overall load time.

#### ✅ WMTS/WMS layers not visible on first load — re-sync in map `load` handler

`app/src/routes/+page.svelte` — `setHistCartLayerVisible` and `setLandUsageLayerVisible` call `map.addSource()` + `map.addLayer()`, which throw `"Style is not done loading"` if called before the map's `load` event fires. The Timeslider `onMount` dispatches `sublayerChange` events (e.g. `ferraris-wmts: true`) before the map style is ready, so those adds silently failed and Ferraris (and any other WMTS/WMS layer active at startup) would not appear until the user scrubbed off and back on. Fix: in the map's `load` handler, before `applyZOrder()`, iterate all sublayers and re-apply any WMTS/WMS that are currently marked enabled in `subLayerEnabled`. This mirrors the existing deferred-state-replay pattern already used for IIIF layers in `fetchIndex`.

#### ✅ Gereduceerd/Vandermaelen z-order inconsistency

`app/src/lib/artemis/layerConfig.ts` — `MAIN_LAYER_ORDER` had `vandermaelen` at index 1 and `gereduceerd` at index 3. In `applyZOrder`, layers are moved to the stack top in reverse order, so index 0 ends up rendered on top. With the old order, `applyZOrder` always put vandermaelen above gereduceerd — the opposite of what the timeline UI implies (gereduceerd is row 1 / top row; vandermaelen is row 2 / bottom row). The "inconsistency" was a brief correct window when gereduceerd's WarpedMapLayer was freshly `addLayer`'d (landing at the stack top momentarily), before `applyZOrder` snapped it back to the wrong position. Fix: swap the two entries so `gereduceerd` (index 1) comes before `vandermaelen` (index 2). New order: `['ferraris', 'gereduceerd', 'vandermaelen', 'primitief', 'handdrawn']`. Rendering stack top→bottom: ferraris → gereduceerd → vandermaelen → primitief → handdrawn.

### Layer z-order model

`applyZOrder()` and `applyZOrderForPane()` in `+page.svelte` sweep `mainLayerOrder` from the last index to index 0, calling `map.moveLayer(id)` (no second arg = move to top) for each layer that exists. The entry at index 0 is moved last and therefore stays on top. `mainLayerOrder` can be temporarily reordered by `activateLayer()` (moves the activated layer to index 0 = on top). The base order defined in `MAIN_LAYER_ORDER` (layerConfig.ts) is the fallback/default.

### Remaining optimization work

Phases 3–6 from the plan above are not yet started:

- **Phase 3** — Timeslider diff-based dispatch (avoid re-dispatching unchanged visibility state; collapse the large reactive block)
- **Phase 4** — Incremental z-order (replace full `applyZOrder` sweep with targeted per-layer moves)
- **Phase 5** — Runner steady-state cost (keepalive budget tuning; cap concurrent annotation/info fetches)
- **Phase 6** — Compare-mode architecture (defer right-pane IIIF warm; reduce duplicate non-essential right-pane work)
