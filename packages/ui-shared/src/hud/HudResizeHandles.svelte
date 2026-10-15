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

  function onResize(edge: ResizeDirection): void {
    void controls?.startResizeDragging(edge);
  }
</script>

{#each EDGES as edge}
  <div
    data-hud="resize-handle"
    data-hud-edge={edge}
    onpointerdown={() => onResize(edge)}
  ></div>
{/each}
