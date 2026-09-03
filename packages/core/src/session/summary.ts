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
