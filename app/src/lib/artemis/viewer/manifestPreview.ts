export type IiifManifestPreview = {
  title: string;
  imageServiceUrl: string;
  previewUrl: string;
};

function firstDefinedString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseLabel(label: unknown): string {
  if (typeof label === 'string') return label.trim();
  if (!label || typeof label !== 'object') return '';

  const maybeNone = (label as Record<string, unknown>).none;
  if (Array.isArray(maybeNone) && typeof maybeNone[0] === 'string') {
    return maybeNone[0].trim();
  }

  for (const value of Object.values(label as Record<string, unknown>)) {
    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0].trim();
    }
  }

  return '';
}

function pickThumbnailUrl(manifest: any): string {
  const thumb = manifest?.thumbnail;
  if (Array.isArray(thumb)) {
    return firstDefinedString(thumb[0]?.id, thumb[0]?.['@id']);
  }
  return firstDefinedString(thumb?.id, thumb?.['@id']);
}

export async function extractImageServiceFromManifest(manifestUrl: string): Promise<string> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Manifest fetch failed (HTTP ${res.status})`);
  const m = await res.json();

  const img0 = m?.sequences?.[0]?.canvases?.[0]?.images?.[0];
  if (img0) {
    const svc = img0?.resource?.service;
    if (svc) return firstDefinedString(svc['@id'], svc.id);
    return firstDefinedString(img0?.resource?.['@id']);
  }

  const body = m?.items?.[0]?.items?.[0]?.items?.[0]?.body;
  if (body) {
    const svcEntry = body?.service;
    if (svcEntry) {
      const svc = Array.isArray(svcEntry) ? svcEntry[0] : svcEntry;
      const serviceUrl = firstDefinedString(svc?.id, svc?.['@id']);
      if (serviceUrl) return serviceUrl;
    }
    return firstDefinedString(body.id, body['@id']);
  }

  throw new Error('Could not locate image service in manifest');
}

export async function loadManifestPreview(manifestUrl: string): Promise<IiifManifestPreview> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Manifest fetch failed (HTTP ${res.status})`);
  const manifest = await res.json();

  const title = parseLabel(manifest?.label);
  const imageServiceUrl = await (async () => {
    const img0 = manifest?.sequences?.[0]?.canvases?.[0]?.images?.[0];
    if (img0) {
      const svc = img0?.resource?.service;
      const serviceUrl = firstDefinedString(svc?.['@id'], svc?.id, img0?.resource?.['@id']);
      if (serviceUrl) return serviceUrl;
    }

    const body = manifest?.items?.[0]?.items?.[0]?.items?.[0]?.body;
    if (body) {
      const svcEntry = body?.service;
      const svc = Array.isArray(svcEntry) ? svcEntry[0] : svcEntry;
      const serviceUrl = firstDefinedString(svc?.id, svc?.['@id'], body?.id, body?.['@id']);
      if (serviceUrl) return serviceUrl;
    }

    throw new Error('Could not locate image service in manifest');
  })();

  const previewUrl = pickThumbnailUrl(manifest) || `${imageServiceUrl.replace(/\/$/, '')}/full/400,/0/default.jpg`;
  return { title, imageServiceUrl, previewUrl };
}
