/**
 * T40(ADR-078)F1:考試卡 + 真的共用 ReviewClient + 假 invoke / 假時鐘。測試 agent 寫;開發 worker 不改。
 * 側車還在起(Rust 回 busy)時,考試卡不得顯示「複習程式停了。」:client 重試、考試卡只顯示等候字樣、好了就出題。
 * 重試本身的細節在 apps/desktop/src/review-client-busy.test.ts;這裡量「兩層接起來」。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const CLIENT = pathToFileURL(join(import.meta.dirname, '../../desktop/src/webview/review-client.ts')).href;
const SESSION = pathToFileURL(join(import.meta.dirname, 'session.ts')).href;

type Obj = Record<string, unknown>;
interface View {
  state: string;
  message: string | undefined;
  canRestart: boolean;
  canRetry: boolean;
  waiting: boolean;
  waitNotice: string | undefined;
}
interface Session {
  init(): Promise<void>;
  getView(): View;
}

const START: Obj = { state: 'ready', today: '2026-09-10', resumed: false, total: 5, answered: 0, deferred: 0, dailyCap: 10, overdue: 0, fakeCloud: false };
const QUESTION: Obj = {
  kind: 'question',
  card: 'sec-0001',
  stage: 1,
  type: 'fill',
  prompt: '同源是 ___ 加 ___ 加 ___ 都相同',
  progress: { index: 1, total: 5 },
  stuck: false,
  overdueDays: 0,
  blanks: 3,
};

/** busyFirst 次 busy(或一直 busy:Infinity),之後 start / next 各回一個成功的結果 */
async function rig(busyFirst: number): Promise<{ session: Session; views: (View & { at: number; method: string })[]; invokes: string[]; clock: { t: number } }> {
  const { createReviewClient } = (await import(/* @vite-ignore */ CLIENT)) as { createReviewClient(opts: Obj): unknown };
  const { TestSession } = (await import(/* @vite-ignore */ SESSION)) as { TestSession: new (deps: Obj) => Session };
  const invokes: string[] = [];
  const views: (View & { at: number; method: string })[] = [];
  const clock = { t: 0 };
  let session: Session | undefined;
  let busyLeft = busyFirst;
  const client = createReviewClient({
    invoke: async (_cmd: string, args: { request: { id: number; method: string } }) => {
      invokes.push(args.request.method);
      if (session) views.push({ at: clock.t, method: args.request.method, ...session.getView() });
      if (busyLeft > 0) {
        busyLeft -= 1;
        throw { kind: 'busy' };
      }
      const result = args.request.method === 'start' ? START : QUESTION;
      return { v: 1, id: args.request.id, ok: true, result };
    },
    sleep: async (ms: number) => {
      clock.t += ms;
      if (invokes.length > 5000) throw new Error('重試超過 5000 次還沒停(沒有上限)');
    },
    now: () => clock.t,
  });
  session = new TestSession({ client, fs: { read: async () => '' } });
  return { session, views, invokes, clock };
}

describe('F1:側車還在起(Rust 回 busy)', () => {
  it('start 先 busy 兩次再成功:考試卡出題;重試期間從沒顯示「複習程式停了。」;invoke 是 start ×3 再 next ×1', async () => {
    const r = await rig(2);
    await r.session.init();
    const v = r.session.getView();
    expect(v.state).toBe('question');
    expect(r.invokes).toEqual(['start', 'start', 'start', 'next']);
    expect(r.views).toHaveLength(4);
    for (const seen of r.views) {
      expect(seen.state).toBe('loading');
      expect(seen.message ?? '').not.toContain('複習程式停了');
      expect(seen.canRestart).toBe(false);
    }
    expect(v.message === undefined || !v.message.includes('複習程式停了')).toBe(true);
  });

  it('忙超過 1 秒:重試期間畫面有「複習程式還在準備,稍等一下。」、waiting 為 true;好了之後收起來', async () => {
    const r = await rig(6);
    await r.session.init();
    // 在每次送出(重送)的當下看畫面。client 不論在哪個時點檢查「超過 1 秒」,送出時間 ≥ 1500 ms 的一定已經在等候,≤ 900 ms 的一定還沒
    const late = r.views.filter((seen) => seen.method === 'start' && seen.at >= 1500);
    expect(late.length).toBeGreaterThan(0);
    for (const seen of late) {
      expect(seen.waiting).toBe(true);
      expect(seen.waitNotice).toBe('複習程式還在準備,稍等一下。');
    }
    const early = r.views.filter((seen) => seen.at <= 900);
    for (const seen of early) {
      expect(seen.waiting).toBe(false);
      expect(seen.waitNotice).toBeUndefined();
    }
    const v = r.session.getView();
    expect(v.state).toBe('question');
    expect(v.waiting).toBe(false);
    expect(v.waitNotice).toBeUndefined();
  });

  it('一直 busy 到 180 秒:「等候回覆的時間過了。」加「再試一次」;不是「複習程式停了。」、不是「重新開始」', async () => {
    const r = await rig(Number.POSITIVE_INFINITY);
    await r.session.init();
    const v = r.session.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('等候回覆的時間過了。');
    expect(v.message).not.toContain('複習程式停了');
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
    expect(v.waiting).toBe(false);
    expect(r.invokes.length).toBeGreaterThanOrEqual(600);
    expect(r.clock.t).toBeGreaterThanOrEqual(180_000);
  });

  it('放棄之後按「再試一次」(再 init):側車好了就出題', async () => {
    const r = await rig(601);
    await r.session.init();
    expect(r.session.getView().canRetry).toBe(true);
    await r.session.init();
    expect(r.session.getView().state).toBe('question');
  });
});

describe('靜態:App.svelte 顯示等候字樣並在等候時停用按鈕', () => {
  it('讀 view.waitNotice 顯示、用 view.waiting 停用按鈕', () => {
    const svelte = readFileSync(join(import.meta.dirname, 'App.svelte'), 'utf8');
    expect(svelte).toContain('view.waitNotice');
    expect(svelte).toMatch(/view\.waiting/);
  });

  it('session.ts 不再有 busy 的特別處理(busy 到不了考試卡)', () => {
    const code = readFileSync(join(import.meta.dirname, 'session.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).not.toMatch(/['"`]busy['"`]/);
  });
});
