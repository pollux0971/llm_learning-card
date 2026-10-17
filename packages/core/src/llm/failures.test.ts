/**
 * T31 驗收 1:`llmUnavailableReason(err)`(`./failures.ts`,新檔)——分辨「模型這次不能用」與「程式的 bug / 設定錯誤 / 憑證」。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 規則(工單原文的表):
 *   先排除憑證(T30 的 credentialProblem 認得的 → undefined),
 *   再看這個錯和它的 cause 鏈(第 1 層 = 錯本身、第 2 層 = cause、第 3 層 = cause 的 cause;第 4 層不看),第一個認得的算:
 *     LlmTimeoutError、name === 'AbortError'                  → timeout
 *     OutputTruncatedError                                    → truncated
 *     NoModelError                                            → no-model
 *     兩家 SDK 的 APIConnectionError(含 APIConnectionTimeoutError;instanceof,SDK 的錯 name 都是 "Error") → network
 *     訊息或 cause.code 符合網路特徵字                         → network
 *     數字 status 429                                         → rate-limited
 *     數字 status >= 500                                      → server-error
 *   其他一律 undefined(bug、設定錯誤、不是 Error 的丟出物)。純函式。
 *
 * 模組還沒有:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 * SDK 的錯一律用真的 class 建(OpenAI.APIConnectionError / Anthropic.APIConnectionError),不是自己捏一個 name 對的物件。
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CloudRequiredError,
  DailyBudgetExceededError,
  GatewayCallError,
  GatewayModelRejectedError,
  LlmTimeoutError,
  MissingCredentialError,
  NoModelError,
  OutputTruncatedError,
  UnaccountableLlmCallError,
  UnknownTaskError,
  UnsupportedProviderError,
} from './errors.js';
import { MissingLedgerError, UnknownSpendError } from './spend.js';

type Reason = 'timeout' | 'truncated' | 'no-model' | 'network' | 'rate-limited' | 'server-error';
interface Failures {
  llmUnavailableReason(err: unknown): Reason | undefined;
}
const FAILURES = pathToFileURL(join(import.meta.dirname, 'failures.ts')).href;
async function reasonOf(err: unknown): Promise<Reason | undefined> {
  const mod = (await import(/* @vite-ignore */ FAILURES)) as Failures;
  return mod.llmUnavailableReason(err);
}

function withStatus(status: unknown, message = 'upstream said no'): Error {
  const e = new Error(message);
  (e as unknown as { status: unknown }).status = status;
  return e;
}
function withCause(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}
function abortError(): Error {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}
function zodError(): unknown {
  try {
    z.object({ a: z.string() }).parse({});
  } catch (e) {
    return e;
  }
  throw new Error('zod 該丟錯');
}
function sdkConnection(sdk: 'openai' | 'anthropic', timeout = false): Error {
  const S = sdk === 'openai' ? OpenAI : Anthropic;
  return timeout ? new S.APIConnectionTimeoutError() : new S.APIConnectionError({ message: 'Connection error.', cause: new Error('socket closed') });
}
function sdkStatus(sdk: 'openai' | 'anthropic', status: number): Error {
  const S = sdk === 'openai' ? OpenAI : Anthropic;
  return S.APIError.generate(status, { error: { message: 'boom' } }, 'boom', new Headers()) as unknown as Error;
}

describe('分類表:每一列(驗收 1)', () => {
  it('前提:兩家 SDK 的錯 name 都是 "Error"(只有 constructor.name 是類別名)——分類不能靠 name 認它們', () => {
    for (const sdk of ['openai', 'anthropic'] as const) {
      const e = sdkConnection(sdk);
      expect(e.name).toBe('Error');
      expect(e.constructor.name).toBe('APIConnectionError');
    }
  });

  it('LlmTimeoutError → timeout', async () => {
    expect(await reasonOf(new LlmTimeoutError('grade.apply', 60_000))).toBe('timeout');
  });

  it('AbortError(閘道用 AbortController 做逾時,abort 丟出來的,沒有被包)→ timeout', async () => {
    expect(await reasonOf(abortError())).toBe('timeout');
  });

  it('DOMException 的 AbortError 也是 timeout', async () => {
    expect(await reasonOf(new DOMException('The operation was aborted.', 'AbortError'))).toBe('timeout');
  });

  it('OutputTruncatedError → truncated', async () => {
    expect(await reasonOf(new OutputTruncatedError('grade.apply', 500, 500))).toBe('truncated');
  });

  it('NoModelError → no-model', async () => {
    expect(await reasonOf(new NoModelError('grade.apply'))).toBe('no-model');
    expect(await reasonOf(new NoModelError('grade.apply', { detail: 'local gateway unreachable: x' }))).toBe('no-model');
  });

  it.each(['openai', 'anthropic'] as const)('%s SDK 的 APIConnectionError(真的 class)→ network', async (sdk) => {
    expect(await reasonOf(sdkConnection(sdk))).toBe('network');
  });

  it.each(['openai', 'anthropic'] as const)('%s SDK 的 APIConnectionTimeoutError(真的 class,子類)→ network', async (sdk) => {
    expect(await reasonOf(sdkConnection(sdk, true))).toBe('network');
  });

  it.each([
    'fetch failed',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1:8787',
    'connect ETIMEDOUT 10.0.0.1:443',
    'getaddrinfo EAI_AGAIN api.example.com',
    'getaddrinfo ENOTFOUND api.example.com',
    'write EPIPE',
    'socket hang up',
    'network error',
    'Fetch Failed',
    'Network Error while fetching',
  ])('訊息含網路特徵字「%s」→ network', async (message) => {
    expect(await reasonOf(new Error(message))).toBe('network');
  });

  it('undici 的連線失敗是 TypeError("fetch failed")(帶 cause)→ network,不因為是 TypeError 就被當 bug', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8787'), { code: 'ECONNREFUSED' });
    expect(await reasonOf(new TypeError('fetch failed', { cause }))).toBe('network');
    expect(await reasonOf(new TypeError('fetch failed'))).toBe('network');
  });

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'])('cause.code 是 %s(訊息沒有特徵字)→ network', async (code) => {
    const e = new Error('request to upstream failed', { cause: Object.assign(new Error('low level'), { code }) });
    expect(await reasonOf(e)).toBe('network');
  });

  it('數字 status 429 → rate-limited', async () => {
    expect(await reasonOf(withStatus(429))).toBe('rate-limited');
  });

  it.each([500, 502, 503, 504, 529, 599])('數字 status %i → server-error', async (status) => {
    expect(await reasonOf(withStatus(status))).toBe('server-error');
  });

  it.each(['openai', 'anthropic'] as const)('%s SDK 的 InternalServerError(503,真的 class)→ server-error', async (sdk) => {
    expect(await reasonOf(sdkStatus(sdk, 503))).toBe('server-error');
  });

  it.each(['openai', 'anthropic'] as const)('%s SDK 的 RateLimitError(429,真的 class)→ rate-limited', async (sdk) => {
    expect(await reasonOf(sdkStatus(sdk, 429))).toBe('rate-limited');
  });

  it('閘道的 GatewayCallError:status 503 → server-error;沒有 status 但訊息是連線失敗 → network', async () => {
    expect(await reasonOf(new GatewayCallError('chat returned 503', 503))).toBe('server-error');
    expect(await reasonOf(new GatewayCallError('chat failed: fetch failed'))).toBe('network');
  });

  it('回傳是同步的字串或 undefined(純函式,不是 Promise)', async () => {
    const mod = (await import(/* @vite-ignore */ FAILURES)) as Failures;
    const r = mod.llmUnavailableReason(new LlmTimeoutError('grade.apply', 1));
    expect(r).toBe('timeout');
    expect(mod.llmUnavailableReason(new TypeError('x is not a function'))).toBeUndefined();
  });
});

describe('排除表:程式的 bug 與設定錯誤不是「模型不能用」(驗收 1)', () => {
  const bugs: [string, () => unknown][] = [
    ['TypeError(一般)', () => new TypeError("Cannot read properties of undefined (reading 'text')")],
    ['TypeError(is not a function)', () => new TypeError('router.call is not a function')],
    ['RangeError', () => new RangeError('Invalid array length')],
    ['ReferenceError', () => new ReferenceError('x is not defined')],
    ['SyntaxError', () => new SyntaxError('Unexpected token < in JSON at position 0')],
    ['普通的 Error', () => new Error('boom')],
    ['ZodError', zodError],
    ['UnknownTaskError', () => new UnknownTaskError('grade.nope')],
    ['UnaccountableLlmCallError', () => new UnaccountableLlmCallError()],
    ['MissingLedgerError', () => new MissingLedgerError()],
    ['UnknownSpendError', () => new UnknownSpendError('/tmp/x/log.jsonl', { lineNumber: 3, line: '{', what: '不是 JSON' })],
    ['DailyBudgetExceededError 不在表裡', () => new DailyBudgetExceededError('ingest.cards', 1, 1)],
  ];
  it.each(bugs)('%s → undefined(讓它往外丟)', async (_name, make) => {
    expect(await reasonOf(make())).toBeUndefined();
  });

  const config: [string, () => unknown][] = [
    ['GatewayModelRejectedError', () => new GatewayModelRejectedError('gpt-5.6-luna')],
    ['UnsupportedProviderError', () => new UnsupportedProviderError('azure')],
    ['CloudRequiredError', () => new CloudRequiredError('ingest.cards')],
    ['雲端 400', () => withStatus(400, 'Unsupported parameter')],
    ['雲端 403', () => withStatus(403, 'forbidden')],
    ['雲端 404', () => withStatus(404, 'model not found')],
    ['SDK 的 BadRequestError(400)', () => sdkStatus('openai', 400)],
    ['SDK 的 NotFoundError(404)', () => sdkStatus('anthropic', 404)],
    ['SDK 的 PermissionDeniedError(403)', () => sdkStatus('openai', 403)],
    ['status 499', () => withStatus(499)],
    ['status 430', () => withStatus(430)],
    ['status 是字串 "503"(不是數字)', () => withStatus('503')],
    ['status 是 NaN', () => withStatus(Number.NaN)],
  ];
  it.each(config)('%s → undefined', async (_name, make) => {
    expect(await reasonOf(make())).toBeUndefined();
  });

  it('不是 Error 的丟出物 → undefined(字串、數字、null、undefined、一般物件、帶 status 的一般物件)', async () => {
    for (const thrown of ['fetch failed', 'ECONNRESET', 503, null, undefined, {}, { message: 'fetch failed' }, { status: 503 }, { status: 429 }, [new Error('x')]]) {
      expect(await reasonOf(thrown), JSON.stringify(thrown) ?? String(thrown)).toBeUndefined();
    }
  });

  it('網路特徵字要在訊息或 cause.code 裡;訊息只是「不是 fetch」或「相近」的字不算', async () => {
    for (const message of ['fetch', 'failed', 'network', 'error', 'timeout', 'ECONN', 'connection', 'socket']) {
      expect(await reasonOf(new Error(message)), message).toBeUndefined();
    }
  });

  it('cause.code 是別的碼(ENOENT、EACCES)→ undefined', async () => {
    for (const code of ['ENOENT', 'EACCES', 'EISDIR', 'ERR_INVALID_ARG_TYPE']) {
      expect(await reasonOf(new Error('x', { cause: Object.assign(new Error('y'), { code }) })), code).toBeUndefined();
    }
  });
});

describe('先排除憑證:憑證問題一律 undefined,讓它往外丟(T30 的 credential-unavailable 才看得到)', () => {
  it('MissingCredentialError(三個批改用的鍵)→ undefined', async () => {
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY']) {
      expect(await reasonOf(new MissingCredentialError(key)), key).toBeUndefined();
    }
  });

  it('雲端 401(帶 status 401)→ undefined,不被當 4xx 以外的別的東西收掉', async () => {
    expect(await reasonOf(withStatus(401, 'Incorrect API key provided'))).toBeUndefined();
  });

  it.each(['openai', 'anthropic'] as const)('%s SDK 的 AuthenticationError(401,真的 class)→ undefined', async (sdk) => {
    expect(await reasonOf(sdkStatus(sdk, 401))).toBeUndefined();
  });

  it('閘道 401(GatewayCallError status 401)→ undefined', async () => {
    expect(await reasonOf(new GatewayCallError('chat returned 401', 401))).toBeUndefined();
  });

  it('NoModelError 包著閘道 401(閘道打不通被包成 NoModelError 的那種)→ undefined,不是 no-model', async () => {
    const wrapped = new NoModelError('grade.apply', { detail: 'local gateway unreachable', cause: new GatewayCallError('token exchange returned 401', 401) });
    expect(await reasonOf(wrapped)).toBeUndefined();
  });

  it('NoModelError 包著缺鍵 → undefined', async () => {
    const wrapped = new NoModelError('grade.apply', { cause: new MissingCredentialError('GATEWAY_API_KEY') });
    expect(await reasonOf(wrapped)).toBeUndefined();
  });

  it('包在一般 Error 的 cause 裡的 401 / 缺鍵 → undefined', async () => {
    expect(await reasonOf(withCause('grading failed', withStatus(401)))).toBeUndefined();
    expect(await reasonOf(withCause('grading failed', new MissingCredentialError('OPENAI_API_KEY')))).toBeUndefined();
  });

  it('401 排在最前面:同一條 cause 鏈上有 401 又有逾時,以憑證為準 → undefined', async () => {
    const chain = withCause('outer', Object.assign(withStatus(401), { cause: new LlmTimeoutError('grade.apply', 1) }));
    expect(await reasonOf(chain)).toBeUndefined();
  });

  it('不是批改用的鍵的 MissingCredentialError 不是 T30 的憑證問題,也不是模型不能用 → undefined(bug 照丟)', async () => {
    expect(await reasonOf(new MissingCredentialError('SOME_OTHER_KEY'))).toBeUndefined();
  });
});

describe('cause 鏈(驗收 1)', () => {
  it('NoModelError 包著 5xx 的 GatewayCallError → no-model(NoModelError 是外層,先認到)', async () => {
    const wrapped = new NoModelError('grade.apply', { cause: new GatewayCallError('chat returned 503', 503) });
    expect(await reasonOf(wrapped)).toBe('no-model');
  });

  it('一般 Error 包著 5xx 的 GatewayCallError → server-error(往 cause 看)', async () => {
    expect(await reasonOf(withCause('grading failed', new GatewayCallError('chat returned 502', 502)))).toBe('server-error');
  });

  it('一般 Error 包著連線失敗 → network', async () => {
    expect(await reasonOf(withCause('grading failed', new TypeError('fetch failed')))).toBe('network');
    expect(await reasonOf(withCause('grading failed', sdkConnection('openai')))).toBe('network');
    expect(await reasonOf(withCause('grading failed', sdkConnection('anthropic', true)))).toBe('network');
  });

  it('第 2 層、第 3 層認得 → 算', async () => {
    expect(await reasonOf(withCause('l1', new LlmTimeoutError('grade.apply', 1)))).toBe('timeout');
    expect(await reasonOf(withCause('l1', withCause('l2', new LlmTimeoutError('grade.apply', 1))))).toBe('timeout');
    expect(await reasonOf(withCause('l1', withCause('l2', withStatus(503))))).toBe('server-error');
    expect(await reasonOf(withCause('l1', withCause('l2', new OutputTruncatedError('grade.apply', 5, 5))))).toBe('truncated');
  });

  it('第 4 層不看:四層深才認得的 → undefined', async () => {
    const deep = withCause('l1', withCause('l2', withCause('l3', new LlmTimeoutError('grade.apply', 1))));
    expect(await reasonOf(deep)).toBeUndefined();
    const deepStatus = withCause('l1', withCause('l2', withCause('l3', withStatus(503))));
    expect(await reasonOf(deepStatus)).toBeUndefined();
  });

  it('第一個認得的算:外層 timeout 包著內層 server-error → timeout;外層 429 包著 timeout → rate-limited', async () => {
    const timeoutOverServer = Object.assign(new LlmTimeoutError('grade.apply', 1), { cause: withStatus(503) });
    expect(await reasonOf(timeoutOverServer)).toBe('timeout');
    expect(await reasonOf(Object.assign(withStatus(429), { cause: new LlmTimeoutError('grade.apply', 1) }))).toBe('rate-limited');
  });

  it('NoModelError 包著逾時 → no-model(外層先)', async () => {
    expect(await reasonOf(new NoModelError('grade.apply', { cause: new LlmTimeoutError('grade.apply', 1) }))).toBe('no-model');
  });

  it('bug 包著 bug → undefined;bug 的 cause 是 400 → undefined', async () => {
    expect(await reasonOf(withCause('wrapper', new TypeError('x is undefined')))).toBeUndefined();
    expect(await reasonOf(withCause('wrapper', withStatus(400)))).toBeUndefined();
    expect(await reasonOf(withCause('wrapper', new GatewayModelRejectedError('auto')))).toBeUndefined();
  });

  it('cause 是 null、undefined、字串、數字、不是 Error 的物件 → 不炸,結果看外層', async () => {
    for (const cause of [null, undefined, 'fetch failed', 503, { status: 503 }]) {
      expect(await reasonOf(withCause('wrapper', cause)), String(cause)).toBeUndefined();
    }
    expect(await reasonOf(Object.assign(new LlmTimeoutError('grade.apply', 1), { cause: 'x' }))).toBe('timeout');
  });

  it('cause 鏈繞圈不會無限迴圈 → undefined', async () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as unknown as { cause: unknown }).cause = b;
    expect(await reasonOf(a)).toBeUndefined();
  });

  it('不改傳進來的錯(不加欄位、不動 cause)', async () => {
    const inner = withStatus(503);
    const outer = withCause('wrapper', inner);
    const before = JSON.stringify(Object.getOwnPropertyNames(outer).concat(Object.getOwnPropertyNames(inner)));
    await reasonOf(outer);
    expect(JSON.stringify(Object.getOwnPropertyNames(outer).concat(Object.getOwnPropertyNames(inner)))).toBe(before);
    expect(outer.cause).toBe(inner);
  });
});

describe('入口(驗收 1)', () => {
  it('llm/index.ts 匯出 llmUnavailableReason(05 從 @core/llm 引用,不另寫一份)', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(import.meta.dirname, 'index.ts')).href)) as Record<string, unknown>;
    expect(typeof mod.llmUnavailableReason).toBe('function');
    expect((mod.llmUnavailableReason as (e: unknown) => unknown)(new LlmTimeoutError('grade.apply', 1))).toBe('timeout');
  });
});
