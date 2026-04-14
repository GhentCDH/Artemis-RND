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

## 8. Verification

- Last verified command: `pnpm run check`
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

## 10. Next Actions

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
