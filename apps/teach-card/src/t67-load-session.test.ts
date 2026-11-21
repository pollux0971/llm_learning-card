/**
 * T67 紅測試(視窗那一側):`createTeachSession` 從回應讀 `load`、視窗拿到焦點時用 `refreshLoad()` 重拿(ADR-085)。
 * 測試 agent 寫;開發 worker 不改。工單 docs/tickets/T67-teach-card-daily-load-hint.md「要的結果」第 4 節、「紅測試」表的「焦點」。
 *
 * 名字(工單沒寫死,這裡定;要改先回報測試 agent):
 *   ReviewClient.teachLoad(): Promise<Record<string, unknown>>        → 送 `teach.load`、params `{}`,回 `{ learnedToday, dueTomorrow }`
 *   session.view().load: { learnedToday: number; dueTomorrow: number } | undefined
 *       每個回畫面的動作(open / next / switch / prereq / deepen / poll / cancel / back)的回應有合法的 load 就換上去;
 *       沒有、欄位壞掉(不是 ≥ 0 的整數)→ undefined(不顯示提示,不丟錯)
 *   session.refreshLoad(): Promise<void>                              → 呼叫 client.teachLoad() 一次;App.svelte 在視窗 `focus` 時叫它
 *       成功 → 只換 view().load;失敗(busy、逾時、錯誤、什麼都丟)→ 安靜:view 的每個欄位都跟沒叫過一樣、promise 不 reject
 *
 * 另外量「安靜」:用真的 createReviewClient(注入假的 invoke / sleep / now)讓 teach.load 一直回 busy,
 * 重拿期間與之後,session 的 waiting / busyNotice / controlsDisabled 一次都不能變(不然「稍等一下」會在焦點切回來時閃出來)。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const SESSION = pathToFileURL(join(import.meta.dirname, 'teach-session.ts')).href;
const CLIENT = pathToFileURL(join(import.meta.dirname, '../../desktop/src/webview/review-client.ts')).href;

type Obj = Record<string, unknown>;
interface Load {
  learnedToday: number;
  dueTomorrow: number;
}
interface View extends Obj {
  state: string;
  load: Load | undefined;
  waiting: boolean;
  busyNotice: string | undefined;
  controlsDisabled: boolean;
  message: string | undefined;
}
interface Session {
  view(): View;
  open(): Promise<void>;
  next(): Promise<void>;
  chooseCategory(id: string): Promise<void>;
  followPrereq(index: number): Promise<void>;
  refreshLoad(): Promise<void>;
}
const sessionMod = async (): Promise<{ createTeachSession(deps: Obj): Session }> => (await import(/* @vite-ignore */ SESSION)) as { createTeachSession(deps: Obj): Session };
const clientMod = async (): Promise<{ ReviewError: new (kind: string, message: string, unsent?: boolean) => Error; createReviewClient(opts: Obj): Obj }> =>
  (await import(/* @vite-ignore */ CLIENT)) as never;

const ROWS = [
  { id: 'security', name: '資安', remaining: 3, requireRaw: true },
  { id: 'language', name: '語言', remaining: 4, requireRaw: false },
];
const CARD = { id: 'sec-0002', path: 'cards/security/sec-0002.md', title: '跨來源資源共享' };
const view = (load: unknown, over: Obj = {}): Obj => ({ category: 'security', categories: ROWS, card: CARD, prereqs: [], from: null, canBack: false, generating: false, ...(load === undefined ? {} : { load }), ...over });

interface Rig {
  session: Session;
  calls: string[];
  reads: string[];
  stored: Map<string, string>;
  /** 下一次各動作回的東西;teachLoad 另外排 */
  respond: { view: Obj | Error; load: Obj | Error | (() => Promise<Obj>) };
}

async function rig(): Promise<Rig> {
  const m = await sessionMod();
  const calls: string[] = [];
  const reads: string[] = [];
  const stored = new Map<string, string>();
  const respond: Rig['respond'] = { view: view({ learnedToday: 4, dueTomorrow: 6 }), load: { learnedToday: 5, dueTomorrow: 7 } };
  const action = (name: string) => async (): Promise<Obj> => {
    calls.push(name);
    if (respond.view instanceof Error) throw respond.view;
    return respond.view;
  };
  const session = m.createTeachSession({
    client: {
      teachOpen: action('teachOpen'),
      teachNext: action('teachNext'),
      teachSwitch: action('teachSwitch'),
      teachPrereq: action('teachPrereq'),
      teachDeepen: action('teachDeepen'),
      teachPoll: action('teachPoll'),
      teachCancel: action('teachCancel'),
      teachBack: action('teachBack'),
      teachLoad: async (): Promise<Obj> => {
        calls.push('teachLoad');
        const l = respond.load;
        if (l instanceof Error) throw l;
        return typeof l === 'function' ? l() : l;
      },
      onWait: () => () => undefined,
    },
    fs: {
      async read(path: string): Promise<string> {
        reads.push(path);
        return `TEXT:${path}`;
      },
      assetUrl: (p: string): string => `fake://asset/${p}`,
    },
    storage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) },
    pause: async () => undefined,
  });
  return { session, calls, reads, stored, respond };
}

describe('從回應讀 load', () => {
  it('open:view().load 是回應的 load', async () => {
    const r = await rig();
    await r.session.open();
    expect(r.session.view().load).toEqual({ learnedToday: 4, dueTomorrow: 6 });
  });

  it('next、chooseCategory、followPrereq:每次都換成那次回應的 load', async () => {
    const r = await rig();
    await r.session.open();
    r.respond.view = view({ learnedToday: 5, dueTomorrow: 7 });
    await r.session.next();
    expect(r.session.view().load).toEqual({ learnedToday: 5, dueTomorrow: 7 });
    r.respond.view = view({ learnedToday: 6, dueTomorrow: 8 }, { category: 'language' });
    await r.session.chooseCategory('language');
    expect(r.session.view().load).toEqual({ learnedToday: 6, dueTomorrow: 8 });
    r.respond.view = view({ learnedToday: 7, dueTomorrow: 9 }, { category: 'language' });
    await r.session.followPrereq(0);
    expect(r.session.view().load).toEqual({ learnedToday: 7, dueTomorrow: 9 });
  });

  it('類別學完(card 是 null)的回應也讀 load', async () => {
    const r = await rig();
    r.respond.view = view({ learnedToday: 9, dueTomorrow: 2 }, { card: null });
    await r.session.open();
    expect(r.session.view()).toMatchObject({ state: 'finished', load: { learnedToday: 9, dueTomorrow: 2 } });
  });

  it('零是合法的數字(空目錄):{ 0, 0 }', async () => {
    const r = await rig();
    r.respond.view = view({ learnedToday: 0, dueTomorrow: 0 });
    await r.session.open();
    expect(r.session.view().load).toEqual({ learnedToday: 0, dueTomorrow: 0 });
  });

  it('沒有 load(舊側車):view().load 是 undefined,畫面照常是 card,不丟錯', async () => {
    const r = await rig();
    r.respond.view = view(undefined);
    await r.session.open();
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().load).toBeUndefined();
  });

  it('上一次有 load、這一次的回應沒有:不留舊數字(undefined)', async () => {
    const r = await rig();
    await r.session.open();
    r.respond.view = view(undefined);
    await r.session.next();
    expect(r.session.view().load).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['字串', 'x'],
    ['陣列', [1, 2]],
    ['少一個欄位', { learnedToday: 1 }],
    ['學了不是數字', { learnedToday: '4', dueTomorrow: 6 }],
    ['明天不是數字', { learnedToday: 4, dueTomorrow: null }],
    ['負數', { learnedToday: -1, dueTomorrow: 6 }],
    ['小數', { learnedToday: 1.5, dueTomorrow: 6 }],
    ['NaN(JSON 裡是 null)', { learnedToday: Number.NaN, dueTomorrow: 6 }],
    ['Infinity', { learnedToday: 4, dueTomorrow: Number.POSITIVE_INFINITY }],
  ])('欄位壞掉(%s):不顯示(undefined),不進錯誤畫面', async (_name, bad) => {
    const r = await rig();
    r.respond.view = view(bad);
    await r.session.open();
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().load).toBeUndefined();
  });
});

describe('refreshLoad(視窗拿到焦點)', () => {
  it('叫 teachLoad 剛好一次,只換 load;別的欄位一個字都沒變,不重讀卡片、不碰 storage、不叫別的動作', async () => {
    const r = await rig();
    await r.session.open();
    const before = JSON.parse(JSON.stringify(r.session.view())) as Obj;
    const readsBefore = [...r.reads];
    const storeBefore = new Map(r.stored);
    r.calls.length = 0;
    await r.session.refreshLoad();
    expect(r.calls).toEqual(['teachLoad']);
    expect(r.session.view().load).toEqual({ learnedToday: 5, dueTomorrow: 7 });
    expect({ ...JSON.parse(JSON.stringify(r.session.view())), load: undefined }).toEqual({ ...before, load: undefined });
    expect(r.reads).toEqual(readsBefore);
    expect(r.stored).toEqual(storeBefore);
  });

  it('每次焦點都重拿(不快取):叫兩次就送兩次', async () => {
    const r = await rig();
    await r.session.open();
    r.calls.length = 0;
    await r.session.refreshLoad();
    r.respond.load = { learnedToday: 6, dueTomorrow: 9 };
    await r.session.refreshLoad();
    expect(r.calls).toEqual(['teachLoad', 'teachLoad']);
    expect(r.session.view().load).toEqual({ learnedToday: 6, dueTomorrow: 9 });
  });

  it('類別學完的畫面(finished)重拿也行,畫面維持 finished', async () => {
    const r = await rig();
    r.respond.view = view({ learnedToday: 1, dueTomorrow: 1 }, { card: null });
    await r.session.open();
    await r.session.refreshLoad();
    expect(r.session.view()).toMatchObject({ state: 'finished', load: { learnedToday: 5, dueTomorrow: 7 } });
  });

  it.each([
    ['busy', 'busy'],
    ['逾時', 'timeout'],
    ['側車掛了', 'sidecar-exited'],
    ['內部錯誤', 'internal'],
    ['回應壞掉', 'bad-response'],
  ])('側車%s:安靜保留舊數字,view 每個欄位都不變,不進 error,promise 不 reject', async (_name, kind) => {
    const r = await rig();
    const { ReviewError } = await clientMod();
    await r.session.open();
    const before = JSON.parse(JSON.stringify(r.session.view())) as Obj;
    r.respond.load = new ReviewError(kind, `錯誤 ${kind}`);
    await expect(r.session.refreshLoad()).resolves.toBeUndefined();
    expect(JSON.parse(JSON.stringify(r.session.view()))).toEqual(before);
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().message).toBeUndefined();
  });

  it('不是 ReviewError 的東西被丟出來(字串、一般 Error):一樣安靜', async () => {
    const r = await rig();
    await r.session.open();
    const before = JSON.parse(JSON.stringify(r.session.view())) as Obj;
    r.respond.load = new Error('boom');
    await expect(r.session.refreshLoad()).resolves.toBeUndefined();
    r.respond.load = (async () => {
      throw 'weird';
    }) as never;
    await expect(r.session.refreshLoad()).resolves.toBeUndefined();
    expect(JSON.parse(JSON.stringify(r.session.view()))).toEqual(before);
  });

  it('回來的 load 欄位壞掉:保留舊數字(不是清掉),因為這不是新的資訊', async () => {
    const r = await rig();
    await r.session.open();
    r.respond.load = { learnedToday: 'x' };
    await r.session.refreshLoad();
    expect(r.session.view().load).toEqual({ learnedToday: 4, dueTomorrow: 6 });
  });

  it('還沒開過(loading):重拿失敗或成功都不改 state(仍是 loading)', async () => {
    const r = await rig();
    await r.session.refreshLoad();
    expect(r.session.view().state).toBe('loading');
  });
});

describe('安靜:重拿碰到 busy 不閃「稍等一下」、不停用按鈕', () => {
  it('真的 ReviewClient + teach.load 一直回 busy(虛擬時間跑完 180 秒):重拿期間與之後 waiting / busyNotice / controlsDisabled 都沒動過', async () => {
    const { createReviewClient, ReviewError } = await clientMod();
    expect(ReviewError).toBeDefined();
    const clock = { now: 1_000_000 };
    const snapshots: Obj[] = [];
    let holder: Session | undefined;
    let teachLoadSent = 0;
    const invoke = async (_cmd: string, args?: Obj): Promise<unknown> => {
      const request = (args as { request: { id: number; method: string } }).request;
      if (request.method === 'teach.load') {
        teachLoadSent += 1;
        throw { kind: 'busy', message: '忙' };
      }
      return { v: 1, id: request.id, ok: true, result: view({ learnedToday: 4, dueTomorrow: 6 }) };
    };
    const client = createReviewClient({
      invoke,
      now: () => clock.now,
      sleep: async (ms: number) => {
        clock.now += ms;
        if (holder) {
          const v = holder.view();
          snapshots.push({ waiting: v.waiting, busyNotice: v.busyNotice, controlsDisabled: v.controlsDisabled });
        }
      },
    });
    const m = await sessionMod();
    const session = m.createTeachSession({
      client,
      fs: { read: async (p: string) => `TEXT:${p}`, assetUrl: (p: string) => `fake://asset/${p}` },
      storage: { getItem: () => null, setItem: () => undefined },
      pause: async () => undefined,
    });
    holder = session;
    await session.open();
    expect(session.view().load).toEqual({ learnedToday: 4, dueTomorrow: 6 });
    snapshots.length = 0;
    await expect(session.refreshLoad()).resolves.toBeUndefined();
    expect(teachLoadSent, '真的送出了 teach.load').toBeGreaterThanOrEqual(1);
    for (const s of snapshots) expect(s).toEqual({ waiting: false, busyNotice: undefined, controlsDisabled: false });
    const after = session.view();
    expect(after).toMatchObject({ state: 'card', waiting: false, busyNotice: undefined, controlsDisabled: false, load: { learnedToday: 4, dueTomorrow: 6 } });
  });
});
