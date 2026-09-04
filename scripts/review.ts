/**
 * 11-review-cli 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run]
 *
 * --dry-run 不進互動迴圈,只建立 session 再印出清單,對照
 * phase-1.feature「Listing what is due without answering anything」與
 * FEATURE.md 的單獨執行範例。
 *
 * 互動模式:presentNextCard → node:readline 收輸入 → submitAnswer,循環直到
 * 'done',結束時印 renderSummary。填空單行(逗號分隔)、應用多行(空行結束)。
 */
import './_env.js';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { FakeLlmRouter, loadFixturesFromDir } from '../packages/core/src/grading/index.js';
import { buildDueList } from '../packages/core/src/scheduler/index.js';
import { nextCalendarDay } from '../packages/core/src/schema/review.js';
import { buildTodaySession } from '../packages/core/src/session/build.js';
import { presentNextCard } from '../packages/core/src/session/present.js';
import { joinApplyLines, submitAnswer } from '../packages/core/src/session/answer.js';
import { listCardIds, loadReviews } from '../packages/core/src/session/io.js';
import {
  estimateTomorrow,
  renderDryRun,
  renderDryRunHeader,
  renderNoCards,
  renderSummary,
} from '../packages/core/src/session/summary.js';
import type { Session } from '../packages/core/src/session/types.js';

const ROOT = resolve(import.meta.dirname, '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usageError(message: string): never {
  console.error(message);
  console.error('用法: review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run]');
  process.exit(1);
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
  // 要在 buildTodaySession 之前,因為卡片不見時排程本身也已經沒有意義了。
  const cardIds = listCardIds(dir);
  if (cardIds.length === 0) {
    console.error(renderNoCards(join(dir, 'cards')));
    process.exit(1);
  }

  const router = new FakeLlmRouter(loadFixturesFromDir(resolve(ROOT, 'contracts/fixtures/llm')));
  const session = await buildTodaySession({ learningDir: dir, today, router });

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
