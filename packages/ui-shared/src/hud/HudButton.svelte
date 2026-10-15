<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    disabled = false,
    onclick,
    children,
  }: {
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  } = $props();
</script>

<button type="button" data-hud="button" {disabled} {onclick}>
  <span class="hud-button-label">
    {#if children}{@render children()}{/if}
  </span>
</button>
