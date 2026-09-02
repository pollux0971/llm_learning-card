<script lang="ts">
  import { onMount } from 'svelte';
  import { renderMarkdown } from '@learning/ui-shared';
  import { CATEGORY, ORDER, cardPath, createFixtureFs } from './stubs/fixture-data.js';
  import { parseCard, type CardFrontmatter } from './lib/card.js';
  import { createDeck, currentCardId, pressNext, isFinished, type DeckState } from './lib/deck.js';

  const fs = createFixtureFs();
  const deck = $state<DeckState>(createDeck(ORDER));
  const finished = $derived(isFinished(deck));

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

<main>
  <h1>教學卡</h1>

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
      <button type="button" onclick={handleNext} disabled={finished}>下一個</button>
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 40rem;
    margin: 2rem auto;
    font-family: system-ui, sans-serif;
    padding: 0 1rem;
  }
  .markers {
    display: flex;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #555;
  }
  .badge {
    color: #a15c00;
    background: #fff3cd;
    border-radius: 0.25rem;
    padding: 0 0.4rem;
  }
  :global(.lc-example) {
    background: #f6f8fa;
    border-left: 3px solid #ccc;
    padding: 0.5rem 1rem;
    margin: 1rem 0;
  }
</style>
