/**
 * T12:子卡不得重述父卡 —— 「字面重疊」的機器指標(ADR-043:機器抓字面、語意歸人打分)。
 *
 * 釘住的介面(新檔 `parent-child-overlap.ts`;實作者照這個寫,不改測試):
 *
 *   PARENT_CHILD_OVERLAP_THRESHOLD = 0.3     // >= 才算重疊
 *   PARENT_CHILD_NGRAM_SIZE        = DUPLICATE_NGRAM_SIZE (3)
 *   overlapCoefficient(a: Set<string>, b: Set<string>): number
 *       |A∩B| / min(|A|,|B|);任一邊是空集合 → 0
 *   checkParentChildOverlap(parents, children, opts?: { threshold?, ngramSize? }): ParentChildOverlapReport
 *       parents / children: { id, title, body }[]
 *       只比「父 × 子」,不比父與父、子與子(同層重複是 checkDuplicates 的事)
 *       一對成立:title 正規化後相同且非空(reason 'title'),或 body 的重疊係數 >= 門檻(reason 'body');
 *       標題優先。body 用 normalizeBody(移除 example 圍欄、NFKC、小寫、去空白、保留標點)。
 *       ParentChildOverlapReport = { parentCount, childCount, pairs: { parent, child, reason, overlap }[], rate }
 *       pairs 依 child、再依 parent 排序;rate = pairs.length / childCount,childCount 為 0 時是 0;
 *       每一對的 overlap 一律是 body 的重疊係數(reason 為 'title' 時也照算)
 *   runParentChildChecks(parents, children, opts?): { issues, note, report }
 *       每一對一筆 issue:kind 'parent-child-overlap',detail 含 parent id、child id、overlap.toFixed(3);
 *       note 是 QUALITY_NOTE
 *   checkGoldenParentChild({ childrenDir, parentsDir, opts? }): GoldenParentChildResult
 *       兩個目錄是 golden 的 run 目錄(裡面有 `<id>.output.json`,`text` 欄位是 JSON 卡陣列)。
 *       用 id 去掉第一個 `-` 之前的前綴當 key(`children-cors` ↔ `cards-cors`)配對;
 *       父卡 id 是 `p<序號>`、子卡 id 是 `c<序號>`(從 0 起,照陣列順序)。
 *       GoldenParentChildResult = { inputs: { key, report }[], totalPairs, totalChildren, maxOverlap }
 *       inputs 依 key 排序;maxOverlap 是所有「父 × 子」對(不只成立的)中最大的 body 重疊係數;
 *       某個 key 只在一邊有 → 丟 Error,訊息含那個 key;`text` 不是 JSON 陣列 → 丟 Error,訊息含檔名。
 *       目錄裡沒有任何 `*.output.json` → 丟 Error(0 個東西的紅,方向是「路徑錯了」,不是「很乾淨」)。
 *
 * 基準(`fixtures/golden-2026-10-15/`,是 2026-10-15 第一次真模型 golden run 的 children 與 cards 輸出原檔):
 *   33 個「父 × 子」對;門檻 0.3 之上 0 對;最高 0.150(same-origin 的第 3 張子卡對第 4 張父卡);
 *   顧問人判「重述」的那一對(preflight 的「預檢快取時間」對「預檢結果快取」)只有 0.074,
 *   33 對裡有 6 對比它高 —— 所以**這個指標抓不到那一對**(ADR-043 的已知限制,下面有測試釘住,
 *   不是 bug、也不是要把門檻往下調去抓它)。這條指標抓的是「逐字照抄」;改寫式的重述歸顧問評分。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DUPLICATE_NGRAM_SIZE,
  QUALITY_NOTE,
  charNgrams,
  jaccard,
  normalizeBody,
} from './structural-checks.js';

interface Card {
  id: string;
  title: string;
  body: string;
}
interface Pair {
  parent: string;
  child: string;
  reason: 'title' | 'body';
  overlap: number;
}
interface Report {
  parentCount: number;
  childCount: number;
  pairs: Pair[];
  rate: number;
}
interface GoldenResult {
  inputs: { key: string; report: Report }[];
  totalPairs: number;
  totalChildren: number;
  maxOverlap: number;
}
interface Mod {
  PARENT_CHILD_OVERLAP_THRESHOLD: number;
  PARENT_CHILD_NGRAM_SIZE: number;
  overlapCoefficient(a: Set<string>, b: Set<string>): number;
  checkParentChildOverlap(
    parents: Card[],
    children: Card[],
    opts?: { threshold?: number; ngramSize?: number },
  ): Report;
  runParentChildChecks(
    parents: Card[],
    children: Card[],
    opts?: { threshold?: number; ngramSize?: number },
  ): { issues: { kind: string; detail: string }[]; note: string; report: Report };
  checkGoldenParentChild(args: {
    childrenDir: string;
    parentsDir: string;
    opts?: { threshold?: number; ngramSize?: number };
  }): GoldenResult;
}

/** 動態載入:實作還沒寫時是「找不到模組」的紅,不是 tsc 的紅(紅測試要保持 tsc 乾淨)。 */
async function mod(): Promise<Mod> {
  const spec: string = './parent-child-overlap.js';
  return (await import(/* @vite-ignore */ spec)) as Mod;
}

const here = new URL('.', import.meta.url).pathname;
const BASELINE = join(here, 'fixtures/golden-2026-10-15');
const BASELINE_CHILDREN = join(BASELINE, 'ingest.children');
const BASELINE_PARENTS = join(BASELINE, 'ingest.cards');

const card = (id: string, title: string, body: string): Card => ({ id, title, body });

// 小寫英文、沒有空白:normalizeBody 之後原樣不動,數 3-gram 好算。
const SENTENCE =
  'mixed-origin requests need explicit server consent before browsers expose responses to scripts';
const SENTENCE_SLICE = 'explicit server consent before browsers expose';

describe('常數集中在一處', () => {
  it('門檻 0.3、n-gram 與重複率檢查同一個大小', async () => {
    const m = await mod();
    expect(m.PARENT_CHILD_OVERLAP_THRESHOLD).toBe(0.3);
    expect(m.PARENT_CHILD_NGRAM_SIZE).toBe(DUPLICATE_NGRAM_SIZE);
    expect(m.PARENT_CHILD_NGRAM_SIZE).toBe(3);
  });
});

describe('overlapCoefficient', () => {
  it('|A∩B| / min(|A|,|B|):小的那邊被包住就是 1', async () => {
    const { overlapCoefficient } = await mod();
    expect(overlapCoefficient(new Set(['a', 'b']), new Set(['a', 'b', 'c', 'd']))).toBe(1);
    expect(overlapCoefficient(new Set(['a', 'b', 'c', 'd']), new Set(['a', 'b']))).toBe(1);
    expect(overlapCoefficient(new Set(['a', 'b', 'c', 'd']), new Set(['a', 'x', 'y', 'z']))).toBe(0.25);
    expect(overlapCoefficient(new Set(['a']), new Set(['b']))).toBe(0);
  });
  it('任一邊是空集合 → 0(不是 NaN、不是 1)', async () => {
    const { overlapCoefficient } = await mod();
    expect(overlapCoefficient(new Set(), new Set(['a']))).toBe(0);
    expect(overlapCoefficient(new Set(['a']), new Set())).toBe(0);
    expect(overlapCoefficient(new Set(), new Set())).toBe(0);
  });
});

describe('checkParentChildOverlap:門檻邊界', () => {
  // 子卡 'abcdefghijkl' 有 10 個 3-gram。父卡 'abcdeqqqqqqq' 與它共有 abc、bcd、cde 三個 → 3/10 = 0.3。
  it('剛好 0.3 算一對(>=)', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', 'abcdeqqqqqqq')],
      [card('c0', '子', 'abcdefghijkl')],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ parent: 'p0', child: 'c0', reason: 'body' });
    expect(r.pairs[0]!.overlap).toBe(0.3);
  });
  // 子卡 'abcdefghijklm' 有 11 個 3-gram,共有 3 個 → 3/11 = 0.2727…,差一格。
  it('差一格(3/11)不算', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', 'abcdeqqqqqqq')],
      [card('c0', '子', 'abcdefghijklm')],
    );
    expect(r.pairs).toEqual([]);
  });
  it('opts.threshold 可覆寫:門檻降到 0.27 時 3/11 成立', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', 'abcdeqqqqqqq')],
      [card('c0', '子', 'abcdefghijklm')],
      { threshold: 0.27 },
    );
    expect(r.pairs).toHaveLength(1);
  });
  it('opts.ngramSize 可覆寫:改成 2 時重疊係數照 2-gram 算', async () => {
    const { checkParentChildOverlap } = await mod();
    // 子卡 'abcdef' 的 2-gram:ab,bc,cd,de,ef(5);父卡 'abcxxx' 的 2-gram:ab,bc,cx,xx(4)→ 共有 2,min=4 → 0.5
    const r = checkParentChildOverlap(
      [card('p0', '父', 'abcxxx')],
      [card('c0', '子', 'abcdef')],
      { ngramSize: 2, threshold: 0.4 },
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.overlap).toBe(0.5);
  });
});

describe('checkParentChildOverlap:比的是內文,不只比標題', () => {
  it('標題完全不同、body 逐字照抄 → 抓得到(reason body)', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '同源政策', SENTENCE)],
      [card('c0', '跨來源讀取的規則', SENTENCE)],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ reason: 'body', overlap: 1 });
  });
  it('子卡只截父卡的一小段(長度差很多)也抓得到:重疊係數 1,Jaccard 卻很低', async () => {
    const { checkParentChildOverlap } = await mod();
    const parentGrams = charNgrams(normalizeBody(SENTENCE));
    const childGrams = charNgrams(normalizeBody(SENTENCE_SLICE));
    // 這一條證明為什麼不能直接用 checkDuplicates 的 Jaccard:同一對,Jaccard 遠低於 0.6。
    expect(jaccard(parentGrams, childGrams)).toBeLessThan(0.6);
    const r = checkParentChildOverlap(
      [card('p0', '父', SENTENCE)],
      [card('c0', '子', SENTENCE_SLICE)],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.overlap).toBe(1);
  });
  it('反方向也算:子卡把整張父卡包進去再加料,同樣是重述', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', SENTENCE_SLICE)],
      [card('c0', '子', SENTENCE)],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.overlap).toBe(1);
  });
  it('兩段毫無關係的文字 → 0 對', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', 'abcdefghijklmnop')],
      [card('c0', '子', 'qrstuvwxyzqrstuv')],
    );
    expect(r.pairs).toEqual([]);
    expect(r.rate).toBe(0);
  });
});

describe('checkParentChildOverlap:標題', () => {
  it('標題正規化後相同(大小寫、全形、空白、標點都不算差別),body 毫無關係 → 成立,reason title', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', 'CORS 預檢請求', 'abcdefghijklmnop')],
      [card('c0', '「ＣＯＲＳ-預檢請求」', 'qrstuvwxyzqrstuv')],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ reason: 'title', overlap: 0 });
  });
  it('標題相同且 body 也照抄:標題優先,同一對只算一次', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '預檢', SENTENCE)],
      [card('c0', '預檢', SENTENCE)],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.reason).toBe('title');
    expect(r.pairs[0]!.overlap).toBe(1);
  });
  it('兩邊標題都是空的不算「相同」', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '', 'abcdefghijklmnop')],
      [card('c0', '', 'qrstuvwxyzqrstuv')],
    );
    expect(r.pairs).toEqual([]);
  });
  it('標題只是有一個字相同、不是整個相同 → 不成立', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '預檢快取時間', 'abcdefghijklmnop')],
      [card('c0', '預檢結果快取', 'qrstuvwxyzqrstuv')],
    );
    expect(r.pairs).toEqual([]);
  });
});

describe('checkParentChildOverlap:只比父 × 子', () => {
  it('兩張子卡彼此一模一樣,但都和父卡無關 → 0 對(同層重複是 checkDuplicates 的事)', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', 'abcdefghijklmnop')],
      [card('c0', '子甲', SENTENCE), card('c1', '子乙', SENTENCE)],
    );
    expect(r.pairs).toEqual([]);
  });
  it('兩張父卡彼此一模一樣,但都和子卡無關 → 0 對', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父甲', SENTENCE), card('p1', '父乙', SENTENCE)],
      [card('c0', '子', 'abcdefghijklmnop')],
    );
    expect(r.pairs).toEqual([]);
  });
  it('多對多:每一個「父 × 子」都比,清單依 child 再依 parent 排序,rate = 對數 / 子卡數', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p1', '父乙', SENTENCE), card('p0', '父甲', 'abcdefghijklmnop')],
      [
        card('c1', '子乙', 'qrstuvwxyzqrstuv'),
        card('c0', '子甲', SENTENCE_SLICE),
        card('c2', '子丙', SENTENCE),
      ],
    );
    expect(r.parentCount).toBe(2);
    expect(r.childCount).toBe(3);
    expect(r.pairs.map((p) => `${p.child}/${p.parent}`)).toEqual(['c0/p1', 'c2/p1']);
    expect(r.rate).toBeCloseTo(2 / 3, 10);
  });
  it('沒有子卡:rate 是 0、不是 NaN', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap([card('p0', '父', SENTENCE)], []);
    expect(r).toEqual({ parentCount: 1, childCount: 0, pairs: [], rate: 0 });
  });
});

describe('checkParentChildOverlap:body 的正規化跟 checkDuplicates 同一條', () => {
  it('example 圍欄不參與比對:兩邊只有圍欄裡的字相同 → 不成立', async () => {
    const { checkParentChildOverlap } = await mod();
    const fence = '```example\nabcdefghijklmnopqrstuvwxyz\n```';
    const r = checkParentChildOverlap(
      [card('p0', '父', `parentonlytext ${fence}`)],
      [card('c0', '子', `childonlywords ${fence}`)],
    );
    expect(r.pairs).toEqual([]);
  });
  it('大小寫與空白不算差別', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap(
      [card('p0', '父', 'Explicit  Server\tConsent Before Browsers')],
      [card('c0', '子', 'explicit server consent before browsers')],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.overlap).toBe(1);
  });
  it('body 太短(不到一個 n-gram)也不會炸:整串當唯一一個 gram', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap([card('p0', '父', 'ab')], [card('c0', '子', 'ab')]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.overlap).toBe(1);
  });
  it('子卡 body 是空字串 → 重疊 0、不成立、不炸', async () => {
    const { checkParentChildOverlap } = await mod();
    const r = checkParentChildOverlap([card('p0', '父', SENTENCE)], [card('c0', '子', '')]);
    expect(r.pairs).toEqual([]);
  });
});

describe('runParentChildChecks:進既有的 StructuralIssue 體系', () => {
  it('每一對一筆 parent-child-overlap,detail 點名兩邊 id 與三位小數,note 是 QUALITY_NOTE', async () => {
    const { runParentChildChecks } = await mod();
    const r = runParentChildChecks(
      [card('p0', '父', 'abcdeqqqqqqq')],
      [card('c0', '子', 'abcdefghijkl')],
    );
    expect(r.note).toBe(QUALITY_NOTE);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.kind).toBe('parent-child-overlap');
    expect(r.issues[0]!.detail).toContain('p0');
    expect(r.issues[0]!.detail).toContain('c0');
    expect(r.issues[0]!.detail).toContain('0.300');
    expect(r.report.pairs).toHaveLength(1);
  });
  it('0 對 → issues 是空陣列', async () => {
    const { runParentChildChecks } = await mod();
    const r = runParentChildChecks([card('p0', '父', 'abcdefghijklmnop')], [card('c0', '子', 'qrstuvwxyzqrstuv')]);
    expect(r.issues).toEqual([]);
  });
});

// ───────────────────────────── 基準:2026-10-15 的真輸出(測試素材,不是使用者資料)

describe('基準(fixtures/golden-2026-10-15):目前有 0 對超過門檻', () => {
  it('三個輸入、33 個父 × 子對、成立 0 對;最高值 0.150', async () => {
    const { checkGoldenParentChild } = await mod();
    const r = checkGoldenParentChild({ childrenDir: BASELINE_CHILDREN, parentsDir: BASELINE_PARENTS });
    expect(r.inputs.map((i) => i.key)).toEqual(['cors', 'preflight', 'same-origin']);
    expect(r.inputs.map((i) => [i.report.parentCount, i.report.childCount])).toEqual([
      [4, 3],
      [3, 3],
      [4, 3],
    ]);
    expect(r.totalChildren).toBe(9);
    expect(r.totalPairs).toBe(0);
    expect(r.maxOverlap).toBeCloseTo(0.15, 3);
  });
  it('已知限制(ADR-043)釘住:顧問人判「重述」的那一對只有 0.074,低於門檻、不會被報', async () => {
    const m = await mod();
    // preflight:子卡 c2「預檢快取時間」、父卡 p2「預檢結果快取」
    const r = m.checkGoldenParentChild({ childrenDir: BASELINE_CHILDREN, parentsDir: BASELINE_PARENTS });
    const preflight = r.inputs.find((i) => i.key === 'preflight')!;
    expect(preflight.report.pairs).toEqual([]);
    const only = m.checkGoldenParentChild({
      childrenDir: BASELINE_CHILDREN,
      parentsDir: BASELINE_PARENTS,
      opts: { threshold: 0.074 },
    });
    const hit = only.inputs.find((i) => i.key === 'preflight')!.report.pairs.find((p) => p.child === 'c2' && p.parent === 'p2');
    // 門檻降到 0.074 才抓得到它 —— 而同一個門檻會多抓 5 對人判沒問題的(誤報)。這就是「不要為了抓它降門檻」的證據。
    expect(hit?.overlap).toBeCloseTo(0.074, 3);
    expect(only.totalPairs).toBe(6);
  });
  it('把門檻拉到基準最高值以下就會有報(證明 0 對是「真的量過」,不是「檢查壞了」)', async () => {
    const { checkGoldenParentChild } = await mod();
    const r = checkGoldenParentChild({
      childrenDir: BASELINE_CHILDREN,
      parentsDir: BASELINE_PARENTS,
      opts: { threshold: 0.15 },
    });
    expect(r.totalPairs).toBe(1);
    const hit = r.inputs.find((i) => i.key === 'same-origin')!.report.pairs[0]!;
    expect(hit).toMatchObject({ child: 'c2', parent: 'p3' });
  });
});

// ───────────────────────────── 目錄載入

describe('checkGoldenParentChild:載入與配對', () => {
  const made: string[] = [];
  afterEach(() => {
    while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
  });
  function dirWith(files: Record<string, unknown>): string {
    const d = mkdtempSync(join(tmpdir(), 't12-'));
    made.push(d);
    for (const [name, value] of Object.entries(files)) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      writeFileSync(join(d, `${name}.output.json`), JSON.stringify({ id: name, text }));
    }
    return d;
  }
  const cardsText = (...bodies: string[]) => bodies.map((b, i) => ({ title: `標題${i}`, body: b, examples: [] }));

  it('照抄父卡的子卡被抓到,id 是 p<序號> / c<序號>', async () => {
    const { checkGoldenParentChild } = await mod();
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop', SENTENCE) });
    const children = dirWith({ 'children-x': cardsText('qrstuvwxyzqrstuv', SENTENCE_SLICE) });
    const r = checkGoldenParentChild({ childrenDir: children, parentsDir: parents });
    expect(r.totalPairs).toBe(1);
    expect(r.inputs[0]!.key).toBe('x');
    expect(r.inputs[0]!.report.pairs[0]).toMatchObject({ parent: 'p1', child: 'c1', reason: 'body', overlap: 1 });
    expect(r.maxOverlap).toBe(1);
  });
  it('key 只在一邊有 → 丟錯,訊息有那個 key(不靜靜略過)', async () => {
    const { checkGoldenParentChild } = await mod();
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop') });
    const children = dirWith({ 'children-x': cardsText('abcdefghijklmnop'), 'children-y': cardsText('abcdefghijklmnop') });
    expect(() => checkGoldenParentChild({ childrenDir: children, parentsDir: parents })).toThrow(/y/);
  });
  it('父卡那邊多出來的 key 同樣丟錯', async () => {
    const { checkGoldenParentChild } = await mod();
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop'), 'cards-z': cardsText('abcdefghijklmnop') });
    const children = dirWith({ 'children-x': cardsText('abcdefghijklmnop') });
    expect(() => checkGoldenParentChild({ childrenDir: children, parentsDir: parents })).toThrow(/z/);
  });
  it('text 不是 JSON 陣列 → 丟錯,訊息有檔名', async () => {
    const { checkGoldenParentChild } = await mod();
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop') });
    const children = dirWith({ 'children-x': 'not json at all' });
    expect(() => checkGoldenParentChild({ childrenDir: children, parentsDir: parents })).toThrow(/children-x/);
  });
  it('text 是 JSON 但不是陣列、或元素沒有 body → 丟錯', async () => {
    const { checkGoldenParentChild } = await mod();
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop') });
    const notArray = dirWith({ 'children-x': { title: 't', body: 'b' } });
    expect(() => checkGoldenParentChild({ childrenDir: notArray, parentsDir: parents })).toThrow(/children-x/);
    const noBody = dirWith({ 'children-x': [{ title: 't' }] });
    expect(() => checkGoldenParentChild({ childrenDir: noBody, parentsDir: parents })).toThrow(/children-x/);
  });
  it('目錄裡沒有任何 *.output.json(例如路徑打錯)→ 丟錯,不回「0 對」', async () => {
    const { checkGoldenParentChild } = await mod();
    const empty = mkdtempSync(join(tmpdir(), 't12-empty-'));
    made.push(empty);
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop') });
    expect(() => checkGoldenParentChild({ childrenDir: empty, parentsDir: parents })).toThrow();
    expect(() => checkGoldenParentChild({ childrenDir: parents, parentsDir: empty })).toThrow();
  });
  it('目錄不存在 → 丟錯', async () => {
    const { checkGoldenParentChild } = await mod();
    const parents = dirWith({ 'cards-x': cardsText('abcdefghijklmnop') });
    const missing = join(parents, 'no-such-dir');
    mkdirSync(join(parents, 'sub'));
    expect(() => checkGoldenParentChild({ childrenDir: missing, parentsDir: parents })).toThrow();
  });
});
