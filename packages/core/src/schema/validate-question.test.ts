import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  countBlanks,
  findCardsMissingQuestions,
  validateApplyQuestion,
  validateFillQuestion,
  validateQuestionFile,
} from './validate-question.js';

describe('countBlanks', () => {
  it('counts each occurrence of three underscores', () => {
    expect(countBlanks('a ___ b ___ c')).toBe(2);
  });

  it('is zero when there are no blanks', () => {
    expect(countBlanks('no blanks here')).toBe(0);
  });

  it('counts a single blank', () => {
    expect(countBlanks('one ___ blank')).toBe(1);
  });
});

describe('validateFillQuestion', () => {
  const valid = { prompt: 'a ___ b ___ c', answers: [['x'], ['y']] };

  it('passes when blank count matches answer group count', () => {
    const result = validateFillQuestion(valid);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails and reports the mismatch when there are more blanks than answer groups', () => {
    const result = validateFillQuestion({ prompt: 'a ___ b ___ c ___', answers: [['x'], ['y']] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('3') && e.includes('2'))).toBe(true);
  });

  it('fails and reports the mismatch when there are fewer blanks than answer groups', () => {
    const result = validateFillQuestion({ prompt: 'a ___ b', answers: [['x'], ['y']] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('1') && e.includes('2'))).toBe(true);
  });

  it('fails when an answer group is empty', () => {
    const result = validateFillQuestion({ prompt: 'a ___ b ___ c', answers: [[], ['y']] });
    expect(result.ok).toBe(false);
  });

  it('fails when an answer group has only empty strings', () => {
    const result = validateFillQuestion({ prompt: 'a ___', answers: [['', '  ']] });
    expect(result.ok).toBe(false);
  });

  it('passes when an answer group has multiple synonyms', () => {
    const result = validateFillQuestion({ prompt: 'a ___', answers: [['x', 'y', 'z']] });
    expect(result.ok).toBe(true);
  });

  it('fails when prompt is missing', () => {
    const result = validateFillQuestion({ answers: [['x']] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('prompt'))).toBe(true);
  });

  it('fails when prompt has no blanks at all', () => {
    const result = validateFillQuestion({ prompt: 'no blanks', answers: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('prompt'))).toBe(true);
  });
});

describe('validateApplyQuestion', () => {
  it.each([1, 5])('fails with %i rubric criteria', (n) => {
    const rubric = Array.from({ length: n }, (_, i) => `criterion ${i}`);
    const result = validateApplyQuestion({ prompt: 'p', rubric });
    expect(result.ok).toBe(false);
  });

  it.each([2, 3, 4])('passes with %i rubric criteria', (n) => {
    const rubric = Array.from({ length: n }, (_, i) => `criterion ${i}`);
    const result = validateApplyQuestion({ prompt: 'p', rubric });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when a rubric entry is empty', () => {
    const result = validateApplyQuestion({ prompt: 'p', rubric: ['a', ''] });
    expect(result.ok).toBe(false);
  });

  it('fails when prompt is missing', () => {
    const result = validateApplyQuestion({ rubric: ['a', 'b'] });
    expect(result.ok).toBe(false);
  });

  it('reports the field path and reason in the error message', () => {
    const result = validateApplyQuestion({ prompt: 'p', rubric: ['only one'] });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.stringContaining('rubric')]);
    expect(result.errors[0]).not.toBe('');
  });
});

describe('validateQuestionFile', () => {
  const validFill = { prompt: 'a ___', answers: [['x']] };
  const validApply = { prompt: 'p', rubric: ['a', 'b'] };

  it('passes a file with two fill questions and one apply question', () => {
    const result = validateQuestionFile({
      card: 'sec-0001',
      fill: [validFill, validFill],
      apply: [validApply],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails and mentions both shortfalls when there is one fill and no apply question', () => {
    const result = validateQuestionFile({ card: 'sec-0001', fill: [validFill], apply: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('fill'))).toBe(true);
    expect(result.errors.some((e) => e.includes('apply'))).toBe(true);
  });

  it('fails when card id is malformed', () => {
    const result = validateQuestionFile({ card: 'not-an-id', fill: [validFill, validFill], apply: [validApply] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('card'))).toBe(true);
  });

  it('fails with too many fill questions', () => {
    const result = validateQuestionFile({
      card: 'sec-0001',
      fill: [validFill, validFill, validFill, validFill],
      apply: [validApply],
    });
    expect(result.ok).toBe(false);
  });

  it('fails with too many apply questions', () => {
    const result = validateQuestionFile({
      card: 'sec-0001',
      fill: [validFill, validFill],
      apply: [validApply, validApply, validApply],
    });
    expect(result.ok).toBe(false);
  });

  it('surfaces a per-question blank/answer mismatch even when counts are otherwise valid', () => {
    const badFill = { prompt: 'a ___ ___', answers: [['x']] };
    const result = validateQuestionFile({ card: 'sec-0001', fill: [validFill, badFill], apply: [validApply] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('fill.1.'))).toBe(true);
  });

  it('rejects a non-object input', () => {
    const result = validateQuestionFile(null);
    expect(result.ok).toBe(false);
  });

  it('does not crash on a function input (truthy but not typeof object)', () => {
    const result = validateQuestionFile(function notAQuestionFile() {});
    expect(result.ok).toBe(false);
  });

  it('does not crash when fill and apply keys are entirely missing', () => {
    const result = validateQuestionFile({ card: 'sec-0001' });
    expect(result.ok).toBe(false);
  });

  it('surfaces a per-question rubric error even when counts are otherwise valid', () => {
    const badApply = { prompt: 'p', rubric: ['only one'] };
    const result = validateQuestionFile({
      card: 'sec-0001',
      fill: [validFill, validFill],
      apply: [badApply, validApply],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('apply.0.'))).toBe(true);
  });
});

describe('findCardsMissingQuestions', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reports a card with no matching question file', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), '---\n---\nbody');

    expect(findCardsMissingQuestions(dir)).toEqual(['sec-0001']);
  });

  it('does not report a card that has a matching question file', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), '---\n---\nbody');
    writeFileSync(join(dir, 'questions/sec-0001.yaml'), 'card: sec-0001\n');

    expect(findCardsMissingQuestions(dir)).toEqual([]);
  });

  it('ignores .short.md files', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), '---\n---\nbody');
    writeFileSync(join(dir, 'cards/security/sec-0001.short.md'), '---\n---\nshort');
    writeFileSync(join(dir, 'questions/sec-0001.yaml'), 'card: sec-0001\n');

    expect(findCardsMissingQuestions(dir)).toEqual([]);
  });

  it('returns an empty array when there is no cards directory', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    expect(findCardsMissingQuestions(dir)).toEqual([]);
  });

  it('ignores a filename with extra characters before the id', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    // 前面加一個數字,不能被 [a-z]{2,6} 吃掉,才是真的測到 ^ 錨點(單純多幾個
    // 小寫字母會被字母群組吸收,不會逼出錨點的差異)。
    writeFileSync(join(dir, 'cards/security/9sec-0001.md'), '---\n---\nbody');

    expect(findCardsMissingQuestions(dir)).toEqual([]);
  });

  it('ignores a filename with extra characters after .md', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.md.bak'), '---\n---\nbody');

    expect(findCardsMissingQuestions(dir)).toEqual([]);
  });

  it('skips a stray file sitting directly under cards/', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    // 一個檔案(不是目錄)直接放在 cards/ 下面——沒有 isDirectory() 這層檢查,
    // readdirSync 會直接對著這個檔案再往下讀,拋 ENOTDIR。
    writeFileSync(join(dir, 'cards/.gitkeep'), '');
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), '---\n---\nbody');
    writeFileSync(join(dir, 'questions/sec-0001.yaml'), 'card: sec-0001\n');

    expect(findCardsMissingQuestions(dir)).toEqual([]);
  });

  it('scans multiple categories', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    mkdirSync(join(dir, 'cards/web'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), '---\n---\nbody');
    writeFileSync(join(dir, 'cards/web/web-0001.md'), '---\n---\nbody');
    writeFileSync(join(dir, 'questions/sec-0001.yaml'), 'card: sec-0001\n');

    expect(findCardsMissingQuestions(dir)).toEqual(['web-0001']);
  });
});
