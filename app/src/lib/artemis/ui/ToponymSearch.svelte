<!-- Floating search panel (top-center). Handles toponym + manifest search internally;
     dispatches events for map-level actions (fly-to, layer activation). -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { normalizeSearchText, scoreText } from '$lib/artemis/search';
  import { MAIN_LAYER_META, MAIN_LAYER_LABELS } from '$lib/artemis/layerConfig';
  import type { ToponymIndexItem, ManifestSearchItem } from '$lib/artemis/types';

  export let toponymIndex: ToponymIndexItem[] = [];
  export let manifestSearchIndex: ManifestSearchItem[] = [];
  export let loading = false;
  export let error: string | null = null;

  const dispatch = createEventDispatcher<{
    'fly-to-toponym': ToponymIndexItem;
    'manifest-click': ManifestSearchItem;
  }>();

  const MAX_RESULTS = 8;

  let query = '';
  let locked = false;
  let firstFocusSeen = false;
  let suggestions: ToponymIndexItem[] = [];
  let toponymResults: Array<ToponymIndexItem & { score: number }> = [];
  let manifestResults: Array<ManifestSearchItem & { score: number }> = [];

  function findMainId(mapName: string): string | undefined {
    const norm = mapName.trim().toLowerCase();
    for (const [id, label] of Object.entries(MAIN_LAYER_LABELS)) {
      if (label.toLowerCase() === norm) return id;
    }
    for (const [id, label] of Object.entries(MAIN_LAYER_LABELS)) {
      if (norm.includes(id) || label.toLowerCase().includes(norm)) return id;
    }
    return undefined;
  }

  function updateResults() {
    const raw = query.trim();
    if (!raw) { toponymResults = []; manifestResults = []; return; }
    const norm = normalizeSearchText(raw);
    if (!norm) { toponymResults = []; manifestResults = []; return; }

    toponymResults = toponymIndex
      .map(item => {
        const n = item.textNormalized?.trim() || normalizeSearchText(item.text ?? '');
        return { ...item, score: scoreText(item.text ?? '', n, raw, norm) };
      })
      .filter(r => r.score >= 0)
      .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text) || a.sourceFile.localeCompare(b.sourceFile))
      .slice(0, MAX_RESULTS);

    manifestResults = manifestSearchIndex
      .map(item => ({ ...item, score: scoreText(item.text, item.textNormalized, raw, norm) }))
      .filter(r => r.score >= 0)
      .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
      .slice(0, MAX_RESULTS);
  }

  function pickSuggestions(count = 3) {
    if (toponymIndex.length < 1) { suggestions = []; return; }
    const byText = new Map<string, ToponymIndexItem>();
    for (const item of toponymIndex) {
      const key = item.textNormalized?.trim() || normalizeSearchText(item.text);
      if (key && !byText.has(key)) byText.set(key, item);
    }
    const pool = Array.from(byText.values());
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    suggestions = pool.slice(0, Math.min(count, pool.length));
  }

  function onFocus() {
    if (firstFocusSeen) return;
    firstFocusSeen = true;
    pickSuggestions(3);
  }

  function selectToponym(item: ToponymIndexItem) {
    query = item.text;
    locked = true;
    dispatch('fly-to-toponym', item);
  }

  function selectManifest(result: ManifestSearchItem & { score: number }) {
    query = result.text;
    locked = true;
    dispatch('manifest-click', result);
  }

  $: { query; toponymIndex; manifestSearchIndex; updateResults(); }
  $: if (toponymIndex.length > 0 && firstFocusSeen && query === '') pickSuggestions(3);
</script>

<section class="toponym-search-panel">
  <div class="toponym-search-row">
    <input
      type="search"
      class="toponym-search-input"
      placeholder="Search manifests and toponyms..."
      bind:value={query}
      on:input={() => (locked = false)}
      on:focus={onFocus}
      spellcheck="false"
    />
    {#if loading}
      <span class="toponym-search-status">Loading…</span>
    {/if}
  </div>

  {#if error}
    <div class="toponym-search-error">{error}</div>
  {/if}

  {#if firstFocusSeen && query.trim() === '' && suggestions.length > 0}
    <div class="toponym-suggestions">
      <div class="toponym-suggestions-title">Try one of these</div>
      <div class="toponym-suggestion-list">
        {#each suggestions as s (s.id)}
          {@const mainId = findMainId(s.mapName)}
          {@const color = mainId ? MAIN_LAYER_META[mainId]?.color : undefined}
          <button type="button" class="toponym-suggestion" on:click={() => (query = s.text)}>
            {#if color}<span class="result-color-dot" style="background:{color}"></span>{/if}
            <span class="toponym-text">{s.text}</span>
            <span class="toponym-meta">{s.mapName}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if !locked && query.trim() && (manifestResults.length > 0 || toponymResults.length > 0)}
    <div class="toponym-results" role="listbox" aria-label="Search results">
      {#if manifestResults.length > 0}
        <div class="result-group-title">IIIF manifests</div>
        {#each manifestResults as result (result.id)}
          {@const mainId = findMainId(result.mapName)}
          {@const color = mainId ? MAIN_LAYER_META[mainId]?.color : undefined}
          <button type="button" class="toponym-result" on:click={() => selectManifest(result)}>
            {#if color}<span class="result-color-dot" style="background:{color}"></span>{/if}
            <span class="toponym-text">{result.text}</span>
            <span class="toponym-meta">IIIF · {result.mapName}</span>
          </button>
        {/each}
      {/if}
      {#if toponymResults.length > 0}
        <div class="result-group-title">Toponyms</div>
        {#each toponymResults as result (result.id)}
          {@const mainId = findMainId(result.mapName)}
          {@const color = mainId ? MAIN_LAYER_META[mainId]?.color : undefined}
          <button type="button" class="toponym-result" on:click={() => selectToponym(result)}>
            {#if color}<span class="result-color-dot" style="background:{color}"></span>{/if}
            <span class="toponym-text">{result.text}</span>
            <span class="toponym-meta">{result.mapName}</span>
          </button>
        {/each}
      {/if}
    </div>
  {:else if !locked && query.trim() && !loading && !error}
    <div class="toponym-search-empty">No matching manifests or toponyms.</div>
  {/if}
</section>

<style>
  .toponym-search-panel {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    width: min(560px, calc(100vw - 28px));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toponym-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0.5px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: var(--panel-bg);
    box-shadow: var(--shadow-floating-ui);
  }

  .toponym-search-input {
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0;
    font-size: 14px;
    color: var(--text-primary);
    flex: 1;
    font-family: var(--font-ui);
  }

  .toponym-search-input::placeholder { color: var(--text-muted); }

  .toponym-search-status {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .toponym-results,
  .toponym-suggestions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 0.5px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: var(--panel-bg);
    box-shadow: var(--shadow-floating-ui);
  }

  .toponym-suggestions { gap: 6px; padding: 8px; }

  .toponym-suggestions-title {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 700;
  }

  .toponym-suggestion-list { display: grid; gap: 4px; }

  .result-group-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    padding: 4px 6px 2px;
  }

  .toponym-suggestion,
  .toponym-result {
    border: 0;
    background: var(--result-bg);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
  }

  .toponym-suggestion { padding: 7px 9px; }
  .toponym-suggestion:hover, .toponym-result:hover { background: var(--result-hover); }

  .toponym-text {
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    color: var(--text-primary);
  }

  .toponym-meta {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .result-color-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .toponym-search-error,
  .toponym-search-empty {
    padding: 6px 8px;
    border-radius: var(--radius-xs);
    background: var(--panel-bg);
    border: 0.5px solid var(--panel-border);
    font-size: 11px;
    color: var(--text-muted);
    box-shadow: var(--shadow-md);
  }

  .toponym-search-error { color: var(--text-error); }

  @media (max-width: 900px) {
    .toponym-search-panel { top: 10px; width: calc(100vw - 20px); }
  }
</style>
