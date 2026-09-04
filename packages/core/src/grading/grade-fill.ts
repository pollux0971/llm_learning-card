import { normalize } from './normalize.js';
import { matchFuzzy } from './fuzzy.js';
import { witness } from '@contracts/witness.js';
import type { FillQuestion, Grader, GradeResult, LlmRouter } from './types.js';

function buildSynonymPrompt(accepted: string[], typed: string): string {
  return ['標準答案:' + accepted.join('、'), '使用者回答:' + typed, '這兩者是否語意相同?只回答 yes 或 no。'].join('\n');
}

/**
 * 三層審核一個空格:正規化 + 精確 → 編輯距離 → 本機模型同義判斷。
 * 任何一層命中就短路,不進下一層——這是成本控制,變異測試要能殺死跳過短路的變異。
 */
export async function gradeFillBlank(accepted: string[], rawInput: string, router: LlmRouter): Promise<GradeResult> {
  const normalizedInput = normalize(rawInput);
  if (normalizedInput === '') {
    return { pass: false, feedback: '沒有作答', grader: 'empty' };
  }

  const normalizedAccepted = accepted.map(normalize);
  if (normalizedAccepted.includes(normalizedInput)) {
    return { pass: true, feedback: '正確', grader: 'exact' };
  }

  const fuzzy = matchFuzzy(normalizedAccepted, normalizedInput);
  if (fuzzy.matched) {
    return { pass: true, feedback: '正確(容許一字之差)', grader: 'fuzzy' };
  }

  try {
    const result = await router.call('grade.fill.llm', buildSynonymPrompt(accepted, rawInput));
    const pass = result.text.trim().toLowerCase() === 'yes';
    return { pass, feedback: pass ? '模型判定語意相同' : '模型判定語意不同', grader: 'local-llm' };
  } catch {
    witness('grading.fill.llm-failed-strict');
    return { pass: false, feedback: '沒有可用模型,無法判斷語意是否相同', grader: 'fallback-strict' };
  }
}

const GRADER_DEPTH: Grader[] = ['empty', 'exact', 'fuzzy', 'local-llm', 'fallback-strict'];

/** 多個空格全部通過時,回報用得最深的那一層,讓呼叫端知道有沒有動用到模型 */
function deepestGrader(results: GradeResult[]): Grader {
  let best = results[0]!.grader;
  for (const r of results) {
    // Stryker disable next-line EqualityOperator: a tie means r.grader === best already, so >= would reassign an identical value
    if (GRADER_DEPTH.indexOf(r.grader) > GRADER_DEPTH.indexOf(best)) best = r.grader;
  }
  return best;
}

/** 每個空格分開審,一個錯就整題錯;feedback 指出第一個錯的空格與正確答案 */
export async function gradeFillQuestion(question: FillQuestion, rawAnswers: string[], router: LlmRouter): Promise<GradeResult> {
  const results: GradeResult[] = [];
  for (let i = 0; i < question.answers.length; i++) {
    results.push(await gradeFillBlank(question.answers[i]!, rawAnswers[i] ?? '', router));
  }

  const failIndex = results.findIndex((r) => r.pass !== true);
  if (failIndex === -1) {
    return { pass: true, feedback: '全部正確', grader: deepestGrader(results) };
  }

  const correct = question.answers[failIndex]!.slice(0, 2).join('/');
  return {
    pass: false,
    feedback: `第${failIndex + 1}格答案應為:${correct}`,
    grader: results[failIndex]!.grader,
  };
}
