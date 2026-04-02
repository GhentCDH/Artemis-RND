// Layer configuration for the historical map era tree.
// Defines all main layers (eras), their sub-layers, labels, and visual metadata.

export type MainLayerId =
  | 'ngi1904'
  | 'ngi1873'
  | 'gereduceerd'
  | 'popp'
  | 'vandermaelen'
  | 'primitief'
  | 'ferraris'
  | 'villaret'
  | 'frickx'
  | 'handdrawn';
export type SubLayerKind = 'iiif' | 'geojson' | 'wmts' | 'wms' | 'searchable';
export type HistCartLayerKey =
  | 'ngi1904'
  | 'ngi1873'
  | 'popp'
  | 'vandermaelen'
  | 'ferraris'
  | 'villaret'
  | 'frickx';

// Order is tuned for overlap windows. Gereduceerd should stay above Popp and
// Vandermaelen in the 1847–1855 zone; later NGI basemaps can sit below older
// more detailed cadastral layers where ranges overlap.
export const MAIN_LAYER_ORDER: MainLayerId[] = [
  'handdrawn', 'frickx', 'villaret', 'ferraris',
  'gereduceerd', 'popp', 'vandermaelen', 'primitief',
  'ngi1873', 'ngi1904',
];

export const MAIN_LAYER_LABELS: Record<string, string> = {
  ngi1904:      'NGI Basemap 1904',
  ngi1873:      'NGI Basemap 1873',
  popp:         'Poppkaart',
  ferraris:     'Ferraris',
  villaret:     'Villaret',
  frickx:       'Frickx',
  vandermaelen: 'Vandermaelen',
  primitief:    'Primitief kadaster',
  gereduceerd:  'Gereduceerd kadaster',
  handdrawn:    'Hand drawn collection',
};

export const MAIN_LAYER_SHORT_LABELS: Record<string, string> = {
  ngi1904:      'N4',
  ngi1873:      'N7',
  popp:         'PK',
  ferraris:     'FE',
  villaret:     'VI',
  frickx:       'FX',
  vandermaelen: 'VM',
  primitief:    'PR',
  gereduceerd:  'GR',
  handdrawn:    'HD',
};

export const MAIN_LAYER_META: Record<string, { date: string; color: string }> = {
  ngi1904:      { date: '1904',      color: '#506b8f' },
  ngi1873:      { date: '1873',      color: '#4f7b66' },
  popp:         { date: '1842–1879', color: '#7a5c9e' },
  ferraris:     { date: '1771',      color: '#6aaa5a' },
  villaret:     { date: '1745–1748', color: '#3f7c85' },
  frickx:       { date: '1712',      color: '#9d7a43' },
  vandermaelen: { date: '1846',      color: '#c45000' },
  primitief:    { date: '1808–1834', color: '#c97a2e' },
  gereduceerd:  { date: '1847–1855', color: '#a0b020' },
  handdrawn:    { date: '19th c.',   color: '#888780' },
};

export const MAIN_LAYER_INFO: Record<string, string> = {
  ngi1904:      'Topographic NGI basemap from 1904, exposed as raster tile service.',
  ngi1873:      'Topographic NGI basemap from 1873, exposed as raster tile service.',
  popp:         'Popp cadastral atlas mosaic for Belgium, shown here as historical raster base map.',
  ferraris:     'Ferraris cabinet map of the Austrian Netherlands, georeferenced as historical raster base map.',
  villaret:     'Villaret map of the southern Low Countries, currently connected as WMS-backed raster layer.',
  frickx:       'Frickx map of the Low Countries, connected as historical raster base map.',
  vandermaelen: 'Vandermaelen topographic map of Belgium, connected as historical raster base map.',
  primitief:    'Primitief kadaster layer with warped IIIF sheets plus cadastral overlays.',
  gereduceerd:  'Gereduceerd kadaster layer with warped IIIF sheets plus cadastral overlays.',
  handdrawn:    'Hand-drawn historical map collection with warped IIIF sheets and related overlays.',
};

export const MAIN_LAYER_SOURCE: Record<string, { label: string; url: string }> = {
  ngi1904: {
    label: 'NGI raster tiles',
    url: 'https://wmts.ngi.be/arcgis/rest/services/seamless_carto__default__3857__450/MapServer/tile/{z}/{y}/{x}',
  },
  ngi1873: {
    label: 'NGI raster tiles',
    url: 'https://wmts.ngi.be/arcgis/rest/services/seamless_carto__default__3857__140/MapServer/tile/{z}/{y}/{x}',
  },
  popp: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=popp&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  ferraris: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ferraris&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  villaret: {
    label: 'Geopunt WMS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Villaret&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=TRUE&CRS=EPSG%3A3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256',
  },
  frickx: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=frickx&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  vandermaelen: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vandermaelen&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  primitief: {
    label: 'Compiled IIIF dataset',
    url: 'https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build/index.json',
  },
  gereduceerd: {
    label: 'Compiled IIIF dataset',
    url: 'https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build/index.json',
  },
  handdrawn: {
    label: 'Compiled IIIF dataset',
    url: 'https://raw.githubusercontent.com/GhentCDH/Artemis-RnD-Data/master/build/index.json',
  },
};

export const SUB_LAYER_DEFS: Record<string, { label: string; kind: SubLayerKind }> = {
  'ngi1904-wmts':           { label: 'Map',             kind: 'wmts'       },
  'ngi1873-wmts':           { label: 'Map',             kind: 'wmts'       },
  'popp-wmts':              { label: 'Map',             kind: 'wmts'       },
  'ferraris-wmts':          { label: 'WMTS',            kind: 'wmts'       },
  'ferraris-landusage':     { label: 'Land usage',           kind: 'wms'        },
  'ferraris-toponyms':      { label: 'Toponyms',             kind: 'searchable' },
  'villaret-wmts':          { label: 'Map',             kind: 'wmts'       },
  'frickx-wmts':            { label: 'Map',             kind: 'wmts'       },
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
  ngi1904:      ['ngi1904-wmts'],
  ngi1873:      ['ngi1873-wmts'],
  popp:         ['popp-wmts'],
  ferraris:     ['ferraris-wmts', 'ferraris-landusage', 'ferraris-toponyms'],
  villaret:     ['villaret-wmts'],
  frickx:       ['frickx-wmts'],
  vandermaelen: ['vandermaelen-wmts', 'vandermaelen-landusage', 'vandermaelen-toponyms'],
  primitief:    ['primitief-iiif', 'primitief-parcels', 'primitief-landusage'],
  gereduceerd:  ['gereduceerd-iiif', 'gereduceerd-parcels', 'gereduceerd-landusage'],
  handdrawn:    ['handdrawn-iiif', 'handdrawn-parcels', 'handdrawn-water'],
};

export function makeInitialMainLayerEnabled(): Record<string, boolean> {
  return {
    ngi1904: false,
    ngi1873: false,
    gereduceerd: false,
    popp: false,
    vandermaelen: false,
    primitief: false,
    ferraris: false,
    villaret: false,
    frickx: false,
    handdrawn: false,
  };
}

export function makeInitialSubLayerEnabled(): Record<string, boolean> {
  return {
    'ngi1904-wmts': false,
    'ngi1873-wmts': false,
    'popp-wmts': false,
    'ferraris-wmts': false,         'ferraris-landusage': false,    'ferraris-toponyms': false,
    'villaret-wmts': false,
    'frickx-wmts': false,
    'vandermaelen-wmts': false,     'vandermaelen-landusage': false, 'vandermaelen-toponyms': false,
    'primitief-iiif': false,   'primitief-parcels': false,   'primitief-landusage': false,
    'gereduceerd-iiif': false, 'gereduceerd-parcels': false, 'gereduceerd-landusage': false,
    'handdrawn-iiif': false,   'handdrawn-parcels': false,   'handdrawn-water': false,
  };
}
