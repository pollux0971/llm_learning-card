/**
 * 結構性檢查:只驗格式,不判斷品質(FEATURE.md「不在範圍」)。
 * 對象是 LLM 任務輸出的原始文字,一律預期是 JSON。認得的形狀:
 *   - 教學卡陣列項目:有 `body` 欄位 → 檢查 title/body 存在、body 字數 <= 100
 *   - apply 題目:有 `rubric` 陣列 → 檢查長度 2..4、prompt 存在
 *   - apply 評分結果:有 `criteria` 陣列 → 檢查長度 2..4(criteria.length === rubric.length,見契約 §5)
 *   - fill 題目:有 `prompt` 字串與 `answers` 陣列 → 檢查 `___` 數量與 answers 數量一致
 * 遞迴掃描整個 JSON 樹,任何符合形狀的節點都會被檢查。
 */
import { countBodyWords } from './word-count.js';
import type { StructuralIssue, StructuralCheckResult } from './types.js';

const BODY_WORD_LIMIT = 100;
const BLANK_MARKER = /___/g;

function checkCardShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (typeof obj.body !== 'string') return;
  if (!obj.title || typeof obj.title !== 'string') {
    issues.push({ kind: 'missing-field', detail: 'card 缺少 title' });
  }
  const count = countBodyWords(obj.body);
  if (count > BODY_WORD_LIMIT) {
    issues.push({ kind: 'body-too-long', detail: `body 字數 ${count} 超過上限 ${BODY_WORD_LIMIT}` });
  }
}

function checkRubricShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (!Array.isArray(obj.rubric)) return;
  if (!obj.prompt || typeof obj.prompt !== 'string') {
    issues.push({ kind: 'missing-field', detail: 'apply 題目缺少 prompt' });
  }
  if (obj.rubric.length < 2) {
    issues.push({ kind: 'rubric-too-few', detail: `rubric 只有 ${obj.rubric.length} 條,至少要 2 條` });
  } else if (obj.rubric.length > 4) {
    issues.push({ kind: 'rubric-too-many', detail: `rubric 有 ${obj.rubric.length} 條,最多 4 條` });
  }
}

function checkCriteriaShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (!Array.isArray(obj.criteria)) return;
  if (obj.criteria.length < 2) {
    issues.push({ kind: 'rubric-too-few', detail: `criteria 只有 ${obj.criteria.length} 項,rubric 至少要 2 條` });
  } else if (obj.criteria.length > 4) {
    issues.push({ kind: 'rubric-too-many', detail: `criteria 有 ${obj.criteria.length} 項,rubric 最多 4 條` });
  }
}

function checkFillShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (typeof obj.prompt !== 'string' || !Array.isArray(obj.answers)) return;
  const blanks = (obj.prompt.match(BLANK_MARKER) ?? []).length;
  if (blanks !== obj.answers.length) {
    issues.push({
      kind: 'blank-answer-mismatch',
      detail: `prompt 有 ${blanks} 個 ___,但 answers 有 ${obj.answers.length} 組`,
    });
  }
  if (obj.answers.some((a) => !Array.isArray(a) || a.length === 0)) {
    issues.push({ kind: 'missing-field', detail: '有一組 answers 是空的' });
  }
}

function walk(node: unknown, issues: StructuralIssue[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, issues);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    checkCardShape(obj, issues);
    checkRubricShape(obj, issues);
    checkCriteriaShape(obj, issues);
    checkFillShape(obj, issues);
    for (const value of Object.values(obj)) walk(value, issues);
  }
}

export function checkStructural(outputText: string): StructuralIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (e) {
    return [{ kind: 'invalid-json', detail: (e as Error).message }];
  }
  const issues: StructuralIssue[] = [];
  walk(parsed, issues);
  return issues;
}

export const QUALITY_NOTE =
  '結構性檢查只抓機械性的失敗(字數、JSON 合法性、rubric 條數、空格與答案數一致);內容對不對、是不是一個概念,需要人來評分。';

export function runStructuralChecks(outputText: string): StructuralCheckResult {
  return { issues: checkStructural(outputText), note: QUALITY_NOTE };
}
