/**
 * T37:教學卡視窗那一側的邏輯(`apps/teach-card/src/teach-session.ts`,純 TypeScript、不依賴 Svelte)。
 * 測試 agent 寫;開發 worker 不改。判斷與寫入在側車(ADR-077);這裡只量視窗:帶什麼給側車、怎麼收、
 * 記住上次的類別(D3)、側車忙時重試(D5)、出錯可以重試。
 *
 * 要實作的匯出(跟 06 的 `apps/test-card/src/session.ts` 同一個做法:注入 client / fs,不碰真的 Tauri、不碰真的 localStorage):
 *
 *   LAST_CATEGORY_KEY = 'lc-teach-last-category'
 *   (T40/ADR-078:busy 重試與 180 秒上限搬到共用的 ReviewClient,這裡不再有 BUSY_RETRY_MS / BUSY_NOTICE_AFTER_MS / REQUEST_TIMEOUT_MS,
 *    也不再有自己的 sleep / now。重試的測試在 apps/desktop/src/review-client-busy.test.ts。)
 *   BUSY_MESSAGE = '考試卡正在批改,稍等一下。',FINISHED_MESSAGE = '這個類別已經學完了。可以考慮補充更多素材。'
 *
 *   createTeachSession(deps: {
 *     client: Pick<ReviewClient, 'teachOpen' | 'teachNext' | 'teachSwitch' | 'teachPrereq' | 'onWait'>;   // T40:多一個 onWait
 *     fs: Pick<LearningFs, 'read'>;
 *     storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
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
 *     categoryNameOf(id: string): string;       // T40 O3:側車回的類別清單裡 id 對應的名稱;查不到回 id 本身(標示列用)
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
 *   類別清單每一列的 label(T40 O1):「<名稱> · 需要素材 · 剩 N 張」(有 require_raw);「<名稱> · 剩 N 張」(沒有);
 *   剩 0 張把「剩 N 張」換成「學完了」;目前的類別在最後加「 (目前)」(空格加全形括號以外的半形括號,跟原本一樣)。
 *   側車回錯誤(ReviewError):一律進 error,畫面的字是 `reviewErrorText(err)`(依 kind 查 ERROR_MESSAGES;不認得的 kind 是 internal 那一句),
 *   **不用 err.message**,畫面永遠不出現英文的 kind。教學卡自己不重試(busy 由 client 處理);
 *   client 放棄(`kind === 'timeout' && unsent === true`)的畫面是 timeout 的固定字樣加「再試一次」,按了重送同一個動作。
 *   等候字樣:session 訂 client.onWait;收到 true → waiting / busyNotice(BUSY_MESSAGE)/ controlsDisabled 為 true,收到 false 收起。
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
  categoryNameOf(id: string): string;
}
interface SessionModule {
  createTeachSession(deps: Obj): Session;
  LAST_CATEGORY_KEY: string;
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
type Step = ServerView | Error | string | (() => ServerView | Error | Promise<ServerView | Error>);

interface Rig {
  session: Session;
  calls: Call[];
  reads: string[];
  store: Map<string, string>;
  /** client.onWait 收到的聽眾(session 訂閱後才有);emitWait 對所有現有的聽眾通知 */
  waitListeners: ((waiting: boolean) => void)[];
  emitWait(waiting: boolean): void;
  /** 之後的呼叫依序用這些結果;用完就一直用最後一個 */
  script(...steps: Step[]): void;
}

async function rig(opts: { stored?: string; onCall?: (n: number, call: Call) => void } = {}): Promise<Rig> {
  const m = await mod();
  const calls: Call[] = [];
  const reads: string[] = [];
  const store = new Map<string, string>();
  if (opts.stored !== undefined) store.set('lc-teach-last-category', opts.stored);
  const waitListeners: ((waiting: boolean) => void)[] = [];
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
    const step = await (typeof raw === 'function' ? raw() : raw);
    if (step instanceof Error || typeof step === 'string') throw step;
    return step as unknown as Obj;
  };
  const session = m.createTeachSession({
    client: {
      teachOpen: run('teachOpen'),
      teachNext: run('teachNext'),
      teachSwitch: run('teachSwitch'),
      teachPrereq: run('teachPrereq'),
      onWait: (listener: (waiting: boolean) => void) => {
        waitListeners.push(listener);
        return () => {
          const at = waitListeners.indexOf(listener);
          if (at >= 0) waitListeners.splice(at, 1);
        };
      },
    },
    fs: {
      async read(path: string): Promise<string> {
        reads.push(path);
        return `TEXT:${path}`;
      },
    },
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  });
  return {
    session,
    calls,
    reads,
    store,
    waitListeners,
    emitWait: (waiting) => {
      for (const listener of [...waitListeners]) listener(waiting);
    },
    script: (...s) => {
      steps = s;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('常數與固定字樣', () => {
  it('鍵名、等候字樣、學完字樣照 ADR-077', async () => {
    const m = await mod();
    expect(m.LAST_CATEGORY_KEY).toBe('lc-teach-last-category');
    expect(m.BUSY_MESSAGE).toBe('考試卡正在批改,稍等一下。');
    expect(m.FINISHED_MESSAGE).toBe('這個類別已經學完了。可以考慮補充更多素材。');
  });

  it('只有一條重試路徑(T40 must_catch):teach-session 不再匯出自己的重試常數', async () => {
    const m = (await mod()) as unknown as Record<string, unknown>;
    for (const name of ['BUSY_RETRY_MS', 'BUSY_NOTICE_AFTER_MS', 'REQUEST_TIMEOUT_MS']) expect(m[name], name).toBeUndefined();
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
    // T40 O1:名稱 · 需要素材 · 剩 N 張,目前的最後加 (目前)
    expect(sec.label).toBe('資安 · 需要素材 · 剩 3 張 (目前)');
    expect(lang.label).toBe('語言 · 剩 4 張');
    expect(net.label).toBe('網路 · 學完了');
  });

  it('O1:需要素材的類別學完了是「名稱 · 需要素材 · 學完了」;(目前) 永遠在最後', async () => {
    const r = await rig();
    r.script(server({ categories: [{ id: 'security', name: '資安', remaining: 0, requireRaw: true }, ...ROWS.slice(1)], card: null }));
    await r.session.open();
    r.session.openCategories();
    const [sec] = r.session.view().categories;
    expect(sec!.label).toBe('資安 · 需要素材 · 學完了 (目前)');
    expect(sec!.label.endsWith(' (目前)')).toBe(true);
  });

  it('O3:categoryNameOf 用側車回的類別清單查名稱;查不到就回 id 本身', async () => {
    const r = await rig();
    await r.session.open();
    expect(r.session.categoryNameOf('security')).toBe('資安');
    expect(r.session.categoryNameOf('language')).toBe('語言');
    expect(r.session.categoryNameOf('network')).toBe('網路');
    expect(r.session.categoryNameOf('gone-category')).toBe('gone-category');
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

describe('等候字樣由 client.onWait 驅動(T40;重試本身在 ReviewClient)', () => {
  it('session 訂閱 client.onWait:建好之後有且只有一個聽眾', async () => {
    const r = await rig();
    expect(r.waitListeners).toHaveLength(1);
  });

  it('動作進行中收到 true:waiting、等候字樣、按鈕停用;收到 false 收起;動作結束後都回復', async () => {
    let release: (() => void) | undefined;
    const r = await rig();
    r.script(server());
    await r.session.open();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    r.script(async () => {
      await gate;
      return server({ card: CARD3 });
    });
    const pending = r.session.next();
    await Promise.resolve();
    r.emitWait(true);
    let v = r.session.view();
    expect(v.waiting).toBe(true);
    expect(v.busyNotice).toBe('考試卡正在批改,稍等一下。');
    expect(v.controlsDisabled).toBe(true);
    r.emitWait(false);
    v = r.session.view();
    expect(v.waiting).toBe(false);
    expect(v.busyNotice).toBeUndefined();
    r.emitWait(true);
    release!();
    await pending;
    v = r.session.view();
    expect(v.state).toBe('card');
    expect(v.card).toEqual(CARD3);
    expect(v.waiting, '動作結束之後不留著等候字樣').toBe(false);
    expect(v.busyNotice).toBeUndefined();
    expect(v.controlsDisabled).toBe(false);
  });

  it('只有一層重試:client 若把 busy 丟上來,session 不自己重送(一次呼叫、進 error、字樣是 busy 的固定句子)', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    const before = r.calls.length;
    r.script(new ReviewError('busy', '已經有一個請求正在處理。'));
    await r.session.next();
    expect(r.calls.length - before, 'teachNext 剛好一次').toBe(1);
    expect(r.session.view().state).toBe('error');
    expect(r.session.view().message).toBe('已經有一個請求正在處理。');
  });

  it('client 放棄(timeout 且 unsent):出錯畫面是 timeout 的固定字樣加「再試一次」;按了重送同一個動作,好了回到卡片', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    r.script(server());
    await r.session.open();
    const err = new (ReviewError as unknown as new (kind: string, message: string, unsent?: boolean) => Error)('timeout', '等候回覆的時間過了。', true);
    r.script(err);
    await r.session.next();
    const v = r.session.view();
    expect(v.state).toBe('error');
    expect(v.message).toBe('等候回覆的時間過了。');
    expect(v.canRetry).toBe(true);
    expect(v.waiting).toBe(false);
    expect(v.controlsDisabled).toBe(false);
    r.script(server({ card: CARD3 }));
    await r.session.retry();
    expect(r.calls.at(-1)).toEqual({ method: 'teachNext', args: [] });
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().card).toEqual(CARD3);
    expect(r.session.view().canRetry).toBe(false);
  });
});

describe('其他錯誤:固定字樣、可以重試、不卡住', () => {
  it('T40 F3:Rust 的拒絕沒有 message(client 把 kind 當 message 的舊行為):畫面是 ERROR_MESSAGES 的句子,不是英文 kind', async () => {
    const { ReviewError } = await clientMod();
    const r = await rig();
    await r.session.open();
    r.script(new ReviewError('bad-envelope', 'bad-envelope'));
    await r.session.next();
    const v = r.session.view();
    expect(v.state).toBe('error');
    expect(v.message).toBe('請求的信封不合規定。');
    expect(v.message).not.toMatch(/^[a-z-]+$/);
  });

  it('T40 F3:不認得的 kind、一般 Error、非 Error:一律是 internal 那一句,原文不露出', async () => {
    const { ReviewError } = await clientMod();
    for (const err of [new ReviewError('totally-new-kind', 'RAW-INTERNAL /home/x/secret'), new Error('RAW-STACK'), 'just a string']) {
      const r = await rig();
      await r.session.open();
      r.script(err);
      await r.session.next();
      const v = r.session.view();
      expect(v.state, String(err)).toBe('error');
      expect(v.message, String(err)).toBe('內部發生問題,請稍後再試。');
    }
  });

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
    expect(r.calls.filter((c) => c.method === 'teachNext'), '不自己重試').toHaveLength(1);
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

describe('補測2·G2 按鈕停用:等候通知結束不等於請求結束', () => {
  it('請求還沒回來時 onWait(false):按鈕仍停用;請求完成後才放開', async () => {
    let release: (() => void) | undefined;
    const r = await rig();
    r.script(server());
    await r.session.open();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    r.script(async () => {
      await gate;
      return server({ card: CARD3 });
    });
    const pending = r.session.next();
    await Promise.resolve();
    expect(r.session.view().controlsDisabled, '請求中').toBe(true);
    r.emitWait(true);
    r.emitWait(false);
    const v = r.session.view();
    expect(v.waiting).toBe(false);
    expect(v.busyNotice).toBeUndefined();
    expect(v.controlsDisabled, '等候字樣收起了,請求還在跑:按鈕仍停用').toBe(true);
    release!();
    await pending;
    expect(r.session.view().controlsDisabled, '請求完成才放開').toBe(false);
  });

  it('請求不在跑時收到 onWait(false):按鈕不是停用', async () => {
    const r = await rig();
    await r.session.open();
    r.emitWait(false);
    expect(r.session.view().controlsDisabled).toBe(false);
  });
});
