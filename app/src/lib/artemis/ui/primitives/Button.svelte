<script lang="ts">
  export let variant: 'chrome' | 'primary' | 'toolbar' | 'tab' | 'list' = 'chrome';
  export let iconOnly = false;
  export let active = false;
  export let disabled = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
</script>

<button
  {...$$restProps}
  class={`artemis-button artemis-button--${variant} ${iconOnly ? 'artemis-button--icon-only' : ''} ${active ? 'is-active' : ''} ${$$restProps.class ?? ''}`}
  {type}
  {disabled}
  aria-pressed={active ? 'true' : undefined}
  on:click
  on:keydown
  on:mouseenter
  on:mouseleave
  on:focus
  on:blur
>
  <slot />
</button>

<style>
  .artemis-button {
    border: 1px solid var(--button-border);
    border-radius: var(--radius-sm);
    background: var(--button-background);
    color: var(--button-text);
    box-shadow: none;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 400;
    line-height: 1.1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition:
      background 150ms ease,
      border-color 150ms ease,
      box-shadow 150ms ease,
      color 150ms ease,
      opacity 150ms ease;
  }

  .artemis-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .artemis-button--chrome {
    min-height: 28px;
    padding: 6px 10px;
  }

  .artemis-button--chrome:hover:not(:disabled) {
    background: var(--button-background-hover);
    border-color: var(--control-border-hover);
  }

  .artemis-button--chrome.is-active {
    background: var(--button-active-background);
    border-color: var(--button-active-background);
    color: var(--button-primary-text);
  }

  .artemis-button--chrome.is-active:hover:not(:disabled) {
    background: var(--button-active-background-hover, var(--button-active-background));
    border-color: var(--button-active-background);
  }

  .artemis-button--primary {
    min-height: 32px;
    padding: 9px 14px;
    border-color: var(--button-primary-background);
    background: var(--button-primary-background);
    color: var(--button-primary-text);
    font-weight: 400;
  }

  .artemis-button--primary:hover:not(:disabled) {
    border-color: var(--button-primary-background-hover);
    background: var(--button-primary-background-hover);
  }

  .artemis-button--toolbar {
    min-height: 34px;
    padding: 8px 12px;
    box-shadow: var(--control-shadow);
  }

  .artemis-button--toolbar:hover:not(:disabled) {
    background: var(--button-background-hover);
    border-color: var(--control-border-hover);
  }

  .artemis-button--toolbar.is-active {
    background: var(--button-active-background);
    border-color: var(--button-active-background);
    color: var(--button-primary-text);
  }

  .artemis-button--tab {
    min-height: 34px;
    padding: 8px 12px;
    flex: 1;
  }

  .artemis-button--tab:hover:not(:disabled) {
    background: var(--button-background-hover);
    border-color: var(--control-border-hover);
  }

  .artemis-button--tab.is-active {
    background: var(--button-active-background);
    border-color: var(--button-active-background);
    color: var(--button-primary-text);
  }

  .artemis-button--list {
    width: 100%;
    justify-content: flex-start;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius-xs);
    text-align: left;
    font-weight: 500;
  }

  .artemis-button--list:hover:not(:disabled) {
    background: var(--button-background-hover);
  }

  .artemis-button--icon-only {
    width: 28px;
    height: 28px;
    min-height: 0;
    padding: 0;
    gap: 0;
  }
</style>
