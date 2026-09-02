import { describe, it, expect } from 'vitest';
import { renderMarkdown, EXAMPLE_CLASS } from './example-fence.js';

describe('example fence plugin', () => {
  it('renders an example fence as nested markdown, not a code block', () => {
    const html = renderMarkdown('```example\n- one\n- two\n```\n');
    expect(html).toContain(`class="${EXAMPLE_CLASS}"`);
    expect(html).toContain('<li>one</li>');
    expect(html).not.toContain('<pre>');
  });

  it('renders a list, bold text and a nested code block inside an example fence', () => {
    const md = [
      '````example',
      '- 項目一',
      '- **項目二粗體**',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '````',
      '',
    ].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<li>項目一</li>');
    expect(html).toContain('<strong>項目二粗體</strong>');
    expect(html).toContain('<pre><code');
    // the example container itself opens before the nested <pre>, i.e. it is not
    // the whole fence that gets preformatted — only the inner code fence does.
    const exampleIdx = html.indexOf(`class="${EXAMPLE_CLASS}"`);
    const preIdx = html.indexOf('<pre>');
    expect(exampleIdx).toBeGreaterThanOrEqual(0);
    expect(preIdx).toBeGreaterThan(exampleIdx);
  });

  it('leaves a ts fence as a plain code block', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```\n');
    expect(html).toContain('<pre><code');
    expect(html).not.toContain(EXAMPLE_CLASS);
  });

  it('leaves a fence with no language as a plain code block', () => {
    const html = renderMarkdown('```\nplain text\n```\n');
    expect(html).toContain('<pre><code');
    expect(html).not.toContain(EXAMPLE_CLASS);
  });

  it('does not treat "examples" (plural) as the example language', () => {
    const html = renderMarkdown('```examples\nplain text\n```\n');
    expect(html).toContain('<pre><code');
    expect(html).not.toContain(EXAMPLE_CLASS);
  });

  it('produces one block per example fence when there are several', () => {
    const md = ['```example', 'a', '```', '', '```example', 'b', '```', '', '```example', 'c', '```', ''].join(
      '\n',
    );
    const html = renderMarkdown(md);
    const count = html.split(`class="${EXAMPLE_CLASS}"`).length - 1;
    expect(count).toBe(3);
  });

  it('shows nothing extra when there is no example fence', () => {
    const html = renderMarkdown('just a plain paragraph.\n');
    expect(html).not.toContain(EXAMPLE_CLASS);
  });
});
