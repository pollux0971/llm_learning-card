/**
 * 11-review-cli 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run] [--pause | --unpause]
 *
 * 檢查順序(早的先擋):
 *   1. 參數不全,或 --pause 與 --unpause 同時給 → 用法錯誤(1)
 *   2. 磁碟上 0 張卡 → 「沒有卡片」(1)
 *   3. --pause / --dry-run 處理完就結束;--unpause 只把暫停關掉,然後繼續
 *   4. 今天的快取標記為暫停 → 印暫停訊息,退出碼 0(在查帳本之前)
 *   5. 互動模式查帳本(失敗退出碼 2)
 *   6. 讀或建當日快取 → 答題 → 小結 → 本次作答 ≥ 1 題才 snapshot
 *
 * --dry-run 不建、不改快取,不評分,不需要指標檔。
 */
import './_env.js';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import {
  createLiveGatewayRouter,
  defaultVaultDeps,
  resolveVerifiedLedger,
} from '../packages/core/src/llm/index.js';
import type { LlmRouter } from '../packages/core/src/grading/types.js';
import { buildDueList } from '../packages/core/src/scheduler/index.js';
import { nextCalendarDay } from '../packages/core/src/schema/review.js';
import { snapshotLearningDir } from '../packages/core/src/schema/git-repo.js';
import { buildTodaySession, dropAnsweredToday, dueItemsFromCache } from '../packages/core/src/session/build.js';
import {
  readSessionCache,
  toSessionCache,
  warnInvalidSessionCache,
  writeSessionCache,
  type SessionCache,
} from '../packages/core/src/session/cache.js';
import { presentNextCard } from '../packages/core/src/session/present.js';
import { joinApplyLines, submitAnswer } from '../packages/core/src/session/answer.js';
import { listCardIds, loadReviews, loadSettings } from '../packages/core/src/session/io.js';
import {
  estimateTomorrow,
  renderDeferred,
  renderDryRun,
  renderDryRunHeader,
  renderNoCards,
  renderSummary,
  tallyToday,
} from '../packages/core/src/session/summary.js';
import type { Session, SessionSummaryInput } from '../packages/core/src/session/types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usageError(message: string): never {
  console.error(message);
  console.error('用法: review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run] [--pause | --unpause]');
  process.exit(1);
}

/** --dry-run / --pause 永遠不評分。被呼叫就丟錯,避免悄悄走一條會花錢的路。 */
function refusingRouter(): LlmRouter {
  const refuse = async (): Promise<never> => {
    throw new Error('dry-run 不評分,不該呼叫 router');
  };
  return {
    call: refuse,
    probeOnline: refuse,
    probeLocal: refuse,
  };
}

/**
 * 互動模式的 router。帳本只來自驗證過的指標檔,跟 scripts/llm.ts 同一條真呼叫路。
 * 失敗印 message、退出碼 2,不建 session。
 */
function liveRouterOrExit(): LlmRouter {
  const resolved = resolveVerifiedLedger(defaultVaultDeps());
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exit(2);
  }
  return createLiveGatewayRouter({ ledger: resolved.ledger });
}

function bindQuit(rl: ReturnType<typeof createInterface>): AbortSignal {
  const ac = new AbortController();
  rl.on('close', () => ac.abort());
  return ac.signal;
}

/** stdin 關掉(使用者離開)時 question() 會一直掛著,所以用 close → abort 把它變成「沒答」。 */
async function ask(rl: ReturnType<typeof createInterface>, prompt: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    return await rl.question(prompt, { signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return undefined;
    throw err;
  }
}

/** 回傳這一次執行送出的題數(填空、應用各算 1;批改失敗也算,因為使用者答了)。 */
async function runInteractive(session: Session, rl: ReturnType<typeof createInterface>, signal: AbortSignal): Promise<number> {
  let answered = 0;
  for (;;) {
    const presentation = await presentNextCard(session);
    if (presentation.kind === 'done') break;

    if (presentation.kind === 'reteach') {
      const missing = presentation.usedOriginal === true ? '(沒有縮短版,以下是原卡)' : '';
      console.log(`\n[複習提示,先看過再回答問題] ${presentation.card}${missing}`);
      console.log(presentation.shortBody);
      continue;
    }

    const stuckNote = presentation.stuck ? '  (這張卡已經連續答錯 3 次以上)' : '';
    console.log(`\n(${presentation.progress.index}/${presentation.progress.total}) ${presentation.prompt}${stuckNote}`);

    let rawAnswer: string;
    if (presentation.type === 'fill') {
      const line = await ask(rl, `請輸入 ${presentation.blanks ?? 0} 個答案,用逗號分隔:`, signal);
      if (line === undefined) break;
      rawAnswer = line;
    } else {
      console.log('請輸入你的回答,可以分多行,輸入空行結束:');
      const lines: string[] = [];
      let quit = false;
      for (;;) {
        const line = await ask(rl, '', signal);
        if (line === undefined) {
          quit = true;
          break;
        }
        if (line === '') break;
        lines.push(line);
      }
      if (quit) break;
      rawAnswer = joinApplyLines(lines);
    }

    answered += 1;
    const outcome = await submitAnswer(session, rawAnswer);
    console.log(outcome.feedback);
  }
  return answered;
}

function cacheFromSession(session: Session, paused: boolean): SessionCache {
  return toSessionCache({
    date: session.today,
    paused,
    totalDue: session.totalDue,
    deferred: session.deferred,
    queue: session.queue,
    reteach: session.reteachQueue,
  });
}

async function buildAndStore(dir: string, today: string, router: LlmRouter, paused: boolean): Promise<SessionCache> {
  const session = await buildTodaySession({ learningDir: dir, today, router });
  const cache = cacheFromSession(session, paused);
  writeSessionCache(dir, cache);
  return cache;
}

function sessionFromCache(dir: string, today: string, router: LlmRouter, cache: SessionCache): Session {
  const reviews = loadReviews(dir);
  const settings = loadSettings(dir);
  return {
    learningDir: dir,
    today,
    dailyCap: settings.daily_cap,
    router,
    queue: dropAnsweredToday(dueItemsFromCache(cache.queue, reviews), reviews, today),
    reteachQueue: [...cache.reteach],
    totalDue: cache.total_due,
    deferred: cache.deferred,
    passed: 0,
    failed: 0,
    errors: 0,
    current: undefined,
  };
}

function printPhase1DryRun(dir: string, cardIds: string[], session: Session): void {
  const deferredLine = renderDeferred(session.deferred, session.dailyCap);
  if (deferredLine !== undefined) console.log(deferredLine);
  const reviews = loadReviews(dir);
  const unscheduled = cardIds.filter((id) => !(id in reviews)).length;
  const due = session.queue.map((d) => ({ card: d.card, stage: d.stage, overdueDays: d.overdue_days }));
  console.log(renderDryRunHeader({ cards: cardIds.length, due: due.length, unscheduled }));
  console.log(renderDryRun(due));
}

async function runDryRun(dir: string, today: string, cardIds: string[]): Promise<void> {
  const prior = readSessionCache(dir, today);
  if (prior.kind === 'ok') {
    const reviews = loadReviews(dir);
    const remaining = prior.cache.queue.filter((item) => !(reviews[item.card]?.history ?? []).some((entry) => entry.date === today));
    const answered = prior.cache.queue.length - remaining.length;
    const settings = loadSettings(dir);
    const deferredLine = renderDeferred(prior.cache.deferred, settings.daily_cap);
    if (deferredLine !== undefined) console.log(deferredLine);
    console.log(`已答 ${answered} / 共 ${prior.cache.total_due}`);
    if (remaining.length === 0) console.log('剩下的題目都答完了。');
    else console.log(renderDryRun(remaining.map((d) => ({ card: d.card, stage: d.stage, overdueDays: d.overdue_days }))));
    return;
  }
  if (prior.kind === 'invalid' || prior.kind === 'stale') {
    console.error('快取無法讀取,改以現在的到期清單列出。');
  }
  const session = await buildTodaySession({ learningDir: dir, today, router: refusingRouter() });
  printPhase1DryRun(dir, cardIds, session);
}

/** snapshot 失敗不改退出碼、不丟錯。not-a-repo 的 hint 已含 cli.ts init。 */
function snapshotQuietly(dir: string, today: string): void {
  try {
    const [y, m, d] = today.split('-').map(Number);
    const result = snapshotLearningDir(dir, { today: new Date(y ?? 0, (m ?? 1) - 1, d ?? 1) });
    if (result.status === 'committed' || result.status === 'no-changes') return;
    console.error(result.hint ?? `snapshot 失敗:${result.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`snapshot 失敗:${message}`);
  }
}

async function main(): Promise<void> {
  const dir = arg('--dir');
  const today = arg('--today');
  const dryRun = process.argv.includes('--dry-run');
  const pause = process.argv.includes('--pause');
  const unpause = process.argv.includes('--unpause');

  if (!dir || !today) usageError('缺少 --dir 或 --today。');
  if (pause && unpause) usageError('--pause 與 --unpause 不能同時使用。');

  const cardIds = listCardIds(dir);
  if (cardIds.length === 0) {
    console.error(renderNoCards(join(dir, 'cards')));
    process.exit(1);
  }

  if (pause) {
    const prior = readSessionCache(dir, today);
    if (prior.kind === 'ok') {
      writeSessionCache(dir, { ...prior.cache, paused: true });
    } else {
      if (prior.kind === 'invalid') warnInvalidSessionCache(dir, today);
      await buildAndStore(dir, today, refusingRouter(), true);
    }
    console.log('今天已暫停');
    return;
  }

  if (dryRun) {
    await runDryRun(dir, today, cardIds);
    return;
  }

  const prior = readSessionCache(dir, today);
  let resumed = prior.kind === 'ok';
  let loaded: SessionCache | undefined = prior.kind === 'ok' ? prior.cache : undefined;
  if (unpause) {
    if (loaded) {
      loaded = { ...loaded, paused: false };
      writeSessionCache(dir, loaded);
    }
    console.log('已恢復今天的複習');
  } else if (loaded?.paused) {
    console.log('今天已暫停,要繼續請加 --unpause');
    return;
  }

  const router = liveRouterOrExit();
  if (!loaded) {
    if (prior.kind === 'invalid') warnInvalidSessionCache(dir, today);
    loaded = await buildAndStore(dir, today, router, false);
    resumed = false;
  }

  const session = sessionFromCache(dir, today, router, loaded);
  const deferredLine = renderDeferred(session.deferred, session.dailyCap);
  if (deferredLine !== undefined) console.log(deferredLine);

  if (session.totalDue === 0 && session.reteachQueue.length === 0) {
    console.log(renderDryRun([]));
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const signal = bindQuit(rl);
  let answeredThisRun = 0;
  try {
    answeredThisRun = await runInteractive(session, rl, signal);
  } finally {
    rl.close();
  }

  const reviews = loadReviews(dir);
  const tally = tallyToday(loaded.queue.map((item) => item.card), reviews, today);
  const tomorrow = nextCalendarDay(today);
  const dueTomorrowAll = buildDueList(reviews as unknown as Parameters<typeof buildDueList>[0], tomorrow).length;
  const estimate = estimateTomorrow({
    dueTomorrowExcludingReturns: Math.max(0, dueTomorrowAll - tally.returned),
    returnedToday: tally.returned,
    dailyCap: session.dailyCap,
  });
  const summaryInput: SessionSummaryInput = {
    passed: tally.passed,
    failed: tally.returned,
    errors: 0,
    tomorrow: estimate,
    retryLater: tally.retryLater,
  };
  if (resumed) summaryInput.answeredThisRun = answeredThisRun;
  console.log(`\n${renderSummary(summaryInput)}`);
  if (answeredThisRun >= 1) snapshotQuietly(dir, today);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
