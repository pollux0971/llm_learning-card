/**
 * CLI 入口:scripts/llm-spend.ts(ADR-039)。今天在 OpenAI 上花了多少。
 *
 *   npx tsx scripts/llm-spend.ts --today            # 印出今日金額與筆數
 *   npx tsx scripts/llm-spend.ts --today --json     # 同上,JSON 格式
 *   npx tsx scripts/llm-spend.ts --day 2026-09-03   # 指定某一天
 *   npx tsx scripts/llm-spend.ts --today --log path/to/log.jsonl
 *
 * **退出碼 1 表示已達上限**(`spent >= LLM_DAILY_CAP_USD`,ADR-039 的邊界決定)。
 * 這是給 autopilot 用的:花錢之前先跑這一行,非 0 就別開始會花錢的工作。
 * 退出碼 0 = 還有預算;1 = 已達上限;2 = 參數或讀檔錯誤(不要跟「達上限」搞混)。
 *
 * 花費來源是 `state/log.jsonl` 的 `llm_call` 事件(契約 §10),只算
 * `provider === 'openai'` 的——閘道跑在使用者自己的硬體上,免費。
 *
 * ADR-034:.env 只在 CLI 入口載入(side-effect import scripts/_env.ts)。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。
 * 測試見 packages/core/src/llm/spend.test.ts(純函式那半)與
 * features/03-llm-router/phase-4.feature 的 budget 場景。
 */
import './_env.js';
import { readDailyCapUsd, readDailySpend, readSpendPrices, dayOf, isBudgetExhausted } from '../packages/core/src/llm/index.js';

/** 退出碼的意義,寫成常數免得看的人要猜。 */
export const EXIT_UNDER_CAP = 0;
export const EXIT_AT_OR_OVER_CAP = 1;
export const EXIT_USAGE_ERROR = 2;

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
