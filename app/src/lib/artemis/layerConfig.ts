// Layer configuration for the historical map era tree.
// Defines all main layers (eras), their sub-layers, labels, and visual metadata.

export type MainLayerId = 'gereduceerd' | 'primitief' | 'vandermaelen' | 'ferraris' | 'handdrawn';
export type SubLayerKind = 'iiif' | 'geojson' | 'wmts' | 'wms' | 'searchable';
export type HistCartLayerKey = 'ferraris' | 'vandermaelen';

export const MAIN_LAYER_ORDER: MainLayerId[] = [
  'ferraris', 'vandermaelen', 'primitief', 'gereduceerd', 'handdrawn',
];

export const MAIN_LAYER_LABELS: Record<string, string> = {
  ferraris:     'Ferraris',
  vandermaelen: 'Vandermaelen',
  primitief:    'Primitief kadaster',
  gereduceerd:  'Gereduceerd kadaster',
  handdrawn:    'Hand drawn collection',
};

export const MAIN_LAYER_META: Record<string, { date: string; color: string }> = {
  ferraris:     { date: '1771',      color: '#4a9e5c' },
  vandermaelen: { date: '1846',      color: '#378ADD' },
  primitief:    { date: '1808–1834', color: '#c97a2e' },
  gereduceerd:  { date: '1847–1855', color: '#7b6fce' },
  handdrawn:    { date: '19th c.',   color: '#888780' },
};

export const SUB_LAYER_DEFS: Record<string, { label: string; kind: SubLayerKind }> = {
  'ferraris-wmts':          { label: 'WMTS',            kind: 'wmts'       },
  'ferraris-landusage':     { label: 'Land usage',           kind: 'wms'        },
  'ferraris-toponyms':      { label: 'Toponyms',             kind: 'searchable' },
  'vandermaelen-wmts':      { label: 'WMTS',            kind: 'wmts'       },
  'vandermaelen-landusage': { label: 'Land usage',           kind: 'wms'        },
  'vandermaelen-toponyms':  { label: 'Toponyms',             kind: 'searchable' },
  'primitief-iiif':         { label: 'IIIF collection',      kind: 'iiif'       },
  'primitief-parcels':      { label: 'Parcels',              kind: 'geojson'    },
  'primitief-landusage':    { label: 'Land usage',           kind: 'geojson'    },
  'gereduceerd-iiif':       { label: 'IIIF collection',      kind: 'iiif'       },
  'gereduceerd-parcels':    { label: 'Parcels',              kind: 'geojson'    },
  'gereduceerd-landusage':  { label: 'Land usage',           kind: 'geojson'    },
  'handdrawn-iiif':         { label: 'IIIF collection',      kind: 'iiif'       },
  'handdrawn-parcels':      { label: 'Parcels',              kind: 'geojson'    },
  'handdrawn-water':        { label: 'Water infrastructure', kind: 'geojson'    },
};

export const MAIN_LAYER_SUBS: Record<string, string[]> = {
  ferraris:     ['ferraris-wmts', 'ferraris-landusage', 'ferraris-toponyms'],
  vandermaelen: ['vandermaelen-wmts', 'vandermaelen-landusage', 'vandermaelen-toponyms'],
  primitief:    ['primitief-iiif', 'primitief-parcels', 'primitief-landusage'],
  gereduceerd:  ['gereduceerd-iiif', 'gereduceerd-parcels', 'gereduceerd-landusage'],
  handdrawn:    ['handdrawn-iiif', 'handdrawn-parcels', 'handdrawn-water'],
};

export function makeInitialMainLayerEnabled(): Record<string, boolean> {
  return { gereduceerd: false, primitief: false, vandermaelen: false, ferraris: false, handdrawn: false };
}

export function makeInitialSubLayerEnabled(): Record<string, boolean> {
  return {
    'ferraris-wmts': false,         'ferraris-landusage': false,    'ferraris-toponyms': false,
    'vandermaelen-wmts': false,     'vandermaelen-landusage': false, 'vandermaelen-toponyms': false,
    'primitief-iiif': false,   'primitief-parcels': false,   'primitief-landusage': false,
    'gereduceerd-iiif': false, 'gereduceerd-parcels': false, 'gereduceerd-landusage': false,
    'handdrawn-iiif': false,   'handdrawn-parcels': false,   'handdrawn-water': false,
  };
}
