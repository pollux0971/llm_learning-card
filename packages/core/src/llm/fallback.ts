/**
 * 備援規則(ADR-039)。**契約 §7 的路由表一格都沒動**——那張表講的是「在線 /
 * 離線+本機 / 離線+無本機」三種連線狀態;這裡多的是第四種情況:**在線,但雲端
 * 這一次不能用**(5xx、逾時、截斷重試後仍失敗,或當日預算用完)。
 *
 * 契約 §7 沒有這一欄,因為它假設「在線」就等於「雲端可用」。真的花錢跑之後才
 * 發現這兩件事不一樣,而閘道(ADR-039)是免費的,不用它就是浪費。
 *
 * 落點:獨立成檔案,**不放進 `routing.ts`**——比照 `token-limits.ts` 的做法,
 * 避免動到 `routing.ts` 既有的嚴格 95% 變異門檻(FEATURE.md 技術棧表;
 * ADR-036 的教訓:嚴格門檻的檔案要單獨重跑 Stryker)。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `FallbackGroup`:三種 task 分組
 *   - `'gateway-always'`:`grade.fill.llm`。契約 §7 本來就寫 local,不是新規則。
 *   - `'gateway-fallback'`:`deepen` / `grade.apply` / `reteach.short`。雲端優先,
 *     雲端不能用就改走閘道並標 provisional。
 *   - `'cloud-only'`:`ingest.*`。沒有備援(使用者明確選的:卡片品質還沒用本機
 *     模型驗過,不讓它產卡)。
 * - `FALLBACK_TABLE: Record<LlmTask, FallbackGroup>`:上面那張表的資料版本。
 * - `CloudStatus`:`'ok'`(雲端可用)/ `'failed'`(這次呼叫失敗)/
 *   `'budget-exhausted'`(當日預算已達上限,見 spend.ts 的 isBudgetExhausted)。
 * - `FallbackReason`:`'cloud_failed'` / `'budget_exhausted'`,寫進 log 的
 *   `fallback_reason` 欄位。
 * - `FallbackInput { task, cloud }`
 * - `FallbackDecision { target: 'cloud' | 'gateway'; provisional: boolean;
 *   reason?: FallbackReason }`
 * - `decideFallback(input, table = FALLBACK_TABLE): FallbackDecision`:純函式,
 *   不碰 I/O。
 *   - `gateway-always`:一律 `{ target: 'gateway', provisional: false }`——
 *     不管 cloud 狀態。填空審核本來就該由本機做,**不算暫定**(它不是雲端結果的
 *     替代品,它就是契約指定的做法),所以不進 I6 的複審佇列。
 *   - `gateway-fallback` + `cloud === 'ok'` → `{ target: 'cloud', provisional: false }`。
 *   - `gateway-fallback` + `cloud === 'failed'` →
 *     `{ target: 'gateway', provisional: true, reason: 'cloud_failed' }`。
 *   - `gateway-fallback` + `cloud === 'budget-exhausted'` →
 *     `{ target: 'gateway', provisional: true, reason: 'budget_exhausted' }`。
 *   - `cloud-only` + `cloud === 'ok'` → `{ target: 'cloud', provisional: false }`。
 *   - `cloud-only` + `cloud === 'failed'` → 丟 `CloudRequiredError`(契約 §7 的
 *     `CLOUD_REQUIRED`,同一個錯誤:呼叫端要知道的就是「這件事只有雲端能做,
 *     而雲端現在做不到」)。
 *   - `cloud-only` + `cloud === 'budget-exhausted'` → 丟 `DailyBudgetExceededError`
 *     (訊息含「今日預算已用完」)。**在花錢之前就拒絕**,不是打了才發現。
 *     這個分支需要金額,所以 input 可以帶 `spentUsd` / `capUsd`,沒帶就填 0。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 fallback.test.ts。
 */

import type { LlmTask } from './types.js';

export type FallbackGroup = 'gateway-always' | 'gateway-fallback' | 'cloud-only';

/** ADR-039 的備援規則,資料版本。改這張表就改行為,不用改 decideFallback。 */
export const FALLBACK_TABLE: Readonly<Record<LlmTask, FallbackGroup>> = {
  'ingest.cards': 'cloud-only',
  'ingest.questions': 'cloud-only',
  'ingest.deps': 'cloud-only',
  deepen: 'gateway-fallback',
  'grade.apply': 'gateway-fallback',
  'reteach.short': 'gateway-fallback',
  'grade.fill.llm': 'gateway-always',
};

export type CloudStatus = 'ok' | 'failed' | 'budget-exhausted';

export type FallbackReason = 'cloud_failed' | 'budget_exhausted';

export interface FallbackInput {
  task: LlmTask;
  cloud: CloudStatus;
  /** 只有 `cloud-only` + `budget-exhausted` 那條需要,用來組錯誤訊息 */
  spentUsd?: number;
  capUsd?: number;
}

export interface FallbackDecision {
  target: 'cloud' | 'gateway';
  provisional: boolean;
  reason?: FallbackReason;
}

/**
 * 純函式:{ task, cloud } → 走雲端還是閘道,或丟 CloudRequiredError /
 * DailyBudgetExceededError。不呼叫任何 I/O。
 *
 * `table` 參數的用意跟 `routing.ts` 的 `decideRoute` 一樣:讓「改備援表就改行為」
 * 可以在不碰函式本體的情況下被驗證。
 */
export function decideFallback(
  _input: FallbackInput,
  _table: Readonly<Record<LlmTask, FallbackGroup>> = FALLBACK_TABLE,
): FallbackDecision {
  throw new Error('not implemented: decideFallback (03-llm-router/phase-4)');
}
