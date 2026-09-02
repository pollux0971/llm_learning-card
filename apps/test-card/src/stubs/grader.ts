/**
 * StubGrader(FEATURE.md「Wave 0 的重複」表)。假裝是 05-grading 的審核結果。
 *
 * 填空:精確比對(去頭尾空白、忽略大小寫),對上契約 §3 FillQuestion.answers 的任一個可接受寫法。
 * 應用:沒有真正的 LLM,只檢查有沒有寫東西——這裡的重點是 UI 收得到 GradeResult 並正確顯示,
 * 不是審核品質(那是 05 的職責)。
 *
 * configureDelay / configureError 給測試用,對應 phase-1.feature 的
 * 「takes four seconds」「returns an error result」兩個場景。
 */
import type { ApplyQuestion, FillQuestion, GradeResult } from '../types.js';

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export class StubGrader {
  private delayMs = 0;
  private forceError = false;

  /** 場景:「the stub grader is configured to take four seconds」 */
  configureDelay(ms: number): void {
    this.delayMs = ms;
  }

  /** 場景:「the stub grader returns an error result」 */
  configureError(force: boolean): void {
    this.forceError = force;
  }

  async gradeFill(question: FillQuestion, typed: string[]): Promise<GradeResult> {
    await wait(this.delayMs);
    if (this.forceError) return { pass: null, feedback: '評分服務暫時無法使用', grader: 'error' };

    const blanks = question.answers.length;
    let allCorrect = typed.length === blanks;
    for (let i = 0; i < blanks && allCorrect; i++) {
      const accepted = (question.answers[i] ?? []).map(normalize);
      if (!accepted.includes(normalize(typed[i] ?? ''))) allCorrect = false;
    }

    return allCorrect
      ? { pass: true, feedback: '正確', grader: 'exact' }
      : { pass: false, feedback: '答案不符,請看正確答案', grader: 'fallback-strict' };
  }

  async gradeApply(question: ApplyQuestion, typed: string): Promise<GradeResult> {
    await wait(this.delayMs);
    if (this.forceError) return { pass: null, feedback: '評分服務暫時無法使用', grader: 'error' };

    const answered = typed.trim().length > 0;
    const criteria = question.rubric.map(() => answered);
    const pass = criteria.every(Boolean);

    return {
      pass,
      criteria,
      feedback: pass ? '涵蓋重點' : '內容太短,請補充',
      grader: 'local-provisional',
    };
  }
}
