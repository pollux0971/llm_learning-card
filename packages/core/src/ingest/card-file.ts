/**
 * 卡檔內文。唯一的寫卡片函式(ADR-082)。沒有 I/O。
 * ingest、子卡、deps、topic、deepen 共用,格式必須一字不差。
 */
import { stringify as yamlStringify } from 'yaml';

/** trim 後最長的一串連續反引號。沒有反引號時是 0。波浪號不算。 */
function longestBacktickRun(text: string): number {
  const runs = text.match(/`+/g);
  if (!runs) return 0;
  let n = 0;
  for (const run of runs) {
    if (run.length > n) n = run.length;
  }
  return n;
}

/** 一個 example 的圍欄要用幾個反引號:先 trim,再 max(3, 最長連續反引號 + 1)。只用反引號。 */
export function exampleFenceLength(example: string): number {
  return Math.max(3, longestBacktickRun(example.trim()) + 1);
}

function renderExampleBlock(example: string): string {
  const body = example.trim();
  const fence = '`'.repeat(exampleFenceLength(body));
  return fence + 'example\n' + body + '\n' + fence;
}

/** 參數放寬:frontmatter 只要是物件(ingest 的 prereqs 是選填的),examples 可以是唯讀陣列。 */
export function renderCardFile(card: { frontmatter: object; body: string; examples: readonly string[] }): string {
  const yamlFm = yamlStringify(card.frontmatter).trimEnd();
  const exampleBlocks = card.examples.map(renderExampleBlock).join('\n\n');
  return `---\n${yamlFm}\n---\n\n${card.body.trim()}\n${exampleBlocks ? '\n' + exampleBlocks + '\n' : ''}`;
}
