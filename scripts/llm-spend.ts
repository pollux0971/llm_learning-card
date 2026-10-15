/**
 * CLI 入口:scripts/llm-spend.ts(ADR-039)。今天在 OpenAI 上花了多少。
 *
 *   npx tsx scripts/llm-spend.ts --today            # 印出今日金額與筆數
 *   npx tsx scripts/llm-spend.ts --today --json     # 同上,JSON 格式
 *   npx tsx scripts/llm-spend.ts --day 2026-09-03   # 指定某一天
 *   npx tsx scripts/llm-spend.ts --today --log path/to/log.jsonl   # 未驗證的帳本:只能看,不能當煞車
 *
 * **帳本是哪一本**(T5 / ADR-066,契約 §12 1.4.0):沒有 `--log` 時,帳本由使用者層指標檔決定
 * (`npx tsx scripts/vault.ts init` 建立、`show` 檢查),經身分標記驗證的才算(`VerifiedLedger`)。
 * 指標不存在、讀不到、learning_dir 不存在、標記不符——一律 exit 2(算不出來),訊息帶 init / show。
 * 給了 `--log` 就是**未驗證的帳本**(`ExplicitLedger`):不讀指標檔,報告第一行標 `ledger=unverified`,
 * 而且退出碼一律 2——它不能被當成煞車的依據(煞車只消費 `VerifiedLedger`)。
 *
 * **三態,三個退出碼**(不是兩態)。這支是 autopilot 每輪的預算煞車,也是「超過上限就
 * 問使用者」的唯一判斷依據,所以「算不出來」必須跟「還有預算」分得開:
 *
 *   0  算得出來,而且 `spent < cap`。訊息要帶 **log 路徑**與**今日條目筆數**,
 *      讓 `$0.00` 看得出是「有 log 但今天沒花」而不是「根本沒有 log」。
 *      **驗證過的帳本、`state/log.jsonl` 不存在**也是這一碼(T8,契約 §12:全新安裝 = 今日花費 0,
 *      合法):$0.0000、0 次呼叫、今日條目 0 筆,第二行註明「帳本還沒有紀錄」,`--json` 帶
 *      `log_exists: false`——跟「有 log、今天沒花」(`log_exists: true`)與「算不出來」三種都分得開。
 *   1  算得出來,而且 `spent >= cap`(ADR-039 的邊界:剛好等於也算用完)。
 *   2  **算不出來**。只印 `算不出來:<原因>`,**絕不印任何「還有預算」的句子**,
 *      `--json` 也不吐 `usd` / `cap_usd`(下游拿到 `undefined` 而不是 0)。
 *
 * 觸發 2 的條件:**未驗證的**帳本(`--log`)檔案不存在、log 不可讀(權限、是目錄…)、
 * `LLM_DAILY_CAP_USD` 缺 / 空 / 非數字、價格變數缺、log 裡有任何一行 `JSON.parse` 失敗、
 * 或有任何一行**解析得出來但不是契約 §10 的事件**(不是物件,或 `ts` 在卻不是字串:例如整份檔是
 * `"hello"`、`42`、`[]`、`null`)。後者跟前者同一碼、同一個訊息形狀——`"hello"` 是合法 JSON,但「這份檔根本
 * 不是花費紀錄」不可以被講成「花費是零」。**不知道不是零。**
 * 什麼叫壞行由 packages/core 的 `parseLedger` 判(T8:只留一份定義),router 的煞車
 * (`readDailySpend` → `UnknownSpendError`)用的是同一份判定與同一份訊息文字。
 *
 * ⚠️ 最後兩條是 **P-22 的反轉,不是回歸**。P-22 修的是「壞行要跳過」——那是在
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
 * 三態的本體是 `buildSpendReport`(判)/ `formatSpendReport`(印)/ `exitCodeFor`
 * (退出碼)三個純函式,`main()` 只負責把它們串起來——env 由參數傳進去,所以
 * 「環境變數沒設」測得到,不必真的去動 `.env`。
 * 測試見 scripts/llm-spend.test.ts、packages/core/src/llm/spend.test.ts(純函式那半)
 * 與 features/03-llm-router/phase-4.feature 的 budget 場景。
 */
import './_env.js';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ExplicitLedger,
  computeDailySpend,
  dayOf,
  defaultVaultDeps,
  describeBadLine,
  isBudgetExhausted,
  parseLedger,
  resolveVerifiedLedger,
  type LedgerHandle,
  type SpendPrices,
  type VaultResolveDeps,
} from '../packages/core/src/llm/index.js';

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

/**
 * parseSpendArgs()(純函式,不碰檔案系統)的 sentinel——main() 看到 logPath 還是這個值,
 * 才知道使用者沒有明講 --log,要改由指標檔解析帳本(T5 / ADR-066)。
 * 這個常數本身不是「最後會用到的路徑」,也從來不會被讀。
 */
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
 * 這次報告讀哪一本帳(T5 / ADR-066)。`explicitLog` 是使用者明講的 `--log`;其餘是指標解析的注入
 * (env / homedir / 讀檔),入口層才給真的——測試注入合成的,不會讀到真的指標檔。
 */
export interface SpendLedgerInput extends VaultResolveDeps {
  explicitLog: string | undefined;
}

export type SpendLedgerResult =
  | { ok: true; ledger: LedgerHandle }
  | { ok: false; exitCode: 2; message: string };

/**
 * 明確 `--log` 優先,而且**不讀指標檔**(指標壞掉也照樣看得到那本帳),得到未驗證把手;
 * 沒有 `--log` 才解析指標,四種拒絕一律 exit 2。
 */
export function resolveSpendLedger(input: SpendLedgerInput): SpendLedgerResult {
  if (input.explicitLog !== undefined) {
    return {
      ok: true,
      ledger: ExplicitLedger.unverified(input.explicitLog, 'llm-spend --log:讀取報告,不能當煞車(exit 一律 2)'),
    };
  }
  const resolved = resolveVerifiedLedger(input);
  if (!resolved.ok) return { ok: false, exitCode: 2, message: resolved.message };
  return { ok: true, ledger: resolved.ledger };
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
  /** 帳本的身分。`unverified`(明講 `--log`)的報告第一行標出來,退出碼一律 2,不能當煞車。 */
  ledger: 'verified' | 'unverified';
  /**
   * 帳本檔在不在(T8)。只有**驗證過的**帳本會是 `false`:契約 §12,檔案不存在 = 全新安裝 = 今日花費 0,
   * 合法;報告另起一行註明「帳本還沒有紀錄」。未驗證的帳本檔案不存在仍是算不出來,不會走到這裡。
   * 沒給等於 `true`(檔案在)。
   */
  logExists?: boolean;
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
/**
 * 環境變數讀成一個「一定要在、一定要是數字」的值。**不退回預設值。**
 *
 * `readDailyCapUsd()` / `readSpendPrices()`(packages/core)缺變數會退回預設值,
 * 那是 router 的正確行為——少了上限也還是要能回答問題。煞車不能那樣:退回預設值
 * 等於自己編一個上限出來,而編出來的上限跟使用者實際設定的可能差很多。
 * 所以這裡自己嚴格讀一次,壞掉就是「算不出來」。
 */
function strictNumberEnv(env: NodeJS.ProcessEnv, name: string): number | { reason: string } {
  const raw = env[name];
  if (raw === undefined) return { reason: `環境變數 ${name} 沒有設定(在 .env 或 shell 裡設一個非負數字)` };
  if (raw.trim() === '') return { reason: `環境變數 ${name} 是空的(在 .env 或 shell 裡設一個非負數字)` };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { reason: `環境變數 ${name} 不是非負數字:"${raw}"` };
  }
  return value;
}

/**
 * 驗證過的帳本、log 檔還不存在時的第二行(T8)。$0 是事實(全新安裝,契約 §12),
 * 但要跟「有 log、今天沒花」與「算不出來」分得開——三種情況的輸出兩兩不同。
 */
const LEDGER_HAS_NO_RECORDS = '帳本還沒有紀錄(帳本已驗證,log 檔還不存在:全新安裝,今日花費 0,契約 §12)';

/** 帳本把手(不收裸字串,T5 第 8 條)→ 三態的報告。 */
export function buildSpendReport(env: NodeJS.ProcessEnv, ledger: LedgerHandle, day: string): SpendReport {
  const logPath = ledger.logPath;
  const ledgerStatus = ledger.kind === 'verified' ? 'verified' : 'unverified';
  // 先讀環境變數:沒有上限與價格就算把 log 讀完也換算不出金額。
  const capUsd = strictNumberEnv(env, 'LLM_DAILY_CAP_USD');
  if (typeof capUsd !== 'number') return { kind: 'unknown', reason: capUsd.reason };
  const inPerM = strictNumberEnv(env, 'LLM_PRICE_IN_PER_M');
  if (typeof inPerM !== 'number') return { kind: 'unknown', reason: inPerM.reason };
  const outPerM = strictNumberEnv(env, 'LLM_PRICE_OUT_PER_M');
  if (typeof outPerM !== 'number') return { kind: 'unknown', reason: outPerM.reason };

  let content: string;
  try {
    content = readFileSync(logPath, 'utf8');
  } catch (err) {
    // 驗證過的帳本、檔案不存在 = 全新安裝 = 今日花費 0(契約 §12;T8 之前這裡回 exit 2,違反契約)。
    // 跟 packages/core 的 readDailySpend() 同一個判斷。只有這一種:
    // - 未驗證的帳本(--log)檔案不存在仍是算不出來——路徑可能打錯,不能說「全新安裝」;
    // - 不是「檔案不存在」的讀檔錯誤(權限、是目錄)不論哪一本都是「我不知道花了多少」。
    if (ledgerStatus === 'verified' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'computed', usd: 0, calls: 0, entriesToday: 0, capUsd, logPath, ledger: ledgerStatus, logExists: false };
    }
    return {
      kind: 'unknown',
      reason: `讀不到 log 檔 ${logPath}:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ⚠️ **P-22 的反轉,不是回歸**:P-22 修的是「壞行要跳過」——那是在 *讀事件* 的情境。
  // 這裡是 *算錢*:**跳過壞行等於低估花費**,而低估花費的後果是超支使用者的錢。
  // 所以 **有壞行 = 無法信任總數 = 算不出來(exit 2)**,而且**不分哪一天**(壞行讀不到 ts,
  // 證明不了它不是今天寫的;不可以先用 ts 濾出今日再檢查壞行)。
  // 什麼叫壞行、訊息怎麼寫,都由 packages/core 的 parseLedger / describeBadLine 決定(T8:只留一份,
  // router 的煞車 readDailySpend 用的是同一份)。「解析得出來但不是事件」(`"hello"`、`null`、ts 是數字)
  // 跟「解析不出來」走同一條路、同一個訊息形狀(行號 / 前 80 字 / 怎麼修 / 哪一種壞)。
  const parsed = parseLedger(content);
  if (!parsed.ok) return { kind: 'unknown', reason: describeBadLine(logPath, parsed.bad) };
  const events = parsed.events;

  const prices: SpendPrices = { inPerM, outPerM };
  const { usd, calls } = computeDailySpend(events, day, prices);

  // 今日條目 = 今天**所有**的 log 行,不分 type / provider。跟 calls 是兩個數字,
  // 而兩個數字不一樣正是重點:`calls = 0` 但 `entriesToday > 0` 的意思是
  // 「log 活著,只是今天沒打 OpenAI」——那才是「$0.00」該有的證據。
  // Stryker disable next-line ConditionalExpression: 把 `typeof e.ts === 'string'` 換成 `true` 是真等價——
  // parseLedger 已保證 ts 只會是 undefined 或字串,而 dayOf(undefined) 是 'NaN-NaN-NaN',永遠不等於 day。
  // 守著這個 typeof 是給型別(dayOf 收 string),不是給行為。
  const entriesToday = events.filter((e) => typeof e.ts === 'string' && dayOf(e.ts) === day).length;

  return { kind: 'computed', usd, calls, entriesToday, capUsd, logPath, ledger: ledgerStatus, logExists: true };
}

export function formatSpendReport(report: SpendReport): string {
  if (report.kind === 'unknown') return `算不出來:${report.reason}`;
  // 未驗證的帳本:第一行先講清楚,看的人才不會把下面的數字當成煞車的依據。
  const prefix = report.ledger === 'unverified' ? 'ledger=unverified\n' : '';

  // 上限跟花費用同樣的四位小數,兩個數字才直接比得起來。舊的兩位小數會把
  // `cap = 0.0225` 印成 `$0.02`,於是「剛好用完」那一行看起來像「超支了一截」。
  const cap = report.capUsd > 0 ? `$${report.capUsd.toFixed(4)}` : '無上限';
  const line =
    `今日 OpenAI 花費 $${report.usd.toFixed(4)}` +
    `(${report.calls} 次呼叫,log: ${report.logPath},今日條目 ${report.entriesToday} 筆)` +
    `,上限 ${cap}`;
  const body = isBudgetExhausted(report.usd, report.capUsd) ? `${line} — 今日預算已用完` : line;
  // 驗證過的帳本、log 檔還不存在(T8):第一行照常(上限照印),第二行講清楚 $0 是「還沒有紀錄」。
  const note = report.logExists === false ? `\n${LEDGER_HAS_NO_RECORDS}` : '';
  return `${prefix}${body}${note}`;
}

export function exitCodeFor(report: SpendReport): number {
  if (report.kind === 'unknown') return EXIT_CANNOT_COMPUTE;
  // 未驗證的帳本,數字算得出來也不是「這台機器今天花了多少」:不給 0(還可以花)也不給 1(停)。
  if (report.ledger === 'unverified') return EXIT_CANNOT_COMPUTE;
  return isBudgetExhausted(report.usd, report.capUsd) ? EXIT_AT_OR_OVER_CAP : EXIT_UNDER_CAP;
}

async function main(): Promise<void> {
  const args = parseSpendArgs(process.argv.slice(2));
  const day = args.day ?? dayOf(new Date().toISOString());
  const explicitLog = args.logPath === DEFAULT_LOG_PATH ? undefined : args.logPath;
  // 入口層:只有這裡拿真的 process.env / os.homedir()(經 defaultVaultDeps)。
  const resolved = resolveSpendLedger({ ...defaultVaultDeps(), explicitLog });
  if (!resolved.ok) {
    console.error(`算不出來:${resolved.message}`);
    process.exitCode = resolved.exitCode;
    return;
  }
  const report = buildSpendReport(process.env, resolved.ledger, day);

  if (args.json) {
    // 算不出來時**不吐 usd / cap_usd**:下游拿 `.usd` 要拿到 `undefined`,不是 0。
    // 0 的方向是「還可以花」,而這裡的意思是「我不知道花了多少」。
    console.log(
      JSON.stringify(
        report.kind === 'computed'
          ? {
              day,
              usd: report.usd,
              calls: report.calls,
              entries_today: report.entriesToday,
              log: report.logPath,
              // T8:驗證過的帳本、檔案還不存在(全新安裝)是 false;檔案在是 true。
              log_exists: report.logExists !== false,
              cap_usd: report.capUsd,
              ledger: report.ledger,
            }
          : { day, error: report.reason },
        null,
        2,
      ),
    );
  } else if (report.kind === 'computed') {
    console.log(formatSpendReport(report));
  } else {
    console.error(formatSpendReport(report));
  }

  process.exitCode = exitCodeFor(report);
}

/**
 * ADR-051 實測到的附帶問題:這支檔案**既是 CLI 入口、又被自己的測試檔直接 import 純函式**
 * (buildSpendReport / parseSpendArgs / DEFAULT_LOG_PATH 等)。預設路徑會真的去讀使用者層的
 * 指標檔與它指向的帳本(T5 之前是 shell 出去解析主簽出的 learning/),如果每次
 * `import { buildSpendReport } from './llm-spend.js'` 都真的執行一次 main(),等於**每次跑這個
 * 檔案的測試都真的去讀使用者的指標與花費帳本**——只是讀,不會寫壞,但完全不必要,
 * 而且會把真的資料印進測試輸出。只在真的被當 CLI 執行時才跑。
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    // 參數錯誤也是「算不出來」——對呼叫的人來說跟讀不到 log 是同一件事:
    // 這次沒有得到一個可以拿來當花錢依據的數字。
    console.error(`算不出來:${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = EXIT_CANNOT_COMPUTE;
  });
}
