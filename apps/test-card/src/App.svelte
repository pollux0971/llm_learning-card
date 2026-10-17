<script lang="ts">
  // 考試卡 UI。判斷在側車,這裡只顯示與收輸入(FEATURE.md 的範圍)。
  import { TestSession, type SessionDeps, type SessionView } from './session.js';
  import '@learning/ui-shared/hud/hud.css';
  import HpBar from '@learning/ui-shared/hud/HpBar.svelte';
  import HudButton from '@learning/ui-shared/hud/HudButton.svelte';
  import HudField from '@learning/ui-shared/hud/HudField.svelte';
  import HudPanel from '@learning/ui-shared/hud/HudPanel.svelte';
  import { createWindowControls } from '@learning/ui-shared/hud/window-controls';

  let { deps }: { deps: SessionDeps } = $props();

  const session = new TestSession(deps);
  const controls = createWindowControls();

  let view = $state<SessionView>(session.getView());
  let fillInputs = $state<string[]>([]);
  let applyInput = $state('');
  let slowNotice = $state(false);
  let firstInputEl = $state<HTMLInputElement | undefined>();
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  function blankSlots(n: number): number[] {
    const slots: number[] = [];
    for (let i = 0; i < n; i += 1) slots.push(i);
    return slots;
  }

  function pull(): void {
    view = session.getView();
  }

  function resetInputs(): void {
    const current = view.current;
    if (current?.type === 'fill') {
      const next: string[] = [];
      for (let i = 0; i < current.blanks; i += 1) next.push('');
      fillInputs = next;
    } else {
      fillInputs = [];
    }
    applyInput = '';
  }

  async function init(): Promise<void> {
    await session.init();
    pull();
    resetInputs();
  }

  init();

  $effect(() => {
    view.current;
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
    if (view.submitting) return;
    startSlowTimer();
    await session.submitFill(fillInputs);
    stopSlowTimer();
    pull();
  }

  async function submitApply(): Promise<void> {
    if (view.submitting) return;
    startSlowTimer();
    await session.submitApply(applyInput);
    stopSlowTimer();
    pull();
  }

  function handleFillKeydown(event: KeyboardEvent): void {
    if (session.decideKeydown(event.key) === 'submit') {
      event.preventDefault();
      void submitFill();
    }
  }

  function handleApplyKeydown(event: KeyboardEvent): void {
    const action = session.decideKeydown(event.key, { ctrl: event.ctrlKey, meta: event.metaKey });
    if (action === 'submit') {
      event.preventDefault();
      void submitApply();
    }
    // action === 'newline':什麼都不做,讓 textarea 的預設換行行為發生
  }

  async function next(): Promise<void> {
    await session.next();
    pull();
    resetInputs();
  }

  async function restart(): Promise<void> {
    await init();
  }
</script>

<HudPanel title="考試卡" {controls} fill>
  {#if view.testModeNotice}
    <p class="test-mode">{view.testModeNotice}</p>
  {/if}

  {#if view.state === 'loading'}
    <p>載入中…</p>
  {:else if view.state === 'paused' || view.state === 'empty' || view.state === 'done' || view.state === 'error'}
    <p class={view.state}>{view.message}</p>
    {#if view.canRestart}
      <HudButton onclick={restart}>重新開始</HudButton>
    {/if}
  {:else if view.state === 'reteach' && view.reteach}
    {#if view.reteach.notice}
      <p class="notice">{view.reteach.notice}</p>
    {/if}
    <pre class="reteach">{view.reteach.text}</pre>
    <HudButton onclick={next}>繼續</HudButton>
  {:else if view.state === 'question' && view.current}
    <header class="progress">
      <span>{view.answeredCount} / {view.totalCount}</span>
      <HpBar done={view.answeredCount} total={view.totalCount} />
    </header>

    {#if view.current.type === 'fill'}
      <p class="prompt">{view.current.prompt}</p>
      <div class="blanks">
        {#each blankSlots(view.current.blanks) as i (i)}
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
      {#if !(view.result && !view.gradingError)}
        <div class="submit">
          <HudButton onclick={submitFill} disabled={view.submitting}>送出</HudButton>
        </div>
      {/if}
    {:else if view.current.type === 'apply'}
      <p class="prompt">{view.current.prompt}</p>
      <HudField>
        <textarea rows="6" bind:value={applyInput} onkeydown={handleApplyKeydown} disabled={view.submitting}></textarea>
      </HudField>
      {#if !(view.result && !view.gradingError)}
        <div class="submit">
          <HudButton onclick={submitApply} disabled={view.submitting}>送出</HudButton>
        </div>
      {/if}
    {/if}

    {#if view.submitting}
      <p class="loading">評分中…{#if slowNotice}(仍在處理,請稍候){/if}</p>
    {/if}

    {#if view.gradingError}
      <p class="error">評分失敗,請再試一次</p>
    {/if}

    {#if view.result && !view.gradingError}
      <p class={view.result.pass ? 'pass' : 'fail'} data-result={view.result.pass ? 'pass' : 'fail'}>{view.result.pass ? '✓ 答對了' : '× 答錯了'}</p>
      <p class="feedback">{view.result.feedback}</p>
      {#if view.result.correctAnswers}
        <p class="correct">正確答案:{view.result.correctAnswers.join('、')}</p>
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
  .prompt {
    margin: 0.55rem 0;
  }
  .submit {
    margin-top: 0.75rem;
  }
  .pass {
    color: var(--hud-pass);
  }
  .fail,
  .error,
  .test-mode,
  .notice {
    color: var(--hud-fail);
  }
  .test-mode,
  .notice {
    margin: 0.2rem 0;
  }
  .reteach {
    white-space: pre-wrap;
    margin: 0.55rem 0;
    font: inherit;
  }
</style>
