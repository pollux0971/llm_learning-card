/**
 * 11-review-cli 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run]
 *
 * --dry-run 不進互動迴圈,只建立 session 再印出清單,對照
 * phase-1.feature「Listing what is due without answering anything」與
 * FEATURE.md 的單獨執行範例。不評分、不花錢,不需要指標檔。
 *
 * 互動模式:先確認帳本(指標檔驗證過的路徑),再 presentNextCard → node:readline
 * 收輸入 → submitAnswer,循環直到 'done',結束時印 renderSummary。
 * 填空單行(逗號分隔)、應用多行(空行結束)。
 *
 * 檢查順序(早的先擋):參數不全(退出碼 1)→ 磁碟上 0 張卡(退出碼 1)→
 * 互動模式才查帳本(失敗退出碼 2,今天有沒有卡到期都先查)。
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
import { buildTodaySession } from '../packages/core/src/session/build.js';
import { presentNextCard } from '../packages/core/src/session/present.js';
import { joinApplyLines, submitAnswer } from '../packages/core/src/session/answer.js';
import { listCardIds, loadReviews } from '../packages/core/src/session/io.js';
import {
  estimateTomorrow,
  renderDeferred,
  renderDryRun,
  renderDryRunHeader,
  renderNoCards,
  renderSummary,
} from '../packages/core/src/session/summary.js';
import type { Session } from '../packages/core/src/session/types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usageError(message: string): never {
  console.error(message);
  console.error('用法: review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run]');
  process.exit(1);
}

/** --dry-run 永遠不評分。被呼叫就丟錯,避免悄悄走一條會花錢的路。 */
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

async function runInteractive(session: Session, rl: ReturnType<typeof createInterface>): Promise<void> {
  for (;;) {
    const presentation = await presentNextCard(session);
    if (presentation.kind === 'done') break;

    if (presentation.kind === 'reteach') {
      console.log(`\n[複習提示,先看過再回答問題] ${presentation.card}`);
      console.log(presentation.shortBody);
      continue;
    }

    const stuckNote = presentation.stuck ? '  (這張卡已經連續答錯 3 次以上)' : '';
    console.log(`\n(${presentation.progress.index}/${presentation.progress.total}) ${presentation.prompt}${stuckNote}`);

    let rawAnswer: string;
    if (presentation.type === 'fill') {
      rawAnswer = await rl.question(`請輸入 ${presentation.blanks ?? 0} 個答案,用逗號分隔:`);
    } else {
      console.log('請輸入你的回答,可以分多行,輸入空行結束:');
      const lines: string[] = [];
      for (;;) {
        const line = await rl.question('');
        if (line === '') break;
        lines.push(line);
      }
      rawAnswer = joinApplyLines(lines);
    }

    const outcome = await submitAnswer(session, rawAnswer);
    console.log(outcome.feedback);
  }
}

async function main(): Promise<void> {
  const dir = arg('--dir');
  const today = arg('--today');
  const dryRun = process.argv.includes('--dry-run');

  if (!dir || !today) {
    usageError('缺少 --dir 或 --today。');
  }

  // 先數磁碟上有幾張卡,再建 session。0 張卡是異常狀態,不是空閒日——這個判斷
  // 要在 buildTodaySession 之前,也要早於帳本檢查:沒有指標檔時仍是退出碼 1,不是 2。
  const cardIds = listCardIds(dir);
  if (cardIds.length === 0) {
    console.error(renderNoCards(join(dir, 'cards')));
    process.exit(1);
  }

  // 互動模式不管今天有沒有卡到期都先查帳本(快速失敗)。--dry-run 不查、不建真 router。
  const router = dryRun ? refusingRouter() : liveRouterOrExit();
  const session = await buildTodaySession({ learningDir: dir, today, router });

  const deferredLine = renderDeferred(session.deferred, session.dailyCap);
  if (deferredLine !== undefined) console.log(deferredLine);

  if (dryRun) {
    // 未排程 = 磁碟上有卡、reviews.json 沒有紀錄。檔案不存在與檔案是 `{}` 對
    // 使用者是同一件事(都是「還沒開始複習」),loadReviews 已經把兩者都給成
    // `{}`,所以這裡算出來的數字也一樣,兩種輸出逐字相同。
    const reviews = loadReviews(dir);
    const unscheduled = cardIds.filter((id) => !(id in reviews)).length;
    const due = session.queue.map((d) => ({ card: d.card, stage: d.stage, overdueDays: d.overdue_days }));

    console.log(renderDryRunHeader({ cards: cardIds.length, due: due.length, unscheduled }));
    console.log(renderDryRun(due));
    return;
  }

  if (session.totalDue === 0 && session.reteachQueue.length === 0) {
    console.log(renderDryRun([]));
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runInteractive(session, rl);
  } finally {
    rl.close();
  }

  const tomorrow = nextCalendarDay(today);
  const dueTomorrowAll = buildDueList(loadReviews(dir) as unknown as Parameters<typeof buildDueList>[0], tomorrow).length;
  const dueTomorrowExcludingReturns = Math.max(0, dueTomorrowAll - session.failed);
  const estimate = estimateTomorrow({ dueTomorrowExcludingReturns, returnedToday: session.failed, dailyCap: session.dailyCap });
  console.log(`\n${renderSummary({ passed: session.passed, failed: session.failed, errors: session.errors, tomorrow: estimate })}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
