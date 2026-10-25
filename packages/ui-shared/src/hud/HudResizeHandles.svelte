<script lang="ts">
  import type { ResizeDirection, WindowControls } from './window-controls.js';

  const EDGES = [
    'North',
    'South',
    'East',
    'West',
    'NorthEast',
    'NorthWest',
    'SouthEast',
    'SouthWest',
  ] as const satisfies readonly ResizeDirection[];

  let { controls }: { controls?: WindowControls } = $props();

  function onResize(event: MouseEvent, edge: ResizeDirection): void {
    if (event.button !== 0) return;
    void controls?.startResizeDragging(edge);
  }
</script>

{#each EDGES as edge}
  <div
    data-hud="resize-handle"
    data-hud-edge={edge}
    onmousedown={(event) => onResize(event, edge)}
  ></div>
{/each}
