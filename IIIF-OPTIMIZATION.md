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

## Current rendering pipeline

When a user activates an IIIF layer (e.g. Gereduceerd Kadaster):

1. **Fetch geomaps bundle** (`GereduceerdeKadaster_geomaps.json`) — a compiled JSON containing all georeferenced map annotations (GCPs, resource URLs) for ~111 canvases
2. **Create `WarpedMapLayer`** — one shared Allmaps layer for all maps
3. **`addGeoreferencedMap(raw)`** — called per canvas (~111 times), feeds the GCP annotation to Allmaps. Allmaps parses it and builds a triangulation mesh (this is the expensive step)
4. **`addSprites(sprites, sheetUrl, sheetSize)`** — feeds a pre-packed sprite sheet (regular sprites: `sprites.jpg`) to Allmaps as a texture atlas. Instead of fetching IIIF tiles one-by-one from the image server, Allmaps samples the atlas. This was the first optimization.
5. Layer becomes visible

The loading happens in two phases for performance: a "bootstrap" batch (24 nearest maps to viewport, sequential) then a background batch (remaining, chunked 6 at a time).

### The regular sprites

`sprites.jpg` / `sprites.json` — a texture atlas in Allmaps' internal format. Each entry maps a `canvasAllmapsId` to `{x, y, width, height, scaleFactor, spriteTileScale}`. Allmaps uses this to sample pre-rendered thumbnail pixels instead of fetching IIIF tiles from the server. This solves the **IIIF server latency** bottleneck but does NOT solve the **triangulation** bottleneck.

---

## The bottleneck we are trying to solve

**Triangulation takes a long time.** On lower-end hardware, calling `addGeoreferencedMap` 111 times sequentially takes several seconds. The user sees a blank (or slowly filling) canvas until Allmaps has processed enough maps to cover the viewport.

The sprite atlas (`sprites.jpg`) helps quality (no slow tile fetches) but does not help initial display time because Allmaps still needs to triangulate before it can render anything.

---

## What we tried: gr_sprites

### Concept

Pre-warp each georeferenced canvas server-side using `gdalwarp -t_srs EPSG:3857` and pack the results into a sprite sheet (`gr_sprites.jpg`). Each tile is already rectified — pixels are in Web Mercator space, axis-aligned, north-up. Store the 4-corner WGS84 bounding box for each canvas in `gr_sprites.json`.

At render time, crop each tile from the sheet using `OffscreenCanvas` and add it as a MapLibre native `image` source (4-corner geographic placement). This requires zero triangulation — MapLibre just stretches the image to the 4 corners.

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

`coordinates` is `[NW, NE, SE, SW]` — directly compatible with MapLibre image source `coordinates`.

### How it was integrated

`gr_sprites.json` path is declared in `GereduceerdeKadaster_geomaps.json` under `sprites.grJson`. The loader (`bundleLoader.ts`) reads it and passes it to `initializeLayerGroup` (`initialization.ts`).

In `initialization.ts`:
1. `WarpedMapLayer` is added to the map first (bottom of layer stack, initially empty/invisible)
2. `addGrSpritePlaceholders` crops all tiles via `OffscreenCanvas`, adds each as a MapLibre `image` source + `raster` layer (on top of WarpedMapLayer)
3. Normal Allmaps pipeline runs underneath (triangulation + regular sprites)
4. When Allmaps finishes: `removeAllGrSpritePlaceholders` removes all image sources, WarpedMapLayer is now visible underneath

### Accuracy

For the Gereduceerd Kadaster specifically (19th-century Belgian cadastral maps, consistent Lambert-like projection, rectilinear, low distortion), the 4-corner bilinear approximation is visually indistinguishable from Allmaps' dense mesh at overview zoom levels. The accuracy trade-off is acceptable for a preview.

### Data status (as of June 2026)

- `gr_sprites.json` covers 53 of 111 canvases (the pipeline was run on a subset)
- The hex IDs in `gr_sprites.json` differ from the `canvasAllmapsId` values in the geomaps bundle (two different derivation methods from the same IIIF image URL) — currently cross-referenced via `imageId` (IIIF service URL)
- Full coverage and ID alignment are planned once the pipeline is production-ready

### Performance measurement

| Operation | Time |
|---|---|
| 53 gr_sprites, plain JPEG crop (no pixel masking), 53 addSource/addLayer | ~900ms |
| 53 gr_sprites + per-pixel black masking + PNG encoding | significantly more |

**900ms for 53 tiles is too slow** for what should be an "instant" preview. The breakdown is unclear without profiling — candidates are: (a) `OffscreenCanvas.convertToBlob` × 53, (b) `map.addSource` + `map.addLayer` × 53, (c) image decode/draw, (d) blob URL creation.

### Why gr_sprites.jpg is JPEG (no alpha)

`gdalwarp` fills areas outside the source map boundary with black (NODATA = 0,0,0) when writing JPEG output. To remove the black background we were doing a per-pixel threshold loop after drawing to the OffscreenCanvas, then encoding as PNG. This added significant cost and was reverted for the measurement.

The correct fix is to generate `gr_sprites.png` (or WebP with alpha) in the pipeline so the alpha channel is preserved from the GeoTIFF output. Then no pixel processing is needed at render time — just a plain crop and JPEG/PNG blob.

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

1. **Can 53+ MapLibre image sources be added in < 100ms?** What is the realistic cost of `map.addSource` + `map.addLayer` for a large number of image sources? Is there a batching mechanism?

2. **Is there a way to use a single MapLibre source for the whole sprite sheet and render multiple regions from it?** For example, a `raster` source with a custom tile URL scheme, or a canvas source that composites all tiles, or a WebGL custom layer that samples the sprite sheet directly using per-tile UV coordinates.

3. **Can MapLibre render a spritesheet-backed layer without per-tile sources?** Something like a `fill-pattern` or `icon-image` approach adapted for large geographic rasters?

4. **What is the fastest way to display N pre-warped geographic raster tiles in MapLibre?** Existing art from other map applications (e.g. OpenHistoricalMap, David Rumsey, etc.)?

5. **WebGL custom layer approach**: A single custom WebGL layer that loads the sprite sheet as a texture once, then renders each tile as a textured quad at the correct 4-corner geographic coordinates. This would be a single `addLayer` call and a single texture upload. Is there prior art for this in MapLibre?

6. **Would a single large canvas source work?** Create one `OffscreenCanvas` the size of the full sprite sheet, composite all tiles onto it at their correct positions (they're already packed), then add as a single MapLibre `image` source with the overall bounding box. The problem: a single 4-corner source for the whole sheet would only be accurate if all maps share the same bounding box, which they don't.

7. **OffscreenCanvas in a Web Worker**: The crop/encode operations are CPU-bound and block the main thread. Moving them to a Worker could reduce perceived latency — but does `OffscreenCanvas.convertToBlob` run faster off-main-thread?

8. **Alternative to blob URLs**: Can MapLibre image sources accept `ImageBitmap` or `ImageData` directly, skipping the blob URL encode/decode round-trip?

---

## Relevant files

| File | Purpose |
|---|---|
| `app/src/lib/artemis/iiif/initialization.ts` | Main layer initialization — gr_sprites loading + Allmaps pipeline |
| `app/src/lib/artemis/iiif/grSpritePlaceholder.ts` | OffscreenCanvas crop, MapLibre source/layer management |
| `app/src/lib/artemis/iiif/bundleLoader.ts` | Fetches and parses geomaps bundle, reads `grJson` path |
| `app/src/lib/artemis/iiif/runtime.ts` | Layer group lifecycle, cleanup registration |
| `app/src/lib/artemis/iiif/layerController.ts` | Entry point for layer activation |
| `build/IIIF/GereduceerdeKadaster_geomaps.json` | Data bundle with `sprites.grJson` pointer (data repo) |
| `build/IIIF/GereduceerdeKadaster/sprites/gr_sprites.json` | 53-canvas manifest with coordinates (data repo) |
| `build/IIIF/GereduceerdeKadaster/sprites/gr_sprites.jpg` | Pre-warped tile sprite sheet, 829KB (data repo) |
