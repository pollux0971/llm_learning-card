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
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGoldenSet, GOLDEN_SET_REGISTRY_FILE } from './golden-sets/registry.js';
import type {
  BaselineInfo,
  CompareResult,
  GoldenRunMeta,
  LlmTask,
  PromptDrift,
  RegressionReview,
  ScoreDimension,
} from './types.js';

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
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')) as GoldenRunMeta;
  const existing = findBaseline(baseDir, meta.task);
  // 先檢查再寫:拒絕的那一次不能在第二個 run 目錄留下標記檔。
  if (existing) throw new BaselineAlreadyExistsError(meta.task, existing.dir);
  writeFileSync(join(runDir, BASELINE_MARKER), JSON.stringify(meta, null, 2));
  return toBaselineInfo(meta.task, runDir, meta);
}

/** 找出一個任務的基準 run;沒有就 undefined。 */
export function findBaseline(baseDir: string, task: LlmTask): BaselineInfo | undefined {
  const taskDir = join(baseDir, task);
  if (!existsSync(taskDir)) return undefined;
  // 目錄名是日期,排序後由舊到新——真的有兩個標記檔時取最早的那個,
  // 「基準只立一次」的意思就是最早那次才算數。
  for (const entry of readdirSync(taskDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const dir = join(taskDir, entry.name);
    const marker = join(dir, BASELINE_MARKER);
    if (!existsSync(marker)) continue;
    return toBaselineInfo(task, dir, JSON.parse(readFileSync(marker, 'utf8')) as GoldenRunMeta);
  }
  return undefined;
}

function toBaselineInfo(task: LlmTask, dir: string, meta: GoldenRunMeta): BaselineInfo {
  return { task, dir, date: meta.date, promptFileGitCommit: meta.promptFileGitCommit };
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
  const baseline = findBaseline(baseDir, task);
  if (!baseline) return undefined;
  if (baseline.promptFileGitCommit === currentCommit) return undefined;
  const set = getGoldenSet(task);
  // 有基準卻查不到 golden set,代表 registry 被改掉了。這時候回 undefined 等於謊報
  // 「沒有漂移」,所以寧可大聲壞掉。
  if (!set) {
    throw new Error(`task「${task}」有基準但沒有登記 golden set,說不出是哪個 prompt 檔漂移了;去 ${GOLDEN_SET_REGISTRY_FILE} 補上`);
  }
  return { promptFile: set.promptFile, baselineCommit: baseline.promptFileGitCommit, currentCommit };
}

/**
 * 比對結果 → 分流。輸出一模一樣的項目沿用 A 的分數、列進 unchanged;
 * 有差異的列進 needsScoring,等人看。兩個清單都依字典序,格式要穩定才能 diff。
 */
export function reviewRegression(result: CompareResult): RegressionReview {
  // compareRuns() 已經把 items 依 id 字典序排好,所以照著走就是字典序,
  // carriedForward 的 key 順序也跟著穩定(要 diff 就不能靠 Object 的插入順序碰運氣)。
  const items = [...result.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const needsScoring: string[] = [];
  const unchanged: string[] = [];
  const carriedForward: Record<string, Partial<Record<ScoreDimension, string>>> = {};

  for (const item of items) {
    if (!item.same) {
      needsScoring.push(item.id);
      continue;
    }
    unchanged.push(item.id);
    // A 沒填分數就沒有東西可以沿用——不要憑空生一筆空的出來。
    if (item.scoresA) carriedForward[item.id] = item.scoresA;
  }

  return { task: result.task, needsScoring, unchanged, carriedForward };
}
