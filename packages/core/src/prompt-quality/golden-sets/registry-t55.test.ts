/**
 * T55(02 phase-3 場景 2:沒有 raw 時從主題生成)的 golden 部分:`ingest.topic` 這一組。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T55-ingest-topic-generation.md「3. golden」與「紅測試」。
 *
 * 輸入由測試 agent 寫(T18 的先例:評分用的輸入不由被評分的一方挑):
 *   fixtures/golden-topic/topics.json(三個非資安的公開常識主題:自然科學、理財、技術,各有分類),
 *   fixtures/llm/ingest.cards.golden-topic-<key>.json(`--fake` 的回應;標記是 `golden: topic-<key>`,在 ingest.cards 底下唯一)。
 * 這些檔的 sha256 釘在這裡,worker 只讀不改。登記表(registry.ts)要自己組 header(`golden:`、`category:`、`topic:` 各一行),**不 import `ingest/`**。
 * 註:工單裡寫的「`golden-fake/` 底下」是 `--fake` 的輸出目錄;`--fake` 的回應檔實際放在 `fixtures/llm/`(`DEFAULT_FAKE_FIXTURE_DIR`)。
 *
 * 在沒有 `topic.md`、沒有登記 `ingest.topic` 的 main 上紅;`--fake` 的回應檔與輸入檔本身(sha、內容)本來就綠(護欄)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../cli.js';
import { countBodyWords } from '../word-count.js';
import type { GoldenSetId } from '../types.js';
import { REAL_TASK_GOLDEN_SET_IDS, PROMPTS_DIR, checkPromptCoverage, getGoldenSet, listGoldenSets } from './registry.js';

const ROOT = resolve(import.meta.dirname, '../../../../..');
const PQ = join(ROOT, 'packages/core/src/prompt-quality');
const sha = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');
const SET = 'ingest.topic' as string as GoldenSetId; // GoldenSetId 還沒有這個值時也要 tsc 乾淨

interface TopicInput {
  key: string;
  category: string;
  topic: string;
}
const TOPICS = JSON.parse(readFileSync(join(PQ, 'fixtures/golden-topic/topics.json'), 'utf8')) as TopicInput[];

const PINNED: [string, string][] = [
  ['fixtures/golden-topic/topics.json', 'ae0b55708597381dbbac0397a516244e560d1e6ab9eb37c9627cbfd776038eb5'],
  ['fixtures/llm/ingest.cards.golden-topic-photosynthesis.json', '08d8e6db60d792ee4eaa60ab775fd9b9ee3ed3490194dde676ebff7cafe0c172'],
  ['fixtures/llm/ingest.cards.golden-topic-compound-interest.json', '3c80cf39d0b5c2f7e0b1cf17be59ce4e9906e6cc29d22f24a1c86952af121088'],
  ['fixtures/llm/ingest.cards.golden-topic-git-branch.json', '08b4202217b6bbbc95a9d1c9a15609f80c3c637d8144179fa3d3860c81ca2b36'],
];

describe('T55 golden:輸入與 --fake 回應(測試 agent 寫,sha256 釘住)', () => {
  for (const [file, hash] of PINNED) {
    it(`${file} 沒被改`, () => {
      expect(sha(readFileSync(join(PQ, file)))).toBe(hash);
    });
  }

  it('三個主題:非資安、各有自己的分類、key 互不為子字串、不取自 raw/ learning/ 帳本', () => {
    expect(TOPICS.map((t) => t.key)).toEqual(['photosynthesis', 'compound-interest', 'git-branch']);
    for (const t of TOPICS) {
      expect(t.category).not.toBe('security');
      expect(`${t.topic}${t.category}`).not.toMatch(/資安|security|同源|CORS/i);
    }
    for (const a of TOPICS) for (const b of TOPICS) if (a !== b) expect(a.key.includes(b.key)).toBe(false);
    expect(new Set(TOPICS.map((t) => t.category)).size).toBe(3);
  });

  it('每個 --fake 回應:合法 JSON、1 到 5 張、每張 title 與 body 都有、body 字數過 100、沒有 lines、同一個回應裡 title 不重複', () => {
    for (const t of TOPICS) {
      const rec = JSON.parse(readFileSync(join(PQ, `fixtures/llm/ingest.cards.golden-topic-${t.key}.json`), 'utf8')) as {
        task: string;
        prompt_contains: string;
        attempt: number;
        response: { text: string };
      };
      expect(rec.task).toBe('ingest.cards');
      expect(rec.prompt_contains).toBe(`golden: topic-${t.key}`);
      expect(rec.attempt).toBe(1);
      const cards = JSON.parse(rec.response.text) as { title: string; body: string; examples: unknown[]; lines?: unknown }[];
      expect(cards.length).toBeGreaterThanOrEqual(1);
      expect(cards.length).toBeLessThanOrEqual(5);
      for (const c of cards) {
        expect(typeof c.title).toBe('string');
        expect(c.title.length).toBeGreaterThan(0);
        expect(countBodyWords(c.body)).toBeLessThanOrEqual(100);
        expect(countBodyWords(c.body)).toBeGreaterThan(0);
        expect('lines' in c).toBe(false);
      }
      expect(new Set(cards.map((c) => c.title)).size).toBe(cards.length);
    }
  });
});

describe('T55 golden:登記表有 ingest.topic', () => {
  it('登記了:id、task 是 ingest.cards(契約 §7 不加新任務)、promptFile 是 topic.md', () => {
    const set = getGoldenSet(SET);
    expect(set, '登記表要有 ingest.topic').toBeDefined();
    expect(set!.id).toBe('ingest.topic');
    expect(set!.task).toBe('ingest.cards');
    expect(set!.promptFile).toBe(`${PROMPTS_DIR}/ingest/topic.md`);
  });

  it('列在 listGoldenSets 與 REAL_TASK_GOLDEN_SET_IDS(真任務),在 ingest.cards 後面', () => {
    expect(listGoldenSets()).toContain(SET);
    expect(REAL_TASK_GOLDEN_SET_IDS).toContain(SET);
    expect(listGoldenSets().indexOf(SET)).toBe(listGoldenSets().indexOf('ingest.cards') + 1);
  });

  it('三個輸入:id 是 topic-<key>,順序同 topics.json;prompt 有 golden / category / topic 三行(各自一行)', () => {
    const set = getGoldenSet(SET);
    expect(set).toBeDefined();
    expect(set!.inputs.map((i) => i.id)).toEqual(TOPICS.map((t) => `topic-${t.key}`));
    set!.inputs.forEach((input, i) => {
      const t = TOPICS[i]!;
      const lines = input.prompt.split('\n');
      expect(lines).toContain(`golden: topic-${t.key}`);
      expect(lines).toContain(`category: ${t.category}`);
      expect(lines).toContain(`topic: ${t.topic}`);
      expect(input.prompt).not.toMatch(/security|資安/i);
    });
  });

  it('輸入的 golden 標記在同一個 task(ingest.cards)底下唯一:沒有任何一組的標記是另一組的子字串', () => {
    const markers = listGoldenSets()
      .map((id) => getGoldenSet(id)!)
      .filter((s) => s.task === 'ingest.cards')
      .flatMap((s) => s.inputs.map((i) => `golden: ${i.id}`));
    expect(new Set(markers).size).toBe(markers.length);
    for (const a of markers) for (const b of markers) if (a !== b) expect(b.includes(a), `${a} ⊂ ${b}`).toBe(false);
  });

  it('不 import ingest/(不新增 import 例外)', () => {
    const src = readFileSync(join(PQ, 'golden-sets/registry.ts'), 'utf8');
    const ingestImports = src.split('\n').filter((l) => /from '@core\/ingest\/(?!siblings)/.test(l) || /from '\.\.\/\.\.\/ingest\//.test(l));
    expect(ingestImports).toEqual([]);
  });
});

describe('T55 golden:topic.md 與守門', () => {
  const file = join(ROOT, PROMPTS_DIR, 'ingest/topic.md');

  it('topic.md 存在、不是空的、講的是「主題」(輸入是一行主題,不是素材)', () => {
    expect(existsSync(file), `${PROMPTS_DIR}/ingest/topic.md 要存在`).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain('主題');
  });

  it('prompt 檔守門:每個檔恰好被一組登記,沒有未登記、重複、缺檔,掃描器沒壞', () => {
    const cov = checkPromptCoverage();
    expect(cov.scanned).toContain(`${PROMPTS_DIR}/ingest/topic.md`);
    expect(cov.unregistered).toEqual([]);
    expect(cov.duplicated).toEqual([]);
    expect(cov.missing).toEqual([]);
    expect(cov.scannerBroken).toBe(false);
  });
});

describe('T55 golden:--fake 跑 ingest.topic', () => {
  it('退出碼 0、三個輸出、每個輸出的機器檢查沒有問題、1–5 張、沒有 lines、卡的 body 過 100 字', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lc-t55-golden-'));
    const result = await main(['--golden', '--set', 'ingest.topic', '--fake', '--out', out]);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('處理了 3 個 golden 輸入');
    const dateDirs = readdirSync(join(out, 'ingest.topic'));
    expect(dateDirs.length).toBe(1);
    const dir = join(out, 'ingest.topic', dateDirs[0]!);
    for (const t of TOPICS) {
      const output = JSON.parse(readFileSync(join(dir, `topic-${t.key}.output.json`), 'utf8')) as { id: string; text: string; structural: { issues: unknown[] } };
      expect(output.id).toBe(`topic-${t.key}`);
      expect(output.structural.issues, `${t.key} 的機器檢查`).toEqual([]);
      const cards = JSON.parse(output.text) as { title: string; body: string; lines?: unknown }[];
      expect(cards.length).toBeGreaterThanOrEqual(1);
      expect(cards.length).toBeLessThanOrEqual(5);
      for (const c of cards) {
        expect('lines' in c).toBe(false);
        expect(countBodyWords(c.body)).toBeLessThanOrEqual(100);
      }
    }
    const snapshot = readFileSync(join(dir, 'prompt.snapshot.md'), 'utf8');
    expect(snapshot).toBe(readFileSync(join(ROOT, PROMPTS_DIR, 'ingest/topic.md'), 'utf8'));
  });
});
