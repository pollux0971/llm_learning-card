/**
 * T65 紅測試:`generateShort`(05-grading phase-3,縮短版生成)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T65-grading-phase3-short-and-queue.md「要的結果」與「紅測試」的單元那一節。
 *
 * 全部用假 router(逐次回事先排好的回應或丟錯)、暫存學習資料夾、真的 ProvisionalQueue;不打網路、不花錢。
 * 被測模組用動態 import 算出來的 file URL:紅測試在 base 上要 tsc 乾淨,而 reteach-short.ts 在 base 上還不存在。
 *
 * 字數:body 一律用 CJK(每字算 1,契約 §2),所以「N 個字」就是 N 個字元,算數容易核對。
 * 每個「改回壞版會紅」的對應關係寫在各 it 的名字裡(工單 must_catch 一條一條對得上)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@contracts/index.js';
import { NoModelError } from '../llm/errors.js';
import { ProvisionalQueue, provisionalQueuePath } from '../llm/provisional-queue.js';
import { countWords } from '../schema/word-count.js';
import { parseCardText } from '../schema/parse-card.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

vi.mock('@core/schema/atomic-write.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/atomic-write.js')>();
  return { ...real, writeFileAtomic: vi.fn(real.writeFileAtomic) };
});
import { writeFileAtomic } from '@core/schema/atomic-write.js';

const MODULE = join(import.meta.dirname, 'reteach-short.ts');
const PROMPT_FILE = join(import.meta.dirname, '../../prompts/grading/reteach-short.md');

type Card = {
  frontmatter: Record<string, unknown>;
  body: string;
  examples: string[];
};
type Outcome =
  | { kind: 'written'; path: string; provisional: boolean; attempts: number }
  | { kind: 'failed'; attempts: 3 }
  | { kind: 'no-model' };
type Args = {
  learningDir: string;
  card: Card;
  router: LlmRouter;
  shortLimit: number;
  queue?: ProvisionalQueue;
  log: (e: LogEvent) => void;
};
const loadGenerate = async (): Promise<(args: Args) => Promise<Outcome>> => {
  const mod = (await import(pathToFileURL(MODULE).href)) as { generateShort: (args: Args) => Promise<Outcome> };
  return mod.generateShort;
};

const LIMIT = 20;
const CARD_ID = 'sec-0001';
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** N 個字、互不相同的標記字開頭,讓「留下的是哪一次」從內容就看得出來 */
const words = (n: number, mark = '縮'): string => mark.repeat(n);

const CARD: Card = {
  frontmatter: {
    id: CARD_ID,
    category: 'security',
    title: '同源政策',
    level: 0,
    source: 'raw',
    source_ref: 'raw/security/web-basics.md#L3-L16',
    created: '2026-09-01',
    prereqs: [],
    provisional: false,
    stale: false,
    source_missing: false,
  },
  body: '原卡的內文:同源政策限制一個來源的文件去讀另一個來源的資源,來源由協定、主機與連接埠三個部分一起決定,任何一個不同就算不同來源。',
  examples: ['範例一:https://a.example 讀 https://b.example 會被擋。', '範例二:同協定同主機同連接埠才算同源。'],
};

const reply = (body: unknown, example: unknown, extra: Record<string, unknown> = {}): string => JSON.stringify({ body, example, ...extra });

type Step = { text: string; provisional?: boolean } | { throw: unknown };
interface Call {
  task: LlmTask;
  prompt: string;
}
function scriptedRouter(steps: Step[]): { router: LlmRouter; calls: Call[] } {
  const calls: Call[] = [];
  const router: LlmRouter = {
    async call(task, prompt) {
      calls.push({ task, prompt });
      const step = steps[calls.length - 1];
      if (step === undefined) throw new Error(`假 router:沒有排第 ${calls.length} 次的回應`);
      if ('throw' in step) throw step.throw;
      const result: LlmResult = {
        text: step.text,
        provider: step.provisional === true ? 'ollama' : 'anthropic',
        model: 'fake',
        latency_ms: 1,
        provisional: step.provisional === true,
      };
      return result;
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls };
}

let dir: string;
let events: LogEvent[];
let queue: ProvisionalQueue;
const log = (e: LogEvent): void => {
  events.push(e);
};
const shortPath = (): string => join(dir, 'cards/security', `${CARD_ID}.short.md`);
const warnings = (reason: string): LogEvent[] => events.filter((e) => e.type === 'warning' && e['reason'] === reason);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-t65-'));
  mkdirSync(join(dir, 'cards/security'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'cards/security', `${CARD_ID}.md`), 'ORIGINAL-CARD-FILE\n');
  events = [];
  queue = new ProvisionalQueue({ path: provisionalQueuePath(dir), log, now: () => '2026-10-27T01:00:00.000Z' });
  vi.mocked(writeFileAtomic).mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(steps: Step[], over: Partial<Args> = {}): Promise<{ out: Outcome; calls: Call[] }> {
  const generateShort = await loadGenerate();
  const { router, calls } = scriptedRouter(steps);
  const out = await generateShort({ learningDir: dir, card: CARD, router, shortLimit: LIMIT, queue, log, ...over });
  return { out, calls };
}
const readShort = (): { frontmatter: Record<string, unknown>; body: string; examples: string[] } => parseCardText(readFileSync(shortPath(), 'utf8'));

describe('prompt', () => {
  it('prompt 範本檔存在,要求只回 JSON { body, example }(必須紅:沒有 prompt 檔)', () => {
    expect(existsSync(PROMPT_FILE), `${PROMPT_FILE} 要存在`).toBe(true);
    const text = readFileSync(PROMPT_FILE, 'utf8');
    expect(text.trim().length).toBeGreaterThan(40);
    expect(text).toContain('"body"');
    expect(text).toContain('"example"');
  });

  it('第一次的 prompt 有原卡的 body、每一個 example,而且上限數字是程式帶進去的(用 23 這個不會巧合出現的數字)', async () => {
    const { calls } = await run([{ text: reply(words(10), '例') }], { shortLimit: 23 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe('reteach.short');
    expect(calls[0]!.prompt).toContain(CARD.body);
    for (const ex of CARD.examples) expect(calls[0]!.prompt).toContain(ex);
    expect(calls[0]!.prompt).toContain('23');
  });

  it('第二次與第三次的 prompt 最後一行是「上一次 N 字,上限 L」,N 是上一次讀回 body 的字數、L 是 shortLimit', async () => {
    const { calls } = await run([{ text: reply(words(31), '例') }, { text: reply(words(27), '例') }, { text: reply(words(25), '例') }]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.prompt).not.toMatch(/上一次/);
    const last = (p: string): string => p.trimEnd().split('\n').pop()!.trim();
    expect(last(calls[1]!.prompt)).toBe(`上一次 31 字,上限 ${LIMIT}`);
    expect(last(calls[2]!.prompt)).toBe(`上一次 27 字,上限 ${LIMIT}`);
    // 重試的 prompt 仍然帶著原卡
    expect(calls[1]!.prompt).toContain(CARD.body);
    expect(calls[2]!.prompt).toContain(CARD.examples[0]!);
  });
});

describe('呼叫次數與字數', () => {
  it('第一次就夠短(正好等於上限也算):叫 1 次、寫檔、attempts 1', async () => {
    const { out, calls } = await run([{ text: reply(words(LIMIT), '例') }]);
    expect(calls).toHaveLength(1);
    expect(out).toEqual({ kind: 'written', path: shortPath(), provisional: false, attempts: 1 });
    expect(readShort().body).toBe(words(LIMIT));
    expect(events.filter((e) => e.type === 'warning')).toEqual([]);
  });

  it('第二次才夠短:叫 2 次就停(三次以內有一次夠短就不再重試),寫第二次的', async () => {
    const { out, calls } = await run([{ text: reply(words(LIMIT + 1), '例') }, { text: reply(words(LIMIT - 1, '乙'), '例') }, { text: reply(words(5, '丙'), '例') }]);
    expect(calls).toHaveLength(2);
    expect(out).toMatchObject({ kind: 'written', attempts: 2 });
    expect(readShort().body).toBe(words(LIMIT - 1, '乙'));
    expect(events.filter((e) => e.type === 'warning')).toEqual([]);
  });

  it('第三次才夠短:叫 3 次,寫第三次的,沒有 overlong warning', async () => {
    const { out, calls } = await run([{ text: reply(words(40), '例') }, { text: reply(words(30, '乙'), '例') }, { text: reply(words(12, '丙'), '例') }]);
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ kind: 'written', attempts: 3 });
    expect(readShort().body).toBe(words(12, '丙'));
    expect(warnings('reteach_short_overlong')).toEqual([]);
  });

  it('字數量的是讀回來的 body:body 字串很短,但加上 example 圍欄的內容超過上限也不算超(圍欄不計字),而 body 本身超過就是超', async () => {
    const longExample = '例'.repeat(60);
    const { out, calls } = await run([{ text: reply(words(LIMIT), longExample) }]);
    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ kind: 'written', attempts: 1 });
    expect(countWords(readShort().body)).toBeLessThanOrEqual(LIMIT);
  });

  it('三次都太長:寫字數最少的那一次(不是第一次、不是最後一次)、叫 3 次、記 reteach_short_overlong 並帶每一次的字數', async () => {
    const { out, calls } = await run([{ text: reply(words(31, '甲'), '例') }, { text: reply(words(24, '乙'), '例') }, { text: reply(words(29, '丙'), '例') }]);
    expect(calls).toHaveLength(3);
    expect(out).toEqual({ kind: 'written', path: shortPath(), provisional: false, attempts: 3 });
    expect(readShort().body).toBe(words(24, '乙'));
    expect(countWords(readShort().body)).toBeGreaterThan(LIMIT); // 太長但已經是最短的
    const w = warnings('reteach_short_overlong');
    expect(w).toHaveLength(1);
    const text = JSON.stringify(w[0]);
    for (const n of ['31', '24', '29']) expect(text, `warning 要帶每一次的字數(${n})`).toContain(n);
    expect(warnings('reteach_short_bad_response')).toEqual([]);
  });

  it('三次都太長而且字數相同:寫其中一次、仍然只記一筆 warning、檔案只有一份', async () => {
    const { out } = await run([{ text: reply(words(25), '例') }, { text: reply(words(25), '例') }, { text: reply(words(25), '例') }]);
    expect(out).toMatchObject({ kind: 'written', attempts: 3 });
    expect(warnings('reteach_short_overlong')).toHaveLength(1);
    expect(readdirSync(join(dir, 'cards/security')).filter((f) => f.endsWith('.short.md'))).toEqual([`${CARD_ID}.short.md`]);
  });
});

describe('回應格式與來回檢查', () => {
  const bads: [string, string][] = [
    ['不是 JSON', 'not-json'],
    ['JSON 但是陣列', JSON.stringify([{ body: '字', example: '例' }])],
    ['缺 example', JSON.stringify({ body: words(10) })],
    ['缺 body', JSON.stringify({ example: '例' })],
    ['body 不是字串', reply(123, '例')],
    ['example 不是字串', reply(words(10), ['例'])],
    ['body 是空白字串(trim 之後空)', reply('  \n ', '例')],
    ['example 是空字串', reply(words(10), '')],
    ['example 是空白字串', reply(words(10), '   ')],
    ['body 是 null', reply(null, '例')],
  ];
  it.each(bads)('第一次格式壞(%s)→ 這一次算失敗、會再試;第二次好的就寫第二次的(叫 2 次)', async (_name, badText) => {
    const { out, calls } = await run([{ text: badText }, { text: reply(words(10, '好'), '例') }]);
    expect(calls).toHaveLength(2);
    expect(out).toMatchObject({ kind: 'written', attempts: 2 });
    expect(readShort().body).toBe(words(10, '好'));
    expect(readShort().examples).toEqual(['例']);
  });

  it('多的鍵忽略:{ body, example, note } 照樣算好', async () => {
    const { out, calls } = await run([{ text: reply(words(10), '例', { note: '多餘', body2: 'x' }) }]);
    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ kind: 'written', attempts: 1 });
  });

  it('來回檢查:模型在 body 裡自己放 example 圍欄 → 讀回來 examples 有 2 個 → 這次算格式壞,不寫那一份(叫 2 次,檔裡剛好 1 個 example)', async () => {
    const sneaky = `${words(8)}\n\n\`\`\`example\n偷塞的例子\n\`\`\``;
    const { out, calls } = await run([{ text: reply(sneaky, '正式的例子') }, { text: reply(words(9, '好'), '正式的例子') }]);
    expect(calls).toHaveLength(2);
    expect(out).toMatchObject({ kind: 'written', attempts: 2 });
    const written = readShort();
    expect(written.examples).toEqual(['正式的例子']);
    expect(readFileSync(shortPath(), 'utf8')).not.toContain('偷塞的例子');
  });

  it('來回檢查:只有一份回應、它的 body 帶 example 圍欄 → 三次都這樣 → failed,不寫檔', async () => {
    const sneaky = `${words(8)}\n\n\`\`\`example\n偷塞\n\`\`\``;
    const { out, calls } = await run([{ text: reply(sneaky, '例') }, { text: reply(sneaky, '例') }, { text: reply(sneaky, '例') }]);
    expect(calls).toHaveLength(3);
    expect(out).toEqual({ kind: 'failed', attempts: 3 });
    expect(existsSync(shortPath())).toBe(false);
  });

  it('example 本身含三個反引號:寫檔用更長的圍欄(renderCardFile),讀回來仍然剛好 1 個 example、內容原樣', async () => {
    const example = '範例:\n```js\nconsole.log(1)\n```';
    const { out } = await run([{ text: reply(words(10), example) }]);
    expect(out).toMatchObject({ kind: 'written', attempts: 1 });
    expect(readShort().examples).toEqual([example]);
  });

  it('三次都格式壞:不丟錯、回 { failed, attempts: 3 }、記 reteach_short_bad_response、沒有 .short.md、佇列沒動(連本機回應也一樣)', async () => {
    const { out, calls } = await run([{ text: 'not-json', provisional: true }, { text: reply('', '例'), provisional: true }, { text: '{}', provisional: true }]);
    expect(calls).toHaveLength(3);
    expect(out).toEqual({ kind: 'failed', attempts: 3 });
    expect(warnings('reteach_short_bad_response')).toHaveLength(1);
    expect(warnings('reteach_short_overlong')).toEqual([]);
    expect(existsSync(shortPath())).toBe(false);
    expect(existsSync(provisionalQueuePath(dir))).toBe(false);
    expect(await queue.list()).toEqual([]);
    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled();
  });

  it('有好有壞:壞、太長(25)、壞 → 寫第二次的、記 overlong、叫 3 次', async () => {
    const { out, calls } = await run([{ text: 'not-json' }, { text: reply(words(25, '乙'), '例') }, { text: reply('', '例') }]);
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ kind: 'written', attempts: 3 });
    expect(readShort().body).toBe(words(25, '乙'));
    expect(warnings('reteach_short_overlong')).toHaveLength(1);
    expect(warnings('reteach_short_bad_response')).toEqual([]);
  });

  it('有好有壞:太長(30)、壞、太長(22) → 只在好的裡面挑最短的(22),不是最後一次以外的、也不是 30', async () => {
    const { out } = await run([{ text: reply(words(30, '甲'), '例') }, { text: 'not-json' }, { text: reply(words(22, '丙'), '例') }]);
    expect(out).toMatchObject({ kind: 'written', attempts: 3 });
    expect(readShort().body).toBe(words(22, '丙'));
    expect(warnings('reteach_short_overlong')).toHaveLength(1);
  });

  it('有好有壞:壞、夠短 → 第二次就停(叫 2 次),不再重試', async () => {
    const { out, calls } = await run([{ text: 'not-json' }, { text: reply(words(10, '好'), '例') }, { text: reply(words(3, '多'), '例') }]);
    expect(calls).toHaveLength(2);
    expect(out).toMatchObject({ kind: 'written', attempts: 2 });
  });
});

describe('寫檔', () => {
  it('寫在原卡同一個分類資料夾的 <id>.short.md;原卡檔不動;frontmatter 照抄(id 不變、provisional 以外的欄位一個不少);body 與 example 是回應的', async () => {
    const { out } = await run([{ text: reply(words(12), '縮短版的例子') }]);
    expect(out).toEqual({ kind: 'written', path: shortPath(), provisional: false, attempts: 1 });
    expect(readFileSync(join(dir, 'cards/security', `${CARD_ID}.md`), 'utf8')).toBe('ORIGINAL-CARD-FILE\n');
    const parsed = readShort();
    const { provisional: gotProv, ...gotRest } = parsed.frontmatter;
    const { provisional: _p, ...wantRest } = CARD.frontmatter;
    expect(gotRest).toEqual(wantRest);
    expect(gotRest['id']).toBe(CARD_ID);
    expect(gotProv === undefined || gotProv === false).toBe(true);
    expect(parsed.body).toBe(words(12));
    expect(parsed.examples).toEqual(['縮短版的例子']);
  });

  it('經過 writeFileAtomic(寫的路徑與內容對得上),而且目錄裡沒有留下 .tmp', async () => {
    await run([{ text: reply(words(12), '例') }]);
    const calls = vi.mocked(writeFileAtomic).mock.calls.filter(([p]) => String(p) === shortPath());
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe(readFileSync(shortPath(), 'utf8'));
    expect(readdirSync(join(dir, 'cards/security')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('已經有縮短版:覆寫', async () => {
    writeFileSync(shortPath(), 'OLD-SHORT\n');
    await run([{ text: reply(words(12, '新'), '例') }]);
    expect(readFileSync(shortPath(), 'utf8')).not.toContain('OLD-SHORT');
    expect(readShort().body).toBe(words(12, '新'));
  });

  it('寫的內容就是來回檢查組出來的那一份:再讀一次的 body 字數 ≤ 上限(夠短的情況)', async () => {
    await run([{ text: reply(words(LIMIT), '例') }]);
    expect(countWords(readShort().body)).toBeLessThanOrEqual(LIMIT);
  });
});

describe('佇列:離線(本機)的結果', () => {
  it('留下的是本機的一次:檔案標 provisional: true、回 provisional: true、佇列剛好一筆(task、card、prompt、local_sha256 都對)', async () => {
    const text = reply(words(10, '本'), '例');
    const { out, calls } = await run([{ text, provisional: true }]);
    expect(out).toEqual({ kind: 'written', path: shortPath(), provisional: true, attempts: 1 });
    expect(readShort().frontmatter['provisional']).toBe(true);
    const entries = await queue.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ task: 'reteach.short', card: CARD_ID, prompt: calls[0]!.prompt, local_sha256: sha(text) });
  });

  it('三次都是本機、留下的是第 1 次(21 字,另兩次 30、28):佇列只有一筆,記的是第 1 次的 prompt 與回應,不是最後一次的', async () => {
    const t1 = reply(words(21, '壹'), '例');
    const t2 = reply(words(30, '貳'), '例');
    const t3 = reply(words(28, '參'), '例');
    const { out, calls } = await run([{ text: t1, provisional: true }, { text: t2, provisional: true }, { text: t3, provisional: true }]);
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ kind: 'written', provisional: true, attempts: 3 });
    expect(readShort().body).toBe(words(21, '壹'));
    const entries = await queue.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.local_sha256).toBe(sha(t1));
    expect(entries[0]!.local_sha256).not.toBe(sha(t3));
    expect(entries[0]!.prompt).toBe(calls[0]!.prompt);
  });

  it('第一次雲端太長(25)、第二次本機夠短 → 留下本機的:檔標 provisional、佇列記第 2 次的回應與 prompt', async () => {
    const t2 = reply(words(10, '本'), '例');
    const { out, calls } = await run([{ text: reply(words(25, '雲'), '例') }, { text: t2, provisional: true }]);
    expect(out).toMatchObject({ kind: 'written', provisional: true, attempts: 2 });
    expect(readShort().frontmatter['provisional']).toBe(true);
    const entries = await queue.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ local_sha256: sha(t2), prompt: calls[1]!.prompt });
  });

  it('第一次本機太長(25)、第二次雲端夠短 → 留下雲端的:檔不標 provisional、回 provisional: false、佇列沒有東西(本機那次不能漏進去)', async () => {
    const { out } = await run([{ text: reply(words(25, '本'), '例'), provisional: true }, { text: reply(words(10, '雲'), '例') }]);
    expect(out).toMatchObject({ kind: 'written', provisional: false, attempts: 2 });
    expect(readShort().frontmatter['provisional'] === undefined || readShort().frontmatter['provisional'] === false).toBe(true);
    expect(await queue.list()).toEqual([]);
  });

  it('不給 queue:預設用 provisionalQueuePath(learningDir)(state/provisional-queue.json)', async () => {
    const text = reply(words(10, '本'), '例');
    const generateShort = await loadGenerate();
    const { router } = scriptedRouter([{ text, provisional: true }]);
    await generateShort({ learningDir: dir, card: CARD, router, shortLimit: LIMIT, log });
    const real = new ProvisionalQueue({ path: provisionalQueuePath(dir), log });
    const entries = await real.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.local_sha256).toBe(sha(text));
  });

  it('寫檔之後才進佇列:佇列的那一筆存在時,縮短版檔案已經在(用 enqueue 被叫到的當下檢查檔案)', async () => {
    const seen: boolean[] = [];
    const spy = new ProvisionalQueue({ path: provisionalQueuePath(dir), log, now: () => '2026-10-27T01:00:00.000Z' });
    const orig = spy.enqueue.bind(spy);
    spy.enqueue = async (a) => {
      seen.push(existsSync(shortPath()));
      return orig(a);
    };
    await run([{ text: reply(words(10, '本'), '例'), provisional: true }], { queue: spy });
    expect(seen).toEqual([true]);
  });
});

describe('佇列:在線(雲端)的結果', () => {
  it('留下的是雲端的:佇列檔不變(根本沒有)、檔案不標 provisional', async () => {
    const { out } = await run([{ text: reply(words(10), '例') }]);
    expect(out).toMatchObject({ kind: 'written', provisional: false });
    expect(existsSync(provisionalQueuePath(dir))).toBe(false);
    expect(await queue.list()).toEqual([]);
  });

  it('佇列裡本來就有別張卡的一筆:在線生成之後那一筆原封不動', async () => {
    await queue.enqueue({ task: 'grade.apply', card: 'sec-0009', prompt: 'P', localText: 'L' });
    const before = readFileSync(provisionalQueuePath(dir), 'utf8');
    await run([{ text: reply(words(10), '例') }]);
    expect(readFileSync(provisionalQueuePath(dir), 'utf8')).toBe(before);
  });
});

describe('沒有模型(NO_MODEL)', () => {
  const noModel = (): { throw: unknown } => ({ throw: new NoModelError('reteach.short') });

  it('第一次就 NO_MODEL:回 { no-model }、不寫檔、佇列沒動、沒有 warning', async () => {
    const { out, calls } = await run([noModel()]);
    expect(calls).toHaveLength(1);
    expect(out).toEqual({ kind: 'no-model' });
    expect(existsSync(shortPath())).toBe(false);
    expect(existsSync(provisionalQueuePath(dir))).toBe(false);
    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'warning')).toEqual([]);
  });

  it('第 1 次雲端太長、第 2 次 NO_MODEL → 不再試:寫第 1 次的、記 reteach_short_overlong、attempts 是 2(實際呼叫次數)', async () => {
    const { out, calls } = await run([{ text: reply(words(26, '壹'), '例') }, noModel(), { text: reply(words(5), '例') }]);
    expect(calls).toHaveLength(2);
    expect(out).toEqual({ kind: 'written', path: shortPath(), provisional: false, attempts: 2 });
    expect(readShort().body).toBe(words(26, '壹'));
    expect(warnings('reteach_short_overlong')).toHaveLength(1);
  });

  it('第 1 次格式壞、第 2 次 NO_MODEL → 回 no-model、不寫檔、佇列沒動', async () => {
    const { out, calls } = await run([{ text: 'not-json' }, noModel()]);
    expect(calls).toHaveLength(2);
    expect(out).toEqual({ kind: 'no-model' });
    expect(existsSync(shortPath())).toBe(false);
    expect(existsSync(provisionalQueuePath(dir))).toBe(false);
  });

  it('兩次太長(30、24)、第 3 次 NO_MODEL → 從已有的挑最短的(24)、attempts 3', async () => {
    const { out, calls } = await run([{ text: reply(words(30, '甲'), '例') }, { text: reply(words(24, '乙'), '例') }, noModel()]);
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ kind: 'written', attempts: 3 });
    expect(readShort().body).toBe(words(24, '乙'));
    expect(warnings('reteach_short_overlong')).toHaveLength(1);
  });

  it('第 1 次本機太長、第 2 次 NO_MODEL → 留下的是本機的那一次:檔標 provisional、佇列一筆、attempts 2', async () => {
    const t1 = reply(words(26, '本'), '例');
    const { out } = await run([{ text: t1, provisional: true }, noModel()]);
    expect(out).toMatchObject({ kind: 'written', provisional: true, attempts: 2 });
    const entries = await queue.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.local_sha256).toBe(sha(t1));
  });
});

describe('NO_MODEL 以外的錯誤原樣丟出', () => {
  it('第 1 次就丟別的錯:丟出同一個物件(toBe),不寫檔、佇列沒動', async () => {
    const boom = Object.assign(new Error('boom'), { code: 'SOMETHING_ELSE' });
    const generateShort = await loadGenerate();
    const { router } = scriptedRouter([{ throw: boom }]);
    await expect(generateShort({ learningDir: dir, card: CARD, router, shortLimit: LIMIT, queue, log })).rejects.toBe(boom);
    expect(existsSync(shortPath())).toBe(false);
    expect(existsSync(provisionalQueuePath(dir))).toBe(false);
  });

  it('第 1 次雲端太長、第 2 次丟別的錯:丟出同一個物件,已有的第 1 次不寫(整個失敗)、佇列沒動、沒有 overlong warning', async () => {
    const boom = new Error('第二次壞掉');
    const generateShort = await loadGenerate();
    const { router } = scriptedRouter([{ text: reply(words(26), '例'), provisional: true }, { throw: boom }]);
    await expect(generateShort({ learningDir: dir, card: CARD, router, shortLimit: LIMIT, queue, log })).rejects.toBe(boom);
    expect(existsSync(shortPath())).toBe(false);
    expect(existsSync(provisionalQueuePath(dir))).toBe(false);
    expect(warnings('reteach_short_overlong')).toEqual([]);
  });

  it('丟別的錯不算「一次失敗的嘗試」:格式壞一次之後丟別的錯 → 一樣原樣丟,不是 failed', async () => {
    const boom = new TypeError('bug');
    const generateShort = await loadGenerate();
    const { router } = scriptedRouter([{ text: 'not-json' }, { throw: boom }]);
    await expect(generateShort({ learningDir: dir, card: CARD, router, shortLimit: LIMIT, queue, log })).rejects.toBe(boom);
    expect(warnings('reteach_short_bad_response')).toEqual([]);
  });
});

describe('匯出', () => {
  it('grading/index.ts 匯出 generateShort(同一個函式)', async () => {
    const idx = (await import(pathToFileURL(join(import.meta.dirname, 'index.ts')).href)) as { generateShort?: unknown };
    const mod = (await import(pathToFileURL(MODULE).href)) as { generateShort: unknown };
    expect(typeof idx.generateShort).toBe('function');
    expect(idx.generateShort).toBe(mod.generateShort);
  });
});
