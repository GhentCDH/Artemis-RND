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

- `https://ghentcdh.github.io/Artemis-RnD-Data/build`

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

## Deployment

The app is deployed to GitHub Pages via GitHub Actions.

**Branch workflow:**
- `dev` — active development
- `main` — stable source code; pushing here triggers a deploy
- `gh-pages` — compiled static output, managed by CI (never commit here manually)

**Live site:** `https://ghentcdh.github.io/Artemis-RND`

Deployment is handled by `.github/workflows/deploy.yml`, which:
1. Installs dependencies with pnpm
2. Builds the app with `BASE_PATH=/Artemis-RND`
3. Pushes the output of `app/build` to the `gh-pages` branch

The app uses `@sveltejs/adapter-static` with SPA fallback (`index.html`), so no server is required at runtime.

## Related Repo

- Data pipeline: [GhentCDH/Artemis-RnD-Data](https://github.com/GhentCDH/Artemis-RnD-Data) — preprocessing pipeline + GitHub Pages publisher
