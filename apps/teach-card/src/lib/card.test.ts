import { describe, it, expect } from 'vitest';
import { parseCard } from './card.js';

describe('parseCard', () => {
  it('splits frontmatter from body', () => {
    const raw = ['---', 'id: sec-0001', 'category: security', 'title: 同源政策', 'level: 0', 'source: raw', 'created: 2026-09-01', '---', '本文內容。', ''].join(
      '\n',
    );
    const { frontmatter, bodyMarkdown } = parseCard(raw);
    expect(frontmatter.id).toBe('sec-0001');
    expect(frontmatter.category).toBe('security');
    expect(frontmatter.level).toBe(0);
    expect(bodyMarkdown).toBe('本文內容。');
  });

  it('keeps example fences embedded in the body for the renderer to handle', () => {
    const raw = ['---', 'id: sec-0002', 'category: security', 'title: t', 'level: 0', 'source: raw', 'created: 2026-09-01', '---', '本文。', '', '```example', '例子', '```', ''].join(
      '\n',
    );
    const { bodyMarkdown } = parseCard(raw);
    expect(bodyMarkdown).toContain('```example');
  });
});
