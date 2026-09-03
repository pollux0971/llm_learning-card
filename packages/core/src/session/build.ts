/**
 * 11-review-cli / phase-1:建立當日 session。
 *
 * 把 01(讀 reviews.json/settings.yaml)、04(buildDueList/selectSession)
 * 串起來,決定「今天要考哪些卡、順序為何、reteach 佇列是誰」。純粹是接線:
 * 排序與上限邏輯完全信任 04,這裡不重新計算 overdue_ratio 之類的東西。
 */
import type { CardId, Review } from '@contracts/index.js';
import { buildDueList, selectSession, type SchedulableCard } from '@core/scheduler/index.js';
import { FakeLlmRouter, loadFixturesFromDir, type LlmRouter } from '@core/grading/index.js';
import { resolve } from 'node:path';
import { loadReviews, loadSettings } from './io.js';
import type { Session } from './types.js';

const LLM_FIXTURES_DIR = resolve(import.meta.dirname, '../../../../contracts/fixtures/llm');

export interface BuildSessionCtx {
  learningDir: string;
  today: string;
  /**
   * 呼叫端注入的 LlmRouter,用於應用題審核(05 的 gradeApply)。phase-1
   * 不接 03-llm-router 的真實實作,一律用 05 自己的 FakeLlmRouter 從
   * contracts/fixtures/llm/ 讀預錄回應(跟 scripts/grade.ts 同一個模式)。
   * 不給就用預設的 FakeLlmRouter(讀 contracts/fixtures/llm/)。
   */
  router?: LlmRouter;
}

/**
 * 決定哪些今日到期卡片要排進 04-scheduler 的 reteach 佇列。
 *
 * 04 的 SelectCtx.reteach 註解明講:「排入 reteach 佇列、不佔上限的卡片 id
 * (來自 phase-2 的 stuck 判定)」,但沒有規定「誰決定這份清單」——那是組合層
 * (這裡)的工作,04 只負責照單全收。
 *
 * 設計決定(這一輪的介面設計,不是硬造的 hack):fails_in_row 剛好等於 2 的
 * 卡片進 reteach 佇列。理由對照 04-transitions.ts 的註解——2 次連錯時 emit
 * 'reteach_queued',但那個事件只在「剛好那次失敗」的呼叫當下出現一次,不會
 * 持久化成一個獨立的佇列檔案(契約 §12 的 state/ 檔案列表裡也沒有 reteach
 * 佇列這個檔案)。fails_in_row 本身就持久存在 Review 裡,用它當「還沒消化的
 * reteach 提示」的判斷依據,不用另外造一個檔案格式。
 *
 * fails_in_row >= 3(stuck)的卡不算在這裡——那些已經進到「answered 時額外
 * 顯示 stuck 提示」的路徑(見 presentNextCard),不是 reteach。一張卡不會同時
 * 觸發兩種提示。
 */
export function deriveReteachQueue(reviews: Record<CardId, Review>, dueCards: CardId[]): CardId[] {
  return dueCards.filter((card) => reviews[card]?.fails_in_row === 2);
}

/**
 * 建立今日 session:
 *   1. loadReviews + loadSettings(daily_cap)
 *   2. buildDueList(reviews, today) → 04 phase-1 的到期清單
 *   3. deriveReteachQueue(reviews, due 清單的卡片 id)
 *   4. 把 buildDueList 的結果補上 learned_at(SchedulableCard 需要),
 *      呼叫 selectSession({ dailyCap, reteach })
 *   5. 回傳 Session:queue = result.due,reteachQueue = result.reteach,
 *      totalDue = result.due.length,deferred = result.deferred,
 *      passed/failed/errors 從 0 起算,current 未設定
 *
 * router 沒給時用 FakeLlmRouter 讀 contracts/fixtures/llm/(跟
 * scripts/grade.ts 的模式一致),讓 `--dry-run` 之外的互動流程在沒有真實
 * 雲端金鑰時也能跑。
 */
export async function buildTodaySession(ctx: BuildSessionCtx): Promise<Session> {
  const reviews = loadReviews(ctx.learningDir);
  const settings = loadSettings(ctx.learningDir);

  // exactOptionalPropertyTypes 讓 04 自己落點內複製的 Review 型別跟 @contracts
  // 的 Review 型別在結構上「同形但不同名」時互不相容(見 answer.ts 的
  // asSchedulerReview 註解),這裡跨邊界一樣要經過 unknown 中介轉型。
  const dueItems = buildDueList(reviews as unknown as Parameters<typeof buildDueList>[0], ctx.today);
  const reteachQueue = deriveReteachQueue(
    reviews,
    dueItems.map((item) => item.card),
  );

  const schedulable: SchedulableCard[] = dueItems.map((item) => ({
    ...item,
    learned_at: reviews[item.card]!.learned_at,
  }));

  const result = selectSession(schedulable, { dailyCap: settings.daily_cap, reteach: reteachQueue });

  const router = ctx.router ?? new FakeLlmRouter(loadFixturesFromDir(LLM_FIXTURES_DIR));

  return {
    learningDir: ctx.learningDir,
    today: ctx.today,
    dailyCap: settings.daily_cap,
    router,
    queue: result.due,
    reteachQueue: result.reteach,
    totalDue: result.due.length,
    deferred: result.deferred,
    passed: 0,
    failed: 0,
    errors: 0,
    current: undefined,
  };
}
