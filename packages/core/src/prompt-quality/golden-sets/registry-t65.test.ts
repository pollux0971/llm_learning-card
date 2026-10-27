/**
 * T65(05 phase-3 縮短版生成)的 golden 部分:`reteach.short` 這一組。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T65-grading-phase3-short-and-queue.md「4. golden set」與「紅測試」;照 T55(registry-t55.test.ts)的做法。
 *
 * 輸入由測試 agent 寫(T18 的先例:評分用的輸入不由被評分的一方挑):
 *   fixtures/golden-short/inputs.json(三張非資安的公開常識卡:水循環、二分搜尋、通貨膨脹,各有分類、原卡 body 80–100 字、1–2 個 example),
 *   fixtures/llm/reteach.short.golden-short-<key>.json(`--fake` 的回應;標記是 `golden: short-<key>`,在 reteach.short 底下唯一;
 *   回應是 { body, example },body 都在預設上限 50 字以內)。
 * 這些檔的 sha256 釘在這裡,worker 只讀不改。登記表(registry.ts)自己組 header,**不 import `ingest/`**。
 *
 * 登記的形狀(工單沒給名字,測試得有一個):
 *   set id `reteach.short`、task `reteach.short`(契約 §7 本來就有)、promptFile `packages/core/prompts/grading/reteach-short.md`、
 *   輸入 id `short-<key>`、prompt 有 `golden: short-<key>` / `category: <分類>` / `title: <標題>` / `limit: 50` 各一行,
 *   後面接原卡的 body 與每一個 example;登記在 ingest.deps 後面、selftest 前面。
 *
 * 在沒有 reteach-short.md、沒有登記 `reteach.short` 的 base 上紅;輸入檔與 `--fake` 回應檔本身(sha、內容)本來就綠(護欄)。
 * 另有 structural-checks-t65.test.ts:`{ body, example }` 這個形狀不該被報「card 缺少 title」(那只是警告、不影響退出碼,見該檔)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../cli.js';
import { countBodyWords } from '../word-count.js';
import type { GoldenSetId } from '../types.js';
import { PROMPTS_DIR, REAL_TASK_GOLDEN_SET_IDS, checkPromptCoverage, getGoldenSet, listGoldenSets } from './registry.js';

const ROOT = resolve(import.meta.dirname, '../../../../..');
const PQ = join(ROOT, 'packages/core/src/prompt-quality');
const sha = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');
const SET = 'reteach.short' as string as GoldenSetId; // GoldenSetId 還沒有這個值時也要 tsc 乾淨
const PROMPT_REL = `${PROMPTS_DIR}/grading/reteach-short.md`;
const SHORT_LIMIT = 50;

interface ShortInput {
  key: string;
  category: string;
  title: string;
  body: string;
  examples: string[];
}
const CARDS = JSON.parse(readFileSync(join(PQ, 'fixtures/golden-short/inputs.json'), 'utf8')) as ShortInput[];

const PINNED: [string, string][] = [
  ['fixtures/golden-short/inputs.json', '6021de9c64dfbd7198a810c84440b9a1f358b887b8b2fb872872870bbbe68215'],
  ['fixtures/llm/reteach.short.golden-short-water-cycle.json', '21c98c32f51ac982152b3ba083508cb104aa2279cc11c8805746d1ccfd69433c'],
  ['fixtures/llm/reteach.short.golden-short-binary-search.json', '964c01f356bdaeff40c786ce8a6053357648a4316982434421f8b6efed7c1509'],
  ['fixtures/llm/reteach.short.golden-short-inflation.json', 'd50b78374867504ea5bb32a83c6da2e8531e219229b2b74ce776a74626fe0c47'],
];

describe('T65 golden:輸入與 --fake 回應(測試 agent 寫,sha256 釘住)', () => {
  for (const [file, hash] of PINNED) {
    it(`${file} 沒被改`, () => {
      expect(sha(readFileSync(join(PQ, file)))).toBe(hash);
    });
  }

  it('三張原卡:非資安、各有自己的分類、key 互不為子字串、body 比縮短上限長又不超過 100 字、1–2 個 example、不取自 raw/ learning/ 帳本', () => {
    expect(CARDS.map((c) => c.key)).toEqual(['water-cycle', 'binary-search', 'inflation']);
    for (const c of CARDS) {
      expect(c.category).not.toBe('security');
      expect(`${c.title}${c.body}${c.category}`).not.toMatch(/資安|security|同源|CORS/i);
      expect(countBodyWords(c.body), `${c.key} 的原卡 body 要比 ${SHORT_LIMIT} 字長,縮短才有意義`).toBeGreaterThan(SHORT_LIMIT);
      expect(countBodyWords(c.body)).toBeLessThanOrEqual(100);
      expect(c.examples.length).toBeGreaterThanOrEqual(1);
      expect(c.examples.length).toBeLessThanOrEqual(2);
    }
    for (const a of CARDS) for (const b of CARDS) if (a !== b) expect(a.key.includes(b.key)).toBe(false);
    expect(new Set(CARDS.map((c) => c.category)).size).toBe(3);
  });

  it('每個 --fake 回應:task 是 reteach.short、標記是 golden: short-<key>、回應是 { body, example }、body 在 50 字以內、example 是非空字串', () => {
    for (const c of CARDS) {
      const rec = JSON.parse(readFileSync(join(PQ, `fixtures/llm/reteach.short.golden-short-${c.key}.json`), 'utf8')) as {
        task: string;
        prompt_contains: string;
        attempt: number;
        response: { text: string };
      };
      expect(rec.task).toBe('reteach.short');
      expect(rec.prompt_contains).toBe(`golden: short-${c.key}`);
      expect(rec.attempt).toBe(1);
      const out = JSON.parse(rec.response.text) as { body: unknown; example: unknown };
      expect(typeof out.body).toBe('string');
      expect(typeof out.example).toBe('string');
      expect((out.example as string).trim().length).toBeGreaterThan(0);
      expect(countBodyWords(out.body as string)).toBeGreaterThan(0);
      expect(countBodyWords(out.body as string)).toBeLessThanOrEqual(SHORT_LIMIT);
    }
  });
});

describe('T65 golden:登記表有 reteach.short', () => {
  it('登記了:id、task 是 reteach.short(契約 §7 本來就有)、promptFile 是 grading/reteach-short.md', () => {
    const set = getGoldenSet(SET);
    expect(set, '登記表要有 reteach.short').toBeDefined();
    expect(set!.id).toBe('reteach.short');
    expect(set!.task).toBe('reteach.short');
    expect(set!.promptFile).toBe(PROMPT_REL);
  });

  it('列在 listGoldenSets 與 REAL_TASK_GOLDEN_SET_IDS(真任務),在 ingest.deps 後面、selftest 前面', () => {
    expect(listGoldenSets()).toContain(SET);
    expect(REAL_TASK_GOLDEN_SET_IDS).toContain(SET);
    expect(listGoldenSets().indexOf(SET)).toBe(listGoldenSets().indexOf('ingest.deps') + 1);
    expect(listGoldenSets().indexOf(SET)).toBe(listGoldenSets().indexOf('selftest') - 1);
  });

  it('三個輸入:id 是 short-<key>,順序同 inputs.json;prompt 有 golden / category / title / limit 各一行,後面有原卡的 body 與每一個 example', () => {
    const set = getGoldenSet(SET);
    expect(set).toBeDefined();
    expect(set!.inputs.map((i) => i.id)).toEqual(CARDS.map((c) => `short-${c.key}`));
    set!.inputs.forEach((input, i) => {
      const c = CARDS[i]!;
      const lines = input.prompt.split('\n');
      expect(lines).toContain(`golden: short-${c.key}`);
      expect(lines).toContain(`category: ${c.category}`);
      expect(lines).toContain(`title: ${c.title}`);
      expect(lines).toContain(`limit: ${SHORT_LIMIT}`);
      expect(input.prompt).toContain(c.body);
      for (const ex of c.examples) expect(input.prompt).toContain(ex);
      expect(input.prompt).not.toMatch(/security|資安/i);
    });
  });

  it('輸入的 golden 標記在同一個 task(reteach.short)底下唯一:沒有任何一組的標記是另一組的子字串', () => {
    const markers = listGoldenSets()
      .map((id) => getGoldenSet(id)!)
      .filter((s) => s.task === 'reteach.short')
      .flatMap((s) => s.inputs.map((i) => `golden: ${i.id}`));
    expect(markers).toHaveLength(3);
    expect(new Set(markers).size).toBe(markers.length);
    for (const a of markers) for (const b of markers) if (a !== b) expect(b.includes(a), `${a} ⊂ ${b}`).toBe(false);
  });

  it('不 import ingest/(不新增 import 例外;prompt 檔路徑不經過 ingest/prompts.ts)', () => {
    const src = readFileSync(join(PQ, 'golden-sets/registry.ts'), 'utf8');
    const ingestImports = src.split('\n').filter((l) => /from '@core\/ingest\/(?!siblings)/.test(l) || /from '\.\.\/\.\.\/ingest\//.test(l));
    expect(ingestImports).toEqual([]);
  });
});

describe('T65 golden:reteach-short.md 與守門', () => {
  const file = join(ROOT, PROMPT_REL);

  it('reteach-short.md 存在、不是空的、講的是「縮短」、要求只回 JSON { body, example }', () => {
    expect(existsSync(file), `${PROMPT_REL} 要存在`).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.length).toBeGreaterThan(80);
    expect(text).toContain('縮短');
    expect(text).toContain('"body"');
    expect(text).toContain('"example"');
  });

  it('prompt 檔守門:每個檔恰好被一組登記,沒有未登記、重複、缺檔,掃描器沒壞;掃得到 grading/ 底下那一個', () => {
    const cov = checkPromptCoverage();
    expect(cov.scanned).toContain(PROMPT_REL);
    expect(cov.unregistered).toEqual([]);
    expect(cov.duplicated).toEqual([]);
    expect(cov.missing).toEqual([]);
    expect(cov.scannerBroken).toBe(false);
  });
});

describe('T65 golden:--fake 跑 reteach.short', () => {
  it('退出碼 0、三個輸出、每個輸出 body 在 50 字以內且有一個非空 example、快照是 prompt 檔原文', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lc-t65-golden-'));
    const result = await main(['--golden', '--set', 'reteach.short', '--fake', '--out', out]);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('處理了 3 個 golden 輸入');
    const dateDirs = readdirSync(join(out, 'reteach.short'));
    expect(dateDirs.length).toBe(1);
    const dir = join(out, 'reteach.short', dateDirs[0]!);
    for (const c of CARDS) {
      const output = JSON.parse(readFileSync(join(dir, `short-${c.key}.output.json`), 'utf8')) as { id: string; text: string };
      expect(output.id).toBe(`short-${c.key}`);
      const parsed = JSON.parse(output.text) as { body: string; example: string };
      expect(countBodyWords(parsed.body)).toBeLessThanOrEqual(SHORT_LIMIT);
      expect(parsed.example.trim().length).toBeGreaterThan(0);
    }
    const snapshot = readFileSync(join(dir, 'prompt.snapshot.md'), 'utf8');
    expect(snapshot).toBe(readFileSync(join(ROOT, PROMPT_REL), 'utf8'));
  });
});
