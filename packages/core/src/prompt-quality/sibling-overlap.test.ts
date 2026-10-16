/**
 * T18 (e):跨卡重疊 —— `checkGoldenSiblings`(parent-child-overlap.ts)與 `prompt-check.ts --overlap-siblings`。
 *
 * 規格:`docs/tickets/T18-children-sees-sibling-cards.md` 的 (e)(含「紅測試作者補記」的回傳形狀與 2026-10-16 的數字)。
 * 新的匯出還不存在:用命名空間 import 再轉成本檔的介面(tsc 照樣乾淨),取不到就以「還沒有匯出」紅。
 *
 * 實測資料:`cardsDir` = `golden/ingest.cards/2026-10-15`、`childrenDir` = `fixtures/golden-t18`(2026-10-16 複本,sha256 釘在
 * `golden-sets/registry-t18.test.ts`)。觀察清單的邊界(剛好 0.3、剛好 0.5)用手造的小向量(顧問 2026-10-17)。
 * 一律暫存目錄,不碰真的 learning/,不呼叫真的 LLM。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { main } from './cli.js';
import * as overlapModule from './parent-child-overlap.js';

interface SiblingSide {
  key: string;
  kind: 'L0' | 'child';
  index: number;
  title: string;
}
interface SiblingPair {
  child: SiblingSide;
  other: SiblingSide;
  overlap: number;
}
interface GoldenSiblingsResult {
  pairs: SiblingPair[];
  observe: SiblingPair[];
  totalPairsChecked: number;
  maxOverlap: number;
}
interface SiblingsApi {
  CROSS_CARD_OVERLAP_THRESHOLD: number;
  CROSS_CARD_OBSERVE_THRESHOLD: number;
  checkGoldenSiblings(args: { childrenDir: string; cardsDir: string; opts?: { threshold?: number; ngramSize?: number } }): GoldenSiblingsResult;
}
const api = overlapModule as unknown as Partial<SiblingsApi>;

function check(args: Parameters<SiblingsApi['checkGoldenSiblings']>[0]): GoldenSiblingsResult {
  if (typeof api.checkGoldenSiblings !== 'function') throw new Error('parent-child-overlap.ts 還沒有匯出 checkGoldenSiblings(T18 (e))');
  return api.checkGoldenSiblings(args);
}

const here = new URL('.', import.meta.url).pathname;
const SEC_CARDS = join(here, 'golden/ingest.cards/2026-10-15');
const SEC_CHILDREN = join(here, 'fixtures/golden-t18');
const GEN_CARDS = join(here, 'fixtures/golden-generalization/ingest.cards');

const tag = (s: SiblingSide): string => `${s.kind} ${s.key}#${s.index}`;
const find = (list: SiblingPair[], child: string, other: string): SiblingPair | undefined =>
  list.find((p) => tag(p.child) === child && tag(p.other) === other);

// ================================================================ 常數

describe('T18 (e):門檻常數', () => {
  it('跨卡門檻 0.5、觀察清單 0.3;T12 自己父卡那邊的 0.3 不動', () => {
    expect(api.CROSS_CARD_OVERLAP_THRESHOLD, 'parent-child-overlap.ts 還沒有匯出 CROSS_CARD_OVERLAP_THRESHOLD').toBe(0.5);
    expect(api.CROSS_CARD_OBSERVE_THRESHOLD, 'parent-child-overlap.ts 還沒有匯出 CROSS_CARD_OBSERVE_THRESHOLD').toBe(0.3);
    expect(overlapModule.PARENT_CHILD_OVERLAP_THRESHOLD).toBe(0.3);
  });
});

// ================================================================ 2026-10-16 實測

describe('T18 (e):2026-10-16 的資安資料(L0 2026-10-15 + golden-t18 子卡)', () => {
  it('一共比 93 對:子卡 × 別的 key 的 L0 66 對、子卡 × 別的 key 的子卡 27 對', () => {
    const all = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS, opts: { threshold: 0 } });
    expect(all.totalPairsChecked).toBe(93);
    expect(all.pairs).toHaveLength(93);
    expect(all.pairs.filter((p) => p.other.kind === 'L0')).toHaveLength(66);
    expect(all.pairs.filter((p) => p.other.kind === 'child')).toHaveLength(27);
  });

  it('預設門檻:只抓到 cors 子卡 #0 ↔ same-origin 子卡 #1(都叫「預檢請求的觸發」)= 0.745;觀察清單是空的', () => {
    const r = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS });
    expect(r.totalPairsChecked).toBe(93);
    expect(r.pairs).toEqual([
      {
        child: { key: 'cors', kind: 'child', index: 0, title: '預檢請求的觸發' },
        other: { key: 'same-origin', kind: 'child', index: 1, title: '預檢請求的觸發' },
        overlap: expect.closeTo(38 / 51, 12) as unknown as number,
      },
    ]);
    expect(r.observe).toEqual([]);
    expect(r.maxOverlap).toBeCloseTo(38 / 51, 12);
  });

  it('已知限制(釘住):same-origin 子卡 #0「CORS 的伺服器授權」↔ cors L0 #1「伺服器以標頭授權」有比,但字面只有 0.057,抓不到', () => {
    const r = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS });
    expect(find(r.pairs, 'child same-origin#0', 'L0 cors#1')).toBeUndefined();
    expect(find(r.observe, 'child same-origin#0', 'L0 cors#1')).toBeUndefined();
    const low = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS, opts: { threshold: 0.05 } });
    const pair = find(low.pairs, 'child same-origin#0', 'L0 cors#1');
    expect(pair, '這一對應該有被比到').toBeDefined();
    expect(pair!.child.title).toBe('CORS 的伺服器授權');
    expect(pair!.other.title).toBe('伺服器以標頭授權');
    expect(pair!.overlap).toBeCloseTo(2 / 35, 12);
    expect(find(low.pairs, 'child same-origin#0', 'L0 cors#2')!.overlap).toBeCloseTo(0.125, 12);
  });

  it('邊界參考:兩個 0.294(↔ preflight L0 #0「預檢請求的觸發時機」)剛好不進觀察清單;門檻降到 0.29 才成對', () => {
    const r = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS });
    expect(find(r.observe, 'child cors#0', 'L0 preflight#0')).toBeUndefined();
    expect(find(r.observe, 'child same-origin#1', 'L0 preflight#0')).toBeUndefined();
    const lower = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS, opts: { threshold: 0.29 } });
    expect(lower.pairs).toHaveLength(3);
    expect(find(lower.pairs, 'child cors#0', 'L0 preflight#0')!.overlap).toBeCloseTo(5 / 17, 12);
    expect(find(lower.pairs, 'child same-origin#1', 'L0 preflight#0')!.overlap).toBeCloseTo(5 / 17, 12);
    expect(find(lower.pairs, 'child cors#0', 'L0 preflight#0')!.other.title).toBe('預檢請求的觸發時機');
  });

  it('不比自己的 key;每一對的 child 都是子卡;兩邊都是子卡時 child 是字典序較小的 key#index;沒有重複的對', () => {
    const all = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS, opts: { threshold: 0 } });
    const seen = new Set<string>();
    for (const p of all.pairs) {
      expect(p.child.key).not.toBe(p.other.key);
      expect(p.child.kind).toBe('child');
      if (p.other.kind === 'child') expect(`${p.child.key}#${p.child.index}` < `${p.other.key}#${p.other.index}`).toBe(true);
      const id = `${tag(p.child)} | ${tag(p.other)}`;
      expect(seen.has(id), `重複的對:${id}`).toBe(false);
      seen.add(id);
    }
  });

  it('--threshold 改的是 pairs 的門檻:0.8 時 0.745 那對不成對,改進觀察清單(0.3 ≤ x < 門檻)', () => {
    const r = check({ childrenDir: SEC_CHILDREN, cardsDir: SEC_CARDS, opts: { threshold: 0.8 } });
    expect(r.pairs).toEqual([]);
    expect(r.observe).toHaveLength(1);
    expect(tag(r.observe[0]!.child)).toBe('child cors#0');
    expect(tag(r.observe[0]!.other)).toBe('child same-origin#1');
    expect(r.maxOverlap).toBeCloseTo(38 / 51, 12);
  });
});

// ================================================================ 手造向量

type Raw = { title: string; body: string };
const made: string[] = [];
afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});
function dirWith(files: Record<string, Raw[]>): string {
  const d = mkdtempSync(join(tmpdir(), 't18-siblings-'));
  made.push(d);
  for (const [id, cards] of Object.entries(files)) {
    writeFileSync(join(d, `${id}.output.json`), JSON.stringify({ id, text: JSON.stringify(cards.map((c) => ({ ...c, examples: [] }))) }));
  }
  return d;
}
const card = (title: string, body: string): Raw => ({ title, body });

// 3-gram、normalizeBody 之後:
//   'abcdef' 4 個 gram;'abcdzzzz' 5 個,共有 abc、bcd → 2 / min(4,5) = 0.5
//   'abcdefghijkl' 10 個;'abcdemnopqrstuv' 13 個,共有 abc、bcd、cde → 3 / 10 = 0.3
//   'abcdefghi' 7 個;'abcdmnopqrs' 9 個,共有 abc、bcd → 2 / 7 ≈ 0.286(剛好低於 0.3)
//   'abcdefghijk' 9 個;'abcdefmnopqrst' 12 個,共有 abc、bcd、cde、def → 4 / 9 ≈ 0.444(觀察)
// 不相干的卡用中文,跟上面的英文字母、也跟彼此沒有共同 gram(甲乙丙丁戊己、子丑寅卯辰巳、天地玄黃宇宙、日月盈昃辰宿、午未申酉戌亥)。
const QUIET_A = card('甲', '甲乙丙丁戊己');
const QUIET_B = card('子', '子丑寅卯辰巳');

describe('T18 (e):手造向量 —— 門檻邊界', () => {
  it('剛好 0.5 → 成對(>=,不是 >);other 是別的 key 的 L0,帶它在檔案陣列裡的位置與標題', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('子卡A', 'abcdef')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('無關', '天地玄黃宇宙'), card('L0B', 'abcdzzzz')] }),
    });
    expect(r.pairs).toEqual([
      { child: { key: 'a', kind: 'child', index: 0, title: '子卡A' }, other: { key: 'b', kind: 'L0', index: 1, title: 'L0B' }, overlap: 0.5 },
    ]);
    expect(r.observe).toEqual([]);
    expect(r.maxOverlap).toBe(0.5);
  });

  it('剛好 0.3 → 進觀察清單(>=),不成對', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('子卡A', 'abcdefghijkl')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('L0B', 'abcdemnopqrstuv')] }),
    });
    expect(r.pairs).toEqual([]);
    expect(r.observe).toEqual([
      { child: { key: 'a', kind: 'child', index: 0, title: '子卡A' }, other: { key: 'b', kind: 'L0', index: 0, title: 'L0B' }, overlap: 0.3 },
    ]);
  });

  it('0.3 與 0.5 之間 → 只進觀察清單', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('子卡A', 'abcdefghijk')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('L0B', 'abcdefmnopqrst')] }),
    });
    expect(r.pairs).toEqual([]);
    expect(r.observe).toHaveLength(1);
    expect(r.observe[0]!.overlap).toBeCloseTo(4 / 9, 12);
  });

  it('低於 0.3 → 兩個清單都沒有,但 maxOverlap 照算(從所有比過的對取,不是從清單取)', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('子卡A', 'abcdefghi')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('L0B', 'abcdmnopqrs')] }),
    });
    expect(r.pairs).toEqual([]);
    expect(r.observe).toEqual([]);
    expect(r.maxOverlap).toBeCloseTo(2 / 7, 12);
    expect(r.totalPairsChecked).toBe(3);
  });

  it('opts.threshold 0.8:剛好 0.5 的那對改進觀察清單', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('子卡A', 'abcdef')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('L0B', 'abcdzzzz')] }),
      opts: { threshold: 0.8 },
    });
    expect(r.pairs).toEqual([]);
    expect(r.observe.map((p) => p.overlap)).toEqual([0.5]);
  });
});

describe('T18 (e):手造向量 —— 比哪些對', () => {
  it('自己的 key 不比:子卡跟自己的 L0 一字不差也不算(那是 --overlap 的事)', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('子卡A', 'abcdef')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [card('L0A', 'abcdef')], 'cards-b': [QUIET_A] }),
    });
    expect(r.pairs).toEqual([]);
    expect(r.observe).toEqual([]);
    expect(r.maxOverlap).toBe(0);
    expect(r.totalPairsChecked).toBe(3);
  });

  it('同一個 key 的子卡彼此不比(那是 checkDuplicates 的事)', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('一', 'abcdef'), card('二', 'abcdef')], 'children-b': [QUIET_B] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('無關', '天地玄黃宇宙')] }),
    });
    expect(r.pairs).toEqual([]);
    expect(r.maxOverlap).toBe(0);
    // a#0×Lb、a#1×Lb、b#0×La、a#0×b#0、a#1×b#0
    expect(r.totalPairsChecked).toBe(5);
  });

  it('A↔B 只算一次,報在字典序較小的那張:w#1 < x#0(依 key#index,不依檔案順序)', () => {
    const r = check({
      childrenDir: dirWith({ 'children-x': [card('X0', 'abcdefgh')], 'children-w': [QUIET_B, card('W1', 'abcdefgh')] }),
      cardsDir: dirWith({ 'cards-x': [QUIET_A], 'cards-w': [card('無關', '天地玄黃宇宙')] }),
    });
    expect(r.pairs).toEqual([
      { child: { key: 'w', kind: 'child', index: 1, title: 'W1' }, other: { key: 'x', kind: 'child', index: 0, title: 'X0' }, overlap: 1 },
    ]);
    // x#0×Lw、w#0×Lx、w#1×Lx、w#0×x#0、w#1×x#0
    expect(r.totalPairsChecked).toBe(5);
  });

  it('三個 key:子卡比到另外兩個 key 的 L0 與子卡', () => {
    const r = check({
      childrenDir: dirWith({ 'children-a': [card('A0', 'abcdef')], 'children-b': [QUIET_B], 'children-c': [card('C0', '午未申酉戌亥')] }),
      cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('無關', '日月盈昃辰宿')], 'cards-c': [card('L0C', 'abcdef')] }),
    });
    expect(r.pairs.map((p) => `${tag(p.child)} | ${tag(p.other)}`)).toEqual(['child a#0 | L0 c#0']);
    // 3 張子卡 × 2 個別的 key 的 L0 = 6;子卡 × 子卡 3 對
    expect(r.totalPairsChecked).toBe(9);
  });
});

describe('T18 (e):錯誤', () => {
  it('兩邊 key 集合不同 → 丟錯,點名那個 key', () => {
    expect(() =>
      check({
        childrenDir: dirWith({ 'children-a': [QUIET_A], 'children-onlykid': [QUIET_B] }),
        cardsDir: dirWith({ 'cards-a': [QUIET_A], 'cards-onlycard': [QUIET_B] }),
      }),
    ).toThrow(/onlykid|onlycard/);
  });

  it('目錄不存在 → 丟錯,訊息含路徑;目錄裡沒有 output 檔 → 丟錯,不是「0 對」', () => {
    expect(() => check({ childrenDir: '/no/such/t18-children', cardsDir: SEC_CARDS })).toThrow(/\/no\/such\/t18-children/);
    const empty = mkdtempSync(join(tmpdir(), 't18-empty-'));
    made.push(empty);
    expect(() => check({ childrenDir: empty, cardsDir: SEC_CARDS })).toThrow();
  });
});

// ================================================================ CLI

describe('T18 (e):prompt-check.ts --overlap-siblings', () => {
  it('實測資料:有一對 → 退出碼 1,點名兩邊與 0.745,印觀察清單', async () => {
    const r = await main(['--overlap-siblings', SEC_CHILDREN, SEC_CARDS]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('0.745');
    expect(r.output).toContain('預檢請求的觸發');
    expect(r.output).toContain('cors');
    expect(r.output).toContain('same-origin');
    expect(r.output).toContain('觀察');
  });

  it('--threshold 0.8 → 退出碼 0;那一對改列在觀察清單(輸出仍看得到 0.745)', async () => {
    const r = await main(['--overlap-siblings', SEC_CHILDREN, SEC_CARDS, '--threshold', '0.8']);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain('觀察');
    expect(r.output).toContain('0.745');
  });

  it('手造:剛好 0.5 → 退出碼 1;沒有重疊 → 退出碼 0', async () => {
    const hit = await main([
      '--overlap-siblings',
      dirWith({ 'children-a': [card('子卡A', 'abcdef')], 'children-b': [QUIET_B] }),
      dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('L0B', 'abcdzzzz')] }),
    ]);
    expect(hit.code, hit.output).toBe(1);
    expect(hit.output).toContain('0.500');
    const quiet = await main([
      '--overlap-siblings',
      dirWith({ 'children-a': [card('子卡A', 'abcdef')], 'children-b': [QUIET_B] }),
      dirWith({ 'cards-a': [QUIET_A], 'cards-b': [card('無關', '天地玄黃宇宙')] }),
    ]);
    expect(quiet.code, quiet.output).toBe(0);
  });

  it('自己的 key 一字不差也不算:退出碼 0(不是把 --overlap 的事算進來)', async () => {
    const r = await main([
      '--overlap-siblings',
      dirWith({ 'children-a': [card('子卡A', 'abcdef')], 'children-b': [QUIET_B] }),
      dirWith({ 'cards-a': [card('L0A', 'abcdef')], 'cards-b': [QUIET_A] }),
    ]);
    expect(r.code, r.output).toBe(0);
  });

  it('錯誤 → 退出碼 1 並講原因:目錄不存在(含路徑)、key 對不起來(點名 key)', async () => {
    const missing = await main(['--overlap-siblings', '/no/such/t18-children', SEC_CARDS]);
    expect(missing.code).toBe(1);
    expect(missing.output).toContain('/no/such/t18-children');
    const mismatch = await main(['--overlap-siblings', dirWith({ 'children-zz': [QUIET_A] }), dirWith({ 'cards-yy': [QUIET_B] })]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.output).toMatch(/zz|yy/);
  });

  it('缺第二個目錄 → 退出碼 1,用法裡有 --overlap-siblings;沒有參數時的總用法也列出它', async () => {
    const r = await main(['--overlap-siblings', SEC_CHILDREN]);
    expect(r.code).toBe(1);
    expect(r.output).toContain('--overlap-siblings');
    const usage = await main([]);
    expect(usage.output).toContain('--overlap-siblings');
  });

  it('--threshold 合法的才收:0.8 退出碼 0;abc、-0.1、1.5、空字串 → 退出碼 1 並提到 --threshold', async () => {
    const ok = await main(['--overlap-siblings', SEC_CHILDREN, SEC_CARDS, '--threshold', '0.8']);
    expect(ok.code, ok.output).toBe(0);
    for (const bad of ['abc', '-0.1', '1.5', '']) {
      const r = await main(['--overlap-siblings', SEC_CHILDREN, SEC_CARDS, '--threshold', bad]);
      expect(r.code, `--threshold ${JSON.stringify(bad)}\n${r.output}`).toBe(1);
      expect(r.output).toContain('--threshold');
    }
  });
});

// ================================================================ 泛化那一半跑得起來(顧問 2026-10-17 裁決 A)

describe('T18 (e)+(d2):照工單的分目錄指令,泛化與資安的 --fake 輸出都配得上 L0 目錄', () => {
  const out = mkdtempSync(join(tmpdir(), 't18-fake-run-'));
  const split = mkdtempSync(join(tmpdir(), 't18-split-'));
  let runDir = '';
  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
    rmSync(split, { recursive: true, force: true });
  });
  beforeAll(async () => {
    const r = await main(['--golden', '--set', 'ingest.children', '--fake', '--out', out]);
    if (r.code !== 0) return;
    const walk = (d: string): string | undefined => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          const hit = walk(p);
          if (hit) return hit;
        } else if (name.endsWith('.output.json')) return d;
      }
      return undefined;
    };
    runDir = walk(out) ?? '';
    if (!runDir) return;
    mkdirSync(join(split, 'sec'));
    mkdirSync(join(split, 'gen'));
    // 照工單的 cp 指令分;檔案不在就不複製,讓下面的測試自己紅並講原因(不在 beforeAll 丟錯,免得整組被跳過)。
    const copy = (name: string, side: 'sec' | 'gen'): void => {
      if (existsSync(join(runDir, name))) cpSync(join(runDir, name), join(split, side, name));
    };
    for (const k of ['same-origin', 'cors', 'preflight']) copy(`children-${k}.output.json`, 'sec');
    for (const k of ['acid-base', 'buffer', 'titration']) copy(`children-gen-${k}.output.json`, 'gen');
  });

  it('泛化:checkGoldenSiblings 不報 key 錯;6 張子卡 × 4 張別的 key 的 L0 + 子卡 × 子卡 12 對 = 36', () => {
    expect(runDir, '--fake 沒跑出 ingest.children 的輸出').not.toBe('');
    expect(readdirSync(join(split, 'gen')).sort(), '--fake 沒有泛化輸入的輸出').toEqual(
      ['children-gen-acid-base', 'children-gen-buffer', 'children-gen-titration'].map((n) => `${n}.output.json`),
    );
    expect(check({ childrenDir: join(split, 'gen'), cardsDir: GEN_CARDS }).totalPairsChecked).toBe(36);
  });

  it('泛化:--overlap(T12)與 --overlap-siblings 都不報「key 只在一邊有」', async () => {
    expect(runDir).not.toBe('');
    for (const flag of ['--overlap', '--overlap-siblings']) {
      const r = await main([flag, join(split, 'gen'), GEN_CARDS]);
      expect(r.output, `${flag}\n${r.output}`).not.toMatch(/key 只在一邊有|無法從 id 取出/);
      expect(r.output, `${flag}\n${r.output}`).toMatch(flag === '--overlap' ? /最高/ : /觀察/);
    }
  });

  it('資安:分出來的三個 --fake 輸出配得上 L0 2026-10-15', () => {
    expect(runDir).not.toBe('');
    expect(check({ childrenDir: join(split, 'sec'), cardsDir: SEC_CARDS }).totalPairsChecked).toBeGreaterThan(0);
  });

  it('忘了分目錄(六個輸出直接丟進去)→ 守門報錯,不會靜悄悄過', async () => {
    expect(runDir).not.toBe('');
    expect(() => check({ childrenDir: runDir, cardsDir: SEC_CARDS })).toThrow(/gen-/);
    const r = await main(['--overlap-siblings', runDir, SEC_CARDS]);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/gen-/);
  });
});
