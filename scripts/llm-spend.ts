/**
 * CLI 入口:scripts/llm-spend.ts(ADR-039)。今天在 OpenAI 上花了多少。
 *
 *   npx tsx scripts/llm-spend.ts --today            # 印出今日金額與筆數
 *   npx tsx scripts/llm-spend.ts --today --json     # 同上,JSON 格式
 *   npx tsx scripts/llm-spend.ts --day 2026-09-03   # 指定某一天
 *   npx tsx scripts/llm-spend.ts --today --log path/to/log.jsonl
 *
 * **三態,三個退出碼**(不是兩態)。這支是 autopilot 每輪的預算煞車,也是「超過上限就
 * 問使用者」的唯一判斷依據,所以「算不出來」必須跟「還有預算」分得開:
 *
 *   0  算得出來,而且 `spent < cap`。訊息要帶 **log 路徑**與**今日條目筆數**,
 *      讓 `$0.00` 看得出是「有 log 但今天沒花」而不是「根本沒有 log」。
 *   1  算得出來,而且 `spent >= cap`(ADR-039 的邊界:剛好等於也算用完)。
 *   2  **算不出來**。只印 `算不出來:<原因>`,**絕不印任何「還有預算」的句子**,
 *      `--json` 也不吐 `usd` / `cap_usd`(下游拿到 `undefined` 而不是 0)。
 *
 * 觸發 2 的條件:log 檔不存在或不可讀、`LLM_DAILY_CAP_USD` 缺 / 空 / 非數字、
 * 價格變數缺、或 log 裡有任何一行 `JSON.parse` 失敗。
 *
 * ⚠️ 最後一條是 **P-22 的反轉,不是回歸**。P-22 修的是「壞行要跳過」——那是在
 * *讀事件* 的情境,跳過一行壞資料好過整份放棄。這裡是 *算錢*:跳過壞行等於**低估**
 * 花費,而低估花費的後果是超支使用者的錢。**有壞行 = 無法信任總數 = 算不出來。**
 * 不分哪一天:壞行讀不到 `ts`,沒有辦法證明它不是今天的,所以一律當成不可信。
 * fail-closed 的代價是「卡住」,所以訊息**必須**帶行號、該行前 80 個字元、以及一句
 * 怎麼修——沒有這三樣的 fail-closed 會被人想辦法繞過,那比 fail-open 更糟。
 *
 * 花費來源是 `state/log.jsonl` 的 `llm_call` 事件(契約 §10),只算
 * `provider === 'openai'` 的——閘道跑在使用者自己的硬體上,免費。
 *
 * ADR-034:.env 只在 CLI 入口載入(side-effect import scripts/_env.ts)。
 *
 * 三態的本體(`buildSpendReport` / `formatSpendReport` / `exitCodeFor`)先丟
 * not implemented,邏輯留給下一輪開發 agent;`main()` 也還沒接上它們,所以現在跑
 * 起來仍是舊的兩態行為——那正是 scripts/llm-spend.test.ts 現在該紅的原因。
 * 測試見 scripts/llm-spend.test.ts、packages/core/src/llm/spend.test.ts(純函式那半)
 * 與 features/03-llm-router/phase-4.feature 的 budget 場景。
 */
import './_env.js';
import { readDailyCapUsd, readDailySpend, readSpendPrices, dayOf, isBudgetExhausted } from '../packages/core/src/llm/index.js';

/** 退出碼的意義,寫成常數免得看的人要猜。 */
export const EXIT_UNDER_CAP = 0;
export const EXIT_AT_OR_OVER_CAP = 1;
/**
 * 2 = **算不出來**(舊名 EXIT_USAGE_ERROR 只講了參數錯誤那一半)。參數錯誤、讀不到 log、
 * 環境變數壞掉、log 有壞行——全部同一碼,因為對呼叫的人來說是同一件事:
 * **這個數字不能拿來當花錢的依據。**
 */
export const EXIT_CANNOT_COMPUTE = 2;

/** @deprecated 舊名,保留給既有呼叫端;新程式用 EXIT_CANNOT_COMPUTE。 */
export const EXIT_USAGE_ERROR = EXIT_CANNOT_COMPUTE;

/** 跟 scripts/llm.ts 用同一個預設路徑。 */
export const DEFAULT_LOG_PATH = 'learning/state/log.jsonl';

export interface SpendCliArgs {
  day?: string;
  logPath: string;
  json: boolean;
}

/** `--today` / `--day <YYYY-MM-DD>` / `--log <path>` / `--json`。 */
export function parseSpendArgs(argv: string[]): SpendCliArgs {
  const args: SpendCliArgs = { logPath: DEFAULT_LOG_PATH, json: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--today':
        // 今天不需要參數:day 留白,main() 用本地日期填。
        delete args.day;
        break;
      case '--json':
        args.json = true;
        break;
      case '--day': {
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) throw new Error('--day 需要一個 YYYY-MM-DD 日期');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--day 的格式應該是 YYYY-MM-DD,不是 "${value}"`);
        args.day = value;
        break;
      }
      case '--log': {
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) throw new Error('--log 需要一個檔案路徑');
        args.logPath = value;
        break;
      }
      default:
        throw new Error(`不認得的參數:"${String(arg)}"(用法:--today | --day <YYYY-MM-DD> [--log <path>] [--json])`);
    }
  }

  return args;
}

/**
 * 人看的一行:金額、筆數、上限,達上限時附上「今日預算已用完」。
 * 沒有 `--json` 時印這個。
 */
export function formatSpendLine(spentUsd: number, calls: number, capUsd: number): string {
  const cap = capUsd > 0 ? `$${capUsd.toFixed(2)}` : '無上限';
  const line = `今日 OpenAI 花費 $${spentUsd.toFixed(4)}(${calls} 次呼叫),上限 ${cap}`;
  return isBudgetExhausted(spentUsd, capUsd) ? `${line} — 今日預算已用完` : line;
}

/**
 * 算得出來的那兩態。`calls` 是今日 **OpenAI** 的 `llm_call` 次數,`entriesToday` 是
 * 今日 **所有** log 條目數(不分 type / provider)——兩個數字不一樣正是重點:
 * `calls = 0` 但 `entriesToday > 0` 的意思是「log 活著,只是今天沒打 OpenAI」。
 */
export interface ComputedSpend {
  kind: 'computed';
  usd: number;
  calls: number;
  entriesToday: number;
  capUsd: number;
  logPath: string;
}

/** 算不出來。`reason` 是給人看的完整原因,`formatSpendReport` 只在前面加「算不出來:」。 */
export interface UnknownSpend {
  kind: 'unknown';
  reason: string;
}

export type SpendReport = ComputedSpend | UnknownSpend;

/**
 * 讀環境變數與 log,判成三態之一。**不丟例外**——「算不出來」是一種回傳值,
 * 不是錯誤;丟例外會讓呼叫的人很容易寫成 catch 後當成 0。
 *
 * `env` 由呼叫端傳入(不直接讀 `process.env`),這樣「變數沒設」測得到,
 * 不必真的去動 `.env`。
 *
 * ⚠️ 這裡**不能**用 `readDailyCapUsd()` / `readSpendPrices()`:那兩個是給 router 用的
 * **寬鬆**讀取,缺變數會退回預設值繼續跑(router 那樣做是對的,少了預算上限也還是要
 * 能回答問題)。煞車不能那樣——退回預設值等於自己編一個上限出來,而編出來的上限
 * 跟使用者實際設定的可能差很多。所以這裡自己嚴格讀一次。
 */
export function buildSpendReport(_env: NodeJS.ProcessEnv, _logPath: string, _day: string): SpendReport {
  throw new Error('TODO: buildSpendReport 尚未實作(scripts/llm-spend.test.ts 定義了行為)');
}

/** 三態各自的那一行。computed 帶 log 路徑與今日條目數;unknown 一律 `算不出來:<原因>`。 */
export function formatSpendReport(_report: SpendReport): string {
  throw new Error('TODO: formatSpendReport 尚未實作(scripts/llm-spend.test.ts 定義了行為)');
}

/** `EXIT_UNDER_CAP` / `EXIT_AT_OR_OVER_CAP` / `EXIT_CANNOT_COMPUTE`。 */
export function exitCodeFor(_report: SpendReport): number {
  throw new Error('TODO: exitCodeFor 尚未實作(scripts/llm-spend.test.ts 定義了行為)');
}

async function main(): Promise<void> {
  const args = parseSpendArgs(process.argv.slice(2));
  const prices = readSpendPrices(process.env);
  const cap = readDailyCapUsd(process.env);
  const day = args.day ?? dayOf(new Date().toISOString());
  const spend = readDailySpend(args.logPath, day, prices);

  if (args.json) {
    console.log(JSON.stringify({ day, usd: spend.usd, calls: spend.calls, cap_usd: cap }, null, 2));
  } else {
    console.log(formatSpendLine(spend.usd, spend.calls, cap));
  }

  process.exitCode = isBudgetExhausted(spend.usd, cap) ? EXIT_AT_OR_OVER_CAP : EXIT_UNDER_CAP;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = EXIT_USAGE_ERROR;
});
