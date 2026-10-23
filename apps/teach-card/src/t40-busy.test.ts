/**
 * T40(ADR-078)F1/F3、O1–O3:教學卡 + 真的共用 ReviewClient + 假 invoke / 假時鐘。測試 agent 寫;開發 worker 不改。
 * 重點:只有一條重試路徑(client);教學卡出錯畫面永遠是中文固定字樣;類別名稱用側車回的清單。
 * 重試本身的細節在 apps/desktop/src/review-client-busy.test.ts。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const ROOT = join(import.meta.dirname, '../../..');
const CLIENT = pathToFileURL(join(ROOT, 'apps/desktop/src/webview/review-client.ts')).href;
const SESSION = pathToFileURL(join(import.meta.dirname, 'teach-session.ts')).href;

type Obj = Record<string, unknown>;
interface View {
  state: string;
  waiting: boolean;
  busyNotice: string | undefined;
  controlsDisabled: boolean;
  message: string | undefined;
  canRetry: boolean;
  card: { id: string } | undefined;
}
interface Session {
  view(): View;
  open(): Promise<void>;
  next(): Promise<void>;
  retry(): Promise<void>;
}

const ROWS = [
  { id: 'security', name: '資安', remaining: 3, requireRaw: true },
  { id: 'language', name: '語言', remaining: 4, requireRaw: false },
];
const CARD2 = { id: 'sec-0002', path: 'cards/security/sec-0002.md', title: '跨來源資源共享' };
const CARD3 = { id: 'sec-0003', path: 'cards/security/sec-0003.md', title: '同源政策' };
const server = (card: Obj | null): Obj => ({ category: 'security', categories: ROWS, card, prereqs: [] });

type Script = (method: string, n: number) => 'busy' | { reject: unknown } | { result: Obj };

async function rig(script: Script): Promise<{ session: Session; invokes: string[]; views: (View & { at: number })[]; clock: { t: number } }> {
  const { createReviewClient } = (await import(/* @vite-ignore */ CLIENT)) as { createReviewClient(opts: Obj): unknown };
  const { createTeachSession } = (await import(/* @vite-ignore */ SESSION)) as { createTeachSession(deps: Obj): Session };
  const invokes: string[] = [];
  const views: (View & { at: number })[] = [];
  const clock = { t: 0 };
  let session: Session | undefined;
  const client = createReviewClient({
    invoke: async (_cmd: string, args: { request: { id: number; method: string } }) => {
      invokes.push(args.request.method);
      if (session) views.push({ at: clock.t, ...session.view() });
      const step = script(args.request.method, invokes.length);
      if (step === 'busy') throw { kind: 'busy' };
      if ('reject' in step) throw step.reject;
      return { v: 1, id: args.request.id, ok: true, result: step.result };
    },
    sleep: async (ms: number) => {
      clock.t += ms;
      if (invokes.length > 5000) throw new Error('重試超過 5000 次還沒停(沒有上限)');
    },
    now: () => clock.t,
  });
  session = createTeachSession({
    client,
    fs: { read: async (path: string) => `TEXT:${path}` },
    storage: { getItem: () => null, setItem: () => undefined },
  });
  return { session, invokes, views, clock };
}

describe('F1:只有一條重試路徑(T40 must_catch:兩層重試)', () => {
  it('一次 busy 之後成功:invoke 剛好 2 次(teach.next ×2),不是三次以上', async () => {
    const r2 = await rig((method, n) => {
      if (method === 'teach.open') return { result: server(CARD2) };
      return n === 2 ? 'busy' : { result: server(CARD3) };
    });
    await r2.session.open();
    const before = r2.invokes.length;
    await r2.session.next();
    expect(r2.invokes.slice(before)).toEqual(['teach.next', 'teach.next']);
    expect(r2.session.view().state).toBe('card');
    expect(r2.session.view().card?.id).toBe('sec-0003');
  });

  it('忙超過 1 秒:重試期間 waiting、等候字樣、按鈕停用;結束後收起', async () => {
    const r = await rig((method, n) => (method === 'teach.open' ? { result: server(CARD2) } : n <= 7 ? 'busy' : { result: server(CARD3) }));
    await r.session.open();
    r.views.length = 0;
    await r.session.next();
    // 在每次送出的當下看畫面:≥ 1500 ms 的一定已經在等候,≤ 900 ms 的一定還沒(client 檢查「超過 1 秒」的時點不限定)
    const late = r.views.filter((seen) => seen.at >= 1500);
    expect(late.length).toBeGreaterThan(0);
    for (const seen of late) {
      expect(seen.waiting).toBe(true);
      expect(seen.busyNotice).toBe('考試卡還在用複習程式,稍等一下。');
      expect(seen.controlsDisabled).toBe(true);
    }
    for (const seen of r.views.filter((seen) => seen.at <= 900)) {
      expect(seen.waiting).toBe(false);
      expect(seen.busyNotice).toBeUndefined();
    }
    const v = r.session.view();
    expect(v.waiting).toBe(false);
    expect(v.busyNotice).toBeUndefined();
    expect(v.controlsDisabled).toBe(false);
  });

  it('一直 busy 到放棄:固定字樣「等候回覆的時間過了。」加「再試一次」;按了重送同一個動作', async () => {
    let giveUp = true;
    const r = await rig((method) => (method === 'teach.open' ? { result: server(CARD2) } : giveUp ? 'busy' : { result: server(CARD3) }));
    await r.session.open();
    await r.session.next();
    const v = r.session.view();
    expect(v.state).toBe('error');
    expect(v.message).toBe('等候回覆的時間過了。');
    expect(v.canRetry).toBe(true);
    expect(v.waiting).toBe(false);
    expect(v.controlsDisabled).toBe(false);
    const sent = r.invokes.length;
    expect(sent, '300 ms 一次、180 秒:約 600 次').toBeGreaterThanOrEqual(600);
    giveUp = false;
    await r.session.retry();
    expect(r.invokes.at(-1)).toBe('teach.next');
    expect(r.session.view().state).toBe('card');
    expect(r.session.view().card?.id).toBe('sec-0003');
  });
});

describe('F3:出錯畫面永遠是中文固定字樣', () => {
  it('Rust 拒絕 bad-envelope(沒有 message):畫面是「請求的信封不合規定。」,不是英文 kind', async () => {
    const r = await rig((method) => (method === 'teach.open' ? { result: server(CARD2) } : { reject: { kind: 'bad-envelope' } }));
    await r.session.open();
    await r.session.next();
    const v = r.session.view();
    expect(v.state).toBe('error');
    expect(v.message).toBe('請求的信封不合規定。');
  });

  it('Rust 拒絕不認得的 kind:畫面是 internal 那一句', async () => {
    const r = await rig((method) => (method === 'teach.open' ? { result: server(CARD2) } : { reject: { kind: 'brand-new-kind' } }));
    await r.session.open();
    await r.session.next();
    expect(r.session.view().message).toBe('內部發生問題,請稍後再試。');
  });

  it('側車回 ok:false 的固定句子(teach-record-changed)照常顯示', async () => {
    const r = await rig((method) => (method === 'teach.open' ? { result: server(CARD2) } : { reject: { kind: 'teach-record-changed' } }));
    await r.session.open();
    await r.session.next();
    expect(r.session.view().message).toBe('學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。');
  });
});

describe('靜態:teach-session.ts 沒有自己的重試迴圈,App.svelte 用名稱不是 id', () => {
  const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('teach-session.ts(去掉註解)沒有 busy 判斷、sleep、now、重試常數', () => {
    const code = strip(readFileSync(join(import.meta.dirname, 'teach-session.ts'), 'utf8'));
    expect(code).not.toMatch(/['"`]busy['"`]/);
    expect(code).not.toMatch(/\bsleep\b/);
    expect(code).not.toMatch(/\bnow\b/);
    expect(code).not.toMatch(/REQUEST_TIMEOUT|BUSY_RETRY|BUSY_NOTICE_AFTER|BUSY_GIVE_UP/);
    expect(code).not.toMatch(/\bsetTimeout\b/);
  });

  it('teach-session.ts 的錯誤畫面不直接用 err.message(用 reviewErrorText 查固定字樣)', () => {
    const code = strip(readFileSync(join(import.meta.dirname, 'teach-session.ts'), 'utf8'));
    expect(code).toContain('reviewErrorText');
    expect(code).not.toMatch(/\.message\b/);
  });

  it('App.svelte 的標示列用 categoryNameOf(名稱),不再直接顯示 frontmatter.category(id)', () => {
    const svelte = readFileSync(join(import.meta.dirname, 'App.svelte'), 'utf8');
    expect(svelte).toContain('categoryNameOf(');
    const marker = /<span class="category">([\s\S]*?)<\/span>/.exec(svelte);
    expect(marker, '找不到標示列的 span.category').not.toBeNull();
    expect(marker![1]).toContain('categoryNameOf(');
    expect(marker![1]).not.toMatch(/^\s*\{shown\.frontmatter\.category\}\s*$/);
  });

  it('App.svelte 只用 session.view() 的等候欄位顯示等候字樣(busyNotice 還在)', () => {
    const svelte = readFileSync(join(import.meta.dirname, 'App.svelte'), 'utf8');
    expect(svelte).toContain('view.busyNotice');
  });
});
