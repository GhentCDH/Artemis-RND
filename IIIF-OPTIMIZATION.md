# IIIF Layer Rendering — Optimization Context

This document exists to give a research agent full context on the current architecture, what has been attempted, what the performance problem is, and what we are looking for.

---

## What the application is

**Artemis** is a SvelteKit + MapLibre GL JS viewer for historical Belgian maps. Users browse a timeline of map collections (Gereduceerd Kadaster, Primitief Kadaster, etc.) and toggle layers on/off. Each IIIF layer contains hundreds of georeferenced map sheets covering Belgium.

The stack:
- **MapLibre GL JS** — the map renderer
- **Allmaps** (`@allmaps/maplibre`) — renders georeferenced IIIF images as a `WarpedMapLayer` (custom MapLibre layer, WebGL-based mesh warping)
- **IIIF image servers** — serve the actual tile pixels on demand

---

## How it works today — high-level overview

When a user activates an IIIF layer the app shows a **pre-warped raster tile pyramid** almost instantly, and only loads the expensive **Allmaps mesh-warping** once the user zooms in far enough to need it. Three independent, statically-served data products back this — all produced by the data pipeline (`Artemis-RnD-Data`) and consumed in the browser with no server at runtime:

1. **Raster tile pyramid** (`{z}/{x}/{y}.webp`, z8–12) — the whole collection mosaicked and pre-rectified into Web Mercator tiles. This is the **base renderer**: a native MapLibre `raster` source, visible the moment the layer is toggled on. Visually indistinguishable from Allmaps at overview/mid zoom.
2. **Geomaps bundle** (`<Collection>_geomaps.json`) — the georeferencing annotations (GCPs) + sprite-atlas refs for every canvas. Drives Allmaps' high-fidelity warped rendering. Fetched **eagerly** (it doubles as the click index), but the triangulation it feeds is **deferred**.
3. **Vector masks** (`<name>_masks.pmtiles`) — one clickable polygon per canvas for hover/click hit-testing. Independent of Allmaps, so canvases are clickable the instant the layer loads.

Lifecycle of one activation:

- **t0 — tiles + masks + bundle:** add the (empty) `WarpedMapLayer`, the raster tile source on top of it, and the mask fill layer; kick off the bundle fetch. The raster preview paints within ~one request round-trip.
- **overview browsing:** the raster pyramid is the sole renderer. **No triangulation happens** — panning is free.
- **zoom past 11.5 (`ALLMAPS_TRIGGER_ZOOM`):** `startAllmaps()` fires — triangulates every canvas (bootstrap batch nearest the viewport first, then the rest chunked), feeds the sprite atlas, then removes the raster placeholder to reveal the now-live `WarpedMapLayer` rendering at full IIIF resolution.
- **toggle off:** if Allmaps never loaded, the layer is fully removed (nothing expensive to preserve); if it did, it's *parked* (meshes kept, opacity 0) for a cheap re-show.

Two supporting mechanisms keep this clean:
- **`iiiftiles://` protocol** gates raster tile requests against the pyramid's `tiles_manifest.json` so tiles outside the irregular coverage are answered with a transparent image locally, never hitting the network (no 404 flood).
- **Step logging** — every stage logs `[IIIF <layer> · <pane>] … Nms` so the whole pipeline (tiles → bundle → zoom trigger → warp batches) is profilable in the console.

The rest of this document expands each piece, then records the history (gr_sprites attempts) that led here.

---

## Background: the original eager-Allmaps pipeline (superseded)

> Historical context. This is how activation worked before the raster-pyramid + lazy-Allmaps rewrite. The Allmaps mechanics below (triangulation, sprites, bootstrap/background batches) are **still used** — but now they run lazily inside `startAllmaps()` on zoom-in, not eagerly on activation.

When a user activated an IIIF layer (e.g. Gereduceerd Kadaster):

1. **Fetch geomaps bundle** (`GereduceerdeKadaster_geomaps.json`) — a compiled JSON containing all georeferenced map annotations (GCPs, resource URLs) for ~111 canvases
2. **Create `WarpedMapLayer`** — one shared Allmaps layer for all maps
3. **`addGeoreferencedMap(raw)`** — called per canvas (~111 times), feeds the GCP annotation to Allmaps. Allmaps parses it and builds a triangulation mesh (this is the expensive step)
4. **`addSprites(sprites, sheetUrl, sheetSize)`** — feeds a pre-packed sprite sheet (regular sprites: `sprites.jpg`) to Allmaps as a texture atlas. Instead of fetching IIIF tiles one-by-one from the image server, Allmaps samples the atlas. This was the first optimization.
5. Layer becomes visible

The loading happens in two phases for performance: a "bootstrap" batch (24 nearest maps to viewport, sequential) then a background batch (remaining, chunked 6 at a time). Both phases now live inside `startAllmaps()` and only run once zoomed in.

### The regular sprites

A texture atlas in Allmaps' internal format, declared per-layer in the geomaps bundle under `sprites.image` (atlas file) / `sprites.json` (manifest) / `sprites.imageSize`. Each entry maps a `canvasAllmapsId` to `{x, y, width, height, scaleFactor, spriteTileScale}`. `bundleLoader.ts` resolves these into a `spriteRef` per canvas and an `inlineSprites` list per manifest entry; `initialization.ts` groups them by target `WarpedMapLayer` and calls `addSprites(sprites, sheetUrl, sheetSize)` once per shared image. Allmaps uses this to sample pre-rendered thumbnail pixels instead of fetching IIIF tiles from the server. This solves the **IIIF server latency** bottleneck but does NOT solve the **triangulation** bottleneck. (When `spriteDebugMode` is on, the loader requests a `_debug` suffixed variant of the atlas image for visual debugging.)

---

## The bottleneck we are trying to solve

**Triangulation takes a long time.** On lower-end hardware, calling `addGeoreferencedMap` 111 times sequentially takes several seconds. The user sees a blank (or slowly filling) canvas until Allmaps has processed enough maps to cover the viewport.

The sprite atlas (`sprites.jpg`) helps quality (no slow tile fetches) but does not help initial display time because Allmaps still needs to triangulate before it can render anything.

---

## What we tried: gr_sprites

### Concept

Pre-warp each georeferenced canvas server-side using `gdalwarp -t_srs EPSG:3857` and pack the results into a sprite sheet (`gr_sprites.jpg`/`.webp`). Each tile is already rectified — pixels are in Web Mercator space, axis-aligned, north-up. Store the 4-corner WGS84 bounding box for each canvas in `gr_sprites.json`.

At render time, place each tile at its 4-corner geographic position. This requires zero triangulation.

### gr_sprites.json format

```json
{
  "spriteSheet": "gr_sprites.jpg",
  "canvases": {
    "<canvasHexId>": {
      "imageId": "https://iiif.../image-service-url",
      "x": 0, "y": 0, "width": 256, "height": 288,
      "coordinates": [
        [4.038, 51.042],
        [4.074, 51.042],
        [4.074, 51.016],
        [4.038, 51.016]
      ]
    }
  }
}
```

`coordinates` is `[NW, NE, SE, SW]`.

### Attempt 1: per-tile MapLibre image sources (superseded)

The first integration (`grSpritePlaceholder.ts`, function `addGrSpritePlaceholders`) cropped each tile out of the sheet via `OffscreenCanvas`, encoded it as a WebP blob, and added it as its own MapLibre native `image` source + `raster` layer (4-corner geographic placement, one source/layer pair per canvas).

Measured cost: **53 gr_sprites, plain crop + `addSource`/`addLayer` per tile ≈ 900ms** — too slow for an "instant" preview, and per-pixel black-background masking (see below) made it worse. `addGrSpritePlaceholders`/`removeAllGrSpritePlaceholders` are kept in `grSpritePlaceholder.ts` but are no longer called from `initialization.ts`.

### Attempt 2: single custom WebGL layer (current)

`grSpriteWebGLLayer.ts` implements `GrSpriteWebGLLayer`, a MapLibre `CustomLayerInterface` (`type: "custom"`, `renderingMode: "2d"`). This answers research question 5 below and is what's wired into `initialization.ts` today:

- One `fetch` + `createImageBitmap` for the **whole sprite sheet**, uploaded as a **single WebGL texture** (`onAdd`/`loadTextureAndBuildBuffer`).
- One vertex buffer holding two triangles (a quad) per canvas, positioned via `MercatorCoordinate.fromLngLat` on each canvas's `coordinates`, with UVs computed from that canvas's `{x, y, width, height}` within the sheet.
- `render()` does a single `drawArrays(TRIANGLES, ...)` call over the whole buffer — no per-tile draw calls, no per-tile sources/layers.
- Timing (`fetch` / `bitmap decode` / `buffer+texture upload` / total) is logged to the console (`[GrSpriteWebGL] ...`) on every load for ad-hoc profiling.

In `initialization.ts`, the layer group init order is now:
1. `WarpedMapLayer` is added first (bottom of stack, initially empty)
2. If the layer group has a `grSpritesPath`, `GrSpriteWebGLLayer` is added on top (masks the empty `WarpedMapLayer` while Allmaps loads underneath); its removal is registered via `runtime.activeLayerCleanup` in case the group is torn down mid-load
3. Normal Allmaps pipeline runs underneath (bootstrap batch, then chunked background batch, then regular sprites via `addSprites`)
4. When Allmaps finishes, the `GrSpriteWebGLLayer` is removed and the cleanup entry is cleared — `WarpedMapLayer` is now visible underneath

There's also a `grSpriteOnly` option on `initializeLayerGroup` that adds the WebGL placeholder layer and returns immediately, skipping the Allmaps pipeline entirely — used to benchmark the placeholder phase in isolation.

### Measured performance (current, WebGL layer)

Console output for the Gereduceerd Kadaster (111 tiles):

```
[GrSpriteWebGL] 111 tiles | fetch 611ms | bitmap 404ms | buffer+tex 0ms | total 1015ms
```

`buffer+tex` (vertex buffer build + texture upload) is effectively free. The cost is entirely **fetch** (611ms, network + server-side JPEG/WebP decode-ability of the sheet itself) and **bitmap decode** (404ms, `createImageBitmap` decoding the whole sheet in one shot). Neither scales with per-canvas count in the way Attempt 1's per-source approach did — but both scale with **sheet byte size / pixel count**, which grows with canvas count and resolution. Primitief Kadaster (452 canvases, 4096×15103 sheet) will be substantially worse on both axes since it's a much larger image to fetch and decode, not because of more `addLayer` calls.

This reframes the bottleneck: it's no longer "too many init calls" (solved by the single-texture approach) but "one very large image to fetch and decode," which is fundamentally a function of total pixel volume, not tile count.

### Two runtime optimizations applied on top of the WebGL layer

Neither preprocessing (below) nor GDAL is needed for these — they only change when/how existing network+decode work happens:

1. **Parallelize the load waterfall (`initialization.ts`)**: previously the gr_sprites manifest fetch only started *after* `await loadNewIiifEntries(...)` (the geomaps bundle fetch, which itself may do its own sequential regular-sprites-json fetch) fully resolved — a serial chain of up to 3 round trips before the sheet fetch even began. `layerInfo.grSpritesPath` is usually known synchronously from static layer config (set in `ArtemisApp.svelte`, matching `resolveGrSpritesPath`'s first-priority branch in `bundleLoader.ts`), so the gr_sprites manifest+sheet load now starts immediately alongside `loadNewIiifEntries` instead of after it. Falls back to the bundle-resolved path only if no static hint was available. Net effect: total time-to-preview becomes `max(bundle load, gr_sprites load)` instead of their sum.
2. **Cache the fetched sheet Blob across activations (`grSpriteWebGLLayer.ts`)**: toggling a layer off/on, revisiting a collection, or opening the same layer in a second compare-mode pane previously refetched and redecoded the whole sheet every time. The compressed `Blob` (not the decoded `ImageBitmap`, to keep memory bounded for large sheets like Primitief Kadaster's 4096×15103) is now cached per `sheetUrl` at module scope, so repeat loads skip the ~600ms fetch and pay only the `createImageBitmap` decode cost. The console log now appends `(cached)` to the fetch timing when this hits.

Neither change touches the underlying fetch+decode cost of a *first* load of a given sheet — that's still bound by sheet byte size/pixel count, which is what the tiled raster mosaic direction (above) targets.

### Accuracy

For the Gereduceerd Kadaster specifically (19th-century Belgian cadastral maps, consistent Lambert-like projection, rectilinear, low distortion), the 4-corner bilinear approximation is visually indistinguishable from Allmaps' dense mesh at overview zoom levels. The accuracy trade-off is acceptable for a preview.

### Data status

- `gr_sprites.json`/sheet coverage and ID alignment between `gr_sprites.json` canvas IDs and `canvasAllmapsId` are data-pipeline concerns (data lives in a separate repo), not part of the app code covered here — check the current bundle's `sprites.grJson` (or `IIIF/<mapId>/sprites/gr_sprites.json` convention in `bundleLoader.ts`'s `resolveGrSpritesPath`) for up-to-date coverage.

### Why the sheet needs an alpha channel

`gdalwarp` fills areas outside the source map boundary with black (NODATA = 0,0,0) when writing JPEG output, and JPEG has no alpha channel. The WebGL layer samples the sheet directly as a texture (no per-tile canvas compositing), so there is no render-time opportunity to mask out the black background — the sheet itself must already have transparent NODATA pixels (PNG or WebP with alpha) for tiles to blend correctly against whatever is underneath. This is a data-pipeline requirement now, not a render-time cost tradeoff.

---

## Current implementation: XYZ raster tiles (superseded gr_sprites/WebGL layer)

The gr_sprites/WebGL-atlas approach above (Attempts 1 & 2) has been fully replaced. The data pipeline now produces a conventional `gdal2tiles.py`-style XYZ/WebMercator tile pyramid per collection (mosaic all warped canvases into one georeferenced raster, then cut it into `{z}/{x}/{y}.webp` tiles, zoom 8–12), and the app consumes it with a **native MapLibre `raster` source** instead of any custom placeholder layer. `GrSpriteWebGLLayer` and `grSpritePlaceholder.ts` were deleted (no longer referenced anywhere).

### Data layout (data repo, `Artemis-RnD-Data`)

For each collection: `IIIF/<CollectionDir>/<tiles-dir>/{z}/{x}/{y}.webp` plus a `tiles_manifest.json` alongside it — a flat JSON array of every tile's relative path (e.g. `"10/522/341.webp"`), generated from the actual files on disk. This exists because coverage is an **irregular shape** (the real surveyed extent of Belgium, not a rectangle), so there's no way to derive the exact tile set from a bounding box without guessing and eating many spurious 404s.

Known pyramids as of this writing (directory names aren't a fixed convention — they vary per pipeline run, hence the explicit lookup table in code). The app serves the **full z8–12 range**; MapLibre requests only the handful of tiles intersecting the current viewport:
- `IIIF/GereduceerdeKadaster/Gereduceerd_Kadaster_tiles/` — 183 tiles total (z8–12), ~2.2MB
- `IIIF/PrimitiefKadaster/primitief_kadaster_tiles/` — 90 tiles total (z8–12), ~836KB

### Full zoom range (z8–12), uniform per collection

`KNOWN_TILE_DIRS` uses `minZoom: 8, maxZoom: 12` — everything the pipeline generates — identically for both collections (no per-layer pinning). This changed once the raster pyramid became the **persistent base renderer** rather than a transient placeholder: since Allmaps is now loaded lazily only on zoom-in (see "Lazy Allmaps" below), the pyramid must be sharp at whatever zoom the user is actually at, not a single overzoomed level. The full range costs nothing extra at render time because MapLibre requests only viewport-intersecting tiles on demand (and still overzooms past z12 for the brief window before Allmaps takes over). An earlier iteration pinned this to z10-only to shrink a prewarm payload; that's obsolete now that prewarming is gone.

### App-side resolution (`bundleLoader.ts`)

`resolveTilesConfig(layerInfo)` resolves a `{ template, minZoom, maxZoom }` for a layer **synchronously from `layerInfo` alone** — no bundle/manifest fetch needed to know *where* the tiles are (unlike the old gr_sprites manifest fetch). Priority: `layerInfo.tilesPath`/`tilesMinZoom`/`tilesMaxZoom` explicit override, else a hardcoded `KNOWN_TILE_DIRS` lookup by `layerInfo.map` (mapId).

### Runtime rendering + lazy Allmaps (`initialization.ts`)

Per layer-group init:
1. `WarpedMapLayer` added first (bottom of stack, initially empty), same as before.
2. If `resolveTilesConfig` returns a config, immediately `map.addSource(tilesSourceId, { type: "raster", tiles: [...], tileSize: 256, minzoom, maxzoom })` + `map.addLayer({ ..., paint: { "raster-opacity": 0.85 } })` on top — synchronous, no manifest fetch. Its layer id joins the group's `layerIds` so reorder/teardown track it like any other layer. MapLibre lazily requests only the `{z}/{x}/{y}` tiles intersecting the viewport.
3. The geomaps bundle is still fetched eagerly (masks-click index by `sourceManifestUrl` depends on it), but the **expensive Allmaps pipeline is deferred**. It's wrapped in an idempotent `startAllmaps()` and only run when the map zoom reaches `ALLMAPS_TRIGGER_ZOOM` (**11.5**): if already zoomed in at activation (e.g. a deep-linked/persistent URL), it fires immediately; otherwise a one-shot `map.on("zoom", …)` listener arms it. Fire-and-forget either way — the raster preview shows instantly and callers don't await triangulation.
4. When `startAllmaps()` completes (bootstrap batch → chunked background batch → regular sprites), it removes the raster layer+source and deletes the `runtime.activeLayerCleanup` entry, revealing the now-triangulated `WarpedMapLayer` underneath.

Below `ALLMAPS_TRIGGER_ZOOM` the raster pyramid is the sole renderer — visually equivalent to Allmaps at overview zoom (the doc's earlier accuracy finding), but with zero triangulation cost. This means panning around at overview never pays the multi-second `addGeoreferencedMap` × N cost at all; it's incurred only when a user actually zooms in to read detail, which is exactly when Allmaps' full-resolution warp is worth it.

**Park/teardown interaction.** The raster placeholder must not linger on screen when a group is toggled off before Allmaps has loaded. Rather than special-case park/restore, `parkLayerGroup` checks `runtime.activeLayerCleanup.has(groupId)` — which is true iff Allmaps is still deferred (the cleanup entry exists only while the raster is up) — and in that case fully removes the group instead of parking it. There's nothing expensive to preserve yet, and a later re-show re-inits cheaply (raster + masks + bundle, no warp). Once Allmaps has loaded, the cleanup entry is gone and `parkLayerGroup` does its normal opacity-preserving park to keep the triangulated meshes across a hide/show. The `detachZoomTrigger` for a still-pending listener is folded into the same `activeLayerCleanup` closure, so `removeLayerGroup` unhooks it for free.

This eliminates the entire "fetch+decode one big sheet" bottleneck that Attempts 1 & 2 were chasing — there's no sheet to fetch at all; MapLibre's own tile-request pipeline (caching, cancellation, viewport-driven prioritization) does the work at **per-tile** granularity — and it also defers the triangulation cost out of the common overview-browsing path entirely.

### No prewarming

There is no tile prewarming. The raster source's own viewport-driven fetching (a single HTTP/2 wave of the ~6–12 tiles covering the viewport, ~280ms, well inside the display budget) handles first activation, and the browser HTTP cache covers re-activations. An earlier `tilePrewarm.ts` fetched every z10 tile of every known pyramid at startup; it was removed because (a) with persistent/shareable URLs a layer can already be active on first load, so "warm before the user picks anything" doesn't hold, and gating warming on that would add exactly the kind of when-to-warm conditional we want to avoid, and (b) full prewarming doesn't scale past a handful of small collections (mobile data, wasted bandwidth for untouched collections). `listKnownTilePyramids()` was removed with it. (`tiles_manifest.json` is still used — by the tile protocol below — just not for prewarming.)

### Suppressing tile 404s: the `iiiftiles://` protocol (`tileProtocol.ts`, `mapInit.ts`)

Coverage is an **irregular shape**, so a plain `raster` source probes the full viewport grid and 404s on every tile outside the surveyed extent (e.g. `…/10/521/342.webp` → 404). Those 404s are harmless — MapLibre skips missing tiles — but the **browser logs every failed request natively**, flooding the console. Nothing in JS can suppress browser-level network logging, and a `map.on("error")` handler only silences MapLibre's *own* error objects, not the browser's request log. The only way to stop them is to **not make the request**.

The `iiiftiles://` custom MapLibre protocol does exactly that, using the `tiles_manifest.json` (flat list of the `z/x/y.webp` that actually exist) that already ships with each pyramid:

- `registerIiifTileProtocol()` adds the scheme once at module scope in `mapInit.ts` (beside the `pmtiles` registration).
- The raster source's tile template is wrapped with `toIiifTileTemplate(...)` → `iiiftiles://https://…/{z}/{x}/{y}.webp`.
- On each tile request the handler derives that pyramid's `tiles_manifest.json`, loads it once (cached per pyramid, shared across all its tiles — **not** tied to any single request's `AbortController`), and:
  - **not in the manifest →** returns a 1×1 transparent PNG locally. No HTTP request, no 404.
  - **in the manifest →** `fetch`es the real tile (browser HTTP cache still applies; the request's `AbortController.signal` is forwarded so MapLibre can cancel it).
  - **manifest unavailable →** fetches directly (best-effort); never breaks rendering.
- `prefetchIiifTileManifest(...)` is called the moment the raster source is added, so the manifest is warm before the first tile request and gating adds no first-paint latency.

This is **not** the old prewarming: it fetches one tiny index per pyramid, never tiles, and only ever *prevents* fetches. (A future alternative that removes even the manifest fetch: package the raster tiles as a `.pmtiles` archive, like the masks already are — the pmtiles protocol returns nothing for absent tiles with no per-tile request. That needs a data-pipeline change.)

Separately, `mapInit.ts` also installs a scoped `map.on("error")` that swallows tile-load errors for `iiif-tiles-source-*` sources (matched by source id, URL-pattern fallback) and re-logs everything else — so any residual MapLibre-level tile error (e.g. manifest miss during warm-up) doesn't spam the console either.

### Step logging (`initialization.ts`)

Every activation logs a `[IIIF <layer> · <pane>] <step> … Nms` timeline (monotonic `performance.now()` via `nowMs()`), so time-to-visible and each warp stage are profilable in the browser console without a debugger:

- `tiles: raster placeholder added (z8-12) +Nms` and `tiles: first tile painted Nms`
- `bundle: loaded N manifests / N canvases in Nms`
- `warp: deferred — armed zoom trigger at ≥ 11.5 …` **or** `warp: already at zoom … — loading Allmaps immediately`
- `warp: start at zoom X — triangulating N canvases` → `warp: bootstrap N canvases Nms` → `warp: background N canvases Nms` → `warp: sprites Nms`
- `warp: ready in Nms — placeholder removed, WarpedMapLayer live`

(The base-map zoom logger `[Artemis] pane=… zoom=… tileZ=…` in `ArtemisApp.svelte` is separate and still present. The old `[Artemis debug] …` overlay/click logs were removed.)

---

## Clickable canvas outlines: PMTiles vector masks (replaces live geoMask hit-testing)

Previously (see the earlier "how do we build the clickable outline" discussion), hover/click hit-testing was a JS point-in-polygon loop over every active canvas's `warpedMap.geoMask` (Allmaps' live triangulated geometry), rebuilding a GeoJSON hover source on every change. This has been replaced by pre-baked PMTiles vector tiles.

### Data (data repo)

`IIIF/<Collection>/<name>_masks.pmtiles` — one PMTiles archive per collection, single vector layer named `masks`, one polygon per canvas, with two properties: `manifestUrl` (the source IIIF manifest URL) and **`imageId`** (the per-canvas key, matching the sprite manifest's canvas key). Built with `tippecanoe -l masks -Z 8 -z 12`. `GereduceerdeKadaster` has 111 features, `PrimitiefKadaster` 455.

`imageId` exists because `manifestUrl` is **not unique per canvas** — a manifest can contain many canvases (up to 13 for Primitief Kadaster; 455 features but only ~166 distinct `manifestUrl`s). Resolving a click by `manifestUrl` alone would open the wrong canvas (always the manifest's first). `imageId` disambiguates to the exact clicked canvas.

### App-side (`bundleLoader.ts`, `runtime.ts`, `initialization.ts`)

- `resolveMasksPath(layerInfo)` — same override-then-known-mapId-lookup pattern as `resolveTilesConfig`/`resolveGrSpritesPath`.
- `mapInit.ts` registers the `pmtiles://` protocol once (`maplibregl.addProtocol("pmtiles", new PMTilesProtocol().tile)`, from the `pmtiles` npm package) so a `vector` source can reference an archive directly.
- Per layer group, `initialization.ts` adds one `vector` source + a single **invisible** `fill` layer (`fill-opacity: 0`), **persistent for the group's whole lifetime** (unlike the transient raster-tile placeholder) — it exists purely so `queryRenderedFeatures` can hit-test it. Source/layer ids are fully deterministic from `groupId` (`getMaskLayerIds()` in `runtime.ts`), so creation, hit-testing, and teardown never need extra bookkeeping to find them.
- `runtime.ts`'s `removeLayerGroup` also removes the group's mask source (by deterministic id) on full teardown; the fill layer id rides along in the same `layerIds` array as the `WarpedMapLayer`, so park/restore/removal all work for free through existing machinery.
- Manifest info needed to open the viewer is indexed two ways, both populated directly from the geomaps bundle's parsed entries as soon as they load — independent of Allmaps triangulation, so hover/click work the instant a layer's masks source loads:
  - **`sourceManifestUrlToManifestInfo`** (`getManifestInfoForSourceManifestUrl`) — manifest-level fallback.
  - **`canvasKeyToManifestInfo`** (`getManifestInfoForCanvasKey`) — per-canvas, keyed by **both** a canvas's `canvasAllmapsId` and its `imageServiceUrl`. The mask's `imageId` is matched against this first, so a click resolves to the exact canvas and carries *that canvas's own* `imageServiceUrl`. Indexing under both identifiers means resolution succeeds whichever value the pipeline writes as `imageId` (the app can't see the pipeline's exact choice).
- **Click resolution** (`buildIiifInfoPanelItems` in `ArtemisApp.svelte`): resolve by `imageId` → `canvasKeyToManifestInfo` first; fall back to `manifestUrl` → `sourceManifestUrlToManifestInfo` only when the canvas key doesn't resolve (older mask data without `imageId`). The resolved canvas's `imageServiceUrl` is passed to `IiifViewer`, which uses it directly (`let serviceUrl = imageServiceUrl`) to open that exact canvas rather than resolving the manifest's first canvas.

### Hit-testing and hover outline (`ArtemisApp.svelte`, `mapInit.ts`)

`hitTestIiifMasks(map, point, paneId)` replaces `hitTestAllWarpedMaps`/`pointInPolygon`: it queries `queryRenderedFeatures` against every active group's (invisible) fill layer — native MapLibre spatial indexing instead of a JS loop over every canvas's polygon, so cost scales with what's near the cursor rather than total canvas count (see the earlier discussion of this tradeoff).

**Overlapping-feature bug and fix**: real cadastral coverage isn't disjoint (verzamelblad/index sheets cover many individual sheets) and vector-tile clipping can duplicate a feature near a tile boundary, so a query can return multiple raw hits at one cursor position. `hitTestIiifMasks` ranks all raw hits by bounding-box area (`geometryBboxArea`) and keeps only the smallest ("most specific" polygon), always returning at most one hit.

The first implementation then tried to draw the hover outline by `setFilter`-ing a shared vector `line` layer to `manifestUrl === <hit>`. **This was itself buggy**: `manifestUrl` is a per-*manifest* property, not per-*canvas*, and isn't unique — Gereduceerd Kadaster has 111 mask features but only 103 distinct `manifestUrl` values (some manifests have multiple canvases). Filtering by it highlighted every sibling canvas sharing a manifest, not just the one under the cursor — reproducing the exact "multiple canvases hovered" symptom the PMTiles switch was supposed to fix, just from a different cause than before. Fixed by dropping the filtered vector line layer entirely: `setIiifMaskHover()` (`mapInit.ts`) instead draws the hover outline from the **exact queried feature's own geometry** into a single shared GeoJSON source/layer (one feature at a time, always exactly the one hit), sidestepping the non-unique-property problem altogether.

**Stale-click bug**: after the above fix, hover correctly showed exactly one outline, but clicking sometimes opened a different canvas than the one under the cursor. Cause: the main/left pane's click handler reused `iiifHoveredMaps` — hover state set by the last *processed* `mousemove`, which is throttled to one update per `requestAnimationFrame` — instead of hit-testing at the click's own point. If a click landed in the same frame as an unprocessed mousemove, the reused state could be one frame stale. The right pane's click handler already called `hitTestIiifMasks(targetMap, e.point, 'right')` fresh; the left pane now does the same (`hitTestIiifMasks(map, e.point)`) instead of trusting `iiifHoveredMaps`.

---

## What we want

Near-instant initial display of all georeferenced maps when a layer is activated, followed by progressive quality improvement as Allmaps triangulates and loads full IIIF data.

Constraints:
- The data is served as static files from GitHub Pages (no server-side rendering)
- Must work in a browser (no Node, no GDAL at runtime)
- Must integrate with MapLibre GL JS and the existing Allmaps pipeline
- Initial display should appear in < 200ms ideally; < 500ms acceptable
- The full Allmaps rendering (with mesh warping) should replace the preview seamlessly

---

## Open research questions

> **Historical.** These questions were logged while exploring the gr_sprites / WebGL-atlas approaches and predate the current XYZ-raster-pyramid + lazy-Allmaps + `iiiftiles://` implementation. Most are now moot or answered by that rewrite (see the high-level overview and the sections above). References below to `GrSpriteWebGLLayer` / `gr_sprites` as "current production" are stale — those were deleted. Kept for provenance.

1. ~~Can 53+ MapLibre image sources be added in < 100ms?~~ Measured: no (~900ms for 53). Abandoned in favor of question 5's approach.

2. ~~Is there a way to use a single MapLibre source for the whole sprite sheet and render multiple regions from it?~~ Superseded by the WebGL approach (question 5) rather than answered via a native MapLibre source type.

3. **Can MapLibre render a spritesheet-backed layer without per-tile sources?** Something like a `fill-pattern` or `icon-image` approach adapted for large geographic rasters — not pursued once the WebGL layer worked.

4. **What is the fastest way to display N pre-warped geographic raster tiles in MapLibre?** Existing art from other map applications (e.g. OpenHistoricalMap, David Rumsey, etc.)? Partially answered: standard XYZ raster tile pyramids (native MapLibre `raster` source) are the conventional answer here — see "Next direction: tiled raster mosaic" below. Not yet implemented/measured against the current WebGL layer.

5. **WebGL custom layer approach — implemented.** `GrSpriteWebGLLayer` (`grSpriteWebGLLayer.ts`) loads the sprite sheet as a single texture once, then renders every tile as a textured quad at its correct 4-corner geographic coordinates in one `drawArrays` call. This is the current production approach. Remaining open item: no hard numbers yet on total time-to-visible for a full (111-canvas) sheet on low-end hardware — the console timing log exists but hasn't been systematically collected.

6. ~~Would a single large canvas source work?~~ Moot — the WebGL layer solves this without needing a single shared bounding box, since each quad gets its own 4 geographic corners.

7. **OffscreenCanvas in a Web Worker**: no longer relevant to the gr_sprite path (no per-tile crop/encode happens anymore), but still a live question for the *regular* Allmaps sprite pipeline if that ever becomes a bottleneck.

8. ~~Alternative to blob URLs~~ Moot for gr_sprites — the WebGL layer uploads the decoded `ImageBitmap` straight to a GPU texture via `texImage2D`, no blob URL round-trip.

New questions raised by the WebGL approach:

9. **Texture memory / size limits**: the whole sprite sheet is uploaded as one texture. For a full 111-canvas sheet (or multiple layers active at once), is there a risk of hitting `MAX_TEXTURE_SIZE` or excessive GPU memory use? Would tiling the sheet across multiple textures be needed at scale?

10. **Opacity/z-order interaction with `WarpedMapLayer`**: the placeholder currently renders at a fixed `opacity` (default 0.85) above the (initially empty) `WarpedMapLayer`. As Allmaps maps get added incrementally underneath during the bootstrap/background batches, is there any visible popping/flicker at the swap point when the placeholder layer is removed, and would a crossfade be worth adding?

11. **Tiled raster mosaic vs. single-texture atlas — which wins in practice?** The proposed tiled approach (see "Next direction" above) should reduce initial fetch/decode cost for large layers like Primitief Kadaster, but this is currently a hypothesis, not a measurement. Needs a prototype pipeline (mosaic + `gdal2tiles.py` or similar) and a side-by-side timing comparison against the current 111-tile / 1015ms baseline before committing.

---

## Relevant files

| File | Purpose |
|---|---|
| `app/src/lib/artemis/iiif/initialization.ts` | `initializeLayerGroup` — adds empty `WarpedMapLayer` + raster tile placeholder + PMTiles mask fill layer, indexes manifest/canvas info, then defers the Allmaps pipeline behind the zoom trigger (`startAllmaps` = bootstrap + chunked background batches + sprites). Emits the `[IIIF …]` step logs. |
| `app/src/lib/artemis/iiif/bundleLoader.ts` | Fetches/parses the geomaps bundle into per-canvas `inlineMaps` (with `canvasAllmapsId`, `imageServiceUrl`, `spriteRef`) + `inlineSprites`; `resolveTilesConfig` (`KNOWN_TILE_DIRS`, z8–12) and `resolveMasksPath`, resolved synchronously from `layerInfo`. |
| `app/src/lib/artemis/iiif/tileProtocol.ts` | The `iiiftiles://` protocol: gates raster tile requests against `tiles_manifest.json`, transparent-tile fallback for missing tiles, manifest cache + `prefetchIiifTileManifest`. |
| `app/src/lib/artemis/iiif/runtime.ts` | Per-pane layer-group lifecycle: active/parked groups, `activeLayerCleanup` (also the "Allmaps deferred?" flag `parkLayerGroup` checks), and the `sourceManifestUrlToManifestInfo` / `canvasKeyToManifestInfo` click indexes. |
| `app/src/lib/artemis/map/mapInit.ts` | Map creation; registers `pmtiles` + `iiiftiles` protocols; scoped `map.on("error")` that swallows IIIF tile-load errors; `setIiifMaskHover` shared hover-outline source. |
| `app/src/lib/artemis/iiif/layerController.ts` | Entry point for layer activation (`runLayerGroup`) and re-exports of the runtime lifecycle/index getters. |
| `app/src/lib/artemis/iiif/layerLifecycle.ts` | Higher-level pane/layer orchestration on top of `layerController.ts` (used by the UI). |
| `app/src/lib/artemis/app/ArtemisApp.svelte` | Hit-testing (`hitTestIiifMasks`, smallest-footprint pick) and click resolution (`buildIiifInfoPanelItems`, `imageId`-first). |
| `build/IIIF/<Collection>_geomaps.json` | Geomaps bundle: GCP annotations + sprite-atlas refs per canvas (data repo). |
| `build/IIIF/<Collection>/<tiles-dir>/{z}/{x}/{y}.webp` + `tiles_manifest.json` | Pre-warped XYZ raster pyramid (z8–12) + the tile-existence manifest the `iiiftiles://` protocol gates against (data repo). |
| `build/IIIF/<Collection>/<name>_masks.pmtiles` | Per-canvas clickable footprint polygons, properties `manifestUrl` + `imageId` (data repo). |
