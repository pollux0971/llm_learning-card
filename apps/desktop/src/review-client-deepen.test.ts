/**
 * T43(ADR-079):webview 端的複習 client 再多四個教學卡動作。測試 agent 寫;開發 worker 不改。
 * 量法同 `review-client-teach.test.ts`:`@tauri-apps/api/core` 的 invoke 換成 mock,只驗 TS 這一層。
 *
 * 名字由這份測試固定(工單只說「側車多四個動作」,沒給 client 方法名;沿用 teachOpen / teachNext 的命名):
 *   teachDeepen() → method 'teach.deepen',params `{}`
 *   teachPoll()   → method 'teach.poll',params `{}`
 *   teachCancel() → method 'teach.cancel',params `{}`
 *   teachBack()   → method 'teach.back',params `{}`
 * 四個都不帶路徑、卡 id、工作編號(ADR-075 第 3 點:目前那張與工作編號都記在側車裡)。
 * id 跟其他動作共用同一個計數;回應驗證與錯誤轉換跟既有動作一樣;busy 由 client 重試(T40)。
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
  teachDeepen(): Promise<Obj>;
  teachPoll(): Promise<Obj>;
  teachCancel(): Promise<Obj>;
  teachBack(): Promise<Obj>;
  start(): Promise<Obj>;
}
interface ClientModule {
  createReviewClient(opts?: { handler?: (line: string) => Promise<string>; sleep?: (ms: number) => Promise<void>; now?: () => number }): Client;
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

const VIEW = { category: 'security', categories: [], card: null, prereqs: [], from: null, canBack: false, generating: false };

describe('invoke 模式:四個深入動作', () => {
  it('各呼叫一次 invoke("review", { request }):v 1、id 共用同一個計數、method 對、params 一律是空物件', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, VIEW));
    const c = createReviewClient();
    await c.start();
    await c.teachDeepen();
    await c.teachPoll();
    await c.teachCancel();
    await c.teachBack();
    const sent = invokeMock.mock.calls.map((call) => ({ cmd: call[0] as string, request: requestOf(call) }));
    expect(sent.map((s) => s.cmd)).toEqual(Array(5).fill('review'));
    expect(sent.map((s) => s.request)).toEqual([
      { v: 1, id: 1, method: 'start', params: {} },
      { v: 1, id: 2, method: 'teach.deepen', params: {} },
      { v: 1, id: 3, method: 'teach.poll', params: {} },
      { v: 1, id: 4, method: 'teach.cancel', params: {} },
      { v: 1, id: 5, method: 'teach.back', params: {} },
    ]);
  });

  it('四個動作的 params 都沒有任何鍵(沒有路徑、卡 id、工作編號)', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, VIEW));
    const c = createReviewClient();
    for (const act of [() => c.teachDeepen(), () => c.teachPoll(), () => c.teachCancel(), () => c.teachBack()]) await act();
    for (const call of invokeMock.mock.calls) {
      expect(Object.keys(requestOf(call).params as Obj), String(requestOf(call).method)).toEqual([]);
    }
  });

  it('回的是 result 物件原樣(含 from / canBack / generating)', async () => {
    const { createReviewClient } = await mod();
    const view = {
      ...VIEW,
      card: { id: 'sec-0004', path: 'cards/security/sec-0004.md', title: '子卡' },
      from: { id: 'sec-0001', title: '父卡' },
      canBack: true,
      generating: true,
    };
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => okResponse(args.request.id, view));
    const c = createReviewClient();
    expect(await c.teachDeepen()).toEqual(view);
    expect(await c.teachPoll()).toEqual(view);
    expect(await c.teachCancel()).toEqual(view);
    expect(await c.teachBack()).toEqual(view);
  });

  it('側車回三個新種類:ReviewError 的 kind 與固定句子原樣', async () => {
    const { createReviewClient, ReviewError } = await mod();
    const cases: [string, string][] = [
      ['deepen-floor', '這張已經是最深的一層了。'],
      ['no-model', '現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。'],
      ['deepen-failed', '這次沒有產生出能用的卡。可以再按一次「深入這個」。'],
    ];
    for (const [kind, text] of cases) {
      invokeMock.mockReset();
      invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => failResponse(args.request.id, kind, text));
      const err = await createReviewClient()
        .teachPoll()
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(err, kind).toBeInstanceOf(ReviewError);
      expect((err as { kind: string }).kind).toBe(kind);
      expect((err as Error).message).toBe(text);
    }
  });

  it('busy 由 client 重試(T40):teachPoll 與 teachCancel 碰到 busy 重送,不丟給呼叫端', async () => {
    const { createReviewClient } = await mod();
    let n = 0;
    invokeMock.mockImplementation(async (_cmd: string, args: { request: { id: number } }) => {
      n += 1;
      if (n === 1 || n === 3) throw { kind: 'busy', message: '已經有一個請求正在處理。' };
      return okResponse(args.request.id, VIEW);
    });
    const client = createReviewClient({ sleep: async () => undefined });
    await expect(client.teachPoll()).resolves.toBeDefined();
    await expect(client.teachCancel()).resolves.toBeDefined();
    expect(invokeMock).toHaveBeenCalledTimes(4);
  });

  it('回應的 id 對不上:bad-response(四個動作都一樣)', async () => {
    const { createReviewClient } = await mod();
    invokeMock.mockResolvedValue(okResponse(99, VIEW));
    const err = await createReviewClient()
      .teachDeepen()
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect((err as { kind: string }).kind).toBe('bad-response');
  });
});

describe('同程序模式(handler 注入):四個動作送的行跟 invoke 模式一樣', () => {
  it('handler 收到的是 {"v":1,"id":n,"method":"teach.xxx","params":{}} 一行', async () => {
    const { createReviewClient } = await mod();
    const lines: string[] = [];
    const handler = async (line: string): Promise<string> => {
      lines.push(line);
      const id = (JSON.parse(line) as { id: number }).id;
      return JSON.stringify(okResponse(id, VIEW));
    };
    const c = createReviewClient({ handler });
    await c.teachDeepen();
    await c.teachPoll();
    await c.teachCancel();
    await c.teachBack();
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { v: 1, id: 1, method: 'teach.deepen', params: {} },
      { v: 1, id: 2, method: 'teach.poll', params: {} },
      { v: 1, id: 3, method: 'teach.cancel', params: {} },
      { v: 1, id: 4, method: 'teach.back', params: {} },
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
