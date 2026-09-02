<script lang="ts">
  // phase-1:考試卡 UI。判斷邏輯在 session.ts,這裡只顯示與收輸入(FEATURE.md 的範圍)。
  import { MemoryFs } from './stubs/memory-fs.js';
  import { buildFsSeed, TODAY } from './stubs/fixtures.js';
  import { selectDue, advance } from './stubs/scheduler.js';
  import { StubGrader } from './stubs/grader.js';
  import { loadQuestions, loadReviews, loadDailyCap } from './stubs/loader.js';
  import { TestSession, type SessionView } from './session.js';

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

<main>
  <h1>考試卡</h1>

  {#if !view}
    <p>載入中…</p>
  {:else if view.isEmpty}
    <p class="empty">今天沒有到期的複習,休息一下。</p>
  {:else if view.done}
    <p class="done">今天的複習都做完了。</p>
  {:else if view.current}
    <header class="progress">
      <span>{view.answeredCount} / {view.totalCount}</span>
    </header>

    {#if view.current.type === 'fill' && view.current.fill}
      <p class="prompt">{view.current.fill.prompt}</p>
      <div class="blanks">
        {#each view.current.fill.answers as _blank, i (i)}
          {#if i === 0}
            <input
              type="text"
              bind:value={fillInputs[i]}
              bind:this={firstInputEl}
              onkeydown={handleFillKeydown}
              disabled={view.submitting}
            />
          {:else}
            <input type="text" bind:value={fillInputs[i]} onkeydown={handleFillKeydown} disabled={view.submitting} />
          {/if}
        {/each}
      </div>
    {:else if view.current.type === 'apply' && view.current.apply}
      <p class="prompt">{view.current.apply.prompt}</p>
      <textarea rows="6" bind:value={applyInput} onkeydown={handleApplyKeydown} disabled={view.submitting}
      ></textarea>
    {/if}

    {#if view.submitting}
      <p class="loading">評分中…{#if slowNotice}(仍在處理,請稍候){/if}</p>
    {/if}

    {#if view.error}
      <p class="error">評分失敗,請再試一次</p>
    {/if}

    {#if view.result && !view.error}
      <p class={view.result.pass ? 'pass' : 'fail'}>{view.result.pass ? '答對了' : '答錯了'}</p>
      <p class="feedback">{view.result.feedback}</p>
      {#if view.correctAnswers}
        <p class="correct">正確答案:{view.correctAnswers.join('、')}</p>
      {/if}
      <button onclick={next}>下一題</button>
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 32rem;
    margin: 2rem auto;
    font-family: system-ui, sans-serif;
  }
  .blanks {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  textarea {
    width: 100%;
    font: inherit;
  }
  .pass {
    color: #1a7f37;
  }
  .fail,
  .error {
    color: #d1242f;
  }
</style>
