/**
 * T63 紅測試:live golden 有日上限,而且永遠不改走本機(ADR-083)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T63-golden-live-daily-cap.md「紅測試」。
 *
 * 全部不打網路、不碰真帳本:`globalThis.fetch` 換成假的(數雲端與閘道各被叫幾次),
 * 暫存指標檔 + vault-id,HOME / XDG_CONFIG_HOME / XDG_RUNTIME_DIR 指暫存目錄(照 live-run.test.ts 的 syntheticVault)。
 *
 * 「預算用完」怎麼造:LLM_DAILY_CAP_USD=0 **不是**用完(spend.ts 的 isBudgetExhausted 對 cap <= 0 回 false = 不設限,
 * 工單那句不成立)。所以用上限 US$1,並在驗證過的帳本種一筆今天已花 US$1 的 llm_call。
 *
 *   1. GOLDEN_FALLBACK_TABLE:剛好契約 §7 的七個 task、全部 'cloud-only'、凍結。
 *   2. 預設 router(createDefaultLiveRouter)走 createLiveGatewayRouter:
 *      - 預算用完 → 七個 task 都在叫雲端之前就丟 BUDGET_EXCEEDED,雲端 0、閘道 0;
 *      - 雲端 503 / 離線 → 七個 task 都丟 CLOUD_REQUIRED(包括預設表會改走閘道的 deepen、grade.apply、reteach.short),閘道 0;
 *      - probeLocal 固定不可用、不碰閘道;
 *      - 帶 budgetExhausted(),預算用完回 true、沒用完回 false;
 *      - llm_call 記進驗證過的帳本。
 *   3. runGoldenLive:probeOnline 之後、讀 prompt 檔與 mkdirSync 之前查預算;丟 LiveRunBudgetExceededError(一句話,含「今日預算已用完」與
 *      LLM_DAILY_CAP_USD);輸出目錄前後一樣;router 沒有 budgetExhausted 的照舊不查。
 *   4. CLI(main(['--golden','--live',…])):退出碼 1、一行 ✗ 加訊息、沒有堆疊。
 *   5. golden-run.ts 本身不再 new LlmRouterImpl(。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLM_TASKS, LlmRouterImpl, type LlmTask } from '@core/llm/index.js';
import { dayOf } from '@core/llm/spend.js';
import type { LogEvent } from '@contracts/index.js';
import { main } from './cli.js';
import * as goldenRun from './golden-run.js';
import { createDefaultLiveRouter, runGoldenLive } from './golden-run.js';
import type { GoldenSet, LlmRouter } from './types.js';

// 雲端 503 的測試要連叫七個 task,SDK 對 503 會自己退避重試,預設 5 秒不夠。
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const MODEL = 'claude-sonnet-5';
const GATEWAY = 'http://gateway.test:8787';
const FILE = join(import.meta.dirname, 'golden-run.ts');

// ------------------------------------------------------------------ 假網路

type CloudMode = 'ok' | 'fail503' | 'offline';
let realFetch: typeof globalThis.fetch;
let cloudMode: CloudMode = 'ok';
let probes = 0;
let modelCalls = 0;
let gatewayCalls = 0;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const REPLY = JSON.stringify({ criteria: [true, false], feedback: '方向對,細節再補' });

function installFakeNetwork(mode: CloudMode): void {
  cloudMode = mode;
  probes = 0;
  modelCalls = 0;
  gatewayCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(GATEWAY)) {
      gatewayCalls += 1;
      if (url.includes('/auth/token/exchange')) return json({ access_token: 'jwt', expires_in: 3600 });
      if (url.includes('/gateway/models')) return json({ auto_match: true, models: { 'qwen2.5:32b': ['chat'] } });
      return json({ content: '本機模型回覆', provider: 'ollama', model: 'qwen2.5:32b', tokens_used: { prompt: 1, completion: 1 } });
    }
    if (url.includes('/v1/models')) {
      probes += 1;
      return json({ data: [] }, cloudMode === 'offline' ? 500 : 200);
    }
    if (url.includes('/v1/messages')) {
      modelCalls += 1;
      if (cloudMode === 'fail503') return json({ type: 'error', error: { type: 'overloaded_error', message: 'service unavailable' } }, 503);
      const raw = init?.body ?? '';
      const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer)) as { model?: string };
      return json({
        id: 'msg_fake', type: 'message', role: 'assistant', model: body.model ?? MODEL,
        content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40 },
      });
    }
    throw new Error(`t63 假網路沒有預期到的請求:${url}`);
  }) as typeof globalThis.fetch;
}

// ------------------------------------------------------------------ 暫存金庫與環境

const tmpDirs: string[] = [];
let realEnv: NodeJS.ProcessEnv;

function tmpDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** 暫存金庫:指標檔 + 身分標記。env 一律指暫存。 */
function vault(opts: { cap?: string; spentUsd?: number } = {}): { root: string; learningDir: string; logPath: string } {
  const root = tmpDir('pq-t63-');
  const learningDir = join(root, 'learning');
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  mkdirSync(join(learningDir, 'config'), { recursive: true });
  writeFileSync(join(learningDir, 'config', 'vault-id'), `${id}\n`);
  const config = join(root, 'xdg');
  mkdirSync(join(config, 'llm-learning-cards'), { recursive: true });
  writeFileSync(join(config, 'llm-learning-cards', 'vault.json'), JSON.stringify({ learning_dir: learningDir, vault_id: id }));
  Object.assign(process.env, {
    HOME: root,
    XDG_CONFIG_HOME: config,
    XDG_RUNTIME_DIR: join(root, 'runtime'),
    LLM_CLOUD_PROVIDER: 'anthropic',
    LLM_CLOUD_MODEL: MODEL,
    ANTHROPIC_API_KEY: 'test-key',
    GATEWAY_BASE_URL: GATEWAY,
    GATEWAY_API_KEY: 'test-gateway-key',
    LLM_LOCAL_MODEL: 'qwen2.5:32b',
    LLM_DAILY_CAP_USD: opts.cap ?? '100',
    LLM_PRICE_IN_PER_M: '2.5',
    LLM_PRICE_OUT_PER_M: '10',
  });
  const logPath = join(learningDir, 'state', 'log.jsonl');
  if (opts.spentUsd !== undefined) {
    mkdirSync(join(learningDir, 'state'), { recursive: true });
    const ts = new Date().toISOString();
    expect(dayOf(ts), '種進去的花費要落在 router 認的「今天」').toBe(dayOf(new Date().toISOString()));
    const event = { ts, type: 'llm_call', task: 'deepen', provider: 'openai', model: 'gpt-5.6-luna', latency_ms: 100, tokens_in: 0, tokens_out: Math.round((opts.spentUsd * 1_000_000) / 10) };
    writeFileSync(logPath, `${JSON.stringify(event)}\n`);
  }
  return { root, learningDir, logPath };
}

const exhaustedVault = (): ReturnType<typeof vault> => vault({ cap: '1', spentUsd: 1 });

beforeEach(() => {
  realFetch = globalThis.fetch;
  realEnv = { ...process.env };
  installFakeNetwork('ok');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = realEnv;
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const eventsOf = (logPath: string): Record<string, unknown>[] =>
  existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

type LiveRouter = LlmRouter & { budgetExhausted?: () => boolean };

// ------------------------------------------------------------------ 1. 備援表

describe('T63 GOLDEN_FALLBACK_TABLE', () => {
  it('鍵剛好是契約 §7 的七個 LlmTask、值全部是 cloud-only、物件凍結', () => {
    const table = (goldenRun as Record<string, unknown>)['GOLDEN_FALLBACK_TABLE'] as Record<string, string> | undefined;
    expect(table, 'golden-run.ts 要匯出 GOLDEN_FALLBACK_TABLE').toBeDefined();
    expect(Object.keys(table!).sort()).toEqual([...LLM_TASKS].sort());
    expect(Object.keys(table!)).toHaveLength(7);
    for (const task of LLM_TASKS) expect(table![task], task).toBe('cloud-only');
    expect(Object.isFrozen(table)).toBe(true);
  });
});

// ------------------------------------------------------------------ 2. 預設 router

describe('T63 預設 router:日上限、永遠不改走本機', () => {
  it('預算用完:七個 task 都在叫雲端之前就丟 BUDGET_EXCEEDED;雲端 0 次叫模型、閘道 0 次', async () => {
    exhaustedVault();
    const router = createDefaultLiveRouter();
    for (const task of LLM_TASKS) {
      expect(await code(router.call(task as LlmTask, '同源政策是什麼?')), `${task} 預算用完`).toBe('BUDGET_EXCEEDED');
    }
    expect(modelCalls, '預算用完時雲端一次都不能叫').toBe(0);
    expect(gatewayCalls, '預算用完時閘道一次都不能叫(golden 不混本機輸出)').toBe(0);
  });

  it('雲端 503:七個 task 都丟 CLOUD_REQUIRED(預設備援表會改走閘道的 deepen、grade.apply、reteach.short 也一樣);閘道 0 次', async () => {
    vault();
    installFakeNetwork('fail503');
    const router = createDefaultLiveRouter();
    for (const task of LLM_TASKS) {
      expect(await code(router.call(task as LlmTask, '同源政策是什麼?')), `${task} 雲端 503`).toBe('CLOUD_REQUIRED');
    }
    expect(gatewayCalls).toBe(0);
  });

  it('離線(探測失敗):七個 task 都丟 CLOUD_REQUIRED;雲端沒叫模型、閘道 0 次', async () => {
    vault();
    installFakeNetwork('offline');
    const router = createDefaultLiveRouter();
    for (const task of LLM_TASKS) {
      expect(await code(router.call(task as LlmTask, '同源政策是什麼?')), `${task} 離線`).toBe('CLOUD_REQUIRED');
    }
    expect(modelCalls).toBe(0);
    expect(gatewayCalls).toBe(0);
  });

  it('正常:雲端的結果,provisional: false,閘道 0 次,llm_call 記進驗證過的帳本(不是別處)', async () => {
    const { logPath, learningDir } = vault();
    const router = createDefaultLiveRouter();
    const result = await router.call('grade.apply', '同源政策是什麼?');
    expect(result.provisional).toBe(false);
    expect(result.provider).toBe('anthropic');
    expect(gatewayCalls).toBe(0);
    expect(eventsOf(logPath).filter((e) => e['type'] === 'llm_call')).toHaveLength(1);
    expect(readdirSync(learningDir).sort()).toEqual(['config', 'state']);
  });

  it('probeLocal() 固定不可用、不碰閘道(即使 GATEWAY_BASE_URL 與金鑰都設了)', async () => {
    vault();
    const router = createDefaultLiveRouter();
    expect(await router.probeLocal()).toEqual({ available: false, models: [] });
    expect(gatewayCalls, 'probeLocal 去碰了閘道').toBe(0);
  });

  it('probeOnline() 照舊委派雲端探測(打 /v1/models),不碰閘道', async () => {
    vault();
    const router = createDefaultLiveRouter();
    expect(await router.probeOnline()).toBe(true);
    expect(probes).toBeGreaterThanOrEqual(1);
    expect(gatewayCalls).toBe(0);
    installFakeNetwork('offline');
    expect(await createDefaultLiveRouter().probeOnline()).toBe(false);
  });

  it('帶 budgetExhausted():預算用完回 true;沒用完回 false(今天沒花錢)', () => {
    exhaustedVault();
    const spent = createDefaultLiveRouter() as LiveRouter;
    expect(typeof spent.budgetExhausted, '預設 router 要能問今天預算用完了沒').toBe('function');
    expect(spent.budgetExhausted!()).toBe(true);
    vault({ cap: '1' });
    expect((createDefaultLiveRouter() as LiveRouter).budgetExhausted!()).toBe(false);
  });

  it('LLM_DAILY_CAP_USD=0 是「不設限」:不算用完(守住工單沒寫對的那個前提)', () => {
    vault({ cap: '0', spentUsd: 5 });
    expect((createDefaultLiveRouter() as LiveRouter).budgetExhausted?.()).toBe(false);
  });

  it('沒有指標:照舊丟錯(訊息含 init 與 show),不建 router、不建任何目錄', () => {
    const root = tmpDir('pq-t63-nopointer-');
    Object.assign(process.env, { HOME: root, XDG_CONFIG_HOME: join(root, 'xdg'), XDG_RUNTIME_DIR: join(root, 'runtime') });
    expect(() => createDefaultLiveRouter(join(root, 'learning'))).toThrow(/npx tsx scripts\/vault\.ts init[\s\S]*npx tsx scripts\/vault\.ts show/);
    expect(readdirSync(root)).toEqual([]);
  });
});

// ------------------------------------------------------------------ 3. runGoldenLive

describe('T63 runGoldenLive:建任何目錄之前查預算', () => {
  const SET_OK: GoldenSet = {
    id: 'selftest',
    task: 'grade.apply',
    promptFile: 'packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md',
    inputs: [{ id: 'demo-1', prompt: '任意輸入' }],
  };
  const SET_MISSING: GoldenSet = { ...SET_OK, promptFile: 'packages/core/src/prompt-quality/golden-sets/這個檔案不存在.md' };

  /** 真的 LlmRouterImpl(假網路)+ 可調的 budgetExhausted */
  function routerWith(budget: (() => boolean) | undefined, online = true): LiveRouter {
    const inner = new LlmRouterImpl({ env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: MODEL, ANTHROPIC_API_KEY: 'test-key' }, logAppender: (_e: LogEvent) => {} });
    const router: LiveRouter = {
      call: (task, prompt, opts) => inner.call(task, prompt, opts),
      probeOnline: async () => online && (await inner.probeOnline()),
      probeLocal: () => inner.probeLocal(),
    };
    if (budget) router.budgetExhausted = budget;
    return router;
  }

  async function budgetErr(p: Promise<unknown>): Promise<Error | undefined> {
    return p.then(
      () => undefined,
      (e: unknown) => e as Error,
    );
  }

  it('預設 router、預算用完:丟 LiveRunBudgetExceededError(一句話,含「今日預算已用完」與 LLM_DAILY_CAP_USD);輸出目錄前後一樣;雲端 0 次叫模型、閘道 0 次', async () => {
    exhaustedVault();
    const out = tmpDir('pq-t63-out-');
    const Cls = (goldenRun as Record<string, unknown>)['LiveRunBudgetExceededError'] as (new (set: string) => Error) | undefined;
    expect(typeof Cls, 'golden-run.ts 要匯出 LiveRunBudgetExceededError').toBe('function');
    const err = await budgetErr(runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live' }));
    expect(err, '預算用完要丟錯').toBeInstanceOf(Cls!);
    expect(err!.message).toContain('今日預算已用完');
    expect(err!.message).toContain('LLM_DAILY_CAP_USD');
    expect(err!.message.includes('\n')).toBe(false);
    expect(readdirSync(out), '沒有建 set 的資料夾、沒有 prompt.snapshot.md').toEqual([]);
    expect(modelCalls).toBe(0);
    expect(gatewayCalls).toBe(0);
  });

  it('注入的 router 預算用完:同樣丟 LiveRunBudgetExceededError、輸出目錄不變、一個模型都沒叫', async () => {
    const out = tmpDir('pq-t63-out-');
    const Cls = (goldenRun as Record<string, unknown>)['LiveRunBudgetExceededError'] as new (set: string) => Error;
    const err = await budgetErr(runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => routerWith(() => true) }, SET_OK));
    expect(typeof Cls).toBe('function');
    expect(err).toBeInstanceOf(Cls);
    expect(readdirSync(out)).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('預算檢查在讀 prompt 檔之前:prompt 檔不存在 + 預算用完 → 丟的是預算錯,不是「prompt 檔不存在」', async () => {
    const out = tmpDir('pq-t63-out-');
    const err = await budgetErr(runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => routerWith(() => true) }, SET_MISSING));
    expect(err?.message).toContain('今日預算已用完');
    expect(err?.message).not.toContain('prompt 檔不存在');
    expect(readdirSync(out)).toEqual([]);
  });

  it('預算檢查在 probeOnline 之後:離線 + 預算用完 → 丟的是 LiveRunOfflineError', async () => {
    const out = tmpDir('pq-t63-out-');
    const err = await budgetErr(runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => routerWith(() => true, false) }, SET_OK));
    expect(err).toBeInstanceOf(goldenRun.LiveRunOfflineError);
    expect(readdirSync(out)).toEqual([]);
  });

  it('預算沒用完(budgetExhausted() 回 false):照常跑、寫輸出', async () => {
    const out = tmpDir('pq-t63-out-');
    const result = await runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => routerWith(() => false) }, SET_OK);
    expect(result.outputs).toHaveLength(1);
    expect(modelCalls).toBe(1);
  });

  it('router 沒有 budgetExhausted(測試注入的):照舊不查,照常跑', async () => {
    const out = tmpDir('pq-t63-out-');
    const result = await runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => routerWith(undefined) }, SET_OK);
    expect(result.outputs).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ 4. CLI

describe('T63 CLI:prompt-check --golden --live,預算用完', () => {
  it('退出碼 1、輸出就是一行「✗ …今日預算已用完…」、沒有以 at 開頭的行、輸出資料夾不變、雲端 0 次叫模型', async () => {
    exhaustedVault();
    const out = tmpDir('pq-t63-cli-out-');
    const result = await main(['--golden', '--live', '--set', 'selftest', '--out', out]);
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('✗');
    expect(result.output).toContain('今日預算已用完');
    expect(result.output.split('\n').filter((l) => /^\s*at\s/.test(l))).toEqual([]);
    expect(result.output.split('\n').filter((l) => l.trim().length > 0), `只有一行:${result.output}`).toHaveLength(1);
    expect(readdirSync(out)).toEqual([]);
    expect(modelCalls).toBe(0);
    expect(gatewayCalls).toBe(0);
  });

  it('對照組:同一個指令、預算沒用完 → 退出碼 0、寫了輸出(證明上面是預算造成的)', async () => {
    vault({ cap: '100' });
    const out = tmpDir('pq-t63-cli-ok-');
    const result = await main(['--golden', '--live', '--set', 'selftest', '--out', out]);
    expect(result.code, result.output).toBe(0);
    expect(modelCalls).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ 5. 靜態

describe('T63 golden-run.ts 不再自己 new LlmRouterImpl(', () => {
  it('語法樹裡沒有 new LlmRouterImpl( 或 new CloudLlmRouter(;而且有用 createLiveGatewayRouter', () => {
    const text = readFileSync(FILE, 'utf8');
    const sf = ts.createSourceFile('golden-run.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const news: string[] = [];
    let usesLive = false;
    const visit = (n: ts.Node): void => {
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'LlmRouterImpl' || n.expression.text === 'CloudLlmRouter')) news.push(n.expression.text);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'createLiveGatewayRouter') usesLive = true;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(news, 'live golden 的 router 要走 createLiveGatewayRouter(有日上限)').toEqual([]);
    expect(usesLive).toBe(true);
  });
});
