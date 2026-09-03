/**
 * 11-review-cli / phase-1:把 scheduler(04)、grading(05)、data-layer(01)
 * 串成一個能跑一次複習 session 的組合層。這裡只放跨檔案共用的型別。
 *
 * 這一輪只設計介面:所有函式本體 throw not implemented,邏輯留給下一輪。
 *
 * 型別一律用 04/05 自己的本地型別(scheduler/grading 各自的 types.ts)結構相容
 * 就好,不強制 nominal 對齊 @contracts——review-cli 是組合層,拿哪邊的物件
 * 傳給哪個函式,靠 TypeScript 的結構化型別自然相容(欄位形狀完全一樣)。
 * 只有讀寫磁碟(reviews.json / questions/*.yaml)這幾個 IO 函式直接用
 * @contracts 的 zod schema,因為那是磁碟格式的權威來源。
 */
import type { ApplyQuestion, CardId, FillQuestion, IsoDate, Review, Stage } from '@contracts/index.js';
import type { DueItem, FailAnswer, QuestionType } from '@core/scheduler/index.js';
import type { LlmRouter } from '@core/grading/index.js';

/**
 * 目前正在被考的這張卡(一個 checkpoint)。stage 1/3/4/5 只有一種題型,
 * types.length === 1;stage 2 是 ['fill','apply'],兩題都答完才算解決
 * (phase-1.feature「A card at stage two is only resolved after both questions」)。
 *
 * pendingAnswers 只收「有明確結果」的答案(pass 是 boolean,不是 null)。
 * 只要這個 checkpoint 裡任何一題判為 error(GradeResult.pass === null),
 * hadError 就設 true——整個 checkpoint 不寫任何 transition
 * (「A grading error leaves the card alone」),即使其他題已經有明確結果。
 */
export interface CurrentQuestion {
  card: CardId;
  stage: Stage;
  overdueDays: number;
  overdueRatio: number;
  stuck: boolean;
  types: QuestionType[];
  typeIndex: number;
  fillQuestion?: FillQuestion;
  applyQuestion?: ApplyQuestion;
  pendingAnswers: FailAnswer[];
  hadError: boolean;
}

/**
 * 一次複習 session 的完整狀態。buildTodaySession 建立,presentNextCard /
 * submitAnswer 就地更新(不是純函式——這一層本來就要碰磁碟與可變狀態)。
 *
 * queue 的順序就是 04-scheduler selectSession 回傳的順序,session 全程不重排。
 * totalDue 是建立當下的 queue 長度,當作進度分母的固定值——中途沒有「當天
 * 新到期的卡」這回事(NEXT.md 已定案:等明天),所以分母不會變動。
 */
export interface Session {
  learningDir: string;
  today: IsoDate;
  dailyCap: number;
  router: LlmRouter;
  queue: DueItem[];
  reteachQueue: CardId[];
  totalDue: number;
  deferred: number;
  passed: number;
  failed: number;
  errors: number;
  /**
   * `| undefined` 特別寫出來(不只是 `?:`):`exactOptionalPropertyTypes` 開著,
   * submitAnswer 解決一個 checkpoint 後要能明確寫 `session.current = undefined`
   * 清掉它,不是只能整個欄位不存在。
   */
  current?: CurrentQuestion | undefined;
}

/** presentNextCard 的回傳:三選一。呼叫端(CLI)用 kind 判斷怎麼呈現。 */
export type CardPresentation =
  | {
      kind: 'reteach';
      card: CardId;
      /** cards/<category>/<id>.short.md 的內容 */
      shortBody: string;
    }
  | {
      kind: 'question';
      card: CardId;
      stage: Stage;
      type: QuestionType;
      prompt: string;
      /** type==='fill' 時,prompt 裡 ___ 的數量,方便 CLI 提示要輸入幾個答案 */
      blanks?: number;
      /** 1-based,以 due 佇列(不含 reteach)計算,同一張卡的兩題共用同一個 progress */
      progress: { index: number; total: number };
      stuck: boolean;
    }
  | { kind: 'done' };

/** submitAnswer 的回傳。status==='partial' 代表這個 checkpoint 還沒解決(stage 2 的第一題)。 */
export interface AnswerOutcome {
  status: 'passed' | 'failed' | 'error' | 'partial';
  pass: boolean | null;
  feedback: string;
  /** checkpoint 是否已經解決(卡片已從 queue 移除、reviews.json 已落地或確定跳過)。 */
  cardDone: boolean;
  /** cardDone 且 status 不是 'error' 時,推進/回退後的 stage。 */
  newStage?: Stage;
}

/** estimateTomorrow 的輸入。刻意不吃 Session/磁碟——純函式,呼叫端自己算出這兩個數字。 */
export interface EstimateInput {
  /** 今天結束前,不算今天答錯而回退的卡,原本就到期在明天的張數 */
  dueTomorrowExcludingReturns: number;
  /** 今天答錯、回退到 stage 1(次日到期)的張數,通常等於 session.failed */
  returnedToday: number;
  dailyCap: number;
}

export interface EstimateResult {
  /** dueTomorrowExcludingReturns + returnedToday,套用上限前的原始總數 */
  total: number;
  capped: boolean;
  /** min(total, dailyCap) */
  shown: number;
  /** max(0, total - dailyCap) */
  overflow: number;
}

/** renderSummary 的輸入。同樣是純資料,不吃 Session,方便單獨測文字格式。 */
export interface SessionSummaryInput {
  passed: number;
  failed: number;
  errors: number;
  tomorrow: EstimateResult;
}
