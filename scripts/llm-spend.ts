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
 *   1  算得出來,而且 `spent >= cap`(ADR-039 的邊界:剛好等於也算用完)。
 *   2  **算不出來**。只印 `算不出來:<原因>`,**絕不印任何「還有預算」的句子**,
 *      `--json` 也不吐 `usd` / `cap_usd`(下游拿到 `undefined` 而不是 0)。
 *
 * 觸發 2 的條件:log 檔不存在或不可讀、`LLM_DAILY_CAP_USD` 缺 / 空 / 非數字、
 * 價格變數缺、log 裡有任何一行 `JSON.parse` 失敗、或有任何一行**解析得出來但不是
 * 契約 §10 的事件**(不是物件,或 `ts` 在卻不是字串:例如整份檔是 `"hello"`、`42`、
 * `[]`、`null`)。後者跟前者同一碼、同一個訊息形狀——`"hello"` 是合法 JSON,但「這份檔根本
 * 不是花費紀錄」不可以被講成「花費是零」。**不知道不是零。**
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
  isBudgetExhausted,
  resolveVerifiedLedger,
  type LedgerHandle,
  type SpendPrices,
  type VaultResolveDeps,
} from '../packages/core/src/llm/index.js';

/**
 * `computeDailySpend` 收的事件型別。直接寫 `LogEvent` 要從 @contracts import,
 * 而 scripts/ 這一層只跟 packages/core 的公開介面打交道(CLAUDE.md 的跨資料夾規則),
 * 所以從函式簽章倒推——型別跟著 core 走,core 改了這裡會編譯錯,不會默默漂掉。
 */
type SpendEvents = Parameters<typeof computeDailySpend>[0];

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

/** exit 2 的訊息只印一行的前 80 個字元——log 一行可能好幾 KB,煞車的訊息要看得完。 */
const BAD_LINE_PREVIEW_CHARS = 80;

/**
 * 壞行的原因。三樣缺一不可:**行號、該行前 80 字、一句怎麼修**。
 * 沒有這三樣的 fail-closed 會被下一個人想辦法繞過,那比 fail-open 更糟。
 */
function badLineReason(logPath: string, lineNumber: number, line: string, what: string): string {
  return (
    `${logPath} 第 ${lineNumber} 行${what},所以今天的花費算不出來:` +
    `${line.slice(0, BAD_LINE_PREVIEW_CHARS)}` +
    `(修好或移除該行後重跑;這是花錢的煞車,不會自動跳過壞行)`
  );
}

/** JSON.parse 丟例外:那一行連 JSON 都不是(HTML、被截斷的行、亂碼)。 */
const NOT_JSON = '不是合法的 JSON';
/**
 * JSON.parse 過了,但值不是契約 §10 的事件。`"hello"` / `42` / `[]` / `null` 每一個都
 * 解析得出來,但沒有一個是「物件 + 字串 ts」;把它們當事件算會得到「今日條目 0 筆、
 * $0.0000、exit 0」——那是把「這檔不是花費紀錄」講成「花費是零」。
 */
const NOT_EVENT = '是合法的 JSON,但不是 log 事件(契約 §10 的事件是一個物件,ts 是 ISO 字串)';

/**
 * 一行解析出來的值算不算契約 §10 的事件:**物件**(不是 null、不是陣列),而且 `ts`
 * 如果有,必須是字串。
 *
 * 只擋「根本不是事件」。`ts` 缺掉的物件放行——它進不了今日條目也進不了花費
 * (computeDailySpend 與今日 filter 都要字串 ts),既有測試也把它當「不算今天」而不是
 * 壞行。但 `ts` 在卻不是字串(例如數字)是另一回事:那一行會被兩個 filter 靜靜略過,
 * 方向是低估,所以跟 `null` 一樣當壞行。`type` 之類的欄位由 computeDailySpend 自己認。
 */
function isLogEvent(value: unknown): value is SpendEvents[number] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const ts = (value as { ts?: unknown }).ts;
  return ts === undefined || typeof ts === 'string';
}

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
    // 這裡跟 packages/core 的 readDailySpend() 分道揚鑣:那支檔案不存在回
    // `{ usd: 0, calls: 0 }`(對 router 是對的,還沒呼叫過就是沒花錢),煞車不行——
    // 讀不到 log 不等於沒花錢,只等於「我不知道花了多少」。
    return {
      kind: 'unknown',
      reason: `讀不到 log 檔 ${logPath}:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ⚠️ 這個迴圈是 **P-22 的反轉,不是回歸**。
  //
  // P-22 修的是 packages/core 的 readDailySpend():log 有一行壞掉時只跳過那一行,
  // 不要整份放棄。那是在 *讀事件* 的情境——整份放棄會漏掉一堆好資料,而漏掉事件
  // 的後果只是少看到一點歷史。
  //
  // 這裡是 *算錢*:**跳過壞行等於低估花費**,而低估花費的後果是超支使用者的錢。
  // 所以在這支煞車裡,**有壞行 = 無法信任總數 = 算不出來(exit 2)**。
  //
  // 而且**不分哪一天**:JSON.parse 失敗的行讀不到 ts,沒有辦法證明它不是今天寫的,
  // 所以一律當成不可信。不可以先用 ts 濾出今日再檢查壞行——那樣歷史壞行會被濾掉。
  //
  // 「解析得出來但不是事件」跟「解析不出來」走同一條路、同一個訊息形狀(行號 / 前 80
  // 字 / 怎麼修)。以前 `"hello"` 這種行會被 push 進 events,然後被 computeDailySpend
  // 與今日條目的 filter 靜靜略過,結果是 exit 0 加一句「有 log 但沒花」;`null` 則是
  // 在 filter 裡讀 `.ts` 炸掉,exit 2 但訊息是一個 TypeError,沒有行號、沒有怎麼修。
  // Stryker disable next-line ArrayDeclaration: 初值塞一個字串是真等價——computeDailySpend 與底下
  // entriesToday 的 filter 都要 `typeof e.ts === 'string'`,字串沒有 ts,兩邊都靜靜略過,結果不變。
  const events: SpendEvents = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // 空行與只有空白的行不是壞行:append-only 的檔案本來就會有行尾換行。
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // 行號用 1-based,跟編輯器一致。
      return { kind: 'unknown', reason: badLineReason(logPath, i + 1, line, NOT_JSON) };
    }
    if (!isLogEvent(parsed)) {
      return { kind: 'unknown', reason: badLineReason(logPath, i + 1, line, NOT_EVENT) };
    }
    events.push(parsed);
  }

  const prices: SpendPrices = { inPerM, outPerM };
  const { usd, calls } = computeDailySpend(events, day, prices);

  // 今日條目 = 今天**所有**的 log 行,不分 type / provider。跟 calls 是兩個數字,
  // 而兩個數字不一樣正是重點:`calls = 0` 但 `entriesToday > 0` 的意思是
  // 「log 活著,只是今天沒打 OpenAI」——那才是「$0.00」該有的證據。
  // Stryker disable next-line ConditionalExpression: 把 `typeof e.ts === 'string'` 換成 `true` 是真等價——
  // isLogEvent 已保證 ts 只會是 undefined 或字串,而 dayOf(undefined) 是 'NaN-NaN-NaN',永遠不等於 day。
  // 守著這個 typeof 是給型別(dayOf 收 string),不是給行為。
  const entriesToday = events.filter((e) => typeof e.ts === 'string' && dayOf(e.ts) === day).length;

  return { kind: 'computed', usd, calls, entriesToday, capUsd, logPath, ledger: ledgerStatus };
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
  return `${prefix}${body}`;
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
