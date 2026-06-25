<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { RuntimeSiteMetadata } from '$lib/artemis/dataset/runtimeMetadata';

  export let siteMetadata: RuntimeSiteMetadata;
  export let isOpen = false;

  type TabName = 'about' | 'pipeline';
  let activeTab: TabName = 'about';

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) activeTab = 'about';
  }

  function closePanel() {
    isOpen = false;
  }

  function openAboutPanel() {
    isOpen = true;
    activeTab = 'about';
  }
</script>

<div class="branding-container">
  <!-- Branding Header Button -->
  <button
    class="branding-button"
    type="button"
    aria-label="Open project information"
    aria-expanded={isOpen}
    on:click={togglePanel}
  >
    <div
      class="branding-logo-button"
      role="button"
      tabindex="0"
      aria-label="Open project information"
      on:click={(e) => { e.stopPropagation(); openAboutPanel(); }}
      on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAboutPanel(); } }}
    >
      <svg class="branding-logo" viewBox="0 0 26 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M13,3 C24,9 3,15 13,21 C20,24 13,31 13,37" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" />
      </svg>
    </div>
    <div class="branding-text">
      <div class="branding-title">ARTEMIS</div>
      <div class="branding-subtitle">Schelde Gemapt</div>
    </div>
  </button>

  <!-- Info Panel -->
  {#if isOpen}
    <div class="info-panel-backdrop" transition:fade={{ duration: 180 }} on:click={closePanel} on:keydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') closePanel(); }} role="button" tabindex="0" aria-label="Close panel"></div>

    <div class="info-panel" transition:fade={{ duration: 180 }}>
      <!-- Panel Header -->
      <div class="panel-header">
        <h2>Information</h2>
        <button class="panel-close" type="button" on:click={closePanel} aria-label="Close">×</button>
      </div>

      <!-- Panel Content -->
      <div class="panel-content">
        {#if activeTab === 'about'}
          <div class="tab-content">
            <h3>{siteMetadata.title}</h3>
            {#each siteMetadata.info as paragraph}
              <p>{paragraph}</p>
            {/each}

            {#if siteMetadata.team.length > 0}
              <div class="team-section">
                <h4>Team</h4>
                {#each siteMetadata.team as institution}
                  <div class="institution">
                    <strong>{institution.institution}</strong>
                    {#each institution.units as unit}
                      <div class="unit">
                        {#if unit.unit}
                          <span class="unit-name">{unit.unit}</span>
                        {/if}
                        {#if unit.members.length > 0}
                          <ul>
                            {#each unit.members as member}
                              <li>{member}</li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}

            {#if siteMetadata.logos.length > 0}
              <div class="logos-section">
                <h4>Partners</h4>
                <div class="logos-grid">
                  {#each siteMetadata.logos as logo}
                    <a href={logo.href} title={logo.label} target="_blank" rel="noopener noreferrer">
                      <img src={logo.src} alt={logo.alt} />
                    </a>
                  {/each}
                </div>
              </div>
            {/if}

            {#if siteMetadata.attribution}
              <div class="attribution">
                <p>{siteMetadata.attribution}</p>
              </div>
            {/if}
          </div>
        {:else if activeTab === 'pipeline'}
          <div class="tab-content">
            <h3>Data Pipeline</h3>
            <p>Information about the data pipeline will be displayed here.</p>
            <p><a href="https://github.com/GhentCDH/Artemis-RnD-Data" target="_blank" rel="noopener noreferrer">View on GitHub</a></p>
          </div>
        {/if}
      </div>

      <!-- Tab Buttons -->
      <div class="panel-tabs">
        <button
          class="tab-button"
          class:is-active={activeTab === 'about'}
          type="button"
          on:click={() => (activeTab = 'about')}
        >
          About
        </button>
        <button
          class="tab-button"
          class:is-active={activeTab === 'pipeline'}
          type="button"
          on:click={() => (activeTab = 'pipeline')}
        >
          Data pipeline
        </button>
      </div>
    </div>
  {/if}

</div>

<style>
  .branding-container {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 51;
  }

  .branding-button {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: white;
    border: 0.5px solid rgba(0, 0, 0, 0.1);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 150ms ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .branding-button:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    border-color: rgba(0, 0, 0, 0.15);
  }

  .branding-logo {
    width: 24px;
    height: 36px;
    flex: 0 0 auto;
    color: #5c6fb1;
  }

  .branding-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .branding-title {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.1;
  }

  .branding-subtitle {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted);
    line-height: 1.1;
  }

  .info-panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 97;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
  }

  .info-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(600px, 100vw - 40px);
    max-height: min(80vh, 800px);
    z-index: 98;
    background: white;
    border: 0.5px solid rgba(0, 0, 0, 0.1);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .panel-header {
    padding: 16px;
    border-bottom: 0.5px solid rgba(0, 0, 0, 0.1);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 0 0 auto;
  }

  .panel-header h2 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 24px;
    color: var(--text-primary);
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 150ms ease;
  }

  .panel-close:hover {
    opacity: 0.6;
  }

  .panel-content {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 16px;
    padding-bottom: 76px;
  }

  .tab-content h3 {
    margin: 0 0 12px;
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .tab-content p {
    margin: 0 0 12px;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.6;
    color: color-mix(in srgb, var(--text-primary) 90%, white 10%);
  }

  .tab-content a {
    color: #5c6fb1;
    text-decoration: none;
    border-bottom: 1px solid rgba(92, 111, 177, 0.3);
    transition: all 150ms ease;
  }

  .tab-content a:hover {
    border-bottom-color: #5c6fb1;
  }

  .team-section,
  .logos-section,
  .attribution {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 0.5px solid rgba(0, 0, 0, 0.08);
  }

  .team-section h4,
  .logos-section h4 {
    margin: 0 0 12px;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .institution {
    margin-bottom: 12px;
  }

  .institution strong {
    display: block;
    font-size: 13px;
    color: var(--text-primary);
    margin-bottom: 6px;
  }

  .unit {
    margin-left: 12px;
    font-size: 12px;
  }

  .unit-name {
    font-weight: 500;
    color: var(--text-secondary);
  }

  .unit ul {
    margin: 4px 0 0;
    padding-left: 16px;
    color: var(--text-muted);
  }

  .unit li {
    margin: 2px 0;
  }

  .logos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 12px;
  }

  .logos-grid a {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    border-radius: var(--radius-xs);
    transition: all 150ms ease;
  }

  .logos-grid a:hover {
    border-color: rgba(0, 0, 0, 0.15);
    background: rgba(0, 0, 0, 0.02);
  }

  .logos-grid img {
    max-width: 100%;
    max-height: 60px;
    object-fit: contain;
  }

  .attribution {
    font-size: 11px;
    color: var(--text-muted);
  }

  .attribution p {
    margin: 0;
    line-height: 1.5;
  }

  .panel-tabs {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    padding: 8px 16px;
    border-top: 0.5px solid rgba(0, 0, 0, 0.1);
    background: white;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab-button {
    flex: 1;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.02);
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    border-radius: var(--radius-xs);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 150ms ease;
  }

  .tab-button:hover {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.12);
  }

  .tab-button.is-active {
    background: #5c6fb1;
    border-color: #5c6fb1;
    color: white;
  }

  .branding-logo-button {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .branding-logo-button:hover {
    opacity: 0.7;
  }

</style>
