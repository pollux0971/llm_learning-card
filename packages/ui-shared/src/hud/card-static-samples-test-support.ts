/**
 * 14-hud-skin phase-2(工單 T15)靜態掃描的「自測」用範例:兩張卡 App.svelte 的**預期樣子**(最小可行版)。
 * 測試 agent 寫;開發 worker 不改。用途:證明掃描器對一份正確的原始碼回傳 0 個問題,
 * 並且對每一種改壞的版本都抓得到(card-static-self.test.ts)。這不是實作,卡片的真檔不由這裡產生。
 */
/** boundaries 掃描器會把字串裡的 import 當真的 import 掃;07 的根在這裡拆開寫 */
const UI_ROOT = ['@learning', 'ui-shared'].join('/');

export const GOOD_MAIN = `import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
`;

export const GOOD_TEACH_APP = `<script lang="ts">
  import { onMount } from 'svelte';
  import { renderMarkdown } from '${UI_ROOT}';
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

<HudPanel title="教學卡" controls={createWindowControls()} fill>
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
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--hud-text);
  }
  .badge {
    color: var(--hud-text);
    background: var(--hud-accent-wash);
    padding: 0 0.4rem;
  }
  :global(.lc-example) {
    background: var(--hud-solid);
    border-left: 3px solid var(--hud-line);
    padding: 0.5rem 1rem;
    margin: 1rem 0;
  }
</style>
`;

export const GOOD_TEST_APP = `<script lang="ts">
  // phase-1:考試卡 UI。判斷邏輯在 session.ts,這裡只顯示與收輸入(FEATURE.md 的範圍)。
  import { MemoryFs } from './stubs/memory-fs.js';
  import { buildFsSeed, TODAY } from './stubs/fixtures.js';
  import { selectDue, advance } from './stubs/scheduler.js';
  import { StubGrader } from './stubs/grader.js';
  import { loadQuestions, loadReviews, loadDailyCap } from './stubs/loader.js';
  import { TestSession, type SessionView } from './session.js';
  import '@learning/ui-shared/hud/hud.css';
  import HpBar from '@learning/ui-shared/hud/HpBar.svelte';
  import HudButton from '@learning/ui-shared/hud/HudButton.svelte';
  import HudField from '@learning/ui-shared/hud/HudField.svelte';
  import HudPanel from '@learning/ui-shared/hud/HudPanel.svelte';
  import { createWindowControls } from '@learning/ui-shared/hud/window-controls';

  let session: TestSession | undefined;
  let view = $state<SessionView | undefined>(undefined);
  let fillInputs = $state<string[]>([]);
  let applyInput = $state('');
  let slowNotice = $state(false);
  let firstInputEl = $state<HTMLInputElement | undefined>();
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  const grader = new StubGrader();

  async function init(): Promise<void> {
    const fs = new MemoryFs(buildFsSeed());
    const reviews = await loadReviews(fs);
    const dailyCap = await loadDailyCap(fs);
    const { due } = selectDue(reviews, TODAY, dailyCap);
    const questions = await loadQuestions(
      fs,
      due.map((d) => d.card),
    );
    session = new TestSession({ due, questions, grader, advance, today: TODAY });
    refresh();
  }

  function refresh(): void {
    if (!session) return;
    view = session.getView();
    const current = view.current;
    fillInputs = current?.type === 'fill' && current.fill ? current.fill.answers.map(() => '') : [];
    applyInput = '';
  }

  init();

  $effect(() => {
    view?.current;
    firstInputEl?.focus();
  });

  function startSlowTimer(): void {
    slowNotice = false;
    slowTimer = setTimeout(() => {
      slowNotice = true;
    }, 3000);
  }

  function stopSlowTimer(): void {
    if (slowTimer) clearTimeout(slowTimer);
    slowNotice = false;
  }

  async function submitFill(): Promise<void> {
    if (!session) return;
    startSlowTimer();
    await session.submitFill(fillInputs);
    stopSlowTimer();
    refresh();
  }

  async function submitApply(): Promise<void> {
    if (!session) return;
    startSlowTimer();
    await session.submitApply(applyInput);
    stopSlowTimer();
    refresh();
  }

  function handleFillKeydown(event: KeyboardEvent): void {
    if (!session) return;
    if (session.decideKeydown(event.key) === 'submit') {
      event.preventDefault();
      void submitFill();
    }
  }

  function handleApplyKeydown(event: KeyboardEvent): void {
    if (!session) return;
    const action = session.decideKeydown(event.key, { ctrl: event.ctrlKey, meta: event.metaKey });
    if (action === 'submit') {
      event.preventDefault();
      void submitApply();
    }
    // action === 'newline':什麼都不做,讓 textarea 的預設換行行為發生
  }

  function next(): void {
    session?.next();
    refresh();
  }
</script>

<HudPanel title="考試卡" controls={createWindowControls()} fill>
  {#if !view}
    <p>載入中…</p>
  {:else if view.isEmpty}
    <p class="empty">今天沒有到期的複習,休息一下。</p>
  {:else if view.done}
    <p class="done">今天的複習都做完了。</p>
  {:else if view.current}
    <header class="progress">
      <span>{view.answeredCount} / {view.totalCount}</span>
      <HpBar done={view.answeredCount} total={view.totalCount} />
    </header>

    {#if view.current.type === 'fill' && view.current.fill}
      <p class="prompt">{view.current.fill.prompt}</p>
      <div class="blanks">
        {#each view.current.fill.answers as _blank, i (i)}
          {#if i === 0}
            <HudField>
              <input
                type="text"
                bind:value={fillInputs[i]}
                bind:this={firstInputEl}
                onkeydown={handleFillKeydown}
                disabled={view.submitting}
              />
            </HudField>
          {:else}
            <HudField>
              <input type="text" bind:value={fillInputs[i]} onkeydown={handleFillKeydown} disabled={view.submitting} />
            </HudField>
          {/if}
        {/each}
      </div>
      {#if !(view.result && !view.error)}
        <HudButton onclick={submitFill} disabled={view.submitting}>送出</HudButton>
      {/if}
    {:else if view.current.type === 'apply' && view.current.apply}
      <p class="prompt">{view.current.apply.prompt}</p>
      <HudField>
        <textarea rows="6" bind:value={applyInput} onkeydown={handleApplyKeydown} disabled={view.submitting}
        ></textarea>
      </HudField>
      {#if !(view.result && !view.error)}
        <HudButton onclick={submitApply} disabled={view.submitting}>送出</HudButton>
      {/if}
    {/if}

    {#if view.submitting}
      <p class="loading">評分中…{#if slowNotice}(仍在處理,請稍候){/if}</p>
    {/if}

    {#if view.error}
      <p class="error">{view.gradingError}</p>
    {/if}

    {#if view.result && !view.error}
      <p class={view.result.pass ? 'pass' : 'fail'} data-result={view.result.pass ? 'pass' : 'fail'}>{view.result.pass ? '✓ 答對了' : '× 答錯了'}</p>
      <p class="feedback">{view.result.feedback}</p>
      {#if view.correctAnswers}
        <p class="correct">正確答案:{view.correctAnswers.join('、')}</p>
      {/if}
      <HudButton onclick={next}>下一題</HudButton>
    {/if}
  {/if}
</HudPanel>

<style>
  .blanks {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .progress {
    display: grid;
    gap: 0.2rem;
  }
  .pass {
    color: var(--hud-pass);
  }
  .fail,
  .error {
    color: var(--hud-fail);
  }
</style>
`;
