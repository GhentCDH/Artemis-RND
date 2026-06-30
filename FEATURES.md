# Artemis-RnD — Feature List

This document describes the components of the viewer and the specific features each one provides.

---

## Components

### ArtemisApp (`app/src/lib/artemis/app/ArtemisApp.svelte`)

Top-level orchestration shell. Owns all shared state and wires every feature component together.

- Initializes and manages the MapLibre GL map instance(s)
- Loads the compiled dataset index from the configured base URL
- Manages layer state: which historical collections are active, their opacity, and per-pane visibility
- Coordinates IIIF layer loading, parking, and z-order across the left and right map panes
- Drives split/compare mode: spawns and destroys the right-pane map, keeps cameras synchronized
- Handles all map interaction events: IIIF mask hover, parcel click, Massart pin click
- Computes "images in view" by testing Massart items against the current map bounds
- Provides screenshot export: composites all visible map and viewer canvases into a PNG download with a descriptive filename
- Persists and restores application state via hash-based URL encoding on every navigation change
- Accepts a custom dataset base URL (paste a GitHub blob URL or a raw build path; both are resolved automatically)

---

### Timeslider (`app/src/lib/components/Timeslider.svelte`)

Visual timeline bar docked at the bottom of the screen.

- Renders 10 historical map collections as styled pills on a horizontal axis spanning 1690–1930
- Pills use a meander ("river") layout: collections bulge above or below the axis to avoid overlap
- Each pill carries a unique CSS texture pattern that represents its source era
- Hovering a pill shows a tooltip with the collection name and date range
- Clicking a pill in single-pane mode activates that collection on the left map
- In split/compare mode, two pills can be active simultaneously (one per pane), assigned left/right via alternating click
- Active and dimmed states visually indicate the current selection against non-selected collections
- Per-collection sublayer toggles: IIIF map, WMTS tiles, cadastral parcels, land-use overlays
- Layer info button opens a modal with historical description text fetched from the dataset
- Responds to search focus events: when a toponym or manifest search result is selected, the matching collection is automatically highlighted
- Restores the active collection from URL state on mount

---

### ToponymSearch (`app/src/lib/artemis/ui/ToponymSearch.svelte`)

Floating search panel positioned at the top-center of the map.

- Animated cycling prompt text: "Search Maps", "Search Places", "Search Manifest" (terminal-style character removal effect)
- Searches three data sources simultaneously: historical toponyms, IIIF manifests, and Massart photographs
- Fuzzy text scoring: prefers prefix matches and full-word matches, gracefully handles diacritics and case
- Results grouped by source map and filterable by tab: All, Places, Sheets, Images
- "Active layers only" toggle to restrict results to collections currently visible on the map
- Click a toponym → fly map to coordinates, activate the relevant historical layer, open a preview bubble if the toponym references a specific feature
- Click a manifest → fly to location, activate the relevant layer, and open the document in the IIIF viewer
- Click a Massart image result → fly to photo location, open IIIF viewer
- Recently viewed manifests shown when the search field is focused and empty
- Opens and closes with keyboard support (Escape to dismiss)

---

### IiifViewer (`app/src/lib/artemis/viewer/IiifViewer.svelte`)

Inline IIIF document viewer, docked as a panel alongside the map.

- Powered by OpenSeadragon 6 for deep-zoom tile rendering
- Accepts a IIIF manifest URL; fetches the image service URL automatically from the manifest when not provided
- Displays a sprite-sheet thumbnail placeholder while the image service is loading
- Shows manifest metadata: title, canvas dimensions, date, Allmaps editor link
- Metadata panel is collapsible
- Fullscreen mode via the Fullscreen API
- Can be placed in the left or right pane in split-view
- Close button dispatches an event to the shell; the shell restores the "Images in View" panel if it was open before the viewer opened
- Viewer manifest URL is encoded in the URL hash so the open document survives page refresh

---

### BrandingPanel (`app/src/lib/components/BrandingPanel.svelte`)

Project identity button and information modal in the top-left corner.

- Artemis logo button (stylized meander SVG) with project name and subtitle
- Opens a modal panel with two tabs:
  - **About** — project description, team, and institutional logos, all sourced from `static/site.json`
  - **Pipeline** — dataset attribution and data pipeline description
- Modal uses the `Window` primitive with backdrop and Escape-key close support

---

### MapInfoWindow (`app/src/lib/components/MapInfoWindow.svelte`)

Collection detail panel that appears when a historical layer is active.

- Shows collection name, date range, and a color swatch matching the timeline pill
- Lists all sublayers for the active collection (IIIF map, WMTS tiles, cadastral parcels, land-use)
- Sublayer toggles enable/disable individual layers on the map without deactivating the whole collection
- Copy-URL button for WMTS and IIIF sublayers (copies the tile or manifest URL to the clipboard)
- Close button deactivates the collection
- Separate instances can appear for left and right panes in split-view

---

### InfoCards (`app/src/lib/artemis/ui/InfoCards.svelte`)

Right-side floating card stack, shown on map click interactions.

- **IIIF map card** — shown when the user clicks a georeferenced map on the canvas; displays title, layer label with color swatch, and an "Open in viewer" button
- **Parcel card** — shown when the user clicks a Primitief Kadaster parcel polygon; displays parcel number, leaf ID, and all available properties from the GeoJSON feature
- Both card types support:
  - **Pin** — locks the card in the stack so it persists after the click target changes
  - **Focus** — flies the map to the card's coordinates
  - **Close / Unpin** — removes the card from the stack
- Multiple pinned cards can be stacked simultaneously

---

### ImageCollectionBubble (`app/src/lib/artemis/ui/ImageCollectionBubble.svelte`)

Anchored preview popup for individual Massart photo pins.

- Appears at the map coordinates of the clicked pin, positioned to avoid screen edges
- Shows the photo title, location, year, and a sprite-sheet thumbnail
- "Open" button loads the full image in the IIIF viewer
- Automatically closes when the pin scrolls outside the viewport
- Repositions on map move to track the anchor coordinates

---

### ImagesInViewPanel (`app/src/lib/components/ImagesInViewPanel.svelte`)

Floating panel listing Massart photographs currently within the map bounds.

- Triggered by clicking any Massart pin; also restored automatically when the IIIF viewer closes
- Lists all photos with sprite-sheet thumbnails sorted by year
- Year range slider filters results to a sub-range of the Massart dataset (1904–1912)
- Clicking a photo row opens its manifest in the IIIF viewer and flies the map to its location
- Panel state (open/closed) survives the IIIF viewer opening and closing

---

### SliderLayer (`app/src/lib/components/SliderLayer.svelte`)

Individual layer pill rendered inside the Timeslider.

- Renders the meander SVG path for a single collection (above or below the timeline axis)
- Hit-testing against SVG path geometry so clicks near a meander activate the correct collection
- Applies per-collection CSS texture pattern and color
- Active, dimmed, and loading states with visual feedback
- Sublayer toggle buttons per pill (toggled from `Timeslider` via event dispatch)

---

### UI Primitives

Shared building blocks used by all feature components.

#### Button (`app/src/lib/artemis/ui/primitives/Button.svelte`)

Semantic button component with variants for every interaction context:

| Variant | Usage |
|---|---|
| `chrome` | Low-emphasis utility: close, copy, reload, metadata toggles |
| `primary` | Main forward action: "Open in viewer" |
| `toolbar` | Persistent map/view controls |
| `tab` | Mutually exclusive section selection |
| `list` | Clickable result or list rows |

Supports `iconOnly`, `active`, and `disabled` props.

#### Window (`app/src/lib/artemis/ui/primitives/Window.svelte`)

Semantic panel/surface component:

| Variant | Usage |
|---|---|
| `floating` | Overlaid panel above the map |
| `docked` | Panel inset into the layout |
| `modal` | Centered overlay with backdrop |
| `popover` | Anchored tooltip-style surface |
| `timeline` | Bottom-docked timeline bar |

Placement variants: `left`, `right`, `bottom`, `center`, `anchored`. Optional backdrop, Escape-key close, and close button built in.

#### RangeSlider (`app/src/lib/artemis/ui/primitives/RangeSlider.svelte`)

Dual-handle range slider used by the Images in View panel for year filtering.

---

## Feature Modules (Non-UI)

These TypeScript modules implement the core logic consumed by the components above.

| Module | Responsibility |
|---|---|
| `config/layers.ts` | Layer IDs, labels, colors, sublayer definitions, initial toggle state |
| `dataset/runtimeMetadata.ts` | Loads `site.json` and `layers.json` from the dataset static path |
| `dataset/manifestSearch.ts` | Builds the IIIF manifest search index from `index.json` |
| `dataset/toponyms.ts` | Loads and aggregates toponym files per map |
| `dataset/toponymNormalization.ts` | Strips diacritics and normalizes raw toponym strings |
| `iiif/runtime.ts` | Low-level Allmaps runtime wrapper |
| `iiif/bundleLoader.ts` | Loads and caches IIIF geomap bundles with sprite metadata |
| `iiif/layerController.ts` | Manages loaded layer groups: run, park, opacity, z-order |
| `iiif/layerLifecycle.ts` | Shell-facing helpers: load IIIF layer into pane, schedule sync |
| `map/mapInit.ts` | MapLibre initialization, basemap switching, IIIF hover masks, parcel and Massart layers |
| `panes/splitView.ts` | Right-pane lifecycle, camera sync between panes |
| `search/text.ts` | Text normalization and fuzzy scoring |
| `search/navigation.ts` | Search result interaction: toponym fly-to, manifest open, layer activation |
| `timeline/layerControls.ts` | Layer ordering and visibility changes driven by the timeslider |
| `url/urlState.ts` | Hash-based URL encode/decode for camera, layers, split mode, and viewer manifest |
| `viewer/manifestPreview.ts` | Fetches IIIF manifest metadata (title, canvas size, image service URL) |
