<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<!-- 外層畫跟按鈕同一種切角黑線;內層墊面板色,輸入框自己保持透明。 -->
<div data-hud="field">
  <div class="hud-field-face">
    {#if children}{@render children()}{/if}
  </div>
</div>
