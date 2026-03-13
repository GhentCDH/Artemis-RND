// IIIF tile cache — shared across all layers for the page lifetime.
// Prevents redundant IIIF tile fetches when the same image resource
// is requested by multiple Allmaps layers.

const cache = new Map<string, Promise<ArrayBuffer>>();
let hits = 0;
let misses = 0;

export function getIiifCacheStats() {
  return { size: cache.size, hits, misses };
}

export function cachedFetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string" ? input
    : input instanceof URL ? input.toString()
    : (input as Request).url;

  if (!cache.has(url)) {
    misses++;
    cache.set(
      url,
      fetch(input, init)
        .then((r) => {
          if (!r.ok) { cache.delete(url); throw new Error(`HTTP ${r.status}`); }
          return r.arrayBuffer();
        })
        .catch((err) => { cache.delete(url); throw err; })
    );
  } else {
    hits++;
  }

  return cache.get(url)!.then((buf) => new Response(buf));
}
