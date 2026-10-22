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

  it('剛好滿 1 秒還不通知(門檻是「超過」):每趟 invoke 花 200 ms 加睡 300 ms,第二趟結束剛好 1000 ms 不通知,第三趟 1500 ms 才通知', async () => {
    const busy = { t: 'busy', cost: 200 } as const;
    const r = await rig([busy, busy, busy, busy, { t: 'ok' }]);
    await r.client.start();
    expect(r.waits.map((w) => w.waiting)).toEqual([true, false]);
    expect(r.waits[0]!.at).toBe(1500);
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

/* ───────────── 補測2·(T40 第二輪:-5a 的存活變異;只加測試) ───────────── */

const START = 1_700_000_000_000;

/** 補測2 用的劇本機:時鐘可以從任意數開始(正式環境的 Date.now 不是從 0 起);回應由函式決定,可以回任何形狀 */
async function rigAt(
  start: number,
  respond: (n: number, id: number) => { cost?: number; throws?: unknown; value?: unknown },
): Promise<Rig> {
  const m = await mod();
  const seen: Seen[] = [];
  const sleeps: number[] = [];
  const clock = { t: start };
  const waits: { at: number; waiting: boolean }[] = [];
  let n = 0;
  const client = m.createReviewClient({
    invoke: async (_cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      const request = (args as { request: Seen['request'] }).request;
      seen.push({ at: clock.t, request });
      n += 1;
      const out = respond(n, request.id);
      clock.t += out.cost ?? 0;
      if ('throws' in out) throw out.throws;
      return out.value;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock.t += ms;
      if (sleeps.length > 5000) throw new Error('重試超過 5000 次還沒停(沒有上限)');
    },
    now: () => clock.t,
  });
  client.onWait((waiting) => waits.push({ at: clock.t, waiting }));
  return { client, seen, sleeps, clock, waits };
}

const BUSY = { throws: { kind: 'busy' } };
const okOf = (id: number, result: unknown = { fine: true }, cost = 0) => ({ cost, value: { v: 1, id, ok: true, result } });

describe('補測2·G1 放棄邊界(兩處檢查:送之前、busy 之後睡之前)', () => {
  it('每趟 0 ms 全 busy:invoke 剛好 600 次、睡剛好 600 次、放棄時時鐘剛好 180000', async () => {
    const r = await rigAt(0, () => BUSY);
    const err = await caught(r.client.next());
    expect(err.kind).toBe('timeout');
    expect(r.seen).toHaveLength(600);
    expect(r.sleeps).toHaveLength(600);
    expect(r.clock.t).toBe(180_000);
    expect(r.seen.at(-1)!.at).toBe(179_700);
  });

  it('busy 回來時剛好 180000:不睡、不再送;丟 timeout、unsent、固定字樣(放棄在「睡之前」那一處)', async () => {
    const p = await protocol();
    const r = await rigAt(0, () => ({ ...BUSY, cost: 180_000 }));
    const err = await caught(r.client.next());
    expect(r.seen).toHaveLength(1);
    expect(r.sleeps).toEqual([]);
    expect(r.clock.t).toBe(180_000);
    expect(err.kind).toBe('timeout');
    expect(err.unsent).toBe(true);
    expect(err.message).toBe(p.ERROR_MESSAGES.timeout);
    expect(err.message).toBe('等候回覆的時間過了。');
  });

  it('busy 回來時是 179999:還睡一次(300 ms)再看;睡完到 180299,不再送,丟 timeout', async () => {
    const r = await rigAt(0, () => ({ ...BUSY, cost: 179_999 }));
    const err = await caught(r.client.next());
    expect(r.seen).toHaveLength(1);
    expect(r.sleeps).toEqual([300]);
    expect(r.clock.t).toBe(180_299);
    expect(err.kind).toBe('timeout');
    expect(err.unsent).toBe(true);
  });

  it('睡完剛好 180000:不再送(送之前那一處檢查,邊界是「大於等於」)', async () => {
    const r = await rigAt(0, () => ({ ...BUSY, cost: 179_700 }));
    const err = await caught(r.client.next());
    expect(r.seen).toHaveLength(1);
    expect(r.sleeps).toEqual([300]);
    expect(r.clock.t).toBe(180_000);
    expect(err.kind).toBe('timeout');
    expect(err.unsent).toBe(true);
  });

  it('睡完是 179999:還送(差 1 ms 不放棄);第二次再 busy,第二趟再睡後放棄', async () => {
    const r = await rigAt(0, (n) => (n === 1 ? { ...BUSY, cost: 179_699 } : BUSY));
    const err = await caught(r.client.next());
    expect(r.seen.map((s) => s.at)).toEqual([0, 179_999]);
    expect(r.sleeps).toEqual([300, 300]);
    expect(err.kind).toBe('timeout');
  });

  it('剛好 180000 之前最後一趟成功:179999 送出的那次成功了就回結果,不丟 timeout', async () => {
    const r = await rigAt(0, (n, id) => (n === 1 ? { ...BUSY, cost: 179_699 } : okOf(id, { late: true })));
    await expect(r.client.next()).resolves.toEqual({ late: true });
    expect(r.seen).toHaveLength(2);
  });

  it('放棄後下一個動作用新的起點:不被上一個動作的 180 秒影響', async () => {
    const r = await rigAt(0, () => BUSY);
    await caught(r.client.next());
    const before = r.seen.length;
    const t0 = r.clock.t;
    await caught(r.client.next());
    expect(r.seen.length - before).toBe(600);
    expect(r.clock.t - t0).toBe(180_000);
  });
});

describe('補測2·G4 假時鐘不從 0 起(正式環境是很大的毫秒數)', () => {
  it('起點 1.7e12:忙三次(900 ms)再成功,不通知;第一次嘗試也不通知', async () => {
    const r = await rigAt(START, (n, id) => (n <= 3 ? BUSY : okOf(id)));
    await r.client.start();
    expect(r.waits).toEqual([]);
    expect(r.seen).toHaveLength(4);
  });

  it('起點 1.7e12:超過 1 秒才通知 true(從開始算 1500 ms),成功後通知 false', async () => {
    const r = await rigAt(START, (n, id) => (n <= 4 ? { ...BUSY, cost: 200 } : okOf(id)));
    await r.client.start();
    expect(r.waits.map((w) => w.waiting)).toEqual([true, false]);
    expect(r.waits[0]!.at - START).toBe(1500);
  });

  it('起點 1.7e12:放棄一樣是從開始算 180 秒(不是一開始就放棄)', async () => {
    const r = await rigAt(START, () => BUSY);
    const err = await caught(r.client.next());
    expect(err.kind).toBe('timeout');
    expect(r.seen).toHaveLength(600);
    expect(r.clock.t - START).toBe(180_000);
  });
});

describe('補測2·G3 不給時鐘與 sleep:走正式環境的預設(真的 setTimeout 與 Date.now)', () => {
  it('先 busy 再成功:不推進時間第二次不會送;推進 299 ms 還不會;推進到 300 ms 才送、整體成功', async () => {
    vi.useFakeTimers();
    try {
      const m = await mod();
      const ids: number[] = [];
      const client = m.createReviewClient({
        invoke: async (_cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
          const request = (args as { request: { id: number } }).request;
          ids.push(request.id);
          if (ids.length === 1) throw { kind: 'busy' };
          return { v: 1, id: request.id, ok: true, result: { done: true } };
        },
      });
      let result: unknown;
      const p = client.status().then((v) => (result = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(ids, '第一次送出').toEqual([1]);
      await vi.advanceTimersByTimeAsync(299);
      expect(ids, '299 ms:還在睡').toEqual([1]);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(ids, '300 ms:第二次(新 id)').toEqual([1, 2]);
      await p;
      expect(result).toEqual({ done: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('預設時鐘算時間:一直 busy,推進 1.2 秒通知 true、推進到 180 秒丟 timeout(unsent)、通知 false', async () => {
    vi.useFakeTimers();
    try {
      const m = await mod();
      let sent = 0;
      const client = m.createReviewClient({
        invoke: async (): Promise<unknown> => {
          sent += 1;
          throw { kind: 'busy' };
        },
      });
      const waits: boolean[] = [];
      client.onWait((w) => waits.push(w));
      let outcome: Rejection | undefined;
      const p = client.next().catch((e: unknown) => {
        outcome = e as Rejection;
      });
      await vi.advanceTimersByTimeAsync(900);
      expect(waits, '900 ms 還不通知').toEqual([]);
      await vi.advanceTimersByTimeAsync(600);
      expect(waits, '1500 ms 通知').toEqual([true]);
      expect(outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(180_000);
      await p;
      expect(outcome!.kind).toBe('timeout');
      expect(outcome!.unsent).toBe(true);
      expect(waits).toEqual([true, false]);
      const stopped = sent;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sent, '放棄後不再送').toBe(stopped);
      expect(sent, '約 600 次').toBeGreaterThanOrEqual(600);
      expect(sent).toBeLessThanOrEqual(602);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('補測2·G5 拒絕值的 kind 不合格:一律 sidecar-unavailable、不重試', () => {
  it('kind 是空字串、數字、陣列、有 length 的物件、undefined、null', async () => {
    const p = await protocol();
    for (const kind of ['', 5, ['x'], ['busy'], { length: 3 }, undefined, null]) {
      const r = await rig([{ t: 'reject', value: { kind } }]);
      const err = await caught(r.client.status());
      const label = JSON.stringify(kind) ?? 'undefined';
      expect(err.kind, label).toBe('sidecar-unavailable');
      expect(err.message, label).toBe(p.ERROR_MESSAGES['sidecar-unavailable']);
      expect(r.seen, label).toHaveLength(1);
      expect(r.sleeps, label).toEqual([]);
      expect(err.unsent, label).toBe(false);
    }
  });

  it('拒絕值是陣列、數字、undefined:一樣 sidecar-unavailable', async () => {
    for (const value of [[], ['busy'], 7, undefined, true]) {
      const r = await rig([{ t: 'reject', value }]);
      const err = await caught(r.client.status());
      expect(err.kind, String(value)).toBe('sidecar-unavailable');
      expect(r.seen).toHaveLength(1);
    }
  });
});

describe('補測2·G6 取消訂閱', () => {
  async function fire(r: Rig): Promise<void> {
    const rr = r;
    await rr.client.start();
  }

  it('三個訂閱者取消第一個:只剩另兩個收到通知(第一個一則也沒有)', async () => {
    const r = await rigAt(0, (n, id) => (n <= 5 ? { ...BUSY, cost: 300 } : okOf(id)));
    const a: boolean[] = [];
    const b: boolean[] = [];
    const c: boolean[] = [];
    const stopA = r.client.onWait((w) => a.push(w));
    r.client.onWait((w) => b.push(w));
    r.client.onWait((w) => c.push(w));
    stopA();
    await fire(r);
    expect(a).toEqual([]);
    expect(b).toEqual([true, false]);
    expect(c).toEqual([true, false]);
  });

  it('同一個取消函式呼叫兩次:別的訂閱者仍收得到(不會多拿掉最後一個)', async () => {
    const r = await rigAt(0, (n, id) => (n <= 5 ? { ...BUSY, cost: 300 } : okOf(id)));
    const a: boolean[] = [];
    const b: boolean[] = [];
    const c: boolean[] = [];
    const stopA = r.client.onWait((w) => a.push(w));
    r.client.onWait((w) => b.push(w));
    r.client.onWait((w) => c.push(w));
    stopA();
    stopA();
    await fire(r);
    expect(a).toEqual([]);
    expect(b).toEqual([true, false]);
    expect(c).toEqual([true, false]);
  });

  it('通知的當下有人取消自己:後面的訂閱者照樣收到(通知走的是複本)', async () => {
    const r = await rigAt(0, (n, id) => (n <= 5 ? { ...BUSY, cost: 300 } : okOf(id)));
    const a: boolean[] = [];
    const b: boolean[] = [];
    const stopA = r.client.onWait((w) => {
      a.push(w);
      stopA();
    });
    r.client.onWait((w) => b.push(w));
    await fire(r);
    expect(a, '自己取消後只收到第一則').toEqual([true]);
    expect(b).toEqual([true, false]);
  });
});

describe('補測2·回應驗證(attempt)與 ReviewError 小項', () => {
  it('ReviewError 的 name 是 "ReviewError"', async () => {
    const m = await mod();
    expect(new m.ReviewError('internal', 'x').name).toBe('ReviewError');
  });

  it('格式錯的回應:kind 是 bad-response、message 是它的固定句子(有定義、不是空)', async () => {
    const p = await protocol();
    const bads: [string, (id: number) => unknown][] = [
      ['ok 不是 true', (id) => ({ v: 1, id, ok: 'yes', result: {} })],
      ['result 是字串', (id) => ({ v: 1, id, ok: true, result: 'abc' })],
      ['result 是數字', (id) => ({ v: 1, id, ok: true, result: 3 })],
      ['result 是陣列', (id) => ({ v: 1, id, ok: true, result: [] })],
      ['result 是 null', (id) => ({ v: 1, id, ok: true, result: null })],
      ['id 對不上', (id) => ({ v: 1, id: id + 100, ok: true, result: {} })],
      ['回的是字串', () => 'not json'],
      ['回的是數字', () => 5],
      ['回的是陣列', () => []],
      ['回的是 null', () => null],
    ];
    for (const [label, make] of bads) {
      const r = await rigAt(0, (_n, id) => ({ value: make(id) }));
      const err = await caught(r.client.status());
      expect(err.kind, label).toBe('bad-response');
      expect(err.message, label).toBe(p.ERROR_MESSAGES['bad-response']);
      expect(err.message, label).toBeTruthy();
      expect(r.seen, label).toHaveLength(1);
      expect(r.sleeps, label).toEqual([]);
    }
  });

  it('invoke 回的是 JSON 字串(不是物件):照樣解析、成功', async () => {
    const r = await rigAt(0, (_n, id) => ({ value: JSON.stringify({ v: 1, id, ok: true, result: { s: 1 } }) }));
    await expect(r.client.status()).resolves.toEqual({ s: 1 });
  });

  it('側車回 ok:false:kind 與 message 原樣;kind 是空字串(協定允許)→ internal、message 原樣', async () => {
    const cases: [string, string, string, string][] = [
      ['原樣', 'no-session', '句子', 'no-session'],
      ['kind 空字串', '', 'm', 'internal'],
    ];
    for (const [label, kind, message, wantKind] of cases) {
      const r = await rigAt(0, (_n, id) => ({ value: { v: 1, id, ok: false, error: { kind, message } } }));
      const err = await caught(r.client.status());
      expect(err.kind, label).toBe(wantKind);
      expect(err.message, label).toBe(message);
      expect(err.unsent, label).toBe(false);
      expect(r.seen, label).toHaveLength(1);
    }
  });

  it('側車回 ok:false 但 error 缺 kind、缺 message、不是物件:協定不收,算 bad-response', async () => {
    const p = await protocol();
    for (const error of [{ message: 'm' }, { kind: 'x' }, { kind: 5, message: 'm' }, 'oops', undefined]) {
      const r = await rigAt(0, (_n, id) => ({ value: { v: 1, id, ok: false, error } }));
      const err = await caught(r.client.status());
      expect(err.kind, JSON.stringify(error)).toBe('bad-response');
      expect(err.message).toBe(p.ERROR_MESSAGES['bad-response']);
    }
  });

  it('側車的業務錯誤 kind 就算叫 busy 也只送一次(重試只認 Rust 的拒絕)', async () => {
    const r = await rigAt(0, (_n, id) => ({ value: { v: 1, id, ok: false, error: { kind: 'busy', message: 'm' } } }));
    const err = await caught(r.client.status());
    expect(err.kind).toBe('busy');
    expect(r.seen).toHaveLength(1);
    expect(r.sleeps).toEqual([]);
  });
});

describe('補測2·G6b 取消「第一個」訂閱者(client 上只有這幾個,沒有別人排在前面)', () => {
  async function bare() {
    const m = await mod();
    const clock = { t: 0 };
    let n = 0;
    const client = m.createReviewClient({
      invoke: async (_c: string, args?: Record<string, unknown>) => {
        const id = (args as { request: { id: number } }).request.id;
        n += 1;
        clock.t += 300;
        if (n <= 5) throw { kind: 'busy' };
        return { v: 1, id, ok: true, result: {} };
      },
      sleep: async (ms: number) => {
        clock.t += ms;
      },
      now: () => clock.t,
    });
    return client;
  }

  it('取消第一個:它收不到、後面兩個照收', async () => {
    const client = await bare();
    const a: boolean[] = [];
    const b: boolean[] = [];
    const c: boolean[] = [];
    const stopA = client.onWait((w) => a.push(w));
    client.onWait((w) => b.push(w));
    client.onWait((w) => c.push(w));
    stopA();
    await client.start();
    expect(a).toEqual([]);
    expect(b).toEqual([true, false]);
    expect(c).toEqual([true, false]);
  });

  it('第一個的取消函式呼叫兩次:後面兩個仍都收到', async () => {
    const client = await bare();
    const a: boolean[] = [];
    const b: boolean[] = [];
    const c: boolean[] = [];
    const stopA = client.onWait((w) => a.push(w));
    client.onWait((w) => b.push(w));
    client.onWait((w) => c.push(w));
    stopA();
    stopA();
    await client.start();
    expect(a).toEqual([]);
    expect(b).toEqual([true, false]);
    expect(c).toEqual([true, false]);
  });
});

describe('補測2·程序內 handler 路徑的回應驗證', () => {
  it('handler 回壞掉的一行:bad-response、固定句子;回好的一行:成功', async () => {
    const m = await mod();
    const p = await protocol();
    const bad = m.createReviewClient({ handler: async () => 'garbage' });
    const err = await caught(bad.status());
    expect(err.kind).toBe('bad-response');
    expect(err.message).toBe(p.ERROR_MESSAGES['bad-response']);
    const good = m.createReviewClient({
      handler: async (line: string) => JSON.stringify({ v: 1, id: (JSON.parse(line) as { id: number }).id, ok: true, result: { h: 1 } }),
    });
    await expect(good.status()).resolves.toEqual({ h: 1 });
  });
});
