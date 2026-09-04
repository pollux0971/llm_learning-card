/**
 * 回歸流程(phase-2):基準、prompt 漂移偵測、分數沿用。
 *
 * 這一層回答的是「這次改動之後,人要看哪幾項」。它跟 compare.ts 分開:
 * compare 只把兩次 run 並排顯示、不下判斷(ADR-032);要不要重打分是這裡的事。
 *
 * 基準怎麼存:第一次 live golden run 打完分之後,在那個 run 目錄放一個 BASELINE 檔
 * (內容是該 run 的 meta JSON)。不另外維護索引——目錄本身就是資料,
 * 手動搬動或刪除 run 目錄不會留下對不上的索引。
 */
import type { BaselineInfo, CompareResult, LlmTask, PromptDrift, RegressionReview } from './types.js';

/** 基準標記檔的檔名。改這個等於改磁碟格式,不要隨手改。 */
export const BASELINE_MARKER = 'BASELINE.json';

export class BaselineAlreadyExistsError extends Error {
  constructor(
    public readonly task: string,
    public readonly existingDir: string,
  ) {
    super(`task「${task}」已經有基準了:${existingDir}。基準只立一次,之後的 run 是拿來跟它比的。`);
    this.name = 'BaselineAlreadyExistsError';
  }
}

/**
 * 把一次 run 標成基準。已經有基準就丟 BaselineAlreadyExistsError——
 * 「基準只立一次並保留」是這條流程的重點,靜靜覆蓋掉舊基準就沒有基準可言了。
 */
export function markBaseline(baseDir: string, runDir: string): BaselineInfo {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/** 找出一個任務的基準 run;沒有就 undefined。 */
export function findBaseline(baseDir: string, task: LlmTask): BaselineInfo | undefined {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/**
 * prompt 檔在基準之後被改過但沒有新的 golden run —— ADR-032 要抓的正是這件事。
 * 有漂移就回傳 prompt 檔路徑與**兩個 commit**(基準的與現在的),讓人能直接 git diff。
 * 沒有基準時回 undefined(還沒有基準就談不上漂移);兩個 commit 一樣時也回 undefined。
 *
 * currentCommit 由呼叫端算好傳進來(CLI 用 golden-run 的 gitCommitOf),
 * 這樣這個函式不碰 git,測試才控制得住。
 */
export function detectPromptDrift(baseDir: string, task: LlmTask, currentCommit: string): PromptDrift | undefined {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/**
 * 比對結果 → 分流。輸出一模一樣的項目沿用 A 的分數、列進 unchanged;
 * 有差異的列進 needsScoring,等人看。兩個清單都依字典序,格式要穩定才能 diff。
 */
export function reviewRegression(result: CompareResult): RegressionReview {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}
