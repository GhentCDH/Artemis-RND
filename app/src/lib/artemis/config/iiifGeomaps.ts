// Hard-coded geomaps file override.
//
// By default we load `IIIF/<mapId>_geomaps.json` from the dataset build.
// This allows swapping in alternative bundles like `IIIF/<mapId>_geomaps_simplified.json`
// without touching the data repo.

export type IiifGeomapsConfig = {
  enabled: boolean;

  // Inserted between `_geomaps` and `.json`.
  // Example: `_simplified` → `<mapId>_geomaps_simplified.json`
  globalVariantSuffix: string;

  // Optional per-layer overrides (keyed by mapId, e.g. "PrimitiefKadaster").
  byIiifLayerVariantSuffix: Record<string, string>;
};

export const IIIF_GEOMAPS_CONFIG: IiifGeomapsConfig = {
  enabled: true,
  globalVariantSuffix: "",
  byIiifLayerVariantSuffix: {
    // Example:
    // PrimitiefKadaster: "_simplified",
  },
};

function applyVariantToGeomapsPath(path: string, variantSuffix: string): string {
  if (!variantSuffix) return path;

  // Common contract: `.../<mapId>_geomaps.json`
  if (/_geomaps\.json$/i.test(path)) return path.replace(/_geomaps\.json$/i, `_geomaps${variantSuffix}.json`);

  // Fallback: `.../geomaps.json`
  if (/geomaps\.json$/i.test(path)) return path.replace(/geomaps\.json$/i, `geomaps${variantSuffix}.json`);

  return path;
}

export function resolveIiifGeomapsPath(mapId: string | undefined, geomapsPath: string | undefined): string | undefined {
  if (!IIIF_GEOMAPS_CONFIG.enabled) return geomapsPath;

  const key = String(mapId ?? "").trim();
  const variantSuffix =
    (key && IIIF_GEOMAPS_CONFIG.byIiifLayerVariantSuffix[key] != null)
      ? String(IIIF_GEOMAPS_CONFIG.byIiifLayerVariantSuffix[key])
      : String(IIIF_GEOMAPS_CONFIG.globalVariantSuffix ?? "");

  if (geomapsPath) return applyVariantToGeomapsPath(geomapsPath, variantSuffix);
  if (key) return `IIIF/${key}_geomaps${variantSuffix}.json`;
  return geomapsPath;
}
