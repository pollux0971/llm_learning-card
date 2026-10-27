/**
 * T59 紅測試(單元):provisional 佇列(03-llm-router phase-3)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T59-llm-router-provisional-queue.md。場景那一半在 features/steps/llm-router-phase3.steps.ts。
 *
 * 釘下來的名字(工單說 worker 可以調,紅測試得釘一個):
 *   檔案 packages/core/src/llm/provisional-queue.ts,匯出 ProvisionalQueue、provisionalQueuePath、recordProvisional、型別 ProvisionalEntry;
 *   `new ProvisionalQueue({ path, log, now? })`;enqueue({ task, card, prompt, localText, maxTokens? })、list()、
 *   drain(isOnline)、resolve({ card, task }, { cloudText, changed })。所有方法一律 await(同步或非同步實作都可以)。
 *   index.ts 也要匯出(最後一條測試)。
 * 載入方式:被測模組用動態 import 算出來的 file URL(紅測試在 base 上要 tsc 乾淨,而新檔在 base 上還不存在)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as atomic from '@core/schema/atomic-write.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

vi.mock('@core/schema/atomic-write.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/atomic-write.js')>();
  return { ...real, writeFileAtomic: vi.fn(real.writeFileAtomic) };
});

// ------------------------------------------------------------------ 載入

interface Entry {
  task: string;
  card: string;
  queued_at: string;
  local_sha256: string;
  prompt: string;
  max_tokens?: number;
}
interface QueueLike {
  enqueue(a: { task: LlmTask; card: string; prompt: string; localText: string; maxTokens?: number }): unknown;
  list(): unknown;
  drain(isOnline: () => Promise<boolean>): unknown;
  resolve(key: { card: string; task: LlmTask }, r: { cloudText: string; changed: boolean }): unknown;
}
interface Mod {
  ProvisionalQueue: new (o: { path: string; log: (e: Record<string, unknown>) => void; now?: () => string }) => QueueLike;
  provisionalQueuePath: (learningDir: string) => string;
  recordProvisional: (inner: LlmRouter, queue: QueueLike, card: string) => LlmRouter;
}

const FILE = join(import.meta.dirname, 'provisional-queue.ts');
async function load(): Promise<Mod> {
  expect(existsSync(FILE), 'packages/core/src/llm/provisional-queue.ts 要存在(T59)').toBe(true);
  return (await import(/* @vite-ignore */ pathToFileURL(FILE).href)) as Mod;
}

// ------------------------------------------------------------------ 工具

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const writeSpy = vi.mocked(atomic.writeFileAtomic);

let dir: string;
let events: Record<string, unknown>[];
let clock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-t59-'));
  mkdirSync(join(dir, 'state'), { recursive: true });
  events = [];
  clock = '2026-10-27T09:30:00.123Z';
  writeSpy.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const QPATH = (): string => join(dir, 'state', 'provisional-queue.json');
const bytes = (): string => readFileSync(QPATH(), 'utf8');
const entries = (): Entry[] => JSON.parse(bytes()) as Entry[];
const stateFiles = (): string[] => readdirSync(join(dir, 'state')).sort();
const backups = (): string[] => stateFiles().filter((f) => f.startsWith('provisional-queue.json.corrupt-'));

async function make(): Promise<{ q: QueueLike; mod: Mod }> {
  const mod = await load();
  const q = new mod.ProvisionalQueue({ path: QPATH(), log: (e) => events.push(e as unknown as Record<string, unknown>), now: () => clock });
  return { q, mod };
}
const add = (q: QueueLike, over: Partial<{ task: LlmTask; card: string; prompt: string; localText: string; maxTokens: number }> = {}) =>
  q.enqueue({ task: 'deepen', card: 'sec-0001', prompt: '原本的 prompt', localText: '本機結果', ...over });

const VALID: Entry = { task: 'deepen', card: 'sec-0001', queued_at: '2026-10-27T01:00:00.000Z', local_sha256: sha('x'), prompt: 'p' };

// ------------------------------------------------------------------ 路徑與項目

describe('T59 路徑與項目的形狀', () => {
  it('provisionalQueuePath(learningDir) = <learningDir>/state/provisional-queue.json', async () => {
    const mod = await load();
    expect(mod.provisionalQueuePath('/x/learning')).toBe(join('/x/learning', 'state', 'provisional-queue.json'));
  });

  it('enqueue 寫出的檔是 JSON 陣列,一筆剛好有 task、card、queued_at、local_sha256、prompt 五個鍵(沒給 maxTokens 就沒有 max_tokens)', async () => {
    const { q } = await make();
    await add(q);
    const list = entries();
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual(['card', 'local_sha256', 'prompt', 'queued_at', 'task']);
    expect(list[0]).toEqual({ task: 'deepen', card: 'sec-0001', queued_at: clock, local_sha256: sha('本機結果'), prompt: '原本的 prompt' });
  });

  it('local_sha256 是本機結果 text 的 UTF-8 sha256(小寫十六進位),不是 prompt 的、不是別的編碼', async () => {
    const { q } = await make();
    await add(q, { localText: '含中文與 emoji 😀 的結果', prompt: '不同的 prompt' });
    expect(entries()[0]!.local_sha256).toBe(sha('含中文與 emoji 😀 的結果'));
    expect(entries()[0]!.local_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('queued_at 用注入的 now();沒注入時是現在的 ISO 8601 時間(含時區)', async () => {
    const mod = await load();
    const q = new mod.ProvisionalQueue({ path: QPATH(), log: () => {} });
    await add(q);
    const t = entries()[0]!.queued_at;
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    expect(Math.abs(Date.parse(t) - Date.now())).toBeLessThan(60_000);
  });

  it('給了 maxTokens 就記 max_tokens(正整數);timeoutMs 不記,項目裡沒有任何 timeout 相關的鍵', async () => {
    const { q } = await make();
    await add(q, { maxTokens: 800 });
    expect(entries()[0]!.max_tokens).toBe(800);
    expect(Object.keys(entries()[0]!).filter((k) => /timeout/i.test(k))).toEqual([]);
  });

  it('同一個 card + task 再放一次:拿掉舊的、放最後;prompt、雜湊、queued_at 換新的;新的沒給 maxTokens 就不留舊的 max_tokens', async () => {
    const { q } = await make();
    await add(q, { prompt: '第一次', localText: '甲', maxTokens: 500 });
    clock = '2026-10-27T10:00:00.000Z';
    await add(q, { prompt: '第二次', localText: '乙' });
    const list = entries();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ task: 'deepen', card: 'sec-0001', queued_at: '2026-10-27T10:00:00.000Z', local_sha256: sha('乙'), prompt: '第二次' });
    expect('max_tokens' in list[0]!).toBe(false);
  });

  it('不同 task 或不同 card 各自一筆;依 queued_at 由舊到新(重複放的那筆移到最後)', async () => {
    const { q } = await make();
    await add(q, { card: 'sec-0001', task: 'deepen' });
    clock = '2026-10-27T09:31:00.000Z';
    await add(q, { card: 'sec-0001', task: 'grade.apply' });
    clock = '2026-10-27T09:32:00.000Z';
    await add(q, { card: 'sec-0002', task: 'deepen' });
    clock = '2026-10-27T09:33:00.000Z';
    await add(q, { card: 'sec-0001', task: 'deepen', prompt: '再來一次' });
    expect(entries().map((e) => `${e.card}/${e.task}`)).toEqual(['sec-0001/grade.apply', 'sec-0002/deepen', 'sec-0001/deepen']);
    expect(entries().map((e) => e.queued_at)).toEqual(['2026-10-27T09:31:00.000Z', '2026-10-27T09:32:00.000Z', '2026-10-27T09:33:00.000Z']);
  });

  it('寫佇列檔走 writeFileAtomic(§11b),而且寫的是佇列檔的路徑', async () => {
    const { q } = await make();
    await add(q);
    const paths = writeSpy.mock.calls.map((c) => String(c[0]));
    expect(paths).toContain(QPATH());
    expect(JSON.parse(readFileSync(QPATH(), 'utf8'))).toHaveLength(1);
  });

  it('新的實例讀同一個路徑:內容一樣(不是只存在記憶體)', async () => {
    const { q, mod } = await make();
    await add(q, { card: 'sec-0001' });
    clock = '2026-10-27T09:31:00.000Z';
    await add(q, { card: 'sec-0002', maxTokens: 300 });
    const q2 = new mod.ProvisionalQueue({ path: QPATH(), log: () => {}, now: () => clock });
    expect(await q2.list()).toEqual(entries());
    expect(await q2.list()).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ list / drain 只讀

describe('T59 list 與 drain:除了修壞檔,不寫檔', () => {
  async function seeded(): Promise<{ q: QueueLike; before: string; mtime: number }> {
    const { q } = await make();
    for (const [i, card] of ['sec-0001', 'sec-0002', 'sec-0003'].entries()) {
      clock = `2026-10-27T09:3${i}:00.000Z`;
      await add(q, { card, prompt: `prompt ${i}` });
    }
    writeSpy.mockClear();
    return { q, before: bytes(), mtime: statSync(QPATH()).mtimeMs };
  }

  it('list() 回目前所有項目的複本;改回傳值不影響佇列;檔案位元組與修改時間不變、沒呼叫 writeFileAtomic', async () => {
    const { q, before, mtime } = await seeded();
    const got = (await q.list()) as Entry[];
    expect(got).toHaveLength(3);
    got.pop();
    got[0]!.prompt = '被改了';
    expect(await q.list()).toHaveLength(3);
    expect(((await q.list()) as Entry[])[0]!.prompt).toBe('prompt 0');
    expect(bytes()).toBe(before);
    expect(statSync(QPATH()).mtimeMs).toBe(mtime);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('在線時 drain() 回所有項目(含 prompt),連呼叫兩次都是 3 筆(不會把項目拿掉);不寫檔', async () => {
    const { q, before, mtime } = await seeded();
    const online = async (): Promise<boolean> => true;
    const first = (await q.drain(online)) as Entry[];
    const second = (await q.drain(online)) as Entry[];
    expect(first.map((e) => e.prompt)).toEqual(['prompt 0', 'prompt 1', 'prompt 2']);
    expect(second).toEqual(first);
    expect(bytes()).toBe(before);
    expect(statSync(QPATH()).mtimeMs).toBe(mtime);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('離線時 drain() 回空陣列;檔案不變;而且連檔都不讀(佇列檔是壞的也不修:沒有備份、沒有 warning)', async () => {
    const { q, before } = await seeded();
    expect(await q.drain(async () => false)).toEqual([]);
    expect(bytes()).toBe(before);
    writeFileSync(QPATH(), '{not json', 'utf8');
    writeSpy.mockClear();
    expect(await q.drain(async () => false)).toEqual([]);
    expect(bytes()).toBe('{not json');
    expect(backups()).toEqual([]);
    expect(events).toEqual([]);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('drain 先問 isOnline();檔案不存在時在線 drain 回 []、不建檔、不記 warning', async () => {
    const { q } = await make();
    let asked = 0;
    expect(
      await q.drain(async () => {
        asked += 1;
        return true;
      }),
    ).toEqual([]);
    expect(asked).toBe(1);
    expect(existsSync(QPATH())).toBe(false);
    expect(events).toEqual([]);
  });
});

// ------------------------------------------------------------------ resolve

describe('T59 resolve', () => {
  it('有那一筆:拿掉、寫檔、記一筆 provisional_resolved(card、task、changed、local_sha256、cloud_sha256),回 true;changed 是呼叫端給的(true 與 false 都試)', async () => {
    for (const changed of [true, false]) {
      events.length = 0;
      rmSync(QPATH(), { force: true });
      const { q } = await make();
      await add(q, { card: 'sec-0001', localText: '本機版' });
      await add(q, { card: 'sec-0002', localText: '另一張' });
      const ok = await q.resolve({ card: 'sec-0001', task: 'deepen' }, { cloudText: '雲端版', changed });
      expect(ok).toBe(true);
      expect(entries().map((e) => e.card)).toEqual(['sec-0002']);
      const resolved = events.filter((e) => e['type'] === 'provisional_resolved');
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({ type: 'provisional_resolved', card: 'sec-0001', task: 'deepen', changed, local_sha256: sha('本機版'), cloud_sha256: sha('雲端版') });
      expect(typeof resolved[0]!['ts']).toBe('string');
      expect(Object.keys(resolved[0]!).sort()).toEqual(['card', 'changed', 'cloud_sha256', 'local_sha256', 'task', 'ts', 'type']);
    }
  });

  it('找不到那一筆(卡不對或 task 不對):回 false,佇列檔位元組與 log 都不變、不寫檔', async () => {
    const { q } = await make();
    await add(q);
    const before = bytes();
    writeSpy.mockClear();
    expect(await q.resolve({ card: 'sec-0009', task: 'deepen' }, { cloudText: 'x', changed: true })).toBe(false);
    expect(await q.resolve({ card: 'sec-0001', task: 'grade.apply' }, { cloudText: 'x', changed: true })).toBe(false);
    expect(bytes()).toBe(before);
    expect(events).toEqual([]);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('同一張卡 deepen 與 grade.apply 各一筆:resolve deepen 只拿掉 deepen,grade.apply 那筆還在(鍵是 card + task,不是只有 card)', async () => {
    const { q } = await make();
    await add(q, { card: 'sec-0001', task: 'deepen', prompt: '深入' });
    clock = '2026-10-27T09:31:00.000Z';
    await add(q, { card: 'sec-0001', task: 'grade.apply', prompt: '批改' });
    expect(await q.resolve({ card: 'sec-0001', task: 'deepen' }, { cloudText: 'c', changed: false })).toBe(true);
    expect(entries().map((e) => `${e.card}/${e.task}`)).toEqual(['sec-0001/grade.apply']);
    expect(entries()[0]!.prompt).toBe('批改');
    expect(events.filter((e) => e['type'] === 'provisional_resolved')).toHaveLength(1);
    expect(await q.resolve({ card: 'sec-0001', task: 'grade.apply' }, { cloudText: 'c', changed: true })).toBe(true);
    expect(entries()).toEqual([]);
  });

  it('resolve 掉最後一筆:檔案剩空陣列 [](不是被刪掉)', async () => {
    const { q } = await make();
    await add(q);
    await q.resolve({ card: 'sec-0001', task: 'deepen' }, { cloudText: 'c', changed: false });
    expect(entries()).toEqual([]);
  });
});

// ------------------------------------------------------------------ 壞檔

describe('T59 壞檔:備份、重建空佇列、記 warning', () => {
  const CORRUPT: Record<string, string> = {
    '不是合法 JSON': '{not json',
    '合法 JSON 但不是陣列': '{}',
    '陣列但少了 prompt(形狀不對)': JSON.stringify([{ task: 'deepen', card: 'sec-0001', queued_at: '2026-10-27T01:00:00.000Z', local_sha256: sha('x') }]),
    '陣列但 card 不是合法的卡片 id': JSON.stringify([{ ...VALID, card: 'not a card id' }]),
    '陣列但 task 不在契約裡': JSON.stringify([{ ...VALID, task: 'ingest.nothing' }]),
    '陣列但裡面有不是物件的東西': JSON.stringify([VALID, 42]),
  };

  for (const [name, content] of Object.entries(CORRUPT)) {
    it(`${name}:list() 回 [];原檔逐位元組備份成 provisional-queue.json.corrupt-<UTC 毫秒>;重建成 [];記一筆 warning(reason、backup 檔名不含路徑)`, async () => {
      const { q } = await make();
      writeFileSync(QPATH(), content, 'utf8');
      expect(await q.list()).toEqual([]);
      expect(backups()).toEqual(['provisional-queue.json.corrupt-20261027T093000123Z']);
      expect(readFileSync(join(dir, 'state', backups()[0]!), 'utf8')).toBe(content);
      expect(bytes()).toBe('[]');
      const warnings = events.filter((e) => e['type'] === 'warning');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ type: 'warning', reason: 'provisional_queue_corrupt', backup: 'provisional-queue.json.corrupt-20261027T093000123Z' });
      expect(String(warnings[0]!['backup'])).toBe(basename(String(warnings[0]!['backup'])));
    });
  }

  it('備份名的時間取自 now():毫秒精度、UTC、格式 YYYYMMDDTHHMMSSmmmZ', async () => {
    const { q } = await make();
    clock = '2027-01-02T03:04:05.006Z';
    writeFileSync(QPATH(), 'oops', 'utf8');
    await q.list();
    expect(backups()).toEqual(['provisional-queue.json.corrupt-20270102T030405006Z']);
  });

  it('壞檔之後做一次會進佇列的本機呼叫:佇列剛好 1 筆(這一次的),沒有舊的;備份還在', async () => {
    const { q } = await make();
    writeFileSync(QPATH(), '{not json', 'utf8');
    await add(q, { card: 'sec-0005' });
    expect(entries().map((e) => e.card)).toEqual(['sec-0005']);
    expect(backups()).toHaveLength(1);
    expect(events.filter((e) => e['type'] === 'warning')).toHaveLength(1);
  });

  it('在線的 drain() 遇到壞檔也會修(備份、重建、warning),回 []', async () => {
    const { q } = await make();
    writeFileSync(QPATH(), '{not json', 'utf8');
    expect(await q.drain(async () => true)).toEqual([]);
    expect(backups()).toHaveLength(1);
    expect(bytes()).toBe('[]');
    expect(events.filter((e) => e['type'] === 'warning')).toHaveLength(1);
  });

  it('resolve 遇到壞檔:也修,回 false', async () => {
    const { q } = await make();
    writeFileSync(QPATH(), '{not json', 'utf8');
    expect(await q.resolve({ card: 'sec-0001', task: 'deepen' }, { cloudText: 'c', changed: false })).toBe(false);
    expect(backups()).toHaveLength(1);
    expect(events.filter((e) => e['type'] === 'warning')).toHaveLength(1);
  });

  it('同一毫秒壞兩次、三次(注入同一個 now()):備份名依序是 …Z、…Z-2、…Z-3;舊的備份內容沒被蓋掉', async () => {
    const { q } = await make();
    const bad = ['first-bad', 'second-bad', 'third-bad'];
    for (const content of bad) {
      writeFileSync(QPATH(), content, 'utf8');
      await q.list();
    }
    const names = backups();
    expect(names).toEqual([
      'provisional-queue.json.corrupt-20261027T093000123Z',
      'provisional-queue.json.corrupt-20261027T093000123Z-2',
      'provisional-queue.json.corrupt-20261027T093000123Z-3',
    ]);
    expect(names.map((n) => readFileSync(join(dir, 'state', n), 'utf8'))).toEqual(bad);
    expect(events.filter((e) => e['type'] === 'warning').map((e) => e['backup'])).toEqual(names);
  });

  it('檔案不存在 = 空佇列:不是壞檔,不備份、不記 warning、list() 不建檔', async () => {
    const { q } = await make();
    expect(await q.list()).toEqual([]);
    expect(existsSync(QPATH())).toBe(false);
    expect(backups()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('檔案正常(含空陣列 [])不被當成壞檔', async () => {
    const { q } = await make();
    writeFileSync(QPATH(), '[]', 'utf8');
    expect(await q.list()).toEqual([]);
    writeFileSync(QPATH(), JSON.stringify([VALID, { ...VALID, card: 'sec-0002', max_tokens: 100 }]), 'utf8');
    expect(await q.list()).toHaveLength(2);
    expect(backups()).toEqual([]);
    expect(events).toEqual([]);
  });
});

// ------------------------------------------------------------------ 包裝 router

function fakeRouter(result: Partial<LlmResult> = {}, opts: { fail?: Error } = {}): { router: LlmRouter; calls: unknown[][]; probes: number[] } {
  const calls: unknown[][] = [];
  const probes = [0, 0];
  const full: LlmResult = { text: '結果', provider: 'anthropic', model: 'm', latency_ms: 7, provisional: false, tokens_in: 3, tokens_out: 4, ...result };
  const router: LlmRouter = {
    async call(task, prompt, o) {
      calls.push([task, prompt, o]);
      if (opts.fail) throw opts.fail;
      return full;
    },
    async probeOnline() {
      probes[0]! += 1;
      return false;
    },
    async probeLocal() {
      probes[1]! += 1;
      return { available: true, models: ['a'] };
    },
  };
  return { router, calls, probes };
}

describe('T59 recordProvisional(包裝 router)', () => {
  it('結果 provisional: true 才放進佇列:task、card、prompt、本機結果雜湊都對;maxTokens 有給就記', async () => {
    const { q, mod } = await make();
    const { router } = fakeRouter({ provisional: true, text: '本機結果甲', provider: 'ollama' });
    const wrapped = mod.recordProvisional(router, q, 'sec-0007');
    await wrapped.call('grade.apply', '批改這個', { maxTokens: 900, timeoutMs: 1000 });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toEqual({ task: 'grade.apply', card: 'sec-0007', queued_at: clock, local_sha256: sha('本機結果甲'), prompt: '批改這個', max_tokens: 900 });
  });

  it('沒給 maxTokens:項目沒有 max_tokens 這個鍵', async () => {
    const { q, mod } = await make();
    const wrapped = mod.recordProvisional(fakeRouter({ provisional: true }).router, q, 'sec-0001');
    await wrapped.call('deepen', 'p');
    expect('max_tokens' in entries()[0]!).toBe(false);
  });

  it('provisional: false(雲端結果)不放進佇列:檔案不存在就還是不存在、存在就位元組不變', async () => {
    const { q, mod } = await make();
    const wrapped = mod.recordProvisional(fakeRouter({ provisional: false }).router, q, 'sec-0001');
    await wrapped.call('deepen', 'p');
    expect(existsSync(QPATH())).toBe(false);
    await add(q, { card: 'sec-0002' });
    const before = bytes();
    await wrapped.call('deepen', 'p');
    expect(bytes()).toBe(before);
  });

  it('本機但不暫定(grade.fill.llm 走閘道、provisional: false)不放進佇列', async () => {
    const { q, mod } = await make();
    const wrapped = mod.recordProvisional(fakeRouter({ provisional: false, provider: 'ollama' }).router, q, 'sec-0001');
    await wrapped.call('grade.fill.llm', 'p');
    expect(existsSync(QPATH())).toBe(false);
  });

  it('回傳值原樣:text、provider、model、latency_ms、provisional、tokens 一個都不改(provisional 為 true 與 false 兩種)', async () => {
    const { q, mod } = await make();
    for (const provisional of [true, false]) {
      const { router } = fakeRouter({ provisional, text: '原樣', provider: 'ollama', model: 'qwen', latency_ms: 123, tokens_in: 1, tokens_out: 2 });
      const out = await mod.recordProvisional(router, q, 'sec-0001').call('deepen', 'p');
      expect(out).toEqual({ text: '原樣', provider: 'ollama', model: 'qwen', latency_ms: 123, provisional, tokens_in: 1, tokens_out: 2 });
    }
  });

  it('把 task、prompt、opts 原樣交給 inner(timeoutMs 與 maxTokens 都在)', async () => {
    const { q, mod } = await make();
    const { router, calls } = fakeRouter({ provisional: true });
    await mod.recordProvisional(router, q, 'sec-0001').call('reteach.short', '重教', { timeoutMs: 1234, maxTokens: 55 });
    expect(calls).toEqual([['reteach.short', '重教', { timeoutMs: 1234, maxTokens: 55 }]]);
  });

  it('inner 丟錯:原樣往外丟(同一個物件),佇列不變', async () => {
    const { q, mod } = await make();
    await add(q, { card: 'sec-0002' });
    const before = bytes();
    const boom = new Error('雲端壞了');
    const wrapped = mod.recordProvisional(fakeRouter({}, { fail: boom }).router, q, 'sec-0001');
    await expect(wrapped.call('deepen', 'p')).rejects.toBe(boom);
    expect(bytes()).toBe(before);
  });

  it('probeOnline、probeLocal 直接委派(回傳值一樣、各呼叫一次)', async () => {
    const { q, mod } = await make();
    const { router, probes } = fakeRouter();
    const wrapped = mod.recordProvisional(router, q, 'sec-0001');
    expect(await wrapped.probeOnline()).toBe(false);
    expect(await wrapped.probeLocal()).toEqual({ available: true, models: ['a'] });
    expect(probes).toEqual([1, 1]);
  });

  it('同一張卡、同一個 task 連呼叫兩次本機:佇列還是一筆,是第二次的', async () => {
    const { q, mod } = await make();
    const wrapped = mod.recordProvisional(fakeRouter({ provisional: true }).router, q, 'sec-0001');
    await wrapped.call('grade.apply', '第一次');
    clock = '2026-10-27T11:00:00.000Z';
    await wrapped.call('grade.apply', '第二次');
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ prompt: '第二次', queued_at: '2026-10-27T11:00:00.000Z' });
  });
});

describe('T59 匯出', () => {
  it('index.ts 匯出 ProvisionalQueue、provisionalQueuePath、recordProvisional', async () => {
    const barrel = (await import(/* @vite-ignore */ pathToFileURL(join(dirname(FILE), 'index.ts')).href)) as Record<string, unknown>;
    for (const name of ['ProvisionalQueue', 'provisionalQueuePath', 'recordProvisional']) {
      expect(typeof barrel[name], `llm/index.ts 要匯出 ${name}`).toBe('function');
    }
  });
});
