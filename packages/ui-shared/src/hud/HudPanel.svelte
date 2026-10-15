<script lang="ts">
  import type { Snippet } from 'svelte';
  import { FRAMELESS_CLASS, SOLID_CLASS } from './layout.js';
  import type { WindowControls } from './window-controls.js';
  import HudResizeHandles from './HudResizeHandles.svelte';
  import HudTitleBar from './HudTitleBar.svelte';

  let {
    title = '',
    frameless,
    solid,
    controls,
    children,
  }: {
    title?: string;
    frameless?: boolean;
    solid?: boolean;
    controls?: WindowControls;
    children?: Snippet;
  } = $props();

  /** 沒傳 prop 就讀頁面根元素的 class;沒有 document(node / SSR)當作沒有。必須在 render 當下決定,不能等 onMount。 */
  function readRoot(cls: string): boolean {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains(cls);
  }

  const framelessOn = $derived(frameless ?? readRoot(FRAMELESS_CLASS));
  const solidOn = $derived(solid ?? readRoot(SOLID_CLASS));
</script>

<div data-hud="panel" class:hud-solid={solidOn} class:hud-frameless={framelessOn}>
  <div class="hud-cut">
    <div class="hud-cut-inner">
      {#if framelessOn}
        <HudTitleBar {title} {controls} />
      {/if}
      <div class="hud-body">
        {#if children}{@render children()}{/if}
      </div>
    </div>
  </div>
  {#if framelessOn}
    <HudResizeHandles {controls} />
  {/if}
</div>
