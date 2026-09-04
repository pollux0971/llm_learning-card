/**
 * 03-llm-router/phase-1 的步驟定義。
 *
 * 除了「the standalone probe command is run」(@standalone,真的打一次 OpenAI 的
 * probeOnline)與 @manual 場景之外,其餘全部用注入的假 adapter 跑——不打真網路。
 * 假 adapter 一被呼叫就把記錄推進 world.networkRequests / world.llmCalls,讓
 * common.steps.ts 的「no network request is made」有牙齒可咬,不是空陣列硬過。
 */
import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import {
  CloudLlmRouter,
  CloudRequiredError,
  LlmRouterImpl,
  LlmTimeoutError,
  MissingCredentialError,
  NoModelError,
  ROUTING_TABLE,
  UnknownTaskError,
  UnsupportedProviderError,
  decideRoute,
  type CloudAdapter,
  type CloudProvider,
  type LlmResult,
  type LlmTask,
  type RouteDecision,
  type RouteGroup,
} from '../../packages/core/src/llm/index.js';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // @manual 場景才需要真的憑證;自動測試全部用假 adapter,沒有 .env 也能跑
}

interface StepState {
  provider?: string | undefined;
  hasApiKey: boolean;
  envModel?: string | undefined;
  settingsModel?: string | undefined;
  hangs: boolean;
  defaultTimeoutMs: number;
  perCallTimeoutMs?: number | undefined;
  usedAdapter?: CloudProvider | undefined;
  logDir?: string;
  logPath?: string;
  lastLogEvent?: Record<string, unknown>;
  dualResults?: [LlmResult, LlmResult];
}

let state: StepState;

Before(function () {
  state = { hasApiKey: true, envModel: 'test-model', hangs: false, defaultTimeoutMs: 5_000 };
});

After(function () {
  if (state.logDir) rmSync(state.logDir, { recursive: true, force: true });
});

function makeAdapter(world: LearningWorld, name: CloudProvider): CloudAdapter {
  return {
    async call(args) {
      world.networkRequests.push(`${name}:${args.model}`);
      world.llmCalls.push({ task: 'llm-router-call', prompt: args.prompt });
      state.usedAdapter = name;
      if (state.hangs) return new Promise<never>(() => {});
      return { text: `stub response from ${name}`, provider: name, model: args.model, latency_ms: 3, tokens_in: 7, tokens_out: 9 };
    },
  };
}

function buildRouter(world: LearningWorld): CloudLlmRouter {
  const env: NodeJS.ProcessEnv = {};
  if (state.provider) env.LLM_CLOUD_PROVIDER = state.provider;
  if (state.envModel) env.LLM_CLOUD_MODEL = state.envModel;
  if (state.hasApiKey) {
    if (state.provider === 'anthropic') env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    if (state.provider === 'openai') env.OPENAI_API_KEY = 'test-openai-key';
  }
  if (!state.logDir) state.logDir = mkdtempSync(join(tmpdir(), 'llm-router-steps-'));
  state.logPath = join(state.logDir, 'log.jsonl');

  const settings: { cloud_provider?: string; cloud_model?: string } = {};
  if (state.provider) settings.cloud_provider = state.provider;
  if (state.settingsModel) settings.cloud_model = state.settingsModel;

  return new CloudLlmRouter({
    env,
    settings,
    adapters: { anthropic: makeAdapter(world, 'anthropic'), openai: makeAdapter(world, 'openai') },
    defaultTimeoutMs: state.defaultTimeoutMs,
    logPath: state.logPath,
  });
}

async function runCall(world: LearningWorld, task: string, prompt: string, timeoutMs?: number): Promise<void> {
  const router = buildRouter(world);
  world.lastError = undefined;
  world.lastResult = undefined;
  try {
    world.lastResult = await router.call(task as LlmTask, prompt, timeoutMs !== undefined ? { timeoutMs } : {});
  } catch (err) {
    world.lastError = err as Error;
  }
}

// ---------------------------------------------------------------- Given

Given('the provider is set to anthropic', function () {
  state.provider = 'anthropic';
});

Given('the provider is set to anthropic with no api key present', function () {
  state.provider = 'anthropic';
  state.hasApiKey = false;
});

Given('the configured provider is {word}', function (provider: string) {
  state.provider = provider;
});

Given('the configured provider is not one of the supported values', function () {
  state.provider = 'not-a-real-provider';
});

Given('the settings file names one model', function () {
  state.provider = 'openai';
  state.settingsModel = 'settings-model';
  state.envModel = undefined;
});

Given('the environment names a different one', function () {
  state.envModel = 'env-model';
});

Given('the provider does not respond within the timeout', function () {
  state.provider = 'openai';
  state.hangs = true;
  state.defaultTimeoutMs = 30;
});

Given('a call specifies a shorter timeout', function () {
  state.provider = 'openai';
  state.hangs = true;
  state.defaultTimeoutMs = 5_000;
  state.perCallTimeoutMs = 30;
});

Given('a valid credential', function () {
  // @manual: 真的用 process.env(.env 已在檔案頂端載入),不注入假 adapter
});

// ---------------------------------------------------------------- When

When('a call is made for any task', async function (this: LearningWorld) {
  await runCall(this, 'deepen', 'hello');
});

When('a cloud call is made', async function (this: LearningWorld) {
  await runCall(this, 'deepen', 'hello');
});

When('a call is made for the apply grading task', async function (this: LearningWorld) {
  state.provider ??= 'openai';
  await runCall(this, 'grade.apply', 'hello');
});

When('a call is made', async function (this: LearningWorld) {
  state.provider ??= 'openai';
  await runCall(this, 'deepen', 'hello');
});

When('the provider does not respond within it', async function (this: LearningWorld) {
  await runCall(this, 'deepen', 'hello', state.perCallTimeoutMs);
});

When('a call is made with a task name that is not in the contract', async function (this: LearningWorld) {
  state.provider = 'openai';
  await runCall(this, 'not.a.contract.task', 'hello');
});

When('the same prompt is sent through each adapter', async function (this: LearningWorld) {
  state.provider = 'anthropic';
  const a = await buildRouter(this).call('deepen', 'same prompt');
  state.provider = 'openai';
  const b = await buildRouter(this).call('deepen', 'same prompt');
  state.dualResults = [a, b];
});

When('the standalone probe command is run', function (this: LearningWorld) {
  this.runStandalone();
});

// @manual
When('a short prompt is sent', async function (this: LearningWorld) {
  const router = new CloudLlmRouter();
  try {
    this.lastResult = await router.call('deepen', '用一句話說明什麼是 TCP。');
  } catch (err) {
    this.lastError = err as Error;
  }
});

// ---------------------------------------------------------------- Then

Then('the result contains text, provider, model, latency and a provisional flag', function (this: LearningWorld) {
  assert.equal(this.lastError, undefined, `不該有錯誤:${this.lastError?.message}`);
  const r = this.lastResult as LlmResult;
  for (const key of ['text', 'provider', 'model', 'latency_ms', 'provisional']) {
    assert.ok(key in r, `結果缺少欄位 ${key}:${JSON.stringify(r)}`);
  }
});

Then('the provisional flag is false', function (this: LearningWorld) {
  assert.equal((this.lastResult as LlmResult).provisional, false);
});

Then('the {word} adapter is used', function (adapter: string) {
  assert.equal(state.usedAdapter, adapter, `應該用 ${adapter} adapter,實際用了 ${state.usedAdapter}`);
});

Then('an error naming the unsupported provider is raised', function (this: LearningWorld) {
  assert.ok(this.lastError instanceof UnsupportedProviderError, `應該是 UnsupportedProviderError:${this.lastError}`);
  assert.ok(this.lastError.message.includes(state.provider ?? ''), '錯誤訊息應該點名不支援的 provider');
});

Then('an error naming the missing credential is raised', function (this: LearningWorld) {
  assert.ok(this.lastError instanceof MissingCredentialError, `應該是 MissingCredentialError:${this.lastError}`);
  assert.ok(this.lastError.message.includes('ANTHROPIC_API_KEY'), '錯誤訊息應該點名缺少的環境變數');
});

Then('it does not silently fall back to anything else', function () {
  assert.equal(state.usedAdapter, undefined, '缺憑證時不該呼叫任何 adapter');
});

Then('the model from the environment is used', function (this: LearningWorld) {
  const r = this.lastResult as LlmResult;
  assert.equal(r.model, state.envModel);
});

Then('a call event is appended to the log', function () {
  assert.ok(state.logPath, '還沒有建過 router,logPath 未知');
  const lines = readFileSync(state.logPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'log 檔沒有任何一行');
  state.lastLogEvent = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
});

Then('it records the task, the provider, the model and the latency', function () {
  const e = state.lastLogEvent!;
  assert.equal(e.task, 'grade.apply');
  assert.equal(e.provider, 'openai');
  assert.ok(e.model);
  assert.equal(typeof e.latency_ms, 'number');
});

Then('it records token counts when the provider reports them', function () {
  const e = state.lastLogEvent!;
  assert.equal(e.tokens_in, 7);
  assert.equal(e.tokens_out, 9);
});

Then('a timeout error is raised', function (this: LearningWorld) {
  assert.ok(this.lastError instanceof LlmTimeoutError, `應該是 LlmTimeoutError:${this.lastError}`);
});

Then('the log records the timeout', function () {
  assert.ok(state.logPath, '還沒有建過 router,logPath 未知');
  const lines = readFileSync(state.logPath, 'utf8').trim().split('\n').filter(Boolean);
  const e = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
  assert.equal(e.timeout, true);
});

Then('the error is raised at the shorter deadline', function (this: LearningWorld) {
  assert.ok(this.lastError instanceof LlmTimeoutError);
  assert.equal((this.lastError as LlmTimeoutError).timeoutMs, state.perCallTimeoutMs);
});

Then('the two results have the same set of fields', function () {
  const pair = state.dualResults;
  assert.ok(pair, '還沒有跑過兩個 adapter');
  assert.deepEqual(Object.keys(pair[0]).sort(), Object.keys(pair[1]).sort());
});

Then('an error naming the unknown task is raised', function (this: LearningWorld) {
  assert.ok(this.lastError instanceof UnknownTaskError, `應該是 UnknownTaskError:${this.lastError}`);
});

Then('it prints whether the cloud is reachable', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過 probe');
  assert.match(this.lastRun.output, /online|offline/);
});

// @manual
Then('the returned text is meaningful', function (this: LearningWorld) {
  assert.equal(this.lastError, undefined, `不該有錯誤:${this.lastError?.message}`);
  const r = this.lastResult as LlmResult;
  assert.ok(r.text.trim().length > 0, '回傳文字不該是空的');
});

Then('the latency is greater than zero', function (this: LearningWorld) {
  const r = this.lastResult as LlmResult;
  assert.ok(r.latency_ms > 0);
});

// ============================================================== phase-2
//
// probeLocal 的可注入介面、probeOnline 的快取、routing.ts 的純函式路由表
// (契約 §7,11 組 Outline)。routing.ts 不吃真的 probeOnline/probeLocal,
// 所以「a call is made for the task X」直接呼叫 decideRoute(),不透過
// LlmRouterImpl——ADR-037 之下沒有真的本機模型可以讓完整的 call() 跑到底。

interface RouteStepState {
  localRefuses: boolean;
  lastLocalProbe?: { available: boolean; models: string[] } | undefined;
  lastLocalProbeError?: Error | undefined;
  onlineProbeCalls: number;
  routeOnline?: boolean | undefined;
  routeLocal?: boolean | undefined;
  routeResult?: RouteDecision | undefined;
  routeError?: Error | undefined;
  patchedTable?: Record<LlmTask, RouteGroup> | undefined;
}

let routeState: RouteStepState;

Before(function () {
  routeState = { localRefuses: false, onlineProbeCalls: 0 };
});

// ---------------------------------------------------------------- local probe

Given('the local model server refuses the connection', function () {
  routeState.localRefuses = true;
});

When('the local probe runs', async function () {
  const opts: ConstructorParameters<typeof LlmRouterImpl>[0] = {};
  if (routeState.localRefuses) {
    opts.localProber = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    };
  }
  const router = new LlmRouterImpl(opts);
  routeState.lastLocalProbeError = undefined;
  try {
    routeState.lastLocalProbe = await router.probeLocal();
  } catch (err) {
    routeState.lastLocalProbeError = err as Error;
  }
});

Then('it reports the model as unavailable', function () {
  assert.deepEqual(routeState.lastLocalProbe, { available: false, models: [] });
});

Then('no error is raised', function () {
  assert.equal(routeState.lastLocalProbeError, undefined, `不該有錯誤:${routeState.lastLocalProbeError?.message}`);
});

// ---------------------------------------------------------------- online probe cache

async function runProbeTwiceApart(gapMs: number): Promise<void> {
  let now = 0;
  routeState.onlineProbeCalls = 0;
  const router = new LlmRouterImpl({
    onlineProber: async () => {
      routeState.onlineProbeCalls += 1;
      return true;
    },
    now: () => now,
  });
  await router.probeOnline();
  now += gapMs;
  await router.probeOnline();
}

When('the online probe is called twice ten seconds apart', async function () {
  await runProbeTwiceApart(10_000);
});

When('the online probe is called twice ninety seconds apart', async function () {
  await runProbeTwiceApart(90_000);
});

Then('only one real request is made', function () {
  assert.equal(routeState.onlineProbeCalls, 1, `應該只打一次真的探測,實際打了 ${routeState.onlineProbeCalls} 次`);
});

Then('two real requests are made', function () {
  assert.equal(routeState.onlineProbeCalls, 2, `應該打兩次真的探測,實際打了 ${routeState.onlineProbeCalls} 次`);
});

// ---------------------------------------------------------------- routing table (契約 §7)

Given('the network is {word} and the local model is {word}', function (online: string, local: string) {
  routeState.routeOnline = online === 'up';
  routeState.routeLocal = local === 'up';
});

When('a call is made for the task {word}', function (task: string) {
  routeState.routeResult = undefined;
  routeState.routeError = undefined;
  try {
    routeState.routeResult = decideRoute({
      task: task as LlmTask,
      online: routeState.routeOnline!,
      local: routeState.routeLocal!,
    });
  } catch (err) {
    routeState.routeError = err as Error;
  }
});

Then(/^the outcome is (.+)$/, function (outcome: string) {
  switch (outcome) {
    case 'cloud':
      assert.deepEqual(routeState.routeResult, { target: 'cloud', provisional: false });
      break;
    case 'local':
      assert.deepEqual(routeState.routeResult, { target: 'local', provisional: false });
      break;
    case 'local, marked provisional':
      assert.deepEqual(routeState.routeResult, { target: 'local', provisional: true });
      break;
    case 'error, cloud required':
      assert.ok(routeState.routeError instanceof CloudRequiredError, `應該是 CloudRequiredError:${routeState.routeError}`);
      break;
    case 'error, no model available':
      assert.ok(routeState.routeError instanceof NoModelError, `應該是 NoModelError:${routeState.routeError}`);
      break;
    default:
      throw new Error(`未知的 outcome 字串:「${outcome}」`);
  }
});

// ---------------------------------------------------------------- changing the routing table

Given('the routing entry for the deepen task is changed to require the cloud', function () {
  routeState.patchedTable = { ...ROUTING_TABLE, deepen: 'cloud-only' };
});

When('a deepen call is made while offline', function () {
  routeState.routeError = undefined;
  try {
    decideRoute({ task: 'deepen', online: false, local: true }, routeState.patchedTable);
  } catch (err) {
    routeState.routeError = err as Error;
  }
});

Then('it raises the cloud required error', function () {
  assert.ok(routeState.routeError instanceof CloudRequiredError, `應該是 CloudRequiredError:${routeState.routeError}`);
});

Then('no other change was needed to make that happen', function () {
  // 只改了 patchedTable 這份資料(見上面的 Given),沒有改 decideRoute 本身、
  // 也沒有改 routing.ts 的任何函式——這就是 ROUTING_TABLE 是資料而不是寫死
  // 在 decideRoute 裡的邏輯分支所要達到的效果。
  assert.ok(routeState.patchedTable, '應該已經準備好被改過的路由表');
});

// ============================================================== phase-4(ADR-039)
//
// 閘道本機 adapter + 預算備援。閘道跑在另一台機器上,這一輪它還沒起來,所以自動
// 場景全部用**假的 globalThis.fetch**——照 features/steps/_fake-cloud.mjs 的模式:
// 只換掉最外層的網路邊界,GatewayLlmRouter / LlmRouterImpl / CloudLlmRouter /
// GatewayClient / OpenAI SDK 全都跑真的,整個測試不打真網路。
//
// _fake-cloud.mjs 是在**子程序**裡換 fetch(那個場景要真的跑一次 CLI);這裡是在
// cucumber 自己的程序裡跑,所以覆寫必須有範圍——下面用 tagged Before/After
// (@llm-router and @phase-4)裝上與還原,不會汙染其他場景——注意 @phase-4 這個 tag
// 06/07/10 也在用,所以一定要連 @llm-router 一起限定,否則會換掉別人場景的 fetch。
//
// 真連線的場景標 @manual,等使用者把閘道起起來再跑。

import {
  DailyBudgetExceededError,
  GatewayLlmRouter,
  GatewayModelRejectedError,
  computeDailySpend,
  isBudgetExhausted,
  type DailySpend,
  type SpendPrices,
} from '../../packages/core/src/llm/index.js';
import type { LogEvent } from '../../packages/contracts/src/index.js';

const GATEWAY_BASE_URL = 'http://gateway.test:8787';
const GATEWAY_API_KEY = 'test-gateway-key';
const GATEWAY_LOCAL_MODEL = 'qwen2.5:32b';
const GATEWAY_MODELS = ['qwen2.5:32b', 'deepseek-r1:70b'];
const CAP_USD = 1;
const PRICES: SpendPrices = { inPerM: 2.5, outPerM: 10 };

/** 假閘道的行為開關,每個 scenario 由 Given 步驟設定。 */
interface GatewayStepState {
  /** 401:key 錯 */
  rejectKey: boolean;
  /** 連線被拒(fetch 直接 throw) */
  unreachable: boolean;
  /** 403:model 不是本機模型名 */
  rejectModel: boolean;
  /** 第一次 /gateway/chat 回 401(token 過期),重換 token 後才成功 */
  expireTokenOnce: boolean;
  /** 雲端 /v1/chat/completions 回 503 */
  cloudFails: boolean;
  /** probeOnline() 回 false:雲端連不上(OpenAI 掛了或 DNS 不通),但閘道還在 */
  offline: boolean;
  /** 送給閘道的模型名(403 場景用來斷言錯誤訊息點名了誰) */
  requestedModel: string;

  /** 假 fetch 的計數器 */
  tokenExchanges: number;
  gatewayChats: number;
  cloudCalls: number;
  chatSeen401: boolean;

  /** 種進 log.jsonl 的事件,決定「今天花了多少」 */
  logEvents: LogEvent[];
  logDir?: string;
  logPath?: string;

  /** 探測與呼叫的結果 */
  probeResult?: { available: boolean; models: string[] } | undefined;
  probeError?: Error | undefined;
  callResult?: LlmResult | undefined;
  callError?: Error | undefined;
  spend?: DailySpend | undefined;
  exhausted?: boolean | undefined;

  realFetch?: typeof globalThis.fetch;
}

let gw: GatewayStepState;

function isoOn(day: string, hour: number): string {
  return `${day}T${String(hour).padStart(2, '0')}:30:00+08:00`;
}

/** 今天 / 昨天的本地日期字串,跟 spend.ts 的 dayOf() 用同一種切法。 */
function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 造一筆 llm_call 事件。tokens 由呼叫端算好,讓金額精確可控。 */
function llmCallEvent(day: string, provider: string, tokensIn: number, tokensOut: number): LogEvent {
  return {
    ts: isoOn(day, 9),
    type: 'llm_call',
    task: 'deepen',
    provider,
    model: provider === 'openai' ? 'gpt-5.6-luna' : GATEWAY_LOCAL_MODEL,
    latency_ms: 100,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  } as unknown as LogEvent;
}

/**
 * 花掉剛好 `usd` 美元的一筆事件。只用 output token 算,避免兩個價格相加的浮點誤差:
 * usd = tokens_out / 1e6 * outPerM  →  tokens_out = usd * 1e6 / outPerM
 */
function eventCosting(day: string, usd: number): LogEvent {
  return llmCallEvent(day, 'openai', 0, Math.round((usd * 1_000_000) / PRICES.outPerM));
}

function gatewayEnv(): NodeJS.ProcessEnv {
  return {
    LLM_CLOUD_PROVIDER: 'openai',
    LLM_CLOUD_MODEL: 'gpt-5.6-luna',
    OPENAI_API_KEY: 'test-openai-key',
    GATEWAY_BASE_URL,
    GATEWAY_API_KEY,
    LLM_LOCAL_MODEL: GATEWAY_LOCAL_MODEL,
    LLM_DAILY_CAP_USD: String(CAP_USD),
    LLM_PRICE_IN_PER_M: String(PRICES.inPerM),
    LLM_PRICE_OUT_PER_M: String(PRICES.outPerM),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * 假閘道 + 假雲端,裝在 globalThis.fetch 上。認得五個端點:
 *   POST /auth/token/exchange   換 JWT
 *   GET  /gateway/models        可用模型清單
 *   POST /gateway/chat          本機模型推論
 *   GET  /v1/models             CloudLlmRouter.probeOnline()
 *   POST /v1/chat/completions   OpenAI SDK
 */
function installFakeFetch(): void {
  gw.realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith(GATEWAY_BASE_URL)) {
      if (gw.unreachable) throw new TypeError(`fetch failed: connect ECONNREFUSED ${GATEWAY_BASE_URL}`);

      if (url.includes('/auth/token/exchange')) {
        gw.tokenExchanges += 1;
        if (gw.rejectKey) return jsonResponse({ detail: 'invalid api key' }, 401);
        return jsonResponse({ access_token: `jwt-${gw.tokenExchanges}`, expires_in: 3600 });
      }

      if (url.includes('/gateway/models')) {
        return jsonResponse({
          auto_match: true,
          models: Object.fromEntries(GATEWAY_MODELS.map((m) => [m, ['chat']])),
        });
      }

      if (url.includes('/gateway/chat')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string; model?: string };
        gw.requestedModel = body.model ?? '';
        if (gw.rejectModel) return jsonResponse({ detail: 'model not allowed' }, 403);
        // token 過期:第一次回 401,GatewayClient 應該重換 token 再重試一次
        if (gw.expireTokenOnce && !gw.chatSeen401) {
          gw.chatSeen401 = true;
          return jsonResponse({ detail: 'token expired' }, 401);
        }
        gw.gatewayChats += 1;
        return jsonResponse({
          content: '閘道上的本機模型回覆。',
          provider: 'ollama',
          model: body.model ?? GATEWAY_LOCAL_MODEL,
          tokens_used: { prompt: 11, completion: 13 },
        });
      }
    }

    if (url.includes('/v1/models')) return jsonResponse({ data: [] });

    if (url.includes('/v1/chat/completions')) {
      gw.cloudCalls += 1;
      if (gw.cloudFails) return jsonResponse({ error: { message: 'service unavailable' } }, 503);
      return jsonResponse({
        id: 'chatcmpl-fake',
        model: 'gpt-5.6-luna',
        choices: [{ index: 0, message: { role: 'assistant', content: '雲端回覆。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 9 },
      });
    }

    throw new Error(`phase-4 假 fetch 沒有預期到的請求:${url}`);
  }) as typeof globalThis.fetch;
}

Before({ tags: '@llm-router and @phase-4' }, function () {
  gw = {
    rejectKey: false,
    unreachable: false,
    rejectModel: false,
    expireTokenOnce: false,
    cloudFails: false,
    offline: false,
    requestedModel: '',
    tokenExchanges: 0,
    gatewayChats: 0,
    cloudCalls: 0,
    chatSeen401: false,
    logEvents: [],
  };
  installFakeFetch();
});

After({ tags: '@llm-router and @phase-4' }, function () {
  if (gw?.realFetch) globalThis.fetch = gw.realFetch;
  if (gw?.logDir) rmSync(gw.logDir, { recursive: true, force: true });
});

/** 把 logEvents 寫成一個真的 log.jsonl,回傳路徑。 */
function materializeLog(): string {
  if (!gw.logDir) gw.logDir = mkdtempSync(join(tmpdir(), 'llm-gateway-steps-'));
  gw.logPath = join(gw.logDir, 'log.jsonl');
  writeFileSync(gw.logPath, gw.logEvents.map((e) => JSON.stringify(e)).join('\n') + (gw.logEvents.length ? '\n' : ''));
  return gw.logPath;
}

function buildGatewayRouter(): GatewayLlmRouter {
  return new GatewayLlmRouter({
    env: gatewayEnv(),
    logPath: materializeLog(),
    defaultTimeoutMs: 5_000,
    onlineProber: async () => !gw.offline,
    dailyCapUsd: CAP_USD,
    prices: PRICES,
  });
}

async function runRoutedCall(world: LearningWorld, task: LlmTask): Promise<void> {
  const router = buildGatewayRouter();
  gw.callResult = undefined;
  gw.callError = undefined;
  try {
    gw.callResult = await router.call(task, '請用 50 字說明同源政策。');
  } catch (err) {
    gw.callError = err as Error;
  }
  world.lastResult = gw.callResult;
  world.lastError = gw.callError;
}

/** 讀回剛才那個 log.jsonl 的最後一筆事件(備援場景要看 fallback 欄位)。 */
function logEventsWritten(): Record<string, unknown>[] {
  if (!gw.logPath) return [];
  return readFileSync(gw.logPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function assertFallbackLogged(reason: string): void {
  const written = logEventsWritten();
  const hit = written.find((e) => e.type === 'llm_call' && e.fallback === 'gateway');
  assert.ok(hit, `log 裡沒有 fallback: "gateway" 的 llm_call 事件:${JSON.stringify(written)}`);
  assert.equal(hit.fallback_reason, reason, `備援原因應該是 ${reason}:${JSON.stringify(hit)}`);
}

// ---------------------------------------------------------------- Given

Given('the gateway is configured with a base url, a key and a local model name', function () {
  // 設定值全部在 gatewayEnv() 裡(契約 §11 的三個環境變數),這一步只是把
  // Background 講清楚:每個 phase-4 場景都在「閘道已設定好」的前提下跑。
  assert.ok(GATEWAY_BASE_URL && GATEWAY_API_KEY && GATEWAY_LOCAL_MODEL);
});

Given('the gateway exchanges the key for a token and lists two models', function () {
  gw.rejectKey = false;
  gw.unreachable = false;
});

Given('the gateway rejects the key exchange with 401', function () {
  gw.rejectKey = true;
});

Given('the gateway machine refuses the connection', function () {
  gw.unreachable = true;
});

Given('the gateway is running', function () {
  gw.rejectKey = false;
  gw.unreachable = false;
});

Given('the cloud provider answers 503', function () {
  gw.cloudFails = true;
});

/**
 * probeOnline() 打的是 OpenAI 的 /v1/models。OpenAI 整個不通(5xx 或 DNS 不通)時
 * 它回 false,底層 LlmRouterImpl 就把狀態當成「離線」——但閘道在區網/另一台機器上,
 * 還活著。這一格契約 §7 沒有(它假設「離線」等於「什麼都連不到」),
 * 是 ADR-039 之後才會發生的情況。
 */
Given('the cloud provider cannot be reached at all', function () {
  gw.offline = true;
});

Given("today's log already spends the whole daily cap", function () {
  gw.logEvents.push(eventCosting(localDay(), CAP_USD));
});

Given("today's log spends exactly the daily cap and not a cent more", function () {
  gw.logEvents = [eventCosting(localDay(), CAP_USD)];
});

Given("yesterday's log spends twice the daily cap", function () {
  gw.logEvents.push(eventCosting(localDay(-1), CAP_USD * 2));
});

Given("today's log spends nothing", function () {
  // 不加任何今天的事件——斷言的重點是「昨天的不算進今天」
});

Given("today's log holds only gateway calls with large token counts", function () {
  gw.logEvents = [llmCallEvent(localDay(), 'ollama', 5_000_000, 5_000_000)];
});

Given('the gateway answers 403 because the requested model is not a local one', function () {
  gw.rejectModel = true;
});

Given('the cached token has expired', function () {
  gw.expireTokenOnce = true;
});

// @manual
Given('the real gateway is running and the key is in the env file', function () {
  // @manual:真的用 .env 的 GATEWAY_BASE_URL / GATEWAY_API_KEY,不裝假 fetch。
});

// ---------------------------------------------------------------- When

When('the gateway probe runs', async function () {
  gw.probeResult = undefined;
  gw.probeError = undefined;
  try {
    gw.probeResult = await buildGatewayRouter().probeLocal();
  } catch (err) {
    gw.probeError = err as Error;
  }
});

When('a routed call is made for the fill grading task', async function (this: LearningWorld) {
  await runRoutedCall(this, 'grade.fill.llm');
});

When('a routed call is made for the apply grading task', async function (this: LearningWorld) {
  await runRoutedCall(this, 'grade.apply');
});

When('a routed call is made for the card generation task', async function (this: LearningWorld) {
  await runRoutedCall(this, 'ingest.cards');
});

When('a routed call is made for the deepen task', async function (this: LearningWorld) {
  await runRoutedCall(this, 'deepen');
});

When('the budget is checked', function () {
  gw.spend = computeDailySpend(gw.logEvents, localDay(), PRICES);
  gw.exhausted = isBudgetExhausted(gw.spend.usd, CAP_USD);
});

When('two gateway calls are made inside the token lifetime', async function (this: LearningWorld) {
  const router = buildGatewayRouter();
  gw.callError = undefined;
  try {
    await router.call('grade.fill.llm', '第一次');
    gw.callResult = await router.call('grade.fill.llm', '第二次');
  } catch (err) {
    gw.callError = err as Error;
  }
  this.lastError = gw.callError;
});

// @manual
When('the standalone probe command is run against the real gateway', function (this: LearningWorld) {
  this.runCommand('npx tsx scripts/llm.ts --probe');
});

// ---------------------------------------------------------------- Then

Then('the gateway reports itself as available', function () {
  assert.equal(gw.probeError, undefined, `不該有錯誤:${gw.probeError?.message}`);
  assert.equal(gw.probeResult?.available, true, `應該回報可用:${JSON.stringify(gw.probeResult)}`);
});

Then('the returned model list names both of them', function () {
  assert.deepEqual([...(gw.probeResult?.models ?? [])].sort(), [...GATEWAY_MODELS].sort());
});

Then('the gateway reports itself as unavailable', function () {
  assert.deepEqual(gw.probeResult, { available: false, models: [] }, `應該回報不可用:${JSON.stringify(gw.probeResult)}`);
});

Then('the probe raises no error', function () {
  assert.equal(gw.probeError, undefined, `探測不該丟錯:${gw.probeError?.message}`);
});

Then('the result names the ollama provider', function () {
  assert.equal(gw.callError, undefined, `不該有錯誤:${gw.callError?.message}`);
  assert.equal(gw.callResult?.provider, 'ollama');
});

Then('the result names the configured local model', function () {
  assert.equal(gw.callResult?.model, GATEWAY_LOCAL_MODEL);
});

Then('the result does not carry the provisional flag', function () {
  assert.equal(gw.callResult?.provisional, false, `填空審核本來就走本機,不該標 provisional:${JSON.stringify(gw.callResult)}`);
});

Then('the result carries the provisional flag', function () {
  assert.equal(gw.callResult?.provisional, true, `備援結果應該標 provisional:${JSON.stringify(gw.callResult)}`);
});

Then('the result comes from the gateway', function () {
  assert.equal(gw.callError, undefined, `不該有錯誤:${gw.callError?.message}`);
  assert.equal(gw.callResult?.provider, 'ollama', `應該由閘道回答:${JSON.stringify(gw.callResult)}`);
  assert.ok(gw.gatewayChats >= 1, '閘道應該真的被呼叫過');
});

Then('the log records the gateway fallback and that the cloud call failed', function () {
  assertFallbackLogged('cloud_failed');
});

Then('the log records the gateway fallback and that the budget was exhausted', function () {
  assertFallbackLogged('budget_exhausted');
});

Then('the cloud required error is raised', function () {
  assert.ok(gw.callError instanceof CloudRequiredError, `應該是 CloudRequiredError:${gw.callError?.message}`);
});

Then('the gateway is never called', function () {
  assert.equal(gw.gatewayChats, 0, `不該呼叫閘道,實際呼叫了 ${gw.gatewayChats} 次`);
});

Then('no cloud call is made', function () {
  assert.equal(gw.cloudCalls, 0, `不該呼叫雲端,實際呼叫了 ${gw.cloudCalls} 次`);
});

Then('it is refused with the daily budget message', function () {
  assert.ok(gw.callError instanceof DailyBudgetExceededError, `應該是 DailyBudgetExceededError:${gw.callError?.message}`);
  assert.match(gw.callError.message, /今日預算已用完/);
});

Then('the budget counts as exhausted', function () {
  assert.equal(gw.exhausted, true, `spent=${gw.spend?.usd} cap=${CAP_USD} 應該算已達上限`);
});

Then('the budget does not count as exhausted', function () {
  assert.equal(gw.exhausted, false, `spent=${gw.spend?.usd} cap=${CAP_USD} 不該算已達上限`);
});

Then('an error naming the rejected model is raised', function () {
  assert.ok(gw.callError instanceof GatewayModelRejectedError, `應該是 GatewayModelRejectedError:${gw.callError?.message}`);
  assert.ok(gw.callError.message.includes(gw.requestedModel), '錯誤訊息應該點名被拒絕的模型名');
});

Then('it does not fall back to the cloud', function () {
  assert.equal(gw.cloudCalls, 0, '403 是設定錯誤,不該備援到雲端');
});

Then('the key is exchanged for a token only once', function () {
  assert.equal(gw.callError, undefined, `不該有錯誤:${gw.callError?.message}`);
  assert.equal(gw.tokenExchanges, 1, `token 應該只換一次(快取),實際換了 ${gw.tokenExchanges} 次`);
});

Then('the key is exchanged for a token twice', function () {
  assert.equal(gw.tokenExchanges, 2, `過期後應該重換一次(共兩次),實際換了 ${gw.tokenExchanges} 次`);
});

Then('the call succeeds', function () {
  assert.equal(gw.callError, undefined, `重試後應該成功:${gw.callError?.message}`);
  assert.ok(gw.callResult?.text, '應該拿到回覆文字');
});

// @manual
Then('it reports the local gateway as unavailable', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過 probe');
  const printed = JSON.parse(this.lastRun.output) as { local?: { available?: boolean; models?: string[] } };
  // 閘道沒起來(也可能連 GATEWAY_API_KEY 都沒設):probeLocal() 要接住錯誤回
  // unavailable,不能讓 MissingCredentialError / ECONNREFUSED 冒出來。
  assert.equal(printed.local?.available, false, `local 應該是 unavailable:${this.lastRun.output}`);
  assert.deepEqual(printed.local?.models, []);
});

Then('it prints no stack trace', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過指令');
  assert.doesNotMatch(this.lastRun.output, /\n\s+at\s+\S+/, `不該有 stack trace:${this.lastRun.output}`);
});

Then('it prints the list of models the gateway serves', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過 probe');
  assert.match(this.lastRun.output, /models/);
});
