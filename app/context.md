# Artemis Viewer Context

## Overview

- Route entrypoint: `src/routes/+page.svelte`
- Main shell: `src/lib/artemis/app/ArtemisApp.svelte`
- Default dataset base URL: `https://raw.githubusercontent.com/ghentcdh/Artemis-RnD-Data/dev/build`
- Verification baseline: `pnpm check` passes with `0 errors, 0 warnings`

## Current Structure

### Shell

- `src/routes/+page.svelte`
  Thin mount only.
- `src/lib/artemis/app/ArtemisApp.svelte`
  Cross-feature orchestration shell.

### Feature Modules

- `src/lib/artemis/config/layers.ts`
  Layer ids, labels, colors, ordering, sublayer definitions, and initial toggle state.
- `src/lib/artemis/dataset/runtimeMetadata.ts`
  Loads `static/site.json` and `static/layers.json`.
- `src/lib/artemis/dataset/manifestSearch.ts`
  Shapes manifest search data from build output.
- `src/lib/artemis/dataset/toponyms.ts`
  Loads toponym files and manages toponym load state.
- `src/lib/artemis/dataset/toponymNormalization.ts`
  Normalizes raw toponym data.
- `src/lib/artemis/iiif/runner.ts`
  Low-level IIIF / Allmaps runtime.
- `src/lib/artemis/iiif/layerLifecycle.ts`
  Shell-facing IIIF load, warmup, and sync helpers.
- `src/lib/artemis/map/mapInit.ts`
  MapLibre and base/historical layer setup.
- `src/lib/artemis/panes/splitView.ts`
  Split-view lifecycle and pane synchronization.
- `src/lib/artemis/search/text.ts`
  Shared search text normalization and scoring.
- `src/lib/artemis/search/navigation.ts`
  Search result interaction flow.
- `src/lib/artemis/timeline/layerControls.ts`
  Layer ordering and timeslider-driven visibility logic.
- `src/lib/artemis/shared/types.ts`
  Shared viewer types.
- `src/lib/artemis/shared/utils.ts`
  Shared generic utilities.

### UI

- `src/lib/components/Timeslider.svelte`
  Main timeline UI and compare controls.
- `src/lib/artemis/ui/ToponymSearch.svelte`
  Search UI.
- `src/lib/artemis/ui/InfoCards.svelte`
  Pinned card and parcel info UI.
- `src/lib/artemis/ui/ImageCollectionBubble.svelte`
  Massart / image bubble UI.
- `src/lib/artemis/viewer/IiifViewer.svelte`
  Docked IIIF viewer.

## Data Contract

The viewer currently consumes:

- `index.json`
- `IIIF/<mapId>_geomaps.json`
- `IIIF/<mapId>/sprites/sprites.jpg`
- `IIIF/<mapId>/sprites/sprites.json`
- `Image collections/Massart/index.json`
- `Toponyms/<mapId>/<mapId>Toponyms.json`
- `Parcels/PrimitiefKadaster/PrimitiefKadasterParcels.geojson`
- `static/site.json`
- `static/layers.json`

Current sprite contract:

- bundle-level sprite metadata lives in `*_geomaps.json`
- `sprites.json` is keyed by `canvasAllmapsId`
- canvases stay compact and resolve sprite rectangles via `canvasAllmapsId`
- `build/index.json` should expose `centerLon` / `centerLat` for georeferenced entries

## Assets

- `src/lib/assets/Baselayer.geojson`
  Build-time imported asset used by `mapInit.ts`; it should stay outside `static/`.
- `static/favicon.svg`
  Canonical public favicon location.

## Current Decisions

- The viewer structure is now feature-grouped instead of flat at the `artemis/` root.
- Shared config belongs in `config/`, and shared primitives belong in `shared/`.
- The route file stays thin; orchestration belongs in `ArtemisApp.svelte`.
- Runtime metadata is loaded from `static/site.json` and `static/layers.json`.

## Known Remaining Cleanup

- `Timeslider.svelte` is still the biggest readability hotspot and needs a dedicated simplification pass.
- `pnpm-lock.yaml` still contains stale `@sveltejs/adapter-auto` entries even though `package.json` no longer does.

## Runtime Follow-Up

- Re-verify low-zoom sprite preview behavior in the browser against the current atlas contract.
- Re-test search and preview anchoring against restored `centerLon` / `centerLat`.
- Re-check Massart display text after upstream title parsing cleanup.
