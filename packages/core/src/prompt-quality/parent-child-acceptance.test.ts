/**
 * T12 驗收補測(驗收者寫):parent-child-overlap.ts 的邊界。
 *
 * 紅測試(parent-child-overlap.test.ts)把演算法與主要介面釘住了;驗收時做的改壞版本與 Stryker 發現幾處沒被量到:
 * 跨 key 的 maxOverlap 取最大(只看最後一個 key 照樣綠)、同一邊 key 重複要報錯、載入器各條錯誤路徑、
 * issue 的 detail 內容、排序規則、opts 傳遞。這裡補上。全部暫存目錄,不碰真的 golden/ 與 learning/。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PARENT_CHILD_NGRAM_SIZE,
  PARENT_CHILD_OVERLAP_THRESHOLD,
  checkGoldenParentChild,
  checkParentChildOverlap,
  overlapCoefficient,
  runParentChildChecks,
} from './parent-child-overlap.js';
import { QUALITY_NOTE } from './structural-checks.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'lc-t12acc-'));
  roots.push(d);
  return d;
}
function runDir(files: Record<string, unknown>): string {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.output.json`), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
/** 標題帶 id 前綴,父卡與子卡的標題不會剛好相同(標題相同另有測試)。 */
let seq = 0;
const cards = (...bodies: string[]) => {
  seq += 1;
  return JSON.stringify(bodies.map((body, i) => ({ title: `標題${seq}-${i}`, body })));
};
const out = (id: string, text: string) => ({ id, text });

describe('常數', () => {
  it('門檻 0.3、n-gram 大小 3', () => {
    expect(PARENT_CHILD_OVERLAP_THRESHOLD).toBe(0.3);
    expect(PARENT_CHILD_NGRAM_SIZE).toBe(3);
  });
});

describe('overlapCoefficient', () => {
  it('子集 = 1、不相交 = 0、對稱、空集合 0', () => {
    const a = new Set(['x', 'y']);
    const b = new Set(['x', 'y', 'z', 'w']);
    expect(overlapCoefficient(a, b)).toBe(1);
    expect(overlapCoefficient(b, a)).toBe(1);
    expect(overlapCoefficient(new Set(['p']), new Set(['q']))).toBe(0);
    expect(overlapCoefficient(new Set(), b)).toBe(0);
    expect(overlapCoefficient(a, new Set())).toBe(0);
    expect(overlapCoefficient(new Set(['x', 'q']), new Set(['x', 'r', 's']))).toBe(0.5);
  });
});

describe('checkParentChildOverlap 的選項與排序', () => {
  const parent = { id: 'p', title: 'A', body: '甲乙丙丁戊己庚辛壬癸' };
  it('opts.threshold 覆寫門檻:0.9 時一半相同不算、0.2 時算', () => {
    const child = { id: 'c', title: 'B', body: '甲乙丙丁戊子丑寅卯辰' };
    expect(checkParentChildOverlap([parent], [child], { threshold: 0.9 }).pairs).toEqual([]);
    expect(checkParentChildOverlap([parent], [child], { threshold: 0.2 }).pairs).toHaveLength(1);
  });
  it('opts.ngramSize 覆寫:n-gram 改 1 時單字重疊就很高', () => {
    const child = { id: 'c', title: 'B', body: '癸辛壬庚己戊丁丙乙甲' };
    expect(checkParentChildOverlap([parent], [child]).pairs).toEqual([]);
    expect(checkParentChildOverlap([parent], [child], { ngramSize: 1 }).pairs).toHaveLength(1);
  });
  it('pairs 依 child、再依 parent 字串排序(p10 排在 p2 前面,c1 在 c2 前面)', () => {
    const body = '完全相同的一段文字內容在這裡';
    const ps = [
      { id: 'p2', title: 'x', body },
      { id: 'p10', title: 'y', body },
    ];
    const cs = [
      { id: 'c2', title: 'z', body },
      { id: 'c1', title: 'w', body },
    ];
    const pairs = checkParentChildOverlap(ps, cs).pairs.map((p) => `${p.child}-${p.parent}`);
    expect(pairs).toEqual(['c1-p10', 'c1-p2', 'c2-p10', 'c2-p2']);
  });
  it('標題相同優先於 body 重疊,而且 overlap 仍是 body 的係數', () => {
    const r = checkParentChildOverlap([{ id: 'p', title: '同一個標題', body: '甲乙丙丁戊己庚' }], [{ id: 'c', title: '同一個標題', body: '完全不同的字樣在此處' }]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.reason).toBe('title');
    expect(r.pairs[0]!.overlap).toBeLessThan(0.3);
  });
  it('rate = 成立的對數 / 子卡數;沒有子卡時 0;counts 是輸入長度', () => {
    const body = '完全相同的一段文字內容在這裡';
    const r = checkParentChildOverlap([{ id: 'p', title: 'a', body }], [{ id: 'c1', title: 'b', body }, { id: 'c2', title: 'c', body: '毫無關係的別的句子啊' }]);
    expect([r.parentCount, r.childCount, r.rate]).toEqual([1, 2, 0.5]);
    const none = checkParentChildOverlap([{ id: 'p', title: 'a', body }], []);
    expect([none.parentCount, none.childCount, none.rate]).toEqual([1, 0, 0]);
  });
});

describe('runParentChildChecks', () => {
  it('每一對一筆 issue:kind、detail 含 child id、parent id、overlap 三位小數與依據(body 重疊係數 / 標題);note 是 QUALITY_NOTE', () => {
    const body = '完全相同的一段文字內容在這裡';
    const byBody = runParentChildChecks([{ id: 'p1', title: 'a', body }], [{ id: 'c1', title: 'b', body }]);
    expect(byBody.note).toBe(QUALITY_NOTE);
    expect(byBody.issues).toHaveLength(1);
    expect(byBody.issues[0]!.kind).toBe('parent-child-overlap');
    expect(byBody.issues[0]!.detail).toContain('c1');
    expect(byBody.issues[0]!.detail).toContain('p1');
    expect(byBody.issues[0]!.detail).toContain('1.000');
    expect(byBody.issues[0]!.detail).toContain('body 重疊係數');
    const byTitle = runParentChildChecks([{ id: 'p1', title: '同標題', body: '甲乙丙丁戊己庚' }], [{ id: 'c1', title: '同標題', body: '另一段毫無關聯的字' }]);
    expect(byTitle.issues[0]!.detail).toContain('標題');
    expect(byTitle.issues[0]!.detail).not.toContain('body 重疊係數');
    expect(runParentChildChecks([], []).issues).toEqual([]);
  });
});

describe('checkGoldenParentChild', () => {
  it('maxOverlap 是所有 key 裡最大的(不是最後一個 key 的);totalPairs 與 totalChildren 跨 key 累加;inputs 依 key 排序', () => {
    const same = '完全相同的一段文字內容在這裡';
    const parents = runDir({
      'cards-b': out('cards-b', cards(same)),
      'cards-a': out('cards-a', cards(same)),
    });
    const children = runDir({
      'children-a': out('children-a', cards(same, '毫無關係的別的句子啊')), // a:1 對、最大 1.0
      'children-b': out('children-b', cards('甲乙丙丁戊己庚辛壬癸')), // b:0 對、最大 0
    });
    const r = checkGoldenParentChild({ childrenDir: children, parentsDir: parents });
    expect(r.inputs.map((i) => i.key)).toEqual(['a', 'b']);
    expect(r.totalPairs).toBe(1);
    expect(r.totalChildren).toBe(3);
    expect(r.maxOverlap).toBe(1);
    expect(r.inputs[0]!.report.childCount).toBe(2);
  });

  it('opts 傳進去(重疊係數 0.375 的一對:門檻 0.99 不成立、0.1 與預設 0.3 成立)', () => {
    const parents = runDir({ 'cards-a': out('cards-a', cards('甲乙丙丁戊己庚辛壬癸')) });
    const children = runDir({ 'children-a': out('children-a', cards('甲乙丙丁戊子丑寅卯辰')) });
    expect(checkGoldenParentChild({ childrenDir: children, parentsDir: parents, opts: { threshold: 0.1 } }).totalPairs).toBe(1);
    expect(checkGoldenParentChild({ childrenDir: children, parentsDir: parents, opts: { threshold: 0.99 } }).totalPairs).toBe(0);
    // 沒給 opts:用預設門檻 0.3,這一對重疊係數是 3/8 = 0.375,成立
    expect(checkGoldenParentChild({ childrenDir: children, parentsDir: parents }).totalPairs).toBe(1);
  });

  it('沒有 id 欄位時用檔名當 id;text 可以直接是陣列(不是字串)', () => {
    const parents = runDir({ 'cards-a': { text: [{ title: 't', body: '甲乙丙丁戊己庚辛壬癸' }] } });
    const children = runDir({ 'children-a': { text: [{ title: 'u', body: '甲乙丙丁戊己庚辛壬癸' }] } });
    expect(checkGoldenParentChild({ childrenDir: children, parentsDir: parents }).totalPairs).toBe(1);
  });

  it('沒有 title 的卡:title 視為空字串,兩邊都空不算標題相同', () => {
    const parents = runDir({ 'cards-a': out('cards-a', JSON.stringify([{ body: '甲乙丙丁戊己庚' }])) });
    const children = runDir({ 'children-a': out('children-a', JSON.stringify([{ body: '完全不同的字樣在此處' }])) });
    expect(checkGoldenParentChild({ childrenDir: children, parentsDir: parents }).totalPairs).toBe(0);
  });

  describe('錯誤路徑(各有原因,不是「0 對」)', () => {
    const good = (): string => runDir({ 'cards-a': out('cards-a', cards('甲乙丙')) });
    const call = (childrenDir: string, parentsDir: string) => () => checkGoldenParentChild({ childrenDir, parentsDir });

    it('目錄不存在 → 目錄不存在 + 路徑;是檔案不是目錄 → 不是目錄', () => {
      const ghost = join(tmp(), 'ghost');
      expect(call(ghost, good())).toThrow(/目錄不存在.*ghost/);
      const dir = tmp();
      const file = join(dir, 'file.txt');
      writeFileSync(file, 'x');
      expect(call(file, good())).toThrow(/不是目錄/);
    });
    it('目錄裡沒有任何 *.output.json → 講明是這個原因與路徑', () => {
      const empty = tmp();
      writeFileSync(join(empty, 'notes.txt'), 'x');
      expect(call(empty, good())).toThrow(/沒有任何 \*\.output\.json/);
      expect(call(good(), empty)).toThrow(/沒有任何 \*\.output\.json/);
    });
    it('key 只在一邊有 → 訊息含那個 key(兩邊各試一次)', () => {
      const parents = runDir({ 'cards-a': out('cards-a', cards('甲')), 'cards-onlyp': out('cards-onlyp', cards('乙')) });
      const children = runDir({ 'children-a': out('children-a', cards('甲')) });
      expect(call(children, parents)).toThrow(/key 只在一邊有.*onlyp/);
      const children2 = runDir({ 'children-a': out('children-a', cards('甲')), 'children-onlyc': out('children-onlyc', cards('丙')) });
      const parents2 = runDir({ 'cards-a': out('cards-a', cards('甲')) });
      expect(call(children2, parents2)).toThrow(/key 只在一邊有.*onlyc/);
    });
    it('同一邊 key 出現兩次 → 報錯並帶 key 與 id', () => {
      const parents = runDir({ 'cards-a': out('cards-a', cards('甲')), 'cards-dup': out('cards-a', cards('乙')) });
      const children = runDir({ 'children-a': out('children-a', cards('甲')) });
      expect(call(children, parents)).toThrow(/key「a」在同一邊出現兩次.*cards-a/);
    });
    it('id 取不出配對 key(沒有 - 、或 - 在最前或最後)→ 報錯並帶 id', () => {
      for (const id of ['nodash', '-lead', 'trail-']) {
        const children = runDir({ x: out(id, cards('甲')) });
        expect(call(children, good()), id).toThrow(new RegExp(`無法從 id 取出配對 key.*${id}`));
      }
    });
    it('text 不是 JSON、不是陣列、陣列項沒有字串 body → 各自報錯並帶檔名', () => {
      const bad = (text: unknown) => runDir({ 'children-a': { id: 'children-a', text } });
      expect(call(bad('{not json'), good())).toThrow(/children-a.*不是 JSON 陣列/);
      expect(call(bad('{"a":1}'), good())).toThrow(/children-a.*不是 JSON 陣列/);
      expect(call(bad(5), good())).toThrow(/children-a.*不是 JSON 陣列/);
      expect(call(bad(JSON.stringify([{ title: 't' }])), good())).toThrow(/children-a.*不是帶 body 的卡陣列/);
      expect(call(bad(JSON.stringify([null])), good())).toThrow(/不是帶 body 的卡陣列/);
      expect(call(bad(JSON.stringify([{ body: 5 }])), good())).toThrow(/不是帶 body 的卡陣列/);
    });
    it('output 檔本身不是合法 JSON 或不是物件 → 報錯並帶檔名', () => {
      expect(call(runDir({ 'children-a': '{oops' }), good())).toThrow(/children-a.*不是 JSON 陣列/);
      expect(call(runDir({ 'children-a': 'null' }), good())).toThrow(/children-a.*不是 JSON 陣列/);
      expect(call(runDir({ 'children-a': '"str"' }), good())).toThrow(/children-a.*不是 JSON 陣列/);
    });
    it('子目錄與非 .output.json 的檔案被忽略', () => {
      const dir = runDir({ 'children-a': out('children-a', cards('甲乙丙丁戊己庚辛')) });
      mkdirSync(join(dir, 'sub.output.json.d'));
      writeFileSync(join(dir, 'meta.json'), '{}');
      writeFileSync(join(dir, 'SCORES.md'), '# x');
      const parents = runDir({ 'cards-a': out('cards-a', cards('甲乙丙丁戊己庚辛')) });
      expect(checkGoldenParentChild({ childrenDir: dir, parentsDir: parents }).totalPairs).toBe(1);
    });
  });
});
