<script lang="ts">
  import { onMount } from 'svelte';
  import { renderMarkdown } from '@learning/ui-shared';
  import '@learning/ui-shared/hud/hud.css';
  import HudButton from '@learning/ui-shared/hud/HudButton.svelte';
  import HudPanel from '@learning/ui-shared/hud/HudPanel.svelte';
  import { createWindowControls } from '@learning/ui-shared/hud/window-controls';
  import { CATEGORY, ORDER, cardPath, createFixtureFs } from './stubs/fixture-data.js';
  import { parseCard, type CardFrontmatter } from './lib/card.js';
  import { createDeck, currentCardId, pressNext, isFinished, type DeckState } from './lib/deck.js';

  const fs = createFixtureFs();
  const deck = $state<DeckState>(createDeck(ORDER));
  const finished = $derived(isFinished(deck));
  const controls = createWindowControls();

  let frontmatter = $state<CardFrontmatter | null>(null);
  let bodyHtml = $state('');
  let loadError = $state<string | null>(null);

  async function loadCurrent(): Promise<void> {
    const id = currentCardId(deck);
    if (id === null) {
      frontmatter = null;
      bodyHtml = '';
      return;
    }
    try {
      const raw = await fs.read(cardPath(id));
      const parsed = parseCard(raw);
      frontmatter = parsed.frontmatter;
      bodyHtml = renderMarkdown(parsed.bodyMarkdown);
      loadError = null;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function handleNext(): void {
    pressNext(deck);
    void loadCurrent();
  }

  onMount(() => {
    void loadCurrent();
  });
</script>

<HudPanel title="教學卡" {controls} fill>
  {#if loadError}
    <p class="error">讀取失敗:{loadError}</p>
  {:else if finished}
    <p class="finished">這個類別已經學完了。可以考慮補充更多素材。</p>
  {:else if frontmatter}
    <header class="markers">
      <span class="category">{frontmatter.category}</span>
      <span class="source">{frontmatter.source === 'raw' ? '原始' : '生成'}</span>
      <span class="level">Level {frontmatter.level}</span>
      {#if frontmatter.provisional}
        <span class="badge">待審核</span>
      {/if}
    </header>
    <h2>{frontmatter.title}</h2>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div class="body">{@html bodyHtml}</div>
    <div class="controls">
      <HudButton onclick={handleNext} disabled={finished}>下一個</HudButton>
    </div>
  {/if}
</HudPanel>

<style>
  .markers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--hud-text);
  }
  .badge {
    color: var(--hud-text);
    background: var(--hud-accent-wash);
    padding: 0 0.4rem;
  }
  h2 {
    margin: 0.6rem 0 0.35rem;
    font-size: 1.15rem;
    font-weight: 600;
  }
  .body {
    overflow-wrap: anywhere;
  }
  .controls {
    margin-top: 0.75rem;
  }
  :global(.lc-example) {
    background: var(--hud-solid);
    border-left: 1px solid var(--hud-line);
    padding: 0.5rem 1rem;
    margin: 1rem 0;
  }
</style>
