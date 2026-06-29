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

## UI Refactor Instructions

The current UI recreates buttons and floating panel/window shells in multiple Svelte files. This makes theming fragile because each feature owns slightly different CSS, radius values, hover states, and close behavior. The intended direction is a small set of semantic primitives that feature components compose.

### 1. Add Shared UI Components

Create a shared component folder:

- `app/src/lib/artemis/ui/primitives/Button.svelte`
- `app/src/lib/artemis/ui/primitives/Window.svelte`

`Button.svelte` should be the only component used for user actions. Semantically, a button is an action trigger; its variant describes importance or interaction context, not the feature that owns it. Use props like:

- `variant="chrome"` for low-emphasis utility actions such as close, reload, copy, metadata toggles, and small panel actions.
- `variant="primary"` for the main forward action in a surface, such as "Open in viewer".
- `variant="toolbar"` for persistent map/view controls.
- `variant="tab"` for mutually exclusive section selection.
- `variant="list"` for clickable result/list rows that currently use button markup.
- `iconOnly={true}` for close/focus/pin actions where the visible label is an icon and the accessible label is provided through `aria-label`.
- `active={true}` and `disabled={true}` for stateful controls.

`Window.svelte` should be the only component used for framed floating or docked surfaces. Semantically, a window is a bounded UI surface above the map or viewer, not just a rectangle with a background. It owns the common frame concerns:

- Header layout with title, optional subtitle/meta, optional action slot, and optional close button.
- Surface variants such as `floating`, `docked`, `modal`, `popover`, and `timeline`.
- Placement variants such as `left`, `right`, `bottom`, `center`, and `anchored`.
- Optional backdrop for modal/branding-panel behavior.
- Escape-key close behavior when `closeOnEscape` is enabled.
- Consistent border, background, shadow, radius, and overflow behavior.

Feature-specific content stays inside the feature component. The primitive owns chrome; the feature owns data, copy, map behavior, and event dispatch.

### 2. Centralize Radius Semantics

In `app/src/lib/theme.css`, replace fixed independent radius values with one controlling value and derived semantic tokens:

```css
:root {
  --radius-base: 8px;
  --radius-xs: calc(var(--radius-base) * 0.75);
  --radius-sm: var(--radius-base);
  --radius-md: calc(var(--radius-base) * 1.5);
  --radius-lg: calc(var(--radius-base) * 2);
  --radius-pill: 999px;
}
```

Use these meanings consistently:

- `--radius-xs`: compact controls, thumbnails, small badges, list rows.
- `--radius-sm`: standard buttons, inputs, and small inline panels.
- `--radius-md`: regular floating windows and cards.
- `--radius-lg`: large modal or viewer surfaces.
- `--radius-pill`: pills, chips, sliders, and rounded tracks.

Implementation rule: normal UI must use the semantic tokens, never hard-coded `px` radii. Circular icon controls may use `50%`; pill controls may use `--radius-pill`. All other corner changes should happen by changing `--radius-base`, so small controls and large windows scale together.

### 3. Update Shared CSS

Refactor `app/src/lib/ui.css` so it supports the primitives instead of acting as a collection of feature-specific escape hatches:

- Keep only generic classes or CSS custom properties that are genuinely shared.
- Move button frame styles behind `Button.svelte`.
- Move floating panel/window frame styles behind `Window.svelte`.
- Keep utility text styles such as `.ui-label`, `.ui-meta`, `.ui-alert`, and `.ui-mono` if they remain useful.
- Remove or deprecate `.ui-btn`, `.ui-btn-primary`, `.ui-icon-btn`, `.ui-panel`, `.ui-panel-overlay`, `.ui-card`, and `.ui-card-header` once their consumers are migrated.

### 4. Migrate Existing Components

Convert the highest-duplication components first:

- `app/src/lib/components/MapInfoWindow.svelte`
  Replace `.map-info-window`, `.window-header`, `.close-button`, `.copy-url-button`, and local sublayer button styling with `Window.svelte` and `Button.svelte`.
- `app/src/lib/components/BrandingPanel.svelte`
  Replace the branding trigger, modal frame, backdrop, close button, and tab buttons with shared primitives. Keep brand-specific logo layout inside the component.
- `app/src/lib/artemis/ui/ImageCollectionBubble.svelte`
  Replace the bubble frame and close/open buttons with shared primitives. Keep anchored positioning and image metadata rendering inside this component.
- `app/src/lib/components/Timeslider.svelte`
  Replace timeline panel chrome and info modal chrome with `Window.svelte`; replace layer/info/close controls with `Button.svelte`.
- `app/src/lib/artemis/viewer/IiifViewer.svelte`
  Replace viewer frame/header/action buttons where possible, but keep viewer-specific canvas and metadata layout local.
- `app/src/lib/artemis/app/ArtemisApp.svelte`
  Replace compare/toolbar button styling with `Button.svelte` or the new toolbar variant.

Do not migrate every component in one large unreviewable edit. Start with `MapInfoWindow.svelte`, `ImageCollectionBubble.svelte`, and `BrandingPanel.svelte`, then run `pnpm check` before continuing to `Timeslider.svelte` and `IiifViewer.svelte`.

### 5. Cleanup Rules

After each migration pass:

- Search for `border-radius:` and remove hard-coded values except `50%` and deliberate `--radius-pill` uses.
- Search for raw `<button` usage. Raw buttons are acceptable only inside `Button.svelte`; all feature components should use the primitive unless there is a clear browser-native form reason.
- Keep semantic component props stable. Avoid creating feature-named variants such as `variant="branding"` or `variant="map-info"`; use semantic variants like `primary`, `chrome`, `tab`, `toolbar`, or `list`.
- Run `cd app && pnpm check`.

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
