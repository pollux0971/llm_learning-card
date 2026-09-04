/**
 * 評分表(SCORES.md)的產生與解析。人工評分,工具不判斷品質(FEATURE.md)。
 * 兩個維度,各 1–5 分,先固定這兩個(見 FEATURE.md「開放問題」)。
 */
import { SCORE_DIMENSIONS, type BatchCheckResult, type ScoreDimension } from './types.js';

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

// ------------------------------------------------------- phase-2

/**
 * 批次檢查的結果附在 SCORES.md 下方,**跟人打分的表格分開**。
 *
 * 為什麼分開:人只打兩個維度(正確性、單一概念),ADR-032 的理由是多了就沒人打。
 * 重複率與圖形狀是機器算的,放進同一張表會看起來像第三、第四個要人填的欄位。
 * 所以格式是:上面一張人填的表,下面一段「機器檢查(不用填)」。
 *
 * 格式必須穩定——這份檔案之後要拿來 diff。規則:
 *   - 固定標題 `## 機器檢查(不用填)`
 *   - 重複率寫成 `重複對數 / 卡數 = N / M(rate)`,rate 三位小數
 *   - 清單每列 `- a ↔ b(reason,similarity)`,依 (a, b) 字典序
 *   - 圖形狀每列 `- card(L?) → prereq(L?)`,依 card 再 prereq 字典序
 *   - 兩項都是 0 時仍然印出標題與 `0`,不要整段消失——消失的段落 diff 起來像檔案壞了
 */
export function renderBatchCheckSection(batch: BatchCheckResult): string {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}
