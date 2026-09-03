/**
 * 11-review-cli / phase-1:呈現下一張卡(或下一題)。
 *
 * 呼叫順序永遠是 presentNextCard → (CLI 收輸入) → submitAnswer → 需要的話
 * 再呼叫 presentNextCard。這個函式本身不收輸入,只決定「現在該給使用者看
 * 什麼」,把「讀 stdin」完全留給 scripts/review.ts。實作時會用到:
 * `./io.js` 的 loadCardBody / loadQuestionFile、`@contracts/index.js` 的
 * countBlanks。
 *
 * 決定並回傳下一個要呈現的東西:
 *
 * 1. reteachQueue 還有卡 → 從佇列頭部取一張(shift,消耗掉),回傳
 *    `{ kind: 'reteach', card, shortBody }`(loadCardBody(..., { short: true }))。
 *    這裡不動 session.current、不動任何 progress 計數
 *    (phase-1.feature「it is not counted in the progress」)。
 *
 * 2. reteachQueue 空了、session.current 還沒設定、queue 也空了
 *    → `{ kind: 'done' }`(沒有更多卡了)。
 *
 * 3. reteachQueue 空了、session.current 還沒設定、queue 有卡
 *    → peek(不 shift)queue[0],用 loadQuestionFile 讀該卡的題目,建立
 *    session.current(typeIndex=0、pendingAnswers=[]、hadError=false),
 *    回傳第一種題型的 `{ kind: 'question', ... }`。
 *
 * 4. session.current 已設定(stage 2 答完第一題、還沒答第二題)
 *    → 回傳 session.current.types[typeIndex] 那一題的 presentation,
 *    不重新從 queue 拿卡、不改 progress(同一張卡的第二題共用同一個 progress)。
 *
 * progress:`{ index, total }`。total = session.totalDue(建立 session 當下的
 * queue 長度,固定分母);index = session.totalDue - session.queue.length + 1
 * (第一張卡是 1,不是 0)。reteach 完全不影響這兩個數字。
 *
 * blanks 欄位只在 type==='fill' 時填,用 `countBlanks(fillQuestion.prompt)`
 * (契約 §3 的權威演算法,不自己重新算 `___` 的數量)。
 *
 * 題目挑選:QuestionFile.fill / .apply 各是 2-3 / 1-2 題的陣列(同一張卡的
 * 「備用題」,不是要全部問)。這一輪的設計決定:固定挑 index 0——「輪替」或
 * 「挑最近沒考過的」是可以之後再決定的事,phase-1.feature 沒有任何場景測
 * 這個選擇,不要在沒有驗收標準的情況下先做複雜的挑選邏輯。
 */
import type { CardPresentation, Session } from './types.js';

export async function presentNextCard(_session: Session): Promise<CardPresentation> {
  throw new Error('not implemented');
}
