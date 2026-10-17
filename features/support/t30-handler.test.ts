/**
 * T30 驗收 2:側車 handler(`createReviewHandler`,`packages/core/src/session/handler.ts`)的
 * start 金鑰檢查、重讀 `.env`(`reloadEnv`)、每次 start 重算今天(`today` 可以是函式)、submit 的憑證錯誤。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 新增的三個依賴(都可以不給,不給就是 T22 的行為,既有測試不用改):
 *   reloadEnv?: () => boolean            重讀 .env,回「內容有沒有變」
 *   missingKeys?: () => readonly string[] 回缺的鍵名
 *   today: string | (() => string)
 *
 * 路由器、時鐘、reloadEnv、missingKeys 全是程序內的假物件:不打網路、不花錢、不讀真的 .env。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp),不碰真的 learning/ 與真的 ~/.cache。
 * handler 的新欄位還沒有:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 *
 * 本來就綠(基底上已成立,守不退步):不給新依賴時 T22 的行為;固定日期;暫停日不建 router。
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { GatewayCallError, MissingCredentialError, NoModelError } from '../../packages/core/src/llm/errors.js';
import { ReviewStartError } from '../../packages/core/src/session/handler.js';
import {
  TODAY,
  addDays,
  cachePath,
  createVault,
  ledgerEvents,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  writeReviews,
  type Vault,
} from './review-session-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const HANDLER = pathToFileURL(join(ROOT, 'packages/core/src/session/handler.ts')).href;

type Obj = Record<string, unknown>;
interface Deps {
  learningDir: string;
  today: string | (() => string);
  routerFactory: () => unknown | Promise<unknown>;
  env: NodeJS.ProcessEnv;
  reloadEnv?: () => boolean;
  missingKeys?: () => readonly string[];
}
type Handler = (line: string) => Promise<string>;

const MISSING = (key: string): string => `批改要用的金鑰沒有設定:${key}。請在專案根目錄的 .env 加上。`;
const REJECTED = (key: string): string => `批改用的金鑰被拒絕:${key}(可能過期或打錯)。請在專案根目錄的 .env 換一個。`;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 假路由器

type ApplyStep = 'pass' | Error;
interface Router {
  id: string;
  /** 所有 call 的次數(任何 task) */
  calls: number;
  /** grade.apply 被問的次數 */
  applyCalls: number;
  probes: number;
  call(task: string, prompt: string): Promise<unknown>;
  probeOnline(): Promise<boolean>;
  probeLocal(): Promise<unknown>;
}
/** 應用題依序用 steps:'pass' = 通過;Error = 丟那個錯。用完一律通過。其他 task 當沒有本機模型。 */
function makeRouter(id: string, steps: ApplyStep[] = []): Router {
  const queue = [...steps];
  const r: Router = {
    id,
    calls: 0,
    applyCalls: 0,
    probes: 0,
    async call(task, prompt) {
      r.calls += 1;
      if (task !== 'grade.apply') throw new NoModelError('grade.fill.llm');
      r.applyCalls += 1;
      const step = queue.shift() ?? 'pass';
      if (step !== 'pass') throw step;
      return { text: scriptedApplyReply(prompt), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      r.probes += 1;
      return true;
    },
    async probeLocal() {
      r.probes += 1;
      return { available: false, models: [] };
    },
  };
  return r;
}

function statusError(status: number, message = 'Incorrect API key provided'): Error {
  const e = new Error(message);
  (e as unknown as { status: number }).status = status;
  return e;
}

// ---------------------------------------------------------------- 佈置

function seed(v: Vault, entries: Record<string, { stage: number; overdue: number }>, today = TODAY): void {
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  for (const [id, e] of Object.entries(entries)) reviews[id] = reviewRecord({ stage: e.stage, next_due: addDays(today, -e.overdue) });
  writeReviews(v, reviews);
}
const APPLY_ONE = { 'sec-0003': { stage: 3, overdue: 1 } };
const FILL_THREE = { 'sec-0001': { stage: 1, overdue: 3 }, 'sec-0002': { stage: 1, overdue: 2 }, 'sec-0003': { stage: 1, overdue: 1 } };

interface RigOpts {
  entries?: Record<string, { stage: number; overdue: number }>;
  env?: NodeJS.ProcessEnv;
  today?: string | (() => string);
  routers?: Router[];
  reloadEnv?: () => boolean;
  missingKeys?: () => readonly string[];
  factory?: () => unknown;
  cards?: number;
}
interface Rig {
  v: Vault;
  send(method: string, params?: Obj): Promise<Obj>;
  factoryCalls: () => number;
}
async function rig(opts: RigOpts = {}): Promise<Rig> {
  const v = createVault({ cards: opts.cards ?? 6 });
  vaults.push(v);
  seed(v, opts.entries ?? FILL_THREE);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: v.home, XDG_CACHE_HOME: v.xdgCache, XDG_CONFIG_HOME: v.xdgConfig, LC_REVIEW_FAKE_CLOUD: undefined, LC_REVIEW_TODAY: undefined, ...opts.env };
  const routers = [...(opts.routers ?? [makeRouter('r1')])];
  let made = 0;
  const deps: Deps = {
    learningDir: v.dir,
    today: opts.today ?? TODAY,
    routerFactory:
      opts.factory ??
      (() => {
        made += 1;
        const next = routers.length > 1 ? routers.shift()! : routers[0]!;
        return next;
      }),
    env,
    ...(opts.reloadEnv ? { reloadEnv: opts.reloadEnv } : {}),
    ...(opts.missingKeys ? { missingKeys: opts.missingKeys } : {}),
  };
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(d: Deps): Handler };
  const handler = mod.createReviewHandler(deps);
  let id = 1;
  return {
    v,
    factoryCalls: () => made,
    async send(method, params = {}) {
      const out = await handler(JSON.stringify({ v: 1, id: id++, method, params }));
      return JSON.parse(out) as Obj;
    },
  };
}
const ok = (r: Obj): Obj => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result as Obj;
};
const err = (r: Obj): { kind: string; message: string } => {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  return r.error as { kind: string; message: string };
};
const bytes = (v: Vault): string => readFileSync(reviewsPath(v), 'utf8');
const ledgerCount = (v: Vault): number => ledgerEvents(v).length;

// ---------------------------------------------------------------- start 的金鑰檢查

describe('start:缺金鑰就說清楚(驗收 2,第 4 步)', () => {
  it('missingKeys 回缺的鍵 → credential-unavailable,訊息是「沒有設定」樣板、帶鍵名', async () => {
    const r = await rig({ missingKeys: () => ['GATEWAY_API_KEY'] });
    const e = err(await r.send('start'));
    expect(e).toEqual({ kind: 'credential-unavailable', message: MISSING('GATEWAY_API_KEY') });
  });

  it.each(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY'])('缺 %s:訊息換成那個鍵名', async (key) => {
    const r = await rig({ missingKeys: () => [key] });
    expect(err(await r.send('start')).message).toBe(MISSING(key));
  });

  it('缺不只一個:用第一個(順序照 missingKeys 給的)', async () => {
    const r = await rig({ missingKeys: () => ['OPENAI_API_KEY', 'GATEWAY_API_KEY'] });
    expect(err(await r.send('start')).message).toBe(MISSING('OPENAI_API_KEY'));
  });

  it('missingKeys 回空陣列 → 照常 ready', async () => {
    const r = await rig({ missingKeys: () => [] });
    expect(ok(await r.send('start'))).toMatchObject({ state: 'ready', total: 3 });
  });

  it('補上金鑰後再 start(同一個 handler)→ 出題;每次 start 都問一次 missingKeys', async () => {
    let missing: string[] = ['GATEWAY_API_KEY'];
    let asked = 0;
    const r = await rig({
      missingKeys: () => {
        asked += 1;
        return missing;
      },
    });
    expect(err(await r.send('start')).kind).toBe('credential-unavailable');
    missing = [];
    expect(ok(await r.send('start'))).toMatchObject({ state: 'ready' });
    expect(asked).toBe(2);
    expect(ok(await r.send('next'))).toMatchObject({ kind: 'question' });
  });

  it('失敗的 start 什麼都沒留下:沒有當日快取、reviews.json 不變、帳本不變、之後 next 是 no-session', async () => {
    const r = await rig({ missingKeys: () => ['GATEWAY_API_KEY'] });
    const before = bytes(r.v);
    const ledger = ledgerCount(r.v);
    expect(err(await r.send('start')).kind).toBe('credential-unavailable');
    expect(existsSync(cachePath(r.v))).toBe(false);
    expect(bytes(r.v)).toBe(before);
    expect(ledgerCount(r.v)).toBe(ledger);
    expect(err(await r.send('next')).kind).toBe('no-session');
  });

  it('已經在進行的 session,後來 start 遇到缺鍵:舊 session 不能留著(next 是 no-session)', async () => {
    let missing: string[] = [];
    const r = await rig({ missingKeys: () => missing });
    ok(await r.send('start'));
    ok(await r.send('next'));
    missing = ['GATEWAY_API_KEY'];
    expect(err(await r.send('start')).kind).toBe('credential-unavailable');
    expect(err(await r.send('next')).kind).toBe('no-session');
  });

  it('檢查不打網路:fetch 換成會丟錯的、router 的 probeOnline / call 都沒被叫', async () => {
    const spy = vi.fn(() => {
      throw new Error('金鑰檢查不該打網路');
    });
    vi.stubGlobal('fetch', spy);
    const router = makeRouter('r1');
    const r = await rig({ routers: [router], missingKeys: () => ['GATEWAY_API_KEY'] });
    expect(err(await r.send('start')).kind).toBe('credential-unavailable');
    expect(spy).not.toHaveBeenCalled();
    expect(router.probes).toBe(0);
    expect(router.calls).toBe(0);
  });

  it('順序:沒有卡 → no-cards 先於缺金鑰', async () => {
    const r = await rig({ missingKeys: () => ['GATEWAY_API_KEY'] });
    const dir = join(r.v.dir, 'cards/security');
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    expect(err(await r.send('start')).kind).toBe('no-cards');
  });

  it('順序:帳本問題(router-unavailable / root-mismatch)先於缺金鑰(先 ensureRouter,再查金鑰)', async () => {
    for (const kind of ['router-unavailable', 'root-mismatch'] as const) {
      const r = await rig({
        missingKeys: () => ['GATEWAY_API_KEY'],
        factory: () => {
          throw new ReviewStartError(kind);
        },
      });
      expect(err(await r.send('start')).kind, kind).toBe(kind);
    }
  });

  it('暫停日不建 router、不查金鑰:start 回 paused,missingKeys 與 routerFactory 都沒被叫', async () => {
    let asked = 0;
    const router = makeRouter('r1');
    const first = await rig({ routers: [router] });
    // 同一個學習目錄上,另開一個 handler:今天先暫停(寫當日快取的 paused 標記)
    ok(await first.send('start'));
    const cacheFile = cachePath(first.v);
    const cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as Obj;
    writeFileSync(cacheFile, JSON.stringify({ ...cache, paused: true }), 'utf8');
    let factory = 0;
    const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(d: Deps): Handler };
    const handler = mod.createReviewHandler({
      learningDir: first.v.dir,
      today: TODAY,
      env: { ...process.env, HOME: first.v.home, XDG_CACHE_HOME: first.v.xdgCache, XDG_CONFIG_HOME: first.v.xdgConfig },
      routerFactory: () => {
        factory += 1;
        return router;
      },
      missingKeys: () => {
        asked += 1;
        return ['GATEWAY_API_KEY'];
      },
    });
    const out = JSON.parse(await handler(JSON.stringify({ v: 1, id: 1, method: 'start', params: {} }))) as Obj;
    expect(ok(out)).toMatchObject({ state: 'paused' });
    expect(asked).toBe(0);
    expect(factory).toBe(0);
  });

  it('不給 missingKeys / reloadEnv:T22 的行為(start 照常 ready,沒有任何金鑰檢查)', async () => {
    const r = await rig();
    expect(ok(await r.send('start'))).toMatchObject({ state: 'ready' });
  });
});

// ---------------------------------------------------------------- 重讀 .env

describe('start / submit 重讀 .env(reloadEnv)(驗收 2)', () => {
  it('每次 start 都先 reloadEnv,再查 missingKeys(順序:reload → missing)', async () => {
    const order: string[] = [];
    const r = await rig({
      reloadEnv: () => {
        order.push('reload');
        return false;
      },
      missingKeys: () => {
        order.push('missing');
        return [];
      },
    });
    ok(await r.send('start'));
    ok(await r.send('start'));
    expect(order).toEqual(['reload', 'missing', 'reload', 'missing']);
  });

  it('reloadEnv 回 false:router 沿用,routerFactory 只被叫一次(T22:第一次 start 才建、成功就快取)', async () => {
    const r = await rig({ reloadEnv: () => false });
    ok(await r.send('start'));
    ok(await r.send('start'));
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBe(1);
  });

  it('reloadEnv 回 true:丟掉快取的 router,這次 start 重新叫 routerFactory(舊的閘道 token 不能留)', async () => {
    let changed = false;
    const r = await rig({ routers: [makeRouter('old'), makeRouter('new')], reloadEnv: () => changed });
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBe(1);
    changed = true;
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBe(2);
    changed = false;
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBe(2);
  });

  it('改過 .env 之後的 start 用的是新 router:新 router 收到應用題批改,舊的沒有', async () => {
    const oldRouter = makeRouter('old');
    const newRouter = makeRouter('new');
    let changed = false;
    const r = await rig({ entries: APPLY_ONE, routers: [oldRouter, newRouter], reloadEnv: () => changed });
    ok(await r.send('start'));
    changed = true;
    ok(await r.send('start'));
    ok(await r.send('next'));
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'passed' });
    expect(newRouter.applyCalls).toBe(1);
    expect(oldRouter.applyCalls).toBe(0);
  });

  it('不改 .env 的 start:還是同一個 router', async () => {
    const first = makeRouter('first');
    const second = makeRouter('second');
    const r = await rig({ entries: APPLY_ONE, routers: [first, second], reloadEnv: () => false });
    ok(await r.send('start'));
    ok(await r.send('start'));
    ok(await r.send('next'));
    ok(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(first.applyCalls).toBe(1);
    expect(second.applyCalls).toBe(0);
  });

  it('start 缺鍵時 reloadEnv 回 true 也要照做:丟掉舊 router,補好金鑰後的下一次 start 用新建的', async () => {
    let missing: string[] = ['GATEWAY_API_KEY'];
    let changed = true;
    const r = await rig({ routers: [makeRouter('a'), makeRouter('b')], reloadEnv: () => changed, missingKeys: () => missing });
    expect(err(await r.send('start')).kind).toBe('credential-unavailable');
    missing = [];
    changed = true;
    ok(await r.send('start'));
    expect(r.factoryCalls()).toBeGreaterThanOrEqual(2);
  });

  it('submit 也先 reloadEnv;回 true 就用新建的 router 批改這一題(使用者改好 .env 再按「送出」)', async () => {
    const oldRouter = makeRouter('old', [new MissingCredentialError('GATEWAY_API_KEY')]);
    const newRouter = makeRouter('new');
    let changed = false;
    const r = await rig({ entries: APPLY_ONE, routers: [oldRouter, newRouter], reloadEnv: () => changed });
    ok(await r.send('start'));
    ok(await r.send('next'));
    expect(err(await r.send('submit', { apply: 'PASSALL 回答' })).kind).toBe('credential-unavailable');
    changed = true;
    expect(ok(await r.send('submit', { apply: 'PASSALL 回答' }))).toMatchObject({ status: 'passed', pass: true });
    expect(r.factoryCalls()).toBe(2);
    expect(newRouter.applyCalls).toBe(1);
  });

  it('submit 時 reloadEnv 回 false:不重建 router', async () => {
    const calls: string[] = [];
    const r = await rig({
      entries: APPLY_ONE,
      reloadEnv: () => {
        calls.push('reload');
        return false;
      },
    });
    ok(await r.send('start'));
    ok(await r.send('next'));
    calls.length = 0;
    ok(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(calls).toEqual(['reload']);
    expect(r.factoryCalls()).toBe(1);
  });
});

// ---------------------------------------------------------------- submit 的憑證錯誤

describe('submit 遇到憑證錯誤 → credential-unavailable,題目留著(驗收 2)', () => {
  const cases: [string, () => Error, string, NodeJS.ProcessEnv][] = [
    ['MissingCredentialError(GATEWAY_API_KEY)', () => new MissingCredentialError('GATEWAY_API_KEY'), MISSING('GATEWAY_API_KEY'), {}],
    ['MissingCredentialError(OPENAI_API_KEY)', () => new MissingCredentialError('OPENAI_API_KEY'), MISSING('OPENAI_API_KEY'), { LLM_CLOUD_PROVIDER: 'openai' }],
    ['閘道 GatewayCallError 401', () => new GatewayCallError('chat returned 401', 401), REJECTED('GATEWAY_API_KEY'), {}],
    [
      '閘道 401 包在 NoModelError 的 cause 裡',
      () => new NoModelError('grade.apply', { detail: 'local gateway unreachable: x', cause: new GatewayCallError('chat returned 401', 401) }),
      REJECTED('GATEWAY_API_KEY'),
      {},
    ],
    ['雲端 401(openai)', () => statusError(401), REJECTED('OPENAI_API_KEY'), { LLM_CLOUD_PROVIDER: 'openai' }],
    ['雲端 401(anthropic)', () => statusError(401), REJECTED('ANTHROPIC_API_KEY'), { LLM_CLOUD_PROVIDER: 'anthropic' }],
  ];

  it.each(cases)('%s → credential-unavailable 加樣板訊息', async (_name, make, message, env) => {
    const r = await rig({ entries: APPLY_ONE, routers: [makeRouter('r1', [make()])], env });
    ok(await r.send('start'));
    ok(await r.send('next'));
    const e = err(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(e).toEqual({ kind: 'credential-unavailable', message });
  });

  it('session 還在、reviews.json 沒動、帳本沒有多一筆;修好之後再送同一題就過', async () => {
    const router = makeRouter('r1', [new MissingCredentialError('GATEWAY_API_KEY')]);
    const r = await rig({ entries: APPLY_ONE, routers: [router] });
    ok(await r.send('start'));
    const q = ok(await r.send('next'));
    const reviewsBefore = bytes(r.v);
    const ledgerBefore = ledgerCount(r.v);
    expect(err(await r.send('submit', { apply: 'PASSALL 回答' })).kind).toBe('credential-unavailable');
    expect(bytes(r.v)).toBe(reviewsBefore);
    expect(ledgerCount(r.v)).toBe(ledgerBefore);
    expect(ok(await r.send('status'))).toMatchObject({ paused: false, today: TODAY });
    // session 沒被清掉:不是 no-session / no-question,直接再送同一題
    const again = ok(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(again).toMatchObject({ status: 'passed', pass: true, cardDone: true });
    expect(readReviews(r.v)[q.card as string]!.history.filter((h) => h.date === TODAY)).toHaveLength(1);
  });

  it('憑證錯誤那一次不算「這次作答」:小結的通過 / 退回都是 0', async () => {
    const r = await rig({ entries: APPLY_ONE, routers: [makeRouter('r1', [new GatewayCallError('chat returned 401', 401)])] });
    ok(await r.send('start'));
    ok(await r.send('next'));
    expect(err(await r.send('submit', { apply: 'PASSALL 回答' })).kind).toBe('credential-unavailable');
    expect(ok(await r.send('summary'))).toMatchObject({ passed: 0, returned: 0 });
  });

  it('不是憑證的錯照舊:一般 Error、403、不在三個鍵名裡的 MissingCredentialError 都是 internal,而且不洩漏原文', async () => {
    for (const make of [() => new Error('boom-secret-detail'), () => statusError(403, 'forbidden-detail'), () => new MissingCredentialError('SOME_OTHER_KEY')]) {
      const r = await rig({ entries: APPLY_ONE, routers: [makeRouter('r1', [make()])] });
      ok(await r.send('start'));
      ok(await r.send('next'));
      const e = err(await r.send('submit', { apply: 'PASSALL 回答' }));
      expect(e.kind).toBe('internal');
      expect(JSON.stringify(e)).not.toMatch(/boom-secret|forbidden-detail|SOME_OTHER/);
    }
  });

  it('訊息不洩漏金鑰的值、絕對路徑與例外原文', async () => {
    const SECRET = 'sk-SECRETVALUE-0123456789';
    const r = await rig({
      entries: APPLY_ONE,
      env: { LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: SECRET },
      routers: [makeRouter('r1', [statusError(401, `Incorrect API key provided: ${SECRET}. at /home/someone/.env`)])],
    });
    ok(await r.send('start'));
    ok(await r.send('next'));
    const raw = JSON.stringify(await r.send('submit', { apply: 'PASSALL 回答' }));
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('/home/someone');
    expect(raw).not.toContain('Incorrect');
  });
});

// ---------------------------------------------------------------- 今天

describe('每次 start 重算今天;進行中不換日(驗收 2,第 3 步)', () => {
  const D1 = addDays(TODAY, 1);
  const clock = (initial: string): { now: string; fn: () => string; calls: () => number } => {
    const state = { now: initial, n: 0 };
    return {
      get now() {
        return state.now;
      },
      set now(v: string) {
        state.now = v;
      },
      fn: () => {
        state.n += 1;
        return state.now;
      },
      calls: () => state.n,
    };
  };

  it('D 日起來、D+1 日 start → start 結果的 today 是新的一天,當日快取建在新的那天', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    expect(ok(await r.send('start'))).toMatchObject({ today: TODAY, resumed: false });
    expect(existsSync(cachePath(r.v, TODAY))).toBe(true);
    c.now = D1;
    const second = ok(await r.send('start'));
    expect(second).toMatchObject({ today: D1, resumed: false, answered: 0 });
    expect(existsSync(cachePath(r.v, D1))).toBe(true);
  });

  it('同一天再 start:還是同一天、續答(resumed true)', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    ok(await r.send('start'));
    ok(await r.send('next'));
    ok(await r.send('submit', { fill: ['錯', '錯', '錯'] }));
    expect(ok(await r.send('start'))).toMatchObject({ today: TODAY, resumed: true });
  });

  it('每次 start 呼叫 today 函式恰好一次', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    const before = c.calls();
    ok(await r.send('start'));
    expect(c.calls() - before).toBe(1);
    ok(await r.send('start'));
    expect(c.calls() - before).toBe(2);
  });

  it('start 之後換日:next / submit / summary / status 都還是舊的那天(進行中不換日)', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    ok(await r.send('start'));
    c.now = D1;
    const q = ok(await r.send('next'));
    expect(q.kind).toBe('question');
    expect(ok(await r.send('status'))).toMatchObject({ today: TODAY });
    ok(await r.send('submit', { fill: ['錯', '錯', '錯'] }));
    const history = readReviews(r.v)[q.card as string]!.history;
    expect(history.at(-1)!.date).toBe(TODAY);
    expect(history.some((h) => h.date === D1)).toBe(false);
    ok(await r.send('summary'));
    expect(existsSync(cachePath(r.v, D1))).toBe(false);
    expect(ok(await r.send('status'))).toMatchObject({ today: TODAY });
  });

  it('換日之後的下一次 start 才換:status 跟著變', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    ok(await r.send('start'));
    c.now = D1;
    expect(ok(await r.send('status'))).toMatchObject({ today: TODAY });
    ok(await r.send('start'));
    expect(ok(await r.send('status'))).toMatchObject({ today: D1 });
  });

  it('跨日後新的一天的 start 重新算逾期數:昨天的卡多逾期一天', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn, entries: { 'sec-0001': { stage: 1, overdue: 0 } } });
    expect(ok(await r.send('start'))).toMatchObject({ overdue: 0 });
    c.now = D1;
    expect(ok(await r.send('start'))).toMatchObject({ today: D1, overdue: 1 });
  });

  it('F1:start 之前叫 status、today 是函式 → ok,today 是 YYYY-MM-DD(不是 internal)', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    const res = await r.send('status');
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const st = res.result as Obj;
    expect(st.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st).toMatchObject({ paused: false, today: TODAY });
  });

  it('F1:start 之前的 status 不鎖日:換日後再叫 status 跟著時鐘,之後 start 照常算今天並鎖定', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    expect(ok(await r.send('status'))).toMatchObject({ today: TODAY });
    c.now = D1;
    expect(ok(await r.send('status'))).toMatchObject({ today: D1 });
    expect(ok(await r.send('start'))).toMatchObject({ today: D1, resumed: false });
    expect(existsSync(cachePath(r.v, D1))).toBe(true);
    expect(existsSync(cachePath(r.v, TODAY))).toBe(false);
    c.now = addDays(D1, 1);
    expect(ok(await r.send('status'))).toMatchObject({ today: D1 });
  });

  it('F1:status 之前叫過,不影響之後 start 的日期與算法(start 仍每次呼叫 today 恰好一次)', async () => {
    const c = clock(TODAY);
    const r = await rig({ today: c.fn });
    ok(await r.send('status'));
    c.now = D1;
    const before = c.calls();
    expect(ok(await r.send('start'))).toMatchObject({ today: D1 });
    expect(c.calls() - before).toBe(1);
  });

  it('today 給字串:照舊固定(T22 行為)', async () => {
    const r = await rig({ today: TODAY });
    expect(ok(await r.send('start'))).toMatchObject({ today: TODAY });
    expect(ok(await r.send('start'))).toMatchObject({ today: TODAY });
  });

  it('日期函式在 start 缺鍵失敗時也只算一次,下一次 start 才重算', async () => {
    const c = clock(TODAY);
    let missing: string[] = ['GATEWAY_API_KEY'];
    const r = await rig({ today: c.fn, missingKeys: () => missing });
    expect(err(await r.send('start')).kind).toBe('credential-unavailable');
    c.now = D1;
    missing = [];
    expect(ok(await r.send('start'))).toMatchObject({ today: D1 });
  });
});
