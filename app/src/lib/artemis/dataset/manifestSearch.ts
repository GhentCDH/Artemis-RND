import type { ManifestSearchItem } from '$lib/artemis/shared/types';
import type { CompiledIndex } from '$lib/artemis/iiif/runner';

type VisibleLayer = {
  sourceCollectionUrl: string;
  sourceCollectionLabel: string;
};

type BuildManifestSearchIndexOptions = {
  index: CompiledIndex;
  visibleLayers: VisibleLayer[];
  cleanLayerLabel: (label: string) => string;
  normalizeSearchText: (text: string) => string;
  asFiniteNumber: (value: unknown) => number | null;
};

export function buildManifestSearchIndex({
  index,
  visibleLayers,
  cleanLayerLabel,
  normalizeSearchText,
  asFiniteNumber,
}: BuildManifestSearchIndexOptions): ManifestSearchItem[] {
  const sourceLabelByUrl = new Map<string, string>();
  for (const layer of visibleLayers) {
    const label = cleanLayerLabel(layer.sourceCollectionLabel || '');
    if (label && !sourceLabelByUrl.has(layer.sourceCollectionUrl)) {
      sourceLabelByUrl.set(layer.sourceCollectionUrl, label);
    }
  }

  const out: ManifestSearchItem[] = [];
  const seen = new Set<string>();
  for (const entry of index.index ?? []) {
    const label = String(entry.label ?? '').trim();
    if (!label) continue;
    const sourceManifestUrl = String(entry.sourceManifestUrl ?? '').trim();
    const compiledManifestPath = String(entry.compiledManifestPath ?? '').trim();
    if (!sourceManifestUrl || !compiledManifestPath) continue;

    const lon = asFiniteNumber((entry as any).centerLon);
    const lat = asFiniteNumber((entry as any).centerLat);
    const mapName =
      sourceLabelByUrl.get(entry.sourceCollectionUrl) ||
      (entry as any).sourceCollectionLabel ||
      'IIIF';
    const text = `${mapName} - ${label}`;
    const id = String(entry.manifestAllmapsId ?? '').trim() || compiledManifestPath || sourceManifestUrl;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      label,
      text,
      textNormalized: normalizeSearchText(text),
      mapName,
      sourceManifestUrl,
      compiledManifestPath,
      centerLon: lon ?? undefined,
      centerLat: lat ?? undefined,
    });
  }

  return out;
}
