/**
 * phase-3:每日上限與逾期比例優先序,對照 phase-3.feature 的 10 個場景。
 * 契約 §6 SelectResult(due/deferred/reteach)在這裡實作。
 *
 * 這一輪只設計介面:函式本體全部 throw not implemented,由下一輪實作。
 * 三個函式互不依賴呼叫順序,可分開實作與測試。
 */
import type { CardId, DueItem, IsoDate, Stage } from './types.js';

// ------------------------------------------------------------------------
// computeOverdueRatio
// ------------------------------------------------------------------------

/** computeOverdueRatio 的輸入:只取得出比例需要的兩個欄位,不用整張 Review。 */
export interface OverdueCtx {
  stage: Stage;
  next_due: IsoDate;
}

/**
 * 逾期比例 = 逾期天數 / 該 stage 的間隔天數(intervals.ts 的間隔表,不重新發明數字)。
 * `next_due` 晚於 `today`(還沒到期)不是這個函式的合法輸入,由呼叫端保證
 * (buildDueList 已經先篩過)。`next_due === today` 回傳 0。
 */
export function computeOverdueRatio(card: OverdueCtx, today: IsoDate): number {
  throw new Error('not implemented');
}

// ------------------------------------------------------------------------
// selectSession
// ------------------------------------------------------------------------

/**
 * selectSession 的輸入項:buildDueList 回傳的 DueItem 加上 learned_at,
 * 只有 learned_at 是 phase-3 新需要的(逾期比例打平手時的次要排序鍵)。
 * DueItem 本身不带 learned_at(契約 §6 沒有這個欄位),所以在這裡擴充,
 * 不改 contracts/types.md 的 DueItem 定義。
 */
export interface SchedulableCard extends DueItem {
  learned_at: IsoDate;
}

export interface SelectCtx {
  /** 每日題數上限。必須 > 0,否則丟錯(場景:An invalid cap is rejected)。 */
  dailyCap: number;
  /** 排入 reteach 佇列、不佔上限的卡片 id(來自 phase-2 的 stuck 判定)。預設 []。 */
  reteach?: CardId[];
}

export interface SelectResult {
  /** 已依逾期比例(高到低,平手用 learned_at 早到晚)排序,長度 <= ctx.dailyCap */
  due: DueItem[];
  /** 因上限而順延的張數,即 dueCards.length - due.length(不含 reteach) */
  deferred: number;
  /** 原樣回傳 ctx.reteach,不佔上限、不影響 due/deferred 的計算 */
  reteach: CardId[];
}

/**
 * 依逾期比例排序、套用每日上限。純函式:不修改 dueCards,回傳新陣列。
 * 排序鍵:overdue_ratio 由高到低;相同時 learned_at 由早到晚(越早學的越先考,
 * 因為它積欠的複習次數理論上更多)。
 *
 * dailyCap <= 0 視為設定錯誤(§11 Settings.daily_cap 「必須 > 0」),丟錯並在
 * message 裡帶出實際收到的 cap 值(場景:「an error is raised naming the cap」)。
 */
export function selectSession(dueCards: SchedulableCard[], ctx: SelectCtx): SelectResult {
  throw new Error('not implemented');
}

// ------------------------------------------------------------------------
// simulateSteadyState
// ------------------------------------------------------------------------

export interface SimulationCtx {
  /** 模擬天數 */
  days: number;
  /** 每天新學的卡片數 */
  newCardsPerDay: number;
  /** 每日題數上限,同 SelectCtx.dailyCap */
  dailyCap: number;
  /** 模擬起始日,預設實作可自選一個固定值(不影響穩態,只影響絕對日期) */
  startDate?: IsoDate;
}

export interface DailyLoad {
  /** 第幾天,1-based */
  day: number;
  date: IsoDate;
  /** 當天到期的卡片數(套用上限前) */
  due_count: number;
  /** 當天實際被排進題目的卡片數(套用上限後,不含 reteach) */
  selected_count: number;
  /** 當天因上限而順延的卡片數 */
  deferred_count: number;
  /** due_count > dailyCap,即當天有卡片被順延 */
  cap_reached: boolean;
}

export interface SimulationReport {
  /** 逐日負擔曲線,長度 === ctx.days */
  daily: DailyLoad[];
  /** cap_reached 為 true 的天數 */
  cap_reached_days: number;
  /** cap_reached_days / ctx.days */
  cap_reached_ratio: number;
}

/**
 * 模擬穩態負擔:每天學 newCardsPerDay 張新卡、套用固定間隔表推進、套用
 * selectSession 的每日上限與排序,連跑 days 天,回報逐日題數曲線與碰到上限
 * 的頻率。用來回答「這個 daily_cap 撐不撐得住這個學習速度」,不是產品功能,
 * 是設計驗證工具(NEXT.md「完成後」段落要求跑這個看穩態)。
 */
export function simulateSteadyState(ctx: SimulationCtx): SimulationReport {
  throw new Error('not implemented');
}
