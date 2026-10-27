/**
 * T65 驗收缺口補測(-5b 2026-10-27 的 G4、G5,加 JSON null 與 warning 欄位)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T65-grading-phase3-short-and-queue.md「低優先小票清單」。
 * 補在現有實作上,應該直接綠;每條的「改壞版轉紅」見各 it 的名字。reteach-short.test.ts 不動。
 * 字數一律用 CJK(每字 1)。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Card, LogEvent } from '@contracts/index.js';
import { ProvisionalQueue, provisionalQueuePath } from '../llm/provisional-queue.js';
import { parseCardText } from '../schema/parse-card.js';
import { generateShort } from './reteach-short.js';
import type { LlmResult, LlmRouter } from './types.js';

const LIMIT = 20;
const CARD_ID = 'sec-0001';
const CARD: Card = {
  frontmatter: {
    id: CARD_ID,
    category: 'security',
    title: '同源政策',
    level: 0,
    source: 'raw',
    source_ref: 'raw/security/web-basics.md#L3-L16',
    created: '2026-09-01',
    prereqs: [] as string[],
    provisional: false,
    stale: false,
    source_missing: false,
  },
  body: '原卡的內文:同源政策限制一個來源的文件去讀另一個來源的資源。',
  examples: ['範例一:https://a.example 讀 https://b.example 會被擋。'],
};
const words = (n: number, mark = '縮'): string => mark.repeat(n);
const reply = (body: unknown, example: unknown): string => JSON.stringify({ body, example });

interface Step {
  text: string;
  provisional?: boolean;
}
function scriptedRouter(steps: Step[]): { router: LlmRouter; prompts: string[] } {
  const prompts: string[] = [];
  const router: LlmRouter = {
    async call(_task, prompt) {
      prompts.push(prompt);
      const step = steps[prompts.length - 1];
      if (step === undefined) throw new Error(`假 router:沒有排第 ${prompts.length} 次的回應`);
      const r: LlmResult = { text: step.text, provider: 'anthropic', model: 'fake', latency_ms: 1, provisional: step.provisional === true };
      return r;
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, prompts };
}

let dir: string;
let events: LogEvent[];
const log = (e: LogEvent): void => {
  events.push(e);
};
const shortPath = (): string => join(dir, 'cards/security', `${CARD_ID}.short.md`);
const lastLine = (p: string): string => p.trimEnd().split('\n').pop()!.trim();
const hasPrev = (p: string): boolean => /上一次/.test(p);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-t65g-'));
  mkdirSync(join(dir, 'cards/security'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'cards/security', `${CARD_ID}.md`), 'ORIGINAL-CARD-FILE\n');
  events = [];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(steps: Step[]) {
  const { router, prompts } = scriptedRouter(steps);
  const queue = new ProvisionalQueue({ path: provisionalQueuePath(dir), log, now: () => '2026-10-27T01:00:00.000Z' });
  const out = await generateShort({ learningDir: dir, card: CARD, router, shortLimit: LIMIT, queue, log });
  return { out, prompts };
}
const readShort = () => parseCardText(readFileSync(shortPath(), 'utf8'));

describe('G4:body 帶一個跟模型 example 一樣的 example 圍欄', () => {
  it('讀回 examples=[X,X] → 算格式壞,不寫那一份(改壞版:拿掉「剛好 1 個」的長度檢查 → 紅)', async () => {
    const dup = `${words(8)}\n\n\`\`\`example\n同一個例子\n\`\`\``;
    const { out, prompts } = await run([{ text: reply(dup, '同一個例子') }, { text: reply(words(9, '好'), '同一個例子') }]);
    expect(prompts).toHaveLength(2);
    expect(out).toMatchObject({ kind: 'written', attempts: 2 });
    const written = readShort();
    expect(written.body).toBe(words(9, '好'));
    expect(written.examples).toEqual(['同一個例子']);
    expect(readFileSync(shortPath(), 'utf8').match(/同一個例子/g)).toHaveLength(1);
  });

  it('三次都這樣 → failed、不寫檔', async () => {
    const dup = `${words(8)}\n\n\`\`\`example\n同一個例子\n\`\`\``;
    const { out, prompts } = await run([{ text: reply(dup, '同一個例子') }, { text: reply(dup, '同一個例子') }, { text: reply(dup, '同一個例子') }]);
    expect(prompts).toHaveLength(3);
    expect(out).toEqual({ kind: 'failed', attempts: 3 });
    expect(existsSync(shortPath())).toBe(false);
  });

  it('格式壞之後下一次 prompt 的「上一次 N 字」,N 是讀回 body 的字數(8),不是 JSON body 字串長度', async () => {
    const dup = `${words(8)}\n\n\`\`\`example\n同一個例子\n\`\`\``;
    const { prompts } = await run([{ text: reply(dup, '同一個例子') }, { text: reply(words(9, '好'), '例') }]);
    expect(lastLine(prompts[1]!)).toBe(`上一次 8 字,上限 ${LIMIT}`);
  });
});

describe('G5:「上一次 N 字」的 N', () => {
  it('第 1 次回應不是 JSON(沒做來回檢查)→ 第 2 次 prompt 沒有「上一次」', async () => {
    const { prompts } = await run([{ text: '不是 JSON' }, { text: reply(words(10), '例') }]);
    expect(prompts).toHaveLength(2);
    expect(hasPrev(prompts[0]!)).toBe(false);
    expect(hasPrev(prompts[1]!)).toBe(false);
  });

  it('太長 → 壞回應 → 第 3 次 prompt 沒有「上一次」(不沿用更早的 N)', async () => {
    const { prompts } = await run([{ text: reply(words(31), '例') }, { text: '{"body":' }, { text: reply(words(10), '例') }]);
    expect(prompts).toHaveLength(3);
    expect(lastLine(prompts[1]!)).toBe(`上一次 31 字,上限 ${LIMIT}`);
    expect(hasPrev(prompts[2]!)).toBe(false);
  });

  it('壞(缺 example)→ 太長 → 第 3 次的 N 是第 2 次的字數', async () => {
    const { prompts } = await run([{ text: JSON.stringify({ body: words(5) }) }, { text: reply(words(26), '例') }, { text: reply(words(10), '例') }]);
    expect(hasPrev(prompts[1]!)).toBe(false);
    expect(lastLine(prompts[2]!)).toBe(`上一次 26 字,上限 ${LIMIT}`);
  });

  it('沒關的圍欄那次之後,N 是讀回 body 的字數(8)', async () => {
    const unclosed = `${words(8)}\n\n\`\`\`example\n吞掉真例子的字`;
    const { prompts } = await run([{ text: reply(unclosed, '正式的例子') }, { text: reply(words(9, '好'), '正式的例子') }]);
    expect(lastLine(prompts[1]!)).toBe(`上一次 8 字,上限 ${LIMIT}`);
  });

  it('N 算的是讀回的 body:JSON body 前後的空白不計', async () => {
    const { prompts } = await run([{ text: reply(`\n  ${words(31)}  \n`, '例') }, { text: reply(words(10), '例') }]);
    expect(lastLine(prompts[1]!)).toBe(`上一次 31 字,上限 ${LIMIT}`);
  });
});

describe('回應是 JSON 但不是物件', () => {
  it.each([['null'], ['[]'], ['5'], ['"字串"'], ['true']])('回應 %s → 算格式壞,不丟 TypeError,下一次還能成功', async (text) => {
    const { out, prompts } = await run([{ text }, { text: reply(words(10), '例') }]);
    expect(prompts).toHaveLength(2);
    expect(out).toMatchObject({ kind: 'written', attempts: 2 });
    expect(hasPrev(prompts[1]!)).toBe(false);
  });

  it('三次都是 null → failed(不丟錯)', async () => {
    const { out } = await run([{ text: 'null' }, { text: 'null' }, { text: 'null' }]);
    expect(out).toEqual({ kind: 'failed', attempts: 3 });
    expect(existsSync(shortPath())).toBe(false);
  });
});

describe('warning 事件的欄位', () => {
  it('reteach_short_bad_response:type=warning、task=reteach.short、reason、ts 是 ISO 字串', async () => {
    await run([{ text: 'x' }, { text: 'y' }, { text: 'z' }]);
    const ws = events.filter((e) => e.type === 'warning');
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ type: 'warning', task: 'reteach.short', reason: 'reteach_short_bad_response' });
    expect(new Date(ws[0]!['ts'] as string).toISOString()).toBe(ws[0]!['ts']);
  });

  it('reteach_short_overlong:type=warning、task=reteach.short、reason,words 是三次的字數', async () => {
    await run([{ text: reply(words(31), '例') }, { text: reply(words(24), '例') }, { text: reply(words(29), '例') }]);
    const ws = events.filter((e) => e.type === 'warning');
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ type: 'warning', task: 'reteach.short', reason: 'reteach_short_overlong', words: [31, 24, 29] });
  });

  it('成功(夠短)時不記任何 warning', async () => {
    await run([{ text: reply(words(10), '例') }]);
    expect(events.filter((e) => e.type === 'warning')).toHaveLength(0);
  });
});
