<!-- Floating search panel (top-center). Handles toponym + manifest search internally;
     dispatches events for map-level actions (fly-to, layer activation). -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { normalizeSearchText, scoreText } from '$lib/artemis/search/text';
  import { MAIN_LAYER_META, MAIN_LAYER_LABELS } from '$lib/artemis/config/layers';
  import type { ToponymIndexItem, ManifestSearchItem } from '$lib/artemis/shared/types';

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
  let menuOpen = false;
  let suggestions: ToponymIndexItem[] = [];
  let toponymResults: Array<ToponymIndexItem & { score: number }> = [];
  let manifestResults: Array<ManifestSearchItem & { score: number }> = [];
  let panelEl: HTMLElement | null = null;
  let inputEl: HTMLInputElement | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const POINTER_LEEWAY_PX = 28;
  const POINTER_CLOSE_DELAY_MS = 140;

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
    if (locked) return;
    menuOpen = true;
    if (firstFocusSeen) return;
    firstFocusSeen = true;
    pickSuggestions(3);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  }

  function cancelPendingClose() {
    if (closeTimer === null) return;
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function closeMenu() {
    cancelPendingClose();
    menuOpen = false;
    locked = false;
    inputEl?.blur();
  }

  function scheduleClose() {
    cancelPendingClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      closeMenu();
    }, POINTER_CLOSE_DELAY_MS);
  }

  function pointerWithinLeeway(event: PointerEvent): boolean {
    if (!panelEl) return false;
    const rect = panelEl.getBoundingClientRect();
    return (
      event.clientX >= rect.left - POINTER_LEEWAY_PX &&
      event.clientX <= rect.right + POINTER_LEEWAY_PX &&
      event.clientY >= rect.top - POINTER_LEEWAY_PX &&
      event.clientY <= rect.bottom + POINTER_LEEWAY_PX
    );
  }

  function handleDocumentPointerMove(event: PointerEvent) {
    if (!menuOpen) return;
    if (pointerWithinLeeway(event)) {
      cancelPendingClose();
      return;
    }
    scheduleClose();
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!menuOpen) return;
    if (panelEl?.contains(event.target as Node)) return;
    closeMenu();
  }

  function onInput() {
    locked = false;
    menuOpen = true;
    cancelPendingClose();
  }

  function onPanelPointerEnter() {
    if (!menuOpen) return;
    cancelPendingClose();
  }

  function clearQuery() {
    query = '';
    locked = false;
    menuOpen = true;
    cancelPendingClose();
    inputEl?.focus();
  }

  function selectToponym(item: ToponymIndexItem) {
    locked = true;
    query = item.text;
    menuOpen = false;
    inputEl?.blur();
    dispatch('fly-to-toponym', item);
  }

  function selectManifest(result: ManifestSearchItem & { score: number }) {
    locked = true;
    query = result.text;
    menuOpen = false;
    inputEl?.blur();
    dispatch('manifest-click', result);
  }

  onMount(() => {
    document.addEventListener('pointermove', handleDocumentPointerMove);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointermove', handleDocumentPointerMove);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    }
    cancelPendingClose();
  });

  $: { query; toponymIndex; manifestSearchIndex; updateResults(); }
  $: if (toponymIndex.length > 0 && firstFocusSeen && query === '') pickSuggestions(3);
</script>

<section class="toponym-search-panel" role="search" aria-label="Toponym and manifest search" bind:this={panelEl} on:pointerenter={onPanelPointerEnter}>
  <div class="ui-panel toponym-search-row">
    <input
      bind:this={inputEl}
      type="text"
      class="ui-input"
      placeholder="Search manifests and toponyms..."
      bind:value={query}
      on:input={onInput}
      on:focus={onFocus}
      on:keydown={onKeydown}
      spellcheck="false"
      autocomplete="off"
    />
    {#if query.trim()}
      <button
        type="button"
        class="toponym-clear"
        aria-label="Clear search query"
        title="Clear search"
        on:click={clearQuery}
      >×</button>
    {/if}
    {#if loading}
      <span class="toponym-search-status">Loading…</span>
    {/if}
  </div>

  {#if error}
    <div class="ui-panel toponym-feedback toponym-search-error">{error}</div>
  {/if}

  {#if menuOpen && firstFocusSeen && query.trim() === '' && suggestions.length > 0}
    <div class="ui-panel toponym-suggestions">
      <div class="ui-label">Try one of these</div>
      <div class="toponym-suggestion-list">
        {#each suggestions as s (s.id)}
          {@const mainId = findMainId(s.mapName)}
          {@const color = mainId ? MAIN_LAYER_META[mainId]?.color : undefined}
          <button type="button" class="ui-list-item toponym-suggestion" on:click={() => (query = s.text)}>
            {#if color}<span class="result-color-dot" style="background:{color}"></span>{/if}
            <span class="toponym-text">{s.text}</span>
            <span class="ui-meta">{s.mapName}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if menuOpen && !locked && query.trim() && (manifestResults.length > 0 || toponymResults.length > 0)}
    <div class="ui-panel toponym-results" role="listbox" aria-label="Search results">
      {#if manifestResults.length > 0}
        <div class="ui-label result-group-title">IIIF manifests</div>
        {#each manifestResults as result (result.id)}
          {@const mainId = findMainId(result.mapName)}
          {@const color = mainId ? MAIN_LAYER_META[mainId]?.color : undefined}
          <button type="button" class="ui-list-item" on:click={() => selectManifest(result)}>
            {#if color}<span class="result-color-dot" style="background:{color}"></span>{/if}
            <span class="toponym-text">{result.text}</span>
            <span class="ui-meta">IIIF · {result.mapName}</span>
          </button>
        {/each}
      {/if}
      {#if toponymResults.length > 0}
        <div class="ui-label result-group-title">Toponyms</div>
        {#each toponymResults as result (result.id)}
          {@const mainId = findMainId(result.mapName)}
          {@const color = mainId ? MAIN_LAYER_META[mainId]?.color : undefined}
          <button type="button" class="ui-list-item" on:click={() => selectToponym(result)}>
            {#if color}<span class="result-color-dot" style="background:{color}"></span>{/if}
            <span class="toponym-text">{result.text}</span>
            <span class="ui-meta">{result.mapName}</span>
          </button>
        {/each}
      {/if}
    </div>
  {:else if menuOpen && !locked && query.trim() && !loading && !error}
    <div class="ui-panel toponym-feedback">No matching manifests or toponyms.</div>
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
  }

  .toponym-search-status {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .toponym-clear {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-muted);
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease;
  }

  .toponym-clear:hover {
    background: var(--result-hover);
    border-color: var(--border-light);
    color: var(--text-primary);
    transform: scale(1.04);
  }

  .toponym-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
  }

  .toponym-suggestions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
  }

  .toponym-suggestion-list { display: grid; gap: 4px; }

  /* padding differs from the base ui-list-item */
  .toponym-suggestion { padding: 7px 9px; }

  /* left padding for the group label */
  .result-group-title { padding: 4px 6px 2px; }

  .toponym-text {
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    color: var(--text-primary);
  }

  .result-color-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .toponym-feedback {
    padding: 6px 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .toponym-search-error { color: var(--text-error); }

  @media (max-width: 900px) {
    .toponym-search-panel { top: 10px; width: calc(100vw - 20px); }
  }
</style>
