import maplibregl from "maplibre-gl";

// Custom MapLibre protocol that gates IIIF raster-pyramid tile requests against each pyramid's
// `tiles_manifest.json` (the list of tiles that actually exist on disk). Coverage is an irregular
// shape, so a plain raster source probes the full viewport grid and 404s on every tile outside the
// surveyed extent — those 404s are harmless but Firefox/Chrome log each failed request natively and
// flood the console. Routing tiles through this protocol means a tile that the manifest says doesn't
// exist is answered locally with a transparent image — no HTTP request is made, so no 404 appears.
export const IIIF_TILE_PROTOCOL = "iiiftiles";

/** Wrap a plain `https://…/{z}/{x}/{y}.webp` tile template so MapLibre routes it through us. */
export function toIiifTileTemplate(httpTemplateUrl: string): string {
  return `${IIIF_TILE_PROTOCOL}://${httpTemplateUrl}`;
}

// 1×1 fully transparent PNG — returned for tiles the manifest says don't exist. Decoded once.
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const transparentPng = Uint8Array.from(atob(TRANSPARENT_PNG_BASE64), (c) => c.charCodeAt(0));
const transparentTile = (): { data: ArrayBuffer } => ({ data: transparentPng.slice().buffer });

// Per-pyramid manifests, keyed by manifest URL. A pyramid's manifest is a flat JSON array of
// "z/x/y.webp" relative paths. Loaded once, shared across every tile request for that pyramid.
const manifestSets = new Map<string, Promise<Set<string> | null>>();

function manifestUrlForTile(realTileUrl: string): string | null {
  // realTileUrl: https://…/<tilesDir>/{z}/{x}/{y}.webp — the manifest sits alongside the pyramid.
  const m = realTileUrl.match(/^(.*)\/\d+\/\d+\/\d+\.webp(?:\?.*)?$/);
  return m ? `${m[1]}/tiles_manifest.json` : null;
}

function relativeTilePath(realTileUrl: string): string | null {
  const m = realTileUrl.match(/\/(\d+\/\d+\/\d+\.webp)(?:\?.*)?$/);
  return m ? m[1] : null;
}

function loadManifestSet(manifestUrl: string): Promise<Set<string> | null> {
  let existing = manifestSets.get(manifestUrl);
  if (!existing) {
    // Deliberately NOT tied to any single tile request's AbortController — this promise is shared.
    existing = fetch(manifestUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((arr) => (Array.isArray(arr) ? new Set<string>(arr as string[]) : null))
      .catch(() => null);
    manifestSets.set(manifestUrl, existing);
  }
  return existing;
}

/** Warm a pyramid's manifest ahead of the first tile request so gating adds no first-paint latency. */
export function prefetchIiifTileManifest(manifestUrl: string): void {
  void loadManifestSet(manifestUrl);
}

let registered = false;

/** Register the `iiiftiles://` protocol once (module-scope, alongside the pmtiles protocol). */
export function registerIiifTileProtocol(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(IIIF_TILE_PROTOCOL, async (params, abortController) => {
    const realUrl = params.url.slice(`${IIIF_TILE_PROTOCOL}://`.length);
    const manifestUrl = manifestUrlForTile(realUrl);
    const rel = relativeTilePath(realUrl);

    // If the manifest says this tile doesn't exist, answer transparently — no network request.
    if (manifestUrl && rel) {
      const set = await loadManifestSet(manifestUrl);
      if (set && !set.has(rel)) return transparentTile();
    }

    // Otherwise fetch the real tile (existing tile, or manifest unavailable → best-effort).
    const res = await fetch(realUrl, { signal: abortController?.signal });
    if (!res.ok) return transparentTile();
    return { data: await res.arrayBuffer() };
  });
}
