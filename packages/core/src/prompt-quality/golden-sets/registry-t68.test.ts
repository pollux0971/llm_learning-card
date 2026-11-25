/**
 * T68(07 phase-6 問 AI)的 golden 登記部分:`teach.ask` 這一組(ADR-086 第 6 點、ADR-032、工單第 8 點與 must_catch「prompt 檔改了沒有 golden 集」)。
 * 測試 agent 寫;開發 worker 不改。照 T65(registry-t65.test.ts)的做法。
 *
 * 工單沒給名字的地方,這份測試固定(開發 worker 照這裡寫,協調者轉進工單):
 *   set id `teach.ask`、task `teach.ask`(契約 §7 1.6.0 新增)、promptFile `packages/core/prompts/teach/ask.md`;
 *   登記在 `reteach.short` 後面、`selftest` 前面(registry-t65.test.ts 與 registry.test.ts 同步了);列在 REAL_TASK_GOLDEN_SET_IDS(真任務)。
 *   輸入放 `packages/core/src/prompt-quality/fixtures/golden-ask/inputs.json`(工單指定),**剛好六組**,key 是下面六個(工單的六種情形),
 *   登記表的輸入 id 是 `ask-<key>`、prompt 有一行 `golden: ask-<key>`(`--fake` 靠這一行對回應檔,同一個 task 底下唯一且互不為子字串)。
 *   每組 prompt 另有一行 `question: <這一輪的問題>`(「問得很短」那組的問題不超過 10 個字),還有一張卡的內容(標題、內文,或先備、或層級)。
 *   六組全是假資料:不取自 raw/ 或 learning/,不含真實檔名。
 *
 * 在沒有 ask.md、沒有登記 `teach.ask` 的 base 上紅。prompt 檔守門(每個 prompt 檔恰好被一組登記)本來就是 registry.test.ts 的事,
 * 這裡多釘「ask.md 被掃到、而且被登記」——有人只加 prompt 檔、沒登記,registry.test.ts 的 unregistered 那條會紅(must_catch)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../cli.js';
import type { GoldenSetId } from '../types.js';
import { PROMPTS_DIR, REAL_TASK_GOLDEN_SET_IDS, checkPromptCoverage, getGoldenSet, listGoldenSets } from './registry.js';

const ROOT = resolve(import.meta.dirname, '../../../../..');
const PQ = join(ROOT, 'packages/core/src/prompt-quality');
const SET = 'teach.ask' as string as GoldenSetId; // GoldenSetId 還沒有這個值時也要 tsc 乾淨
const PROMPT_REL = `${PROMPTS_DIR}/teach/ask.md`;
const KEYS = ['general', 'off-topic', 'skip-learning', 'unlearned-prereq', 'deepest-level', 'very-short'];

describe('T68 golden:登記表有 teach.ask', () => {
  it('登記了:id、task 都是 teach.ask、promptFile 是 prompts/teach/ask.md', () => {
    const set = getGoldenSet(SET);
    expect(set, '登記表要有 teach.ask').toBeDefined();
    expect(set!.id).toBe('teach.ask');
    expect(String(set!.task)).toBe('teach.ask');
    expect(set!.promptFile).toBe(PROMPT_REL);
  });

  it('列在 listGoldenSets 與 REAL_TASK_GOLDEN_SET_IDS(真任務),在 reteach.short 後面、selftest 前面', () => {
    expect(listGoldenSets()).toContain(SET);
    expect(REAL_TASK_GOLDEN_SET_IDS).toContain(SET);
    expect(listGoldenSets().indexOf(SET)).toBe(listGoldenSets().indexOf('reteach.short') + 1);
    expect(listGoldenSets().indexOf(SET)).toBe(listGoldenSets().indexOf('selftest') - 1);
  });

  it('剛好六組輸入(工單:至少 6 組;六種情形各一),id 是 ask-<key>、順序同 inputs.json,在整張登記表裡唯一', () => {
    const set = getGoldenSet(SET);
    expect(set).toBeDefined();
    expect(set!.inputs.map((i) => i.id)).toEqual(KEYS.map((k) => `ask-${k}`));
    expect(new Set(set!.inputs.map((i) => i.id)).size).toBe(set!.inputs.length);
    const all = listGoldenSets().flatMap((id) => getGoldenSet(id)!.inputs.map((i) => `${id}/${i.id}`));
    expect(new Set(all).size).toBe(all.length);
  });

  it('每組輸入的 prompt:有一行 golden: ask-<key>;標記互不為子字串;有一張卡的內容與一個問題(不是空殼);沒有 raw/ learning/ 的路徑', () => {
    const set = getGoldenSet(SET);
    expect(set).toBeDefined();
    const markers = set!.inputs.map((i) => `golden: ${i.id}`);
    for (const input of set!.inputs) {
      expect(input.prompt.split('\n'), input.id).toContain(`golden: ${input.id}`);
      expect(input.prompt.length, `${input.id} 不能是空殼`).toBeGreaterThan(60);
      expect(input.prompt, `${input.id} 不該指到真實素材`).not.toMatch(/\braw\/|\blearning\/|cards\/[a-z]+\/[a-z]+-\d{4}/);
    }
    for (const a of markers) for (const b of markers) if (a !== b) expect(b.includes(a), `${a} ⊂ ${b}`).toBe(false);
  });

  it('輸入檔 fixtures/golden-ask/inputs.json 存在、是陣列、剛好六筆、key 是那六個(輸入由檔案來,登記表只組 header)', () => {
    const file = join(PQ, 'fixtures/golden-ask/inputs.json');
    expect(existsSync(file), 'fixtures/golden-ask/inputs.json 要存在').toBe(true);
    const items = JSON.parse(readFileSync(file, 'utf8')) as { key?: unknown }[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.map((i) => i.key)).toEqual(KEYS);
  });

  it('六種情形都看得到:「卡有未學先備」那組提到先備、「最深一層」那組提到最深/最深一層、「要求直接給答案」那組在要答案、「問得很短」那組的問題很短', () => {
    const set = getGoldenSet(SET);
    expect(set).toBeDefined();
    const by = (key: string): string => set!.inputs.find((i) => i.id === `ask-${key}`)?.prompt ?? '';
    expect(by('unlearned-prereq')).toMatch(/先備|prereq/i);
    expect(by('deepest-level')).toMatch(/最深|level:?\s*4|deepest/i);
    expect(by('skip-learning')).toMatch(/直接|跳過|答案|skip/i);
    // 問得很短:整份 prompt 裡「問題」那一行不超過 10 個字
    const line = by('very-short')
      .split('\n')
      .find((l) => /^(question|問題)\s*[::]/i.test(l));
    expect(line, 'very-short 的 prompt 要有一行 question: / 問題:').toBeDefined();
    expect(line!.replace(/^(question|問題)\s*[::]\s*/i, '').length).toBeLessThanOrEqual(10);
  });
});

describe('T68 golden:ask.md 與守門', () => {
  const file = join(ROOT, PROMPT_REL);

  it('ask.md 存在、不是空的、要求只回一個 JSON 物件、欄位是 answer / suggestion / followups、suggestion 三選一(continue / deepen / back)', () => {
    expect(existsSync(file), `${PROMPT_REL} 要存在`).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.length).toBeGreaterThan(120);
    for (const word of ['"answer"', '"suggestion"', '"followups"', 'continue', 'deepen', 'back', 'JSON']) expect(text, word).toContain(word);
    // 工單:answer 不超過 200 字、每個追問不超過 30 字——寫在 prompt 裡(程式不卡長度)
    expect(text).toContain('200');
    expect(text).toContain('30');
  });

  it('ask.md 不叫 AI 給先備 id、也不叫它「下一步」之外去動別的(只建議,不自動跳):prompt 沒有 prereq 欄位', () => {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    expect(text.length, 'ask.md 要存在').toBeGreaterThan(0);
    expect(text).not.toMatch(/"prereq"|"highlight"|"card_id"|"id"\s*:/);
  });

  it('prompt 檔守門:每個檔恰好被一組登記,沒有未登記、重複、缺檔,掃描器沒壞;掃得到 teach/ 底下那一個', () => {
    const cov = checkPromptCoverage();
    expect(cov.scanned).toContain(PROMPT_REL);
    expect(cov.unregistered).toEqual([]);
    expect(cov.duplicated).toEqual([]);
    expect(cov.missing).toEqual([]);
    expect(cov.scannerBroken).toBe(false);
  });
});

// --fake 的回應檔(測試 agent 寫,sha256 釘住,worker 只讀不改;照 T65)。標記是 `golden: ask-<key>`,回應是合法的 { answer, suggestion, followups }。
const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const PINNED: [string, string][] = [
  ['fixtures/llm/teach.ask.golden-ask-general.json', 'c0f8e81783b39366d5100736a53a69eb7d63e190028551ffd5555fe2a2a9933d'],
  ['fixtures/llm/teach.ask.golden-ask-off-topic.json', '7c25e6c7883936266c514086d09bcf2b47d6f6a022655ca1cee045802f5a2371'],
  ['fixtures/llm/teach.ask.golden-ask-skip-learning.json', '332027c68cb2f95d43a2829a6c6885acd5f831a80213a709e6a2664e4fd6debe'],
  ['fixtures/llm/teach.ask.golden-ask-unlearned-prereq.json', '0ee352599d334860b80d0b3c8d2055822fe2e30c74737c00875d9030d1dcbea9'],
  ['fixtures/llm/teach.ask.golden-ask-deepest-level.json', '2cf4c4866bbadc6ae7a7cadc3ced94ee66f6f774f5cb76cc92dedd8e91834c8e'],
  ['fixtures/llm/teach.ask.golden-ask-very-short.json', '241b99c70d7a0742ac20f6d32f94a902ac568a108f0ebced5454dfae40fb2292'],
];

describe('T68 golden:--fake 回應檔', () => {
  for (const [file, hash] of PINNED) {
    it(`${file} 沒被改`, () => {
      expect(sha(readFileSync(join(PQ, file)))).toBe(hash);
    });
  }

  it('每個回應檔:task 是 teach.ask、標記是 golden: ask-<key>、attempt 1、回應文字是合法的回答形狀(三個欄位、suggestion 三選一、追問至多 3 個)', () => {
    for (const key of KEYS) {
      const rec = JSON.parse(readFileSync(join(PQ, `fixtures/llm/teach.ask.golden-ask-${key}.json`), 'utf8')) as { task: string; prompt_contains: string; attempt: number; response: { text: string } };
      expect(rec.task).toBe('teach.ask');
      expect(rec.prompt_contains).toBe(`golden: ask-${key}`);
      expect(rec.attempt).toBe(1);
      const out = JSON.parse(rec.response.text) as Record<string, unknown>;
      expect(Object.keys(out).sort()).toEqual(['answer', 'followups', 'suggestion']);
      expect(['continue', 'deepen', 'back']).toContain(out['suggestion']);
      expect((out['followups'] as unknown[]).length).toBeLessThanOrEqual(3);
    }
  });
});

describe('T68 golden:--fake 跑 teach.ask', () => {
  it('退出碼 0、六個輸出、每個輸出的文字是合法的回答 JSON、快照是 prompt 檔原文', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lc-t68-golden-'));
    const result = await main(['--golden', '--set', 'teach.ask', '--fake', '--out', out]);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('處理了 6 個 golden 輸入');
    const dateDirs = readdirSync(join(out, 'teach.ask'));
    expect(dateDirs.length).toBe(1);
    const dir = join(out, 'teach.ask', dateDirs[0]!);
    for (const key of KEYS) {
      const output = JSON.parse(readFileSync(join(dir, `ask-${key}.output.json`), 'utf8')) as { id: string; text: string };
      expect(output.id).toBe(`ask-${key}`);
      const parsed = JSON.parse(output.text) as { answer: string; suggestion: string; followups: string[] };
      expect(parsed.answer.length).toBeGreaterThan(0);
      expect(['continue', 'deepen', 'back']).toContain(parsed.suggestion);
    }
    expect(readFileSync(join(dir, 'prompt.snapshot.md'), 'utf8')).toBe(readFileSync(join(ROOT, PROMPT_REL), 'utf8'));
  });
});
