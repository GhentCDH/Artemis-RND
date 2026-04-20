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
- `app/src/lib/components/Timeslider.svelte`: timeline UI, pill interaction, pane controls, sublayer menu UI, and runtime-driven per-layer info cards.
- `app/src/lib/artemis/map/mapInit.ts`: WMTS/WMS/raster/map source setup.
- `app/src/lib/artemis/layerConfig.ts`: main layers, sublayers, labels, short labels, colors, info text, source URLs.
- `app/src/lib/artemis/runner.ts`: IIIF loading, parking, restoring, Allmaps integration.

## 4. Configuration

- `FEATURE_FLAGS.startupPreloadScreen = false`
- `FEATURE_FLAGS.debugMenu = false`
- `Massart/index.json` is loaded separately from the compiled IIIF index.
- `renderLayers` in `build/index.json` is effectively required by the viewer.
- `build/index.json` now exposes stable `layerId` values on `layers` and `renderLayers`, but the currently published data may still lag until the next crawl/deploy.
- The viewer is transitioning away from hardcoded `MAIN_LAYER_INFO` / `MAIN_LAYER_SOURCE` metadata toward runtime-loaded `static/site.json` and `static/layers.json`.

## 5. Decisions

- `Timeslider.svelte` is the mounted timeline; legacy timeline files are not active.
- NGI 1873 / NGI 1904 are connected as raster tile services, not via confirmed WMTS capabilities.
- Villaret is connected as WMS-backed raster, not via confirmed WMTS.
- The dark-mode toggle in the main toolbar is a dead feature and should be removed.
- The toolbar position currently occupied by the dark-mode toggle should become the site-info trigger.
- Clicking the site-info trigger should open a popup/modal that renders the content from `static/site.json`.
- Layer-specific info should be opened from the existing per-layer info control in the timeline/menu UI and should render content from `static/layers.json`.
- Runtime-edited viewer metadata should live outside preprocessing output and be loaded directly from the data repo `static/` area.
- Missing runtime metadata for a `layerId` should warn in development and fall back safely; it must not break the viewer.

## 6. Todos

- Simplify `Timeslider.svelte`; it contains multiple overlapping iterations.
- Re-verify lane assignment and small-pill readability after the interaction bugs are fixed.
- Re-test smallest pills for hitbox, visual width, and abbreviation legibility.
- Data-contract follow-up: re-verify viewer behavior against the current atlas contract where `sprites.json` is keyed by `canvasAllmapsId`.
- Data-contract follow-up: `build/index.json` center coordinates are back; re-test search and preview anchoring against the rebuilt data.
- Data-contract follow-up: re-check Massart labels/titles in the viewer after the data repo fixes title parsing.

Current status after local compatibility review:

- `app/src/lib/artemis/runner.ts` already resolves atlas entries by `canvasAllmapsId`
- `app/src/routes/+page.svelte` already consumes restored `centerLon` / `centerLat`
- No additional viewer runtime change is currently required for the rebuilt data contract

## 6.1 Timeline Sublayer Menu Refactor

- Goal: move the sublayer menu off the top-of-window controls and attach it directly to each timeline pill.
- Intended behavior: each pill should have a small upward tab/arrow so it reads like a file folder.
- Clicking that tab should expand the pill's attached sublayer menu.
- Only one pill menu should be open at a time.
- Clicking a different pill tab should collapse the previously open one and open the new one.
- The visual styling of the sublayer menu itself should stay close to the previous implementation.

What is already implemented:

- The old top-of-window sublayer menu block has been removed from `app/src/lib/components/Timeslider.svelte`.
- Each pill now renders a dedicated folder-tab button and a per-pill popover container.
- Menu state is modeled with a single `openMenuKey`, so the state shape already supports “only one open at a time”.
- The per-pill menu content reuses the existing sublayer controls and now renders runtime-loaded layer metadata rather than the old hardcoded source/info block.
- The click-guard logic for the track has been updated so interacting with pill/menu UI should not jump the timeline.
- Compare-mode header layout has been normalized across the duplicated compare-menu branches in `Timeslider.svelte` so the intended order is `checkbox + Left`, then `layer title/date + info`, then `Right + checkbox`.

What is still unresolved:

- The menu may now open correctly after the reactivity fix below, but this has not yet been verified in the live browser. Re-test before marking as done.
- `Timeslider.svelte` still contains multiple overlapping/duplicated compare-menu implementations. Any future sublayer-menu UI change must be applied across all active branches until the file is simplified.

Reactivity fix applied (2026-04-03):

- Root cause investigated: all 16 template uses of `openMenuKey` were routed through a `isMenuOpen(key)` wrapper function rather than referencing `openMenuKey` directly. In Svelte 5 (this project uses ^5.51.0), the compiler may not register a reactive dependency on `openMenuKey` when it is only read inside a called function, so assigning to it did not trigger template re-renders.
- Fix: removed `isMenuOpen`, replaced all `isMenuOpen(src.key)` occurrences in the template with `openMenuKey === src.key` directly. This ensures Svelte tracks `openMenuKey` as an explicit template dependency across all four lane `{#each}` blocks.
- Compile check passes: 0 errors, 0 warnings after the change.

## 7. Bugs

- `Site-info modal styling still unresolved`
  Runtime metadata is now wired, but the site-info modal opened from the toolbar still does not visually match the rest of the Artemis UI closely enough. Treat this as unresolved styling work in `app/src/routes/+page.svelte`.
- `Pill click isolation not trusted`
  There was an attempted implementation to disable other overlapping layers when a pill is clicked, but the user reported that the behavior still does not work correctly. Treat this as unresolved and re-test from the UI before relying on it.
- `Hover info behavior has been unstable`
  The custom pill hover display has changed multiple times; native `title` is the current fallback, but custom hover behavior should be rechecked in-browser.
- `Timeline full-label switch still broken`
  Timeline pills are still showing short labels/initials even after multiple attempts to restore full labels when a pill is wide enough. The current issue should be treated as unresolved runtime behavior in `app/src/lib/components/Timeslider.svelte`, not as a settled implementation.
- `Timeline pill expand tab — fix applied, needs browser verification`
  Root cause was Svelte 5 not tracking `openMenuKey` as a template dependency when it was only read through the `isMenuOpen` wrapper function. Fixed by removing the wrapper and using `openMenuKey === src.key` directly in all template locations. Needs live browser test to confirm the menu now opens correctly.

## 8. IIIF Data Structure: Geomaps Consolidation (2026-04-16)

### Overview

The IIIF data pipeline was refactored from a **3-file structure** to a **single pre-linked geomaps bundle** per map domain. This eliminates runtime join logic and reduces network requests from 3 to 1 per map.

### Old Structure (Deprecated)

Three separate files per map domain:
```
build/IIIF/
├── {mapId}_manifests.json    — IIIF V2 manifests (all 635, keyed by label)
├── {mapId}_info.json         — Image API info.json objects (keyed by service URL)
└── georef/{mapId}.json       — Allmaps annotations (keyed by canvas ID)
```

**Viewer flow:**
1. Fetch all 3 files in parallel
2. Iterate manifests, extract canvas IDs
3. For each canvas: look up in `georefByCanvas` by canvas ID
4. Extract service URL from annotation → look up in `services` by URL
5. Build RuntimeLayerEntry with matched annotation and info

**Issues:**
- 3 network fetches per map
- Runtime join logic by canvas ID and service URL
- Non-georeferenced manifests included but immediately discarded
- Full IIIF manifest JSON stored even though only `@id`, `label` used

### New Structure (Current)

Single pre-linked file per map domain:
```
build/IIIF/
├── PrimitiefKadaster_geomaps.json    (5.1M)
└── GereduceerdeKadaster_geomaps.json (1.6M)
```

**File format:**
```json
{
  "generatedAt": "2026-04-16T...",
  "mapId": "PrimitiefKadaster",
  "maps": [
    {
      "id": "https://iiif.ghentcdh.ugent.be/iiif/manifests/...",
      "label": "Sinaai - Sectie A en B",
      "isVerzamelblad": false,
      "canvases": [
        {
          "id": "https://iiif.ghentcdh.ugent.be/.../canvas/...",
          "info": {
            "@context": "http://iiif.io/api/image/2/context.json",
            "@id": "https://...",
            "protocol": "http://iiif.io/api/image",
            "width": 11760,
            "height": 7800,
            "tiles": [{ "width": 256, "scaleFactors": [1,2,4,8,16,32,64] }],
            "profile": ["http://iiif.io/api/image/2/level1.json", {...}]
          },
          "georef": {
            "type": "AnnotationPage",
            "@context": "http://www.w3.org/ns/anno.jsonld",
            "items": [{
              "id": "https://annotations.allmaps.org/maps/...",
              "type": "Annotation",
              "@context": [...],
              "motivation": "georeferencing",
              "target": {
                "type": "SpecificResource",
                "source": {
                  "id": "...",
                  "type": "ImageService2",
                  "width": 11760,
                  "height": 7800,
                  "partOf": [
                    {
                      "id": "...",  // canvas URL
                      "type": "Canvas",
                      "partOf": [{ "id": "...", "type": "Manifest" }]
                    }
                  ]
                },
                "selector": { "type": "SvgSelector", "value": "<svg ...>" }
              },
              "body": {
                "type": "FeatureCollection",
                "transformation": { "type": "polynomial", "options": {"order": 1} },
                "features": [{ "type": "Feature", "geometry": {...}, "properties": {...} }],
                "_allmaps": { "scale": ..., "area": ..., ... }
              }
            }]
          }
        }
      ]
    }
  ]
}
```

**Viewer flow:**
1. Fetch single `{mapId}_geomaps.json`
2. Iterate `maps[]`
3. For each map, iterate `canvases[]`
4. Each canvas already has `info` and `georef` inline
5. Pass `canvas.info` to `layer.addImageInfos()`
6. Pass `canvas.georef` to `layer.addGeoreferenceAnnotation()`

**Benefits:**
- ✅ 1 network fetch per map (vs 3)
- ✅ No runtime join logic
- ✅ Only georeferenced manifests (231 of 635)
- ✅ Pre-computed `isVerzamelblad` flag
- ✅ Pruned data (no unused metadata)

### What Data Was Removed

From manifests:
- `thumbnail` — not used by viewer
- Canvas `width`/`height` — available in `info`
- Canvas `images[]` — service URL in `georef.target.source.id`
- Full metadata — only `isVerzamelblad` computed at build time

From info.json:
- `sizes[]` — thumbnail pyramid; Allmaps uses `tiles[].scaleFactors`

From annotations:
- `created`/`modified` timestamps — not used for rendering
- `target.source.provider` — attribution; not needed
- Individual annotation `id` fields — preserved in full annotation

### Implementation in Viewer

**File:** `app/src/lib/artemis/runner.ts`

Type change:
```typescript
type LayerInfo = {
  // OLD (removed):
  // infoPath?: string;
  // manifestsPath?: string;
  // georefPath?: string;
  
  // NEW:
  geomapsPath?: string;
  // ... other fields unchanged
}
```

Function `loadNewIiifEntries()`:
```typescript
// OLD: fetch 3 files, join by canvas ID
const [manifestBundle, georefBundle, infoBundle] = await Promise.all([
  fetchJson(manifestsUrl),
  fetchJson(georefUrl),
  fetchJson(infoUrl),
]);
const georefByCanvas = georefBundle?.georefByCanvas ?? {};
const services = infoBundle?.services ?? {};
// ... iterate manifests, look up canvases in georefByCanvas, etc.

// NEW: fetch 1 file, iterate maps directly
const bundle = await fetchJson(geomapsUrl);
const maps = bundle?.maps ?? [];
for (const map of maps) {
  const canvases = map.canvases ?? [];
  // Each canvas already has georef and info inline
  for (const canvas of canvases) {
    if (canvas.info) infoByServiceUrl.set(canvas.info["@id"], canvas.info);
    if (canvas.georef) inlineAnnotations.push({ raw: canvas.georef });
  }
}
```

**File:** `app/src/routes/+page.svelte`

Path derivation in `normalizeSourceLayers()`:
```typescript
// OLD:
map ? `IIIF/${map}_manifests.json` : (layer as any).manifestsPath,
map ? `IIIF/${map}_info.json` : (layer as any).infoPath,
map ? `IIIF/georef/${map}.json` : (layer as any).georefPath,

// NEW:
map ? `IIIF/${map}_geomaps.json` : (layer as any).geomapsPath,
```

### Migration Checklist

- ✅ Pipeline generates `_geomaps.json` files
- ✅ Pruning helpers applied (manifests, info, annotations)
- ✅ Viewer loads single `geomapsPath`
- ✅ `loadNewIiifEntries()` iterates `maps[]` directly
- ✅ `isVerzamelblad` read from pre-computed field
- ✅ TypeScript checks pass (0 errors)
- ✅ Old files (`*_manifests.json`, `*_info.json`, `georef/`) removed from build

### Testing

To verify the new structure works end-to-end:
1. Start dev server: `cd Artemis-RND/app && bun run dev`
2. Verify IIIF maps render (Primitief, Gereduceerd)
3. Check browser network tab: only 2 `_geomaps.json` requests (one per map domain) instead of 6 (3 per domain)
4. Verify georef overlays display correctly
5. Verify verzamelblad filtering works
6. Verify info pre-warming works (check MapLibre tile requests load quickly)

## 9. Verification

- Last verified command: `bun run check` (0 errors, 0 warnings)
- Pipeline build output: ✅ PrimitiefKadaster and GereduceerdeKadaster geomaps generated
- Current TypeScript/Svelte status at last edit: `0 errors, 0 warnings`
- Important: compile status is clean, but runtime behavior is not fully verified. The pill expand tab fix needs a live browser test. The compare-mode header order is now acceptable for now, but spacing/visual polish may still need browser tuning.
- Runtime metadata status at last edit:
  - `app/src/routes/+page.svelte` now loads `static/site.json` and `static/layers.json` at runtime from the data repo `static/` area.
  - Missing metadata logs development warnings and falls back safely.
  - The toolbar dark-mode slot has been replaced with an `About` trigger.
  - The `About` trigger opens a site-info modal populated from `site.json`.
  - `Timeslider.svelte` now receives `layerMetadataByMainId` and renders runtime layer info cards from `layers.json`.
  - The `About` button now shares the same base button chrome as `Compare`.
  - Remaining issue: the site-info modal/panel styling still feels visually disconnected from the rest of the app and needs another styling pass.

## 9. SSR / Server-Side Notes

- `app/src/lib/artemis/ui/ToponymSearch.svelte` had a `document is not defined` crash on the server (SSR). The `onDestroy` callback was calling `document.removeEventListener` unconditionally. Fixed by guarding with `if (typeof document !== 'undefined')`. `onDestroy` runs during SSR in SvelteKit; `onMount` does not. Any future use of browser globals in `onDestroy` must use the same guard.

## 9.1 System-Specific Rendering Note

- A machine-specific IIIF drift/parallax bug was traced to GNOME fractional display scaling on X11, not to Artemis data or annotation content. On Ubuntu 24.04 with NVIDIA (`Quadro RTX 4000`, driver `580.126.09`), a 4K display (`3840x2160` at `100 Hz`) configured at `125%` scale caused Mutter/XRandR to apply an effective transform of about `1.599991`, producing a `6144x3456` framebuffer. In that state, single-view mode showed warped IIIF layers drifting relative to the basemap, while compare mode appeared stable. Setting the display scale back to `100%` fixed the bug immediately without code changes or logout.
- Practical takeaway: if single-view IIIF layers appear to pan independently of the basemap on one machine only, check `xrandr --verbose` for a non-identity transform and GNOME monitor scaling before debugging Artemis code.

## 10. Build/Data Refactor Implementation Guide

**Status**: Refactored and implemented on 2026-04-15. Viewer code updates needed.

**Current Build Output Structure** (what you're consuming):
```
build/
├── index.json                                      # Entrypoint: domains array, image service mapping
├── IIIF/
│   ├── PrimitiefKadaster_manifests.json           # IIIF manifest objects keyed by label
│   ├── PrimitiefKadaster_info.json                # IIIF Image API responses by service URL
│   ├── GereduceerdeKadaster_manifests.json
│   ├── GereduceerdeKadaster_info.json
│   └── georef/
│       ├── PrimitiefKadaster.json                 # Canvas-level georeferencing (client-side lookup)
│       └── GereduceerdeKadaster.json
├── Image collections/Massart/index.json           # Jean Massart photograph metadata
├── Toponyms/
│   ├── PrimitiefKadaster/PrimitiefKadasterToponyms.json    # Filtered toponyms (2,514 items)
│   └── Ferraris/FerrarisToponyms.json             # Historical map toponyms
└── Parcels/
    └── PrimitiefKadaster/PrimitiefKadasterParcels.geojson  # GeoJSON polygons (28,207)
```

**Key Points**:
- Map IDs are PascalCase: `PrimitiefKadaster`, `GereduceerdeKadaster`, `Ferraris`
- Filenames are descriptive: `<mapId>Toponyms.json`, `<mapId>Parcels.geojson`
- IIIF bundles are per-map, not scattered across many files
- Canvas annotations consolidated in `georef/<mapId>.json` (keyed by canvas ID)
- `buildIndex.domains` shows maps with IIIF georeferencing

**Reference Documents** (in `/home/alexander/Documents/Artemis-RnD/`):
- VIEWER_CODE_AUDIT.md — Complete audit of all viewer changes
- PATH_MIGRATION_TABLE.md — Current → new path mappings
- MAP_ID_CANONICAL.md — Map ID conversion table
- BUILD_INDEX_SPECIFICATION.md — build/index.json schema details

### Dataset Selection: Development vs. Live

**Problem**: After a large refactor, you need to test extensively before deploying to production. Pointing the viewer at the live GitHub Pages version risks breaking the published site.

**Solution**: Use branch-specific URLs to test against development data without affecting the live version.

**Live Production** (stable, published):
```
https://ghentcdh.github.io/Artemis-RnD-Data/
```
This points to the `master` branch compiled to GitHub Pages.

**Development Testing** (in-progress, test refactors):
```
https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/dev/build
```
This points to the raw GitHub content from the `dev` branch.

**How to Switch**:

Find the dataset base URL configuration in `app/src/routes/+page.svelte` (line ~8-10):

```typescript
// Current (live):
const DEFAULT_DATASET_BASE_URL = 'https://ghentcdh.github.io/Artemis-RnD-Data/build';

// For development (test against dev branch):
const DEFAULT_DATASET_BASE_URL = 'https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/dev/build';
```

Or pass it as a URL parameter when running locally:
```bash
npm run dev  # uses default
# Then in browser, paste this in the data URL input:
https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/dev/build
```

**Workflow for Large Refactors**:
1. Push data changes to `dev` branch
2. Update viewer CONTEXT.md and code pointing to `dev` branch URL
3. Test thoroughly in viewer against `dev` branch build output
4. Once stable, merge `dev` → `master`
5. GitHub Pages auto-publishes `master` to live site
6. Switch viewer configuration back to live (GitHub Pages) URL

This ensures you never accidentally break the live version while testing substantial changes.

### Phase 1: Critical Path Updates

#### Step 1.1: Update Parcels Path

**File**: `app/src/routes/+page.svelte:137`

**Current Code**:
```typescript
return `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Parcels/Primitive/index.geojson`;
```

**New Code**:
```typescript
// Changed from hardcoded "Primitive" → new map identifier with descriptive filename
return `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Parcels/PrimitiefKadaster/PrimitiefKadasterParcels.geojson`;
```

**Note**: Parcel files now use descriptive naming (`<mapId>Parcels.geojson`) rather than generic `index.geojson` to make the content clear.

**Testing**:
```bash
# Point viewer at new data repo
npm run dev  # or pnpm run dev
# Navigate to map
# Verify Parcels overlay loads without 404 in console
# Verify parcel polygons render
```

#### Step 1.2: Update Massart URL

**File**: `app/src/routes/+page.svelte:327`

**Current Code**:
```typescript
const url = `${cfg().datasetBaseUrl}/Massart/index.json`;
```

**New Code**:
```typescript
const url = `${cfg().datasetBaseUrl}/Image collections/Massart/index.json`;
```

**Testing**:
```bash
# Verify Massart pins load
# Check console for no 404 errors
# Verify pins display on map with correct years
```

#### Step 1.3: Update Toponyms Fetch Logic (HIGH PRIORITY - Logic Change)

**File**: `app/src/routes/+page.svelte:1099-1128`

**Current Code**:
```typescript
const url = `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Toponyms/index.json`;
const res = await fetchRuntimeJson(url);
const toponymIndex = res.items || res.features || [];
```

**New Code** (data-driven per-map discovery):
```typescript
// Discover available maps from build/index.json domains array
// Note: domains lists maps with IIIF georeferencing, but some maps have toponyms without IIIF (e.g., Ferraris)
const knownMaps = buildIndex.domains || [];

if (!knownMaps || knownMaps.length === 0) {
  log?.('WARN', 'No domains found in build/index.json');
  return [];
}

// Known maps that have toponyms (may not all be in domains if no IIIF georeferencing)
const toponymMaps = knownMaps.concat(['Ferraris']); // Ferraris has toponyms but no IIIF

// Fetch all per-map toponym files
const allItems: unknown[] = [];
const loadedMaps: string[] = [];
for (const mapId of toponymMaps) {
  try {
    // Toponym files use descriptive naming: <mapId>/<mapId>Toponyms.json
    const url = `${normalizeDatasetBaseUrl(datasetBaseUrl.trim())}/Toponyms/${mapId}/${mapId}Toponyms.json`;
    const res = await fetchRuntimeJson(url);
    const items = res.items || res.features || [];
    if (items.length > 0) {
      allItems.push(...items);
      loadedMaps.push(mapId);
      log?.('INFO', `Toponyms loaded for ${mapId}: ${items.length} items`);
    }
  } catch (err) {
    // Silently skip maps without toponyms (normal case, not an error)
    log?.('DEBUG', `No toponyms available for ${mapId}`);
  }
}

const toponymIndex = allItems;
if (toponymIndex.length === 0) {
  log?.('WARN', `Toponyms index unavailable: no items loaded from ${loadedMaps.length} maps`);
} else {
  log?.('INFO', `Total toponyms loaded: ${toponymIndex.length} items from maps: ${loadedMaps.join(', ')}`);
}
```

**Implementation Notes**:
- The `buildIndex.domains` array contains maps with IIIF georeferencing: `["PrimitiefKadaster", "GereduceerdeKadaster"]`
- Additional maps may have toponyms data: e.g., `Ferraris` (historical map with OCR toponyms but no modern IIIF)
- The viewer should try all known maps and gracefully handle 404s (map doesn't have toponyms)
- Toponym files use descriptive names: `<mapId>Toponyms.json` (not generic `index.json`)
- Each toponym item includes `map` and `mapLabel` fields for filtering/display

**Testing**:
```bash
# Verify search loads all per-map toponym files
# Search for a toponym from PrimitiefKadaster (should work)
# Search for a toponym from Ferraris (should work)
# Check console for proper load messages and no 404 errors in console
# Verify result labels show correct map (from mapLabel field in item)
```

### Phase 2: Configuration Updates

#### Step 2.1: Update layerConfig.ts IDs to PascalCase

**File**: `app/src/lib/artemis/layerConfig.ts`

**Changes**:
1. Update `MainLayerId` type (lines 4-14):

```typescript
export type MainLayerId =
  | 'PrimitiefKadaster'      // was 'primitief'
  | 'GereduceerdeKadaster'   // was 'gereduceerd'
  | 'HanddrawnCollection'    // was 'handdrawn'
  | 'NGI1904'                // was 'ngi1904'
  | 'NGI1873'                // was 'ngi1873'
  | 'Popp'                   // was 'popp'
  | 'Vandermaelen'           // was 'vandermaelen'
  | 'Ferraris'               // was 'ferraris'
  | 'Villaret'               // was 'villaret'
  | 'Frickx';                // was 'frickx'
```

2. Update `MAIN_LAYER_ORDER` array (lines 28-32):

```typescript
export const MAIN_LAYER_ORDER: MainLayerId[] = [
  'HanddrawnCollection', 'Frickx', 'Villaret', 'Ferraris',
  'GereduceerdeKadaster', 'Popp', 'Vandermaelen', 'PrimitiefKadaster',
  'NGI1873', 'NGI1904',
];
```

3. Update `MAIN_LAYER_LABELS` map (lines 34-45):
```typescript
export const MAIN_LAYER_LABELS: Record<string, string> = {
  'PrimitiefKadaster':      'Primitief Kadaster',
  'GereduceerdeKadaster':   'Gereduceerde Kadaster',
  'HanddrawnCollection':    'Hand drawn collection',
  // ... etc for all layers
};
```

4. Update `MAIN_LAYER_SHORT_LABELS` (similar changes)

5. Update `MAIN_LAYER_META` (similar changes)

6. Update `MAIN_LAYER_INFO` (similar changes)

7. Update `MAIN_LAYER_SOURCE` (similar changes)

**Validation**:
```bash
npm run check  # or pnpm run check
# Should show: 0 errors, 0 warnings
```

#### Step 2.2: Update Runtime Metadata Keys in static/layers.json

**File**: `static/layers.json`

**Current Keys** (based on hash values or hardcoded IDs):
```json
{
  "d5443d67bd8c69ec": { "title": "...", "info": "..." },
  "gereduceerd-iiif": { "title": "...", "info": "..." }
}
```

**New Keys** (must match `renderLayers[].layerId` from new build/index.json):
```json
{
  "primitief-iiif": { "title": "Primitief Kadaster", "info": "..." },
  "gereduceerd-iiif": { "title": "Gereduceerde Kadaster", "info": "..." },
  "handdrawn-iiif": { "title": "Hand drawn collection", "info": "..." },
  "ferraris-toponyms": { "title": "Ferraris Toponyms", "info": "..." },
  "vandermaelen-toponyms": { "title": "Vandermaelen Toponyms", "info": "..." },
  "primitief-parcels": { "title": "Primitief Parcels", "info": "..." }
}
```

**How to get correct keys**:
- After data repo refactor is deployed, fetch new `build/index.json`
- Read `renderLayers[].layerId` for all IIIF layers
- Read `domains.toponyms.maps` and append `-toponyms` for toponym sublayers
- Read `domains.parcels.maps` and append `-parcels` for parcel sublayers

**Testing**:
```bash
# Verify no 404s for metadata lookups
# Check browser console for metadata load messages
# Verify layer info cards display correct titles from metadata
```

### Phase 3: Image Services Consolidation

#### Step 3.1: Remove Separate iiif/info Fetch

**File**: `app/src/lib/artemis/runner.ts:239`

**Current Code**:
```typescript
const url = joinUrl(cfg.datasetBaseUrl, "iiif/info/index.json");
const iiifInfoIndex = await fetchJson<{ /* type */ }>(url, "IiifInfoIndex");
```

**New Code**:
```typescript
// Image services are now consolidated into build/index.json
// No separate fetch needed; imageServices already loaded
const iiifServices = buildIndex.imageServices || {};
// Continue with same serviceUrl lookup logic using iiifServices
```

**Impact**: One fewer HTTP fetch at startup

**Testing**:
```bash
# Monitor network tab: should see no request to iiif/info/index.json
# Verify IIIF tiles still load correctly (rendering unchanged)
```

### Phase 4: Testing & Validation

#### Step 4.1: Comprehensive Integration Test

```bash
# Point viewer at new data:
# 1. Start dev server
npm run dev

# 2. Verify all maps load
#    - Check rendered tiles display
#    - Verify no console errors
#    - Check network for no 404s

# 3. Test search
#    - Search for "Appels" (Gereduceerd)
#    - Should find result
#    - Check console for proper per-map load messages

# 4. Test parcels
#    - Enable parcel overlay for Primitief
#    - Should see parcel polygons
#    - No 404 for Parcels/PrimitiefKadaster/index.geojson

# 5. Test Massart
#    - Check timeline for Massart pins
#    - Verify pins display correctly
#    - No 404 for Image collections/Massart/index.json

# 6. Test metadata
#    - Open layer info cards
#    - Verify titles and info from static/layers.json
#    - No missing metadata warnings in console

# 7. Test compare mode
#    - Split screen
#    - Verify both panes load independently
#    - All features work in both panes
```

#### Step 4.2: Regression Testing

```bash
# Verify existing features still work:
- [ ] Map pan/zoom
- [ ] Layer visibility toggles
- [ ] Timeline interaction
- [ ] Split mode
- [ ] Search functionality
- [ ] IIIF warp rendering
- [ ] Parcel overlay
- [ ] Massart pins
- [ ] Runtime metadata display
- [ ] No console errors
```

### Phase 5: Type Definitions (if applicable)

#### Step 5.1: Update Type Definitions

**File**: `app/src/lib/artemis/types.ts`

If custom types use old layer IDs, update them:

```typescript
// Before
export type LayerId = 'primitief' | 'gereduceerd' | ...;

// After
export type LayerId = 'PrimitiefKadaster' | 'GereduceerdeKadaster' | ...;
```

**Validation**:
```bash
npm run check  # Type check should pass
```

### Phase 6: Timeline/Timeslider Updates (if needed)

**File**: `app/src/lib/components/Timeslider.svelte`

Check if any hardcoded layer references exist and update:

```bash
# Search for old IDs:
grep -n "primitief\|gereduceerd\|handdrawn" app/src/lib/components/Timeslider.svelte

# Update any found references to use new PascalCase IDs
```

### Troubleshooting

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| "Parcels 404" | Hardcoded path still uses old name | Update +page.svelte:137 to new path |
| "Massart 404" | Path not updated to Image collections | Update +page.svelte:327 |
| "Toponyms empty" | Per-map files not discovered | Check buildIndex.domains.toponyms.maps exists |
| "Type errors in layerConfig" | IDs not updated to PascalCase | Update MainLayerId type and all references |
| "Metadata missing" | static/layers.json keys wrong | Update keys to match new layerId values |
| "Render errors" | Image services not loading | Verify imageServices in buildIndex consolidated |

### Files Modified Summary

| File | Changes | Lines |
|------|---------|-------|
| `+page.svelte` | Paths: Parcels, Massart, Toponyms fetch | 137, 327, 1099-1128 |
| `layerConfig.ts` | IDs: MainLayerId type, all label maps | 4-14, 28-45, etc. |
| `static/layers.json` | Keys: Update to match new layerId values | All |
| `runner.ts` | Remove: iiif/info fetch | 239 |
| `Timeslider.svelte` | Review: Update any hardcoded refs | (search for old IDs) |

## 10. Next Actions (Original)

1. Verify pill expand tab works in the live browser after the reactivity fix.
2. Restyle the site-info modal in `app/src/routes/+page.svelte` so it matches the rest of the Artemis UI rather than reading like a separate generic overlay.
3. Re-test pill click isolation in-browser and either fix or remove the current partial implementation.
4. Simplify `Timeslider.svelte` and remove dead experimental code paths now that runtime metadata wiring is in place.

## 10.1 Data Runtime Join Instructions

- Artemis-RnD-Data now treats `static/` as hand-edited runtime content, not as preprocessing output.
- `static/Baselayer/` has been moved under that manual content boundary.
- The viewer should keep loading `build/index.json` for generated layer structure, and load `static/site.json` and `static/layers.json` separately at runtime.
- `static/site.json` is intentionally simple:
  - `title`
  - `info` as an array of paragraphs
  - `attribution`
  - `team`
  - `logos`
- `static/layers.json` is intentionally simple:
  - keys are either viewer `mainId` values or compiled IIIF render-layer ids
  - each entry contains only `title` and `info`
- Site-level informational content does not require crawl-generated layer keys.
- For WMTS/WMS/searchable/geojson layers that exist only in viewer config, resolve metadata by `mainId`.
- For compiled IIIF layers, prefer explicit `renderLayers[].layerId` once `build/index.json` has been regenerated.
- Until `build/index.json` is regenerated with explicit `layerId`, the viewer should map current IIIF render layers using the compiled-collection-derived ids already seeded in `static/layers.json`.
- The viewer should render `site.info` by joining paragraphs, and render `team` / `logos` as separate sections rather than folding them into one text blob.
- The site-info popup should be opened from the current toolbar dark-mode-toggle slot.
- The layer-info popup should be opened from the existing per-layer info button in the timeline/menu UI.
- This runtime join is now implemented in the viewer:
  - `+page.svelte` fetches and normalizes `site.json` and `layers.json`.
  - `Timeslider.svelte` consumes resolved layer metadata via `layerMetadataByMainId`.
  - The toolbar `About` button opens a site-info modal from runtime metadata.
- If a resolved key has no corresponding entry in `static/layers.json`, log a development warning that names the missing key and visible layer label, then fall back to generated label/default metadata.
- Updating `static/*.json` should not require rerunning the Artemis-RnD-Data preprocessing pipeline; only the static asset itself should need to change.
- Existing hardcoded viewer metadata in `app/src/lib/artemis/layerConfig.ts` should be treated as migration targets for this runtime-loaded metadata contract.
- Important transition note: current published `build/index.json` may not yet contain explicit `layerId`, so the first viewer integration must not assume that field is always present.

## 10. UI Token Strategy

- Goal: make the UI respond consistently from a small number of central style files rather than from many component-local hardcoded values.
- The preferred direction is not a full DaisyUI migration.
- The preferred direction is a DaisyUI-inspired internal design system built on CSS variables and shared primitives.
- The current `app/src/lib/theme.css` already acts as the main styling control surface, but it mixes base tokens, semantic tokens, and feature-specific tokens in one place.

## 11. Proposed Style Structure

- `app/src/lib/tokens.css`
  Holds foundation and semantic design tokens.
- `app/src/lib/ui.css`
  Holds shared primitive/component styles that consume those tokens.
- Existing feature components should then consume those shared primitives instead of defining one-off visual values locally wherever possible.

## 12. Token Model

- Foundation tokens
  Raw scales and base values such as spacing, radii, shadows, font stacks, motion timings, and base color ramps.
- Semantic tokens
  Named UI meanings such as page background, panel background, card background, text strengths, borders, focus rings, and overlays.
- Component tokens
  Reusable values for repeated UI patterns such as button height, panel padding, input background, toolbar chrome, and card shadow.

Examples of the intended token categories:

- Spacing: `--space-1`, `--space-2`, `--space-3`
- Radius: `--radius-sm`, `--radius-md`, `--radius-lg`
- Surface: `--surface-page`, `--surface-panel`, `--surface-card`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`
- Border/shadow: `--border-subtle`, `--border-strong`, `--shadow-sm`, `--shadow-panel`
- Motion: `--duration-fast`, `--duration-normal`
- Component-level: `--panel-padding`, `--btn-height`, `--input-height`

## 13. Shared UI Primitives

- `ui.css` should define a small set of reusable classes or patterns for the recurring non-map UI:
- panel
- card
- button
- input
- badge/chip
- toggle
- toolbar control
- overlay shell

These primitives should be applied first to:

- `app/src/lib/artemis/ui/ToponymSearch.svelte`
- `app/src/lib/artemis/ui/InfoCards.svelte`
- `app/src/lib/artemis/ui/DebugMenu.svelte`
- the metadata/action surfaces in `app/src/lib/artemis/viewer/IiifViewer.svelte`

The map stage and timeline should remain custom surfaces:

- `app/src/routes/+page.svelte`
- `app/src/lib/components/Timeslider.svelte`

## 14. Practical Outcome

- Changing a few token values should update the whole UI consistently.
- The app should become easier to restyle without editing many separate components.
- This should improve clarity and consistency without forcing the map/timeline UI into generic framework patterns.

## 15. Data Refactor Implementation (Next Priority)

**All decisions finalized on 2026-04-15.** Follow the step-by-step implementation guide in Section 10 above.

**Execution Order**:
1. **Phase 1** (Critical paths): Steps 1.1-1.3 — Update Parcels, Massart, Toponyms
2. **Phase 2** (Configuration): Steps 2.1-2.2 — Update layerConfig.ts IDs and static/layers.json keys
3. **Phase 3** (Data consolidation): Step 3.1 — Remove separate iiif/info fetch
4. **Phase 4** (Testing): Steps 4.1-4.2 — Integration and regression testing
5. **Phase 5-6** (Types/Timeline): Only if needed

**Prerequisite**: Data repo must complete its refactor and deploy new `build/index.json` with new schemas first.

**Parallel Effort**: These viewer changes should happen in parallel with (or immediately after) data repo deployment.

**Reference**:
- Section 10 "Build/Data Refactor Implementation Guide" — Full step-by-step instructions
- `/home/alexander/Documents/Artemis-RnD/VIEWER_CODE_AUDIT.md` — Complete viewer changes list
- Artemis-RnD-Data/CONTEXT.md Section 10 — Data repo implementation guide
