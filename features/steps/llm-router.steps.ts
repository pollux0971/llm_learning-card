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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import {
  CloudLlmRouter,
  LlmTimeoutError,
  MissingCredentialError,
  UnknownTaskError,
  UnsupportedProviderError,
  type CloudAdapter,
  type CloudProvider,
  type LlmResult,
  type LlmTask,
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
