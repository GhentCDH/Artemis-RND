export type IiifManifestPreview = {
  title: string;
  imageServiceUrl: string;
  previewUrl: string;
};

export type IiifManifestMetadataField = {
  label: string;
  value: string;
};

export type IiifManifestDetails = IiifManifestPreview & {
  summary: string;
  homepageUrl: string;
  rights: string;
  provider: string;
  requiredStatement: IiifManifestMetadataField | null;
  metadata: IiifManifestMetadataField[];
  canvasWidth: number;
  canvasHeight: number;
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

function stringifyIiifText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyIiifText(entry))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (!value || typeof value !== 'object') return '';

  const asRecord = value as Record<string, unknown>;
  if (typeof asRecord['@value'] === 'string') return asRecord['@value'].trim();

  const byLabel = parseLabel(value);
  if (byLabel) return byLabel;

  return Object.values(asRecord)
    .map((entry) => stringifyIiifText(entry))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function parseHomepageUrl(manifest: any): string {
  const homepage = manifest?.homepage;
  if (Array.isArray(homepage)) {
    return firstDefinedString(homepage[0]?.id, homepage[0]?.['@id']);
  }
  return firstDefinedString(homepage?.id, homepage?.['@id']);
}

function parseProvider(manifest: any): string {
  const provider = manifest?.provider;
  const list = Array.isArray(provider) ? provider : provider ? [provider] : [];
  return list
    .map((entry) => parseLabel(entry?.label ?? entry))
    .filter(Boolean)
    .join(' · ');
}

function parseMetadataFields(manifest: any): IiifManifestMetadataField[] {
  const entries = Array.isArray(manifest?.metadata) ? manifest.metadata : [];
  return entries
    .map((entry: any) => {
      const label = parseLabel(entry?.label);
      const value = stringifyIiifText(entry?.value);
      if (!label || !value) return null;
      return { label, value };
    })
    .filter((entry: IiifManifestMetadataField | null): entry is IiifManifestMetadataField => Boolean(entry));
}

function parseRequiredStatement(manifest: any): IiifManifestMetadataField | null {
  const statement = manifest?.requiredStatement;
  if (!statement) return null;

  const label = parseLabel(statement?.label) || 'Attribution';
  const value = stringifyIiifText(statement?.value);
  if (!value) return null;
  return { label, value };
}

function parsePresentationApiVersion(manifest: any): string {
  const context = manifest?.['@context'];
  const list = Array.isArray(context) ? context : context ? [context] : [];
  const joined = list.map((entry) => String(entry)).join(' ');
  if (joined.includes('/presentation/3/')) return 'IIIF Presentation 3';
  if (joined.includes('/presentation/2/') || joined.includes('/presentation/2')) return 'IIIF Presentation 2';
  if (joined.includes('/presentation/1/')) return 'IIIF Presentation 1';
  return 'IIIF';
}

function parseCanvasSummary(manifest: any): IiifManifestMetadataField[] {
  const v2Canvases = Array.isArray(manifest?.sequences?.[0]?.canvases) ? manifest.sequences[0].canvases : [];
  const v3Canvases = Array.isArray(manifest?.items) ? manifest.items : [];
  const canvases = v2Canvases.length > 0 ? v2Canvases : v3Canvases;
  if (canvases.length === 0) return [];

  const firstCanvas = canvases[0];
  const entries: IiifManifestMetadataField[] = [
    { label: 'Canvas count', value: String(canvases.length) },
  ];

  const firstLabel = parseLabel(firstCanvas?.label);
  if (firstLabel) {
    entries.push({
      label: canvases.length > 1 ? 'First canvas' : 'Canvas',
      value: firstLabel,
    });
  }

  const width = firstCanvas?.width;
  const height = firstCanvas?.height;
  if (Number.isFinite(width) && Number.isFinite(height)) {
    entries.push({
      label: 'Dimensions',
      value: `${width} × ${height}px`,
    });
  }

  return entries;
}

function parseCanvasDimensions(manifest: any): { width: number; height: number } {
  const v2Canvases = Array.isArray(manifest?.sequences?.[0]?.canvases) ? manifest.sequences[0].canvases : [];
  const v3Canvases = Array.isArray(manifest?.items) ? manifest.items : [];
  const canvases = v2Canvases.length > 0 ? v2Canvases : v3Canvases;
  const firstCanvas = canvases[0];
  const width = Number(firstCanvas?.width);
  const height = Number(firstCanvas?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
  };
}

function extractImageServiceFromJson(manifest: any): string {
  const img0 = manifest?.sequences?.[0]?.canvases?.[0]?.images?.[0];
  if (img0) {
    const svc = img0?.resource?.service;
    if (svc) return firstDefinedString(svc['@id'], svc.id);
    return firstDefinedString(img0?.resource?.['@id']);
  }

  const body = manifest?.items?.[0]?.items?.[0]?.items?.[0]?.body;
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
  return extractImageServiceFromJson(m);
}

export async function loadManifestPreview(manifestUrl: string): Promise<IiifManifestPreview> {
  const details = await loadManifestDetails(manifestUrl);
  return {
    title: details.title,
    imageServiceUrl: details.imageServiceUrl,
    previewUrl: details.previewUrl,
  };
}

export async function loadManifestDetails(manifestUrl: string): Promise<IiifManifestDetails> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Manifest fetch failed (HTTP ${res.status})`);
  const manifest = await res.json();

  const title = parseLabel(manifest?.label);
  const imageServiceUrl = extractImageServiceFromJson(manifest);

  const previewUrl = pickThumbnailUrl(manifest) || `${imageServiceUrl.replace(/\/$/, '')}/full/400,/0/default.jpg`;
  const metadata = parseMetadataFields(manifest);
  const canvasDimensions = parseCanvasDimensions(manifest);
  const fallbackMetadata: IiifManifestMetadataField[] = [
    { label: 'Manifest type', value: parsePresentationApiVersion(manifest) },
    ...parseCanvasSummary(manifest),
    { label: 'Manifest URL', value: firstDefinedString(manifest?.id, manifest?.['@id'], manifestUrl) },
  ];

  return {
    title,
    imageServiceUrl,
    previewUrl,
    summary: stringifyIiifText(manifest?.summary),
    homepageUrl: parseHomepageUrl(manifest),
    rights: firstDefinedString(manifest?.rights),
    provider: parseProvider(manifest),
    requiredStatement: parseRequiredStatement(manifest),
    metadata: metadata.length > 0 ? metadata : fallbackMetadata,
    canvasWidth: canvasDimensions.width,
    canvasHeight: canvasDimensions.height,
  };
}
