// src/lib/artemis/iiif/crawl.ts

type AnyJson = any;

function isObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object";
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

/**
 * Heuristic: determine whether a fetched JSON looks like a IIIF Collection.
 * Supports:
 * - Presentation 2: sc:Collection with "manifests"/"collections"
 * - Presentation 3: Collection with "items"
 */
function looksLikeCollection(json: AnyJson): boolean {
  if (!isObject(json)) return false;

  const t = asString(json.type) ?? asString(json["@type"]);
  if (t && (t.includes("Collection") || t === "sc:Collection")) return true;

  if (Array.isArray(json.items)) return true;
  if (Array.isArray(json.manifests)) return true;

  return false;
}

/**
 * Extract manifest URLs from a Collection JSON (P2 or P3).
 * Also returns nested collection URLs to recurse into.
 */
function extractFromCollection(json: AnyJson): { manifests: string[]; collections: string[] } {
  const manifests: string[] = [];
  const collections: string[] = [];

  // Presentation 2: { manifests: [{ "@id": "..." }], collections: [{ "@id": "..." }] }
  if (Array.isArray(json.manifests)) {
    for (const m of json.manifests) {
      const id = asString(m?.["@id"]) ?? asString(m?.id);
      if (id) manifests.push(id);
    }
  }

  if (Array.isArray(json.collections)) {
    for (const c of json.collections) {
      const id = asString(c?.["@id"]) ?? asString(c?.id);
      if (id) collections.push(id);
    }
  }

  // Presentation 3: { items: [{ type: "Manifest"|"Collection", id: "..." }, ...] }
  if (Array.isArray(json.items)) {
    for (const it of json.items) {
      const t = asString(it?.type) ?? asString(it?.["@type"]);
      const id = asString(it?.id) ?? asString(it?.["@id"]);
      if (!id) continue;

      if (t && (t === "Manifest" || t === "sc:Manifest")) manifests.push(id);
      else if (t && (t === "Collection" || t === "sc:Collection")) collections.push(id);
      else {
        // If type is missing/odd, guess by URL shape
        if (id.includes("/manifests/")) manifests.push(id);
        else collections.push(id);
      }
    }
  }

  return { manifests: uniq(manifests), collections: uniq(collections) };
}

/**
 * Fetch JSON with a sane failure mode.
 */
async function fetchJson(url: string): Promise<AnyJson> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.json();
}

export type CrawlProgress = {
  fetchedCollections: number;
  foundManifests: number;
};

/**
 * Crawl a IIIF collection URL and return all manifest URLs found (deduped).
 * Recurses into nested collections.
 */
export async function crawlCollectionForManifests(
  collectionUrl: string,
  onProgress?: (p: CrawlProgress) => void,
  maxCollections = 2000
): Promise<string[]> {
  const visited = new Set<string>();
  const out = new Set<string>();

  const queue: string[] = [collectionUrl];

  let fetchedCollections = 0;

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;

    visited.add(url);

    const json = await fetchJson(url);

    if (!looksLikeCollection(json)) {
      // If someone pasted a manifest URL here, treat it as a manifest and move on.
      out.add(url);
      onProgress?.({ fetchedCollections, foundManifests: out.size });
      continue;
    }

    fetchedCollections += 1;
    if (fetchedCollections > maxCollections) {
      throw new Error(`Aborted: too many collections (>${maxCollections})`);
    }

    const { manifests, collections } = extractFromCollection(json);

    for (const m of manifests) out.add(m);
    for (const c of collections) queue.push(c);

    onProgress?.({ fetchedCollections, foundManifests: out.size });
  }

  return Array.from(out);
}

/**
 * Expand mixed inputs (manifest URLs and/or collection URLs) into a manifest URL list.
 * Rule: if a URL looks like a collection after fetch, crawl it; otherwise treat as manifest.
 */
export async function expandInputsToManifests(
  inputs: string[],
  onProgress?: (msg: string) => void
): Promise<string[]> {
  const all: string[] = [];

  for (const url of inputs) {
    onProgress?.(`Inspecting: ${url}`);

    let json: AnyJson;
    try {
      json = await fetchJson(url);
    } catch {
      // If it fails to fetch as JSON, still allow it through (maybe it’s a manifest endpoint with CORS weirdness)
      all.push(url);
      continue;
    }

    if (looksLikeCollection(json)) {
      onProgress?.(`Crawling collection: ${url}`);
      const manifests = await crawlCollectionForManifests(url, (p) => {
        onProgress?.(`Crawling… collections=${p.fetchedCollections} manifests=${p.foundManifests}`);
      });
      all.push(...manifests);
    } else {
      all.push(url);
    }
  }

  return uniq(all);
}