/**
 * 比對兩次 golden run:逐項並排顯示,只讓差異被看見,不判斷好壞(FEATURE.md)。
 * 兩次 run 必須是同一組 golden set,否則拒絕比較。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseScoresSheet, type ParsedScores } from './scores.js';
import type { CompareItem, CompareResult, GoldenRunMeta } from './types.js';

/**
 * 這個 run 目錄是**舊版面**的產物:目錄名是 `<task>/<date>`、meta.json 沒有 `set` 欄位。
 *
 * 為什麼要單獨丟錯而不是讓它比下去:舊 meta 的 `set` 讀出來是 `undefined`,
 * 兩個舊目錄放在一起比時 `undefined === undefined` 會**通過**,於是兩個不同任務的 run
 * 被當成同一組並排顯示——比不出來還好,給出錯的比較結果最糟。
 *
 * 訊息直接寫出新目錄叫什麼,不要讓人手動猜。
 */
export class LegacyRunLayoutError extends Error {
  constructor(
    public readonly dir: string,
    public readonly task: string | undefined,
  ) {
    super(
      `${dir} 是舊版面的 golden run(meta.json 沒有 set 欄位,目錄名是 LlmTask)。` +
        `新版面一組 golden set 一個目錄:<base>/<golden set id>/<date>。` +
        (task
          ? `這一份的 task 是「${task}」——` +
            (task === 'grade.apply'
              ? '對應的新 set id 是「selftest」,把它搬到 <base>/selftest/<date>/ 並在 meta.json 補上 "set": "selftest" 就能比。'
              : `對應的 set id 見 golden set 登記表(prompt-check.ts --list),搬過去並在 meta.json 補上 "set" 就能比。`)
          : '重跑一次 golden run 最省事。'),
    );
    this.name = 'LegacyRunLayoutError';
  }
}

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
  // 先擋舊版面,再比 set。順序有意義:兩邊都是舊的時候 set 都是 undefined,
  // 先比 set 的話那一對會相等、靜靜地比下去(見 LegacyRunLayoutError)。
  if (!metaA.set) throw new LegacyRunLayoutError(dirA, metaA.task);
  if (!metaB.set) throw new LegacyRunLayoutError(dirB, metaB.task);
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
