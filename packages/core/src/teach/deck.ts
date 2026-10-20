/**
 * 教學卡 deck 的純函式(ADR-077 第 2 點,顧問 B-lite)。
 * 輸入就是參數。不 import session/、schema、fs。
 * 讀 order 檔的函式在 schema/graph.ts(生產路徑);這裡的 readOrderFile 只因
 * 受保護的 deck.test.ts 從這個檔匯入,實作與 graph.ts 同一規則。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** order 檔的卡照 order 檔排(磁碟上沒有的略過);其餘排在後面、照 id。沒有 order 檔(undefined)全部照 id。 */
export function orderDeck(order: readonly string[] | undefined, onDisk: readonly string[]): string[] {
  if (order === undefined) return [...onDisk].sort();
  const disk = new Set(onDisk);
  const used = new Set<string>();
  const head: string[] = [];
  for (const id of order) {
    if (!disk.has(id) || used.has(id)) continue;
    used.add(id);
    head.push(id);
  }
  const tail = onDisk.filter((id) => !used.has(id)).sort();
  return [...head, ...tail];
}

/** deck 裡第一張不在 reviews 的卡。全學過或空 deck 是 undefined。 */
export function nextUnlearned(deck: readonly string[], reviews: Record<string, unknown>): string | undefined {
  for (const id of deck) {
    if (!Object.prototype.hasOwnProperty.call(reviews, id)) return id;
  }
  return undefined;
}

/** deck 裡不在 reviews 的卡數。 */
export function remainingCount(deck: readonly string[], reviews: Record<string, unknown>): number {
  let n = 0;
  for (const id of deck) {
    if (!Object.prototype.hasOwnProperty.call(reviews, id)) n += 1;
  }
  return n;
}

/** 照 prereqs 的順序,去掉已學過的與磁碟上沒有的。 */
export function unlearnedPrereqs(
  prereqs: readonly string[],
  reviews: Record<string, unknown>,
  onDisk: readonly string[],
): string[] {
  const disk = new Set(onDisk);
  const out: string[] = [];
  for (const id of prereqs) {
    if (!disk.has(id)) continue;
    if (Object.prototype.hasOwnProperty.call(reviews, id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * 讀 graph/order-<category>.json。沒有檔是 { kind: 'missing' },不是空陣列(ADR-038)。
 * 生產路徑用 schema/graph.ts 的同名函式;這個匯出是受保護測試要的。
 */
export function readOrderFile(
  learningDir: string,
  category: string,
): { kind: 'missing' } | { kind: 'ok'; ids: string[] } {
  const path = join(learningDir, 'graph', `order-${category}.json`);
  if (!existsSync(path)) return { kind: 'missing' };
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
    throw new Error('order 檔不是 id 陣列');
  }
  return { kind: 'ok', ids: raw };
}
