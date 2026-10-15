<script lang="ts">
  import { hpPercent } from './hp-bar.js';

  let { done, total }: { done: number; total: number } = $props();

  const percent = $derived(hpPercent(done, total));
  const percentText = $derived(String(percent));
</script>

<div
  data-hud="hp-bar"
  role="progressbar"
  data-percent={percentText}
  aria-valuenow={percentText}
  aria-valuemin="0"
  aria-valuemax="100"
  class:hud-hp-full={percent >= 100}
  style:--hp-fill="{percent}%"
></div>
