/**
 * T2 第 11 條:phase-2.feature 的格子經 gherkin 解開後,JSON.parse 還原得回來。
 * 格子會去頭尾空白、把反斜線當轉義;路徑欄是 JSON 字串,所以格子裡一個真反斜線寫成四個。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { describe, it, expect } from 'vitest';

const FEATURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../features/10-desktop-shell/phase-2.feature',
);

function cellsOf(scenarioName: string): string[] {
  const src = readFileSync(FEATURE, 'utf8');
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  const doc = parser.parse(src);
  const scenario = doc.feature?.children
    .map((c) => c.scenario)
    .find((s) => s?.name === scenarioName);
  if (!scenario) throw new Error(`找不到場景 ${scenarioName}`);
  const cells: string[] = [];
  for (const ex of scenario.examples ?? []) {
    for (const row of ex.tableBody) cells.push(row.cells[0]!.value);
  }
  return cells;
}

describe('phase-2.feature 路徑欄的格子', () => {
  const cells = cellsOf('Paths that are not clean relative paths are refused through the read command');

  it('「 ../x」那列:JSON.parse 後第一個字元是空白,且等於 " ../x"', () => {
    const cell = cells.find((c) => c.includes(' ../x'));
    expect(cell, cells.join('\n')).toBeDefined();
    const parsed = JSON.parse(cell!) as string;
    expect(parsed[0]).toBe(' ');
    expect(parsed).toBe(' ../x');
    expect(JSON.parse(cell!)).toBe(' ../x');
  });

  it('..\\..\\etc\\passwd 那列解開來含真的反斜線', () => {
    const cell = cells.find((c) => {
      try {
        const parsed = JSON.parse(c) as string;
        return parsed.includes('\\') && parsed.includes('etc') && parsed.includes('passwd');
      } catch {
        return false;
      }
    });
    expect(cell, '找不到反斜線那一列').toBeDefined();
    const parsed = JSON.parse(cell!) as string;
    expect(parsed).toBe('..\\..\\etc\\passwd');
    expect(parsed.includes('\\')).toBe(true);
    expect(parsed.includes('/')).toBe(false);
  });
});
