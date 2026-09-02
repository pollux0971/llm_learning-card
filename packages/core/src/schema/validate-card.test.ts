import { describe, expect, it } from 'vitest';
import { formatIssuePath, validateCard } from './validate-card.js';

function card(frontmatterLines: string[], body: string): string {
  return `---\n${frontmatterLines.join('\n')}\n---\n${body}\n`;
}

const BASE_FM = [
  'id: sec-0001',
  'category: security',
  'title: 測試卡',
  'level: 0',
  'source: llm',
  'created: 2026-09-01',
];

function withField(lines: string[], key: string, value: string): string[] {
  const replaced = lines.map((l) => (l.startsWith(`${key}:`) ? `${key}: ${value}` : l));
  return replaced.some((l) => l.startsWith(`${key}:`)) ? replaced : [...replaced, `${key}: ${value}`];
}

describe('formatIssuePath', () => {
  it('joins nested paths with dots', () => {
    expect(formatIssuePath(['prereqs', 1])).toBe('prereqs.1');
    expect(formatIssuePath(['title'])).toBe('title');
  });

  it('shows (root) for an empty path', () => {
    expect(formatIssuePath([])).toBe('(root)');
  });
});

describe('validateCard', () => {
  it('passes a valid card and returns the assembled Card with defaults filled in', () => {
    const body = `${'字'.repeat(80)}\n\n\`\`\`example\n範例一\n\`\`\`\n`;
    const result = validateCard(card(BASE_FM, body));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.bodyWordCount).toBe(80);
    expect(result.examplesCount).toBe(1);
    expect(result.card).toEqual({
      frontmatter: {
        id: 'sec-0001',
        category: 'security',
        title: '測試卡',
        level: 0,
        source: 'llm',
        created: '2026-09-01',
        prereqs: [],
        provisional: false,
        stale: false,
        source_missing: false,
      },
      body: '字'.repeat(80),
      examples: ['範例一'],
    });
  });

  it('keeps optional fields that were given', () => {
    const lines = [
      ...withField(BASE_FM, 'level', '2'),
      'parent: sec-0002',
      'prereqs: [sec-0003, sec-0004]',
      'provisional: true',
      'stale: true',
      'source_missing: true',
    ];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(true);
    expect(result.card?.frontmatter).toMatchObject({
      level: 2,
      parent: 'sec-0002',
      prereqs: ['sec-0003', 'sec-0004'],
      provisional: true,
      stale: true,
      source_missing: true,
    });
  });

  it.each(['id', 'category', 'title', 'level', 'source', 'created'])(
    'rejects a card missing %s and mentions the field',
    (field) => {
      const lines = BASE_FM.filter((l) => !l.startsWith(`${field}:`));
      const result = validateCard(card(lines, '字'.repeat(10)));
      expect(result.ok).toBe(false);
      expect(result.card).toBeUndefined();
      expect(result.errors.some((e) => e.startsWith(`${field}: `))).toBe(true);
    },
  );

  it('reports nested paths like prereqs.1 for an invalid array element', () => {
    const lines = [...BASE_FM, 'prereqs: [sec-0002, not-an-id]'];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^prereqs\.1: /);
    expect(result.errors[0]).toContain('CardId');
  });

  it('reports one error per invalid field', () => {
    const lines = withField(withField(BASE_FM, 'id', 'BAD'), 'created', '2026/09/01');
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.errors.filter((e) => e.startsWith('id: '))).toHaveLength(1);
    expect(result.errors.filter((e) => e.startsWith('created: '))).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
  });

  it('rejects a body over the 100 word limit and reports both numbers', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(101)));
    expect(result.ok).toBe(false);
    expect(result.bodyWordCount).toBe(101);
    expect(result.card).toBeUndefined();
    expect(result.errors).toEqual(['body word count 101 exceeds limit of 100']);
  });

  it('reports both frontmatter and body errors when both are wrong', () => {
    const lines = BASE_FM.filter((l) => !l.startsWith('title:'));
    const result = validateCard(card(lines, '字'.repeat(101)));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('title: '))).toBe(true);
    expect(result.errors.some((e) => e.includes('101') && e.includes('100'))).toBe(true);
    expect(result.errors).toHaveLength(2);
  });

  it('passes a body of exactly 100 words', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(100)));
    expect(result.ok).toBe(true);
    expect(result.bodyWordCount).toBe(100);
    expect(result.card?.body).toBe('字'.repeat(100));
  });

  it('counts CJK immediately followed by latin letters as separate words', () => {
    const result = validateCard(card(BASE_FM, `${'字'.repeat(99)}ab`));
    expect(result.ok).toBe(true);
    expect(result.bodyWordCount).toBe(100);
    const over = validateCard(card(BASE_FM, `${'字'.repeat(100)}ab`));
    expect(over.ok).toBe(false);
    expect(over.bodyWordCount).toBe(101);
  });

  it('excludes example fences from the reported body count', () => {
    const body = `${'字'.repeat(60)}\n\n\`\`\`example\n${'例'.repeat(500)}\n![img](x.png)\n\`\`\`\n`;
    const result = validateCard(card(BASE_FM, body));
    expect(result.ok).toBe(true);
    expect(result.bodyWordCount).toBe(60);
    expect(result.examplesCount).toBe(1);
    expect(result.card?.examples).toEqual([`${'例'.repeat(500)}\n![img](x.png)`]);
    expect(result.card?.body).toBe('字'.repeat(60));
  });

  it('parses several example fences in order', () => {
    const body = `${'字'.repeat(10)}\n\n\`\`\`example\nA\n\`\`\`\n\n\`\`\`example\nB\n\`\`\`\n\n\`\`\`example\nC\n\`\`\`\n`;
    const result = validateCard(card(BASE_FM, body));
    expect(result.ok).toBe(true);
    expect(result.examplesCount).toBe(3);
    expect(result.card?.examples).toEqual(['A', 'B', 'C']);
  });

  it('parses zero example fences when none are present', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(10)));
    expect(result.examplesCount).toBe(0);
    expect(result.card?.examples).toEqual([]);
  });

  it('trims the body before counting and storing it', () => {
    const result = validateCard(card(BASE_FM, `\n\n   ${'字'.repeat(10)}   \n\n`));
    expect(result.ok).toBe(true);
    expect(result.card?.body).toBe('字'.repeat(10));
  });

  it.each([1, 2, 3, 4])('rejects a level %i card without a parent', (level) => {
    const lines = withField(BASE_FM, 'level', String(level));
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([`parent: level ${level} requires a parent`]);
  });

  it('passes a level 0 card without a parent', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(10)));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('passes a level >= 1 card with a parent', () => {
    const lines = [...withField(BASE_FM, 'level', '1'), 'parent: sec-0002'];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(true);
    expect(result.card?.frontmatter.parent).toBe('sec-0002');
  });

  it.each([
    ['5', false],
    ['4', true],
    ['-1', false],
    ['1.5', false],
  ])('level %s -> pass=%s (contract §1: Level = 0..4)', (level, expectedOk) => {
    const lines = [...withField(BASE_FM, 'level', level), 'parent: sec-0002'];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(expectedOk);
    if (!expectedOk) expect(result.errors.some((e) => e.startsWith('level: '))).toBe(true);
  });

  it('rejects a raw sourced card without source_ref and names the field', () => {
    const lines = withField(BASE_FM, 'source', 'raw');
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['source_ref: a raw sourced card requires source_ref']);
    expect(result.errors.some((e) => e.includes('source_ref'))).toBe(true);
  });

  it('accepts a raw sourced card with a well formed source_ref', () => {
    const lines = [...withField(BASE_FM, 'source', 'raw'), 'source_ref: raw/security/csp.md#L1-L20'];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(true);
    expect(result.card?.frontmatter.source_ref).toBe('raw/security/csp.md#L1-L20');
  });

  it.each([
    'security/csp.md#L1-L20',
    'raw/csp.md#L1-L20',
    'raw/security/csp.md',
    'raw/security/csp.md#L1',
    'raw/security/csp.md#1-20',
    'raw/security/csp md#L1-L20',
  ])('rejects a malformed source_ref %s and names the field', (ref) => {
    const lines = [...withField(BASE_FM, 'source', 'raw'), `source_ref: "${ref}"`];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('source_ref: '))).toBe(true);
  });

  it('accepts an llm sourced card without source_ref', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(10)));
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown source value', () => {
    const lines = withField(BASE_FM, 'source', 'web');
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('source: '))).toBe(true);
  });

  it.each([
    ['2026-09-01', true],
    ['2026-02-29', false],
    ['2024-02-29', true],
    ['2026-13-01', false],
    ['2026-04-31', false],
    ['2026-00-10', false],
    ['2026-09-00', false],
  ])('created %s -> pass=%s', (created, expectedOk) => {
    const lines = withField(BASE_FM, 'created', `"${created}"`);
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(expectedOk);
    if (!expectedOk) expect(result.errors.some((e) => e.startsWith('created: '))).toBe(true);
  });

  it.each([
    ['sec-0042', true],
    ['lang-0001', true],
    ['sec-42', false],
    ['0042', false],
    ['SEC-0042', false],
  ])('id %s -> pass=%s', (id, expectedOk) => {
    const lines = withField(BASE_FM, 'id', id);
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(expectedOk);
  });

  it('rejects a category containing whitespace or a path separator', () => {
    for (const category of ['"web security"', 'a/b']) {
      const result = validateCard(card(withField(BASE_FM, 'category', category), '字'.repeat(10)));
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.startsWith('category: '))).toBe(true);
    }
  });
});
