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
- `app/src/lib/components/Timeslider.svelte`: timeline UI, pill interaction, pane controls, sublayer menu UI.
- `app/src/lib/artemis/map/mapInit.ts`: WMTS/WMS/raster/map source setup.
- `app/src/lib/artemis/layerConfig.ts`: main layers, sublayers, labels, short labels, colors, info text, source URLs.
- `app/src/lib/artemis/runner.ts`: IIIF loading, parking, restoring, Allmaps integration.

## 4. Configuration

- `FEATURE_FLAGS.startupPreloadScreen = false`
- `FEATURE_FLAGS.debugMenu = false`
- `Massart/index.json` is loaded separately from the compiled IIIF index.
- `renderLayers` in `build/index.json` is effectively required by the viewer.
- Main-layer info/source text is configured in `MAIN_LAYER_INFO` and `MAIN_LAYER_SOURCE`.

## 5. Decisions

- `Timeslider.svelte` is the mounted timeline; legacy timeline files are not active.
- NGI 1873 / NGI 1904 are connected as raster tile services, not via confirmed WMTS capabilities.
- Villaret is connected as WMS-backed raster, not via confirmed WMTS.
- Sublayers should not have info buttons.
- Only main layers should have an info button, intended to open a bubble with description plus source link.

## 6. Todos

- Simplify `Timeslider.svelte`; it contains multiple overlapping iterations.
- Re-verify lane assignment and small-pill readability after the interaction bugs are fixed.
- Re-test smallest pills for hitbox, visual width, and abbreviation legibility.

## 7. Bugs

- `Main-layer info bubble still broken`
  Clicking the main-layer `i` button still does not show the bubble in the running UI, even after refactoring the markup into a dedicated `sub-menu-info-anchor` and wiring `MAIN_LAYER_INFO` / `MAIN_LAYER_SOURCE`.
- `Pill click isolation not trusted`
  There was an attempted implementation to disable other overlapping layers when a pill is clicked, but the user reported that the behavior still does not work correctly. Treat this as unresolved and re-test from the UI before relying on it.
- `Hover info behavior has been unstable`
  The custom pill hover display has changed multiple times; native `title` is the current fallback, but custom hover behavior should be rechecked in-browser.
- `Timeline full-label switch still broken`
  Timeline pills are still showing short labels/initials even after multiple attempts to restore full labels when a pill is wide enough. The current issue should be treated as unresolved runtime behavior in `app/src/lib/components/Timeslider.svelte`, not as a settled implementation.

## 8. Verification

- Last verified command: `pnpm -s run check`
- Current TypeScript/Svelte status at last edit: `0 errors, 0 warnings`
- Important: compile status is clean, but runtime behavior is not fully reliable. The main known example is the broken info bubble.

## 9. Next Actions

1. Hand off the main-layer info bubble bug to another agent and debug it in the live app, not only via static code inspection.
2. Re-test pill click isolation in-browser and either fix or remove the current partial implementation.
3. Once interaction bugs are stable, simplify `Timeslider.svelte` and remove dead experimental code paths.

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
