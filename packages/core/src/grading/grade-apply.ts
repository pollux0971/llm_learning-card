/**
 * 05-grading / phase-2:應用題 rubric 逐條審核,走真的雲端路由(I2)。
 *
 * 跟 phase-1 的 gradeFillBlank 不同:這裡沒有「短路不呼叫模型」的前兩層——
 * 應用題的可轉移性只有模型能判斷,唯一的短路是空白答案(見 phase-2.feature
 * 「An empty answer never reaches the model」)。
 *
 * router 型別繼續用這個模組自己的 `./types.js`(跟 grade-fill.ts 同一份),不改
 * 成直接 import `../llm/types.js`——兩邊的 LlmRouter/LlmTask 形狀完全一樣(都是
 * 契約 §7 的 call/probeOnline/probeLocal),整合時把 `LlmRouterImpl` 注入進來
 * 一樣能過;差別只在這裡的 LlmResult.provider 多了 `'fake'` 這個字面值(Wave 0
 * 的 FakeLlmRouter 用),用 `../llm/types.js` 的話 FakeLlmRouter 回傳型別會跟
 * 03 真正的 LlmResult union 對不上。這裡不直接呼叫 router,呼叫端注入什麼就是
 * 什麼;phase-2.feature 全部用假的/mock router 測,不打真的 API。
 *
 * LlmResult.provisional 決定 grader 是 'cloud' 還是 'local-provisional'——
 * 這個函式不自己判斷線上/離線,那是 router.call() 內部路由表(契約 §7)已經
 * 決定好、寫進 provisional 欄位的事。
 *
 * -------------------------------------------------------------- 公開介面清單
 *
 * - `ApplyGrader = 'cloud' | 'local-provisional' | 'error' | 'empty'`
 *   契約 §5 Grader 聯集裡,應用題這條路徑用得到的子集(填空的五個值見
 *   `./types.ts` 的 `Grader`,兩邊都不改對方,整合時再合併成契約的完整聯集)。
 * - `interface ApplyGradeResult { pass, criteria?, feedback, grader: ApplyGrader }`
 *   結構對齊契約 §5 的 `GradeResult`。
 * - `interface GradeApplyOptions { timeoutMs?, logPath?, logAppender? }`
 *   跟 `CloudLlmRouter`/`LlmRouterImpl` 同一種 log 注入慣例(見
 *   `../llm/router.ts` 的 `LogAppender`):給 logPath 就用 01 的 recordEvent()
 *   原子寫入,不給就不寫;logAppender 優先。
 * - `buildApplyPrompt(question, answer): string`
 *   純函式。prompt 必須含題目、每一條 rubric、使用者回答,並要求模型回傳
 *   JSON `{ criteria: boolean[], feedback: string }`,一條 rubric 一個 verdict。
 * - `parseApplyVerdict(text, rubricCriteriaCount): ApplyVerdict | null`
 *   純函式。JSON.parse 失敗、或形狀不對、或 criteria.length !== rubricCriteriaCount
 *   都回 null(不丟例外)——呼叫端用 null 判斷要不要重試。
 * - `APPLY_FEEDBACK_WORD_LIMIT = 40`
 *   契約 §5:「feedback: string; // <= 40 字」。字數演算法用 01 的
 *   `countWords`(契約 §2 的權威實作),不要自己重新發明。
 * - `truncateFeedback(feedback, limit = APPLY_FEEDBACK_WORD_LIMIT): { text, truncated }`
 *   純函式。超過上限才截斷(truncated=true);沒超過原樣退回(truncated=false)。
 *   `gradeApply()` 呼叫端負責在 truncated 為 true 時記一筆 'warning' log
 *   (phase-2.feature「Feedback is kept to one short line」)。
 * - `gradeApply(question, answer, router, opts?): Promise<ApplyGradeResult>`
 *   主函式:
 *     1. 空白(trim 後為空)→ 直接回 `{ pass: false, feedback: '沒有作答', grader: 'empty' }`,
 *        完全不呼叫 router(phase-2.feature「An empty answer never reaches the model」)。
 *     2. 呼叫 router.call('grade.apply', buildApplyPrompt(...), opts) → 用
 *        parseApplyVerdict 驗證回應。無效(不是 JSON,或 verdict 數量跟
 *        rubric 對不上)就記一筆 'warning' log 並重試一次,重試用同一份 prompt
 *        (phase-2.feature「An unparseable response is retried once」「A verdict
 *        count that does not match the rubric is invalid」)。
 *     3. 兩次都無效 → `{ pass: null, feedback: '...', grader: 'error' }`,不帶
 *        criteria。呼叫端(04-scheduler)看到 grader==='error' 不得推進或回退
 *        stage(契約 §5 GradeResult.pass 的註解)——這條規則不在這個函式的
 *        職責內,這裡只負責回報 error,不負責攔呼叫端怎麼用。
 *     4. 成功 → pass = criteria.every(Boolean);feedback 過 truncateFeedback;
 *        grader 依 llmResult.provisional 選 'cloud' 或 'local-provisional'。
 *
 * 本體先留空/丟 not implemented,邏輯留給下一輪開發 agent。測試見
 * grade-apply.test.ts 與 features/steps/grading.steps.ts(@phase-2 場景)。
 */

import { z } from 'zod';
import type { LogEvent } from '@contracts/index.js';
import { recordEvent } from '@core/schema/log.js';
import { countWords } from '@core/schema/word-count.js';
import type { LlmRouter } from './types.js';

/** 契約 §3 ApplyQuestion 的可執行版本(05 自己的落點內複製,理由同 ./types.ts 開頭的說明)。 */
export interface ApplyQuestion {
  prompt: string;
  rubric: string[];
}

/** 契約 §5 Grader 聯集裡,應用題路徑用得到的子集。 */
export type ApplyGrader = 'cloud' | 'local-provisional' | 'error' | 'empty';

export interface ApplyGradeResult {
  pass: boolean | null;
  criteria?: boolean[];
  feedback: string;
  grader: ApplyGrader;
}

export interface ApplyVerdict {
  criteria: boolean[];
  feedback: string;
}

/** 寫一筆 log 事件。跟 ../llm/router.ts 的 LogAppender 同一種慣例。 */
export type LogAppender = (event: LogEvent) => void;

function createFileLogAppender(path: string | undefined): LogAppender {
  if (!path) return () => {};
  return (event) => recordEvent(path, event);
}

export interface GradeApplyOptions {
  timeoutMs?: number;
  /** log.jsonl 的路徑;不給就不寫(例如純單元測試) */
  logPath?: string;
  /** 直接注入 appender,優先於 logPath */
  logAppender?: LogAppender;
}

/** 契約 §5:feedback <= 40 字,字數演算法見契約 §2、`@core/schema/word-count.ts`。 */
export const APPLY_FEEDBACK_WORD_LIMIT = 40;

const VerdictShapeSchema = z.object({
  criteria: z.array(z.boolean()),
  feedback: z.string(),
});

/**
 * 純函式:題目 + rubric + 使用者回答 → 送給模型的 prompt。
 * 必須包含 question.prompt、每一條 rubric、answer,並要求模型回傳 JSON
 * `{ criteria: boolean[], feedback: string }`,一條 rubric 一個 verdict。
 */
export function buildApplyPrompt(question: ApplyQuestion, answer: string): string {
  const rubricLines = question.rubric.map((line, i) => `${i + 1}. ${line}`).join('\n');
  return [
    `題目:${question.prompt}`,
    '評分規準(rubric):',
    rubricLines,
    `使用者回答:${answer}`,
    '請針對每一條 rubric 判斷使用者回答是否達成,回傳 JSON,格式為 {"criteria": boolean[], "feedback": string};',
    'criteria 陣列的順序與長度必須對應上面 rubric 的順序與條數,一條 rubric 對應一個 boolean;',
    'feedback 用一句話簡短說明理由。只回傳 JSON,不要有其他文字。',
  ].join('\n');
}

/**
 * 純函式:模型回應文字 → 驗證過的 verdict,或 null(不是 JSON、形狀不對、
 * 或 criteria.length !== rubricCriteriaCount)。不丟例外,呼叫端用 null 判斷
 * 要不要重試。
 */
export function parseApplyVerdict(text: string, rubricCriteriaCount: number): ApplyVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const result = VerdictShapeSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.criteria.length !== rubricCriteriaCount) return null;
  return result.data;
}

/**
 * 純函式:feedback 超過契約 §5 的字數上限就截斷。字數用 `countWords`
 * (契約 §2 的權威演算法)計算,不要自己重新發明規則——逐字元累加,一算到
 * 超過上限就停在前一個字元,借此保證跟 countWords() 的判斷永遠一致。
 */
export function truncateFeedback(feedback: string, limit: number = APPLY_FEEDBACK_WORD_LIMIT): { text: string; truncated: boolean } {
  if (countWords(feedback) <= limit) return { text: feedback, truncated: false };

  let result = '';
  for (const ch of feedback) {
    const candidate = result + ch;
    if (countWords(candidate) > limit) break;
    result = candidate;
  }
  return { text: result, truncated: true };
}

/**
 * 應用題 rubric 逐條審核。見檔案頂端的公開介面清單與行為說明。
 */
export async function gradeApply(
  question: ApplyQuestion,
  answer: string,
  router: LlmRouter,
  opts: GradeApplyOptions = {},
): Promise<ApplyGradeResult> {
  if (answer.trim() === '') {
    return { pass: false, feedback: '沒有作答', grader: 'empty' };
  }

  const log = opts.logAppender ?? createFileLogAppender(opts.logPath);
  const prompt = buildApplyPrompt(question, answer);
  const rubricCriteriaCount = question.rubric.length;

  let llmResult;
  let verdict: ApplyVerdict | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    llmResult = await router.call('grade.apply', prompt, opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs });
    verdict = parseApplyVerdict(llmResult.text, rubricCriteriaCount);
    if (verdict) break;
    if (attempt === 0) {
      log({ ts: new Date().toISOString(), type: 'warning', task: 'grade.apply', reason: 'invalid_response_retry' });
    }
  }

  if (!verdict) {
    return { pass: null, feedback: '模型回應無法解析,略過本次審核', grader: 'error' };
  }

  const { text: feedback, truncated } = truncateFeedback(verdict.feedback);
  if (truncated) {
    log({ ts: new Date().toISOString(), type: 'warning', task: 'grade.apply', reason: 'feedback_truncated' });
  }

  return {
    pass: verdict.criteria.every(Boolean),
    criteria: verdict.criteria,
    feedback,
    grader: llmResult!.provisional ? 'local-provisional' : 'cloud',
  };
}
