<!-- Floating search panel (top-center). Handles toponym + manifest search internally;
     dispatches events for map-level actions (fly-to, layer activation). -->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { normalizeSearchText, scoreText } from '$lib/artemis/search/text';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import type { ToponymIndexItem, ManifestSearchItem } from '$lib/artemis/shared/types';

  export let toponymIndex: ToponymIndexItem[] = [];
  export let manifestSearchIndex: ManifestSearchItem[] = [];
  export let massartIndex: any[] = [];
  export let activeMapIds: Set<string> = new Set();
  export let loading = false;
  export let error: string | null = null;

  const dispatch = createEventDispatcher<{
    'fly-to-toponym': ToponymIndexItem;
    'manifest-click': ManifestSearchItem;
    'massart-click': any;
  }>();

  const MAX_RESULTS = 100;
  type TabType = 'all' | 'toponyms' | 'sheets' | 'images';

  type ResultGroup<T> = {
    text: string;
    count: number;
    items: T[];
  };

  let query = '';
  let locked = false;
  let menuOpen = false;
  let selectedTab: TabType = 'all';
  let activeOnly = false;
  let toponymResults: Array<ToponymIndexItem & { score: number }> = [];
  let manifestResults: Array<ManifestSearchItem & { score: number }> = [];
  let massartResults: Array<any & { score: number }> = [];
  let expandedGroups: Record<string, boolean> = {};
  let panelEl: HTMLElement | null = null;
  let inputEl: HTMLInputElement | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const POINTER_LEEWAY_PX = 28;
  const POINTER_CLOSE_DELAY_MS = 140;

  function groupResultsBySource(results: Array<any>, keyFn: (r: any) => string) {
    const groups = new Map<string, typeof results>();
    for (const result of results) {
      const key = keyFn(result);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(result);
    }
    return Array.from(groups.entries());
  }

  function updateResults() {
    const raw = query.trim();
    if (!raw) { toponymResults = []; manifestResults = []; massartResults = []; expandedGroups = {}; return; }
    const norm = normalizeSearchText(raw);
    if (!norm) { toponymResults = []; manifestResults = []; massartResults = []; expandedGroups = {}; return; }

    expandedGroups = {};

    let tResults = toponymIndex
      .map(item => {
        const n = item.textNormalized?.trim() || normalizeSearchText(item.text ?? '');
        return { ...item, score: scoreText(item.text ?? '', n, raw, norm) };
      })
      .filter(r => r.score >= 0)
      .filter(r => !activeOnly || activeMapIds.has(r.mapId))
      .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text) || a.sourceFile.localeCompare(b.sourceFile))
      .slice(0, MAX_RESULTS);

    let mResults = manifestSearchIndex
      .map(item => ({ ...item, score: scoreText(item.text, item.textNormalized, raw, norm) }))
      .filter(r => r.score >= 0)
      .filter(r => !activeOnly || activeMapIds.has(r.mapId))
      .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
      .slice(0, MAX_RESULTS);

    let maResults = massartIndex
      .map(item => {
        const searchText = `${item.title ?? ''} ${item.location ?? ''} ${item.year ?? ''}`.trim();
        const textNorm = normalizeSearchText(searchText);
        return { ...item, score: scoreText(searchText, textNorm, raw, norm) };
      })
      .filter(r => r.score >= 0)
      .sort((a, b) => b.score - a.score || (a.title ?? '').localeCompare(b.title ?? ''))
      .slice(0, MAX_RESULTS);

    toponymResults = tResults;
    manifestResults = mResults;
    massartResults = maResults;
  }

  function onFocus() {
    if (locked) return;
    menuOpen = true;
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

  function selectMassart(result: any & { score: number }) {
    locked = true;
    query = result.title;
    menuOpen = false;
    inputEl?.blur();
    dispatch('massart-click', result);
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

  $: { query; activeOnly; toponymIndex; manifestSearchIndex; massartIndex; updateResults(); }
</script>

<section class="toponym-search-panel" role="search" aria-label="Toponym and manifest search" bind:this={panelEl} on:pointerenter={onPanelPointerEnter}>
  <div class="ui-panel toponym-search-row">
    <input
      bind:this={inputEl}
      type="text"
      class="ui-input"
      placeholder="Search sheets, toponyms, and images..."
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

  {#if menuOpen && !locked}
    <div class="ui-panel toponym-results" role="listbox" aria-label="Search results">
      <div class="result-controls">
        <div class="result-tabs">
          <button
            type="button"
            class="result-tab"
            class:active={selectedTab === 'all'}
            on:click={() => selectedTab = 'all'}
          >
            All
          </button>
          <button
            type="button"
            class="result-tab"
            class:active={selectedTab === 'toponyms'}
            on:click={() => selectedTab = 'toponyms'}
          >
            Toponyms
          </button>
          <button
            type="button"
            class="result-tab"
            class:active={selectedTab === 'sheets'}
            on:click={() => selectedTab = 'sheets'}
          >
            Sheets
          </button>
          <button
            type="button"
            class="result-tab"
            class:active={selectedTab === 'images'}
            on:click={() => selectedTab = 'images'}
          >
            Images
          </button>
        </div>
        <Tooltip content="Search active only">
          <button
            type="button"
            class="active-only-button"
            class:active={activeOnly}
            on:click={() => (activeOnly = !activeOnly)}
            aria-label="Toggle active layers only filter"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="rifle-scope">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>
        </Tooltip>
      </div>

      {#if query.trim()}
        {#if selectedTab === 'all' || selectedTab === 'sheets'}
          {#if manifestResults.length > 0}
            <div class="result-category">
              <div class="ui-label result-category-title">Sheets</div>
              {#each groupResultsBySource(manifestResults, r => r.mapName) as [mapName, results] (mapName)}
                <div class="result-source-header">
                  <span class="source-name">{mapName}</span>
                </div>
                {#each results as result (result.id)}
                  <button type="button" class="ui-list-item result-item" on:click={() => selectManifest(result)}>
                    <span class="toponym-text">{result.text}</span>
                    <span class="ui-meta">IIIF</span>
                  </button>
                {/each}
              {/each}
            </div>
          {/if}
        {/if}

        {#if selectedTab === 'all' || selectedTab === 'toponyms'}
          {#if toponymResults.length > 0}
            <div class="result-category">
              <div class="ui-label result-category-title">Toponyms</div>
              {#each groupResultsBySource(toponymResults, r => r.mapName) as [mapName, results] (mapName)}
                <div class="result-source-header">
                  <span class="source-name">{mapName}</span>
                </div>
                {#each results as result (result.id)}
                  <button type="button" class="ui-list-item result-item" on:click={() => selectToponym(result)}>
                    <span class="toponym-text">{result.text}</span>
                  </button>
                {/each}
              {/each}
            </div>
          {/if}
        {/if}

        {#if selectedTab === 'all' || selectedTab === 'images'}
          {#if massartResults.length > 0}
            <div class="result-category">
              <div class="ui-label result-category-title">Images</div>
              {#each massartResults as result (result.mmsId)}
                <button type="button" class="ui-list-item result-item" on:click={() => selectMassart(result)}>
                  <span class="toponym-text">{result.title}</span>
                  <span class="ui-meta">{#if result.year}{result.year} · {/if}{result.location || 'Massart'}</span>
                </button>
              {/each}
            </div>
          {/if}
        {/if}

        {#if !loading && !error && manifestResults.length === 0 && toponymResults.length === 0 && massartResults.length === 0}
          <div class="ui-panel toponym-feedback">No matching results.</div>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .toponym-search-panel {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    width: min(460px, calc(100vw - 28px));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toponym-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
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
    background: var(--muted-surface-background);
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
    background: var(--list-row-background-hover);
    border-color: var(--border-light);
    color: var(--text-primary);
    transform: scale(1.04);
  }

  .toponym-results {
    display: flex;
    flex-direction: column;
    padding: 0;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
  }

  .result-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 5px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .result-tabs {
    display: flex;
    gap: 0;
    flex: 1;
  }

  .result-tab {
    flex: 1;
    padding: 5px 7px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    text-align: center;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 140ms ease, border-color 140ms ease;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .result-tab:hover {
    color: var(--text-primary);
  }

  .result-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-color, #6366f1);
  }

  .active-only-button {
    border: 1px solid transparent;
    background: transparent;
    padding: 4px 6px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
    position: relative;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-xs);
  }

  .active-only-button:hover {
    color: var(--text-primary);
    background: var(--muted-surface-background);
  }

  .active-only-button.active {
    color: white;
    background: var(--accent-color, #6366f1);
    border-color: var(--accent-color, #6366f1);
  }

  .active-only-button.active:hover {
    background: var(--accent-color, #6366f1);
  }

  .rifle-scope {
    width: 16px;
    height: 16px;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .result-category {
    display: flex;
    flex-direction: column;
    padding: 6px 0 0;
  }

  .result-category-title {
    padding: 2px 12px 4px 6px;
    margin: 0;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .result-source-header {
    padding: 3px 7px 3px 14px;
    margin: 0;
    font-family: var(--font-readable);
    font-size: 12px;
    font-weight: 400;
    line-height: var(--text-readable-line-height);
    color: var(--text-readable);
    background: transparent;
    border: none;
  }

  .source-name {
    display: block;
  }

  .result-item {
    padding: 4px 7px 4px 24px;
    margin: 0;
    background: transparent;
    width: 100%;
    text-align: left;
  }

  .result-item:hover {
    background: var(--list-row-background-hover);
  }

  .toponym-text {
    font-family: var(--font-readable);
    font-size: 12px;
    font-weight: 400;
    line-height: var(--text-readable-line-height);
    color: var(--text-readable);
  }

  .toponym-feedback {
    padding: 6px 8px;
    font-family: var(--font-readable);
    font-size: 12px;
    line-height: var(--text-readable-line-height);
    color: var(--text-readable);
  }

  .toponym-search-error { color: var(--text-error); }

  @media (max-width: 900px) {
    .toponym-search-panel { top: 10px; width: calc(100vw - 20px); }
  }
</style>
