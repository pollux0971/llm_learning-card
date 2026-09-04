/**
 * 04-scheduler 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/due.ts --state <reviews.json> --today <YYYY-MM-DD>
 *
 * **三種 0 要分得出來。** 修之前,一份空的 `{}` 跟「你有 40 張卡,今天剛好都不用
 * 複習」講同一句話、同一個退出碼:
 *
 *     $ npx tsx scripts/due.ts --state <內容是 {} 的檔> --today 2026-09-10
 *     2026-09-10 沒有到期的卡片        >>> exit=0
 *
 * 第一種是「你的複習資料不見了」(init 之後還沒讀書、原子寫入寫壞、或路徑指到別的
 * 檔),第二種是「今天放假」。缺檔與壞檔更糟,直接噴 node 的 stack trace。
 *
 * 形狀跟 `boundaries` 的「掃描 195 個檔案」同一套:**算得成的時候要印出分母**,
 * 算不成的時候三句話兩兩不同。
 *
 * 退出碼:
 *   0  讀到 N ≥ 1 張卡而且算完了(今天到期幾張都算成功,包含 0 張)
 *   1  沒算成:沒給參數、檔案不存在、不是合法 JSON、不是 Review 表、或空表
 *
 * 1 這個碼是照 lint / weekly 這一批的共同約定選的,不是 due.ts 自創。
 *
 * P-50:讀 `state/` 的入口一律用 schema 驗過再用,不准 `as Review`、不准 `?? {}`。
 * 這裡用契約自己的 `ReviewSchema`(§4),不是自己寫一份結構檢查——自己寫的那份
 * 會跟契約漂開,而漂開的方向剛好是「放行壞資料」。
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ReviewSchema } from '@contracts/index.js';
import { buildDueList } from '../packages/core/src/scheduler/index.js';
import type { CardId, Review } from '../packages/core/src/scheduler/index.js';

/** 契約 §4 的 `state/reviews.json`:卡片 id → Review。 */
const ReviewTableSchema = z.record(z.string(), ReviewSchema);

/** 檔案內容出現在訊息裡時只印這麼多——reviews.json 可能好幾百 KB。 */
const PREVIEW_CHARS = 80;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 算不成的共同出口:一句人話 + exit 1,不噴 stack。 */
function fail(lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const statePath = arg('--state');
const today = arg('--today');

if (!statePath || !today) {
  fail(['用法: due.ts --state <reviews.json> --today <YYYY-MM-DD>']);
}

let raw: string;
try {
  raw = readFileSync(statePath, 'utf8');
} catch (err) {
  fail([
    `✗ due: 讀不到 --state 指定的檔案:${statePath}`,
    `  ${err instanceof Error ? err.message : String(err)}`,
  ]);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  fail([
    `✗ due: --state 指定的檔案不是合法的 JSON:${statePath}`,
    `  ${err instanceof Error ? err.message : String(err)}`,
    `  它開頭長這樣:${raw.slice(0, PREVIEW_CHARS)}`,
  ]);
}

// 合法 JSON 但不是 Review 表(`[]`、`null`、`"hi"`、值不是 Review 的物件)。
// 原本是 `JSON.parse(...) as Record<CardId, Review>` —— 用 cast 假裝驗過了,
// 結果不是憑空捏造出「沒有到期」就是在 buildDueList 深處噴 stack。
const table = ReviewTableSchema.safeParse(parsed);
if (!table.success) {
  const first = table.error.issues[0];
  fail([
    `✗ due: ${statePath} 不是一份 reviews.json(契約 §4 的 Review 表:卡片 id → Review)`,
    `  它實際是:${raw.slice(0, PREVIEW_CHARS)}`,
    `  第一個對不上的地方:${first ? `${first.path.join('.') || '(根)'}: ${first.message}` : '(無)'}`,
  ]);
}

const cardCount = Object.keys(table.data).length;
if (cardCount === 0) {
  // 空表**不是**「今天剛好都不用複習」。這裡刻意不講那句話,連提都不提——
  // 那句話一旦出現在畫面上,使用者就會把它當成結論。
  fail([
    `✗ due: ${statePath} 讀到 0 張卡,是一份空的複習表`,
    '  這不是「今天沒事」,是「沒有複習資料可以算」。',
    '  剛 init 完是正常的;不是的話,檢查路徑有沒有指錯、或 state/ 有沒有被寫壞。',
  ]);
}

// schema 驗過了,兩邊的 Review 是同一個形狀(契約 §4 對 scheduler/types.ts),
// 只是宣告在兩個地方(scheduler 那份說明了 Wave 0 不 import contracts 的理由)。
// 這個 cast 是接兩份宣告,不是跳過驗證。
const reviews = table.data as unknown as Record<CardId, Review>;
const due = buildDueList(reviews, today);

if (due.length === 0) {
  console.log(`${today} 沒有到期的卡片(讀到 ${cardCount} 張卡)`);
} else {
  console.log(`${today} 到期 ${due.length} 張(讀到 ${cardCount} 張卡):`);
  for (const item of due) {
    const stuckTag = item.stuck ? '  STUCK' : '';
    console.log(
      `  ${item.card}  stage=${item.stage}  types=${item.types.join(',')}  overdue_days=${item.overdue_days}  overdue_ratio=${item.overdue_ratio.toFixed(3)}${stuckTag}`,
    );
  }
}
