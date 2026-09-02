/**
 * 評分表(SCORES.md)的產生與解析。人工評分,工具不判斷品質(FEATURE.md)。
 * 兩個維度,各 1–5 分,先固定這兩個(見 FEATURE.md「開放問題」)。
 */
import { SCORE_DIMENSIONS, type ScoreDimension } from './types.js';

export function renderScoresSheet(task: string, date: string, inputIds: string[]): string {
  const header = `| id | ${SCORE_DIMENSIONS.join(' | ')} |`;
  const divider = `|---|${SCORE_DIMENSIONS.map(() => '---').join('|')}|`;
  const rows = inputIds.map((id) => `| ${id} | ${SCORE_DIMENSIONS.map(() => ' ').join(' | ')} |`);
  return [
    `# ${task} — ${date} 評分表`,
    '',
    `兩個維度,各 1–5 分:${SCORE_DIMENSIONS.join('、')}。工具不判斷品質,這份表是給人填的。`,
    '',
    header,
    divider,
    ...rows,
    '',
  ].join('\n');
}

export type ParsedScores = Record<string, Partial<Record<ScoreDimension, string>>>;

export function parseScoresSheet(content: string): ParsedScores {
  const out: ParsedScores = {};
  const rows = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'));

  for (const row of rows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells[0] === 'id') continue; // header row
    if (cells.every((c) => /^-*$/.test(c))) continue; // divider row

    const [id, ...values] = cells;
    if (!id) continue;
    const entry: Partial<Record<ScoreDimension, string>> = {};
    let any = false;
    SCORE_DIMENSIONS.forEach((dim, i) => {
      const v = values[i];
      if (v) {
        entry[dim] = v;
        any = true;
      }
    });
    if (any) out[id] = entry;
  }
  return out;
}
