<script lang="ts">
  import { fade } from 'svelte/transition';
  import Button from '$lib/artemis/ui/primitives/Button.svelte';
  import Window from '$lib/artemis/ui/primitives/Window.svelte';
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

</script>

<div class="branding-container">
  <!-- Branding Header Button -->
  <Button
    class="branding-button"
    variant="toolbar"
    aria-label="Open project information"
    aria-expanded={isOpen}
    on:click={togglePanel}
  >
    <span class="branding-logo-button">
      <svg class="branding-logo" viewBox="0 0 26 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M13,3 C24,9 3,15 13,21 C20,24 13,31 13,37" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" />
      </svg>
    </span>
    <div class="branding-text">
      <div class="branding-title">ARTEMIS</div>
      <div class="branding-subtitle">Schelde Gemapt</div>
    </div>
  </Button>

  <!-- Info Panel -->
  {#if isOpen}
    <div transition:fade={{ duration: 180 }}>
      <Window
        class="info-panel"
        title="Information"
        variant="modal"
        placement="center"
        backdrop={true}
        showClose={true}
        closeLabel="Close panel"
        closeOnEscape={true}
        on:close={closePanel}
      >
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
          <Button
            variant="tab"
            active={activeTab === 'about'}
            on:click={() => (activeTab = 'about')}
          >
            About
          </Button>
          <Button
            variant="tab"
            active={activeTab === 'pipeline'}
            on:click={() => (activeTab = 'pipeline')}
          >
            Data pipeline
          </Button>
        </div>
      </Window>
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

  :global(.branding-button) {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--window-background);
    border: 1px solid var(--window-border);
    border-radius: var(--radius-md);
    box-shadow: var(--window-shadow);
  }

  :global(.branding-button:hover) {
    background: var(--window-background);
    box-shadow: var(--window-shadow);
    border-color: var(--control-border-hover);
  }

  .branding-logo {
    width: 24px;
    height: 36px;
    flex: 0 0 auto;
    color: var(--button-primary-background);
  }

  .branding-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
  }

  .branding-title {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.24em;
    color: var(--text-primary);
    line-height: 1.1;
  }

  .branding-subtitle {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.16em;
    color: var(--button-primary-background);
    line-height: 1;
    text-transform: uppercase;
  }

  :global(.info-panel) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(600px, 100vw - 40px);
    max-height: min(80vh, 800px);
    z-index: 98;
    background: var(--window-background) !important;
    backdrop-filter: blur(12px);
  }

  :global(.info-panel .artemis-window-header) {
    padding: 16px;
    border-bottom-color: var(--window-border);
    background: var(--window-header-background);
  }

  :global(.info-panel .artemis-window-heading h2) {
    font-size: 16px;
    font-weight: 600;
  }

  :global(.info-panel .artemis-window-body) {
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--window-background);
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
    font-family: var(--font-readable);
    font-size: var(--text-readable-size);
    line-height: var(--text-readable-line-height);
    color: var(--text-readable);
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
    border-top: 0.5px solid var(--window-border);
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
    border: 0.5px solid var(--window-border);
    border-radius: var(--radius-xs);
    transition: all 150ms ease;
  }

  .logos-grid a:hover {
    border-color: var(--control-border-hover);
    background: var(--button-background-hover);
  }

  .logos-grid img {
    max-width: 100%;
    max-height: 60px;
    object-fit: contain;
  }

  .attribution {
    font-family: var(--font-readable);
    font-size: var(--text-readable-size);
    color: var(--text-readable);
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
    border-top: 0.5px solid var(--window-border);
    background: var(--window-background);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .branding-logo-button {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    transition: opacity 150ms ease;
  }

</style>
