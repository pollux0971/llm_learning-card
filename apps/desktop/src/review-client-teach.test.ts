/**
 * T37:webview 端的複習 client 多四個教學卡動作(ADR-077)。測試 agent 寫;開發 worker 不改。
 * 跟 `review-client.test.ts` 同一個量法:`@tauri-apps/api/core` 的 invoke 換成 mock,只驗 TS 這一層
 * (command 名、id 遞增、method 與 params、回應驗證、錯誤轉成 ReviewError)。
 *
 * 期待的新匯出(`ReviewClient` 多四個方法,id 跟其他動作共用同一個計數):
 *   teachOpen(category?: string)   → method 'teach.open',params `{}` 或 `{ category }`(沒給就不放那個鍵)
 *   teachNext()                    → method 'teach.next',params `{}`
 *   teachSwitch(category: string)  → method 'teach.switch',params `{ category }`
 *   teachPrereq(index: number)     → method 'teach.prereq',params `{ index }`
 * 其餘(回應驗證、timeout 等 kind 原樣變成 ReviewError.kind)跟既有動作一樣;busy 由 client 自己重試(T40,見 review-client-busy.test.ts)。
 *
 * 模組已經存在,四個方法還沒有:動態 import 後呼叫,基底上是「不是函式」而紅,不是 tsc 錯。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const CLIENT = join(import.meta.dirname, 'webview/review-client.ts');

type Obj = Record<string, unknown>;
interface Client {
  teachOpen(category?: string): Promise<Obj>;
  teachNext(): Promise<Obj>;
  teachSwitch(category: string): Promise<Obj>;
  teachPrereq(index: number): Promise<Obj>;
  start(): Promise<Obj>;
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

const VIEW = { category: 'security', categories: [], card: null, prereqs: [] };

describe('invoke 模式:四個教學卡動作', () => {
  it('各呼叫一次 invoke("review", { request }):v 1、id 跟其他動作共用同一個計數、method 與 params 對', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, VIEW));
    const c = createReviewClient();
    await c.start();
    await c.teachOpen();
    await c.teachOpen('language');
    await c.teachNext();
    await c.teachSwitch('network');
    await c.teachPrereq(2);
    const sent = invokeMock.mock.calls.map((call) => ({ cmd: call[0] as string, request: requestOf(call) }));
    expect(sent.map((s) => s.cmd)).toEqual(Array(6).fill('review'));
    expect(sent.map((s) => s.request)).toEqual([
      { v: 1, id: 1, method: 'start', params: {} },
      { v: 1, id: 2, method: 'teach.open', params: {} },
      { v: 1, id: 3, method: 'teach.open', params: { category: 'language' } },
      { v: 1, id: 4, method: 'teach.next', params: {} },
      { v: 1, id: 5, method: 'teach.switch', params: { category: 'network' } },
      { v: 1, id: 6, method: 'teach.prereq', params: { index: 2 } },
    ]);
  });

  it('teachOpen 沒給類別:params 裡沒有 category 這個鍵(不是 undefined、不是 null)', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, VIEW));
    await createReviewClient().teachOpen();
    const params = requestOf(invokeMock.mock.calls[0]!).params as Obj;
    expect(Object.keys(params)).toEqual([]);
    expect(JSON.stringify(requestOf(invokeMock.mock.calls[0]!))).not.toContain('category');
  });

  it('回的是 result 物件原樣', async () => {
    const { createReviewClient } = await mod();
    const view = { ...VIEW, card: { id: 'sec-0002', path: 'cards/security/sec-0002.md', title: '標題' } };
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, view));
    expect(await createReviewClient().teachNext()).toEqual(view);
  });

  it('側車回 ok:false(例如 teach-record-changed、bad-request):變成 ReviewError,kind 與固定句子原樣', async () => {
    const { createReviewClient, ReviewError } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) =>
      failResponse(args.request.id, 'teach-record-changed', '學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。'),
    );
    const err = await createReviewClient()
      .teachNext()
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ReviewError);
    expect((err as { kind: string }).kind).toBe('teach-record-changed');
    expect((err as Error).message).toBe('學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。');
  });

  it('Rust 的 busy 拒絕不再原樣丟給視窗(T40/ADR-078):client 自己重試,所以 busy 不會變成 ReviewError 到呼叫端', async () => {
    const { createReviewClient } = await mod();
    let n = 0;
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => {
      n += 1;
      if (n === 1) throw { kind: 'busy', message: '已經有一個請求正在處理。' };
      return okResponse(args.request.id, VIEW);
    });
    const client = createReviewClient({ sleep: async () => undefined });
    await expect(client.teachSwitch('language')).resolves.toBeDefined();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('回應的 id 對不上:bad-response', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockResolvedValue(okResponse(99, VIEW));
    await expect(createReviewClient().teachOpen()).rejects.toMatchObject({ kind: 'bad-response' });
  });
});

describe('handler 模式(程序內):行為一樣,不呼叫 invoke', () => {
  it('送出去的那一行就是 { v, id, method, params };不呼叫 invoke', async () => {
    const { createReviewClient } = await mod();
    const lines: string[] = [];
    const client = createReviewClient({
      handler: async (line) => {
        lines.push(line);
        const id = (JSON.parse(line) as { id: number }).id;
        return JSON.stringify(okResponse(id, VIEW));
      },
    });
    await client.teachOpen('language');
    await client.teachPrereq(0);
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { v: 1, id: 1, method: 'teach.open', params: { category: 'language' } },
      { v: 1, id: 2, method: 'teach.prereq', params: { index: 0 } },
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
