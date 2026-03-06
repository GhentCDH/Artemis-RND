# Artemis-RnD (Viewer)

Svelte + MapLibre viewer for Artemis compiled IIIF data.

This app loads precompiled outputs from `Artemis-RnD-Data/build`, renders georeferenced layers with Allmaps, and provides unified search for manifests and toponyms.

## Stack

- SvelteKit
- MapLibre GL
- `@allmaps/maplibre`

## Features

- Layer toggles for compiled render layers
- WMTS background overlays
- Primitive parcel overlay + hover tooltip
- Unified search overlay:
  - IIIF manifest search (from `build/index.json`)
  - Toponym search (from `build/Toponyms/index.json`)
- Click search result to fly map to location
- Manifest result opens Mirador URL modal (copy/open)

## Data Dependency

Default dataset base URL points to:

- `https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build`

Required files at dataset base:

- `index.json`
- `Toponyms/index.json` (for toponym search)

Recommended in `index.json` manifest entries:

- `centerLon`
- `centerLat`

These are used for manifest click-to-location.

## Quick Start

```bash
cd app
pnpm install
pnpm run dev
```

## Useful Commands

```bash
cd app

# type + svelte checks
pnpm run check

# production build
pnpm run build

# preview build
pnpm run preview
```

## Related Repo

- Data pipeline: `../Artemis-RnD-Data`
