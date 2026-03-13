// Compiled index loading with page-level cache.
// Fetched once per datasetBaseUrl; reset via resetCompiledIndexCache when the URL changes.

import type { CompiledIndex, CompiledRunnerConfig } from "$lib/artemis/types";
import { joinUrl, fetchJson } from "$lib/artemis/utils";

let cached: CompiledIndex | null = null;

export function resetCompiledIndexCache() {
  cached = null;
}

export async function loadCompiledIndex(cfg: CompiledRunnerConfig): Promise<CompiledIndex> {
  if (cached) return cached;
  const url = joinUrl(cfg.datasetBaseUrl, cfg.indexPath ?? "index.json");
  cached = await fetchJson<CompiledIndex>(url, cfg.fetchTimeoutMs ?? 30000);
  return cached;
}
