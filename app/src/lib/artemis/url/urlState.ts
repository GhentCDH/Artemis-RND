// Persistent URL state — hash-based so it works with static hosting.
//
// Format:  #c=lng,lat,z&l=<code>&r=<code>&s=1&v=<manifest-ref>&p=l
//
//   c  — camera: lng (4dp), lat (4dp), zoom (1dp)
//   l  — left pane active layer (2-char code, see LAYER_CODE_TO_ID)
//   r  — right pane active layer (2-char code)
//   s  — split mode: "1" if split, omitted if single
//   v  — viewer manifest URL; dataset-relative URLs prefixed with "~"
//   p  — viewer pane: "l" for left, omitted for right (default)
//
// imageServiceUrl is intentionally NOT stored. IiifViewer fetches it from
// the manifest when the prop is empty, which handles all collection types.

export const LAYER_CODE_TO_ID: Record<string, string> = {
  hd: 'HanddrawnCollection',
  fr: 'Frickx',
  vi: 'Villaret',
  fe: 'Ferraris',
  pk: 'PrimitiefKadaster',
  va: 'Vandermaelen',
  gk: 'GereduceerdeKadaster',
  po: 'Popp',
  n3: 'NGI1873',
  n4: 'NGI1904',
};

export const LAYER_ID_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LAYER_CODE_TO_ID).map(([code, id]) => [id, code])
);

export interface UrlAppState {
  center?: { lng: number; lat: number; zoom: number };
  leftMainId?: string;
  rightMainId?: string;
  viewMode?: 'split';
  viewerManifestUrl?: string;
  viewerPane?: 'left' | 'right';
}

function encodeManifestRef(manifestUrl: string, datasetBaseUrl: string): string {
  const base = datasetBaseUrl.replace(/\/$/, '');
  if (base && manifestUrl.startsWith(base + '/')) {
    return '~' + manifestUrl.slice(base.length + 1);
  }
  return manifestUrl;
}

function decodeManifestRef(ref: string, datasetBaseUrl: string): string {
  if (ref.startsWith('~')) {
    const base = datasetBaseUrl.replace(/\/$/, '');
    return base + '/' + ref.slice(1);
  }
  return ref;
}

export function encodeAppState(state: UrlAppState, datasetBaseUrl = ''): string {
  const parts: string[] = [];

  if (state.center) {
    const { lng, lat, zoom } = state.center;
    parts.push(`c=${lng.toFixed(4)},${lat.toFixed(4)},${zoom.toFixed(1)}`);
  }
  if (state.leftMainId) {
    const code = LAYER_ID_TO_CODE[state.leftMainId];
    if (code) parts.push(`l=${code}`);
  }
  if (state.rightMainId) {
    const code = LAYER_ID_TO_CODE[state.rightMainId];
    if (code) parts.push(`r=${code}`);
  }
  if (state.viewMode === 'split') parts.push('s=1');
  if (state.viewerManifestUrl) {
    const ref = encodeManifestRef(state.viewerManifestUrl, datasetBaseUrl);
    parts.push(`v=${encodeURIComponent(ref)}`);
    if (state.viewerPane === 'left') parts.push('p=l');
  }

  return parts.join('&');
}

export function decodeAppState(hash: string, datasetBaseUrl = ''): UrlAppState {
  const paramStr = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!paramStr) return {};

  const params = new URLSearchParams(paramStr);

  let center: UrlAppState['center'];
  const cParam = params.get('c');
  if (cParam) {
    const parts = cParam.split(',');
    const lng = parseFloat(parts[0] ?? '');
    const lat = parseFloat(parts[1] ?? '');
    const zoom = parseFloat(parts[2] ?? '');
    if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(zoom)
        && zoom >= 0 && zoom <= 24) {
      center = { lng, lat, zoom };
    }
  }

  const lCode = params.get('l');
  const rCode = params.get('r');
  const vRaw = params.get('v');
  const pRaw = params.get('p');

  return {
    center,
    leftMainId: lCode ? LAYER_CODE_TO_ID[lCode] : undefined,
    rightMainId: rCode ? LAYER_CODE_TO_ID[rCode] : undefined,
    viewMode: params.get('s') === '1' ? 'split' : undefined,
    viewerManifestUrl: vRaw ? decodeManifestRef(vRaw, datasetBaseUrl) : undefined,
    viewerPane: pRaw === 'l' ? 'left' : vRaw ? 'right' : undefined,
  };
}
