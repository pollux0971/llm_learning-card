/**
 * scripts/weekly.ts — 08-weekly-goal 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/weekly.ts --state <path> --event learned|pass-d1|pass \
 *     --card <id> [--checkpoint <n>] [--today YYYY-MM-DD]
 *
 * 只讀 --state 指定的檔案,不寫回(phase-1 是純函式,不碰 state/ 的原子寫入)。
 * 輸出套用事件後的 Weekly 物件、是否達標、以及跨週時的 rollover 紀錄。
 * 退出碼:0 成功;1 參數錯誤或讀檔失敗。
 */
import { readFileSync } from 'node:fs';
import { format } from 'date-fns';
import { applyEvent, isTargetMet, isoWeekOf } from '../packages/core/src/weekly/index.js';
import type { Weekly, WeeklyEvent } from '../packages/core/src/weekly/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usageError(message: string): never {
  console.error(message);
  console.error(
    '用法: weekly.ts --state <path> --event learned|pass-d1|pass --card <id> [--checkpoint <n>] [--today YYYY-MM-DD]',
  );
  process.exit(1);
}

const statePath = arg('--state');
const eventName = arg('--event');
const card = arg('--card');
const checkpointArg = arg('--checkpoint');
const todayArg = arg('--today');

if (!statePath) usageError('缺少 --state');
if (!eventName) usageError('缺少 --event');

let weekly: Weekly;
try {
  weekly = JSON.parse(readFileSync(statePath, 'utf8')) as Weekly;
} catch (err) {
  usageError(`讀不到 --state 指定的檔案:${statePath}(${(err as Error).message})`);
}

let event: WeeklyEvent;
if (eventName === 'learned') {
  if (!card) usageError('--event learned 需要 --card');
  event = { type: 'learned', card };
} else if (eventName === 'pass-d1') {
  if (!card) usageError('--event pass-d1 需要 --card');
  event = { type: 'checkpoint-passed', card, checkpoint: 1 };
} else if (eventName === 'pass') {
  if (!card) usageError('--event pass 需要 --card');
  event = { type: 'checkpoint-passed', card, checkpoint: checkpointArg ? Number(checkpointArg) : 1 };
} else {
  usageError(`未知的 --event:${eventName}(可用 learned / pass-d1 / pass)`);
}

const today = todayArg ?? format(new Date(), 'yyyy-MM-dd');
const currentWeek = isoWeekOf(today);
const outcome = applyEvent(weekly, event, currentWeek);

console.log(
  JSON.stringify(
    {
      ...outcome.weekly,
      target_met: isTargetMet(outcome.weekly.passed_d1, outcome.weekly.target),
      rollover: outcome.rollover ?? null,
    },
    null,
    2,
  ),
);
