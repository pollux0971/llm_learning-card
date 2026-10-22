/**
 * T22 驗收 6:webview 端的複習 client(`apps/desktop/src/webview/review-client.ts`)。
 * 紅測試作者寫;開發 worker 不改。`@tauri-apps/api/core` 的 invoke 換成 mock:這裡只驗 TS 這一層
 * (command 名、id 遞增、回應驗證、錯誤轉成 ReviewError),Rust 那一層由 src-tauri/tests/review_sidecar.rs 驗。
 *
 * 期待的匯出(工單驗收 6):
 *   createReviewClient({ invoke?, handler? }) → { start, next, submit, status, summary }
 *     invoke 預設是 `@tauri-apps/api/core` 的 invoke:`invoke('review', { request })`;
 *     handler 有給時改走程序內(收一行字串、回一行字串),行為一樣,不呼叫 invoke
 *   ReviewError extends Error,有 `.kind`
 * request 的形狀是 `{ v: 1, id, method, params }`;id 由 client 自己從 1 往上數(每一次呼叫一個,失敗也算)。
 * 回應用 protocol.ts 的 schema 驗;`ok: false`、Rust 的 `Err({ kind })`、回應不合、id 不符都轉成 ReviewError。
 *
 * 模組還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isNodeModule, REPO_ROOT, scanImportGraph } from './test-support/import-scan.js';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const CLIENT = join(import.meta.dirname, 'webview/review-client.ts');

type Obj = Record<string, unknown>;
interface Client {
  start(): Promise<Obj>;
  next(): Promise<Obj>;
  submit(answer: { fill: string[] } | { apply: string }): Promise<Obj>;
  summary(): Promise<Obj>;
  status(): Promise<Obj>;
}
interface ClientModule {
  createReviewClient(opts?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>; handler?: (line: string) => Promise<string>; sleep?: (ms: number) => Promise<void>; now?: () => number }): Client;
  ReviewError: new (...args: never[]) => Error & { kind: string };
}
async function mod(): Promise<ClientModule> {
  return (await import(/* @vite-ignore */ pathToFileURL(CLIENT).href)) as ClientModule;
}

beforeEach(() => {
  invokeMock.mockReset();
});

const okResponse = (id: number, result: Obj = {}): Obj => ({ v: 1, id, ok: true, result });
const failResponse = (id: number | null, kind: string, message = '固定句子。'): Obj => ({ v: 1, id, ok: false, error: { kind, message } });
const requestOf = (call: unknown[]): Obj => (call[1] as { request: Obj }).request;

describe('invoke 模式(預設走 Tauri 的 invoke)', () => {
  it('五個動作各呼叫一次 invoke("review", { request }):v 1、id 從 1 起每次加一、method 與 params 對;submit 的答案原樣放進 params', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, { echoed: true }));
    const c = createReviewClient();
    await c.start();
    await c.next();
    await c.submit({ fill: ['協定', '主機,含逗號'] });
    await c.submit({ apply: '一段\n回答' });
    await c.summary();
    await c.status();
    const sent = invokeMock.mock.calls.map((call) => ({ cmd: call[0] as string, request: requestOf(call) }));
    expect(sent.map((s) => s.cmd)).toEqual(Array(6).fill('review'));
    expect(sent.map((s) => s.request)).toEqual([
      { v: 1, id: 1, method: 'start', params: {} },
      { v: 1, id: 2, method: 'next', params: {} },
      { v: 1, id: 3, method: 'submit', params: { fill: ['協定', '主機,含逗號'] } },
      { v: 1, id: 4, method: 'submit', params: { apply: '一段\n回答' } },
      { v: 1, id: 5, method: 'summary', params: {} },
      { v: 1, id: 6, method: 'status', params: {} },
    ]);
  });

  it('成功時回 result(原樣)', async () => {
    const { createReviewClient } = await mod();
    const result = { state: 'ready', today: '2026-09-10', resumed: false, total: 3, answered: 0, deferred: 0, dailyCap: 10, fakeCloud: false };
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, result));
    expect(await createReviewClient().start()).toEqual(result);
  });

  it('request 沒有路徑與卡 id 之類的欄位:信封只有 v、id、method、params,params 在 start / next / summary / status 是空物件', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id));
    const c = createReviewClient();
    for (const call of [() => c.start(), () => c.next(), () => c.summary(), () => c.status()]) await call();
    for (const call of invokeMock.mock.calls) {
      const req = requestOf(call);
      expect(Object.keys(req).sort()).toEqual(['id', 'method', 'params', 'v']);
      expect(req.params).toEqual({});
    }
  });

  it('側車的業務錯誤(ok:false)→ 丟 ReviewError,kind 與 message 原樣', async () => {
    const { createReviewClient, ReviewError } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => failResponse(args.request.id, 'no-session', '還沒有開始今天的複習。'));
    const err = await createReviewClient().next().then(
      () => {
        throw new Error('應該丟錯');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ReviewError);
    expect(err).toBeInstanceOf(Error);
    expect((err as { kind: string }).kind).toBe('no-session');
    expect((err as Error).message).toBe('還沒有開始今天的複習。');
  });

  it('Rust 自己的錯誤(invoke 被拒絕,值是 { kind })→ 丟 ReviewError,kind 原樣', async () => {
    const { createReviewClient, ReviewError } = await mod();
    // T40:busy 不在這裡 —— client 會重試它(見 review-client-busy.test.ts);沒有 message 的拒絕,message 是 ERROR_MESSAGES 的句子
    for (const kind of ['timeout', 'sidecar-exited', 'sidecar-unavailable', 'not-configured', 'bad-envelope', 'bad-response']) {
      invokeMock.mockReset();
      invokeMock.mockRejectedValue({ kind });
      const err = await createReviewClient().status().then(
        () => {
          throw new Error('應該丟錯');
        },
        (e: unknown) => e,
      );
      expect(err, kind).toBeInstanceOf(ReviewError);
      expect((err as { kind: string }).kind, kind).toBe(kind);
      expect((err as Error).message, `${kind} 的 message 不能是 kind 本身`).not.toBe(kind);
      expect((err as Error).message, kind).toMatch(/[^\x00-\x7f]/);
    }
  });

  it('invoke 被拒絕但值不是 { kind }(字串、null):仍是 ReviewError,kind 是非空字串', async () => {
    const { createReviewClient, ReviewError } = await mod();
    for (const rejection of ['boom', null, 42]) {
      invokeMock.mockReset();
      invokeMock.mockRejectedValue(rejection);
      const err = await createReviewClient().status().then(
        () => {
          throw new Error('應該丟錯');
        },
        (e: unknown) => e,
      );
      expect(err, String(rejection)).toBeInstanceOf(ReviewError);
      expect(typeof (err as { kind: unknown }).kind).toBe('string');
      expect((err as { kind: string }).kind.length).toBeGreaterThan(0);
    }
  });

  it('回應 id 跟請求不符(舊回應):不當成答案,丟 ReviewError', async () => {
    const { createReviewClient, ReviewError } = await mod();
    invokeMock.mockResolvedValue(okResponse(999, { stale: true }));
    await expect(createReviewClient().status()).rejects.toBeInstanceOf(ReviewError);
  });

  it('回應不合 schema(多欄位、v 2、不是物件、缺 result):丟 ReviewError', async () => {
    const { createReviewClient, ReviewError } = await mod();
    const bads: unknown[] = [
      { v: 1, id: 1, ok: true, result: {}, extra: 1 },
      { v: 2, id: 1, ok: true, result: {} },
      'not an object',
      null,
      { v: 1, id: 1, ok: true },
      { v: 1, id: 1, ok: false, error: { kind: 'x', message: 'y', stack: 'z' } },
    ];
    for (const bad of bads) {
      invokeMock.mockReset();
      invokeMock.mockResolvedValue(bad);
      await expect(createReviewClient().status(), JSON.stringify(bad)).rejects.toBeInstanceOf(ReviewError);
    }
  });

  it('id 每次呼叫加一,失敗的呼叫也算(不重用同一個 id)', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockRejectedValueOnce({ kind: 'timeout' });
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id));
    const c = createReviewClient();
    await expect(c.status()).rejects.toBeDefined();
    await c.status();
    expect(invokeMock.mock.calls.map((call) => requestOf(call).id)).toEqual([1, 2]);
  });

  it('同時發兩個呼叫:id 不同(1 與 2),各自拿到自己的回應', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, { mine: args.request.id }));
    const c = createReviewClient();
    const [a, b] = await Promise.all([c.status(), c.status()]);
    expect([a.mine, b.mine].sort()).toEqual([1, 2]);
  });

  it('每個 client 自己數 id,各從 1 起', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id));
    await createReviewClient().status();
    await createReviewClient().status();
    expect(invokeMock.mock.calls.map((call) => requestOf(call).id)).toEqual([1, 1]);
  });

  it('給了自己的 invoke 就用它,不用 Tauri 的', async () => {
    const { createReviewClient } = await mod();
    const mine = vi.fn(async (_cmd: string, args?: Record<string, unknown>) => okResponse((args as { request: { id: number } }).request.id, { from: 'mine' }));
    expect(await createReviewClient({ invoke: mine }).status()).toEqual({ from: 'mine' });
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine.mock.calls[0]![0]).toBe('review');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('handler 模式(程序內:測試與 T24 的單獨執行用)', () => {
  it('handler 收到的是一行 JSON(不含換行)的請求,回的是一行 JSON;行為跟 invoke 模式一樣;不呼叫 invoke', async () => {
    const { createReviewClient } = await mod();
    const seen: string[] = [];
    const handler = async (line: string): Promise<string> => {
      seen.push(line);
      const req = JSON.parse(line) as { id: number };
      return JSON.stringify(okResponse(req.id, { via: 'handler' }));
    };
    const c = createReviewClient({ handler });
    expect(await c.status()).toEqual({ via: 'handler' });
    expect(await c.submit({ apply: 'x' })).toEqual({ via: 'handler' });
    expect(seen.every((l) => !l.includes('\n'))).toBe(true);
    expect(seen.map((l) => JSON.parse(l))).toEqual([
      { v: 1, id: 1, method: 'status', params: {} },
      { v: 1, id: 2, method: 'submit', params: { apply: 'x' } },
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('handler 回 ok:false → ReviewError(kind);handler 回的不是合法回應 / id 不符 → ReviewError', async () => {
    const { createReviewClient, ReviewError } = await mod();
    const fail = createReviewClient({ handler: async (line) => JSON.stringify(failResponse((JSON.parse(line) as { id: number }).id, 'paused')) });
    const e1 = await fail.next().then(
      () => {
        throw new Error('應該丟錯');
      },
      (e: unknown) => e,
    );
    expect(e1).toBeInstanceOf(ReviewError);
    expect((e1 as { kind: string }).kind).toBe('paused');
    await expect(createReviewClient({ handler: async () => 'not json' }).status()).rejects.toBeInstanceOf(ReviewError);
    await expect(createReviewClient({ handler: async () => JSON.stringify(okResponse(5)) }).status()).rejects.toBeInstanceOf(ReviewError);
  });

  it('同時給 handler 與 invoke:走 handler', async () => {
    const { createReviewClient } = await mod();
    const mine = vi.fn(async () => okResponse(1));
    const handler = vi.fn(async (line: string) => JSON.stringify(okResponse((JSON.parse(line) as { id: number }).id, { via: 'handler' })));
    expect(await createReviewClient({ invoke: mine, handler }).status()).toEqual({ via: 'handler' });
    expect(mine).not.toHaveBeenCalled();
  });
});

describe('webview 的 import 規則與邊界登記(驗收 6)', () => {
  it('review-client.ts 與它 import 的每一個檔(含 protocol.ts)都沒有 node: 模組;預設用 @tauri-apps/api/core', () => {
    const graph = scanImportGraph(CLIENT);
    expect(graph.files[0]).toBe('apps/desktop/src/webview/review-client.ts');
    expect(graph.files).toContain('packages/core/src/session/protocol.ts');
    expect(graph.imports.filter((i) => i.spec.startsWith('UNRESOLVED:'))).toEqual([]);
    expect(graph.imports.filter((i) => isNodeModule(i.spec))).toEqual([]);
    expect(graph.imports.map((i) => i.spec)).toContain('@tauri-apps/api/core');
  });

  it('webview 不拉 session 的其他檔(engine、handler、io 都會碰 node:fs):import 圖裡只准 protocol.ts', () => {
    const graph = scanImportGraph(CLIENT);
    const sessionFiles = graph.files.filter((f) => f.startsWith('packages/core/src/session/'));
    expect(sessionFiles).toEqual(['packages/core/src/session/protocol.ts']);
  });

  it('scripts/boundaries.allow.json 有一條 10-desktop-shell → 11-review-cli,理由提到 ADR-075', () => {
    const entries = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/boundaries.allow.json'), 'utf8')) as { from: string; to: string; reason: string }[];
    const hit = entries.filter((e) => e.from === '10-desktop-shell' && e.to === '11-review-cli');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.reason).toContain('ADR-075');
  });
});
