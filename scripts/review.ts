/**
 * 11-review-cli 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/review.ts --dir <learning 目錄> --today <YYYY-MM-DD> [--dry-run]
 *
 * 這一輪只寫參數解析骨架(尤其是 --dry-run)與接線,互動問答迴圈
 * (presentNextCard → readline 收輸入 → submitAnswer)留給下一輪實作——
 * packages/core/src/session/ 底下的函式這一輪全部 throw not implemented,
 * 這裡呼叫到就會照實丟出來,不假裝能跑。
 *
 * --dry-run 不進互動迴圈,只建立 session 再印出清單,對照
 * phase-1.feature「Listing what is due without answering anything」與
 * FEATURE.md 的單獨執行範例。
 */
import { resolve } from 'node:path';
import { FakeLlmRouter, loadFixturesFromDir } from '../packages/core/src/grading/index.js';
import { buildTodaySession } from '../packages/core/src/session/build.js';
import { renderDryRun } from '../packages/core/src/session/summary.js';

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

async function main(): Promise<void> {
  const dir = arg('--dir');
  const today = arg('--today');
  const dryRun = process.argv.includes('--dry-run');

  if (!dir || !today) {
    usageError('缺少 --dir 或 --today。');
  }

  const router = new FakeLlmRouter(loadFixturesFromDir(resolve(ROOT, 'contracts/fixtures/llm')));
  const session = await buildTodaySession({ learningDir: dir, today, router });

  if (dryRun) {
    const due = session.queue.map((d) => ({ card: d.card, stage: d.stage, overdueDays: d.overdue_days }));
    console.log(renderDryRun(due));
    return;
  }

  // 互動問答迴圈(presentNextCard → readline 收輸入 → submitAnswer → 迴圈直到
  // 'done',結束時印 renderSummary)是下一輪的範圍,這裡先不做。
  throw new Error('互動模式尚未實作:下一輪要接上 node:readline,把每一行輸入餵給 submitAnswer。');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
