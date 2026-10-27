/**
 * T61 紅測試:ingest 遇到格式不對的模型回應,乾淨地失敗、一張都不寫。
 * 工單:docs/tickets/T61-ingest-bad-model-output-fails-clean.md。測試 agent 寫;開發 worker 不改。
 *
 *   1. 新錯誤類別 ModelResponseFormatError(errors.ts):Error 的子類別、name 同名。
 *   2. runIngest:壞 JSON、不是陣列、某一筆欄位型別不對、regenerate 回應壞掉、examples 有非字串元素
 *      → 回 { ok: false, exitCode: 1 },訊息以「模型回應格式不對,沒有寫任何卡:」開頭、只有一行,cards/ 與 state/ 的樹雜湊前後一樣。
 *   3. 子卡:parseChildCandidates 的各種壞回應與非字串 example → generateChildrenForCards 丟 ModelResponseFormatError,不留子卡檔;
 *      runIngestPipeline 把它記成 warning、略過,第 0 層的卡照常。
 *   4. 掃描:第一個檔的回應壞掉、第二個正常 → 第二個照樣處理,失敗清單(message)有第一個。
 *   5. 別的錯照丟:router 丟的一般錯誤(含長得像模型格式錯的訊息)、GraphFileCorruptError、fs 錯誤,runIngest 原樣丟出去。
 *
 * 學習資料夾全部用暫存目錄、假 router;LLM 真呼叫 0。
 * 新類別用動態 import 算出來的 file URL 載入(紅測試在 base 上要 tsc 乾淨,而類別在 base 上還不存在)。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@contracts/index.js';
import type { LlmResult, LlmRouter as CoreRouter } from '@core/llm/index.js';
import { GraphFileCorruptError } from './errors.js';
import { generateChildrenForCards } from './children.js';
import { runIngest, runIngestPipeline } from './ingest.js';
import { loadScan, makeLearning, rawText, treeHash, writeRaw } from './t53-test-support.js';
import type { LlmRouter } from './types.js';

const ERRORS_FILE = join(import.meta.dirname, 'errors.ts');
const PREFIX = '模型回應格式不對,沒有寫任何卡:';

async function loadErrorClass(): Promise<new (message: string) => Error> {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(ERRORS_FILE).href)) as Record<string, unknown>;
  const cls = mod['ModelResponseFormatError'];
  if (typeof cls !== 'function') throw new Error('packages/core/src/ingest/errors.ts 還沒有匯出 ModelResponseFormatError(T61 要新增的錯誤類別)');
  return cls as new (message: string) => Error;
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function learning(): string {
  const d = makeLearning();
  dirs.push(d);
  return d;
}

type Handler = (task: string, prompt: string, callNo: number) => string;
/** 假 router:handler 依 task、prompt、第幾次呼叫回應文字;handler 可以直接丟錯。 */
function routerOf(handler: Handler): LlmRouter & CoreRouter {
  let n = 0;
  return {
    async call(task: string, prompt: string): Promise<LlmResult> {
      n += 1;
      const text = handler(task, prompt, n);
      return { text, provider: 'anthropic', model: 'test-model', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  } as unknown as LlmRouter & CoreRouter;
}

const GOOD = (title: string, extra: Record<string, unknown> = {}) => ({ title, body: `${title} 的正文內容。`, examples: [] as unknown[], lines: [1, 2], ...extra });
const cardsJson = (...cards: unknown[]): string => JSON.stringify(cards);

function snapshot(dir: string): { cards: string; state: string } {
  return { cards: treeHash(join(dir, 'cards')), state: treeHash(join(dir, 'state')) };
}

function mdFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(d, name.name));
      else if (name.name.endsWith('.md')) out.push(join(d, name.name));
    }
  };
  walk(dir);
  return out;
}

async function ingest(dir: string, router: LlmRouter, name = 'x.md') {
  writeRaw(dir, 'security', name, rawText('t61'));
  const before = snapshot(dir);
  const result = await runIngest({ outDir: dir, rawRelPath: `raw/security/${name}`, category: 'security', router });
  return { result, before, after: snapshot(dir) };
}

function expectCleanFailure(r: Awaited<ReturnType<typeof ingest>>, mustInclude: string): void {
  expect(r.result.ok).toBe(false);
  expect(r.result.exitCode).toBe(1);
  expect(r.result.cardsCreated).toEqual([]);
  expect(r.result.message.startsWith(PREFIX), `訊息:${r.result.message}`).toBe(true);
  expect(r.result.message.includes('\n'), `訊息只能有一行:${JSON.stringify(r.result.message)}`).toBe(false);
  expect(r.result.message, '訊息帶著原本的說明').toContain(mustInclude);
  expect(r.after, 'cards/ 與 state/ 前後一樣').toEqual(r.before);
}

describe('T61 新錯誤類別', () => {
  it('ModelResponseFormatError 是 Error 的子類別,name 是同名字串,訊息原樣帶著', async () => {
    const Cls = await loadErrorClass();
    const e = new Cls('壞了');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ModelResponseFormatError');
    expect(e.message).toBe('壞了');
  });
});

describe('T61 runIngest:壞的模型回應 → ok:false、一張都不寫', () => {
  it('不是合法 JSON:訊息只留第一行(原本的 JSON.parse 錯誤訊息裡有換行)', async () => {
    const r = await ingest(learning(), routerOf(() => '這不是 JSON\n第二行'));
    expectCleanFailure(r, 'ingest.cards 回應不是合法 JSON');
  });

  it('不是陣列', async () => {
    const r = await ingest(learning(), routerOf(() => JSON.stringify({ title: '卡' })));
    expectCleanFailure(r, 'ingest.cards 回應必須是陣列');
  });

  it('某一筆欄位型別不對(title 不是字串)', async () => {
    const r = await ingest(learning(), routerOf(() => cardsJson(GOOD('好卡'), GOOD('壞卡', { title: 7 }))));
    expectCleanFailure(r, 'ingest.cards 回應第 1 筆格式不正確');
  });

  it('某一筆 lines 不是兩個元素', async () => {
    const r = await ingest(learning(), routerOf(() => cardsJson(GOOD('壞卡', { lines: [1] }))));
    expectCleanFailure(r, '格式不正確');
  });

  it('regenerate 的回應壞掉(第一次回超過 100 字的卡,重寫回壞 JSON):ok:false,一張都不寫', async () => {
    const r = await ingest(
      learning(),
      routerOf((_t, _p, n) => (n === 1 ? cardsJson(GOOD('長卡', { body: '超'.repeat(150) })) : '重寫失敗,這不是 JSON\n第二行')),
    );
    expectCleanFailure(r, 'regenerate 回應不是合法 JSON');
  });

  it('regenerate 的回應不是陣列、沒有卡片', async () => {
    for (const [text, expected] of [
      [JSON.stringify({ body: 'x' }), 'regenerate 回應必須是陣列'],
      ['[]', 'regenerate 回應沒有回傳卡片'],
    ] as const) {
      const r = await ingest(
        learning(),
        routerOf((_t, _p, n) => (n === 1 ? cardsJson(GOOD('長卡', { body: '超'.repeat(150) })) : text)),
      );
      expectCleanFailure(r, expected);
    }
  });

  it('examples 有非字串元素(第二筆是 [42]):整批當格式不對,第一張卡也沒寫,ingested.json 沒有這個檔', async () => {
    const dir = learning();
    const r = await ingest(dir, routerOf(() => cardsJson(GOOD('好卡'), GOOD('壞卡', { examples: [42] }))));
    expectCleanFailure(r, '格式不正確');
    expect(mdFiles(join(dir, 'cards')), 'cards/ 一張都沒有').toEqual([]);
    const ingestedPath = join(dir, 'state/ingested.json');
    const recorded = existsSync(ingestedPath) ? (JSON.parse(readFileSync(ingestedPath, 'utf8')) as Record<string, unknown>) : {};
    expect(Object.keys(recorded), 'ingested.json 不能記這個檔').toEqual([]);
  });

  it('examples 的各種非字串元素:null、物件、巢狀陣列、布林、混合', async () => {
    for (const bad of [[null], [{ a: 1 }], [['x']], [true], ['ok', 3], [undefined as unknown as string]]) {
      const dir = learning();
      const r = await ingest(dir, routerOf(() => cardsJson(GOOD('壞卡', { examples: bad }))));
      expectCleanFailure(r, '格式不正確');
      expect(mdFiles(join(dir, 'cards')), JSON.stringify(bad)).toEqual([]);
    }
  });

  it('examples 全是字串(含空陣列、空字串)的好回應照常寫卡(守住不誤殺)', async () => {
    const dir = learning();
    const r = await ingest(dir, routerOf(() => cardsJson(GOOD('甲', { examples: [] }), GOOD('乙', { examples: ['', 'a', '```x```'] }))));
    expect(r.result.ok).toBe(true);
    expect(r.result.cardsCreated).toHaveLength(2);
    expect(mdFiles(join(dir, 'cards'))).toHaveLength(2);
  });

  it('runIngestPipeline 也一樣回 ok:false(CLI 單檔路徑走這條),沒有丟錯', async () => {
    const dir = learning();
    writeRaw(dir, 'security', 'p.md', rawText('p'));
    const before = snapshot(dir);
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: 'raw/security/p.md', category: 'security', router: routerOf(() => 'not json') });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message.startsWith(PREFIX)).toBe(true);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('T61 子卡:壞回應與非字串 example → 丟 ModelResponseFormatError,不留子卡檔', () => {
  function parentSetup(): { dir: string; parent: Card } {
    const dir = learning();
    const id = 'sec-0001';
    mkdirSync(join(dir, 'cards', 'security'), { recursive: true });
    writeFileSync(
      join(dir, 'cards/security', `${id}.md`),
      ['---', `id: ${id}`, 'category: security', 'title: 父卡', 'level: 0', 'source: raw', 'created: 2026-09-01', '---', '', '父卡內容'].join('\n'),
      'utf8',
    );
    const parent: Card = {
      frontmatter: { id, category: 'security', title: '父卡', level: 0, source: 'raw', created: '2026-09-01', source_ref: 'raw/security/x.md#L1-L2', prereqs: [], provisional: false, stale: false, source_missing: false },
      body: '父卡內容',
      examples: [],
    } as Card;
    return { dir, parent };
  }
  const child = (title: string, extra: Record<string, unknown> = {}) => ({ title, body: `${title} 的細節說明。`, examples: [] as unknown[], ...extra });

  it('各種壞回應都丟 ModelResponseFormatError,訊息不變,cards/ 前後一樣', async () => {
    const Cls = await loadErrorClass();
    const cases: [string, string, string][] = [
      ['不是 JSON', 'oops', 'ingest.cards(子卡)回應不是合法 JSON'],
      ['不是陣列', JSON.stringify({ a: 1 }), 'ingest.cards(子卡)回應必須是陣列'],
      ['筆數 0', '[]', '筆數必須介於'],
      ['筆數太多', JSON.stringify(Array.from({ length: 9 }, (_, i) => child(`子${i}`))), '筆數必須介於'],
      ['欄位型別不對', JSON.stringify([child('甲'), child('乙', { body: 5 })]), '回應第 1 筆格式不正確'],
    ];
    for (const [name, text, expected] of cases) {
      const { dir, parent } = parentSetup();
      const before = treeHash(join(dir, 'cards'));
      const err = await generateChildrenForCards([parent], routerOf(() => text), { outDir: dir }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, name).toBeInstanceOf(Cls);
      expect((err as Error).name, name).toBe('ModelResponseFormatError');
      expect((err as Error).message, name).toContain(expected);
      expect(treeHash(join(dir, 'cards')), `${name}:cards/ 不變`).toBe(before);
    }
  });

  it('第二筆 examples 有非字串元素:第一張子卡也沒寫(檢查在寫任何檔之前)', async () => {
    const Cls = await loadErrorClass();
    for (const bad of [[42], [null], [{ a: 1 }], ['ok', 1]]) {
      const { dir, parent } = parentSetup();
      const err = await generateChildrenForCards([parent], routerOf(() => JSON.stringify([child('甲'), child('乙', { examples: bad })])), { outDir: dir }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, JSON.stringify(bad)).toBeInstanceOf(Cls);
      expect(mdFiles(join(dir, 'cards')).map((f) => f.split('/').pop()), JSON.stringify(bad)).toEqual(['sec-0001.md']);
    }
  });

  it('runIngestPipeline:第二個子卡的 examples 壞掉(第一個是好的)→ 記一筆「子卡產生失敗,已略過」warning,第 0 層的卡照常,不留子卡檔(好的那個也不留)', async () => {
    const dir = learning();
    writeRaw(dir, 'security', 'c.md', rawText('c'));
    const router = routerOf((_task, prompt) => {
      if (prompt.includes('parent_id:')) return JSON.stringify([child('好子卡'), child('壞子卡', { examples: [42] })]);
      if (/^card:\s*\S+$/m.test(prompt)) return 'no questions';
      if (/^cards:$/m.test(prompt)) return JSON.stringify({ edges: [] });
      return cardsJson(GOOD('第零層'));
    });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: 'raw/security/c.md', category: 'security', router });
    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(1);
    expect(result.childrenCreated).toEqual([]);
    expect(mdFiles(join(dir, 'cards')), '只有第 0 層的一張卡').toHaveLength(1);
    const log = readFileSync(join(dir, 'state/log.jsonl'), 'utf8');
    expect(log).toContain('子卡產生失敗,已略過');
  });
});

describe('T61 掃描:一個檔的回應壞掉,後面的檔照樣處理', () => {
  it('兩個新 raw 檔:a-bad 回壞 JSON、b-good 正常 → b-good 的卡寫了、進 ingested.json;失敗清單有 a-bad;掃描沒有丟錯', async () => {
    const scan = await loadScan();
    const dir = learning();
    writeRaw(dir, 'security', 'a-bad.md', rawText('a-bad'));
    writeRaw(dir, 'security', 'b-good.md', rawText('b-good'));
    const router = routerOf((_t, prompt) => (prompt.includes('a-bad.md') ? '壞掉的回應\n第二行' : cardsJson(GOOD('好卡'))));
    const result = await scan({ outDir: dir, router, category: 'security', today: '2026-09-01', levelZeroOnly: true });

    expect(result.processed).toEqual(['raw/security/b-good.md']);
    expect(result.message, '失敗清單有 a-bad').toContain('raw/security/a-bad.md');
    expect(result.message).toContain('模型回應格式不對');
    expect(mdFiles(join(dir, 'cards'))).toHaveLength(1);
    const recorded = Object.keys(JSON.parse(readFileSync(join(dir, 'state/ingested.json'), 'utf8')) as Record<string, unknown>);
    expect(recorded).toEqual(['raw/security/b-good.md']);
  });

  it('非字串 example 的檔排在前面,一樣不擋後面的檔', async () => {
    const scan = await loadScan();
    const dir = learning();
    writeRaw(dir, 'security', 'a-bad.md', rawText('a-bad'));
    writeRaw(dir, 'security', 'b-good.md', rawText('b-good'));
    const router = routerOf((_t, prompt) => cardsJson(GOOD(prompt.includes('a-bad.md') ? '壞卡' : '好卡', prompt.includes('a-bad.md') ? { examples: [1] } : {})));
    const result = await scan({ outDir: dir, router, category: 'security', today: '2026-09-01', levelZeroOnly: true });
    expect(result.processed).toEqual(['raw/security/b-good.md']);
    expect(mdFiles(join(dir, 'cards'))).toHaveLength(1);
  });
});

describe('T61 別的錯照丟(不能被吞成失敗)', () => {
  async function rejection(error: Error): Promise<unknown> {
    const dir = learning();
    writeRaw(dir, 'security', 'x.md', rawText('x'));
    return runIngest({
      outDir: dir,
      rawRelPath: 'raw/security/x.md',
      category: 'security',
      router: routerOf(() => {
        throw error;
      }),
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
  }

  it('router 丟的一般錯誤:原樣丟出來(同一個物件,堆疊還在)', async () => {
    const boom = new Error('boom');
    expect(await rejection(boom)).toBe(boom);
  });

  it('router 丟的錯誤,訊息長得像模型格式錯,但不是 ModelResponseFormatError:照丟', async () => {
    const lookalike = new Error('ingest.cards 回應不是合法 JSON: 假的');
    expect(await rejection(lookalike)).toBe(lookalike);
  });

  it('GraphFileCorruptError 照丟', async () => {
    const corrupt = new GraphFileCorruptError('/x/deps.json', '{', new Error('bad'));
    expect(await rejection(corrupt)).toBe(corrupt);
  });

  it('fs 錯誤(帶 code)照丟', async () => {
    const fsErr = Object.assign(new Error("EACCES: permission denied, open '/x'"), { code: 'EACCES' });
    expect(await rejection(fsErr)).toBe(fsErr);
  });
});
