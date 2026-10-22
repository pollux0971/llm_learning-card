/**
 * T40(ADR-078):共用 ReviewClient 的 `busy` 重試、等候通知、放棄、固定字樣。測試 agent 寫;開發 worker 不改。
 * 兩個視窗(考試卡、教學卡)共用同一個 client,重試只有這一條路;Rust 不排隊,忙時回 `{ kind: 'busy' }`。
 *
 * 期待的匯出(`apps/desktop/src/webview/review-client.ts`):
 *   BUSY_RETRY_MS = 300,BUSY_NOTICE_AFTER_MS = 1000,BUSY_GIVE_UP_MS = 180_000(要跟 review_sidecar.rs 的 REQUEST_TIMEOUT 一樣)
 *   createReviewClient({ invoke?, handler?, sleep?, now? })     sleep / now 是測試用的假時鐘;預設 setTimeout / Date.now
 *   ReviewError(kind, message, unsent = false)                  多一個 `readonly unsent: boolean`
 *   ReviewClient.onWait(listener: (waiting: boolean) => void): () => void      回傳取消訂閱
 *   reviewErrorText(err: unknown): string                       ReviewError 依 kind 查 ERROR_MESSAGES;不認得的 kind、非 ReviewError → internal 那一句
 *
 * 行為:
 *   - 任何動作收到 Rust 的 busy:睡 BUSY_RETRY_MS,用**新的 webview id**(client 自己的計數器再加一)重送同一個動作與參數;
 *   - 從第一次送出算起超過 BUSY_NOTICE_AFTER_MS 通知一次 onWait(true);結束(成功、別的錯誤、放棄)時若通知過就通知 onWait(false) 一次;
 *   - 一直 busy 到 BUSY_GIVE_UP_MS:停止重送,丟 ReviewError('timeout', ERROR_MESSAGES.timeout, unsent = true);
 *   - 只有 busy 會重試;其他種類直接丟,unsent 是 false;
 *   - Rust 的拒絕沒有 message:message 是 ERROR_MESSAGES 的句子(不是 kind 本身);有 message 就原樣。
 *
 * 假時鐘:`sleep(ms)` 把時鐘往前撥 ms 並立刻回來;`invoke` 可以指定「這一次花多久」。不起計時器、不碰 Tauri。
 * 模組的新匯出還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const ROOT = join(import.meta.dirname, '../../..');
const CLIENT = pathToFileURL(join(import.meta.dirname, 'webview/review-client.ts')).href;
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

type Obj = Record<string, unknown>;
type Rejection = Error & { kind: string; unsent?: boolean };
interface Client {
  start(): Promise<Obj>;
  next(): Promise<Obj>;
  submit(answer: { fill: string[] } | { apply: string }): Promise<Obj>;
  summary(): Promise<Obj>;
  status(): Promise<Obj>;
  teachOpen(category?: string): Promise<Obj>;
  teachNext(): Promise<Obj>;
  teachSwitch(category: string): Promise<Obj>;
  teachPrereq(index: number): Promise<Obj>;
  onWait(listener: (waiting: boolean) => void): () => void;
}
interface ClientModule {
  createReviewClient(opts?: Obj): Client;
  ReviewError: new (kind: string, message: string, unsent?: boolean) => Rejection;
  reviewErrorText(err: unknown): string;
  BUSY_RETRY_MS: number;
  BUSY_NOTICE_AFTER_MS: number;
  BUSY_GIVE_UP_MS: number;
}
interface ProtocolModule {
  ERROR_KINDS: readonly string[];
  ERROR_MESSAGES: Record<string, string>;
}
const mod = async (): Promise<ClientModule> => (await import(/* @vite-ignore */ CLIENT)) as ClientModule;
const protocol = async (): Promise<ProtocolModule> => (await import(/* @vite-ignore */ PROTOCOL)) as ProtocolModule;

/** 劇本的一步:busy(Rust 忙)、ok(成功)、reject(任意拒絕值)、fail(側車的業務錯誤 ok:false);cost 是這一次 invoke 花的假時間 */
type Step =
  | { t: 'busy'; cost?: number; message?: string }
  | { t: 'ok'; cost?: number; result?: Obj }
  | { t: 'reject'; value: unknown; cost?: number }
  | { t: 'fail'; kind: string; message: string; cost?: number };

interface Seen {
  at: number;
  request: { v: number; id: number; method: string; params: Obj };
}
interface Rig {
  client: Client;
  seen: Seen[];
  sleeps: number[];
  clock: { t: number };
  waits: { at: number; waiting: boolean }[];
}

async function rig(steps: Step[]): Promise<Rig> {
  const m = await mod();
  const seen: Seen[] = [];
  const sleeps: number[] = [];
  const clock = { t: 0 };
  const waits: { at: number; waiting: boolean }[] = [];
  let n = 0;
  const invoke = async (_cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    const request = (args as { request: Seen['request'] }).request;
    seen.push({ at: clock.t, request });
    const step = steps.length > 1 ? (steps[n] ?? steps[steps.length - 1]!) : steps[0]!;
    n += 1;
    clock.t += step.cost ?? 0;
    if (step.t === 'busy') throw step.message === undefined ? { kind: 'busy' } : { kind: 'busy', message: step.message };
    if (step.t === 'reject') throw step.value;
    if (step.t === 'fail') return { v: 1, id: request.id, ok: false, error: { kind: step.kind, message: step.message } };
    return { v: 1, id: request.id, ok: true, result: step.result ?? { fine: true } };
  };
  const client = m.createReviewClient({
    invoke,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock.t += ms;
      // 安全網:沒有上限的重試會把假時鐘一路跑下去、佔滿事件迴圈。超過 5000 次就丟錯,讓它變成「紅」而不是「卡住」。
      if (sleeps.length > 5000) throw new Error('重試超過 5000 次還沒停(沒有上限)');
    },
    now: () => clock.t,
  });
  client.onWait((waiting) => waits.push({ at: clock.t, waiting }));
  return { client, seen, sleeps, clock, waits };
}

const caught = async (p: Promise<unknown>): Promise<Rejection> =>
  p.then(
    () => {
      throw new Error('應該丟 ReviewError');
    },
    (e: unknown) => e as Rejection,
  );

describe('常數(T40 修法 2)', () => {
  it('BUSY_RETRY_MS 300、BUSY_NOTICE_AFTER_MS 1000、BUSY_GIVE_UP_MS 180 秒', async () => {
    const m = await mod();
    expect(m.BUSY_RETRY_MS).toBe(300);
    expect(m.BUSY_NOTICE_AFTER_MS).toBe(1000);
    expect(m.BUSY_GIVE_UP_MS).toBe(180_000);
  });

  it('BUSY_GIVE_UP_MS 跟 Rust 的 REQUEST_TIMEOUT 一樣(讀 review_sidecar.rs 的原始檔比對,不一樣就紅)', async () => {
    const m = await mod();
    const rust = readFileSync(join(ROOT, 'apps/desktop/src-tauri/src/review_sidecar.rs'), 'utf8');
    const found = /pub const REQUEST_TIMEOUT: Duration = Duration::from_secs\((\d+)\)/.exec(rust);
    expect(found, 'review_sidecar.rs 找不到 REQUEST_TIMEOUT').not.toBeNull();
    expect(m.BUSY_GIVE_UP_MS).toBe(Number(found![1]) * 1000);
  });
});

describe('busy 重試', () => {
  it('忙兩次再成功:invoke 三次、各睡 300 ms、每次的 webview id 都不同(1、2、3);回傳成功的結果', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'busy' }, { t: 'ok', result: { state: 'ready' } }]);
    const got = await r.client.start();
    expect(got).toEqual({ state: 'ready' });
    expect(r.sleeps).toEqual([300, 300]);
    expect(r.seen.map((s) => s.request.id)).toEqual([1, 2, 3]);
    expect(r.seen.map((s) => s.at)).toEqual([0, 300, 600]);
  });

  it('重送的是同一個動作與參數(method、params 一個字都沒變)', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'busy' }, { t: 'ok' }]);
    await r.client.submit({ fill: ['協定', 'a,b'] });
    expect(r.seen.map((s) => s.request.method)).toEqual(['submit', 'submit', 'submit']);
    for (const s of r.seen) expect(s.request.params).toEqual({ fill: ['協定', 'a,b'] });
    expect(r.seen.every((s) => s.request.v === 1)).toBe(true);
  });

  it('九個動作遇到 busy 都重試(不是只有考試卡或只有教學卡的那幾個)', async () => {
    const calls: [string, (c: Client) => Promise<Obj>][] = [
      ['start', (c) => c.start()],
      ['next', (c) => c.next()],
      ['submit', (c) => c.submit({ apply: 'x' })],
      ['summary', (c) => c.summary()],
      ['status', (c) => c.status()],
      ['teach.open', (c) => c.teachOpen('language')],
      ['teach.next', (c) => c.teachNext()],
      ['teach.switch', (c) => c.teachSwitch('network')],
      ['teach.prereq', (c) => c.teachPrereq(1)],
    ];
    for (const [method, run] of calls) {
      const r = await rig([{ t: 'busy' }, { t: 'ok' }]);
      await run(r.client);
      expect(r.seen.map((s) => s.request.method), method).toEqual([method, method]);
      expect(r.sleeps, method).toEqual([300]);
    }
  });

  it('重試時間用注入的時鐘算:每次 invoke 花的時間也算進去(invoke 花 100 ms + 睡 300 ms)', async () => {
    const r = await rig([{ t: 'busy', cost: 100 }, { t: 'busy', cost: 100 }, { t: 'ok' }]);
    await r.client.status();
    expect(r.seen.map((s) => s.at)).toEqual([0, 400, 800]);
  });

  it('只有 busy 會重試:別的 Rust 拒絕與側車的業務錯誤都只送一次、不睡', async () => {
    for (const step of [
      { t: 'reject', value: { kind: 'timeout' } },
      { t: 'reject', value: { kind: 'sidecar-exited' } },
      { t: 'reject', value: { kind: 'bad-envelope' } },
      { t: 'reject', value: 'boom' },
      { t: 'fail', kind: 'no-session', message: '還沒開始今天的複習。' },
    ] as Step[]) {
      const r = await rig([step]);
      const err = await caught(r.client.next());
      expect(r.seen, JSON.stringify(step)).toHaveLength(1);
      expect(r.sleeps, JSON.stringify(step)).toEqual([]);
      expect(err.unsent, JSON.stringify(step)).toBe(false);
    }
  });

  it('busy 之後遇到別的錯誤:停止重試、丟那個錯(unsent 是 false)', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'reject', value: { kind: 'sidecar-exited' } }]);
    const err = await caught(r.client.next());
    expect(err.kind).toBe('sidecar-exited');
    expect(err.unsent).toBe(false);
    expect(r.seen).toHaveLength(2);
  });
});

describe('onWait 通知', () => {
  it('忙三次(最久 900 ms)就好了:一次都不通知', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'ok' }]);
    await r.client.start();
    expect(r.waits).toEqual([]);
  });

  it('忙五次(超過 1 秒)再成功:通知 true 一次、結束時通知 false 一次(順序是 true 再 false)', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'ok' }]);
    await r.client.start();
    expect(r.waits.map((w) => w.waiting)).toEqual([true, false]);
    expect(r.waits[0]!.at, 'true 是超過 1 秒之後才通知的').toBeGreaterThan(1000);
  });

  it('等候中遇到別的錯誤:也要通知 false', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'reject', value: { kind: 'sidecar-exited' } }]);
    await caught(r.client.start());
    expect(r.waits.map((w) => w.waiting)).toEqual([true, false]);
  });

  it('取消訂閱之後不再收到通知;多個聽眾都收到', async () => {
    const r = await rig([{ t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'busy' }, { t: 'ok' }]);
    const second: boolean[] = [];
    const stop = r.client.onWait((w) => second.push(w));
    stop();
    const third: boolean[] = [];
    r.client.onWait((w) => third.push(w));
    await r.client.start();
    expect(second).toEqual([]);
    expect(third).toEqual([true, false]);
    expect(r.waits.map((w) => w.waiting)).toEqual([true, false]);
  });

  it('沒有忙的呼叫:不通知', async () => {
    const r = await rig([{ t: 'ok' }]);
    await r.client.status();
    expect(r.waits).toEqual([]);
  });
});

describe('放棄(180 秒)', () => {
  it('一直 busy:在 180 秒停,丟 timeout、unsent 為 true、message 是固定字樣;最後一次送出在 179.7~180 秒之間;之後不再送', async () => {
    const r = await rig([{ t: 'busy' }]);
    const m = await mod();
    const p = await protocol();
    const err = await caught(r.client.next());
    expect(err).toBeInstanceOf(m.ReviewError);
    expect(err.kind).toBe('timeout');
    expect(err.unsent).toBe(true);
    expect(err.message).toBe(p.ERROR_MESSAGES.timeout);
    expect(err.message).toBe('等候回覆的時間過了。');
    expect(r.clock.t, '不早於 180 秒放棄').toBeGreaterThanOrEqual(180_000);
    expect(r.clock.t, '不晚過 180 秒加一次間隔').toBeLessThanOrEqual(180_000 + 300);
    const last = r.seen.at(-1)!.at;
    expect(last).toBeGreaterThanOrEqual(180_000 - 300);
    expect(last).toBeLessThanOrEqual(180_000);
    expect(r.seen.length, '300 ms 一次、180 秒:約 600 次').toBeGreaterThanOrEqual(600);
    expect(r.seen.length).toBeLessThanOrEqual(602);
    expect(r.sleeps.every((ms) => ms === 300)).toBe(true);
    const sent = r.seen.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.seen.length, '放棄之後不再呼叫 invoke').toBe(sent);
  });

  it('放棄時通知 false(之前通知過 true)', async () => {
    const r = await rig([{ t: 'busy' }]);
    await caught(r.client.status());
    expect(r.waits.map((w) => w.waiting)).toEqual([true, false]);
  });

  it('Rust 自己的 timeout(請求送進側車、180 秒沒回)是另一回事:unsent 為 false,不重試', async () => {
    const r = await rig([{ t: 'reject', value: { kind: 'timeout' } }]);
    const err = await caught(r.client.submit({ apply: 'x' }));
    expect(err.kind).toBe('timeout');
    expect(err.unsent).toBe(false);
    expect(r.seen).toHaveLength(1);
  });

  it('放棄之後下一個動作重新計時(不是繼承上一個動作的 180 秒)', async () => {
    const r = await rig([{ t: 'busy' }]);
    await caught(r.client.next());
    const before = r.seen.length;
    await caught(r.client.next());
    expect(r.seen.length - before, '第二次也試滿約 600 次').toBeGreaterThanOrEqual(600);
  });
});

describe('ReviewError', () => {
  it('unsent 預設 false;第三個參數給 true 就是 true', async () => {
    const m = await mod();
    expect(new m.ReviewError('internal', 'x').unsent).toBe(false);
    expect(new m.ReviewError('timeout', 'x', true).unsent).toBe(true);
    expect(new m.ReviewError('timeout', 'x', true).kind).toBe('timeout');
  });
});

describe('沒有 message 的 Rust 拒絕(T40 修法 3)', () => {
  it('kind 在 ERROR_MESSAGES 裡:message 是那一句,不是 kind 本身', async () => {
    const p = await protocol();
    for (const kind of ['bad-envelope', 'sidecar-unavailable', 'sidecar-exited', 'not-configured', 'bad-response', 'timeout']) {
      const r = await rig([{ t: 'reject', value: { kind } }]);
      const err = await caught(r.client.status());
      expect(err.kind, kind).toBe(kind);
      expect(err.message, kind).toBe(p.ERROR_MESSAGES[kind]);
      expect(err.message, kind).not.toBe(kind);
    }
  });

  it('不認得的 kind:message 是 internal 那一句;不是 { kind } 的拒絕值(字串、null)kind 照舊是 sidecar-unavailable,message 是它的句子', async () => {
    const p = await protocol();
    const unknown = await rig([{ t: 'reject', value: { kind: 'brand-new-kind' } }]);
    const err = await caught(unknown.client.status());
    expect(err.kind).toBe('brand-new-kind');
    expect(err.message).toBe(p.ERROR_MESSAGES.internal);
    for (const value of ['boom', null]) {
      const r = await rig([{ t: 'reject', value }]);
      const e = await caught(r.client.status());
      expect(e.kind, String(value)).toBe('sidecar-unavailable');
      expect(e.message, String(value)).toBe(p.ERROR_MESSAGES['sidecar-unavailable']);
    }
  });

  it('Rust 的拒絕有 message:原樣(不改寫)', async () => {
    const r = await rig([{ t: 'reject', value: { kind: 'sidecar-unavailable', message: '自訂的一句' } }]);
    const err = await caught(r.client.status());
    expect(err.message).toBe('自訂的一句');
  });
});

describe('reviewErrorText(T40 修法 3)', () => {
  it('每個 ERROR_KINDS 都回它在 ERROR_MESSAGES 的句子', async () => {
    const m = await mod();
    const p = await protocol();
    for (const kind of p.ERROR_KINDS) {
      expect(m.reviewErrorText(new m.ReviewError(kind, 'RAW')), kind).toBe(p.ERROR_MESSAGES[kind]);
    }
  });

  it('不認得的 kind 與一般 Error、字串、undefined:internal 那一句', async () => {
    const m = await mod();
    const p = await protocol();
    for (const err of [new m.ReviewError('brand-new-kind', 'RAW'), new Error('RAW'), 'boom', undefined, null, { kind: 'bad-envelope' }]) {
      expect(m.reviewErrorText(err), String(err)).toBe(p.ERROR_MESSAGES.internal);
    }
  });

  it('回傳值不會長得像英文 kind(/^[a-z-]+$/)', async () => {
    const m = await mod();
    const p = await protocol();
    for (const kind of [...p.ERROR_KINDS, 'brand-new-kind']) {
      expect(m.reviewErrorText(new m.ReviewError(kind, kind)), kind).not.toMatch(/^[a-z-]+$/);
    }
  });
});
