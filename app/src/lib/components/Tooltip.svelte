<!-- Reusable tooltip component that follows cursor -->
<script lang="ts">
  import { onMount } from 'svelte';

  export let content: string = '';
  export let disabled = false;

  let tooltipEl: HTMLElement | null = null;
  let tooltipVisible = false;
  let tooltipStyle = '';
  let portalContainer: HTMLElement | null = null;

  function onMouseMove(event: MouseEvent) {
    if (disabled || !tooltipVisible || !tooltipEl) return;

    const offset = 12;
    let left = event.clientX + offset;
    let top = event.clientY + offset;

    // Bounds checking to keep tooltip on screen
    const rect = tooltipEl.getBoundingClientRect();
    const tooltipWidth = rect.width || 200;
    const tooltipHeight = rect.height || 50;

    if (left + tooltipWidth > window.innerWidth - 8) {
      left = window.innerWidth - tooltipWidth - 8;
    }

    if (top + tooltipHeight > window.innerHeight - 8) {
      top = event.clientY - tooltipHeight - offset;
    }

    tooltipStyle = `left:${Math.max(8, left)}px;top:${Math.max(8, top)}px`;
  }

  function onMouseEnter() {
    if (disabled) return;
    tooltipVisible = true;
  }

  function onMouseLeave() {
    tooltipVisible = false;
  }

  onMount(() => {
    let container = document.getElementById('tooltip-portal');
    if (!container) {
      container = document.createElement('div');
      container.id = 'tooltip-portal';
      document.body.appendChild(container);
    }
    portalContainer = container;
  });
</script>

<div
  class="tooltip-trigger"
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
  on:mousemove={onMouseMove}
  role="region"
  aria-label={content}
>
  <slot />
</div>

{#if tooltipVisible && content && portalContainer}
  <div bind:this={tooltipEl} class="ui-tooltip" style={tooltipStyle} aria-hidden="true">
    {content}
  </div>
{/if}

<style>
  .tooltip-trigger {
    display: contents;
  }

  .ui-tooltip {
    position: fixed;
    z-index: 10000;
    background-color: var(--tooltip-background);
    color: var(--tooltip-text);
    border: 1px solid var(--tooltip-border);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font-size: 0.875rem;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: var(--tooltip-shadow);
  }
</style>
