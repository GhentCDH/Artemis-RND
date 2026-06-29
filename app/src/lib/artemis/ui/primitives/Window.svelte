<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Button from './Button.svelte';

  export let title = '';
  export let subtitle = '';
  export let variant: 'floating' | 'docked' | 'modal' | 'popover' | 'timeline' = 'floating';
  export let placement: 'left' | 'right' | 'bottom' | 'center' | 'anchored' = 'left';
  export let backdrop = false;
  export let showClose = false;
  export let closeLabel = 'Close';
  export let closeOnEscape = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch('close');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (closeOnEscape && event.key === 'Escape') {
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if backdrop}
  <Button class="artemis-window-backdrop" variant="chrome" aria-label={closeLabel} on:click={close}></Button>
{/if}

<section
  {...$$restProps}
  class={`artemis-window artemis-window--${variant} artemis-window--${placement} ${$$restProps.class ?? ''}`}
>
  {#if title || subtitle || showClose || $$slots.actions || $$slots.header}
    <header class="artemis-window-header">
      {#if $$slots.header}
        <slot name="header" />
      {:else}
        <div class="artemis-window-heading">
          {#if title}
            <h2>{title}</h2>
          {/if}
          {#if subtitle}
            <p>{subtitle}</p>
          {/if}
        </div>
      {/if}
      {#if $$slots.actions || showClose}
        <div class="artemis-window-actions">
          <slot name="actions" />
          {#if showClose}
            <Button variant="chrome" iconOnly={true} aria-label={closeLabel} on:click={close}>×</Button>
          {/if}
        </div>
      {/if}
    </header>
  {/if}

  <div class="artemis-window-body">
    <slot />
  </div>
</section>

<style>
  :global(.artemis-window-backdrop) {
    position: fixed;
    inset: 0;
    z-index: 97;
    border: 0;
    padding: 0;
    background: var(--window-backdrop-background);
    backdrop-filter: blur(4px);
    cursor: default;
  }

  :global(.artemis-window-backdrop:hover) {
    background: var(--window-backdrop-background);
  }

  :global(.artemis-window-backdrop:focus) {
    outline: none;
    box-shadow: none;
  }

  .artemis-window {
    background: var(--window-background);
    border: 1px solid var(--window-border);
    border-radius: var(--radius-md);
    box-shadow: var(--window-shadow);
    color: var(--text-primary);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .artemis-window--modal {
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--window-background) 96%, white);
  }

  .artemis-window--popover {
    background: color-mix(in srgb, var(--window-background) 98%, white);
  }

  .artemis-window--docked,
  .artemis-window--timeline {
    background: var(--window-background);
  }

  .artemis-window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--window-border);
    background: var(--window-header-background);
    flex: 0 0 auto;
  }

  .artemis-window-heading {
    min-width: 0;
  }

  .artemis-window-heading h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 400;
    line-height: 1.2;
  }

  .artemis-window-heading p {
    margin: 3px 0 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.3;
  }

  .artemis-window-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
  }

  .artemis-window-body {
    min-height: 0;
    flex: 1 1 auto;
  }

  :global(.artemis-window .artemis-button) {
    box-shadow: none;
  }
</style>
