/**
 * scripts/weekly.ts — 08-weekly-goal 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/weekly.ts --state <path> --event learned|pass-d1|pass \
 *     --card <id> [--checkpoint <n>] [--today YYYY-MM-DD]
 *
 * 只讀 --state 指定的檔案,不寫回(phase-1 是純函式,不碰 state/ 的原子寫入)。
 * 輸出套用事件後的 Weekly 物件、是否達標、以及跨週時的 rollover 紀錄。
 * 退出碼:0 成功;1 參數錯誤、讀檔失敗、或 --state 指到的東西不是一份 Weekly。
 *
 * ⚠️ **合法 JSON 但不是 Weekly 的檔,不可以被憑空補成一份看起來正常的進度。**
 * 修之前 `JSON.parse(...) as Weekly` 是用 cast 假裝驗過了,於是:
 *
 *     $ npx tsx scripts/weekly.ts --state <內容是 {} 的檔> --event pass-d1 --card sec-0001
 *     { "week": "2026-W37", "learned": 0, "passed_d1": 1, "counted": ["sec-0001"], ... }
 *     >>> exit=0
 *
 * `{}`、`[]`、`"hi"` 會讓 CLI **捏造**一份被事件改過、看起來有進度的假 Weekly。
 * 使用者看到「本週 1/undefined」,那讀起來像「這週還沒開始」而不是「你的資料壞了」——
 * 這一整批工單的形狀就是「把壞掉偽裝成正常的空狀態」,而 weekly 偽裝出來的甚至不是 0。
 *
 * 防線(P-50):所有讀 `state/` 與 `config/` 的入口一律 schema 驗過再用,
 * 不准 `as Weekly`、不准 `?? {}`。schema 見 packages/core/src/weekly/validate.ts。
 *
 * 注意「讀不到檔」那條路徑(檔案不存在 / 不是合法 JSON)本來就對:exit 1 + 一句
 * 人話。那不是這次要改的東西,weekly.test.ts 有兩條回歸測試鎖著它。
 */
import { readFileSync } from 'node:fs';
import { format } from 'date-fns';
import { applyEvent, isTargetMet, isoWeekOf, parseWeekly } from '../packages/core/src/weekly/index.js';
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

/** 檔案內容出現在訊息裡時只印這麼多——weekly.json 壞掉時可能是整份別的檔。 */
const PREVIEW_CHARS = 80;

let raw: string;
let parsed: unknown;
try {
  raw = readFileSync(statePath, 'utf8');
  parsed = JSON.parse(raw) as unknown;
} catch (err) {
  // 檔案不存在與不是合法 JSON 共用這一句(本來就是這樣,回歸測試鎖著)。
  usageError(`讀不到 --state 指定的檔案:${statePath}(${(err as Error).message})`);
}

// 合法 JSON 但不是 Weekly。訊息要說清楚**它實際是什麼**,不然使用者不知道自己
// 開錯了哪個檔;而且這裡刻意不吐任何 Weekly 形狀的東西出去(見 weekly.test.ts
// 的「不吐出一份 Weekly」),因為捏造出來的那份看起來完全正常。
const result = parseWeekly(parsed);
if (!result.ok) {
  const preview = raw.slice(0, PREVIEW_CHARS);
  console.error(`✗ weekly: --state 指到的檔不是一份 Weekly(契約 §9):${statePath}`);
  console.error(`  它實際是:${preview}`);
  console.error(`  第一個對不上的地方:${result.issue}`);
  console.error('  不會幫你補一份出來——補了就會印出一份看起來有進度的假紀錄。');
  process.exit(1);
}
const weekly: Weekly = result.weekly;

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
