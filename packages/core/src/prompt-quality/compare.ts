/**
 * 比對兩次 golden run:逐項並排顯示,只讓差異被看見,不判斷好壞(FEATURE.md)。
 * 兩次 run 必須是同一組 golden set,否則拒絕比較。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseScoresSheet, type ParsedScores } from './scores.js';
import type { CompareItem, CompareResult, GoldenRunMeta } from './types.js';

export class NotComparableError extends Error {
  constructor(
    public readonly setA: string,
    public readonly setB: string,
  ) {
    super(`兩次 run 的 golden set 不一樣,不能比較:${setA} vs ${setB}`);
    this.name = 'NotComparableError';
  }
}

function readMeta(dir: string): GoldenRunMeta {
  return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as GoldenRunMeta;
}

function listOutputIds(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.output.json'))
    .map((f) => f.replace(/\.output\.json$/, ''));
}

function readOutputText(dir: string, id: string): string | null {
  const p = join(dir, `${id}.output.json`);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as { text: string };
  return parsed.text;
}

function readScores(dir: string): ParsedScores {
  const p = join(dir, 'SCORES.md');
  if (!existsSync(p)) return {};
  return parseScoresSheet(readFileSync(p, 'utf8'));
}

export function compareRuns(dirA: string, dirB: string): CompareResult {
  const metaA = readMeta(dirA);
  const metaB = readMeta(dirB);
  if (metaA.set !== metaB.set) throw new NotComparableError(metaA.set, metaB.set);

  const idsA = listOutputIds(dirA);
  const idsB = listOutputIds(dirB);
  const ids = Array.from(new Set([...idsA, ...idsB])).sort();

  const scoresA = readScores(dirA);
  const scoresB = readScores(dirB);

  const items: CompareItem[] = ids.map((id) => {
    const outputA = readOutputText(dirA, id);
    const outputB = readOutputText(dirB, id);
    return {
      id,
      outputA,
      outputB,
      same: outputA === outputB,
      scoresA: scoresA[id],
      scoresB: scoresB[id],
    };
  });

  return { set: metaA.set, dirA, dirB, items };
}
