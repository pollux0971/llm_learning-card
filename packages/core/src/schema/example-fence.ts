/**
 * 契約 §2「Example 圍欄」(1.5.0、ADR-081):哪些是 example 圍欄,以教學卡畫面的區塊解析為準。
 * markdown-it 15.0.1、CARD_MARKDOWN_OPTIONS,解析 String.prototype.trim() 過的文字。
 * 移除用 token.map 的行範圍:開始行留下第一個反引號或波浪號之前的部分(加上那一行原本的換行),
 * 其餘行整行拿掉;切行用 /(\r\n|\r|\n)/,換行符原樣接回去,所以圍欄以外逐位元組不變。
 * 結果再 trim 就是 body。examples 用 token.content.trim(),空的也算一個,依出現順序。
 *
 * 介面不變:stripExampleFences(text) → { body, examples }。
 * 對 markdown-it 實例只准 .parse;token 只准讀 type、info、map、content。
 */
import MarkdownIt from 'markdown-it';
import { CARD_MARKDOWN_OPTIONS, isExampleFence } from '@contracts/card-markdown.js';

const md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);

interface Line {
  content: string;
  newline: string;
}

/** 跟 markdown-it 正規化同一組換行(CRLF、單獨 CR、LF),分隔符留在原位。 */
function splitLines(src: string): Line[] {
  const parts = src.split(/(\r\n|\r|\n)/);
  const lines: Line[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push({ content: parts[i] ?? '', newline: parts[i + 1] ?? '' });
  }
  return lines;
}

/** 開始行留下第一個反引號或波浪號之前的部分(容器記號,例如清單的 "1. "、引用的 "> ")。 */
function prefixBeforeMarker(line: string): string {
  let cut = line.length;
  const tick = line.indexOf('`');
  const tilde = line.indexOf('~');
  if (tick >= 0) cut = tick;
  if (tilde >= 0 && tilde < cut) cut = tilde;
  return line.slice(0, cut);
}

/**
 * 拿掉所有 example 圍欄。
 * body 是移除後再 trim;examples 是每個圍欄內容 trim 過、依出現順序。
 */
export function stripExampleFences(text: string): { body: string; examples: string[] } {
  const trimmed = text.trim();
  const tokens = md.parse(trimmed, {});
  const lines = splitLines(trimmed);
  const examples: string[] = [];

  for (const token of tokens) {
    if (token.type !== 'fence' || !isExampleFence(token.info)) continue;
    examples.push(token.content.trim());
    const span = token.map;
    if (!span) continue;
    const start = span[0];
    const end = span[1];
    const opening = lines[start];
    if (opening) opening.content = prefixBeforeMarker(opening.content);
    for (let i = start + 1; i < end; i += 1) {
      const victim = lines[i];
      if (!victim) continue;
      victim.content = '';
      victim.newline = '';
    }
  }

  const body = lines.map((line) => line.content + line.newline).join('').trim();
  return { body, examples };
}
