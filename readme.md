# Artemis-RnD (Viewer)

SvelteKit web viewer for the Artemis project — historical Belgian maps of the Scheldt region, spanning 1700 to 1912.

The app loads precompiled data from [`Artemis-RnD-Data`](https://github.com/GhentCDH/Artemis-RnD-Data), renders georeferenced IIIF map layers via Allmaps + MapLibre, and provides search across historical place names (toponyms) and IIIF manifests.

**Live site:** `https://ghentcdh.github.io/Artemis-RND`

---

## Stack

| Dependency | Role |
|---|---|
| SvelteKit 2 / Svelte 5 | App framework + reactivity |
| MapLibre GL 5 | Interactive map |
| `@allmaps/maplibre` | IIIF georeferencing on MapLibre |
| OpenSeadragon 6 | Deep-zoom IIIF image viewer |
| `@sveltejs/adapter-static` | Static SPA output for GitHub Pages |

---

## Historical Map Layers

Ten map collections are available, displayed on a visual timeline from 1690–1930:

| Layer | Period | Type |
|---|---|---|
| Handdrawn Collection | ~1700–1715 | IIIF (Allmaps) |
| Frickx | 1712 | WMTS tile |
| Villaret | 1745–1748 | WMTS tile |
| Ferraris | 1770–1778 | WMTS tile + land-use overlay |
| Primitief Kadaster | 1808–1834 | IIIF (Allmaps) + cadastral parcels |
| Vandermaelen | 1846–1854 | WMTS tile + land-use overlay |
| Gereduceerd Kadaster | 1847–1855 | IIIF (Allmaps) |
| Popp | 1842–1879 | WMTS tile |
| NGI 1873 | 1873 | WMTS tile |
| NGI 1904 | 1904 | WMTS tile |

IIIF layers are georeferenced client-side via Allmaps. WMTS layers are served from external tile services.

---

## Features

### Map View
- Interactive MapLibre GL map with pan, zoom, and rotation
- Switchable basemaps: Scheldt NGI, OpenStreetMap, or any custom WMTS/XYZ tile URL
- Live map scale bar
- Per-layer opacity control
- PNG screenshot export (composites all visible map and viewer canvases)

### Timeline & Layer Selection
- Visual meander-style timeline (1690–1930) showing all 10 map collections as draggable pills
- Click a pill to activate a layer; active layer loads on the map
- Per-layer sublayer toggles: IIIF map, WMTS tiles, cadastral parcels, and land-use overlays
- Layer metadata info panel with historical description per collection

### Split / Compare Mode
- Side-by-side view with two synchronized map panes
- Each pane independently selects an active historical layer
- Camera movement in one pane mirrors the other

### Search
- Unified floating search panel (toponym search + IIIF manifest search + Massart image search)
- Fuzzy text scoring with result grouping by source map
- Click a toponym result → fly map to location + activate relevant historical layer
- Click a manifest result → fly to location + open document in the IIIF viewer
- "Active layers only" filter to restrict results to currently visible maps

### IIIF Viewer
- Inline OpenSeadragon-based deep-zoom viewer, docked alongside the map
- Loads any IIIF manifest; fetches `imageServiceUrl` automatically from the manifest
- Sprite-sheet thumbnail shown as a placeholder while the image service loads
- Metadata panel with title, date, canvas info
- Fullscreen mode; viewer can be placed in left or right pane in split view
- Recently viewed manifests tracked in the search panel

### Massart Image Collection
- Botanical survey photographs (1904–1912) from the Jean Massart collection
- Map pins showing photo locations, colored by temporal proximity to the active timeline year
- Click a pin → preview bubble with sprite-sheet thumbnail; open in IIIF viewer
- "Images in View" panel: lists all Massart photos within the current map bounds, filterable by year range

### Map Interaction
- Hover over a georeferenced IIIF map → colored geo-mask outline + pointer cursor
- Click a georeferenced map → info card (title, layer, open-in-viewer button)
- Click a Primitief Kadaster parcel → parcel info card (parcel number, leaf ID, properties)
- Parcel and map info cards can be pinned and re-focused

### URL State
- Hash-based URL persistence: camera position, active left/right layers, split mode, open viewer manifest
- Shareable and bookmarkable links that restore the full view state on reload

---

## Data Contract

The viewer reads compiled output from the data pipeline. Default base URL:

```
https://ghentcdh.github.io/Artemis-RnD-Data/build
```

Files consumed at runtime:

| Path | Purpose |
|---|---|
| `index.json` | Render layer index + manifest list |
| `IIIF/<mapId>_geomaps.json` | Georeferenced map bundle |
| `IIIF/<mapId>/sprites/sprites.{jpg,json}` | Map thumbnail spritesheets |
| `Image collections/Massart/Massart_index.json` | Massart photo index |
| `Image collections/Massart/Massart_sprites.{jpg,json}` | Massart thumbnail spritesheets |
| `Toponyms/<mapId>/<mapId>Toponyms.json` | Historical place names per map |
| `Parcels/PrimitiefKadaster/PrimitiefKadasterParcels.geojson` | Cadastral parcel polygons |
| `static/site.json` | Site metadata (title, team, logos, attribution) |
| `static/layers.json` | Runtime layer metadata (historical descriptions) |

The `index.json` manifest entries should include `centerLon` / `centerLat` for fly-to navigation.

---

## Quick Start

```bash
cd app
pnpm install
pnpm run dev
```

## Commands

```bash
cd app

# Type + Svelte checks
pnpm run check

# Production build
pnpm run build

# Preview production build locally
pnpm run preview
```

---

## Deployment

The app deploys to GitHub Pages via GitHub Actions.

**Branch workflow:**
- `main` — stable source; pushing here triggers a deploy
- `meander` — active development branch
- `gh-pages` — compiled static output managed by CI; never commit here manually

**Deploy process** (`.github/workflows/deploy.yml`):
1. Install dependencies with pnpm
2. Build with `BASE_PATH=/Artemis-RND`
3. Push `app/build` output to `gh-pages`

Uses `@sveltejs/adapter-static` with SPA fallback (`index.html`), so no server is required at runtime.

---

## Project Structure

```
app/src/
  routes/+page.svelte                  # Thin route mount
  lib/artemis/
    app/ArtemisApp.svelte              # Top-level orchestration shell
    config/layers.ts                   # Layer IDs, labels, colors, sublayer definitions
    dataset/                           # Runtime metadata, manifest index, toponym loading
    iiif/                              # Allmaps runtime, bundle loader, layer lifecycle
    map/mapInit.ts                     # MapLibre setup, basemap, parcel + Massart layers
    panes/splitView.ts                 # Split-view lifecycle and camera sync
    search/                            # Text normalization, scoring, result navigation
    timeline/layerControls.ts          # Layer ordering and visibility logic
    ui/                                # Feature UI components + primitives
    viewer/                            # IiifViewer + manifest metadata loader
    url/urlState.ts                    # Hash-based URL encode/decode
  lib/components/
    Timeslider.svelte                  # Main timeline UI
    MapInfoWindow.svelte               # Collection detail panel
    BrandingPanel.svelte               # Project info modal
    ImagesInViewPanel.svelte           # Massart images-in-view panel
```

---

## Related Repos

- **Data pipeline:** [GhentCDH/Artemis-RnD-Data](https://github.com/GhentCDH/Artemis-RnD-Data) — preprocessing pipeline and GitHub Pages publisher
