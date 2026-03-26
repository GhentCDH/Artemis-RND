# Artemis-RnD — LLM Context

_Last updated: 2026-03-26 (slider UI, startup IIIF warmup, ImageCollection bubble flow, compare mode planning)_

## What this repo is

Artemis-RnD is a SvelteKit viewer and test harness for historical Belgian maps. It consumes preprocessed data from the companion repo `GhentCDH/Artemis-RnD-Data`, renders warped IIIF layers with Allmaps on a MapLibre map, overlays WMTS/WMS/GeoJSON layers, and supports manifest/toponym search plus IIIF viewing.

This repo is the viewer, not the data pipeline.

## Current repo state

- Active branch: `slider`
- Active UI: `app/src/lib/components/Timeslider.svelte`
- Legacy UI files still present but not mounted: `app/src/lib/artemis/ui/LayersPanel.svelte`, `app/src/lib/artemis/ui/TimelineSlider.svelte`
- Default dataset URL in code: `https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build`
- `+page.svelte` also loads `Massart/index.json` and syncs timeline dots with map pins
- First successful app load now pre-warms all IIIF main layers and immediately parks them behind a startup overlay so first activation restores instantly

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
| `app/src/lib/components/Timeslider.svelte` | Active timeline UI: era pills, visible scrubber, grouped sublayer menus, timeline dots, viewer-open events |
| `app/src/lib/artemis/runner.ts` | Core IIIF runner: loads compiled index + annotations, builds `WarpedMapLayer`s, parks/restores/removes groups, emits render stats |
| `app/src/lib/artemis/map/mapInit.ts` | MapLibre setup and helpers for WMTS/WMS/GeoJSON/hover masks/Massart pins |
| `app/src/lib/artemis/layerConfig.ts` | Main layer IDs, labels, colors, sublayer definitions, initial state factories |
| `app/src/lib/artemis/layerGroups.ts` | Tracks active parked/restored IIIF layer groups |
| `app/src/lib/artemis/types.ts` | Shared UI/data types including `IiifMapInfo`, `PinnedCard`, `MassartItem` |
| `app/src/lib/artemis/ui/ToponymSearch.svelte` | Unified search overlay |
| `app/src/lib/artemis/ui/InfoCards.svelte` | Hover/click cards for IIIF maps and parcels |
| `app/src/lib/artemis/ui/DebugMenu.svelte` | Dataset URL override, reload controls, logs, render stats |
| `app/src/lib/artemis/ui/ImageCollectionBubble.svelte` | Anchored popup for image-collection pins with preview + explicit viewer-open action |
| `app/src/lib/artemis/viewer/IiifViewer.svelte` | IIIF viewer overlay |
| `app/src/lib/artemis/viewer/manifestPreview.ts` | Shared manifest parsing helper for preview thumbnails and image-service extraction |

## Layer model

### Main layers

| ID | Label | Date | Color | Backing type |
|---|---|---|---|---|
| `ferraris` | Ferraris | 1771 | `#c0392b` | WMTS |
| `vandermaelen` | Vandermaelen | 1846 | `#8e44ad` | WMTS |
| `primitief` | Primitief kadaster | 1808-1834 | `#C07B28` | IIIF |
| `gereduceerd` | Gereduceerd kadaster | 1847-1855 | `#9440A0` | IIIF |
| `handdrawn` | Hand drawn collection | 19th c. | `#d35400` | IIIF |

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
- A floating white panel shows grouped sublayer menus for eras currently under the scrubber
- Overlapping eras render as separate vertically stacked submenus, each labeled by layer
- If a main layer is disabled, all sublayer pills in that layer's submenu are slightly muted even if locally toggled on
- `loadingLayers` passed from `+page.svelte` adds a shimmer state to era pills during IIIF load/restore work
- The scrubber is intentionally visually dominant: thicker rail, larger thumb, higher z-index than pills/ticks
- The axis range is reactive and expands to include loaded Massart years
- Massart items are grouped by year and rendered as clickable dots on the same timeline
- Clicking a timeline dot opens a small dot popup with metadata and an `Open in viewer` button

### Events dispatched

- `mainToggle: { mainId, enabled }`
- `sublayerChange: { subId, enabled }`
- `year-change: { year }`
- `open-viewer: { title, sourceManifestUrl, imageServiceUrl }`

## Compare mode plan

Compare mode is planned but not implemented yet.

Agreed product decisions so far:

- First implementation target is side-by-side compare only; swipe / before-after mode is deferred until after the split view works
- Long term, both side-by-side and swipe should be supported by the same underlying compare model rather than separate implementations
- Compare mode should use two pane-specific years on a single shared timeline UI
- The two scrubbers may cross over freely; there is no `leftYear <= rightYear` constraint
- The two panes should be visually color-coded, and each scrubber/thumb/year label should match its pane color
- Search stays centered/global in the app shell rather than belonging to a specific pane
- Camera state is locked between panes: center, zoom, bearing, and pitch should stay synchronized
- Layer toggles remain shared in the first compare implementation; the varying state between panes is the selected year, not a separate layer-toggle model per pane
- When compare mode is closed, keep the left pane as the canonical surviving state and discard the right pane state

Implementation direction currently preferred:

- Build compare as a real two-map architecture, not a single-map masking trick
- Side-by-side should be the first shipping mode because it forces the needed runtime refactor cleanly
- Swipe mode should later reuse the same two-pane engine and only change layout/compositing

Planned implementation phases:

1. Refactor `Timeslider.svelte` into a controlled dual-scrubber component with pane-qualified year events and pane-colored UI
2. Refactor `mapInit.ts` away from a singleton map so the page can create and destroy independent left/right `MapLibre` instances
3. Refactor `runner.ts` so active/parked IIIF layer-group bookkeeping is pane-scoped rather than globally keyed only by `groupId`
4. Update `+page.svelte` to support `compareMode`, `leftYear`, `rightYear`, two map containers, and bidirectional camera synchronization with feedback-loop guards
5. Keep single-map mode as effectively "left pane only" so compare-off remains compatible with the current app behavior

Known architectural constraint before compare work:

- The current app is explicitly single-map in important places:
  - `mapInit.ts` owns a singleton `map`
  - `+page.svelte` assumes one map and one visible-state reconciliation path
  - `runner.ts` stores active and parked IIIF groups in global maps keyed only by layer group ID
- Because of that, compare mode is not just a UI change; it requires pane-scoped runtime state before two panes can render the same IIIF layer independently

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
- Clicking IIIF maps can open the IIIF viewer through `InfoCards`
- Clicking image-collection map pins no longer opens the IIIF viewer directly; it opens `ImageCollectionBubble.svelte`
- The image-collection bubble is anchored to map coordinates, follows map movement while the source pin remains on screen, flips below the pin near the top edge, and closes if its source pin moves offscreen
- Info cards support pinning and focus/fly-to actions

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
- map pin click in `+page.svelte` finds the `MassartItem`, opens `ImageCollectionBubble.svelte`, and stores the pin lon/lat
- `ImageCollectionBubble.svelte` fetches preview metadata through `manifestPreview.ts`
- the bubble shows title, year/location chips, preview image, and an explicit `Open in viewer` button
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

## Legacy / stale files

- `app/src/lib/artemis/ui/LayersPanel.svelte` and `app/src/lib/artemis/ui/TimelineSlider.svelte` still exist but are not the active UI
- `app/src/lib/artemis/timeEras.ts` describes the older timeline-zone model and does not reflect the current mounted `Timeslider.svelte` behavior
