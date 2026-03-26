# Artemis RnD — LLM Context

## What This Repo Is

A **SvelteKit viewer** for historical georeferenced maps of Belgium. It loads preprocessed IIIF datasets from a companion GitHub Pages repo (`Artemis-RnD-Data`) and renders them as warped WebGL map layers on top of a dark basemap.

- **Not** a general IIIF browser. Purpose-built for 5 historical map collections.
- **Not** a data pipeline. Data is produced by `Artemis-RnD-Data`; this repo only consumes it.

**Companion repo:** `GhentCDH/Artemis-RnD-Data`
**GitHub Pages base URL:** `https://ghentcdh.github.io/Artemis-RnD-Data/build`

---

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| Frontend framework | SvelteKit 2 + Svelte 5 | — |
| Map renderer | MapLibre GL | 5 |
| Warped IIIF layers | `@allmaps/maplibre` WarpedMapLayer | 1.0.0-beta.42 |
| Allmaps ID utils | `@allmaps/id` | 1.0.0-beta.37 |
| Build tool | Vite + pnpm | — |
| Language | TypeScript | — |

---

## Repo Structure

```
app/
  src/
    routes/
      +page.svelte          — Main page: map shell, all top-level UI state
      +layout.svelte        — Minimal layout wrapper

    lib/
      artemis/
        runner.ts           — Core orchestrator: fetch annotations, build WarpedMapLayers
        layerGroups.ts      — WarpedMapLayer lifecycle (add/remove/reorder/opacity)
        compiledIndex.ts    — Fetches + caches build/index.json
        layerConfig.ts      — Static config: all 5 eras, sublayers, labels, colors
        timeEras.ts         — Time slider zones (Ferraris/Primitief/Gereduceerd)
        types.ts            — Shared types (RunResult, UILog, IiifMapInfo, ParcelClickInfo, etc.)
        metrics.ts          — Bulk run metrics aggregation
        search.ts           — Manifest + toponym search logic
        toponyms.ts         — Toponym index loading
        tileCache.ts        — Tile pre-warm cache helpers
        utils.ts            — fetchJson, joinUrl, etc.
        allmaps.ts          — Allmaps ID/URL generation

        map/
          mapInit.ts        — MapLibre singleton init; WMTS/WMS/GeoJSON/hover layer helpers

        debug/
          attachAllmapsDebugEvents.ts  — Allmaps event monitoring (tile/render events)

        ui/
          LayersPanel.svelte   — Era cards UI (toggle, opacity, sublayer dropdown)
          TimelineSlider.svelte — Year slider linked to active era
          ToponymSearch.svelte — Unified search overlay (manifests + toponyms)
          DebugMenu.svelte     — Collapsible debug log panel
          InfoCards.svelte     — Pinned info cards (IIIF map info, parcel click)

        viewer/
          IiifViewer.svelte   — Embedded Mirador-based IIIF viewer

      components/
        Timeslider.svelte   — **Active** historical timeline slider (era blocks + Massart dots + map pin sync)

      theme.css             — CSS custom properties for dark theme
```

---

## Data Contract (build/index.json)

Fetched once at startup from `{datasetBaseUrl}/index.json`. Shape defined by `CompiledIndex` in `runner.ts`:

```typescript
{
  generatedAt: string;
  totalManifests: number;
  georefManifests: number;
  compiledOk: number;
  layers: LayerInfo[];       // raw collection layers
  renderLayers?: LayerInfo[]; // split render layers (e.g. default vs verzamelblad)
  index: CompiledIndexEntry[];
}
```

Key fields on `CompiledIndexEntry`:
- `sourceManifestUrl` — original IIIF manifest URL
- `compiledManifestPath` — path within `build/` to the preprocessed manifest
- `centerLon` / `centerLat` — geographic center (required for search fly-to)
- `manifestAllmapsId` — Allmaps manifest ID
- `canvasAllmapsHits[]` — per-canvas annotation paths (canvas-level mirrored annotations)
- `isVerzamelblad` — true for overview sheet manifests
- `renderLayerKey` — which render layer this entry belongs to (`"default"` or `"verzamelblad"`)

---

## Layer System

### 5 Historical Eras (`layerConfig.ts`)

| ID | Label | Date | Color |
|---|---|---|---|
| `ferraris` | Ferraris | 1771 | red |
| `vandermaelen` | Vandermaelen | 1846 | purple |
| `primitief` | Primitief kadaster | 1808–1834 | blue |
| `gereduceerd` | Gereduceerd kadaster | 1847–1855 | green |
| `handdrawn` | Hand drawn collection | 19th c. | orange |

### Sublayer kinds

- `wmts` — HISTCART tile service (`geo.api.vlaanderen.be/HISTCART`)
- `wms` — INBO land usage raster (`geo.api.vlaanderen.be/INBO`)
- `iiif` — `@allmaps/maplibre` WarpedMapLayer from compiled annotations
- `geojson` — GeoJSON parcels (Primitief only; others are no-ops)
- `searchable` — toponym search index only, no rendered layer

### Sublayer wiring (what actually works vs placeholders)

| Sublayer ID | Status |
|---|---|
| `ferraris-landusage` (WMS) | untested — WMS PNG transparency unverified |
| `ferraris-toponyms` | search only |
| `vandermaelen-landusage` (WMS) | untested |
| `vandermaelen-toponyms` | search only |
| `primitief-iiif` | functional |
| `primitief-parcels` | functional (GeoJSON hover/click) |
| `primitief-landusage` | no-op placeholder |
| `gereduceerd-iiif` | functional |
| `gereduceerd-parcels` | no-op placeholder |
| `gereduceerd-landusage` | no-op placeholder |
| `handdrawn-*` | all no-op placeholders |

---

## Key Module Responsibilities

### `runner.ts`
- Loads compiled index, canvas info index (pre-warm cache for IIIF info.json)
- Constructs `WarpedMapLayer`, applies mirrored georeference annotations
- Annotation source selection: canvas-level if available, manifest-level fallback
- Park/restore cache: toggling a layer off parks it (opacity=0, stays on map); re-enabling restores instantly without re-fetch
- Exports: `runLayerGroup`, `parkLayerGroup`, `removeLayerGroup`, `resetCompiledIndexCache`
- Types exported: `CompiledIndexEntry`, `LayerInfo`, `CompiledIndex`, `CompiledRunnerConfig`, `LayerRenderStats`

### `layerGroups.ts`
- Tracks active `WarpedMapLayer` instances by `groupId`
- `groupId` = `compiledCollectionPath + "::" + renderLayerKey`
- Controls: `registerLayerGroup`, `removeLayerGroup`, `reorderLayerGroups`, `setLayerGroupOpacity`

### `mapInit.ts`
- MapLibre singleton (`initMap` / `getMap`)
- WMTS helpers: `setHistCartLayerVisible`, `setHistCartLayerOpacity`
- WMS helpers: `setLandUsageLayerVisible`, `setLandUsageLayerOpacity`
- Primitive parcel GeoJSON: `setPrimitiveLayerVisible`, `setPrimitiveHoverFeature`, `setPrimitiveSelectFeature`
- IIIF hover mask: `setIiifHoverMask` (polygon outline on map hover over warped tile)
- Massart pins: `setMassartPins(map, items, year, leeway)`, `updateMassartActiveYear(map, year, leeway)`, `getMassartClickLayerIds()`
- Z-order: WMTS base → WMS land usage → IIIF/GeoJSON

### `layerConfig.ts`
- Single source of truth for layer IDs, labels, colors, sublayer definitions
- `MAIN_LAYER_ORDER`, `MAIN_LAYER_META`, `SUB_LAYER_DEFS`, `MAIN_LAYER_SUBS`
- Helper: `makeInitialMainLayerEnabled`, `makeInitialSubLayerEnabled`

### `timeEras.ts`
- Defines time zones for the timeline slider (1760–1860)
- `TIME_ZONES`: Ferraris (1769–1778), Primitief (1806–1834), Gereduceerd (1845–1855)
- Vandermaelen is a **companion** to Gereduceerd, not its own slider zone
- `getActiveZone(year)`, `buildSliderGradient()` for slider CSS

### `types.ts`
- `RunResult`, `UILog`, `StepTiming` — runner output
- `ToponymIndexItem`, `ManifestSearchItem` — search types
- `IiifMapInfo`, `ParcelClickInfo`, `IiifPanelGroup`, `PinnedCard` — UI panel types
- `MassartItem` — `{ title, year, location, lat, lon, manifestUrl, mmsId, repId }` — Jean Massart photo collection (1904–1912)

---

### `components/Timeslider.svelte`
The active historical timeline slider (1680–present, axis auto-extends to cover all data).

**Props:**
- `massartItems: MassartItem[]` — fed from `+page.svelte`, not fetched internally
- `yearLeeway: number` (default 3) — years ±leeway around scrubber that count as "active"

**Events dispatched:**
- `mainToggle` / `sublayerChange` — toggle map layers on/off as scrubber moves over era blocks
- `year-change: { year }` — fired on every scrubber move; `+page.svelte` uses this to call `updateMassartActiveYear`
- `open-viewer: { title, sourceManifestUrl, imageServiceUrl }` — fired when user clicks "Open in viewer" in a dot popup

**Key behaviours:**
- `axisStart` / `axisEnd` / `ticks` are all **reactive**, derived from SOURCES config + loaded Massart years. Adding new data extends the axis automatically — nothing is hardcoded.
- Era blocks (`SOURCES`) scale up (`scaleY(1.18)`) when the scrubber overlaps them, growing away from the axis (row-above: `transform-origin: bottom center`; row-below: `top center`).
- Massart dots grouped by year; dots within `yearLeeway` of scrubber get `img-dot--near` (scaled + brightened). Multi-year dots show a ring.
- Clicking a dot opens an inline popup (fixed at click coords) with title, location, year, ±navigation for same-year photos, and "Open in viewer" button.

**Data flow (Massart):**
```
+page.svelte onMount → fetch build/Massart/index.json
  → massartItems[]  →  Timeslider prop  (dots on timeline)
                    →  setMassartPins() (GeoJSON layer on map)
slider year-change  →  updateMassartActiveYear() (filter active/inactive pins)
map pin click       →  open IiifViewer
timeline dot click  →  inline popup → open IiifViewer
```

**`SOURCES` config** inside the component defines the 5 era blocks (key, label, year range, color, row, sublayers). This is the only hardcoded content; everything else derives from it.

---

## Massart Data Contract (`build/Massart/index.json`)

```json
{
  "generatedAt": "...",
  "totalItems": 60,
  "coordsAvailable": 60,
  "items": [
    {
      "title": "...",
      "year": "1911",
      "location": "Zonnebeke",
      "lat": 50.87,
      "lon": 2.98,
      "manifestUrl": "https://...",
      "mmsId": "alma...",
      "repId": "..."
    }
  ]
}
```

60 geolocated Belgian photos, 1904–1912. All have coordinates. `manifestUrl` is a IIIF Presentation manifest compatible with `IiifViewer.svelte`.

---

## Known Issues / Debugging Context

### Render starvation (Primitief)
- Primitief has ~273 warped maps; Allmaps renderer only fetches tiles for viewport-visible+fetchable maps
- Under dense workload: `visible 187/273 · fetchable 119` — many maps stall
- Primary cause: renderer policy + dataset density, not upstream pipeline failure
- Key diagnostic log: `viewport-diff(...) visibleNotFetchable:X/Y`

### WMTS z-order on first enable
- When a WMTS layer is enabled after IIIF is already loaded, it may render on top regardless of stack order
- Workaround: manually drag WMTS to top then back; ordering then behaves correctly
- Multiple reorder approaches tried, none fully solve first-enable edge case

### Bad annotation geometry (Primitief, 4 manifests)
- `Edge intersects already constrained edge` from Allmaps CDT triangulation
- Manifests: `04930d7222f43159`, `787106327b287f41`, `949c44555577f899`, `e621fad69cecfcb5`
- Fix: add to blocklist in `Artemis-RnD-Data/src/pipeline.ts` and rebuild

---

## Current Branch: `slider`

Active work: `components/Timeslider.svelte` — historical timeline with era blocks, Massart photo dots, and map pin sync.

Key files modified: `app/src/lib/components/Timeslider.svelte`, `app/src/routes/+page.svelte`, `app/src/lib/artemis/map/mapInit.ts`.

---

## External Services

| Service | URL | Purpose |
|---|---|---|
| Basemap | Carto dark-matter GL style | Dark basemap tiles |
| HISTCART WMTS | `geo.api.vlaanderen.be/HISTCART/wmts` | Ferraris + Vandermaelen raster tiles |
| INBO WMS | `geo.api.vlaanderen.be/INBO/wms` | Land usage overlays |
| Allmaps API | `annotations.allmaps.org` | Live georeference annotations (fallback) |
| Mirador | `projectmirador.org/embed/` | IIIF viewer embed (search result modal) |

---

## LLM Workflow Notes

- Always check `layerConfig.ts` before adding new layer IDs — it is the single source of truth.
- `runner.ts` exports types used widely; check there before looking in `types.ts` for layer-related shapes.
- `+page.svelte` holds all top-level UI state (layer enable/disable, opacity, slider year, search state). It is large; use line numbers when referencing it.
- The `park/restore` pattern in `runner.ts` means toggling a layer off does **not** remove it from the map — check `parkLayerGroup` / `isLayerGroupParked` before assuming a layer was fully removed.
- `compiledIndex.ts` caches the index per `datasetBaseUrl`; call `resetCompiledIndexCache()` when the URL changes.
- `Timeslider.svelte` does **not** fetch data itself. All data (Massart items) is loaded in `+page.svelte` and passed as a prop. The component only dispatches events upward.
- `MASSART_LEEWAY = 3` in `+page.svelte` is the single constant controlling both the map pin active filter and the timeline dot highlight — change it in one place and both update.
- `ui/TimelineSlider.svelte` (under `lib/artemis/ui/`) is a separate, older component for a different use case — do not confuse with `components/Timeslider.svelte`.
