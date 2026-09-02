import { describe, expect, it } from 'vitest';
import {
  CARD_BODY_WORD_LIMIT,
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
