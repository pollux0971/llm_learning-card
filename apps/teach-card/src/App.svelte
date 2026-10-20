<script lang="ts">
  import { renderMarkdown } from '@learning/ui-shared';
  import '@learning/ui-shared/hud/hud.css';
  import HudButton from '@learning/ui-shared/hud/HudButton.svelte';
  import HudPanel from '@learning/ui-shared/hud/HudPanel.svelte';
  import { createWindowControls } from '@learning/ui-shared/hud/window-controls';
  import { parseCard, type CardFrontmatter } from './lib/card.js';
  import { createTeachSession, type TeachSessionDeps, type TeachView } from './teach-session.js';

  let { deps }: { deps: TeachSessionDeps } = $props();

  const session = createTeachSession(deps);
  const controls = createWindowControls();
  let view = $state<TeachView>(session.view());

  function pull(): void {
    view = session.view();
  }

  function parsed(): { frontmatter: CardFrontmatter; html: string } | null {
    if (!view.cardText) return null;
    try {
      const card = parseCard(view.cardText);
      return { frontmatter: card.frontmatter, html: renderMarkdown(card.bodyMarkdown) };
    } catch {
      return null;
    }
  }

  const shown = $derived(parsed());

  async function act(run: () => Promise<void>): Promise<void> {
    await run();
    pull();
  }

  void act(() => session.open());
</script>

<HudPanel title="教學卡" {controls} fill>
  {#if view.busyNotice}
    <p class="notice">{view.busyNotice}</p>
  {/if}

  {#if view.state === 'loading'}
    <p>載入中…</p>
  {:else if view.state === 'error'}
    <p class="error">{view.message}</p>
    {#if view.canRetry}
      <HudButton onclick={() => void act(() => session.retry())} disabled={view.controlsDisabled}>再試一次</HudButton>
    {/if}
  {:else if view.state === 'categories'}
    <div class="list">
      {#each view.categories as row (row.id)}
        <HudButton onclick={() => void act(() => session.chooseCategory(row.id))} disabled={view.controlsDisabled}>
          {row.label}
        </HudButton>
      {/each}
      <HudButton onclick={() => { session.cancelCategories(); pull(); }} disabled={view.controlsDisabled}>取消</HudButton>
    </div>
  {:else if view.state === 'finished'}
    <p class="finished">{view.message}</p>
    <div class="controls">
      <HudButton onclick={() => { session.openCategories(); pull(); }} disabled={view.controlsDisabled}>換類別</HudButton>
    </div>
  {:else if view.state === 'card' && shown}
    <header class="markers">
      <span class="category">{shown.frontmatter.category}</span>
      <span class="source">{shown.frontmatter.source === 'raw' ? '原始' : '生成'}</span>
      <span class="level">Level {shown.frontmatter.level}</span>
      {#if shown.frontmatter.provisional}
        <span class="badge">待審核</span>
      {/if}
    </header>
    {#if view.prereqs.length > 0}
      <p class="prereqs">
        先備還沒學:
        {#each view.prereqs as item, index (item.id)}
          <HudButton onclick={() => void act(() => session.followPrereq(index))} disabled={view.controlsDisabled}>
            {item.title}
          </HudButton>
        {/each}
      </p>
    {/if}
    <h2>{shown.frontmatter.title}</h2>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div class="body">{@html shown.html}</div>
    <div class="controls">
      {#if view.canNext}
        <HudButton onclick={() => void act(() => session.next())} disabled={view.controlsDisabled}>下一個</HudButton>
      {/if}
      <HudButton onclick={() => { session.openCategories(); pull(); }} disabled={view.controlsDisabled}>換類別</HudButton>
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
  .controls,
  .list,
  .prereqs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .prereqs {
    margin: 0.4rem 0 0;
  }
  .notice,
  .finished,
  .error {
    margin: 0.4rem 0;
  }
  :global(.lc-example) {
    background: var(--hud-solid);
    border-left: 1px solid var(--hud-line);
    padding: 0.5rem 1rem;
    margin: 1rem 0;
  }
</style>
