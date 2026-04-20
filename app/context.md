# Artemis Viewer Context

## Overview

The viewer uses a low-zoom sprite preview strategy for IIIF layers and promotes full Allmaps rendering only when the viewport or zoom level justifies it. The current data contract keeps a shared atlas per map bundle, while the canvas-to-sprite relationship is resolved explicitly via `canvasAllmapsId`.

## Current Architecture

### Main Runtime Files

- `src/lib/artemis/runner.ts`: compiled-data runtime, IIIF loading, sprite prewarm, deferred map promotion
- `src/routes/+page.svelte`: map page orchestration, sprite overlay DOM layer, zoom gating, layer toggling

### Data Dependencies

The viewer consumes:

- `index.json`
- `IIIF/<mapId>_geomaps.json`
- `IIIF/<mapId>/sprites/sprites.jpg`
- `IIIF/<mapId>/sprites/sprites.json`

## Sprite System

### Bundle-Level Sprite Lookup

`runner.ts` now prefers bundle-level sprite metadata:

1. fetch `*_geomaps.json`
2. read `bundle.sprites`
3. fetch `bundle.sprites.json`
4. index sprite rectangles by `canvasAllmapsId`
5. match each canvas via `canvas.canvasAllmapsId`

`build/index.json` center coordinates are now expected to be present again for georeferenced entries, and `+page.svelte` uses those for search results and preview anchoring.

This avoids duplicating sprite rectangles inside `geomaps` while keeping a strict one-canvas-to-one-sprite mapping through the existing `canvasAllmapsId`.

Older data may still expose canvas-level sprite metadata directly in each canvas entry:

- `sprite`
- `spriteWidth`
- `spriteHeight`
- `allmapsSprite`

That legacy shape is still supported as a fallback in the viewer, but current data output should use the bundle-level atlas plus keyed lookup path.

### Runtime Types

`RuntimeLayerEntry` includes:

- `inlineMaps`
- `inlineSprites`
- `bbox`
- manifest metadata for labeling and grouping

`BundleSprite` includes:

- `imageId`
- `scaleFactor`
- `x`
- `y`
- `width`
- `height`
- optional `spriteTileScale`

### Sprite Preview Index

`spriteIndex` stores low-zoom preview entries keyed by manifest URL:

- `id`
- `label`
- `spriteUrl`
- `bbox`
- `layerId`
- `layerLabel`

These power the overlay previews in `+page.svelte`.

## Loading Strategy

### Preload Phase

`preloadGeomapsCache()`:

- loads geomaps bundles early
- resolves bundle sprite manifests
- populates `spriteIndex`
- warm-fetches spritesheets into the browser HTTP cache

### Initial IIIF Load

`runLayerGroup()`:

- fetches bundle entries from `loadNewIiifEntries()`
- computes geographic bbox per entry from GCPs
- splits entries into:
  - `inViewport`
  - `deferredEntries`
- immediately loads only viewport-relevant maps
- stores deferred entries in `pendingByGroup`

### Viewport Promotion

`syncViewportAnnotations()`:

- checks `pendingByGroup`
- intersects entry bbox with current map viewport
- promotes newly visible entries into the active `WarpedMapLayer`
- processes them in small chunks with frame yields

This keeps startup lighter while still allowing progressive reveal during pan/zoom.

## Zoom Behavior

- `IIIF_MIN_ZOOM = 12`
- Below zoom 12:
  - sprite overlay is visible
  - full IIIF layers may be parked
- At or above zoom 12:
  - sprite overlay is hidden
  - IIIF manifests / warped maps are actively synced and rendered

## Helper Logic in runner.ts

Current helper additions include:

- `geoBoxFromGcps()`
- `bboxIntersects()`
- `getMapViewportBbox()`
- `preloadGeomapsCache()`
- `syncViewportAnnotations()`

These support sprite preview indexing and deferred IIIF promotion.

## Current Page-Level Behavior

`+page.svelte` is still responsible for:

- creating the sprite overlay DOM container
- rendering preview `<img>` elements
- positioning sprites with `map.project()`
- showing/hiding the overlay by zoom level
- triggering layer-group sync when toggles change

The overlay remains a UI preview layer; Allmaps still does the real warped image rendering.

## Known Runtime Assumptions

- Each manifest preview currently uses the first sprite in `inlineSprites` for low-zoom preview indexing
- Bundle-level sprite manifests are keyed by `canvasAllmapsId`
- Some upstream canvases may legitimately have no sprite because their IIIF image service is inaccessible
- Missing sprite rectangles should not break full IIIF rendering for the remaining canvases
- `build/index.json` once again exposes `centerLon` / `centerLat` for georeferenced entries and the viewer uses those for search and preview anchoring

## Current Known Issues / Risks

- Some source IIIF services are unstable or unavailable for specific canvases
- Sprite preview quality and sizing may still need tuning
- Low-zoom preview uses simplified sprite placement rather than warped rendering
- There is still partial coupling between runtime behavior and bundle conventions
- Confirmed data bug: some Massart titles are truncated incorrectly by current title parsing

## Practical Debug Points

When validating this system, check:

- `runner.ts` bundle fetch path for `bundle.sprites.json`
- `spriteIndex.size` after preload
- `pendingByGroup` behavior during pan/zoom
- `logs/report.log` in the data repo when expected sprites are missing

## Related Repo Contract

This viewer context assumes the data repo now publishes:

- bundle-level `sprites` metadata in `*_geomaps.json`
- shared spritesheet image at `IIIF/<mapId>/sprites/sprites.jpg`
- canonical sprite rectangle lookup at `IIIF/<mapId>/sprites/sprites.json`
- `sprites.json` entries keyed by `canvasAllmapsId`
- compact canvas entries in `geomaps` that keep `canvasAllmapsId` but do not duplicate sprite rectangle payloads

## TODOs

- Re-verify low-zoom preview behavior against the current atlas contract in the browser
- Re-check `runner.ts` fallback behavior only if older data with per-canvas sprite metadata still needs to be supported
- Re-check Massart display text after the title parsing bug is fixed upstream

## Compatibility Check

- `runner.ts` is compatible with the current sprite atlas contract because it now resolves `sprites.json` by `canvasAllmapsId`
- `+page.svelte` is compatible with the restored `centerLon` / `centerLat` fields in `build/index.json`
- No additional viewer code change is currently required for the rebuilt data format
