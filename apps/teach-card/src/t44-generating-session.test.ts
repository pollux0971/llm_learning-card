/**
 * T44(教學卡生成中的畫面要跟著更新)session 層測試:第二道防線 + 變更通知。測試 agent 寫;開發 worker 不改。
 * 渲染(真的畫 App.svelte)在 `t44-generating-render.test.ts`;這裡只看 `teach-session.ts`。
 *
 *   防線(工單第 7 條):生成中呼叫 next() / chooseCategory(別的類別) / followPrereq(i):送出 0 個側車請求,view() 不變
 *   (不進出錯畫面、不改目前那張、generating 仍是 true)。F2 不能只靠畫面把按鈕停用。back()、openCategories() 本來就直接 return,照舊。
 *   通知(工單「做法建議」:`onChange(listener): () => void`,形狀照 onWait):
 *     teach.deepen 回 generating:true 之後通知一次;每次 teach.poll 回來之後通知;結束(成功、錯誤、取消)之後通知;
 *     teach.deepen 直接回子卡(已有子卡)時,在子卡之前不通知生成中(不閃);取消訂閱之後不再通知。
 *     這幾條綁做法的名字 `onChange`;工單說只有 worker 照建議做才算,這裡照建議寫,渲染測試 a、d、f 是不綁名字的主證據。
 *   T40 的靜態測試(t40-busy.test.ts)照舊管 teach-session.ts 不出現 setTimeout / sleep / now / busy / .message。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// 每條都動態載入模組,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

const SESSION = pathToFileURL(join(import.meta.dirname, 'teach-session.ts')).href;

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
  generating: boolean;
  generatingNotice: string | undefined;
  from: { id: string; title: string } | undefined;
  message: string | undefined;
  prereqs: { id: string; title: string }[];
  categories: { id: string; label: string; current: boolean }[];
}
interface Session {
  view(): View;
  open(): Promise<void>;
  next(): Promise<void>;
  deepen(): Promise<void>;
  cancel(): Promise<void>;
  chooseCategory(id: string): Promise<void>;
  followPrereq(index: number): Promise<void>;
  back(): Promise<void>;
  openCategories(): void;
}
interface SessionModule {
  createTeachSession(deps: Obj): Session;
}

const ROWS = [
  { id: 'security', name: '資安', remaining: 2, requireRaw: true },
  { id: 'network', name: '網路', remaining: 2, requireRaw: false },
];
const PARENT = { id: 'sec-0002', path: 'cards/security/sec-0002.md', title: '父卡標題' };
const CHILD = { id: 'sec-0004', path: 'cards/security/sec-0004.md', title: '子卡標題' };
const view = (over: Partial<ServerView> = {}): ServerView => ({
  category: 'security',
  categories: ROWS,
  card: PARENT,
  prereqs: [{ id: 'sec-0001', title: '先備卡' }],
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
  /** 側車請求的紀錄(只記 client 方法名;open 之後才開始算) */
  calls: string[];
  script(method: string, ...steps: Step[]): void;
  /** 下一次 teachPoll 被攔住(回應之前) */
  holdPoll(): { release(): void; reached: Promise<void> };
  /** 每次通知時 view() 的快照(沒有 onChange 的實作:空) */
  notified: View[];
  /** 通知的順序(跟 calls 交錯,看「第幾個請求之後通知」) */
  trace: string[];
  subscribe(): (() => void) | undefined;
}

async function rig(): Promise<Rig> {
  const m = (await import(/* @vite-ignore */ SESSION)) as SessionModule;
  const calls: string[] = [];
  const trace: string[] = [];
  const notified: View[] = [];
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
  let pollGate: Promise<void> | undefined;
  let pollReached: (() => void) | undefined;
  const run = (method: string) => async (): Promise<Obj> => {
    calls.push(method);
    trace.push(method);
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
  const session = m.createTeachSession({
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
    fs: { read: async (path: string): Promise<string> => `TEXT:${path}`, ...{ assetUrl: (relPath: string): string => `fake://asset/${relPath}` } }, // T46:補 assetUrl(展開,基底也過 tsc)
    storage: { getItem: () => null, setItem: () => undefined },
    pause: async () => undefined,
  });
  return {
    session,
    calls,
    trace,
    notified,
    script: (method, ...steps) => {
      scripts[method] = steps;
    },
    holdPoll: () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let reachedResolve!: () => void;
      const reached = new Promise<void>((r) => {
        reachedResolve = r;
      });
      pollGate = gate;
      pollReached = reachedResolve;
      return { release, reached };
    },
    subscribe: () => {
      const on = (session as unknown as { onChange?: (listener: () => void) => () => void }).onChange;
      if (typeof on !== 'function') return undefined;
      return on.call(session, () => {
        notified.push(session.view());
        trace.push('notify');
      });
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await tick();
};

describe('第二道防線:生成中 next / chooseCategory / followPrereq 不送請求、view 不變(工單第 7 條)', () => {
  async function generatingRig(): Promise<{ r: Rig; gate: { release(): void; reached: Promise<void> }; deepening: Promise<void> }> {
    const r = await rig();
    await r.session.open();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING);
    const gate = r.holdPoll();
    const deepening = r.session.deepen();
    await gate.reached;
    expect(r.session.view().generating, '前提:現在是生成中').toBe(true);
    return { r, gate, deepening };
  }

  it('next():0 個請求;view() 不變(還是原本那張、state card、generating true)', async () => {
    const { r, gate, deepening } = await generatingRig();
    const callsBefore = [...r.calls];
    const viewBefore = r.session.view();
    await r.session.next();
    expect(r.calls, 'next 不能送 teachNext').toEqual(callsBefore);
    expect(r.session.view()).toEqual(viewBefore);
    expect(r.session.view()).toMatchObject({ state: 'card', generating: true, card: PARENT });
    r.script('teachPoll', view());
    gate.release();
    await deepening;
  });

  it('chooseCategory(別的類別):0 個請求;view() 不變', async () => {
    const { r, gate, deepening } = await generatingRig();
    const callsBefore = [...r.calls];
    const viewBefore = r.session.view();
    await r.session.chooseCategory('network');
    expect(r.calls, 'chooseCategory 不能送 teachSwitch').toEqual(callsBefore);
    expect(r.session.view()).toEqual(viewBefore);
    expect(r.session.view()).toMatchObject({ state: 'card', generating: true, card: PARENT });
    r.script('teachPoll', view());
    gate.release();
    await deepening;
  });

  it('followPrereq(0):0 個請求;view() 不變', async () => {
    const { r, gate, deepening } = await generatingRig();
    const callsBefore = [...r.calls];
    const viewBefore = r.session.view();
    await r.session.followPrereq(0);
    expect(r.calls, 'followPrereq 不能送 teachPrereq').toEqual(callsBefore);
    expect(r.session.view()).toEqual(viewBefore);
    expect(r.session.view()).toMatchObject({ state: 'card', generating: true, card: PARENT });
    r.script('teachPoll', view());
    gate.release();
    await deepening;
  });

  it('三個都連續呼叫:仍然 0 個新請求;之後生成結束,session 照常能用(下一個送得出去)', async () => {
    const { r, gate, deepening } = await generatingRig();
    const callsBefore = [...r.calls];
    await r.session.next();
    await r.session.chooseCategory('network');
    await r.session.followPrereq(0);
    expect(r.calls).toEqual(callsBefore);
    r.script('teachPoll', CHILD_VIEW);
    gate.release();
    await deepening;
    expect(r.session.view()).toMatchObject({ state: 'card', generating: false, card: CHILD });
    r.script('teachNext', view({ card: PARENT }));
    await r.session.next();
    expect(r.calls.at(-1), '生成結束之後 next 恢復').toBe('teachNext');
  });

  it('生成中 back() 與 openCategories() 本來就直接 return:照舊(0 個請求、view 不變)', async () => {
    const { r, gate, deepening } = await generatingRig();
    const callsBefore = [...r.calls];
    const viewBefore = r.session.view();
    await r.session.back();
    r.session.openCategories();
    expect(r.calls).toEqual(callsBefore);
    expect(r.session.view()).toEqual(viewBefore);
    r.script('teachPoll', view());
    gate.release();
    await deepening;
  });

  it('對照:沒有在生成時 next / chooseCategory / followPrereq 照常送請求(防線只管生成中)', async () => {
    const r = await rig();
    await r.session.open();
    r.script('teachNext', view());
    await r.session.next();
    r.script('teachSwitch', view({ category: 'network', card: PARENT }));
    await r.session.chooseCategory('network');
    r.script('teachPrereq', view({ card: CHILD }));
    await r.session.followPrereq(0);
    expect(r.calls).toEqual(['teachOpen', 'teachNext', 'teachSwitch', 'teachPrereq']);
  });
});

describe('變更通知 session.onChange(listener) → 取消訂閱函式(工單「做法建議」)', () => {
  it('有 onChange,而且回傳取消訂閱的函式', async () => {
    const r = await rig();
    const off = r.subscribe();
    expect(typeof off, 'session 要有 onChange(listener) 並回傳取消訂閱函式').toBe('function');
  });

  it('生成路徑:teach.deepen 回 generating:true 之後通知一次(看得到生成中);之後每次 teach.poll 回來都通知;結束再通知(生成中已經是 false、畫面已換成子卡)', async () => {
    const r = await rig();
    await r.session.open();
    r.subscribe();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING, GENERATING, CHILD_VIEW);
    await r.session.deepen();
    await settle();
    // 順序:deepen 的請求 → 通知(生成中)→ poll → 通知 → poll → 通知 → poll → 通知(結束)
    const notifies = r.trace.filter((t) => t === 'notify').length;
    expect(notifies, '1 次開始 + 3 次 poll(其中最後一次就是結束)').toBeGreaterThanOrEqual(4);
    const afterDeepen = r.trace.indexOf('teachDeepen');
    expect(r.trace[afterDeepen + 1], 'teach.deepen 回 generating:true 之後馬上通知').toBe('notify');
    expect(r.notified[0]?.generating, '第一次通知時畫面是生成中').toBe(true);
    expect(r.notified[0]?.generatingNotice).toBeTruthy();
    // 每個 teachPoll 之後都有通知
    r.trace.forEach((t, i) => {
      if (t === 'teachPoll') expect(r.trace.slice(i + 1).includes('notify'), `第 ${i} 個 teachPoll 之後要有通知`).toBe(true);
    });
    const last = r.notified.at(-1)!;
    expect(last.generating).toBe(false);
    expect(last.card).toEqual(CHILD);
    expect(last.from).toEqual({ id: PARENT.id, title: PARENT.title });
    // 中間幾次通知,畫面都還是生成中、還是原本那張
    for (const mid of r.notified.slice(0, -1)) {
      expect(mid.generating).toBe(true);
      expect(mid.card).toEqual(PARENT);
    }
  });

  it('輪詢拿到錯誤(deepen-failed):結束時通知,畫面回到可操作(generating false)', async () => {
    const r = await rig();
    await r.session.open();
    r.subscribe();
    const { ReviewError } = (await import(/* @vite-ignore */ pathToFileURL(join(import.meta.dirname, '../../desktop/src/webview/review-client.ts')).href)) as {
      ReviewError: new (kind: string, message: string) => Error;
    };
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', new ReviewError('deepen-failed', 'x') as unknown as Error);
    await r.session.deepen();
    await settle();
    expect(r.notified.length).toBeGreaterThanOrEqual(2);
    expect(r.notified[0]?.generating).toBe(true);
    expect(r.notified.at(-1)?.generating).toBe(false);
  });

  it('取消:cancel() 結束之後通知,畫面回到原本那張、不是生成中', async () => {
    const r = await rig();
    await r.session.open();
    r.subscribe();
    r.script('teachDeepen', GENERATING);
    r.script('teachPoll', GENERATING);
    r.script('teachCancel', view());
    const gate = r.holdPoll();
    const deepening = r.session.deepen();
    await gate.reached;
    const cancelling = r.session.cancel();
    gate.release();
    await cancelling;
    await deepening;
    await settle();
    const last = r.notified.at(-1);
    expect(last, '取消完成之後有通知').toBeDefined();
    expect(last?.generating).toBe(false);
    expect(last?.card).toEqual(PARENT);
  });

  it('不閃:teach.deepen 直接回子卡(已有子卡)時,每一次通知的畫面都不是生成中;而且至少通知一次(畫面要換成子卡)', async () => {
    const r = await rig();
    await r.session.open();
    r.subscribe();
    r.script('teachDeepen', CHILD_VIEW);
    // 送出 teach.deepen 的當下(還不知道是不是要生成)不能通知:通知出現的時候 view() 都不是生成中
    const deepening = r.session.deepen();
    await deepening;
    await settle();
    expect(r.notified.length).toBeGreaterThanOrEqual(1);
    for (const n of r.notified) expect(n.generating, '子卡路徑不能通知出生成中').toBe(false);
    expect(r.notified.at(-1)?.card).toEqual(CHILD);
    // 通知不早於 teach.deepen 的回應:trace 裡 notify 都在 teachDeepen 之後
    const at = r.trace.indexOf('teachDeepen');
    expect(r.trace.slice(0, at).includes('notify')).toBe(false);
  });

  it('取消訂閱之後不再通知', async () => {
    const r = await rig();
    await r.session.open();
    const off = r.subscribe();
    expect(off).toBeDefined();
    off!();
    r.script('teachDeepen', CHILD_VIEW);
    await r.session.deepen();
    await settle();
    expect(r.notified).toEqual([]);
  });
});
