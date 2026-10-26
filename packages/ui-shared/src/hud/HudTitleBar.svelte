<script lang="ts">
  import type { WindowControls } from './window-controls.js';

  let { title, controls }: { title: string; controls?: WindowControls } = $props();

  function onDrag(event: MouseEvent): void {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    void controls?.startDragging();
  }
</script>

<div data-hud="titlebar" onmousedown={onDrag}>
  <span data-hud="title">{title}</span>
  {#if controls?.available}
    <button type="button" data-hud="minimize" onclick={() => controls?.minimize()}>–</button>
    <button type="button" data-hud="close" onclick={() => controls?.close()}>×</button>
  {/if}
</div>
