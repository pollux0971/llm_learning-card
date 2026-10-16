/**
 * T18 (d)(d2):golden 的 children 輸入帶 `already_covered:`,另加三個非資安(化學)的泛化輸入。
 *
 * 規格:`docs/tickets/T18-children-sees-sibling-cards.md` 的 (d)(d2)(含「紅測試作者補記」)。
 * fixture(`fixtures/golden-t18/`、`fixtures/golden-generalization/`、`fixtures/llm/ingest.cards.golden-children-gen-*`)
 * 由紅測試作者寫好、sha256 釘在這裡(顧問 2026-10-17 裁決 A;泛化 L0 檔名是 `cards-gen-<key>`,key 才跟 `children-gen-<key>` 對得上);worker 只讀不改。
 *
 * `siblings.ts`、`generalization-slices.ts` 還不存在:用算出來的 file URL 動態 import,取不到就以「還沒有」紅。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../cli.js';
import { getGoldenSet } from './registry.js';
import { RAW_SLICES, sliceBody, type RawSlice } from './raw-slices.js';

const ROOT = resolve(import.meta.dirname, '../../../../..');
const PQ = join(ROOT, 'packages/core/src/prompt-quality');
const sha = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- 還沒寫的模組

interface Sibling {
  id: string;
  title: string;
  summary: string;
}
interface SiblingsModule {
  cardSummary(body: string): string;
}
interface GenSlice {
  key: string;
  heading: string;
  lines: [number, number];
}
let siblings: Partial<SiblingsModule> = {};
let genSlices: { GENERALIZATION_SLICES?: readonly GenSlice[] } = {};
const loadErrors: string[] = [];
beforeAll(async () => {
  try {
    siblings = (await import(pathToFileURL(join(ROOT, 'packages/core/src/ingest/siblings.ts')).href)) as Partial<SiblingsModule>;
  } catch (err) {
    loadErrors.push((err as Error).message);
  }
  try {
    genSlices = (await import(pathToFileURL(join(PQ, 'golden-sets/generalization-slices.ts')).href)) as typeof genSlices;
  } catch (err) {
    loadErrors.push((err as Error).message);
  }
});

function summary(body: string): string {
  if (typeof siblings.cardSummary !== 'function') throw new Error(`packages/core/src/ingest/siblings.ts 還沒有匯出 cardSummary(T18 (a)):${loadErrors.join(' / ')}`);
  return siblings.cardSummary(body);
}

// ---------------------------------------------------------------- 固定的資料

type Raw = { title: string; body: string };
function cardsOf(file: string): Raw[] {
  return JSON.parse((JSON.parse(readFileSync(file, 'utf8')) as { text: string }).text) as Raw[];
}
const L0_DIR = join(PQ, 'golden/ingest.cards/2026-10-15');
const T18_DIR = join(PQ, 'fixtures/golden-t18');
const GEN_DIR = join(PQ, 'fixtures/golden-generalization');
const L0 = (key: string): Raw[] => cardsOf(join(L0_DIR, `cards-${key}.output.json`));
const CHILDREN = (key: string): Raw[] => cardsOf(join(T18_DIR, `children-${key}.output.json`));
const GEN_L0 = (key: string): Raw[] => cardsOf(join(GEN_DIR, 'ingest.cards', `cards-gen-${key}.output.json`));

/** T18 之前(T12 第 3 輪)這三個 children 輸入的 prompt 的 sha256。拿掉 already_covered 區塊之後要一模一樣。 */
const BASE_CHILDREN_SHA: Record<string, string> = {
  'children-same-origin': '089be7dcd92e161cd35bc2ba1b17240778968154d02a2310f3a9a4b644d22c75',
  'children-cors': 'f9eca6086afeb0c50ef3bfe18bf28748a6dd9b55e549314af4e1f6437bcff115',
  'children-preflight': '6b696d7cca0673928f480aba64112a387514b00e8b397f2cfd2bd04772dffd25',
};

/** 其他四組:一個位元組都不准動。 */
const OTHER_SETS_SHA: [string, string, string][] = [
  ['ingest.cards', 'cards-same-origin', '4f55f967c91762c1de71f14e5c29f21261be493d05378950eb473b9884d91581'],
  ['ingest.cards', 'cards-cors', '90f92ee298286774bc8c737eb726eefcea2ede9b0d81a38529957b5ffdb4375a'],
  ['ingest.cards', 'cards-preflight', '0ba91d77e6390670afc99c8073908812b0c75af0bea14df8ff3b3fe1a8ad7477'],
  ['ingest.questions', 'questions-same-origin', '14f071030a03791cfd8466eb7084f271277f302ea9f1c93c82f4383ca5bd92c6'],
  ['ingest.questions', 'questions-cors', 'a5d4fa9c0751931cb1f52bb3b0a44e478bc50d67bd9e2d2f806735106bbd772b'],
  ['ingest.questions', 'questions-preflight', '739e2b84a4b1b5fe62abefc90698cb43cfd2755131359263c05e6ad41633aed4'],
  ['ingest.deps', 'deps-three-sections', 'e82807111005277aa5fe30f2b5994a8b0e9bc6fd3081d4fe7d4516b91fad7147'],
  ['ingest.deps', 'deps-pair-origin-cors', 'a2490355c37d14885b57766a1f6453c0414394df8a1f6d32c51a40c863af914e'],
  ['ingest.deps', 'deps-reversed-order', '8b1608c0d7e3b90220754e0b93c9a13df61ce832d74a82c1581d477e5cd1bab8'],
  ['ingest.regenerate', 'regenerate-same-origin', '3db0510f30fe4f495c869407633851d3626803ad231730f7f08339c06aae1a74'],
  ['ingest.regenerate', 'regenerate-cors', '417ec60d65de42ecb580de6729d95ec229ccae48582e30684826c95537b9dcb8'],
  ['ingest.regenerate', 'regenerate-preflight', '4dd93f855b1c2277ddbe296be77075d37385bde0d97f142232936fe0f82895e0'],
];

const FIXTURE_SHA: Record<string, string> = {
  'fixtures/golden-t18/children-cors.output.json': 'cc8e0e529a5515027b7e0da56bd83855699e433ee6cdd0bea9aed3008b188fe6',
  'fixtures/golden-t18/children-preflight.output.json': '6b888d44571ceb856b22aec59cac0e4fde461ef62af8da88f7a5583bedab7a9e',
  'fixtures/golden-t18/children-same-origin.output.json': '8cbac35a92081ecee2dab6f50ddd29ca5f4387afc6cf0234af2bc603af1ded26',
  'fixtures/golden-generalization/chemistry.md': '1a1d52707d24a86b44f37d6c70b6081d124add3efae0790daa52ded9ed8e0ff5',
  'fixtures/golden-generalization/ingest.cards/cards-gen-acid-base.output.json': '4fb358fb93ff9671f915cde6287fd6cda317fe62698b6fa256611edc1dd206d0',
  'fixtures/golden-generalization/ingest.cards/cards-gen-buffer.output.json': '23953366217b9d788c61ca9ca96f8ea195b665def6c4a31fc6f520f0ee5ba9d1',
  'fixtures/golden-generalization/ingest.cards/cards-gen-titration.output.json': '4513a605f8c28956958e0f80faa60684edc88c2e44ecbbf5071556c16c6adac8',
};

/** 每個資安 children 輸入的 already_covered 應該列的標題(工單 (d):另外兩個切片的 L0 + 排在前面的切片的子卡)。 */
const EXPECTED_TITLES: Record<string, string[]> = {
  'children-same-origin': [
    ...['跨來源架構', '伺服器以標頭授權', '權限決定權在伺服器', '憑證請求不能用萬用字元'],
    ...['預檢請求的觸發時機', '預檢通過後才送正式請求', '預檢結果快取'],
  ],
  'children-cors': [
    ...['同源的定義', '同源政策的安全目的', '不同路徑仍可同源', '協定或埠號不同即不同源'],
    ...['預檢請求的觸發時機', '預檢通過後才送正式請求', '預檢結果快取'],
    ...['CORS 的伺服器授權', '預檢請求的觸發', '跨來源視窗的安全溝通'],
  ],
  'children-preflight': [
    ...['同源的定義', '同源政策的安全目的', '不同路徑仍可同源', '協定或埠號不同即不同源'],
    ...['跨來源架構', '伺服器以標頭授權', '權限決定權在伺服器', '憑證請求不能用萬用字元'],
    ...['CORS 的伺服器授權', '預檢請求的觸發', '跨來源視窗的安全溝通'],
    ...['預檢請求的觸發', '簡單請求也可能先送出', '憑證模式的雙方配合'],
  ],
};

/** 依工單 (d) 的規則,從固定檔組出某個輸入的 already_covered 卡片。 */
function expectedSiblingCards(id: string): Raw[] {
  const key = id.replace(/^children-/, '');
  const order = RAW_SLICES.map((s) => s.key);
  const others = order.filter((k) => k !== key);
  const before = order.slice(0, order.indexOf(key as RawSlice['key']));
  return [...others.flatMap((k) => L0(k)), ...before.flatMap((k) => CHILDREN(k))];
}

function header(prompt: string): string[] {
  const lines = prompt.split('\n');
  expect(lines[0]).toBe('---');
  const end = lines.indexOf('---', 1);
  expect(end, '找不到 header 結尾的 ---').toBeGreaterThan(0);
  return lines.slice(1, end);
}

function stripBlock(prompt: string): string {
  const lines = prompt.split('\n');
  const end = lines.indexOf('---', 1);
  const at = lines.indexOf('already_covered:');
  if (at < 0 || at > end) return prompt;
  let stop = at + 1;
  while (stop < end && lines[stop]!.startsWith('- ')) stop += 1;
  return [...lines.slice(0, at), ...lines.slice(stop)].join('\n');
}

const children = () => getGoldenSet('ingest.children')!.inputs;
const CONTAMINATION = /CORS|同源|預檢|Origin|Access-Control/;

// ================================================================ fixture 本身

describe('T18 的固定 fixture(紅測試作者寫,sha256 釘死)', () => {
  it.each(Object.entries(FIXTURE_SHA))('%s 的位元組沒變', (rel, expected) => {
    expect(sha(readFileSync(join(PQ, rel)))).toBe(expected);
  });

  it('化學泛化 fixture 是自擬的公開常識:沒有 raw/、learning/ 路徑,沒有資安字樣', () => {
    const files = ['chemistry.md', 'ingest.cards/cards-gen-acid-base.output.json', 'ingest.cards/cards-gen-buffer.output.json', 'ingest.cards/cards-gen-titration.output.json'];
    for (const f of files) {
      const text = readFileSync(join(GEN_DIR, f), 'utf8');
      expect(text, f).not.toMatch(/raw\/|learning\//);
      expect(text, f).not.toMatch(CONTAMINATION);
    }
  });

  it('泛化 L0 的 id 是 cards-gen-<key>:第一個 - 之後那段跟 children-gen-<key> 的一樣(--overlap / --overlap-siblings 靠這個配對)', () => {
    for (const key of ['acid-base', 'buffer', 'titration']) {
      const id = (JSON.parse(readFileSync(join(GEN_DIR, 'ingest.cards', `cards-gen-${key}.output.json`), 'utf8')) as { id: string }).id;
      expect(id).toBe(`cards-gen-${key}`);
      expect(id.slice(id.indexOf('-') + 1)).toBe(`children-gen-${key}`.slice('children-'.length));
    }
  });

  // body ≤ 100 字(§2,跟 validateCard 同一條路)要 import 01 的 parseCardText / countWords,12 → 01 沒開例外,
  // 所以那一條放在 features/support/golden-generalization-words.test.ts(glue,可以跨)。
  it('手寫的 L0 卡每個切片 1–2 張,每張有標題與 body', () => {
    for (const key of ['acid-base', 'buffer', 'titration']) {
      const cards = GEN_L0(key);
      expect(cards.length).toBeGreaterThanOrEqual(1);
      expect(cards.length).toBeLessThanOrEqual(2);
      for (const c of cards) {
        expect(c.title.length, key).toBeGreaterThan(0);
        expect(c.body.trim().length, key).toBeGreaterThan(0);
      }
    }
  });
});

// ================================================================ (d) 資安三個輸入

describe('T18 (d):資安三個 children 輸入的 already_covered', () => {
  it('前三個輸入的 id 與順序不變', () => {
    expect(children().slice(0, 3).map((i) => i.id)).toEqual(['children-same-origin', 'children-cors', 'children-preflight']);
  });

  it.each(Object.keys(EXPECTED_TITLES))('%s:header 是 golden、parent_id、parent_title,接著 already_covered 與每一行;內容是切片正文', (id) => {
    const input = children().find((i) => i.id === id)!;
    const key = id.replace(/^children-/, '') as RawSlice['key'];
    const slice = RAW_SLICES.find((s) => s.key === key)!;
    const h = header(input.prompt);
    expect(h.slice(0, 4)).toEqual([`golden: ${id}`, `parent_id: sec-golden-${key}`, `parent_title: ${slice.heading}`, 'already_covered:']);
    const lines = h.slice(4);
    const expected = expectedSiblingCards(id).map((c) => `- ${c.title}:${summary(c.body)}`);
    expect([...lines].sort()).toEqual([...expected].sort());
    expect(lines.map((l) => l.slice(2, l.indexOf(':'))).sort()).toEqual([...EXPECTED_TITLES[id]!].sort());
    expect(input.prompt.endsWith(`\n---\n${sliceBody(slice)}`)).toBe(true);
  });

  it.each(Object.entries(BASE_CHILDREN_SHA))('%s:拿掉 already_covered 區塊之後,跟 T18 之前的 prompt 逐位元相同', (id, base) => {
    const input = children().find((i) => i.id === id)!;
    expect(input.prompt).toContain('already_covered:');
    expect(sha(stripBlock(input.prompt))).toBe(base);
  });

  it('cors 與 preflight 看得到排在前面的切片的子卡(golden-t18 的固定檔),same-origin 看不到任何子卡', () => {
    const p = (id: string) => children().find((i) => i.id === id)!.prompt;
    expect(p('children-same-origin')).not.toContain('- 跨來源視窗的安全溝通:');
    expect(p('children-cors')).toContain('- 跨來源視窗的安全溝通:');
    expect(p('children-cors')).not.toContain('- 簡單請求也可能先送出:');
    expect(p('children-preflight')).toContain('- 簡單請求也可能先送出:');
  });
});

describe('T18:其他四組輸入一個位元組都不動', () => {
  it.each(OTHER_SETS_SHA)('%s / %s', (set, id, expected) => {
    const input = getGoldenSet(set as Parameters<typeof getGoldenSet>[0])!.inputs.find((i) => i.id === id);
    expect(input, `${set} 少了 ${id}`).toBeDefined();
    expect(sha(input!.prompt)).toBe(expected);
  });

  it('四組各自仍是 3 個輸入', () => {
    for (const set of ['ingest.cards', 'ingest.questions', 'ingest.deps', 'ingest.regenerate'] as const) {
      expect(getGoldenSet(set)!.inputs).toHaveLength(3);
    }
  });
});

// ================================================================ (d2) 泛化三個輸入

const GEN = [
  { key: 'acid-base', heading: '酸與鹼', lines: [3, 5] as [number, number] },
  { key: 'buffer', heading: '緩衝溶液', lines: [7, 9] as [number, number] },
  { key: 'titration', heading: '滴定', lines: [11, 13] as [number, number] },
];

describe('T18 (d2):三個化學泛化輸入', () => {
  it('generalization-slices.ts 的 GENERALIZATION_SLICES:key、標題、行號照工單補記', () => {
    const slices = genSlices.GENERALIZATION_SLICES;
    expect(slices, `generalization-slices.ts 還沒有匯出 GENERALIZATION_SLICES:${loadErrors.join(' / ')}`).toBeDefined();
    expect(slices!.map((s) => ({ key: s.key, heading: s.heading, lines: [...s.lines] }))).toEqual(GEN);
  });

  it('ingest.children 多三個輸入,接在原本三個之後', () => {
    expect(children().map((i) => i.id)).toEqual([
      'children-same-origin',
      'children-cors',
      'children-preflight',
      'children-gen-acid-base',
      'children-gen-buffer',
      'children-gen-titration',
    ]);
  });

  it.each(GEN)('children-gen-$key:自己的 golden 標記與父卡;already_covered 是另外兩個切片的 L0;內容是那一節的正文', ({ key, heading, lines: [from, to] }) => {
    const input = children().find((i) => i.id === `children-gen-${key}`);
    expect(input, `沒有 children-gen-${key}`).toBeDefined();
    const h = header(input!.prompt);
    expect(h[0]).toBe(`golden: children-gen-${key}`);
    expect(h[1]).toMatch(/^parent_id: /);
    expect(h[1]).not.toMatch(/^parent_id: sec-/);
    expect(h[2]).toBe(`parent_title: ${heading}`);
    expect(h[3]).toBe('already_covered:');
    const others = GEN.filter((g) => g.key !== key).flatMap((g) => GEN_L0(g.key));
    expect([...h.slice(4)].sort()).toEqual(others.map((c) => `- ${c.title}:${summary(c.body)}`).sort());
    const section = readFileSync(join(GEN_DIR, 'chemistry.md'), 'utf8').split('\n').slice(from - 1, to);
    expect(section[0]).toBe(`## ${heading}`);
    expect(input!.prompt.endsWith(`\n---\n${section.slice(1).join('\n').trim()}`)).toBe(true);
  });

  it('泛化輸入不沿用資安的分類與來源,也沒有資安字樣', () => {
    for (const { key } of GEN) {
      const input = children().find((i) => i.id === `children-gen-${key}`);
      expect(input, `沒有 children-gen-${key}`).toBeDefined();
      expect(input!.prompt).not.toMatch(/security|security-basics\.md|sec-golden-/);
      expect(input!.prompt).not.toMatch(CONTAMINATION);
    }
  });
});

// ================================================================ 共用同一個函式(靜態)

describe('T18 (d):registry 與生產路徑共用同一套 cardSummary / 格式函式', () => {
  it('registry.ts 從 ingest/siblings import,不自己寫一份摘要或格式', () => {
    const code = readFileSync(join(PQ, 'golden-sets/registry.ts'), 'utf8');
    expect(code).toMatch(/from\s+['"][^'"]*ingest\/siblings(\.js)?['"]/);
    expect(code).toMatch(/formatAlreadyCovered\s*\(/);
    // 工單 (d):「already_covered 的行由 listSiblings 的輸出組出」
    expect(code).toMatch(/listSiblings\s*\(/);
    expect(code).not.toMatch(/function\s+(cardSummary|formatAlreadyCovered|listSiblings)\b/);
  });

  it('children.ts 也用 siblings.ts 的 formatAlreadyCovered', () => {
    const code = readFileSync(join(ROOT, 'packages/core/src/ingest/children.ts'), 'utf8');
    expect(code).toMatch(/from\s+['"]\.\/siblings(\.js)?['"]/);
    expect(code).toMatch(/formatAlreadyCovered\s*\(/);
  });
});

// ================================================================ --fake 跑得起來

describe('T18 (d2):--fake 對六個 children 輸入都有對得上的 fixture', () => {
  const out = mkdtempSync(join(tmpdir(), 'lc-t18-fake-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('--golden --set ingest.children --fake 退出碼 0,產出 6 個 output', async () => {
    const result = await main(['--golden', '--set', 'ingest.children', '--fake', '--out', out]);
    expect(result.code, result.output).toBe(0);
    const outputs: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.output.json')) outputs.push(name);
      }
    };
    walk(out);
    expect(outputs.sort()).toEqual(
      ['children-cors', 'children-gen-acid-base', 'children-gen-buffer', 'children-gen-titration', 'children-preflight', 'children-same-origin'].map((n) => `${n}.output.json`),
    );
  });
});
