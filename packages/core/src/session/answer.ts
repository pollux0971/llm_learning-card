/**
 * 11-review-cli / phase-1:收一題答案 → 呼叫 05 審核 → 呼叫 04 轉移 → 落地。
 *
 * 這裡刻意把「讀 stdin」跟「處理答案」切開:splitFillAnswer / joinApplyLines
 * 是純函式,吃的是已經收好的字串/字串陣列,不碰 process.stdin。
 * scripts/review.ts 用 node:readline 把使用者輸入收好之後,才呼叫這兩個
 * 函式與 submitAnswer——單元測試因此可以直接注入陣列,不用假造 readline。
 */
import type { Review } from '@contracts/index.js';
import { gradeApply, gradeFillQuestion } from '@core/grading/index.js';
import { applyFailTransition, applyPassTransition, type Review as SchedulerReview } from '@core/scheduler/index.js';
import { loadReviews, saveReviews } from './io.js';
import type { AnswerOutcome, Session } from './types.js';

/**
 * 04-scheduler 的 Review/ReviewEntry 是自己落點內複製的本地型別(見
 * session/types.ts 開頭的說明),跟 @contracts 的 Review 結構完全相容,只是
 * `exactOptionalPropertyTypes` 底下 `provisional?: boolean` 與
 * `provisional?: boolean | undefined` 這類寫法不算「同一型別」,TypeScript
 * 會擋。這裡跨那條邊界時用 unknown 中介轉型,不改任一邊的型別定義。
 */
function asSchedulerReview(review: Review): SchedulerReview {
  return review as unknown as SchedulerReview;
}

/**
 * 填空題答案:使用者在一行輸入,用逗號分隔對應每個空格
 * (phase-1.feature「the person enters three answers separated by commas」)。
 * 純函式:trim 每一段、逗號前後允許空白,不處理跳脫逗號之類的邊界
 * (fill 的答案本身不會含逗號,見契約 §3 的填空範例)。
 */
export function splitFillAnswer(raw: string): string[] {
  return raw.split(',').map((part) => part.trim());
}

/**
 * 應用題答案:使用者輸入多行,直到結束輸入(空行或 EOF,由呼叫端
 * scripts/review.ts 的 readline 迴圈決定何時算「結束」,這裡只負責組裝)。
 * 純函式:把收集到的每一行用換行字元接起來,視為「一個答案」整段送進
 * gradeApply(phase-1.feature「the whole text is submitted as one answer」)。
 * 尾端多餘的空行需 trim 掉。
 */
export function joinApplyLines(lines: string[]): string {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed.join('\n');
}

/**
 * 收一題答案,完整處理到「這個 checkpoint 是否已解決」為止。
 *
 * 前置:session.current 必須已由 presentNextCard 設定好(否則丟錯,呼叫順序
 * 用錯了)。rawAnswer 已經是 splitFillAnswer/joinApplyLines 處理過的形式——
 * fill 傳「切好的答案陣列要再轉成」還是直接傳原始單行由呼叫端決定,這裡的簽章
 * 統一吃 `string`,型別是 fill 就在函式內部呼叫 splitFillAnswer(rawAnswer)、
 * apply 就直接把 rawAnswer 當成整段答案——呼叫端不用知道兩者內部怎麼分。
 *
 * 步驟:
 * 1. 依 session.current.types[typeIndex] 決定呼叫 05 的哪個函式:
 *    - 'fill' → gradeFillQuestion(current.fillQuestion!, splitFillAnswer(rawAnswer), session.router)
 *    - 'apply' → gradeApply(current.applyQuestion!, rawAnswer, session.router)
 * 2. result.pass === null(grader 'error')→ current.hadError = true,
 *    這一題不進 pendingAnswers(phase-1.feature「A grading error leaves the
 *    card alone」)。否則把 { type, pass: result.pass, grader: result.grader }
 *    push 進 current.pendingAnswers。
 * 3. current.typeIndex += 1。
 * 4. 還有下一種題型沒問(typeIndex < types.length)→ 回傳
 *    `{ status: 'partial', pass: result.pass, feedback: result.feedback,
 *    cardDone: false }`,session.current 保留給下一次 presentNextCard/submitAnswer。
 *    這正是 phase-1.feature「no transition has been written yet」的狀態——
 *    這裡完全不碰 reviews.json。
 * 5. 這是這個 checkpoint 的最後一題:
 *    a. current.hadError → 不呼叫任何 04 的 transition 函式、不寫
 *       reviews.json;session.errors += 1;把 session.queue 頭部那張卡
 *       shift 掉(這個 checkpoint 结束,即使沒有結果);回傳
 *       `{ status: 'error', pass: null, feedback, cardDone: true }`。
 *    b. 否則:overallPass = current.pendingAnswers.every(a => a.pass)。
 *       - overallPass(stage 1/3/4/5 的 pendingAnswers.length===1,或 stage 2
 *         兩題都過的 pendingAnswers.length===2)→ 呼叫 applyPassTransition(review,
 *         { card, today: session.today, answers: pendingAnswers })。04 的
 *         PassCtx 已經對稱 FailCtx 改成接受 answers[](見
 *         packages/core/src/scheduler/transitions.ts 與
 *         features/11-review-cli/REVIEW.md 記錄的那個 bug),一次呼叫就能記多筆
 *         history、只推進一次 stage。
 *
 *         [TODO,下一輪實作]:目前 pendingAnswers.length > 1 這條分支還沒接上——
 *         下面暫時保留丟錯,避免在沒驗過的狀況下猜一個可能是錯的行為。
 *         對應規格見 answer.test.ts「submitAnswer — stage 2 checkpoint, both
 *         questions pass」與 phase-1.feature「A card at stage two advances
 *         after both questions pass」(目前都是紅燈)。
 *       - !overallPass → 呼叫 applyFailTransition(review, { card,
 *         today: session.today, answers: current.pendingAnswers })
 *         (04 的 FailCtx.answers 本來就是設計成一次checkpoint 的多題結果,
 *         這條路徑跟 04 的介面完全對得上,對照 phase-1.feature 的
 *         「A card at stage two is only resolved after both questions」)。
 *    c. loadReviews → 更新那張卡的 review → saveReviews(整份覆寫)。
 *       這一步必須在「回傳前」完成,對照 phase-1.feature「the change is
 *       written before the next question is shown」與「Answers land one at
 *       a time」——每張卡解決當下立刻寫,不是等 session 結束才寫。
 *    d. session.queue shift 掉這張卡;session.passed/session.failed 累加;
 *       session.current = undefined。
 *    e. 回傳 `{ status: overallPass ? 'passed' : 'failed', pass: overallPass,
 *       feedback, cardDone: true, newStage: 更新後的 review.stage }`。
 */
export async function submitAnswer(session: Session, rawAnswer: string): Promise<AnswerOutcome> {
  const current = session.current;
  if (!current) {
    throw new Error('submitAnswer 呼叫順序錯誤:session.current 還沒由 presentNextCard 設定');
  }

  const type = current.types[current.typeIndex]!;
  const result =
    type === 'fill'
      ? await gradeFillQuestion(current.fillQuestion!, splitFillAnswer(rawAnswer), session.router)
      : await gradeApply(current.applyQuestion!, rawAnswer, session.router);

  if (result.pass === null) {
    current.hadError = true;
  } else {
    current.pendingAnswers.push({ type, pass: result.pass, grader: result.grader });
  }

  current.typeIndex += 1;

  if (current.typeIndex < current.types.length) {
    return { status: 'partial', pass: result.pass, feedback: result.feedback, cardDone: false };
  }

  if (current.hadError) {
    session.errors += 1;
    session.queue.shift();
    session.current = undefined;
    return { status: 'error', pass: null, feedback: result.feedback, cardDone: true };
  }

  const overallPass = current.pendingAnswers.every((answer) => answer.pass);
  const reviews = loadReviews(session.learningDir);
  const review = reviews[current.card]!;

  let outcome;
  if (overallPass && current.pendingAnswers.length === 1) {
    const answer = current.pendingAnswers[0]!;
    outcome = applyPassTransition(asSchedulerReview(review), { card: current.card, today: session.today, answers: [{ type: answer.type, grader: answer.grader }] });
  } else if (overallPass) {
    // TODO(下一輪實作):04 的 PassCtx 現在已經接受 answers[](見上方 submitAnswer
    // 文件註解與 transitions.ts),這裡應該改成
    // applyPassTransition(asSchedulerReview(review), { card: current.card, today: session.today, answers: current.pendingAnswers })。
    // 這輪(審核/規格)刻意不動這個分支的行為,只設計介面、寫測試——
    // answer.test.ts 與 phase-1.feature 已經有對應的紅燈規格等下一輪轉綠。
    throw new Error(
      `[TODO 下一輪實作] answer.ts 還沒接上 04 新版的 applyPassTransition({ answers }) 介面,無法記錄卡片 ${current.card} 這次 checkpoint 的 ${current.pendingAnswers.length} 筆通過答案。`,
    );
  } else {
    outcome = applyFailTransition(asSchedulerReview(review), { card: current.card, today: session.today, answers: current.pendingAnswers });
  }

  reviews[current.card] = outcome.review as unknown as Review;
  saveReviews(session.learningDir, reviews);

  session.queue.shift();
  if (overallPass) session.passed += 1;
  else session.failed += 1;
  session.current = undefined;

  return {
    status: overallPass ? 'passed' : 'failed',
    pass: overallPass,
    feedback: result.feedback,
    cardDone: true,
    newStage: outcome.review.stage,
  };
}
