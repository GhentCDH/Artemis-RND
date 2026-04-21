// Layer configuration for the historical map era tree.
// Defines all main layers (eras), their sub-layers, labels, and visual metadata.
import { ngiTileUrl } from './ngi';

export type MainLayerId =
  | 'NGI1904'
  | 'NGI1873'
  | 'GereduceerdeKadaster'
  | 'Popp'
  | 'Vandermaelen'
  | 'PrimitiefKadaster'
  | 'Ferraris'
  | 'Villaret'
  | 'Frickx'
  | 'HanddrawnCollection';
export type SubLayerKind = 'iiif' | 'geojson' | 'wmts' | 'wms' | 'searchable';

// Order is tuned for overlap windows. Gereduceerd should stay above Popp and
// Vandermaelen in the 1847–1855 zone; later NGI basemaps can sit below older
// more detailed cadastral layers where ranges overlap.
export const MAIN_LAYER_ORDER: MainLayerId[] = [
  'HanddrawnCollection', 'Frickx', 'Villaret', 'Ferraris',
  'GereduceerdeKadaster', 'Popp', 'Vandermaelen', 'PrimitiefKadaster',
  'NGI1873', 'NGI1904',
];

export const MAIN_LAYER_LABELS: Record<string, string> = {
  NGI1904:      'NGI Basemap 1904',
  NGI1873:      'NGI Basemap 1873',
  Popp:         'Poppkaart',
  Ferraris:     'Ferraris',
  Villaret:     'Villaret',
  Frickx:       'Frickx',
  Vandermaelen: 'Vandermaelen',
  PrimitiefKadaster:    'Primitief kadaster',
  GereduceerdeKadaster:  'Gereduceerd kadaster',
  HanddrawnCollection:    'Hand drawn collection',
};

export const MAIN_LAYER_SHORT_LABELS: Record<string, string> = {
  NGI1904:      'N4',
  NGI1873:      'N7',
  Popp:         'PK',
  Ferraris:     'FE',
  Villaret:     'VI',
  Frickx:       'FX',
  Vandermaelen: 'VM',
  PrimitiefKadaster:    'PR',
  GereduceerdeKadaster:  'GR',
  HanddrawnCollection:    'HD',
};

export const MAIN_LAYER_META: Record<string, { date: string; color: string }> = {
  NGI1904:      { date: '1904',      color: '#506b8f' },
  NGI1873:      { date: '1873',      color: '#4f7b66' },
  Popp:         { date: '1842–1879', color: '#7a5c9e' },
  Ferraris:     { date: '1771',      color: '#6aaa5a' },
  Villaret:     { date: '1745–1748', color: '#3f7c85' },
  Frickx:       { date: '1712',      color: '#9d7a43' },
  Vandermaelen: { date: '1846',      color: '#c45000' },
  PrimitiefKadaster:    { date: '1808–1834', color: '#c97a2e' },
  GereduceerdeKadaster:  { date: '1847–1855', color: '#a0b020' },
  HanddrawnCollection:    { date: '19th c.',   color: '#888780' },
};

export const MAIN_LAYER_INFO: Record<string, string> = {
  NGI1904:      'Topographic NGI basemap from 1904, exposed as raster tile service.',
  NGI1873:      'Topographic NGI basemap from 1873, exposed as raster tile service.',
  Popp:         'Popp cadastral atlas mosaic for Belgium, shown here as historical raster base map.',
  Ferraris:     'Ferraris cabinet map of the Austrian Netherlands, georeferenced as historical raster base map.',
  Villaret:     'Villaret map of the southern Low Countries, currently connected as WMS-backed raster layer.',
  Frickx:       'Frickx map of the Low Countries, connected as historical raster base map.',
  Vandermaelen: 'Vandermaelen topographic map of Belgium, connected as historical raster base map.',
  PrimitiefKadaster:    'Primitief kadaster layer with warped IIIF sheets plus cadastral overlays.',
  GereduceerdeKadaster:  'Gereduceerd kadaster layer with warped IIIF sheets plus cadastral overlays.',
  HanddrawnCollection:    'Hand-drawn historical map collection with warped IIIF sheets and related overlays.',
};

export const MAIN_LAYER_SOURCE: Record<string, { label: string; url: string }> = {
  NGI1904: {
    label: 'NGI raster tiles',
    url: ngiTileUrl('/arcgis/rest/services/seamless_carto__default__3857__450/MapServer'),
  },
  NGI1873: {
    label: 'NGI raster tiles',
    url: ngiTileUrl('/arcgis/rest/services/seamless_carto__default__3857__140/MapServer'),
  },
  Popp: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=popp&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  Ferraris: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ferraris&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  Villaret: {
    label: 'Geopunt WMS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Villaret&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=TRUE&CRS=EPSG%3A3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256',
  },
  Frickx: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=frickx&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  Vandermaelen: {
    label: 'Geopunt WMTS',
    url: 'https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vandermaelen&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  },
  PrimitiefKadaster: {
    label: 'Compiled IIIF dataset',
    url: 'https://raw.githubusercontent.com/ghentcdh/Artemis-RnD-Data/dev/build/index.json',
  },
  GereduceerdeKadaster: {
    label: 'Compiled IIIF dataset',
    url: 'https://raw.githubusercontent.com/ghentcdh/Artemis-RnD-Data/dev/build/index.json',
  },
  HanddrawnCollection: {
    label: 'Compiled IIIF dataset',
    url: 'https://raw.githubusercontent.com/ghentcdh/Artemis-RnD-Data/dev/build/index.json',
  },
};

export const SUB_LAYER_DEFS: Record<string, { label: string; kind: SubLayerKind }> = {
  'NGI1904-wmts':           { label: 'Map',             kind: 'wmts'       },
  'NGI1873-wmts':           { label: 'Map',             kind: 'wmts'       },
  'Popp-wmts':              { label: 'Map',             kind: 'wmts'       },
  'Ferraris-wmts':          { label: 'WMTS',            kind: 'wmts'       },
  'Ferraris-landusage':     { label: 'Land usage',           kind: 'wms'        },
  'Villaret-wmts':          { label: 'Map',             kind: 'wmts'       },
  'Frickx-wmts':            { label: 'Map',             kind: 'wmts'       },
  'Vandermaelen-wmts':      { label: 'WMTS',            kind: 'wmts'       },
  'Vandermaelen-landusage': { label: 'Land usage',           kind: 'wms'        },
  'PrimitiefKadaster-iiif':         { label: 'IIIF collection',      kind: 'iiif'       },
  'PrimitiefKadaster-parcels':      { label: 'Parcels',              kind: 'geojson'    },
  'GereduceerdeKadaster-iiif':       { label: 'IIIF collection',      kind: 'iiif'       },
  'HanddrawnCollection-iiif':         { label: 'IIIF collection',      kind: 'iiif'       },
  'HanddrawnCollection-parcels':      { label: 'Parcels',              kind: 'geojson'    },
};


export const MAIN_LAYER_SUBS: Record<string, string[]> = {
  NGI1904:      ['NGI1904-wmts'],
  NGI1873:      ['NGI1873-wmts'],
  Popp:         ['Popp-wmts'],
  Ferraris:     ['Ferraris-wmts', 'Ferraris-landusage'],
  Villaret:     ['Villaret-wmts'],
  Frickx:       ['Frickx-wmts'],
  Vandermaelen: ['Vandermaelen-wmts', 'Vandermaelen-landusage'],
  PrimitiefKadaster:    ['PrimitiefKadaster-iiif', 'PrimitiefKadaster-parcels'],
  GereduceerdeKadaster:  ['GereduceerdeKadaster-iiif'],
  HanddrawnCollection:    ['HanddrawnCollection-iiif', 'HanddrawnCollection-parcels'],
};

export function makeInitialMainLayerEnabled(): Record<string, boolean> {
  return {
    NGI1904: false,
    NGI1873: false,
    GereduceerdeKadaster: false,
    Popp: false,
    Vandermaelen: false,
    PrimitiefKadaster: false,
    Ferraris: false,
    Villaret: false,
    Frickx: false,
    HanddrawnCollection: false,
  };
}

export function makeInitialSubLayerEnabled(): Record<string, boolean> {
  return {
    'NGI1904-wmts': false,
    'NGI1873-wmts': false,
    'Popp-wmts': false,
    'Ferraris-wmts': false,         'Ferraris-landusage': false,    'Ferraris-toponyms': false,
    'Villaret-wmts': false,
    'Frickx-wmts': false,
    'Vandermaelen-wmts': false,     'Vandermaelen-landusage': false, 'Vandermaelen-toponyms': false,
    'PrimitiefKadaster-iiif': false,   'PrimitiefKadaster-parcels': false,   'PrimitiefKadaster-landusage': false,
    'GereduceerdeKadaster-iiif': false, 'GereduceerdeKadaster-parcels': false, 'GereduceerdeKadaster-landusage': false,
    'HanddrawnCollection-iiif': false,   'HanddrawnCollection-parcels': false,   'HanddrawnCollection-water': false,
  };
}
