# Artemis-RnD — LLM State File

_Last updated: 2026-03-19 (Timeslider UI — slider branch)_

## What this repo is

R&D viewer/test harness for live georeferencing of historical Belgian maps using Allmaps + MapLibre GL.
Loads a pre-compiled dataset from GitHub Pages (Artemis-RnD-Data), renders warped IIIF map layers on an interactive basemap, and supports toponym/manifest search.

## Active branch: `slider`

Branched from `main`. Current work: replacing the old `LayersPanel` + `TimelineSlider` UI with a new unified **Timeslider** component (`app/src/lib/components/Timeslider.svelte`).

---

## Tech stack

- **SvelteKit 2 + Svelte 5** (using `$:` reactive declarations, `on:` event dispatchers — Svelte 4 syntax in page)
- **MapLibre GL 5**
- **@allmaps/maplibre** 1.0.0-beta.42 — `WarpedMapLayer`
- **@allmaps/id** 1.0.0-beta.37
- **TypeScript + Vite + pnpm**

---

## Key files

| File | Purpose |
|------|---------|
| `app/src/routes/+page.svelte` | Main shell: map init, all layer toggle logic, toponym/manifest search, hover/click handlers, info card state |
| `app/src/lib/artemis/runner.ts` | Core orchestrator: fetch index + annotations, build WarpedMapLayer(s), park/restore/remove layer groups, keepalive repaint loop, render stats |
| `app/src/lib/artemis/types.ts` | All shared types: `RunResult`, `StepTiming`, `UILog`, `ToponymIndexItem`, `ManifestSearchItem`, `IiifMapInfo`, `ParcelClickInfo`, `IiifPanelGroup`, `PinnedCard` |
| `app/src/lib/artemis/layerConfig.ts` | Layer tree definition: 5 main layers (`ferraris`, `vandermaelen`, `primitief`, `gereduceerd`, `handdrawn`), sub-layer kinds (iiif/geojson/wmts/wms/searchable), initial enabled state |
| `app/src/lib/artemis/map/mapInit.ts` | MapLibre singleton, HISTCART WMTS layers (Ferraris/Vandermaelen from geo.api.vlaanderen.be), land usage WMS overlays (INBO), primitive GeoJSON parcel layer, IIIF hover mask layer |
| `app/src/lib/artemis/metrics.ts` | Bulk run metrics aggregation |
| `app/src/lib/artemis/search.ts` | `normalizeSearchText` utility |
| `app/src/lib/artemis/toponyms.ts` | `normalizeRawToponym` — normalises raw toponym index items |
| `app/src/lib/artemis/utils.ts` | `asFiniteNumber` and misc helpers |
| `app/src/lib/artemis/tileCache.ts` | IIIF tile cache helpers |
| `app/src/lib/artemis/timeEras.ts` | Time era metadata (referenced but not yet wired to UI fully) |
| `app/src/lib/artemis/compiledIndex.ts` | Compiled index helpers |
| `app/src/lib/artemis/layerGroups.ts` | Layer group helpers |
| `app/src/lib/artemis/allmaps.ts` | Allmaps ID/URL generation |
| `app/src/lib/artemis/debug/attachAllmapsDebugEvents.ts` | Allmaps event monitoring (attached on map mount) |
| `app/src/lib/components/Timeslider.svelte` | **New unified timeline UI** — replaces LayersPanel + TimelineSlider. Scrubber bar with source pills, floating sublayer panel, main/sublayer toggle events. See section below. |
| `app/src/lib/artemis/ui/LayersPanel.svelte` | **Removed from page** (file exists, no longer mounted). Replaced by Timeslider. |
| `app/src/lib/artemis/ui/TimelineSlider.svelte` | **Removed from page** (file exists, no longer mounted). Was Massart photo timeline. |
| `app/src/lib/artemis/ui/InfoCards.svelte` | Right-side info cards for IIIF map hover/click + parcel click; pin/focus/viewer actions |
| `app/src/lib/artemis/ui/ToponymSearch.svelte` | Search bar (toponym index + manifest search); fires `fly-to-toponym` / `manifest-click` |
| `app/src/lib/artemis/ui/DebugMenu.svelte` | Dataset URL input, reload, logs panel, render stats |
| `app/src/lib/artemis/viewer/IiifViewer.svelte` | IIIF image viewer overlay (opens from info card) |

---

## Timeslider component (`app/src/lib/components/Timeslider.svelte`)

### What it does
A horizontal timeline scrubber spanning 1680–1870. Five historical map sources appear as coloured pills on two rows above/below a central axis line. A draggable circular timeknob sits on the axis.

- **Scrubbing over a pill** → floating top-left panel appears showing that source's sublayer checkboxes
- **Clicking a pill** → toggles the entire main layer on/off (disabled = greyed out + desaturated)
- **Enabling a layer** → timeknob jumps to that source's representative year
- **Disabling a layer** → timeknob stays

### Sources (SOURCES array)
| key | mainId | Label | Range | repr | Color | Row |
|-----|--------|-------|-------|------|-------|-----|
| `hand` | `handdrawn` | Hand drawn | 1700–1715 | 1707 | `#8B7EC8` | 1 |
| `ferraris` | `ferraris` | Ferraris | 1770–1778 | 1774 | `#2E8B72` | 1 |
| `primitief` | `primitief` | Primitief Kadaster | 1808–1834 | 1814 | `#C07B28` | 2 |
| `vander` | `vandermaelen` | Vandermaelen | 1846–1854 | 1850 | `#C04A28` | 1 |
| `gered` | `gereduceerd` | Gereduceerd Kadaster | 1847–1855 | 1851 | `#2A6FAA` | 2 |

### Default sublayer state
- IIIF sublayers (`*-iiif`): `defaultOn: true`
- All other sublayers (parcels, landuse, water): `defaultOn: false`
- All 5 main layers start enabled

### Events dispatched
- `mainToggle: { mainId: string; enabled: boolean }` — on pill click or `onMount`
- `sublayerChange: { subId: string; enabled: boolean }` — on sublayer checkbox or `onMount` (only for `defaultOn` sublayers)

### Wiring in +page.svelte
```svelte
<Timeslider on:mainToggle={onTimesliderMainToggle} on:sublayerChange={onTimesliderSublayerChange} />
```
Handlers call `toggleMainLayer(mainId, enabled)` and `toggleSubLayer(subId, enabled)`.
Component is wrapped in `.timeslider-wrap { position: absolute; bottom: 12px; left: 12px; right: 12px; z-index: 4; }`.

### Key layout/z-index notes
- `.ts-axis-line { z-index: 3; pointer-events: none }` — axis sits above pills visually; transparent to clicks
- `.ts-scrubber { height: 18px; pointer-events: auto; z-index: 5 }` — 18×18px circular thumb
- Pills: `bottom: 12px` (row-above) / `top: 12px` (row-below) — outside scrubber's ±9px hit zone
- Floating panel: `position: fixed; top: 12px; left: 12px; z-index: 50`

### Start position
Timeknob initialised at **1814** (Primitief Kadaster representative year).

---

## Layer model

### Main layers (eras)
| ID | Label | Date | Color | Backing layer type |
|----|-------|------|-------|--------------------|
| `ferraris` | Ferraris | 1771 | red | WMTS (geo.api.vlaanderen.be/HISTCART) |
| `vandermaelen` | Vandermaelen | 1846 | purple | WMTS |
| `primitief` | Primitief kadaster | 1808–1834 | blue | IIIF (WarpedMapLayer) |
| `gereduceerd` | Gereduceerd kadaster | 1847–1855 | green | IIIF (WarpedMapLayer) |
| `handdrawn` | Hand drawn collection | 19th c. | orange | IIIF (WarpedMapLayer) |

### Sub-layers per era
- WMTS eras (ferraris, vandermaelen): land usage WMS overlay + searchable toponyms
- IIIF eras (primitief, gereduceerd, handdrawn): IIIF collection + GeoJSON parcels + land usage/water GeoJSON

### Layer group IDs
`getLayerGroupId(layerInfo)` → `"${compiledCollectionPath}::${renderLayerKey ?? 'all'}"`
Groups are parked (hidden, opacity=0, data preserved) on toggle-off for instant restore.

---

## Data flow

1. `fetchIndex()` → `loadCompiledIndex(cfg)` → fetches `{baseUrl}/index.json`
2. `loadToponymIndex()` → fetches `{baseUrl}/Toponyms/index.json`
3. Manifest search index built from `index.json` entries with `centerLon/Lat`
4. Layer toggle → `runLayerGroup()` → fetches compiled collection JSON → parallel-prefetch all annotation JSONs → sequential `addGeoreferenceAnnotation()` → keepalive repaint interval
5. Image info pre-warm: fetches `{baseUrl}/iiif/info/index.json`, injects into all sub-layers via `addImageInfos()`

---

## Map interaction

- **Hover**: IIIF warped map geo-mask hit test (point-in-polygon on `warpedMap.geoMask`); primitive parcel hover via `queryRenderedFeatures`
- **Click**: opens InfoCards for IIIF maps under cursor; parcel click opens parcel card
- **InfoCards**: group by layer label; pin/unpin; focus (fly-to + activate layer); open IIIF viewer
- **IIIF viewer**: modal overlay in `IiifViewer.svelte`, fed `imageServiceUrl` + `sourceManifestUrl`

---

## External data sources

- **Dataset base URL**: `https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build` (default; user-configurable in DebugMenu)
- **HISTCART WMTS**: `https://geo.api.vlaanderen.be/HISTCART/wmts` (Ferraris, Vandermaelen tiles)
- **INBO WMS**: `https://geo.api.vlaanderen.be/INBO/wms` (land usage overlays: `Lgbrk1778`, `B1850`)
- **Allmaps**: annotations served from mirrored paths in dataset; viewer links use `manifestAllmapsUrl`

---

## Related repos

- **Artemis-RnD-Data** (GhentCDH/Artemis-RnD-Data) — preprocessing pipeline + GitHub Pages publisher
  - `build/index.json` — compiled index with `renderLayers`, `index[]`, metadata
  - `build/Toponyms/index.json` — toponym index
  - `build/iiif/info/index.json` — image info cache (keyed by image service URL)
  - `build/Parcels/Primitive/index.geojson` — primitive parcel GeoJSON
  - `build/Massart/index.json` — Jean Massart photograph metadata index (see below)

---

## `build/Massart/index.json` — Jean Massart photograph index

A new build artifact generated on every `bun run crawl` in Artemis-RnD-Data. Sourced from the UGent Primo catalog API (not from Allmaps). The photographs are **not yet georeferenced** — this index provides location metadata for displaying pins on the map.

**Fetch**: `GET {baseUrl}/Massart/index.json`

**Shape**:
```ts
{
  generatedAt: string;
  totalItems: number;
  coordsAvailable: number;
  items: Array<{
    title: string;       // full Primo title, includes DMS coords
    year?: string;       // e.g. "1911"
    location?: string;  // municipality name, e.g. "Sint-Niklaas"
    lat?: number;        // decimal degrees (North)
    lon?: number;        // decimal degrees (East)
    manifestUrl: string; // IIIF v2 manifest URL → open in viewer
    mmsId: string;       // Alma bibliographic ID
    repId: string;       // Alma digital representation ID
  }>;
}
```

**Viewer integration notes**:
- `lat`/`lon` are present on most but not all items (`coordsAvailable` tells you how many have coords)
- `manifestUrl` is a IIIF v2 manifest — can be loaded with `addGeoreferenceAnnotation` once georeferenced, or opened in a IIIF viewer directly
- This index is independent of `index.json` — it is not part of `renderLayers` or `index[]`; load it separately
- Currently Massart manifests have no Allmaps annotations → they appear in `index[]` with `compiledManifestPath: ""` and no render layer; do not use `index[]` to drive the pin display, use `Massart/index.json` directly

---

## Notes / gotchas

### Transformation type: TPS vs polynomial — parcel alignment bug

Allmaps supports multiple transformation types (`thinPlateSpline`, `polynomial`, `projective`, `straight`). The Allmaps XYZ tile server defaults to **polynomial** regardless of the annotation's `transformation.type`. To force TPS on the XYZ tile server you must pass `?transformation.type=thin-plate-spline` in the URL (confirmed with Hamme Sectie A in QGIS).

`@allmaps/render`'s `BaseRenderer` (v1.0.0-beta.82) has the same behaviour internally:

```js
// BaseRenderer.js
const projectedTransformer =
  warpedMap.transformationType === "thinPlateSpline" && warpedMap.gcps.length > MAX_GCPS_EXACT_TPS_TO_RESOURCE
    ? warpedMap.getProjectedTransformer("polynomial")  // silent downgrade
    : warpedMap.projectedTransformer;
// MAX_GCPS_EXACT_TPS_TO_RESOURCE = 100
```

**WarpedMapLayer silently falls back to polynomial for any map with > 100 GCPs**, even when the annotation specifies `thinPlateSpline`. This causes the parcel GeoJSON overlay to be misaligned relative to the rendered warped map if the parcel extraction pipeline used actual TPS (or vice versa).

The fix is a **data pipeline concern** (Artemis-RnD-Data): parcel boundary extraction must use the same transformation as the renderer — i.e., polynomial for maps with > 100 GCPs, TPS for ≤ 100 GCPs.

---

- `renderLayers` (not `layers`) is the required field in `index.json`; viewer throws if absent
- GitHub blob URLs are normalised to `raw.githubusercontent.com` in `normalizeDatasetBaseUrl()`
- Annotation shape normalised: `Array` → `AnnotationPage` wrapper in `normalizeAllmapsPayload()`
- `chunkCount = 1` (single WarpedMapLayer per group) — multi-layer splitting was abandoned due to non-fetchable maps on dense Primitief runs
- Keepalive repaint interval self-terminates on: all tiles loaded / viewport-limited idle / budget timeout
- Park/restore: `parkLayerGroup` sets opacity=0, keeps layer on map; `runLayerGroup` detects parked state and restores instantly
- Handler cleanup: `activeLayerCleanup` map stores teardown fn per groupId; called before re-adding to prevent handler accumulation

---

## Data format changes — 2026-03-19 (IndexEntry refactor in Artemis-RnD-Data)

The data pipeline (`Artemis-RnD-Data`) was refactored. The viewer types and annotation loading logic must be updated to match.

### `CompiledIndexEntry` — required changes

**Remove these fields** (no longer emitted by pipeline):
- `mirroredAllmapsAnnotationPath?: string` — manifest-level annotation path is gone; `build/allmaps/manifests/` directory no longer exists
- `manifestAllmapsUrl?: string` — removed from IndexEntry
- `manifestAllmapsStatus?: number` — removed
- `canvasIds: string[]` — removed
- From `canvasAllmapsHits[]`: remove `canvasAllmapsUrl?` and `canvasAllmapsStatus?`

**Update these fields**:
- `georefDetectedBy?: "none" | "manifest" | "canvas"` → `georefDetectedBy?: "canvas" | "manifest" | "both"` — absence now means not georef (no `"none"` value)
- `annotSource?: "single" | "multi" | "none"` → `annotSource?: "single" | "multi"` — absence means not georef (no `"none"` value)
- `canvasAllmapsHits[].mirroredAllmapsAnnotationPath` — now the only annotation path per canvas (was optional before, now it's the sole source)

**Updated type**:
```typescript
export type CompiledIndexEntry = {
  label: string;
  sourceManifestUrl: string;
  sourceCollectionUrl: string;
  canvasCount: number;
  isVerzamelblad?: boolean;
  compiledManifestPath: string; // empty string when non-georef and not included
  // Present only for georef manifests:
  centerLon?: number;
  centerLat?: number;
  manifestAllmapsId?: string;
  canvasAllmapsHits?: Array<{
    canvasId: string;
    canvasAllmapsId: string;
    mirroredAllmapsAnnotationPath: string;
  }>;
  georefDetectedBy?: "canvas" | "manifest" | "both";
  annotSource?: "single" | "multi";
};
```

### `CompiledIndex` — required changes

Remove `mirroredOk: number` (no longer in index.json). Also `fixedManifests` and `problematicManifests` are no longer in index.json (moved to `logs/report.log`, git-ignored).

**Updated type**:
```typescript
export type CompiledIndex = {
  generatedAt: string;
  totalManifests: number;
  georefManifests: number;
  compiledOk: number;
  layers: LayerInfo[];
  renderLayers?: LayerInfo[];
  index: CompiledIndexEntry[];
};
```

### `LayerInfo` — no changes required

`renderLayerKey`, `singleCanvasGeorefCount`, `multiCanvasGeorefCount`, `parentRenderLayerKey`, `hidden` all remain in the data but `hidden` sub-layers (`single-canvas`, `multi-canvas`) may no longer be emitted by the pipeline — only `default` and `verzamelblad` render layer keys are currently produced.

### Annotation loading strategy — required change (`getMirroredAnnotationRequests`)

**Old strategy**: Prefer `entry.mirroredAllmapsAnnotationPath` (manifest-level); fall back to `canvasAllmapsHits[].mirroredAllmapsAnnotationPath`.

**New strategy**: Use `canvasAllmapsHits[].mirroredAllmapsAnnotationPath` directly — there is no manifest-level path anymore. All annotations are canvas-level only (`build/allmaps/canvases/<id>.json`).

The logic is otherwise the same: collect all unique annotation paths from `canvasAllmapsHits`, deduplicate, and issue one `addGeoreferenceAnnotation()` call per path.

### Allmaps viewer link — required change

`manifestAllmapsUrl` is gone. If the viewer displays an Allmaps link, it must be derived from `manifestAllmapsId` using the Allmaps URL pattern, or removed.

### Georef check — required change

Old: `entry.georefDetectedBy !== "none"` or `entry.annotSource !== "none"`
New: `entry.georefDetectedBy !== undefined` or `entry.annotSource !== undefined` (field is absent for non-georef entries)
