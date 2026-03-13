# Artemis RnD - LLM Context (Debug State)

## Scope
- Branch focus: GitHub/preprocessed approach (`Artemis-RnD` viewer against `Artemis-RnD-Data/build`).
- Current issue: `primitief_kadaster` (GhentCDH) behaves worse than `Gereduceerd_Kadaster` (flicker, partial visual loading, unstable tile progression).

## What Was Verified
- Both source IIIF collections are valid IIIF v2 and reachable.
- Compiled dataset/index integrity is good (files exist, HTTP 200).
- Manifest HTTP status is healthy for both collections.
- The difference is not basic network/API failure.

## Key Data Facts
- Gereduceerd:
  - 103 georef manifests
  - 111 runtime warped maps
  - very low annotation error rate (effectively 0 in current runs)
- Primitief:
  - 112 georef manifests
  - 273-278 runtime warped maps (multi-map manifests are common)
  - annotation geometry errors present (`Edge intersects already constrained edge`)
  - recent observed: `annotationErrs:5`, `manifestsWithAnnotationErrs:4`

## Important Clarification
- `georef manifests` != `runtime warped maps`.
- One georef annotation page can contain multiple map items.
- Any logic assuming 1:1 manifest-to-map will misread progress/completion.

## Root-Cause Direction (Current Confidence)
1. Primary runtime issue:
- High-pressure viewport->fetchable gating and tile churn in Allmaps render path.
- Evidence:
  - Working layer example: `maps 106/111 visible · fetchable 111 · first tiles 111`
  - Primitief example: `maps 187/273 visible · fetchable 119 · first tiles 114`
  - Meaning: many maps are visible but not currently fetchable; once fetchable, most do load.

2. Secondary data-quality issue:
- Some Primitief manifests have invalid georef geometry causing triangulation failures.
- This contributes to missing/problematic maps but does not fully explain global flicker/stall behavior.

## Code/Instrumentation Added
- Improved event accounting by unique map IDs (not naive event counts).
- Adaptive keepalive with viewport-aware completion diagnostics.
- Annotation error propagation into metrics (`allmaps_apply_annotation ok` can be < applied count).
- Problematic manifest aggregation and UI list with links.
- Live per-layer render stats in UI:
  - registered maps
  - visible maps
  - fetchable maps
  - first tiles loaded
  - peak visible maps
- Keepalive diagnostic log for viewport/fetchable mismatch:
  - `viewport-diff(...) visibleNotFetchable:X/Y fetchable:Z top=...`

## Failed/Rejected Experiment
- Viewport-only forcing via `setMapOptions(mapId, { renderMaps: false/true })` made behavior worse.
- That approach was rolled back.

## Current Interpretation
- Pipeline stages up to annotation application are mostly healthy.
- Main instability is in render scheduling/selection under dense multi-map workloads (Primitief).
- Next highest-value debugging is to inspect `visibleNotFetchable` dominant manifests and map geometries (not just aggregate timing).

## Concrete Cause (Plain Statement)
- Primary cause:
  - The renderer does not load all registered maps at once.
  - For Primitief, 273 warped maps are registered, but tile requests are selected via viewport-based logic and internal throttling.
  - Therefore only a subset becomes fetchable/tiled at a time, causing partial rendering and flicker/churn as selection changes.
- Secondary cause:
  - 4 manifests have invalid georeference geometry (`Edge intersects already constrained edge`), causing additional local map failures.
  - This is real but not the main driver of the large partial-load behavior.

In short: this is primarily a renderer policy + dataset density issue, not an upstream manifest-fetch pipeline failure.

## Suggested Next Step
- Collect and compare `viewport-diff(...)` outputs between both layers over identical camera interactions.
- Use top offender manifests from that log as targeted subset for isolation runs.

---

## Task for Data Pipeline Agent (Artemis-RnD-Data repo)

### Problem
4 Primitief Kadaster manifests have self-intersecting resource masks (pixel polygons).
When Allmaps tries to triangulate these for WebGL rendering, it throws
`Edge intersects already constrained edge` from the CDT (Constrained Delaunay
Triangulation) step. These should be excluded from the build.

### Bad Manifests — Exact IDs and Source URLs

| Allmaps manifest ID | Label | Source manifest URL |
|---|---|---|
| `04930d7222f43159` | ANTWERPEN - Verzamelplan | `https://iiif.ghentcdh.ugent.be/iiif/manifests/primitief_kadaster:550_0001_000_02553_000` |
| `787106327b287f41` | ANTWERPEN - Sectie B | `https://iiif.ghentcdh.ugent.be/iiif/manifests/primitief_kadaster:550_0001_000_02555_000` |
| `949c44555577f899` | ANTWERPEN - Sectie C | `https://iiif.ghentcdh.ugent.be/iiif/manifests/primitief_kadaster:550_0001_000_02556_000` |
| `e621fad69cecfcb5` | Kalken - Sectie B | `https://iiif.ghentcdh.ugent.be/iiif/manifests/primitief_kadaster:550_0001_000_06383_000` |

### What to Do in `src/pipeline.ts`

1. **Create a blocklist** — add a constant near the top of `pipeline.ts`:
   ```typescript
   // Manifests with self-intersecting resource masks — excluded from build.
   // These cause CDT triangulation failures in Allmaps (Edge intersects already constrained edge).
   const PROBLEMATIC_MANIFEST_IDS = new Set([
     "04930d7222f43159", // ANTWERPEN - Verzamelplan
     "787106327b287f41", // ANTWERPEN - Sectie B
     "949c44555577f899", // ANTWERPEN - Sectie C
     "e621fad69cecfcb5", // Kalken - Sectie B
   ]);
   ```

2. **Filter before processing** — when iterating manifests (the step that fetches each
   manifest, generates Allmaps IDs, and checks annotation status), skip any manifest
   whose computed Allmaps manifest ID is in `PROBLEMATIC_MANIFEST_IDS`. Log a warning
   so the exclusion is visible in the build output:
   ```typescript
   if (PROBLEMATIC_MANIFEST_IDS.has(allmapsId)) {
     console.warn(`[SKIP] Problematic manifest excluded: ${manifestUrl} (${allmapsId})`);
     continue;
   }
   ```

3. **Record them in `build/index.json`** — add a `problematicManifests` array to the
   index output so the viewer can optionally surface them. Each entry:
   ```json
   {
     "manifestAllmapsId": "04930d7222f43159",
     "label": "ANTWERPEN - Verzamelplan",
     "sourceManifestUrl": "...",
     "reason": "self-intersecting resource mask"
   }
   ```

4. **Re-run the full pipeline** after the change and verify those 4 IDs no longer appear
   in `build/collections/87eb94ed85ae9008.json` (the Primitief collection file) and
   that the `georefCount` in `build/index.json` for the Primitief layer decreases by 4.

---

## Session Update — 2026-03-06 (Search UX: Toponyms + Manifests)

### Direction
- Search bar now targets both:
  - toponyms (`build/Toponyms/index.json`)
  - IIIF manifests (`build/index.json` `index[]`)
- Manifest hits must always pan/zoom to map location.

### Data Contract Dependency
- Viewer expects optional `centerLon` / `centerLat` on `CompiledIndexEntry` (from data pipeline).
- Manifest search results without coordinates are excluded from click-to-location results.

### UX Requirement
- Clicking a manifest hit:
  1. flies map to manifest center
  2. opens a small UI window/modal exposing a Mirador-view URL for that manifest

---

## Session Update — 2026-03-05

### Done Today
- `Artemis-RnD-Data/src/pipeline.ts` updated:
  - `verzamelblad` detection expanded to include `verzamelplan` / `verzamelplannen`.
  - Source label normalization added to remove `Artemis -` prefix.
- Local data build now correctly emits split render layers:
  - `Primitief Kadaster` `renderLayerKey: "default"` and `renderLayerKey: "verzamelblad"`.
  - `isVerzamelblad: true` entries now present (64 in local `build/index.json`).
- Viewer updated to use `renderLayers` as the source of toggleable layers.
- Viewer dataset URL handling improved:
  - accepts pasted GitHub `blob/.../build/index.json` and maps to raw content path.
  - default dataset base switched to GitHub raw build URL.
- Viewer annotation loading updated to support manifest/canvas dual model:
  - current rule in runner: if canvas-level mirrored annotations exist, apply canvas-level; otherwise apply manifest-level.

### Current State / Problem
- `verzamelblad` layer now appears and toggles.
- `Primitief Kadaster (default)` still regresses at runtime:
  - observed symptom: effectively one flickering map (or severe under-render).
  - previous split-sub-layer metrics also showed starvation (`sub-layer [1] fetchable 0`).
- This is now likely in runtime annotation application/render orchestration, not in index-layer discovery.

### What Was Verified In Data Build
- In local `Artemis-RnD-Data/build/index.json`:
  - 211 entries have both manifest-level and canvas-level mirrored annotation paths.
  - 11 are partial canvas-hit cases (not every canvas has a canvas-level mirrored path).
- Compiled manifests do contain per-canvas `otherContent` wiring (canvas-specific when present, manifest fallback otherwise).

### Plan For Tomorrow
- Implement dual hidden runtime sublayers behind one UI checkbox for each render layer:
  1. Hidden layer A: manifest-level annotations only.
  2. Hidden layer B: canvas-level annotations only.
  3. Keep single visible checkbox controlling both A+B.
- Load both hidden layers deterministically and compare:
  - map registration counts,
  - fetchable counts,
  - first-tile progression,
  - flicker behavior.
- Add temporary debug counters in runner:
  - `appliedFromManifest`,
  - `appliedFromCanvas`,
  - per-entry annotation-source classification.
- Goal: isolate whether failure is caused by mixed-source application in one layer versus renderer behavior under separate layers.

## Annotation QA Protocol (Must Run During Debugging)

When diagnosing render instability, do not stop at runtime metrics. Also validate mirrored georeference annotation quality and record concrete findings.

### Required Annotation Checks
- Mask bounds:
  - Detect polygon points outside image bounds (`x < 0`, `y < 0`, `x > width`, `y > height`).
  - Flag count and exact offending points.
- GCP quality:
  - Detect duplicate geographic control points (same lon/lat reused).
  - Detect transformation/GCP mismatches (for example: `thinPlateSpline` with very low GCP count).
- Geometry sanity:
  - Detect self-intersections or triangulation-risk masks when possible.
- Annotation structure:
  - Confirm expected Allmaps fields are present (`items[0]`, `target.source`, `target.selector`, `body.features`, `body.transformation`).

### Required Issue Report Format
For each flagged manifest, always include:
1. Issue type(s):
   - Example: `out-of-bounds mask point`, `duplicate geo GCP`, `TPS with low GCP count`, `self-intersection risk`.
2. Where to find it:
   - IIIF manifest URL (`sourceManifestUrl`).
   - Mirrored annotation path (`build/allmaps/canvases/<id>.json` or `build/allmaps/manifests/<id>.json`).
   - Canvas ID and Allmaps ID if available.
3. Potential solution(s):
   - Example options:
     - Clamp mask points to image bounds.
     - Remove or merge duplicate geo GCPs.
     - Switch unstable low-GCP `thinPlateSpline` to polynomial order 1.
     - Exclude known-bad manifests from build (with explicit reason in index metadata).

### Output Expectation
- Produce a short per-manifest table/list: `label`, `issue`, `IIIF manifest URL`, `mirrored file`, `proposed fix`.
- Keep this alongside runtime diagnostics so data-quality and renderer-policy causes are evaluated in parallel.

---

## Session Update — 2026-03-06 (Layer UI + WMTS Ordering)

### What We Implemented
- Map UI reworked:
  - Layer controls moved onto the map overlay.
  - Left-side column became expandable `Debug Menu`.
  - Added explicit show/hide toggle and close action for debug menu.
- Layer metrics simplified:
  - Kept compact line format around rendering/visible counts earlier.
  - Later removed verbose per-row rendering metrics in unified stack UI to reduce clutter.
- WMTS overlays added:
  - `Ferraris 1771` and `Vandermaelen 1846` from `https://geo.api.vlaanderen.be/HISTCART/wmts`.
  - Correct WMTS KVP pattern uses `STYLE=` (empty) with `GoogleMapsVL`.
  - Added bounds to reduce invalid tile requests.
- Opacity controls:
  - Added per-layer opacity sliders for both IIIF and WMTS layers.
  - IIIF opacity fixed to use `WarpedMapLayer.setOpacity(...)` (custom layer API), not `raster-opacity`.
  - WMTS default opacity changed to 100% (`1.0`) in both UI state and initial paint.
- Layer ordering UI:
  - Added drag/drop layer stack (Photoshop-like intent).
  - Refactored to a single unified list (visibility + opacity + order in one place).
  - UI order is top-to-bottom.
  - Removed separate `iiif/wmts` type section labels to save horizontal space and avoid overflow.
  - Aligned row columns so slider placement is consistent.

### Pipeline/Code Structure Changes
- `app/src/lib/artemis/map/mapInit.ts`:
  - Added WMTS add/remove helpers.
  - Added WMTS opacity setter.
- `app/src/lib/artemis/runner.ts`:
  - Added runtime layer-group opacity setter for custom Allmaps layers.
  - Added helpers to inspect active layer-group ids.
- `app/src/routes/+page.svelte`:
  - Introduced unified layer stack state + drag/drop handlers.
  - Visibility and opacity integrated per row.
  - z-order application switched to concrete MapLibre layer-id moves.

### Known Unresolved Issue
- **Still open**: On first enabling a WMTS layer after IIIF is loaded, WMTS may render on top even if stack says it should be below.
- Observed behavior:
  - If user manually drags WMTS to top and then back down, ordering then behaves correctly.
- Attempts made (not fully successful):
  - Immediate + next-frame + delayed re-apply ordering passes.
  - Rendered-state-based ordering checks.
  - Concrete layer-id move ordering.
  - Explicit "band-aid" top-then-back simulation on WMTS enable.

### Current Practical State
- Unified layer list UI exists and is functional for visibility/opacity/order interactions.
- IIIF opacity works correctly (custom layer path).
- WMTS default opacity is fully opaque.
- The first-enable WMTS z-priority edge case remains and should be treated as next debugging target.

---

## Session Update — 2026-03-06 (Primitive Parcels UX + Debug)

### What We Added
- Primitive parcel loading/debug instrumentation:
  - logs around `setPrimitiveLayerVisible` flow (`addSource`, `addLayer`, `removeLayer`, `removeSource`)
  - source lifecycle logs (`sourcedataloading`, `sourcedata`, map `error`)
  - source loaded counts include parcel/text split for quick sanity checks
- UI debug logs for parcel toggle intent and resulting map state (`source`/`layer` present).

### Parcel Rendering Behavior (Current)
- Parcel layer renders only parcel polygons:
  - MapLibre layer filter on `properties.type === "parcel"` remains in place.
- Hover picking works across full polygon interior (not only edges):
  - implemented with an invisible fill pick layer (`primitive-parcels-fill-layer`).
- Hover feedback now includes:
  - visible highlighted parcel fill (`primitive-parcels-hover-layer`)
  - tooltip with:
    - parcel number (`parcel_number`, fallback `#parcel_index`)
    - leaf id (derived from `_source_file` without `.geojson`)

### Relevant Files
- `app/src/lib/artemis/map/mapInit.ts`
  - primitive source/layer lifecycle logging
  - interior hover pick layer
  - dedicated hover highlight source/layer and updater (`setPrimitiveHoverFeature`)
- `app/src/routes/+page.svelte`
  - hover state, tooltip rendering, mouse handlers
  - parcel toggle state/debug messages

### Data Assumption
- The current `Artemis-RnD-Data/build/Parcels/Primitive/index.geojson` is now parcel-only (`8538` parcel features, no `text` features).

---

## Session Update — 2026-03-06 (Unified Search: Manifests + Toponyms)

### What Was Implemented
- Search overlay in `+page.svelte` now returns two grouped result types:
  - `IIIF manifests` (from `build/index.json` already loaded in viewer)
  - `Toponyms` (from `build/Toponyms/index.json`)
- Manifest search uses `CompiledIndexEntry` coordinates (`centerLon`, `centerLat`) and excludes entries without coordinates.
- Manifest result metadata clearly shows source as:
  - `IIIF - <source label>` (e.g. `IIIF - Gereduceerd Kadaster`, `IIIF - Primitief Kadaster`)

### Click Behavior
- Clicking either result type flies map to coordinates.
- Clicking a manifest result also opens a modal with:
  - source manifest URL
  - Mirador URL (`projectmirador.org/embed/?manifest=...`)
  - actions: copy URL / open Mirador / close

### UX/Debug Improvements
- First focus on search input shows 3 random toponym suggestions for quick validation.
- After selecting a result, search dropdown collapses and input keeps selected text.
- Typing again re-enables live results (`searchSelectionLocked` reset on input).
- Debug logs include:
  - `Toponyms loaded: <n>`
  - `Manifest search entries loaded: <n>`

### Type Updates
- `app/src/lib/artemis/runner.ts` `CompiledIndexEntry` now includes optional:
  - `centerLon?: number`
  - `centerLat?: number`

---

## Session Update — 2026-03-13 (Canvas info.json Pre-warm Cache)

### What Changed
- `app/src/lib/artemis/runner.ts`:
  - Added `cachedCanvasInfoIndex` and `cachedInfoByServiceUrl` module-level caches.
  - Added `loadCanvasInfoIndex(cfg)`: fetches `build/iiif/info/index.json` once (gracefully degrades to `{}` on 404/error). Builds a `serviceUrl → infoJson` lookup from the index values by extracting each entry's `@id` field.
  - `resetCompiledIndexCache()` now also resets the canvas info caches.
  - In `runLayerGroup`: `loadCompiledIndex` and `loadCanvasInfoIndex` are now fetched in parallel at layer startup (`Promise.all`).
  - Pre-warm block updated: for each image service URL, checks `infoByServiceUrl` first; only falls back to individual `fetch({url}/info.json)` on a miss. Cache hit/miss counts logged.

### Why
- Previously, the pre-warm block fetched every `info.json` individually at runtime (N concurrent requests to the IIIF server).
- `build/iiif/info/index.json` (produced by `Artemis-RnD-Data` pipeline) is a single committed JSON keyed by canvas ID, where each value is the full info.json with `@id` = image service URL.
- One fetch of the committed index replaces N live IIIF server requests, reducing startup latency for the pre-warm step.

### Lookup
- Info index is keyed by image service base URL (exact string used to fetch `{serviceUrl}/info.json`).
- Viewer pre-warm uses `wm.georeferencedMap?.resource?.id` — the same image service URL.
- Direct `Map.get(url.replace(/\/+$/, ""))` lookup, no bridge needed.
- `@id` / `id` normalization (forcing both to the fetched URL) is still applied to cached entries before passing to `addImageInfos()`, matching the existing convention for live-fetched entries.
