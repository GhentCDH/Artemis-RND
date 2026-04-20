# Artemis Context

## Overview

- Repo purpose: SvelteKit viewer for historical Belgian maps and images.
- Main route entrypoint: `app/src/routes/+page.svelte`
- Main app shell: `app/src/lib/artemis/app/ArtemisApp.svelte`
- Default dataset: `https://raw.githubusercontent.com/ghentcdh/Artemis-RnD-Data/dev/build`
- Last verified command: `pnpm check`
- Current verification status: `0 errors, 0 warnings`

## Current Structure

- `app/src/routes/+page.svelte`
  Thin route mount only.
- `app/src/lib/artemis/app/ArtemisApp.svelte`
  Top-level orchestration shell.
- `app/src/lib/artemis/config/layers.ts`
  Main layer ids, labels, colors, ordering, sublayer definitions, and initial state.
- `app/src/lib/artemis/dataset/*`
  Runtime metadata loading, manifest search shaping, toponym loading, and toponym normalization.
- `app/src/lib/artemis/iiif/*`
  Low-level IIIF / Allmaps runtime plus shell-facing IIIF lifecycle helpers.
- `app/src/lib/artemis/map/*`
  MapLibre setup and historical/base layer plumbing.
- `app/src/lib/artemis/panes/*`
  Split-view lifecycle and camera/state sync.
- `app/src/lib/artemis/search/*`
  Search text normalization/scoring and result interaction flow.
- `app/src/lib/artemis/timeline/*`
  Layer ordering and timeslider-driven visibility logic.
- `app/src/lib/artemis/shared/*`
  Shared types and generic utilities.
- `app/src/lib/components/Timeslider.svelte`
  Main timeline UI and compare controls.

## Data Contract

The viewer currently consumes:

- `build/index.json`
- `build/IIIF/<mapId>_geomaps.json`
- `build/IIIF/<mapId>/sprites/sprites.jpg`
- `build/IIIF/<mapId>/sprites/sprites.json`
- `build/Image collections/Massart/index.json`
- `build/Toponyms/<mapId>/<mapId>Toponyms.json`
- `build/Parcels/PrimitiefKadaster/PrimitiefKadasterParcels.geojson`
- `static/site.json`
- `static/layers.json`

Current sprite contract:

- `*_geomaps.json` exposes bundle-level sprite metadata
- `sprites.json` is keyed by `canvasAllmapsId`
- canvases stay compact and resolve sprite rectangles by `canvasAllmapsId`
- `build/index.json` is expected to expose `centerLon` / `centerLat` for georeferenced entries

## Assets

- `app/src/lib/assets/Baselayer.geojson`
  Build-time imported asset used by map code via `?url`; it should remain outside `static/`.
- `app/static/favicon.svg`
  Canonical public favicon location.

## Current Decisions

- The viewer now uses feature-grouped folders rather than a flat `src/lib/artemis` root.
- Shared config belongs in `config/`, and shared primitives belong in `shared/`.
- The route file stays thin; orchestration belongs in `ArtemisApp.svelte`.
- Runtime metadata is loaded from `static/site.json` and `static/layers.json`.
- `Timeslider.svelte` is still the mounted timeline and the largest remaining readability hotspot.

## Known Remaining Cleanup

- `pnpm-lock.yaml` still contains stale `@sveltejs/adapter-auto` entries even though `package.json` no longer does.
- `Timeslider.svelte` still needs a dedicated simplification pass.

## Known Runtime Follow-Up

- Re-verify viewer behavior against the current atlas contract where `sprites.json` is keyed by `canvasAllmapsId`.
- Re-test search and preview anchoring against restored `centerLon` / `centerLat`.
- Re-check Massart labels/titles in the viewer after the data repo finishes title parsing cleanup.
