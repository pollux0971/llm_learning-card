/**
 * 當日 OpenAI 花費(ADR-039)。
 *
 * 花費不另外存 counter 檔——`state/log.jsonl` 已經有 `llm_call` 事件帶
 * `tokens_in` / `tokens_out`(契約 §10),再存一份就有兩個真相來源,而且
 * counter 檔要處理原子寫入與跨日重置。從 log 算是純函式,好測。
 *
 * 只算 `provider === 'openai'` 的事件——閘道(`ollama`)跑在使用者自己的硬體上,
 * 免費,不計入預算。
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
 * - `isLlmCallEvent(event)`:type 是 `llm_call` 且 provider 是 openai 的型別守衛。
 * - `dayOf(ts)`:把 ISO 8601 時間戳切成 `YYYY-MM-DD`(取本地日期,跟使用者的
 *   「今天」一致——預算是使用者感受到的一天,不是 UTC 的一天)。
 * - `computeDailySpend(events, day, prices)`:純函式。只挑 `type === 'llm_call'`、
 *   `provider === 'openai'`、`dayOf(ts) === day` 的事件,把
 *   `tokens_in / 1e6 * inPerM + tokens_out / 1e6 * outPerM` 加總。缺欄位的
 *   token 數當 0(逾時/截斷的事件沒有 token 欄位,但仍算一筆 `calls`)。
 * - `isBudgetExhausted(spentUsd, capUsd)`:**`spent >= cap` 就算達到**(ADR-039)。
 *   剛好等於上限算已用完:上限是天花板不是配額目標,而且 log 算出來的數字是
 *   低估(進行中還沒寫 log 的那次呼叫不在裡面)。`capUsd <= 0` 視為「沒有上限」,
 *   一律回 false——避免有人把變數設成 0 就整個系統停擺。
 * - `readSpendPrices(env)` / `readDailyCapUsd(env)`:契約 §11 的環境變數讀取,
 *   數值不合法(非數字 / 負數)就退回預設值,不丟錯。
 * - `readDailySpend(logPath, day, prices)`:讀 `log.jsonl` 檔案再算。檔案不存在
 *   回 `{ usd: 0, calls: 0 }`(還沒呼叫過就是沒花錢),不丟錯。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 spend.test.ts。
 */

import { readFileSync } from 'node:fs';
import type { LogEvent } from '@contracts/index.js';

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
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** `type === 'llm_call'` 且 `provider === 'openai'`——只有雲端會花錢。 */
export function isLlmCallEvent(event: LogEvent): boolean {
  return event.type === 'llm_call' && field(event, 'provider') === 'openai';
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
  if (!Number.isFinite(value) || value < 0) return fallback;
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

/** 讀 log.jsonl 再算。檔案不存在回 `{ usd: 0, calls: 0 }`,不丟錯。 */
export function readDailySpend(logPath: string, day: string, prices: SpendPrices): DailySpend {
  let content: string;
  try {
    content = readFileSync(logPath, 'utf8');
  } catch {
    // 還沒呼叫過就是沒花錢——檔案不存在不是錯誤。
    return { usd: 0, calls: 0 };
  }

  // 壞掉的一行只跳過那一行,不整份放棄:整份放棄會把花費算成 0,而 0 的方向
  // 是「還可以繼續花」,錢的方向上不能這樣錯。
  const events: LogEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line) as LogEvent);
    } catch {
      continue;
    }
  }

  return computeDailySpend(events, day, prices);
}
