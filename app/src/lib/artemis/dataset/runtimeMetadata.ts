export type RuntimeSiteLogo = {
  src: string;
  alt: string;
  href: string | null;
  label: string;
};

export type RuntimeTeamUnit = {
  unit: string;
  members: string[];
};

export type RuntimeTeamInstitution = {
  institution: string;
  units: RuntimeTeamUnit[];
};

export type RuntimeSiteMetadata = {
  title: string;
  info: string[];
  attribution: string;
  team: RuntimeTeamInstitution[];
  logos: RuntimeSiteLogo[];
};

export type RuntimeLayerMetadata = {
  title: string;
  info: string[];
};

type LoadRuntimeMetadataOptions = {
  staticBaseUrl: string;
  mainLayerOrder: string[];
  mainLayerLabels: Record<string, string>;
  mainLayerInfo: Record<string, string>;
  getLayerMetadataCandidates: (mainId: string) => string[];
};

function emptySiteMetadata(): RuntimeSiteMetadata {
  return {
    title: 'About Artemis',
    info: [],
    attribution: '',
    team: [],
    logos: [],
  };
}

async function fetchRuntimeJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    throw new Error(`Expected JSON but got HTML from ${url}`);
  }
  return JSON.parse(text) as T;
}

function normalizeParagraphList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizeTeamGroups(value: unknown): RuntimeTeamInstitution[] {
  if (!Array.isArray(value)) return [];
  const byInstitution: Record<string, RuntimeTeamUnit[]> = {};

  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const institution = typeof (entry as any).institution === 'string' ? (entry as any).institution.trim() : '';
    const unit = typeof (entry as any).unit === 'string' ? (entry as any).unit.trim() : '';
    const members = Array.isArray((entry as any).members)
      ? (entry as any).members
          .map((m: unknown) => (typeof m === 'string' ? m.trim() : ''))
          .filter(Boolean)
      : [];

    if (!institution || (!unit && members.length === 0)) return;
    if (!byInstitution[institution]) byInstitution[institution] = [];
    byInstitution[institution].push({ unit, members });
  });

  return Object.entries(byInstitution).map(([institution, units]) => ({
    institution,
    units,
  }));
}

function normalizeSiteLogos(value: unknown, repoRoot: string): RuntimeSiteLogo[] {
  if (!Array.isArray(value)) return [];

  function resolveSrc(raw: string): string {
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (repoRoot) return `${repoRoot}/${raw.replace(/^\//, '')}`;
    return raw;
  }

  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      const src = resolveSrc(entry.trim());
      return src ? [{ src, alt: '', href: null, label: src }] : [];
    }
    if (!entry || typeof entry !== 'object') return [];
    const rawSrc = typeof (entry as any).src === 'string' ? (entry as any).src.trim() : '';
    if (!rawSrc) return [];
    const src = resolveSrc(rawSrc);
    const alt = typeof (entry as any).alt === 'string' ? (entry as any).alt.trim() : '';
    const hrefRaw = typeof (entry as any).href === 'string' ? (entry as any).href.trim() : '';
    const label =
      (typeof (entry as any).label === 'string' && (entry as any).label.trim()) ||
      (typeof (entry as any).name === 'string' && (entry as any).name.trim()) ||
      alt ||
      rawSrc;
    return [{ src, alt, href: hrefRaw || null, label }];
  });
}

function normalizeSiteMetadata(raw: unknown, repoRoot = ''): RuntimeSiteMetadata {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'About Artemis',
    info: normalizeParagraphList(data.info),
    attribution: typeof data.attribution === 'string' ? data.attribution.trim() : '',
    team: normalizeTeamGroups(data.team),
    logos: normalizeSiteLogos(data.logos, repoRoot),
  };
}

function normalizeLayerMetadataMap(raw: unknown): Record<string, RuntimeLayerMetadata> {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(data).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object') return [];
      const title = typeof (value as any).title === 'string' && (value as any).title.trim()
        ? (value as any).title.trim()
        : key;
      const info = normalizeParagraphList((value as any).info);
      return [[key, { title, info }]];
    })
  );
}

export async function loadRuntimeMetadata({
  staticBaseUrl,
  mainLayerOrder,
  mainLayerLabels,
  mainLayerInfo,
  getLayerMetadataCandidates,
}: LoadRuntimeMetadataOptions): Promise<{
  siteMetadata: RuntimeSiteMetadata;
  layerMetadataByMainId: Record<string, RuntimeLayerMetadata>;
}> {
  const fallbackLayerMetadata = (mainId: string): RuntimeLayerMetadata => ({
    title: mainLayerLabels[mainId] ?? mainId,
    info: mainLayerInfo[mainId] ? [mainLayerInfo[mainId]] : [],
  });

  const resolveLayerMetadataByMainId = (rawByKey: Record<string, RuntimeLayerMetadata>) =>
    Object.fromEntries(
      mainLayerOrder.map((mainId) => {
        const candidates = getLayerMetadataCandidates(mainId);
        const resolved = candidates.map((key) => rawByKey[key]).find(Boolean);
        return [mainId, resolved ?? fallbackLayerMetadata(mainId)];
      })
    );

  if (!staticBaseUrl) {
    return {
      siteMetadata: emptySiteMetadata(),
      layerMetadataByMainId: resolveLayerMetadataByMainId({}),
    };
  }

  const siteJsonUrl = `${staticBaseUrl}/site.json`;
  const layersJsonUrl = `${staticBaseUrl}/layers.json?t=${Date.now()}`;
  const [siteResult, layerResult] = await Promise.allSettled([
    fetchRuntimeJson<unknown>(siteJsonUrl),
    fetchRuntimeJson<unknown>(layersJsonUrl),
  ]);

  const repoRoot = staticBaseUrl.replace(/\/static\/?$/i, '');
  const siteMetadata =
    siteResult.status === 'fulfilled'
      ? normalizeSiteMetadata(siteResult.value, repoRoot)
      : emptySiteMetadata();
  const rawLayers = layerResult.status === 'fulfilled' ? normalizeLayerMetadataMap(layerResult.value) : {};

  return {
    siteMetadata,
    layerMetadataByMainId: resolveLayerMetadataByMainId(rawLayers),
  };
}
