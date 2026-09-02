import { describe, expect, it } from 'vitest';
import { validateCard } from './validate-card.js';

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

describe('validateCard', () => {
  it('passes a valid card', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(80)));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.card?.frontmatter.id).toBe('sec-0001');
  });

  it.each(['id', 'category', 'title', 'level', 'source', 'created'])(
    'rejects a card missing %s and mentions the field',
    (field) => {
      const lines = BASE_FM.filter((l) => !l.startsWith(`${field}:`));
      const result = validateCard(card(lines, '字'.repeat(10)));
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes(field))).toBe(true);
    },
  );

  it('rejects a body over the 100 word limit and reports both numbers', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(101)));
    expect(result.ok).toBe(false);
    expect(result.bodyWordCount).toBe(101);
    expect(result.errors.some((e) => e.includes('101') && e.includes('100'))).toBe(true);
  });

  it('passes a body of exactly 100 words', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(100)));
    expect(result.ok).toBe(true);
    expect(result.bodyWordCount).toBe(100);
  });

  it('excludes example fences from the reported body count', () => {
    const body = `${'字'.repeat(60)}\n\n\`\`\`example\n${'例'.repeat(500)}\n![img](x.png)\n\`\`\`\n`;
    const result = validateCard(card(BASE_FM, body));
    expect(result.ok).toBe(true);
    expect(result.bodyWordCount).toBe(60);
    expect(result.examplesCount).toBe(1);
  });

  it('parses several example fences', () => {
    const body = `${'字'.repeat(10)}\n\n\`\`\`example\nA\n\`\`\`\n\n\`\`\`example\nB\n\`\`\`\n\n\`\`\`example\nC\n\`\`\`\n`;
    const result = validateCard(card(BASE_FM, body));
    expect(result.ok).toBe(true);
    expect(result.examplesCount).toBe(3);
  });

  it('parses zero example fences when none are present', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(10)));
    expect(result.examplesCount).toBe(0);
  });

  it('rejects a level >= 1 card without a parent', () => {
    const lines = BASE_FM.map((l) => (l.startsWith('level:') ? 'level: 1' : l));
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('level 1 requires a parent'))).toBe(true);
  });

  it('passes a level >= 1 card with a parent', () => {
    const lines = [...BASE_FM.map((l) => (l.startsWith('level:') ? 'level: 1' : l)), 'parent: sec-0002'];
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(true);
  });

  it('rejects a raw sourced card without source_ref', () => {
    const lines = BASE_FM.map((l) => (l.startsWith('source:') ? 'source: raw' : l));
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(false);
  });

  it('accepts an llm sourced card without source_ref', () => {
    const result = validateCard(card(BASE_FM, '字'.repeat(10)));
    expect(result.ok).toBe(true);
  });

  it.each([
    ['sec-0042', true],
    ['lang-0001', true],
    ['sec-42', false],
    ['0042', false],
    ['SEC-0042', false],
  ])('id %s -> pass=%s', (id, expectedOk) => {
    const lines = BASE_FM.map((l) => (l.startsWith('id:') ? `id: ${id}` : l));
    const result = validateCard(card(lines, '字'.repeat(10)));
    expect(result.ok).toBe(expectedOk);
  });
});
