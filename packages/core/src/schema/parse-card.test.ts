import { describe, expect, it } from 'vitest';
import { parseCardText } from './parse-card.js';

const FM = '---\nid: sec-0001\ntitle: 測試\nlevel: 0\ncreated: 2026-09-01\n---\n';

describe('parseCardText', () => {
  it('returns the frontmatter fields with unquoted dates turned back into strings', () => {
    const parsed = parseCardText(`${FM}body`);
    expect(parsed.frontmatter).toEqual({ id: 'sec-0001', title: '測試', level: 0, created: '2026-09-01' });
    expect(typeof parsed.frontmatter.created).toBe('string');
  });

  it('keeps a quoted date as the same string', () => {
    const parsed = parseCardText('---\ncreated: "2026-02-28"\n---\nbody');
    expect(parsed.frontmatter.created).toBe('2026-02-28');
  });

  it('returns an empty frontmatter object when the text has no frontmatter', () => {
    const parsed = parseCardText('just a body');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('just a body');
    expect(parsed.examples).toEqual([]);
  });

  it('trims surrounding whitespace from the body', () => {
    const parsed = parseCardText(`${FM}\n\n   內文在這裡   \n\n\n`);
    expect(parsed.body).toBe('內文在這裡');
  });

  it('extracts example fence contents in order, trimmed, and removes them from the body', () => {
    const raw = `${FM}前言\n\n\`\`\`example\n  第一個  \n\`\`\`\n\n中段\n\n\`\`\`example\n第二個\n第二行\n\`\`\`\n\n\`\`\`example\n\n第三個\n\n\`\`\`\n`;
    const parsed = parseCardText(raw);
    expect(parsed.examples).toEqual(['第一個', '第二個\n第二行', '第三個']);
    // 圍欄移除後留下的空行不合併,只做頭尾 trim
    expect(parsed.body.replace(/\n+/g, '\n')).toBe('前言\n中段');
    expect(parsed.body.startsWith('前言')).toBe(true);
    expect(parsed.body.endsWith('中段')).toBe(true);
    expect(parsed.body).not.toContain('example');
    expect(parsed.body).not.toContain('第');
  });

  it('handles CRLF line endings inside example fences', () => {
    const parsed = parseCardText(`${FM}內文\r\n\r\n\`\`\`example\r\nCRLF 範例\r\n\`\`\`\r\n`);
    expect(parsed.examples).toEqual(['CRLF 範例']);
    expect(parsed.body).toBe('內文');
  });

  it('keeps an image reference inside an example', () => {
    const parsed = parseCardText(`${FM}內文\n\n\`\`\`example\n說明\n![圖](x.png)\n\`\`\`\n`);
    expect(parsed.examples).toEqual(['說明\n![圖](x.png)']);
  });

  it('leaves non-example code fences in the body', () => {
    const parsed = parseCardText(`${FM}內文\n\n\`\`\`js\nconsole.log(1)\n\`\`\`\n`);
    expect(parsed.examples).toEqual([]);
    expect(parsed.body).toBe('內文\n\n```js\nconsole.log(1)\n```');
  });

  it('does not treat a fence with a longer info string as an example', () => {
    const parsed = parseCardText(`${FM}內文\n\n\`\`\`examples\nnot one\n\`\`\`\n`);
    expect(parsed.examples).toEqual([]);
  });

  it('leaves non-date values untouched', () => {
    const parsed = parseCardText('---\nlevel: 2\nprereqs: [sec-0001, sec-0002]\nprovisional: true\n---\nx');
    expect(parsed.frontmatter).toEqual({ level: 2, prereqs: ['sec-0001', 'sec-0002'], provisional: true });
  });
});
