/**
 * 當日 LLM 花費(ADR-039、ADR-056)。
 *
 * 花費不另外存 counter 檔——`state/log.jsonl` 已經有 `llm_call` 事件帶
 * `tokens_in` / `tokens_out`(契約 §10),再存一份就有兩個真相來源,而且
 * counter 檔要處理原子寫入與跨日重置。從 log 算是純函式,好測。
 *
 * 只排除明確免費的本機閘道(`ollama`)——它跑在使用者自己的硬體上,不計入預算;
 * 其他 provider 一律計入。這不是在修一條目前到得了的「anthropic 成功但漏算」路徑:
 * 現在 provider 與金鑰剛好同住一個設定檔,缺檔會同時讓 provider 落回 anthropic
 * 且沒有金鑰,呼叫會失敗。那個互斥是佈局的巧合,不是安全設計:只要有人把
 * `ANTHROPIC_API_KEY` 放進 shell、CI secret 或 agent 環境,路徑就會通而煞車看不到。
 * 花費煞車不應依賴金鑰與 provider 恰好在同一個檔案,所以採排除免費 provider 的規則;
 * 新增未知 provider 時預設計費,避免白名單漏列時把花費當成零。
 *
 * 獨立成檔案(不放進 `routing.ts`)是為了不動 `routing.ts` 既有的嚴格 95%
 * 變異門檻,比照 `token-limits.ts` 的做法(ADR-036 的教訓)。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `SpendPrices { inPerM, outPerM }`:每百萬 token 的美元價
 *   (`LLM_PRICE_IN_PER_M` / `LLM_PRICE_OUT_PER_M`)。
 * - `DailySpend { usd, calls }`:當日金額與筆數。
 * - `DEFAULT_DAILY_CAP_USD = 1`:`LLM_DAILY_CAP_USD` 沒設時的預設值。
 * - `isLlmCallEvent(event)`:type 是 `llm_call` 且 provider 不是免費本機 `ollama` 的型別守衛。
 * - `dayOf(ts)`:把 ISO 8601 時間戳切成 `YYYY-MM-DD`(取本地日期,跟使用者的
 *   「今天」一致——預算是使用者感受到的一天,不是 UTC 的一天)。
 * - `computeDailySpend(events, day, prices)`:純函式。只挑 `type === 'llm_call'`、
 *   `provider !== 'ollama'`、`dayOf(ts) === day` 的事件,把
 *   `tokens_in / 1e6 * inPerM + tokens_out / 1e6 * outPerM` 加總。缺欄位的
 *   token 數當 0(逾時/截斷的事件沒有 token 欄位,但仍算一筆 `calls`)。
 * - `isBudgetExhausted(spentUsd, capUsd)`:**`spent >= cap` 就算達到**(ADR-039)。
 *   剛好等於上限算已用完:上限是天花板不是配額目標,而且 log 算出來的數字是
 *   低估(進行中還沒寫 log 的那次呼叫不在裡面)。`capUsd <= 0` 視為「沒有上限」,
 *   一律回 false——避免有人把變數設成 0 就整個系統停擺。
 * - `readSpendPrices(env)` / `readDailyCapUsd(env)`:契約 §11 的環境變數讀取,
 *   數值不合法(非數字 / 負數)就退回預設值,不丟錯。
 * - `parseLedger(content)`:**壞行的唯一定義**(T8)。整份 log.jsonl 的文字 → 事件清單,或第一個壞行
 *   (1-based 行號、該行原文、哪一種壞)。壞行 = 內容不是空白,而且 `JSON.parse` 失敗、或解析出來不是物件、
 *   或 `ts` 在卻不是字串。`readDailySpend` 與 `scripts/llm-spend.ts` 都只經過它判斷,不各留一份。
 * - `describeBadLine(logPath, bad)`:壞行的人話(行號 / 前 80 字 / 怎麼修),兩邊共用同一份文字來源。
 * - `readDailySpend(ledger, day, prices)`:讀帳本把手(`VerifiedLedger` / `ExplicitLedger`,不收裸字串)
 *   上的 `log.jsonl` 再算。把手在、檔案不存在(ENOENT)= 全新安裝 = 0;沒有把手丟 `MissingLedgerError`;
 *   有任何壞行(不分哪一天)丟 `UnknownSpendError`;其他讀檔錯誤(權限、是目錄…)原樣丟出——
 *   都是「不知道」,永遠不回數字。
 *
 * 測試見 spend.test.ts、ledger-bad-lines.test.ts。
 */

import { readFileSync } from 'node:fs';
import { witnessed } from '@contracts/witness.js';
import type { LogEvent } from '@contracts/index.js';
import type { LedgerHandle } from './ledger.js';

export interface SpendPrices {
  /** 輸入 token 每百萬個的美元價 */
  inPerM: number;
  /** 輸出 token 每百萬個的美元價 */
  outPerM: number;
}

export interface DailySpend {
  usd: number;
  calls: number;
}

/** `.env.example` 的預設值:一天一美元。 */
export const DEFAULT_DAILY_CAP_USD = 1;

/** `.env.example` 記的價格,沒設環境變數時的退路。 */
export const DEFAULT_SPEND_PRICES: SpendPrices = { inPerM: 2.5, outPerM: 10 };

/** 一百萬——價格是「每百萬 token 幾美元」,這個常數是那個「百萬」。 */
const TOKENS_PER_PRICE_UNIT = 1_000_000;

/**
 * LogEventSchema 是 `.catchall(z.unknown())`,所以 `provider` / `tokens_in` 這些
 * §10 的欄位在型別上都是 `unknown`。用這個小 helper 統一取值,免得每個地方各寫
 * 一次 cast。
 */
function field(event: LogEvent, key: string): unknown {
  return (event as unknown as Record<string, unknown>)[key];
}

/** 只有數字才是數字:缺欄位(逾時、截斷的事件)當 0,不是 NaN。 */
function numberField(event: LogEvent, key: string): number {
  const value = field(event, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : witnessed('llm.spend.tokens-missing-zero', 0);
}

/** `type === 'llm_call'` 且 `provider !== 'ollama'`——只有明確免費的本機閘道不計費。 */
export function isLlmCallEvent(event: LogEvent): boolean {
  return event.type === 'llm_call' && field(event, 'provider') !== 'ollama';
}

/** ISO 8601 → `YYYY-MM-DD`(本地日期,對齊使用者感受到的「今天」)。 */
export function dayOf(ts: string): string {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 純函式:事件清單 + 哪一天 + 價格 → 當日金額與筆數。 */
export function computeDailySpend(events: LogEvent[], day: string, prices: SpendPrices): DailySpend {
  let usd = 0;
  let calls = 0;

  for (const event of events) {
    if (!isLlmCallEvent(event)) continue;
    if (typeof event.ts !== 'string' || dayOf(event.ts) !== day) continue;

    calls += 1;
    usd += (numberField(event, 'tokens_in') / TOKENS_PER_PRICE_UNIT) * prices.inPerM;
    usd += (numberField(event, 'tokens_out') / TOKENS_PER_PRICE_UNIT) * prices.outPerM;
  }

  return { usd, calls };
}

/** ADR-039:`spent >= cap` 就算已達上限。`cap <= 0` 視為沒有上限。 */
export function isBudgetExhausted(spentUsd: number, capUsd: number): boolean {
  if (!(capUsd > 0)) return false;
  return spentUsd >= capUsd;
}

/**
 * 環境變數讀成非負數字。沒設、空字串、非數字、負數一律退回預設值——設定壞掉的時候
 * 用一個已知的數字繼續跑,比丟錯讓整個 CLI 掛掉好(這是預算,不是憑證)。
 */
function readNonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return witnessed('llm.spend.env-invalid-default', fallback);
  return value;
}

/** 契約 §11:`LLM_PRICE_IN_PER_M` / `LLM_PRICE_OUT_PER_M`,不合法就用預設值。 */
export function readSpendPrices(env: NodeJS.ProcessEnv): SpendPrices {
  return {
    inPerM: readNonNegativeNumber(env.LLM_PRICE_IN_PER_M, DEFAULT_SPEND_PRICES.inPerM),
    outPerM: readNonNegativeNumber(env.LLM_PRICE_OUT_PER_M, DEFAULT_SPEND_PRICES.outPerM),
  };
}

/**
 * 契約 §11:`LLM_DAILY_CAP_USD`,不合法就用 `DEFAULT_DAILY_CAP_USD`。
 * 明確設成 `0` 是合法的,意思是「不設限」(見 isBudgetExhausted)。
 */
export function readDailyCapUsd(env: NodeJS.ProcessEnv): number {
  return readNonNegativeNumber(env.LLM_DAILY_CAP_USD, DEFAULT_DAILY_CAP_USD);
}

/**
 * 沒有帳本把手時查花費。花費是「不知道」,不是 0——0 的方向是「還可以繼續花」(T5 / ADR-066)。
 * 取代 ADR-044 目錄裡「讀不到 log 當 0」(spend.log-unreadable-zero)與「沒給 logPath 當 0」
 * (gateway-router.spend-no-log-zero)兩條退化分支;兩個訊號已隨 T5 從 packages/contracts/src/witness.ts 移除。
 */
export class MissingLedgerError extends Error {
  constructor() {
    super('沒有帳本把手:今日花費是不知道,不是 0。帳本位置只由指標檔決定(npx tsx scripts/vault.ts init / show)');
    this.name = 'MissingLedgerError';
  }
}

// ────────────────────────────────────────────────────────────── 壞行(T8)
//
// 什麼叫壞行只在這裡定義一次。以前 readDailySpend 與 scripts/llm-spend.ts 各有一份:
// 前者把壞行跳過(兩行各 1M tokens 的帳本是 $5,弄壞一行變 $2.5),後者把壞行當「算不出來」。
// 同一本帳本,煞車與報告講不同的話,而 router 那一份的方向是「還可以繼續花」。
// 現在兩邊都經過 parseLedger:有壞行 = 不知道,不分哪一天(壞行讀不到 ts,證明不了它不是今天的)。

/** 壞行訊息只印該行的前 80 個字元:log 一行可能好幾 KB,煞車的訊息要看得完,也不把整行倒出去。 */
export const BAD_LINE_PREVIEW_CHARS = 80;

/** JSON.parse 丟例外:那一行連 JSON 都不是(HTML、被截斷的行、亂碼)。 */
const NOT_JSON = '不是合法的 JSON';
/**
 * JSON.parse 過了,但值不是契約 §10 的事件。`"hello"` / `42` / `[]` / `null` 每一個都
 * 解析得出來,但沒有一個是「物件 + 字串 ts」;把它們當事件算會得到「今日條目 0 筆、
 * $0.0000」——那是把「這檔不是花費紀錄」講成「花費是零」。
 */
const NOT_EVENT = '是合法的 JSON,但不是 log 事件(契約 §10 的事件是一個物件,ts 是 ISO 字串)';

/** 第一個壞行。`line` 是原文,只給 describeBadLine 截前 80 字用;不要整行印出去。 */
export interface BadLedgerLine {
  /** 1-based,跟編輯器一致。 */
  lineNumber: number;
  line: string;
  /** 哪一種壞(人話):連 JSON 都不是,或是 JSON 但不是事件。兩種修法不同(改格式 vs 改內容)。 */
  what: string;
}

export type LedgerParse = { ok: true; events: LogEvent[] } | { ok: false; bad: BadLedgerLine };

/**
 * 一行解析出來的值算不算契約 §10 的事件:**物件**(不是 null、不是陣列),而且 `ts`
 * 如果有,必須是字串。
 *
 * 只擋「根本不是事件」。`ts` 缺掉的物件放行——它進不了今日條目也進不了花費
 * (computeDailySpend 與 llm-spend 的今日 filter 都要字串 ts)。但 `ts` 在卻不是字串
 * (例如數字、null)是另一回事:那一行會被 filter 靜靜略過,方向是低估,所以當壞行。
 * `type` 之類的欄位由 computeDailySpend 自己認。
 */
function isLedgerEvent(value: unknown): value is LogEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const ts = (value as { ts?: unknown }).ts;
  return ts === undefined || typeof ts === 'string';
}

/**
 * 壞行的唯一定義(純函式)。整份 log.jsonl 的文字 → 全部事件,或**第一個**壞行(先修第一個)。
 * 壞行 = 內容不是空白,而且 JSON.parse 失敗、或解析出來不是物件、或 ts 在卻不是字串。
 * 空行與只有空白的行不是壞行:append-only 的檔案本來就會有行尾換行。
 */
export function parseLedger(content: string): LedgerParse {
  const events: LogEvent[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false, bad: { lineNumber: i + 1, line, what: NOT_JSON } };
    }
    if (!isLedgerEvent(parsed)) return { ok: false, bad: { lineNumber: i + 1, line, what: NOT_EVENT } };
    events.push(parsed);
  }
  return { ok: true, events };
}

/**
 * 壞行的人話。三樣缺一不可:**行號、該行前 80 字、一句怎麼修**——沒有這三樣的 fail-closed
 * 會被下一個人想辦法繞過,那比 fail-open 更糟。`scripts/llm-spend.ts` 的「算不出來」與
 * `UnknownSpendError` 用的是這同一份文字,兩邊不會各自漂移。
 */
export function describeBadLine(logPath: string, bad: BadLedgerLine): string {
  return (
    `${logPath} 第 ${bad.lineNumber} 行${bad.what},所以今天的花費算不出來:` +
    `${bad.line.slice(0, BAD_LINE_PREVIEW_CHARS)}` +
    `(修好或移除該行後重跑;這是花錢的煞車,不會自動跳過壞行)`
  );
}

/**
 * 帳本裡有壞行:今日花費是「不知道」(T8)。跳過壞行 = 低估花費 = 「還可以繼續花」;
 * 所以 readDailySpend 丟這個錯、不回任何數字,router 因此在打任何 adapter 之前就拒絕。
 * 修帳本是明示的動作(ADR-050):訊息說怎麼修、指去 llm-spend 看,不自動刪行。
 * 物件上只留路徑與行號,不留整行內容。
 */
export class UnknownSpendError extends Error {
  readonly logPath: string;
  /** 第一個壞行的行號(1-based)。 */
  readonly lineNumber: number;

  constructor(logPath: string, bad: BadLedgerLine) {
    super(
      `${describeBadLine(logPath, bad)}。今日花費是不知道,不是 0:帳本有壞行時一律拒絕真呼叫。` +
        `用 npx tsx scripts/llm-spend.ts 看是哪一行壞了(未驗證的帳本加 --log <路徑>),` +
        `修好或移除後再跑一次,直到它算得出來。`,
    );
    this.name = 'UnknownSpendError';
    this.logPath = logPath;
    this.lineNumber = bad.lineNumber;
  }
}

/**
 * 讀帳本把手上的 log.jsonl 再算。
 * 把手在、檔案不存在 = 全新安裝 = 0。沒有把手就丟錯,不回 0、不印 witness。
 * 有壞行(不分哪一天)丟 UnknownSpendError;讀得到但不是「檔案不存在」(權限、IO)也丟錯——
 * 那些都是不知道,不是零,也不是「跳過壞行之後的數字」。
 */
export function readDailySpend(ledger: LedgerHandle | undefined, day: string, prices: SpendPrices): DailySpend {
  if (ledger === undefined) throw new MissingLedgerError();
  let content: string;
  try {
    content = readFileSync(ledger.logPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { usd: 0, calls: 0 };
    throw err;
  }

  const parsed = parseLedger(content);
  if (!parsed.ok) throw new UnknownSpendError(ledger.logPath, parsed.bad);
  return computeDailySpend(parsed.events, day, prices);
}
