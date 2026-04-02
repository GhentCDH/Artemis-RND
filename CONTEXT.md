# Artemis Context

## 1. Overview

- Repo purpose: SvelteKit viewer for historical Belgian maps and images.
- Current branch: `swipeslider`
- Active UI entrypoint: `app/src/lib/components/Timeslider.svelte`
- Main shell: `app/src/routes/+page.svelte`
- Default dataset: `https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build`

## 2. Features

- MapLibre viewer with historical raster layers, IIIF overlays, timeline, search, and docked IIIF viewer.
- Split mode with independent left/right years and shared camera.
- Timeline uses a compact 4-lane pill layout with hardcoded lane assignment per source.
- Timeline pills use hardcoded abbreviations from `MAIN_LAYER_SHORT_LABELS`.
- Single-sublayer sources use only the global toggle in the sublayer menu.
- Historical raster support exists for Ferraris, Vandermaelen, Frickx, Villaret, Popp, NGI 1873, and NGI 1904.
- IIIF-backed layers exist for Primitief, Gereduceerd, and Hand drawn.

## 3. Architecture

- `app/src/routes/+page.svelte`: orchestration, map init, layer visibility, search, viewer state.
- `app/src/lib/components/Timeslider.svelte`: timeline UI, pill interaction, pane controls, sublayer menu UI.
- `app/src/lib/artemis/map/mapInit.ts`: WMTS/WMS/raster/map source setup.
- `app/src/lib/artemis/layerConfig.ts`: main layers, sublayers, labels, short labels, colors, info text, source URLs.
- `app/src/lib/artemis/runner.ts`: IIIF loading, parking, restoring, Allmaps integration.

## 4. Configuration

- `FEATURE_FLAGS.startupPreloadScreen = false`
- `FEATURE_FLAGS.debugMenu = false`
- `Massart/index.json` is loaded separately from the compiled IIIF index.
- `renderLayers` in `build/index.json` is effectively required by the viewer.
- Main-layer info/source text is configured in `MAIN_LAYER_INFO` and `MAIN_LAYER_SOURCE`.

## 5. Decisions

- `Timeslider.svelte` is the mounted timeline; legacy timeline files are not active.
- NGI 1873 / NGI 1904 are connected as raster tile services, not via confirmed WMTS capabilities.
- Villaret is connected as WMS-backed raster, not via confirmed WMTS.
- Sublayers should not have info buttons.
- Only main layers should have an info button, intended to open a bubble with description plus source link.

## 6. Todos

- Simplify `Timeslider.svelte`; it contains multiple overlapping iterations.
- Re-verify lane assignment and small-pill readability after the interaction bugs are fixed.
- Re-test smallest pills for hitbox, visual width, and abbreviation legibility.

## 7. Bugs

- `Main-layer info bubble still broken`
  Clicking the main-layer `i` button still does not show the bubble in the running UI, even after refactoring the markup into a dedicated `sub-menu-info-anchor` and wiring `MAIN_LAYER_INFO` / `MAIN_LAYER_SOURCE`.
- `Pill click isolation not trusted`
  There was an attempted implementation to disable other overlapping layers when a pill is clicked, but the user reported that the behavior still does not work correctly. Treat this as unresolved and re-test from the UI before relying on it.
- `Hover info behavior has been unstable`
  The custom pill hover display has changed multiple times; native `title` is the current fallback, but custom hover behavior should be rechecked in-browser.

## 8. Verification

- Last verified command: `pnpm -s run check`
- Current TypeScript/Svelte status at last edit: `0 errors, 0 warnings`
- Important: compile status is clean, but runtime behavior is not fully reliable. The main known example is the broken info bubble.

## 9. Next Actions

1. Hand off the main-layer info bubble bug to another agent and debug it in the live app, not only via static code inspection.
2. Re-test pill click isolation in-browser and either fix or remove the current partial implementation.
3. Once interaction bugs are stable, simplify `Timeslider.svelte` and remove dead experimental code paths.
