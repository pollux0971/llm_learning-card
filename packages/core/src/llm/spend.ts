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

/** `type === 'llm_call'` 且 `provider === 'openai'`——只有雲端會花錢。 */
export function isLlmCallEvent(_event: LogEvent): boolean {
  throw new Error('not implemented: isLlmCallEvent (03-llm-router/phase-4)');
}

/** ISO 8601 → `YYYY-MM-DD`(本地日期,對齊使用者感受到的「今天」)。 */
export function dayOf(_ts: string): string {
  throw new Error('not implemented: dayOf (03-llm-router/phase-4)');
}

/** 純函式:事件清單 + 哪一天 + 價格 → 當日金額與筆數。 */
export function computeDailySpend(_events: LogEvent[], _day: string, _prices: SpendPrices): DailySpend {
  throw new Error('not implemented: computeDailySpend (03-llm-router/phase-4)');
}

/** ADR-039:`spent >= cap` 就算已達上限。`cap <= 0` 視為沒有上限。 */
export function isBudgetExhausted(_spentUsd: number, _capUsd: number): boolean {
  throw new Error('not implemented: isBudgetExhausted (03-llm-router/phase-4)');
}

/** 契約 §11:`LLM_PRICE_IN_PER_M` / `LLM_PRICE_OUT_PER_M`,不合法就用預設值。 */
export function readSpendPrices(_env: NodeJS.ProcessEnv): SpendPrices {
  throw new Error('not implemented: readSpendPrices (03-llm-router/phase-4)');
}

/** 契約 §11:`LLM_DAILY_CAP_USD`,不合法就用 `DEFAULT_DAILY_CAP_USD`。 */
export function readDailyCapUsd(_env: NodeJS.ProcessEnv): number {
  throw new Error('not implemented: readDailyCapUsd (03-llm-router/phase-4)');
}

/** 讀 log.jsonl 再算。檔案不存在回 `{ usd: 0, calls: 0 }`,不丟錯。 */
export function readDailySpend(_logPath: string, _day: string, _prices: SpendPrices): DailySpend {
  throw new Error('not implemented: readDailySpend (03-llm-router/phase-4)');
}
