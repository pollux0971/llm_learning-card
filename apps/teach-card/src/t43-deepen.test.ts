/**
 * T43(ADR-079):教學卡視窗那一側的邏輯多了「深入這個」(`apps/teach-card/src/teach-session.ts`,純 TypeScript)。
 * 測試 agent 寫;開發 worker 不改。判斷與寫入在側車;這裡只量視窗:怎麼輪詢、怎麼取消、生成中什麼停用、錯誤怎麼顯示。
 *
 * 名字由這份測試固定(工單第 6 節只說了畫面長相,沒給 session 的名字):
 *   deps.client 多 teachDeepen / teachPoll / teachCancel / teachBack(見 apps/desktop/src/review-client-deepen.test.ts)
 *   deps.pause(ms): Promise<void>      ← 輪詢間隔用的**注入**等待函式(main.ts 給)。名字不能叫 sleep / now,也不能用 setTimeout:
 *                                          T40 的靜態測試(t40-busy.test.ts)禁止 teach-session.ts 出現那幾個字
 *   POLL_INTERVAL_MS = 500、GENERATING_MESSAGE = '正在產生更深入的卡片,可能要等幾十秒。'
 *   session.deepen() / session.cancel() / session.back()
 *   view() 多這些欄位:
 *     generating: boolean          生成中(deepen 的請求送出到結果回來之間,以及輪詢中)
 *     generatingNotice: string | undefined   生成中是 GENERATING_MESSAGE,否則 undefined
 *     canCancel: boolean           = generating
 *     canBack: boolean             側車畫面的 canBack,生成中 false(停用)
 *     canDeepen: boolean           card 畫面、不在生成中、沒有 controlsDisabled 才 true
 *     from: { id: string; title: string } | undefined   側車畫面的 from(null → undefined)
 *     deepenError: string | undefined       深入的錯誤字樣(卡片照舊顯示,不進 error 狀態);下一個動作開始時收掉
 *   輪詢:deepen() 的回應 generating: true → 每輪「pause(500) → teachPoll()」直到回應不是 generating;
 *   輪詢自己不判斷 busy(共用 client 重試),也不自己數時間。
 *   取消:cancel() 停止輪詢;手上那一個請求(poll 或 pause)回來之後送 teachCancel(),照它回的畫面顯示。
 *
 * 【這份測試替工單補的假設,之後顧問裁了再改】
 *   (h) credential-unavailable 的深入字樣顯示側車給的那句(err.message 的樣板);其他 kind 查 ERROR_MESSAGES。
 *       T40 的靜態測試禁止 teach-session.ts 出現 `.message`,所以實作要在 review-client.ts 補一個共用的取字函式。
 *   (i) 「側車回的、不是 Rust 那七個」的錯一律算「深入的錯誤」,留在卡片上;Rust 那七個(not-configured / sidecar-unavailable /
 *       sidecar-exited / timeout / busy / bad-envelope / bad-response)照 T40 進出錯畫面。
 *       注意:T40 的靜態測試禁止 teach-session.ts 出現 'busy' 字面,所以「是不是 client 這一層的錯」的判斷要放在 review-client.ts 匯出的函式。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// 每條都真的起檔案/行程,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

const ROOT = join(import.meta.dirname, '../../..');
const SESSION = pathToFileURL(join(import.meta.dirname, 'teach-session.ts')).href;
const CLIENT = pathToFileURL(join(ROOT, 'apps/desktop/src/webview/review-client.ts')).href;
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

type Obj = Record<string, unknown>;
interface ServerView {
  category: string;
  categories: { id: string; name: string; remaining: number; requireRaw: boolean }[];
  card: { id: string; path: string; title: string } | null;
  prereqs: { id: string; title: string }[];
  from: { id: string; title: string } | null;
  canBack: boolean;
  generating: boolean;
}
interface View {
  state: string;
  card: { id: string; path: string; title: string } | undefined;
  cardText: string | undefined;
  canNext: boolean;
  canBack: boolean;
  canDeepen: boolean;
  canCancel: boolean;
  generating: boolean;
  generatingNotice: string | undefined;
  from: { id: string; title: string } | undefined;
  deepenError: string | undefined;
  controlsDisabled: boolean;
  message: string | undefined;
  categories: { id: string; label: string; current: boolean }[];
}
interface Session {
  view(): View;
  open(): Promise<void>;
  next(): Promise<void>;
  deepen(): Promise<void>;
  cancel(): Promise<void>;
  back(): Promise<void>;
  openCategories(): void;
}
interface SessionModule {
  createTeachSession(deps: Obj): Session;
  POLL_INTERVAL_MS: number;
  GENERATING_MESSAGE: string;
}
interface ClientModule {
  ReviewError: new (kind: string, message: string) => Error & { kind: string };
}
interface ProtocolModule {
  ERROR_MESSAGES: Record<string, string>;
}

const mod = async (): Promise<SessionModule> => (await import(/* @vite-ignore */ SESSION)) as SessionModule;
const clientMod = async (): Promise<ClientModule> => (await import(/* @vite-ignore */ CLIENT)) as ClientModule;
const protocol = async (): Promise<ProtocolModule> => (await import(/* @vite-ignore */ PROTOCOL)) as ProtocolModule;

const ROWS = [{ id: 'security', name: '資安', remaining: 2, requireRaw: true }];
const PARENT = { id: 'sec-0002', path: 'cards/security/sec-0002.md', title: '父卡標題' };
const CHILD = { id: 'sec-0004', path: 'cards/security/sec-0004.md', title: '子卡標題' };
const view = (over: Partial<ServerView> = {}): ServerView => ({
  category: 'security',
  categories: ROWS,
  card: PARENT,
  prereqs: [],
  from: null,
  canBack: false,
  generating: false,
  ...over,
});
const GENERATING = view({ generating: true });
const CHILD_VIEW = view({ card: CHILD, from: { id: PARENT.id, title: PARENT.title }, canBack: true });

type Step = ServerView | Error | (() => ServerView | Error | Promise<ServerView | Error>);
interface Rig {
  session: Session;
  calls: string[];
  pauses: number[];
  reads: string[];
  /** 之後 method 的呼叫依序用這些結果;用完就一直用最後一個 */
  script(method: string, ...steps: Step[]): void;
  /** 下一次 pause 被攔住,直到 release */
  holdPause(): { release(): void; reached: Promise<void> };
  /** 下一次 teachPoll 被攔住(回應之前) */
  holdPoll(): { release(): void; reached: Promise<void> };
  snapshots: { at: string; view: View }[];
}

async function rig(): Promise<Rig> {
  const m = await mod();
  const calls: string[] = [];
  const pauses: number[] = [];
  const reads: string[] = [];
  const snapshots: { at: string; view: View }[] = [];
  const scripts: Record<string, Step[]> = {
    teachOpen: [view()],
    teachNext: [view()],
    teachDeepen: [view()],
    teachPoll: [view()],
    teachCancel: [view()],
    teachBack: [view()],
    teachSwitch: [view()],
    teachPrereq: [view()],
  };
  let pauseGate: Promise<void> | undefined;
  let pauseReached: (() => void) | undefined;
  let pollGate: Promise<void> | undefined;
  let pollReached: (() => void) | undefined;
  let session!: Session;
  const run = (method: string) => async (): Promise<Obj> => {
    calls.push(method);
    snapshots.push({ at: method, view: session.view() });
    if (method === 'teachPoll' && pollGate) {
      const gate = pollGate;
      pollGate = undefined;
      pollReached?.();
      await gate;
    }
    const list = scripts[method]!;
    const raw = list.length > 1 ? list.shift()! : list[0]!;
    const step = await (typeof raw === 'function' ? raw() : raw);
    if (step instanceof Error) throw step;
    return step as unknown as Obj;
  };
  session = m.createTeachSession({
    client: {
      teachOpen: run('teachOpen'),
      teachNext: run('teachNext'),
      teachSwitch: run('teachSwitch'),
      teachPrereq: run('teachPrereq'),
      teachDeepen: run('teachDeepen'),
      teachPoll: run('teachPoll'),
      teachCancel: run('teachCancel'),
      teachBack: run('teachBack'),
      onWait: () => () => undefined,
    },
    fs: {
      async read(path: string): Promise<string> {
        reads.push(path);
        return `TEXT:${path}`;
      },
      // T46:補 assetUrl(展開,基底也過 tsc)
      ...{ assetUrl: (relPath: string): string => `fake://asset/${relPath}` },
    },
    storage: { getItem: () => null, setItem: () => undefined },
    pause: async (ms: number) => {
      pauses.push(ms);
      calls.push('pause');
      snapshots.push({ at: 'pause', view: session.view() });
      if (pauseGate) {
        const gate = pauseGate;
        pauseGate = undefined;
        pauseReached?.();
        await gate;
      }
    },
  });
  const hold = (setGate: (g: Promise<void>, reached: () => void) => void) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let reachedResolve!: () => void;
    const reached = new Promise<void>((r) => {
      reachedResolve = r;
    });
    setGate(gate, reachedResolve);
    return { release, reached };
  };
  return {
    session,
    calls,
    pauses,
    reads,
    snapshots,
    script: (method, ...steps) => {
      scripts[method] = steps;
    },
    holdPause: () => hold((g, r) => { pauseGate = g; pauseReached = r; }),
    holdPoll: () => hold((g, r) => { pollGate = g; pollReached = r; }),
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('常數', () => {
  it('輪詢間隔 500 ms;生成中的字樣照工單', async () => {
    const m = await mod();
    expect(m.POLL_INTERVAL_MS).toBe(500);
    expect(m.GENERATING_MESSAGE).toBe('正在產生更深入的卡片,可能要等幾十秒。');
  });
});

describe('畫面欄位(側車畫面多的三個欄位對應到 view())', () => {
  it('open 之前:沒有生成、不能返回、不能深入;open 之後 card 畫面:能深入、不能返回、from 是 undefined', async () => {
    const r = await rig();
    expect(r.session.view()).toMatchObject({ generating: false, canBack: false, canDeepen: false, canCancel: false, from: undefined, deepenError: undefined, generatingNotice: undefined });
    await r.session.open();
    expect(r.session.view()).toMatchObject({ state: 'card', generating: false, canBack: false, canDeepen: true, canCancel: false, from: undefined });
  });

  it('側車畫面有 from 與 canBack:view() 帶出來(from 的 id、title);回上一層的按鈕可用', async () => {
    const r = await rig();
    r.script('teachOpen', CHILD_VIEW);
    await r.session.open();
    expect(r.session.view()).toMatchObject({ canBack: true, from: { id: PARENT.id, title: PARENT.title }, canDeepen: true });
  });

  it('類別學完了(card: null):不能深入、不能返回', async () => {
    const r = await rig();
    r.script('teachOpen', view({ card: null }));
    await r.session.open();
    expect(r.session.view()).toMatchObject({ state: 'finished', canDeepen: false });
  });
});

describe('Scenario: Existing children are reused(視窗這一側:一個請求就回新畫面,不輪詢)', () => {
  it('teachDeepen 的回應不是 generating:直接顯示第一張子卡;沒有 pause、沒有 teachPoll', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', CHILD_VIEW);
    await r.session.deepen();
    expect(r.calls).toEqual(['teachOpen', 'teachDeepen']);
    expect(r.pauses).toEqual([]);
    expect(r.session.view()).toMatchObject({ state: 'card', card: CHILD, from: { id: PARENT.id, title: PARENT.title }, canBack: true, generating: false });
    expect(r.reads.at(-1), '新卡的原文從新卡的路徑讀').toBe(CHILD.path);
    expect(r.session.view().cardText).toBe(`TEXT:${CHILD.path}`);
  });
});

describe('Scenario: Generation is visible and cancellable(視窗這一側)', () => {
  it('generating 回應 → 輪詢:每輪 pause(500) 再 teachPoll;直到回應不是 generating;最後顯示第一張新卡', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING, GENERATING, CHILD_VIEW);
    await r.session.deepen();
    expect(r.calls).toEqual(['teachOpen', 'teachDeepen', 'pause', 'teachPoll', 'pause', 'teachPoll', 'pause', 'teachPoll']);
    expect(r.pauses).toEqual([500, 500, 500]);
    expect(r.session.view()).toMatchObject({ state: 'card', card: CHILD, from: { id: PARENT.id }, generating: false, generatingNotice: undefined, canCancel: false });
    expect(r.reads.at(-1)).toBe(CHILD.path);
  });

  it('生成中:卡片照舊(還是原本那張)、generatingNotice 是工單那句、有取消;下一個 / 換類別 / 深入這個 / 回上一層都停用', async () => {
    const r = await rig();
    r.script('teachOpen', CHILD_VIEW); // 有 canBack,才量得出「回上一層」生成中也停用
    await r.session.open();
    r.script('teachDeepen', CHILD_VIEW.card === null ? GENERATING : { ...CHILD_VIEW, generating: true });
    r.script('teachPoll', { ...CHILD_VIEW, generating: true }, CHILD_VIEW);
    await r.session.deepen();
    const polled = r.snapshots.filter((s) => s.at === 'teachPoll');
    expect(polled.length).toBeGreaterThanOrEqual(1);
    for (const { view: v } of polled) {
      expect(v.generating).toBe(true);
      expect(v.generatingNotice).toBe('正在產生更深入的卡片,可能要等幾十秒。');
      expect(v.canCancel).toBe(true);
      expect(v.state, '卡片照舊顯示,不是 loading').toBe('card');
      expect(v.card?.id).toBe(CHILD.id);
      expect(v.cardText).toBe(`TEXT:${CHILD.path}`);
      expect(v.canNext).toBe(false);
      expect(v.canBack).toBe(false);
      expect(v.canDeepen).toBe(false);
      expect(v.controlsDisabled).toBe(true);
    }
  });

  it('teachDeepen 的請求還沒回的時候就已經是生成中(按鈕立刻停用,不能連按兩次);第二次 deepen() 不會多送請求', async () => {
    const r = await rig();
    await r.session.open();
    let release!: (v: ServerView) => void;
    r.script('teachDeepen', () => new Promise<ServerView>((resolve) => { release = resolve; }), CHILD_VIEW);
    const first = r.session.deepen();
    await tick();
    expect(r.session.view()).toMatchObject({ generating: true, canDeepen: false, controlsDisabled: true });
    await r.session.deepen();
    expect(r.calls.filter((c) => c === 'teachDeepen')).toHaveLength(1);
    release(CHILD_VIEW);
    await first;
    expect(r.session.view().card?.id).toBe(CHILD.id);
  });

  it('生成中打開類別清單沒有用(類別清單打不開)', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING, CHILD_VIEW);
    const h = r.holdPause();
    const running = r.session.deepen();
    await h.reached;
    r.session.openCategories();
    expect(r.session.view().state, '生成中不進清單').toBe('card');
    h.release();
    await running;
  });
});

describe('Scenario: Cancelling writes nothing(視窗這一側)', () => {
  it('取消時手上有一個 teachPoll 在途中:不再輪詢;poll 回來之後送一次 teachCancel,顯示它回的畫面(原本那張)', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING);
    r.script('teachCancel', view());
    const h = r.holdPoll();
    const running = r.session.deepen();
    await h.reached;
    const cancelling = r.session.cancel();
    await tick();
    expect(r.calls.filter((c) => c === 'teachCancel'), 'poll 還沒回來,不能先送取消').toHaveLength(0);
    h.release();
    await Promise.all([running, cancelling]);
    expect(r.calls.filter((c) => c === 'teachPoll')).toHaveLength(1);
    expect(r.calls.filter((c) => c === 'teachCancel')).toHaveLength(1);
    expect(r.calls.at(-1)).toBe('teachCancel');
    expect(r.session.view()).toMatchObject({ state: 'card', card: PARENT, generating: false, canCancel: false, canDeepen: true, canNext: true, controlsDisabled: false });
  });

  it('取消時正在等間隔(pause):間隔結束後不再 teachPoll,直接送 teachCancel', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachCancel', view());
    const h = r.holdPause();
    const running = r.session.deepen();
    await h.reached;
    const cancelling = r.session.cancel();
    h.release();
    await Promise.all([running, cancelling]);
    expect(r.calls).toEqual(['teachOpen', 'teachDeepen', 'pause', 'teachCancel']);
  });

  it('取消回來的畫面是「已經寫完」的新卡(工作在取消送到之前就完成了):顯示那張新卡,不是原本那張', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachCancel', CHILD_VIEW);
    const h = r.holdPause();
    const running = r.session.deepen();
    await h.reached;
    const cancelling = r.session.cancel();
    h.release();
    await Promise.all([running, cancelling]);
    expect(r.session.view()).toMatchObject({ card: CHILD, canBack: true, from: { id: PARENT.id }, generating: false });
    expect(r.reads.at(-1)).toBe(CHILD.path);
  });

  it('沒在生成時 cancel():什麼都不送', async () => {
    const r = await rig();
    await r.session.open();
    await r.session.cancel();
    expect(r.calls).toEqual(['teachOpen']);
  });

  it('取消之後可以再按深入(新的一輪從 pause 開始,不被舊的取消狀態卡住)', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachCancel', view());
    const h = r.holdPause();
    const running = r.session.deepen();
    await h.reached;
    const cancelling = r.session.cancel();
    h.release();
    await Promise.all([running, cancelling]);
    r.script('teachPoll', CHILD_VIEW);
    await r.session.deepen();
    expect(r.session.view()).toMatchObject({ card: CHILD, generating: false });
  });
});

describe('深入的錯誤:卡片照舊顯示,不進出錯畫面(場景:the current card stays on screen)', () => {
  it.each(['deepen-floor', 'no-model', 'deepen-failed', 'bad-request', 'internal', 'router-unavailable', 'root-mismatch'])(
    'teachDeepen 回 %s:state 還是 card、卡片還在、deepenError 是固定字樣、控制項恢復',
    async (kind) => {
      const { ReviewError } = await clientMod();
      const { ERROR_MESSAGES } = await protocol();
      const r = await rig();
      await r.session.open();
      r.script('teachDeepen', new ReviewError(kind, 'RAW 英文原文不該出現'));
      await r.session.deepen();
      const v = r.session.view();
      expect(v.state).toBe('card');
      expect(v.card).toEqual(PARENT);
      expect(v.deepenError).toBe(ERROR_MESSAGES[kind]);
      expect(v.deepenError).not.toContain('RAW');
      expect(v).toMatchObject({ generating: false, canDeepen: true, canNext: true, controlsDisabled: false });
      expect(v.message, '不是出錯畫面的 message').toBeUndefined();
    },
  );

  it('輪詢拿到 no-model:一樣留在卡片上,輪詢停止(不再 pause / teachPoll)', async () => {
    const { ReviewError } = await clientMod();
    const { ERROR_MESSAGES } = await protocol();
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING, new ReviewError('no-model', 'x'));
    await r.session.deepen();
    expect(r.calls).toEqual(['teachOpen', 'teachDeepen', 'pause', 'teachPoll', 'pause', 'teachPoll']);
    expect(r.session.view()).toMatchObject({ state: 'card', card: PARENT, deepenError: ERROR_MESSAGES['no-model'], generating: false });
  });

  it('(h)金鑰問題:credential-unavailable 顯示側車給的深入版那句(不是批改那句)', async () => {
    const { ReviewError } = await clientMod();
    const text = '產生新卡要用的金鑰沒有設定:OPENAI_API_KEY。請在專案根目錄的 .env 加上。';
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', new ReviewError('credential-unavailable', text));
    await r.session.deepen();
    expect(r.session.view().deepenError).toBe(text);
    expect(r.session.view().state).toBe('card');
  });

  it('(i)Rust 那七種(client 這一層的錯)照 T40 進出錯畫面,輪詢停止', async () => {
    const { ReviewError } = await clientMod();
    const { ERROR_MESSAGES } = await protocol();
    for (const kind of ['timeout', 'sidecar-exited', 'sidecar-unavailable', 'not-configured', 'bad-envelope', 'bad-response']) {
      const r = await rig();
      await r.session.open();
      r.script('teachDeepen', GENERATING);
      r.script('teachPoll', new ReviewError(kind, 'RAW'));
      await r.session.deepen();
      const v = r.session.view();
      expect(v.state, kind).toBe('error');
      expect(v.message, kind).toBe(ERROR_MESSAGES[kind]);
      expect(v.generating, kind).toBe(false);
      expect(v.deepenError, kind).toBeUndefined();
      expect(r.calls.filter((c) => c === 'teachPoll'), `${kind}:出錯就不再輪詢`).toHaveLength(1);
    }
  });

  it('深入的錯誤在下一個動作開始時收掉:next、back、再深入都會清掉', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', new ReviewError('no-model', 'x'), CHILD_VIEW);
    await r.session.deepen();
    expect(r.session.view().deepenError).toBeDefined();
    await r.session.next();
    expect(r.session.view().deepenError).toBeUndefined();

    r.script('teachDeepen', new ReviewError('no-model', 'x'), CHILD_VIEW);
    await r.session.deepen();
    expect(r.session.view().deepenError).toBeDefined();
    await r.session.deepen();
    expect(r.session.view().deepenError, '再按一次深入:字樣收掉').toBeUndefined();
    expect(r.session.view().card?.id).toBe(CHILD.id);
  });

  it('錯誤的字樣在生成中(重新按深入之後)不殘留:generating 時 deepenError 是 undefined', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', new ReviewError('deepen-failed', 'x'), GENERATING);
    await r.session.deepen();
    r.script('teachPoll', CHILD_VIEW);
    await r.session.deepen();
    const atPoll = r.snapshots.filter((s) => s.at === 'pause').at(-1)!;
    expect(atPoll.view.deepenError).toBeUndefined();
  });
});

describe('回上一層', () => {
  it('back():送 teachBack,顯示它回的畫面(父卡);from 沒了、canBack 變 false', async () => {
    const r = await rig();
    r.script('teachOpen', CHILD_VIEW);
    await r.session.open();
    r.script('teachBack', view());
    await r.session.back();
    expect(r.calls).toEqual(['teachOpen', 'teachBack']);
    expect(r.session.view()).toMatchObject({ state: 'card', card: PARENT, canBack: false, from: undefined });
    expect(r.reads.at(-1)).toBe(PARENT.path);
  });

  it('back() 的錯誤(例如 bad-request):留在卡片上,deepenError 是固定字樣', async () => {
    const { ReviewError } = await clientMod();
    const { ERROR_MESSAGES } = await protocol();
    const r = await rig();
    r.script('teachOpen', CHILD_VIEW);
    await r.session.open();
    r.script('teachBack', new ReviewError('bad-request', 'x'));
    await r.session.back();
    expect(r.session.view()).toMatchObject({ state: 'card', card: CHILD, deepenError: ERROR_MESSAGES['bad-request'] });
  });
});

describe('下一個 / 換類別照舊(深入沒有改壞原本的動作)', () => {
  it('深入成功之後 next():送 teachNext,畫面照側車回的', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', CHILD_VIEW);
    await r.session.deepen();
    r.script('teachNext', { ...CHILD_VIEW, card: { id: 'sec-0005', path: 'cards/security/sec-0005.md', title: '第二張子卡' } });
    await r.session.next();
    expect(r.calls.at(-1)).toBe('teachNext');
    expect(r.session.view().card?.id).toBe('sec-0005');
    expect(r.session.view().from?.id).toBe(PARENT.id);
  });
});

describe('靜態:輪詢用注入的等待函式,視窗長相照工單第 6 節', () => {
  const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('teach-session.ts 用 deps.pause 輪詢(而且 T40 的禁字清單照舊:沒有 sleep / now / setTimeout / busy)', () => {
    const code = strip(readFileSync(join(import.meta.dirname, 'teach-session.ts'), 'utf8'));
    expect(code).toMatch(/\bpause\b/);
    expect(code).toMatch(/teachPoll/);
    expect(code).toMatch(/teachCancel/);
    expect(code).not.toMatch(/\bsleep\b|\bnow\b|\bsetTimeout\b|\bsetInterval\b/);
    expect(code).not.toMatch(/['"`]busy['"`]/);
  });

  it('main.ts 把 pause 接上(瀏覽器與 Tauri 兩條 deps 都有),間隔由那裡的計時器做', () => {
    const code = strip(readFileSync(join(import.meta.dirname, 'main.ts'), 'utf8'));
    const hits = code.match(/\bpause\b/g) ?? [];
    expect(hits.length, '定義一個、兩條 deps(Tauri 與瀏覽器)各用一個').toBeGreaterThanOrEqual(3);
    expect(code).toMatch(/setTimeout/);
  });

  it('App.svelte:四顆按鈕「回上一層 / 下一個 / 換類別 / 深入這個」同一列、順序如此;生成中一行字與「取消」;標示列有「來自:」', () => {
    const svelte = readFileSync(join(import.meta.dirname, 'App.svelte'), 'utf8');
    const rows = [...svelte.matchAll(/<div class="controls">([\s\S]*?)<\/div>/g)].map((m) => m[1]!);
    const row = rows.find((text) => text.includes('下一個'));
    expect(row, '找不到有「下一個」的按鈕列').toBeDefined();
    const order = ['回上一層', '下一個', '換類別', '深入這個'].map((label) => row!.indexOf(label));
    expect(order.every((i) => i >= 0), `按鈕列要有四個標籤:${order.join(',')}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(svelte).toContain('generatingNotice');
    expect(svelte).toMatch(/取消/);
    expect(svelte).toContain('來自:');
    expect(svelte).toContain('view.from');
    expect(svelte).toContain('deepenError');
    expect(svelte).toMatch(/session\.cancel\(/);
    expect(svelte).toMatch(/session\.deepen\(/);
    expect(svelte).toMatch(/session\.back\(/);
  });

  it('App.svelte:provisional 的卡仍然有「待審核」標記(phase-1 就有,深入的新卡也用它)', () => {
    const svelte = readFileSync(join(import.meta.dirname, 'App.svelte'), 'utf8');
    expect(svelte).toContain('待審核');
    expect(svelte).toMatch(/frontmatter\.provisional/);
  });
});
