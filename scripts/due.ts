/**
 * 04-scheduler 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/due.ts --state <reviews.json> --today <YYYY-MM-DD>
 */
import { readFileSync } from 'node:fs';
import { buildDueList } from '../packages/core/src/scheduler/index.js';
import type { CardId, Review } from '../packages/core/src/scheduler/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const statePath = arg('--state');
const today = arg('--today');

if (!statePath || !today) {
  console.error('用法: due.ts --state <reviews.json> --today <YYYY-MM-DD>');
  process.exit(1);
}

const reviews = JSON.parse(readFileSync(statePath, 'utf8')) as Record<CardId, Review>;
const due = buildDueList(reviews, today);

if (due.length === 0) {
  console.log(`${today} 沒有到期的卡片`);
} else {
  console.log(`${today} 到期 ${due.length} 張:`);
  for (const item of due) {
    const stuckTag = item.stuck ? '  STUCK' : '';
    console.log(
      `  ${item.card}  stage=${item.stage}  types=${item.types.join(',')}  overdue_days=${item.overdue_days}  overdue_ratio=${item.overdue_ratio.toFixed(3)}${stuckTag}`,
    );
  }
}
