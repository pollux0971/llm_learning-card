import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  AnswerGroupSchema,
  ApplyQuestionSchema,
  CategorySchema,
  GraderSchema,
  LogEventSchema,
  QuestionFileSchema,
  QuestionTypeSchema,
  ReviewSchema,
  SettingsSchema,
  CARD_BODY_WORD_LIMIT,
  countBlanks,
  FillQuestionSchema,
  CardFrontmatterSchema,
  CardIdSchema,
  CategoryIdSchema,
  IsoDateSchema,
  IsoWeekSchema,
  LevelSchema,
  SOURCE_REF_RE,
  SourceRefSchema,
  StageSchema,
} from './index.js';

describe('§1 basic types', () => {
  it('CardId accepts 2–6 lowercase letters, a dash and 4 digits', () => {
    expect(CardIdSchema.safeParse('sec-0042').success).toBe(true);
    expect(CardIdSchema.safeParse('lang-0001').success).toBe(true);
    expect(CardIdSchema.safeParse('a-0001').success).toBe(false);
    expect(CardIdSchema.safeParse('abcdefg-0001').success).toBe(false);
    expect(CardIdSchema.safeParse('sec-042').success).toBe(false);
    expect(CardIdSchema.safeParse('SEC-0042').success).toBe(false);
  });

  it('CategoryId rejects empty strings, whitespace and path separators', () => {
    expect(CategoryIdSchema.safeParse('security').success).toBe(true);
    expect(CategoryIdSchema.safeParse('資安').success).toBe(true);
    expect(CategoryIdSchema.safeParse('').success).toBe(false);
    expect(CategoryIdSchema.safeParse('web security').success).toBe(false);
    expect(CategoryIdSchema.safeParse('a/b').success).toBe(false);
    expect(CategoryIdSchema.safeParse('a\\b').success).toBe(false);
  });

  describe('IsoDate', () => {
    it.each(['2026-09-01', '2024-02-29', '2026-12-31', '2026-01-01', '2000-02-29'])('accepts %s', (d) => {
      expect(IsoDateSchema.safeParse(d).success).toBe(true);
    });

    it.each([
      ['2026/09/01', 'wrong separator'],
      ['2026-9-1', 'unpadded'],
      ['20260901', 'no separators'],
      ['2026-09-01T00:00:00Z', 'has a time part'],
      ['2026-13-01', 'month 13'],
      ['2026-00-01', 'month 00'],
      ['2026-02-29', 'Feb 29 in a non leap year'],
      ['1900-02-29', 'Feb 29 in a century non leap year'],
      ['2026-04-31', 'April 31'],
      ['2026-06-31', 'June 31'],
      ['2026-09-00', 'day 00'],
      ['2026-01-32', 'day 32'],
    ])('rejects %s (%s)', (d) => {
      expect(IsoDateSchema.safeParse(d).success).toBe(false);
    });
  });

  it('IsoWeek accepts YYYY-Wnn only', () => {
    expect(IsoWeekSchema.safeParse('2026-W37').success).toBe(true);
    expect(IsoWeekSchema.safeParse('2026-W7').success).toBe(false);
    expect(IsoWeekSchema.safeParse('2026-37').success).toBe(false);
  });

  it('Stage accepts 0..6 only', () => {
    for (let s = 0; s <= 6; s += 1) expect(StageSchema.safeParse(s).success).toBe(true);
    expect(StageSchema.safeParse(7).success).toBe(false);
    expect(StageSchema.safeParse(-1).success).toBe(false);
  });

  describe('Level = 0..4', () => {
    it.each([0, 1, 2, 3, 4])('accepts %i', (level) => {
      expect(LevelSchema.safeParse(level).success).toBe(true);
    });

    it('rejects level 5', () => {
      const result = LevelSchema.safeParse(5);
      expect(result.success).toBe(false);
    });

    it.each([-1, 6, 100, 1.5, NaN])('rejects %s', (level) => {
      expect(LevelSchema.safeParse(level).success).toBe(false);
    });

    it('rejects a numeric string', () => {
      expect(LevelSchema.safeParse('2').success).toBe(false);
    });
  });
});

describe('§2 card', () => {
  it('body word limit is 100', () => {
    expect(CARD_BODY_WORD_LIMIT).toBe(100);
  });

  describe('source_ref format raw/<cat>/<file>#L<a>-L<b>', () => {
    it.each([
      'raw/security/csp.md#L1-L20',
      'raw/資安/web-security-basics.md#L120-L145',
      'raw/security/nested/dir/file.md#L3-L16',
    ])('accepts %s', (ref) => {
      expect(SOURCE_REF_RE.test(ref)).toBe(true);
      expect(SourceRefSchema.safeParse(ref).success).toBe(true);
    });

    it.each([
      '',
      'security/csp.md#L1-L20',
      'raw/csp.md#L1-L20',
      'raw//csp.md#L1-L20',
      'raw/security/csp.md',
      'raw/security/csp.md#L1',
      'raw/security/csp.md#L1-20',
      'raw/security/csp.md#1-L20',
      'raw/security/csp.md#L1-L20#L3-L4',
      'raw/sec urity/csp.md#L1-L20',
      'raw/security/cs p.md#L1-L20',
      'raw/security/csp.md#L1-L20 ',
    ])('rejects %j', (ref) => {
      expect(SourceRefSchema.safeParse(ref).success).toBe(false);
    });
  });

  const base = {
    id: 'sec-0001',
    category: 'security',
    title: '測試卡',
    level: 0,
    source: 'llm',
    created: '2026-09-01',
  };

  it('fills in defaults for the optional boolean and array fields', () => {
    const parsed = CardFrontmatterSchema.parse(base);
    expect(parsed).toEqual({ ...base, prereqs: [], provisional: false, stale: false, source_missing: false });
  });

  it('rejects level 5 in a frontmatter and points at the level field', () => {
    const result = CardFrontmatterSchema.safeParse({ ...base, level: 5, parent: 'sec-0002' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['level']);
  });

  it('rejects a malformed source_ref and points at the source_ref field', () => {
    const result = CardFrontmatterSchema.safeParse({ ...base, source: 'raw', source_ref: 'csp.md' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['source_ref']);
  });
});

describe('§3 question', () => {
  describe('AnswerGroup: at least one non-empty string', () => {
    it('accepts a group that mixes an empty string with a non-empty one', () => {
      expect(AnswerGroupSchema.safeParse(['', '答案']).success).toBe(true);
      expect(AnswerGroupSchema.safeParse(['答案', '']).success).toBe(true);
    });

    it('accepts a single non-empty string', () => {
      expect(AnswerGroupSchema.safeParse(['答案']).success).toBe(true);
    });

    it('rejects a group where every entry is empty or whitespace', () => {
      expect(AnswerGroupSchema.safeParse(['', '']).success).toBe(false);
      expect(AnswerGroupSchema.safeParse(['']).success).toBe(false);
      expect(AnswerGroupSchema.safeParse([' ', '\t']).success).toBe(false);
    });

    it('rejects an empty array', () => {
      expect(AnswerGroupSchema.safeParse([]).success).toBe(false);
    });

    it('rejects non-string entries', () => {
      expect(AnswerGroupSchema.safeParse([1]).success).toBe(false);
    });
  });

  describe('countBlanks counts ___ markers', () => {
    it('returns 0 when there is no marker', () => {
      expect(countBlanks('no blank here')).toBe(0);
      expect(countBlanks('')).toBe(0);
    });

    it('counts each ___ marker once', () => {
      expect(countBlanks('a ___ b')).toBe(1);
      expect(countBlanks('___ and ___ and ___')).toBe(3);
    });
  });

  describe('FillQuestion: blanks must match answer groups', () => {
    it('accepts one blank with one answer group', () => {
      const result = FillQuestionSchema.safeParse({ prompt: 'x ___ y', answers: [['a']] });
      expect(result.success).toBe(true);
    });

    it('accepts two blanks with two answer groups', () => {
      const result = FillQuestionSchema.safeParse({ prompt: '___ ___', answers: [['a'], ['b', '']] });
      expect(result.success).toBe(true);
    });

    it('rejects a prompt without any blank and points at prompt', () => {
      const result = FillQuestionSchema.safeParse({ prompt: 'no blank', answers: [['a']] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['prompt']);
    });

    it('rejects a blank/answer count mismatch and points at answers', () => {
      const result = FillQuestionSchema.safeParse({ prompt: '___ ___', answers: [['a']] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['answers']);
        expect(result.error.issues[0]?.message).toBe('prompt has 2 blank(s) but answers has 1 group(s)');
      }
    });

    it('rejects an empty prompt', () => {
      expect(FillQuestionSchema.safeParse({ prompt: '', answers: [] }).success).toBe(false);
    });
  });
});

/** 取出驗證失敗時所有 issue 的訊息;成功時回空陣列。 */
function messagesOf(schema: ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('regex anchors: no leading or trailing junk', () => {
  it('CardId rejects extra characters before or after', () => {
    expect(CardIdSchema.safeParse('1sec-0042').success).toBe(false);
    expect(CardIdSchema.safeParse('sec-00420').success).toBe(false);
  });

  it('IsoDate rejects extra digits before or after an otherwise valid date', () => {
    expect(IsoDateSchema.safeParse('12026-09-01').success).toBe(false);
    expect(IsoDateSchema.safeParse('2026-09-011').success).toBe(false);
  });

  it('IsoWeek rejects extra digits before or after an otherwise valid week', () => {
    expect(IsoWeekSchema.safeParse('12026-W37').success).toBe(false);
    expect(IsoWeekSchema.safeParse('2026-W371').success).toBe(false);
  });

  it('source_ref must start with raw/', () => {
    expect(SOURCE_REF_RE.test('xraw/security/csp.md#L1-L20')).toBe(false);
    expect(SourceRefSchema.safeParse('xraw/security/csp.md#L1-L20').success).toBe(false);
  });
});

describe('error messages are the ones the contract documents', () => {
  it('§1 basic types', () => {
    expect(messagesOf(CategoryIdSchema, '')).toContain('CategoryId 不可為空');
    expect(messagesOf(CategoryIdSchema, 'a/b')).toContain('CategoryId 不可包含空白或路徑分隔符');
    expect(messagesOf(IsoDateSchema, '2026/09/01')).toEqual(['IsoDate 必須是 "YYYY-MM-DD"']);
    expect(messagesOf(IsoDateSchema, '2026-13-01')).toEqual([
      'IsoDate 必須是真實存在的日期(月 01–12,日不可超過該月天數)',
    ]);
    expect(messagesOf(IsoWeekSchema, '2026-W7')).toEqual(['IsoWeek 必須是 "YYYY-Wnn"']);
    expect(messagesOf(LevelSchema, -1)).toEqual(['level 最小為 0']);
    expect(messagesOf(LevelSchema, 5)).toEqual(['level 最大為 4']);
  });

  it('§2 card', () => {
    expect(messagesOf(SourceRefSchema, 'csp.md')).toEqual([
      'source_ref 必須符合 raw/<cat>/<file>#L<a>-L<b>(例如 "raw/security/csp.md#L1-L20")',
    ]);
    const frontmatter = { id: 'sec-0001', category: 'security', title: '', level: 0, source: 'llm', created: '2026-09-01' };
    expect(messagesOf(CardFrontmatterSchema, frontmatter)).toEqual(['title 不可為空']);
  });

  it('§3 question types and answer groups', () => {
    expect(QuestionTypeSchema.options).toEqual(['fill', 'apply']);
    expect(messagesOf(AnswerGroupSchema, [])).toContain('答案組不能空');
    expect(messagesOf(AnswerGroupSchema, ['', ' '])).toEqual(['答案組至少需要一個非空字串']);
    expect(messagesOf(FillQuestionSchema, { prompt: '', answers: [] })).toContain('prompt 不可為空');
    expect(messagesOf(FillQuestionSchema, { prompt: 'no blank', answers: [] })).toEqual([
      'prompt 至少要有一個 ___ 標記的空格',
    ]);
  });

  it('§3 apply questions', () => {
    const rubric = ['mentions the origin', 'mentions the policy'];
    expect(ApplyQuestionSchema.safeParse({ prompt: 'Explain CSP', rubric }).success).toBe(true);
    expect(messagesOf(ApplyQuestionSchema, { prompt: '', rubric })).toEqual(['prompt 不可為空']);
    expect(messagesOf(ApplyQuestionSchema, { prompt: 'p', rubric: ['', 'x'] })).toEqual(['rubric 條目不可為空']);
    expect(messagesOf(ApplyQuestionSchema, { prompt: 'p', rubric: ['only one'] })).toEqual(['rubric 至少需要 2 條']);
    expect(messagesOf(ApplyQuestionSchema, { prompt: 'p', rubric: ['a', 'b', 'c', 'd', 'e'] })).toEqual([
      'rubric 最多 4 條',
    ]);
  });

  it('§3 question file counts', () => {
    const fill = { prompt: 'x ___ y', answers: [['a']] };
    const apply = { prompt: 'Explain CSP', rubric: ['a', 'b'] };
    const file = (fills: number, applies: number) => ({
      card: 'sec-0001',
      fill: Array.from({ length: fills }, () => fill),
      apply: Array.from({ length: applies }, () => apply),
    });
    expect(QuestionFileSchema.safeParse(file(2, 1)).success).toBe(true);
    expect(QuestionFileSchema.safeParse(file(3, 2)).success).toBe(true);
    expect(messagesOf(QuestionFileSchema, file(1, 1))).toEqual(['至少需要 2 題填空']);
    expect(messagesOf(QuestionFileSchema, file(4, 1))).toEqual(['最多 3 題填空']);
    expect(messagesOf(QuestionFileSchema, file(2, 0))).toEqual(['至少需要 1 題應用']);
    expect(messagesOf(QuestionFileSchema, file(2, 3))).toEqual(['最多 2 題應用']);
  });

  it('§4 grader enum lists exactly the contract graders, in order', () => {
    expect(GraderSchema.options).toEqual([
      'exact',
      'fuzzy',
      'local-llm',
      'fallback-strict',
      'empty',
      'cloud',
      'local-provisional',
      'error',
    ]);
    for (const grader of GraderSchema.options) expect(GraderSchema.safeParse(grader).success).toBe(true);
  });

  it('§4 archived review must have a null next_due', () => {
    const review = {
      stage: 6,
      learned_at: '2026-09-01',
      next_due: '2026-09-02',
      fails_in_row: 0,
      total_fails: 0,
      stuck: false,
      history: [],
    };
    expect(messagesOf(ReviewSchema, review)).toEqual(['stage 6(歸檔)的 next_due 必須是 null']);
    expect(ReviewSchema.safeParse({ ...review, next_due: null }).success).toBe(true);
  });

  it('§10 log event', () => {
    expect(messagesOf(LogEventSchema, { ts: '', type: 'learned' })).toEqual(['ts 不可為空']);
  });

  it('§11 category and settings', () => {
    expect(messagesOf(CategorySchema, { id: 'security', name: '', require_raw: true })).toEqual(['name 不可為空']);

    const settings = {
      daily_cap: 10,
      weekly_target: 7,
      short_body_limit: 50,
      llm: { cloud_provider: 'anthropic', cloud_model: 'claude', local_model: 'llama' },
    };
    expect(SettingsSchema.safeParse(settings).success).toBe(true);
    expect(messagesOf(SettingsSchema, { ...settings, daily_cap: 1.5 })).toEqual(['daily_cap 必須是整數']);
    expect(messagesOf(SettingsSchema, { ...settings, daily_cap: 0 })).toEqual(['daily_cap 必須大於 0']);
    expect(messagesOf(SettingsSchema, { ...settings, weekly_target: 1.5 })).toEqual(['weekly_target 必須是整數']);
    expect(messagesOf(SettingsSchema, { ...settings, weekly_target: 0 })).toEqual(['weekly_target 必須大於 0']);
    expect(messagesOf(SettingsSchema, { ...settings, short_body_limit: 1.5 })).toEqual([
      'short_body_limit 必須是整數',
    ]);
    expect(messagesOf(SettingsSchema, { ...settings, short_body_limit: 0 })).toEqual(['short_body_limit 必須大於 0']);
    expect(messagesOf(SettingsSchema, { ...settings, llm: { ...settings.llm, cloud_model: '' } })).toEqual([
      'cloud_model 不可為空',
    ]);
    expect(messagesOf(SettingsSchema, { ...settings, llm: { ...settings.llm, local_model: '' } })).toEqual([
      'local_model 不可為空',
    ]);
  });
});
