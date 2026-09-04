/**
 * 11-review-cli / phase-1:session 結束時的算式與文字呈現。全部純函式,
 * 不吃 Session 物件、不碰磁碟——呼叫端(scripts/review.ts)自己從 Session
 * 與磁碟狀態算出這裡要的數字,方便單獨測文字格式與邊界值。
 */
import type { EstimateInput, EstimateResult, SessionSummaryInput } from './types.js';

/**
 * 明日預估:dueTomorrowExcludingReturns + returnedToday(phase-1.feature
 * 「The estimate accounts for returns and the cap」)。
 *
 * total 超過 dailyCap 時,capped=true、shown=dailyCap、overflow=total-dailyCap;
 * 沒超過時 capped=false、shown=total、overflow=0。
 */
export function estimateTomorrow(input: EstimateInput): EstimateResult {
  const total = input.dueTomorrowExcludingReturns + input.returnedToday;
  const capped = total > input.dailyCap;
  return {
    total,
    capped,
    shown: capped ? input.dailyCap : total,
    overflow: capped ? total - input.dailyCap : 0,
  };
}

/**
 * session 小結文字。至少要包含:
 *   - 通過/回退張數(phase-1.feature「the summary reports 3 passed and 2
 *     returned」——用詞是 passed / returned,不是 failed)
 *   - 明日預估:tomorrow.capped 為 false 時報 tomorrow.shown;為 true 時
 *     同時報 shown(上限)與 overflow(超出的張數)
 * errors 有發生時也要提一句(不是 phase-1.feature 明文要求,但 session 結束
 * 使用者應該知道有幾題因為 grading 錯誤被跳過)。
 */
export function renderSummary(input: SessionSummaryInput): string {
  const lines: string[] = [`${input.passed} passed, ${input.failed} returned.`];

  lines.push(
    input.tomorrow.capped
      ? `Tomorrow: ${input.tomorrow.shown} due (daily cap reached, ${input.tomorrow.overflow} more waiting).`
      : `Tomorrow: ${input.tomorrow.shown} due.`,
  );

  if (input.errors > 0) {
    lines.push(`${input.errors} question(s) had a grading error and were skipped.`);
  }

  return lines.join('\n');
}

/**
 * `--dry-run` 的輸出:列出每張到期卡的 stage 與逾期程度,順序跟
 * selectSession 回傳的一樣(phase-1.feature「in the order they would be
 * asked」)。不呼叫任何 grading/transition,不寫任何檔案——這個函式只是
 * 格式化字串,「不寫檔案」這件事由呼叫端(scripts/review.ts)保證:
 * dry-run 模式下完全不呼叫 submitAnswer/saveReviews。
 */
export function renderDryRun(due: { card: string; stage: number; overdueDays: number }[]): string {
  if (due.length === 0) return 'Nothing is due today.';
  return due.map((d) => `${d.card}  stage ${d.stage}  overdue ${d.overdueDays}d`).join('\n');
}

/**
 * `--dry-run` 的第一行:基數。形狀比照 check-boundaries 的
 * 「boundaries: 掃描 195 個檔案,允許例外 11 條」。
 *
 * 為什麼三個數字都要:0 張到期同時是「今天剛好沒排到」與「卡片全部消失」的
 * 答案,而「全部未排程」與「全部排好但今天安靜」也都是 0 張到期。三個數字
 * 一起印才分得開——使用者每天看到的那句 Nothing is due today. 才有意義。
 *
 * `unscheduled` 是磁碟上有卡但 reviews.json 沒有紀錄的張數。那是**正常**狀態
 * (剛 ingest 出來的新卡就是這樣,真 vault 現在 25 張全部如此),所以只是報數,
 * 不是紅燈。
 */
export function renderDryRunHeader(input: { cards: number; due: number; unscheduled: number }): string {
  return `掃描 ${input.cards} 張卡,${input.due} 張到期,${input.unscheduled} 張未排程。`;
}

/**
 * 0 張卡的診斷。這是 P-28 在 11-review-cli 的核心:0 張卡**不是**空閒日,
 * 絕對不可以印 Nothing is due today.——那句話是使用者每天看到的安心訊息,
 * 卡片消失時原封不動地再印一次,他會連續好幾天都不知道。
 *
 * `cardsDir` 由呼叫端算好路徑傳進來(這個檔案不碰磁碟也不組路徑)。
 */
export function renderNoCards(cardsDir: string): string {
  return [
    `✗ review: 掃描到 0 張卡——這個 vault 沒有卡片(${cardsDir} 底下沒有任何 .md)。`,
    '這不是很乾淨,是掃描器壞了。--dir 指錯地方、目錄被搬走或同步刪掉時就長這樣。',
  ].join('\n');
}
