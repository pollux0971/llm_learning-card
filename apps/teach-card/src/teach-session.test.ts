/**
 * T37:教學卡視窗那一側的邏輯(`apps/teach-card/src/teach-session.ts`,純 TypeScript、不依賴 Svelte)。
 * 測試 agent 寫;開發 worker 不改。判斷與寫入在側車(ADR-077);這裡只量視窗:帶什麼給側車、怎麼收、
 * 記住上次的類別(D3)、側車忙時重試(D5)、出錯可以重試。
 *
 * 要實作的匯出(跟 06 的 `apps/test-card/src/session.ts` 同一個做法:注入 client / fs,不碰真的 Tauri、不碰真的 localStorage):
 *
 *   LAST_CATEGORY_KEY = 'lc-teach-last-category'
 *   BUSY_RETRY_MS = 300,BUSY_NOTICE_AFTER_MS = 1000,REQUEST_TIMEOUT_MS = 180_000(要跟 Rust 的 REQUEST_TIMEOUT 一樣,見最後一組)
 *   BUSY_MESSAGE = '考試卡正在批改,稍等一下。',FINISHED_MESSAGE = '這個類別已經學完了。可以考慮補充更多素材。'
 *
 *   createTeachSession(deps: {
 *     client: Pick<ReviewClient, 'teachOpen' | 'teachNext' | 'teachSwitch' | 'teachPrereq'>;
 *     fs: Pick<LearningFs, 'read'>;
 *     storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
 *     sleep?: (ms: number) => Promise<void>;   // 預設真的計時器
 *     now?: () => number;                      // 預設 Date.now
 *   }): TeachSession
 *
 *   TeachSession = {
 *     view(): TeachView;
 *     open(): Promise<void>;                    // 讀 storage 的上次類別 → client.teachOpen(類別 | 沒有)
 *     next(): Promise<void>;                    // client.teachNext()
 *     openCategories(): void;                   // 「換類別」:換成清單畫面,不呼叫側車
 *     cancelCategories(): void;                 // 清單最下面的「取消」:回到卡片,不呼叫側車
 *     chooseCategory(id: string): Promise<void>;// 選目前的那列 = 取消(不呼叫側車、不標學過);選別的 = client.teachSwitch(id)
 *     followPrereq(index: number): Promise<void>;// client.teachPrereq(index)
 *     retry(): Promise<void>;                   // 出錯畫面的「再試一次」:重送上一個動作(同樣的參數)
 *   }
 *   TeachView = {
 *     state: 'loading' | 'card' | 'finished' | 'categories' | 'error';
 *     category: string | undefined;
 *     card: { id: string; path: string; title: string } | undefined;
 *     cardText: string | undefined;             // fs.read(card.path) 讀到的原文;finished / error 時 undefined
 *     prereqs: { id: string; title: string }[]; // 側車給的未學先備
 *     categories: { id: string; label: string; current: boolean }[];   // 清單畫面用(state 不管是什麼都給,照側車的順序)
 *     canNext: boolean;                         // 類別學完時 false(按鈕列只剩「換類別」)
 *     waiting: boolean;                         // 側車忙超過 1 秒
 *     busyNotice: string | undefined;           // waiting 時是 BUSY_MESSAGE,否則 undefined
 *     controlsDisabled: boolean;                // 側車忙、重試中:按鈕停用
 *     message: string | undefined;              // finished 時是 FINISHED_MESSAGE;error 時是固定字樣
 *     canRetry: boolean;                        // error 時 true
 *   }
 *   類別清單每一列的 label:「<名稱> · 剩 N 張」;剩 0 張寫「<名稱> · 學完了」;require_raw 的類別在名稱後面加「需要素材」;目前的類別加「(目前)」。
 *   側車回錯誤(ReviewError):不是 busy 就直接進 error,message 是 ReviewError 的 message(側車的固定句子)。
 *   busy:每 300 ms 重試同一個動作;超過 1 秒 waiting;一直 busy 到 180 秒(用注入的 now 量)就停止重試,
 *   進 error,message 是 `timeout` 的固定字樣(protocol 的 ERROR_MESSAGES.timeout),可以 retry。
 *
 * 模組還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const ROOT = join(import.meta.dirname, '../../..');
const SESSION = pathToFileURL(join(import.meta.dirname, 'teach-session.ts')).href;
const CLIENT = pathToFileURL(join(ROOT, 'apps/desktop/src/webview/review-client.ts')).href;
const PROTOCOL = pathToFileURL(join(ROOT, 'packages/core/src/session/protocol.ts')).href;

type Obj = Record<string, unknown>;
interface Row {
  id: string;
  name: string;
  remaining: number;
  requireRaw: boolean;
}
interface ServerView {
  category: string;
  categories: Row[];
  card: { id: string; path: string; title: string } | null;
  prereqs: { id: string; title: string }[];
}
interface View {
  state: string;
  category: string | undefined;
  card: { id: string; path: string; title: string } | undefined;
  cardText: string | undefined;
  prereqs: { id: string; title: string }[];
  categories: { id: string; label: string; current: boolean }[];
  canNext: boolean;
  waiting: boolean;
  busyNotice: string | undefined;
  controlsDisabled: boolean;
  message: string | undefined;
  canRetry: boolean;
}
interface Session {
  view(): View;
  open(): Promise<void>;
  next(): Promise<void>;
  openCategories(): void;
  cancelCategories(): void;
  chooseCategory(id: string): Promise<void>;
  followPrereq(index: number): Promise<void>;
  retry(): Promise<void>;
}
interface SessionModule {
  createTeachSession(deps: Obj): Session;
  LAST_CATEGORY_KEY: string;
  BUSY_RETRY_MS: number;
  BUSY_NOTICE_AFTER_MS: number;
  REQUEST_TIMEOUT_MS: number;
  BUSY_MESSAGE: string;
  FINISHED_MESSAGE: string;
}
interface ClientModule {
  ReviewError: new (kind: string, message: string) => Error & { kind: string };
}

const mod = async (): Promise<SessionModule> => (await import(/* @vite-ignore */ SESSION)) as SessionModule;
const clientMod = async (): Promise<ClientModule> => (await import(/* @vite-ignore */ CLIENT)) as ClientModule;

const ROWS: Row[] = [
  { id: 'security', name: '資安', remaining: 3, requireRaw: true },
  { id: 'language', name: '語言', remaining: 4, requireRaw: false },
  { id: 'network', name: '網路', remaining: 0, requireRaw: false },
];
const CARD2 = { id: 'sec-0002', path: 'cards/security/sec-0002.md', title: '跨來源資源共享' };
const CARD3 = { id: 'sec-0003', path: 'cards/security/sec-0003.md', title: '同源政策' };
const server = (over: Partial<ServerView> = {}): ServerView => ({ category: 'security', categories: ROWS, card: CARD2, prereqs: [], ...over });

interface Call {
  method: string;
  args: unknown[];
}
type Step = ServerView | Error | (() => ServerView | Error);

interface Rig {
  session: Session;
  calls: Call[];
  reads: string[];
  store: Map<string, string>;
  sleeps: number[];
  clock: { t: number };
  /** 之後的呼叫依序用這些結果;用完就一直用最後一個 */
  script(...steps: Step[]): void;
}

async function rig(opts: { stored?: string; onCall?: (n: number, call: Call) => void } = {}): Promise<Rig> {
  const m = await mod();
  const calls: Call[] = [];
  const reads: string[] = [];
  const store = new Map<string, string>();
  if (opts.stored !== undefined) store.set('lc-teach-last-category', opts.stored);
  const sleeps: number[] = [];
  const clock = { t: 0 };
  let steps: Step[] = [server()];
  let n = 0;
  const run = (method: string) => async (...args: unknown[]): Promise<Obj> => {
    // 尾端的 undefined 不算引數:teachOpen() 與 teachOpen(undefined) 一樣
    const trimmed = [...args];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === undefined) trimmed.pop();
    const call = { method, args: trimmed };
    calls.push(call);
    n += 1;
    opts.onCall?.(n, call);
    const raw = steps.length > 1 ? steps.shift()! : steps[0]!;
    const step = typeof raw === 'function' ? raw() : raw;
    if (step instanceof Error) throw step;
    return step as unknown as Obj;
  };
  const session = m.createTeachSession({
    client: { teachOpen: run('teachOpen'), teachNext: run('teachNext'), teachSwitch: run('teachSwitch'), teachPrereq: run('teachPrereq') },
    fs: {
      async read(path: string): Promise<string> {
        reads.push(path);
        return `TEXT:${path}`;
      },
    },
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock.t += ms;
      // 安全網:重試沒有上限的話,假時鐘會一路跑下去、把事件迴圈佔滿(測試逾時也救不了)。超過 1000 次就丟錯,讓它變成「紅」而不是「卡住」。
      if (sleeps.length > 1000) throw new Error('重試超過 1000 次還沒停(沒有上限)');
    },
    now: () => clock.t,
  });
  return {
    session,
    calls,
    reads,
    store,
    sleeps,
    clock,
    script: (...s) => {
      steps = s;
    },
  };
}

const busy = async (): Promise<Error> => new ((await clientMod()).ReviewError)('busy', '已經有一個請求正在處理。');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('常數與固定字樣', () => {
  it('鍵名、重試間隔、等候提示的時間、字樣照 ADR-077', async () => {
    const m = await mod();
    expect(m.LAST_CATEGORY_KEY).toBe('lc-teach-last-category');
    expect(m.BUSY_RETRY_MS).toBe(300);
    expect(m.BUSY_NOTICE_AFTER_MS).toBe(1000);
    expect(m.REQUEST_TIMEOUT_MS).toBe(180_000);
    expect(m.BUSY_MESSAGE).toBe('考試卡正在批改,稍等一下。');
    expect(m.FINISHED_MESSAGE).toBe('這個類別已經學完了。可以考慮補充更多素材。');
  });

  it('逾時上限跟 Rust 的 REQUEST_TIMEOUT 一樣(讀 review_sidecar.rs 的原始檔比對,不一樣就紅)', async () => {
    const m = await mod();
    const rust = readFileSync(join(ROOT, 'apps/desktop/src-tauri/src/review_sidecar.rs'), 'utf8');
    const found = /pub const REQUEST_TIMEOUT: Duration = Duration::from_secs\((\d+)\)/.exec(rust);
    expect(found, 'review_sidecar.rs 找不到 REQUEST_TIMEOUT').not.toBeNull();
    expect(m.REQUEST_TIMEOUT_MS).toBe(Number(found![1]) * 1000);
  });

  it('逾時畫面的字樣就是 protocol 的 timeout 固定句子', async () => {
    const p = (await import(/* @vite-ignore */ PROTOCOL)) as { ERROR_MESSAGES: Record<string, string> };
    expect(p.ERROR_MESSAGES.timeout).toBe('等候回覆的時間過了。');
  });
});

describe('open:帶上次的類別去、記住這次的類別(D3)', () => {
  it('storage 沒有:teachOpen 不帶類別;顯示側車給的卡、讀它的檔;記下側車回的類別', async () => {
    const r = await rig();
    r.script(server({ prereqs: [{ id: 'sec-0001', title: '同源' }] }));
    await r.session.open();
    expect(r.calls).toEqual([{ method: 'teachOpen', args: [] }]);
    const v = r.session.view();
    expect(v.state).toBe('card');
    expect(v.category).toBe('security');
    expect(v.card).toEqual(CARD2);
    expect(v.cardText).toBe('TEXT:cards/security/sec-0002.md');
    expect(r.reads).toEqual(['cards/security/sec-0002.md']);
    expect(v.prereqs).toEqual([{ id: 'sec-0001', title: '同源' }]);
    expect(v.canNext).toBe(true);
    expect(v.message).toBeUndefined();
    expect(r.store.get('lc-teach-last-category')).toBe('security');
  });

  it('storage 有上次的類別:原樣帶給側車', async () => {
    const r = await rig({ stored: 'language' });
    r.script(server({ category: 'language', card: { id: 'lang-0003', path: 'cards/language/lang-0003.md', title: '語態' } }));
    await r.session.open();
    expect(r.calls).toEqual([{ method: 'teachOpen', args: ['language'] }]);
    expect(r.session.view().category).toBe('language');
  });

  it('側車退回了第一個類別(上次的類別已經不在設定檔):記下側車回的,不是原本存的', async () => {
    const r = await rig({ stored: 'gone' });
    r.script(server());
    await r.session.open();
    expect(r.store.get('lc-teach-last-category')).toBe('security');
  });

  it('類別學完(card 是 null):finished,學完的字樣,不能按下一個,沒有卡片內容、不讀檔', async () => {
    const r = await rig();
    r.script(server({ card: null }));
    await r.session.open();
    const v = r.session.view();
    expect(v.state).toBe('finished');
    expect(v.message).toBe('這個類別已經學完了。可以考慮補充更多素材。');
    expect(v.canNext).toBe(false);
    expect(v.card).toBeUndefined();
    expect(v.cardText).toBeUndefined();
    expect(r.reads).toEqual([]);
  });
});

describe('next / 換類別 / 先備', () => {
  it('next:呼叫 teachNext、顯示新的卡、讀新的檔', async () => {
    const r = await rig();
    r.script(server(), server({ card: CARD3 }));
    await r.session.open();
    await r.session.next();
    expect(r.calls.map((c) => c.method)).toEqual(['teachOpen', 'teachNext']);
    expect(r.session.view().card).toEqual(CARD3);
    expect(r.session.view().cardText).toBe('TEXT:cards/security/sec-0003.md');
    expect(r.reads).toEqual([CARD2.path, CARD3.path]);
  });

  it('next 把類別按完:finished', async () => {
    const r = await rig();
    r.script(server(), server({ card: null }));
    await r.session.open();
    await r.session.next();
    expect(r.session.view().state).toBe('finished');
  });

  it('openCategories:換成清單畫面,不呼叫側車;每列的字樣照規格、順序照側車', async () => {
    const r = await rig();
    await r.session.open();
    const before = r.calls.length;
    r.session.openCategories();
    expect(r.calls.length).toBe(before);
    const v = r.session.view();
    expect(v.state).toBe('categories');
    expect(v.categories.map((c) => c.id)).toEqual(['security', 'language', 'network']);
    const [sec, lang, net] = v.categories as [View['categories'][number], View['categories'][number], View['categories'][number]];
    expect(sec.current).toBe(true);
    expect(lang.current).toBe(false);
    expect(sec.label).toContain('資安');
    expect(sec.label).toContain('剩 3 張');
    expect(sec.label).toContain('需要素材');
    expect(sec.label.indexOf('資安')).toBeLessThan(sec.label.indexOf('需要素材'));
    expect(sec.label).toContain('(目前)');
    expect(lang.label).toContain('語言');
    expect(lang.label).toContain('剩 4 張');
    expect(lang.label).not.toContain('需要素材');
    expect(lang.label).not.toContain('(目前)');
    expect(net.label).toContain('網路');
    expect(net.label).toContain('學完了');
    expect(net.label).not.toContain('剩');
  });

  it('選目前的那一列 = 取消:回到卡片,不呼叫側車、不改記住的類別', async () => {
    const r = await rig({ stored: 'security' });
    await r.session.open();
    r.session.openCategories();
    const before = r.calls.length;
    await r.session.chooseCategory('security');
    expect(r.calls.length).toBe(before);
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().card).toEqual(CARD2);
    expect(r.store.get('lc-teach-last-category')).toBe('security');
  });

  it('cancelCategories:回到卡片,不呼叫側車', async () => {
    const r = await rig();
    await r.session.open();
    r.session.openCategories();
    const before = r.calls.length;
    r.session.cancelCategories();
    expect(r.calls.length).toBe(before);
    expect(r.session.view().state).toBe('card');
  });

  it('選別的類別:teachSwitch(那個 id);顯示新類別的卡;記住新類別', async () => {
    const r = await rig();
    const lang = server({ category: 'language', card: { id: 'lang-0003', path: 'cards/language/lang-0003.md', title: '語態' } });
    r.script(server(), lang);
    await r.session.open();
    r.session.openCategories();
    await r.session.chooseCategory('language');
    expect(r.calls.at(-1)).toEqual({ method: 'teachSwitch', args: ['language'] });
    const v = r.session.view();
    expect(v.state).toBe('card');
    expect(v.category).toBe('language');
    expect(v.cardText).toBe('TEXT:cards/language/lang-0003.md');
    expect(r.store.get('lc-teach-last-category')).toBe('language');
  });

  it('跟著先備走:teachPrereq(index);顯示先備那張;類別不變', async () => {
    const r = await rig();
    r.script(server({ prereqs: [{ id: 'sec-0001', title: '同源' }] }), server({ card: { id: 'sec-0001', path: 'cards/security/sec-0001.md', title: '同源' } }));
    await r.session.open();
    await r.session.followPrereq(0);
    expect(r.calls.at(-1)).toEqual({ method: 'teachPrereq', args: [0] });
    expect(r.session.view().card?.id).toBe('sec-0001');
    expect(r.store.get('lc-teach-last-category')).toBe('security');
  });
});

describe('側車忙(busy):每 300 ms 重試,超過 1 秒顯示等候字樣、按鈕停用(D5)', () => {
  it('忙了幾次又好了:每次睡 300 ms;1 秒之前沒有等候字樣;超過 1 秒有;好了之後都收起來,顯示新的卡', async () => {
    const snapshots: { t: number; waiting: boolean; notice: string | undefined; disabled: boolean }[] = [];
    let ref: Rig | undefined;
    const r = await rig({
      onCall: (n) => {
        const v = ref!.session.view();
        snapshots.push({ t: ref!.clock.t, waiting: v.waiting, notice: v.busyNotice, disabled: v.controlsDisabled });
        void n;
      },
    });
    ref = r;
    const err = await busy();
    r.script(server(), err, err, err, err, err, server({ card: CARD3 }));
    await r.session.open();
    await r.session.next();
    expect(r.sleeps).toEqual([300, 300, 300, 300, 300]);
    // snapshots[0] 是 open;[1] 是 next 的第一次(t=0);[2..6] 是重試(t=300..1500)
    const retries = snapshots.slice(2);
    expect(retries.map((s) => s.t)).toEqual([300, 600, 900, 1200, 1500]);
    expect(retries.filter((s) => s.t <= 900).every((s) => !s.waiting && s.notice === undefined)).toBe(true);
    expect(retries.filter((s) => s.t >= 1200).every((s) => s.waiting && s.notice === '考試卡正在批改,稍等一下。')).toBe(true);
    expect(retries.every((s) => s.disabled)).toBe(true);
    const done = r.session.view();
    expect(done.state).toBe('card');
    expect(done.waiting).toBe(false);
    expect(done.busyNotice).toBeUndefined();
    expect(done.controlsDisabled).toBe(false);
    expect(done.card).toEqual(CARD3);
    expect(r.calls.filter((c) => c.method === 'teachNext')).toHaveLength(6);
  });

  it('open 與 switch 遇到 busy 也一樣重試', async () => {
    const r = await rig();
    const err = await busy();
    r.script(err, err, server());
    await r.session.open();
    expect(r.calls.map((c) => c.method)).toEqual(['teachOpen', 'teachOpen', 'teachOpen']);
    expect(r.session.view().state).toBe('card');
    r.script(err, server({ category: 'language', card: null }));
    await r.session.chooseCategory('language');
    expect(r.calls.slice(3).map((c) => c.method)).toEqual(['teachSwitch', 'teachSwitch']);
    expect(r.calls.at(-1)?.args).toEqual(['language']);
  });

  it('一直 busy:到 180 秒(注入的時鐘)就停止重試,出錯畫面是 timeout 的固定字樣加「再試一次」', async () => {
    const r = await rig();
    r.script(server());
    await r.session.open();
    const err = await busy();
    r.script(err);
    const before = r.calls.length;
    await r.session.next();
    const sent = r.calls.length - before;
    expect(sent, '300 ms 一次、180 秒:約 600 次').toBeGreaterThanOrEqual(600);
    expect(sent).toBeLessThanOrEqual(602);
    expect(r.sleeps.every((ms) => ms === 300)).toBe(true);
    expect(r.clock.t).toBeGreaterThanOrEqual(180_000);
    expect(r.clock.t).toBeLessThanOrEqual(181_000);
    const v = r.session.view();
    expect(v.state).toBe('error');
    expect(v.message).toBe('等候回覆的時間過了。');
    expect(v.canRetry).toBe(true);
    expect(v.waiting).toBe(false);
    expect(v.controlsDisabled).toBe(false);
    const after = r.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.calls.length, '停止之後不再送').toBe(after);
  });

  it('逾時之後按「再試一次」:重送同一個動作(teachNext),好了就回到卡片', async () => {
    const r = await rig();
    r.script(server());
    await r.session.open();
    r.script(await busy());
    await r.session.next();
    expect(r.session.view().state).toBe('error');
    r.script(server({ card: CARD3 }));
    await r.session.retry();
    expect(r.calls.at(-1)).toEqual({ method: 'teachNext', args: [] });
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().card).toEqual(CARD3);
    expect(r.session.view().canRetry).toBe(false);
  });
});

describe('其他錯誤:固定字樣、可以重試、不卡住', () => {
  it('next 遇到 teach-record-changed:出錯畫面顯示側車的固定句子;再試一次重送 teachNext', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    const text = '學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。';
    r.script(new ReviewError('teach-record-changed', text));
    await r.session.next();
    const v = r.session.view();
    expect(v.state).toBe('error');
    expect(v.message).toBe(text);
    expect(v.canRetry).toBe(true);
    expect(r.sleeps, '不是 busy:不睡、不自己重試').toEqual([]);
    r.script(server({ card: CARD3 }));
    await r.session.retry();
    expect(r.calls.filter((c) => c.method === 'teachNext')).toHaveLength(2);
    expect(r.session.view().state).toBe('card');
  });

  it('open 失敗:再試一次重送 teachOpen,帶同一個記住的類別', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig({ stored: 'language' });
    r.script(new ReviewError('sidecar-unavailable', '複習輔助程式無法啟動。'));
    await r.session.open();
    expect(r.session.view().state).toBe('error');
    expect(r.session.view().message).toBe('複習輔助程式無法啟動。');
    r.script(server({ category: 'language' }));
    await r.session.retry();
    expect(r.calls.map((c) => c.method)).toEqual(['teachOpen', 'teachOpen']);
    expect(r.calls[1]!.args).toEqual(['language']);
    expect(r.session.view().state).toBe('card');
  });

  it('switch 失敗:再試一次重送 teachSwitch,同一個類別', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    r.script(new ReviewError('sidecar-exited', '複習輔助程式已經結束。'));
    await r.session.chooseCategory('network');
    expect(r.session.view().state).toBe('error');
    r.script(server({ category: 'network', card: null }));
    await r.session.retry();
    expect(r.calls.at(-1)).toEqual({ method: 'teachSwitch', args: ['network'] });
    expect(r.store.get('lc-teach-last-category')).toBe('network');
  });

  it('prereq 失敗(bad-request):再試一次重送 teachPrereq,同一個 index', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    r.script(new ReviewError('bad-request', '這一列不是合法的請求。'));
    await r.session.followPrereq(1);
    expect(r.session.view().state).toBe('error');
    r.script(server());
    await r.session.retry();
    expect(r.calls.at(-1)).toEqual({ method: 'teachPrereq', args: [1] });
  });

  it('出錯的時候沒有把「記住的類別」改掉', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig({ stored: 'security' });
    await r.session.open();
    r.script(new ReviewError('internal', '內部發生問題,請稍後再試。'));
    await r.session.chooseCategory('language');
    expect(r.store.get('lc-teach-last-category')).toBe('security');
  });
});
