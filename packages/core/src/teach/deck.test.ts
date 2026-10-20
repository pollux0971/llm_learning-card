/**
 * T37:教學卡的 deck 純函式(`packages/core/src/teach/deck.ts`,ADR-077 第 2 點)。測試 agent 寫;開發 worker 不改。
 *
 * 要實作的匯出(簽章是測試定的):
 *   orderDeck(order: readonly string[] | undefined, onDisk: readonly string[]): string[]
 *     order 檔的卡照 order 檔的順序(磁碟上沒有的略過);磁碟上有、order 檔沒列的,排在後面、照 id 排;
 *     order 是 undefined(沒有 order 檔)= 全部照 id 排。不改動傳進來的陣列。
 *   nextUnlearned(deck, reviews): string | undefined         deck 裡第一張不在 reviews 的卡;全學過 = undefined
 *   remainingCount(deck, reviews): number                    deck 裡不在 reviews 的卡數
 *   unlearnedPrereqs(prereqs, reviews, onDisk): string[]     照 prereqs 的順序,去掉已學過的與磁碟上沒有的
 * 「未學」= 不在 reviews.json(reviews 傳進來的是 `Record<CardId, 任何值>`)。
 *
 * 讀 order 檔的函式不在這裡(B-lite,ADR-077:teach/ 是純函式、不碰 fs、不 import node: 模組):
 *   `packages/core/src/schema/graph.ts` 的 readOrderFile(learningDir, category): { kind: 'missing' } | { kind: 'ok'; ids: string[] }
 *     「沒有檔」是明確的狀態,不是空陣列(ADR-038 第 1 點)。下面最後一組量的是它。
 * teach/ 底下不 import node: 的靜態檢查在 `no-node-static.test.ts`。
 *
 * 動態 import 算出來的 file URL:基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

interface DeckModule {
  orderDeck(order: readonly string[] | undefined, onDisk: readonly string[]): string[];
  nextUnlearned(deck: readonly string[], reviews: Record<string, unknown>): string | undefined;
  remainingCount(deck: readonly string[], reviews: Record<string, unknown>): number;
  unlearnedPrereqs(prereqs: readonly string[], reviews: Record<string, unknown>, onDisk: readonly string[]): string[];
}
interface GraphModule {
  readOrderFile(learningDir: string, category: string): { kind: 'missing' } | { kind: 'ok'; ids: string[] };
}

async function graph(): Promise<GraphModule> {
  const url = pathToFileURL(join(import.meta.dirname, '../schema/graph.ts')).href;
  return (await import(/* @vite-ignore */ url)) as GraphModule;
}

async function deck(): Promise<DeckModule> {
  const url = pathToFileURL(join(import.meta.dirname, 'deck.ts')).href;
  return (await import(/* @vite-ignore */ url)) as DeckModule;
}

const learned = (...ids: string[]): Record<string, unknown> => Object.fromEntries(ids.map((id) => [id, { stage: 1 }]));

describe('orderDeck:照 order 檔排', () => {
  it('order 檔的順序跟 id 順序不同時,照 order 檔', async () => {
    const d = await deck();
    expect(d.orderDeck(['c-0003', 'c-0001', 'c-0002'], ['c-0001', 'c-0002', 'c-0003'])).toEqual(['c-0003', 'c-0001', 'c-0002']);
  });

  it('order 檔有、磁碟上沒有的卡略過', async () => {
    const d = await deck();
    expect(d.orderDeck(['c-0002', 'c-0009', 'c-0001'], ['c-0001', 'c-0002'])).toEqual(['c-0002', 'c-0001']);
  });

  it('磁碟上有、order 檔沒列的卡排在 order 檔的卡後面,而且照 id 排(傳進來的磁碟順序是亂的)', async () => {
    const d = await deck();
    expect(d.orderDeck(['c-0003', 'c-0001'], ['c-0007', 'c-0002', 'c-0001', 'c-0003', 'c-0005'])).toEqual(['c-0003', 'c-0001', 'c-0002', 'c-0005', 'c-0007']);
  });

  it('沒有 order 檔(undefined):全部照 id 排', async () => {
    const d = await deck();
    expect(d.orderDeck(undefined, ['c-0003', 'c-0001', 'c-0002'])).toEqual(['c-0001', 'c-0002', 'c-0003']);
  });

  it('order 檔是空陣列不等於沒有 order 檔,但磁碟上的卡一張都不會掉(都排在後面,照 id)', async () => {
    const d = await deck();
    expect(d.orderDeck([], ['c-0002', 'c-0001'])).toEqual(['c-0001', 'c-0002']);
  });

  it('磁碟上一張都沒有:空陣列', async () => {
    const d = await deck();
    expect(d.orderDeck(['c-0001'], [])).toEqual([]);
    expect(d.orderDeck(undefined, [])).toEqual([]);
  });

  it('不改動傳進來的陣列', async () => {
    const d = await deck();
    const order = ['c-0002', 'c-0001'];
    const disk = ['c-0003', 'c-0001', 'c-0002'];
    d.orderDeck(order, disk);
    d.orderDeck(undefined, disk);
    expect(order).toEqual(['c-0002', 'c-0001']);
    expect(disk).toEqual(['c-0003', 'c-0001', 'c-0002']);
  });
});

describe('nextUnlearned / remainingCount:未學 = 不在 reviews.json', () => {
  it('第一張沒學的;學過的跳過,中間學過的也跳過', async () => {
    const d = await deck();
    const order = ['a-0003', 'a-0001', 'a-0002'];
    expect(d.nextUnlearned(order, {})).toBe('a-0003');
    expect(d.nextUnlearned(order, learned('a-0003'))).toBe('a-0001');
    expect(d.nextUnlearned(order, learned('a-0001'))).toBe('a-0003');
    expect(d.nextUnlearned(order, learned('a-0003', 'a-0001'))).toBe('a-0002');
  });

  it('全學過:undefined', async () => {
    const d = await deck();
    expect(d.nextUnlearned(['a-0001', 'a-0002'], learned('a-0001', 'a-0002'))).toBeUndefined();
    expect(d.nextUnlearned([], {})).toBeUndefined();
  });

  it('reviews 裡有、deck 裡沒有的卡不影響', async () => {
    const d = await deck();
    expect(d.nextUnlearned(['a-0001'], learned('b-0009'))).toBe('a-0001');
    expect(d.remainingCount(['a-0001', 'a-0002'], learned('b-0009'))).toBe(2);
  });

  it('剩幾張:只算 deck 裡不在 reviews 的', async () => {
    const d = await deck();
    const order = ['a-0001', 'a-0002', 'a-0003', 'a-0004'];
    expect(d.remainingCount(order, {})).toBe(4);
    expect(d.remainingCount(order, learned('a-0002'))).toBe(3);
    expect(d.remainingCount(order, learned('a-0001', 'a-0002', 'a-0003', 'a-0004'))).toBe(0);
    expect(d.remainingCount([], {})).toBe(0);
  });
});

describe('unlearnedPrereqs:只點名沒學的', () => {
  it('照 prereqs 的順序,學過的不出現', async () => {
    const d = await deck();
    const disk = ['p-0001', 'p-0002', 'p-0003'];
    expect(d.unlearnedPrereqs(['p-0003', 'p-0001', 'p-0002'], {}, disk)).toEqual(['p-0003', 'p-0001', 'p-0002']);
    expect(d.unlearnedPrereqs(['p-0003', 'p-0001', 'p-0002'], learned('p-0001'), disk)).toEqual(['p-0003', 'p-0002']);
  });

  it('全學過:空陣列;沒有先備:空陣列', async () => {
    const d = await deck();
    expect(d.unlearnedPrereqs(['p-0001'], learned('p-0001'), ['p-0001'])).toEqual([]);
    expect(d.unlearnedPrereqs([], {}, ['p-0001'])).toEqual([]);
  });

  it('先備的卡磁碟上沒有:沒有東西可以顯示,不列出來', async () => {
    const d = await deck();
    expect(d.unlearnedPrereqs(['p-0001', 'p-0009'], {}, ['p-0001'])).toEqual(['p-0001']);
  });
});

describe('readOrderFile:沒有檔是明確的狀態', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  const root = (): string => {
    const r = mkdtempSync(join(tmpdir(), 'lc-t37-deck-'));
    roots.push(r);
    mkdirSync(join(r, 'graph'), { recursive: true });
    return r;
  };

  it('檔在:ok 與 id 陣列(照檔的順序)', async () => {
    const d = await graph();
    const r = root();
    writeFileSync(join(r, 'graph', 'order-language.json'), JSON.stringify(['lang-0003', 'lang-0001']), 'utf8');
    expect(d.readOrderFile(r, 'language')).toEqual({ kind: 'ok', ids: ['lang-0003', 'lang-0001'] });
  });

  it('沒有那個檔:missing(不是 ok 加空陣列)', async () => {
    const d = await graph();
    const r = root();
    expect(d.readOrderFile(r, 'network')).toEqual({ kind: 'missing' });
  });

  it('空陣列的檔是 ok 加空陣列(檔在,只是沒列卡)', async () => {
    const d = await graph();
    const r = root();
    writeFileSync(join(r, 'graph', 'order-security.json'), '[]', 'utf8');
    expect(d.readOrderFile(r, 'security')).toEqual({ kind: 'ok', ids: [] });
  });

  it('只看自己那個類別的檔', async () => {
    const d = await graph();
    const r = root();
    writeFileSync(join(r, 'graph', 'order-language.json'), JSON.stringify(['lang-0001']), 'utf8');
    expect(d.readOrderFile(r, 'network')).toEqual({ kind: 'missing' });
  });
});
