import { describe, it, expect } from 'vitest';
import { checkStructural, runStructuralChecks, QUALITY_NOTE } from './structural-checks.js';

describe('checkStructural', () => {
  it('a card body exceeds the word limit', () => {
    const output = JSON.stringify([{ title: '測試卡', body: '同'.repeat(101), examples: [] }]);
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('body-too-long');
  });

  it('the response is not valid JSON', () => {
    const issues = checkStructural('這不是 JSON {');
    expect(issues).toEqual([{ kind: 'invalid-json', detail: expect.any(String) }]);
  });

  it('a rubric has fewer than two criteria', () => {
    const output = JSON.stringify({ prompt: '說明同源政策', rubric: ['只有一條'] });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('rubric-too-few');
  });

  it('a rubric has more than four criteria', () => {
    const output = JSON.stringify({ prompt: '說明同源政策', rubric: ['a', 'b', 'c', 'd', 'e'] });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('rubric-too-many');
  });

  it('grade.apply 的 criteria 陣列套用同一條 2..4 規則', () => {
    const output = JSON.stringify({ criteria: [true], feedback: '太短' });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('rubric-too-few');
  });

  it('the blank count does not match the answers', () => {
    const output = JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定']] });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('blank-answer-mismatch');
  });

  it('a required field is missing', () => {
    const output = JSON.stringify([{ body: '沒有標題的卡片內容' }]);
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('missing-field');
  });

  it('structurally perfect but says something wrong → 沒有問題', () => {
    const output = JSON.stringify([{ title: '同源政策', body: '瀏覽器規定同源才能互相存取,這句話是錯的但格式完全正確。', examples: [] }]);
    expect(checkStructural(output)).toEqual([]);
  });
});

describe('runStructuralChecks', () => {
  it('永遠附上「品質要人評分」的提醒,即使沒有問題', () => {
    const output = JSON.stringify([{ title: '同源政策', body: '格式正確的內容。', examples: [] }]);
    const result = runStructuralChecks(output);
    expect(result.issues).toEqual([]);
    expect(result.note).toBe(QUALITY_NOTE);
    expect(result.note.length).toBeGreaterThan(0);
  });
});
