/**
 * 契約 §7 路由表的可執行版本(phase-2)。
 *
 * ADR-037:本機模型延後,`probeLocal()` 目前固定回 unavailable。但路由表本身
 * (哪個 task 在哪種連線狀態下走 cloud / local / 丟哪種錯誤)是硬約定,必須
 * 現在就測滿——因為表格邏輯正確與否不依賴真的本機模型存不存在,只依賴
 * online/local 這兩個布林值。
 *
 * 設計原則:decideRoute() 是純函式。不呼叫 probeOnline()/probeLocal(),只吃
 * { task, online, local } 三個值,回傳決策或丟錯。這樣測試才能在沒有真的
 * 本機模型的情況下把契約 §7 那張表的 11 組全部覆蓋(FEATURE.md:routing.ts
 * 嚴格 95% 變異門檻)。
 *
 * 「改路由表就改行為,不用改 decideRoute 本身」(phase-2.feature 最後一個
 * scenario)靠 ROUTING_TABLE 是資料、decideRoute 只是讀表來做到——換表就換
 * 行為,decideRoute 的邏輯不用動。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `RouteGroup`:三種 task 分組(cloud-only / cloud-or-local / local-only),
 *   對應契約 §7 表格的三個 task 列。
 * - `ROUTING_TABLE: Record<LlmTask, RouteGroup>`:權威表格的資料版本。
 * - `RouteInput`:decideRoute() 的輸入 { task, online, local }。
 * - `RouteDecision`:decideRoute() 的正常回傳 { target: 'cloud' | 'local', provisional }。
 * - `decideRoute(input, table = ROUTING_TABLE): RouteDecision`:純函式。
 *   - cloud-only:online → cloud;offline → 丟 CloudRequiredError(不管 local)。
 *   - cloud-or-local:online → cloud;offline+local → local, provisional=true;
 *     offline+無 local → 丟 NoModelError。
 *   - local-only:local → local, provisional=false;無 local → 丟 NoModelError
 *     (不管 online——grade.fill.llm 本來就該走本機,見 phase-2.feature 的
 *     `grade.fill.llm | up | down | error, no model available`)。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見 routing.test.ts。
 */

import type { LlmTask } from './types.js';
import { CloudRequiredError, NoModelError } from './errors.js';

export type RouteGroup = 'cloud-only' | 'cloud-or-local' | 'local-only';

/** 契約 §7 權威表的資料版本。三個 task 分組,對應表格的三列。 */
export const ROUTING_TABLE: Readonly<Record<LlmTask, RouteGroup>> = {
  'ingest.cards': 'cloud-only',
  'ingest.questions': 'cloud-only',
  'ingest.deps': 'cloud-only',
  deepen: 'cloud-or-local',
  'grade.apply': 'cloud-or-local',
  'reteach.short': 'cloud-or-local',
  'grade.fill.llm': 'local-only',
};

export interface RouteInput {
  task: LlmTask;
  online: boolean;
  local: boolean;
}

export interface RouteDecision {
  target: 'cloud' | 'local';
  provisional: boolean;
}

/**
 * 純函式:{ task, online, local } → 路由決策,或丟 CloudRequiredError / NoModelError。
 * 不呼叫任何 I/O(不打 probeOnline/probeLocal)。table 參數只是為了讓
 * 「改路由表就改行為」那個 scenario 可以在不碰這個函式本體的情況下,傳一份
 * 被改過的表格進來驗證。
 */
export function decideRoute(input: RouteInput, table: Readonly<Record<LlmTask, RouteGroup>> = ROUTING_TABLE): RouteDecision {
  const { task, online, local } = input;
  const group = table[task];

  if (group === 'cloud-only') {
    if (online) return { target: 'cloud', provisional: false };
    throw new CloudRequiredError(task);
  } else if (group === 'cloud-or-local') {
    if (online) return { target: 'cloud', provisional: false };
    if (local) return { target: 'local', provisional: true };
    throw new NoModelError(task);
  } else {
    if (local) return { target: 'local', provisional: false };
    throw new NoModelError(task);
  }
}
