/**
 * T30 驗收 1:批改要用的金鑰檢查(`packages/core/src/llm/credentials.ts`,新檔)。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 量三個純函式與一個樣板:
 *   requiredGradingKeys(env)      批改「先走的那條路」要的鍵名(只看 env,不打網路)
 *   missingGradingKeys(env)       上面那些裡,值是空或沒設的
 *   credentialProblem(err, env)   submit 丟出來的錯是不是憑證問題(看 err 與它的 cause 鏈);認不出來回 undefined
 *   credentialMessage(problem)    兩句固定樣板,只換鍵名
 *
 * `credentialProblem` 回傳物件的內部形狀工單沒定,所以這裡**不看它的欄位**:只看「是不是 undefined」,
 * 以及丟進 `credentialMessage` 之後的整句字。
 *
 * credentials.ts 還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayCallError, GatewayModelRejectedError, MissingCredentialError, NoModelError } from './errors.js';
import { CloudLlmRouter } from './router.js';

const MODULE = pathToFileURL(join(import.meta.dirname, 'credentials.ts')).href;
const ROUTER_SOURCE = join(import.meta.dirname, 'router.ts');

type Env = Record<string, string | undefined>;
interface Credentials {
  requiredGradingKeys(env: Env): string[];
  missingGradingKeys(env: Env): string[];
  credentialProblem(err: unknown, env: Env): unknown;
  credentialMessage(problem: unknown): string;
}

async function load(): Promise<Credentials> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as Partial<Credentials>;
  for (const name of ['requiredGradingKeys', 'missingGradingKeys', 'credentialProblem', 'credentialMessage'] as const) {
    if (typeof mod[name] !== 'function') throw new Error(`packages/core/src/llm/credentials.ts 沒有匯出 ${name}`);
  }
  return mod as Credentials;
}

const MISSING = (key: string): string => `批改要用的金鑰沒有設定:${key}。請在專案根目錄的 .env 加上。`;
const REJECTED = (key: string): string => `批改用的金鑰被拒絕:${key}(可能過期或打錯)。請在專案根目錄的 .env 換一個。`;

/** 帶數字 status 的一般 Error(雲端 SDK 的 401 長這樣) */
function statusError(status: unknown, message = 'Incorrect API key provided'): Error {
  const e = new Error(message);
  (e as unknown as { status: unknown }).status = status;
  return e;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requiredGradingKeys:要哪個鍵照 router 實際先走的那條路(驗收 1)', () => {
  it('LLM_CLOUD_PROVIDER = openai → 只要 OPENAI_API_KEY', async () => {
    const c = await load();
    expect(c.requiredGradingKeys({ LLM_CLOUD_PROVIDER: 'openai' })).toEqual(['OPENAI_API_KEY']);
  });

  it('LLM_CLOUD_PROVIDER = anthropic → 只要 ANTHROPIC_API_KEY', async () => {
    const c = await load();
    expect(c.requiredGradingKeys({ LLM_CLOUD_PROVIDER: 'anthropic' })).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('沒設 provider → 只要 GATEWAY_API_KEY(probeOnline 回 false,應用題走 local = 閘道),不要雲端的鍵', async () => {
    const c = await load();
    expect(c.requiredGradingKeys({})).toEqual(['GATEWAY_API_KEY']);
  });

  it.each(['', 'gemini', 'banana', 'OPENAI', ' openai'])('provider 是空的或不認得(%j)→ 照「沒有雲端」算,要 GATEWAY_API_KEY', async (provider) => {
    const c = await load();
    expect(c.requiredGradingKeys({ LLM_CLOUD_PROVIDER: provider })).toEqual(['GATEWAY_API_KEY']);
  });

  it('只看 provider,不看哪些鍵剛好有設:雲端 provider 下閘道鍵有設也一樣要雲端的鍵;反過來也是', async () => {
    const c = await load();
    expect(c.requiredGradingKeys({ LLM_CLOUD_PROVIDER: 'openai', GATEWAY_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })).toEqual(['OPENAI_API_KEY']);
    expect(c.requiredGradingKeys({ LLM_CLOUD_PROVIDER: 'anthropic', OPENAI_API_KEY: 'o' })).toEqual(['ANTHROPIC_API_KEY']);
    expect(c.requiredGradingKeys({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' })).toEqual(['GATEWAY_API_KEY']);
  });

  it('跟 router 算得一樣:CloudLlmRouter 沒有鍵時丟的 MissingCredentialError.envVar,就是 requiredGradingKeys 的第一個(openai / anthropic)', async () => {
    const c = await load();
    for (const provider of ['openai', 'anthropic']) {
      const env = { LLM_CLOUD_PROVIDER: provider, LLM_CLOUD_MODEL: 'm' };
      const router = new CloudLlmRouter({ env, logAppender: () => {} });
      const err = await router.call('grade.apply', 'x').then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, provider).toBeInstanceOf(MissingCredentialError);
      expect((err as MissingCredentialError).envVar).toBe(c.requiredGradingKeys(env)[0]);
    }
  });

  it('router.ts 不再自己留一份 envVarFor(抽成可匯出的純函式,兩邊共用)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(ROUTER_SOURCE, 'utf8');
    expect(src).not.toMatch(/function\s+envVarFor\s*\(/);
  });
});

describe('missingGradingKeys(驗收 1)', () => {
  it('必要的鍵沒設 → 列出來;設了 → 空陣列', async () => {
    const c = await load();
    expect(c.missingGradingKeys({})).toEqual(['GATEWAY_API_KEY']);
    expect(c.missingGradingKeys({ GATEWAY_API_KEY: 'k' })).toEqual([]);
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'openai' })).toEqual(['OPENAI_API_KEY']);
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).toEqual([]);
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'anthropic' })).toEqual(['ANTHROPIC_API_KEY']);
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).toEqual([]);
  });

  it('空字串當沒設', async () => {
    const c = await load();
    expect(c.missingGradingKeys({ GATEWAY_API_KEY: '' })).toEqual(['GATEWAY_API_KEY']);
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: '' })).toEqual(['OPENAI_API_KEY']);
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' })).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('別條路的鍵有設不算數(要的是 ANTHROPIC,只設了 OPENAI 與 GATEWAY → 還是缺 ANTHROPIC)', async () => {
    const c = await load();
    expect(c.missingGradingKeys({ LLM_CLOUD_PROVIDER: 'anthropic', OPENAI_API_KEY: 'o', GATEWAY_API_KEY: 'g' })).toEqual(['ANTHROPIC_API_KEY']);
    expect(c.missingGradingKeys({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' })).toEqual(['GATEWAY_API_KEY']);
  });
});

describe('credentialProblem:認得三種憑證錯誤(驗收 1)', () => {
  it('MissingCredentialError → 缺;鍵 = 它的 envVar(閘道 client 在 try 外面建,不會被包)', async () => {
    const c = await load();
    const problem = c.credentialProblem(new MissingCredentialError('GATEWAY_API_KEY'), {});
    expect(problem).toBeDefined();
    expect(c.credentialMessage(problem)).toBe(MISSING('GATEWAY_API_KEY'));
  });

  it.each(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY'])('MissingCredentialError(%s):鍵名用錯誤自己帶的,不是看目前 provider', async (key) => {
    const c = await load();
    expect(c.credentialMessage(c.credentialProblem(new MissingCredentialError(key), { LLM_CLOUD_PROVIDER: 'anthropic' }))).toBe(MISSING(key));
  });

  it('GatewayCallError status 401 → 被拒絕;鍵 = GATEWAY_API_KEY(就算 provider 是雲端)', async () => {
    const c = await load();
    const problem = c.credentialProblem(new GatewayCallError('chat returned 401', 401), { LLM_CLOUD_PROVIDER: 'openai' });
    expect(problem).toBeDefined();
    expect(c.credentialMessage(problem)).toBe(REJECTED('GATEWAY_API_KEY'));
  });

  it('GatewayCallError 401 被包在 NoModelError 的 cause 裡(callGateway 實際的樣子)也認得', async () => {
    const c = await load();
    const wrapped = new NoModelError('grade.apply', { detail: 'local gateway unreachable: x', cause: new GatewayCallError('chat returned 401', 401) });
    expect(c.credentialMessage(c.credentialProblem(wrapped, {}))).toBe(REJECTED('GATEWAY_API_KEY'));
  });

  it('換 token 時被拒(token exchange returned 401)也是 GatewayCallError 401,認得', async () => {
    const c = await load();
    const wrapped = new NoModelError('grade.apply', { cause: new GatewayCallError('token exchange returned 401', 401) });
    expect(c.credentialMessage(c.credentialProblem(wrapped, {}))).toBe(REJECTED('GATEWAY_API_KEY'));
  });

  it('cause 鏈好幾層:Error → Error → GatewayCallError 401 也認得(第一個認得的算)', async () => {
    const c = await load();
    const deep = new Error('outer', { cause: new Error('middle', { cause: new GatewayCallError('chat returned 401', 401) }) });
    expect(c.credentialMessage(c.credentialProblem(deep, {}))).toBe(REJECTED('GATEWAY_API_KEY'));
  });

  it('外層就是 MissingCredentialError、cause 裡還有 401:第一個認得的(外層)算', async () => {
    const c = await load();
    const err = new MissingCredentialError('OPENAI_API_KEY');
    (err as { cause?: unknown }).cause = new GatewayCallError('chat returned 401', 401);
    expect(c.credentialMessage(c.credentialProblem(err, {}))).toBe(MISSING('OPENAI_API_KEY'));
  });

  it('其他 Error 帶數字 status 401(雲端 SDK 的 401)→ 被拒絕;鍵 = 目前 provider 的鍵', async () => {
    const c = await load();
    expect(c.credentialMessage(c.credentialProblem(statusError(401), { LLM_CLOUD_PROVIDER: 'openai' }))).toBe(REJECTED('OPENAI_API_KEY'));
    expect(c.credentialMessage(c.credentialProblem(statusError(401), { LLM_CLOUD_PROVIDER: 'anthropic' }))).toBe(REJECTED('ANTHROPIC_API_KEY'));
    expect(c.credentialMessage(c.credentialProblem(statusError(401), {}))).toBe(REJECTED('GATEWAY_API_KEY'));
  });

  it('雲端 401 也可以被包在 cause 裡', async () => {
    const c = await load();
    const wrapped = new Error('wrapper', { cause: statusError(401) });
    expect(c.credentialMessage(c.credentialProblem(wrapped, { LLM_CLOUD_PROVIDER: 'anthropic' }))).toBe(REJECTED('ANTHROPIC_API_KEY'));
  });
});

describe('credentialProblem:認不出來的一律 undefined(照舊 internal)(驗收 1)', () => {
  it.each([400, 402, 403, 404, 429, 500, 502, 503, 0])('一般 Error 的 status %i 不算憑證問題(403 是模型名填錯,不是金鑰)', async (status) => {
    const c = await load();
    expect(c.credentialProblem(statusError(status), { LLM_CLOUD_PROVIDER: 'openai' })).toBeUndefined();
  });

  it.each(['401', 401.5, null, undefined, Number.NaN])('status 不是整數 401 的數字(%j)不算', async (status) => {
    const c = await load();
    expect(c.credentialProblem(statusError(status), {})).toBeUndefined();
  });

  it('GatewayCallError 的其他 status(500、403、沒有 status)不算', async () => {
    const c = await load();
    expect(c.credentialProblem(new GatewayCallError('chat returned 500', 500), {})).toBeUndefined();
    expect(c.credentialProblem(new GatewayCallError('chat returned 403', 403), {})).toBeUndefined();
    expect(c.credentialProblem(new GatewayCallError('network down'), {})).toBeUndefined();
    expect(c.credentialProblem(new NoModelError('grade.apply', { cause: new GatewayCallError('chat returned 503', 503) }), {})).toBeUndefined();
  });

  it('GatewayModelRejectedError(閘道的 403)不算', async () => {
    const c = await load();
    expect(c.credentialProblem(new GatewayModelRejectedError('gpt-x'), {})).toBeUndefined();
  });

  it('MissingCredentialError 的鍵不在三個之內 → undefined(鍵名只能從三個挑)', async () => {
    const c = await load();
    expect(c.credentialProblem(new MissingCredentialError('SOME_OTHER_KEY'), {})).toBeUndefined();
    expect(c.credentialProblem(new MissingCredentialError(''), {})).toBeUndefined();
  });

  it('不是 Error 的東西(字串、null、undefined、數字)→ undefined', async () => {
    const c = await load();
    for (const v of ['401', 'MissingCredentialError', null, undefined, 401]) expect(c.credentialProblem(v, {}), String(v)).toBeUndefined();
  });

  it('一般的 Error、reviews-changed 這類 → undefined', async () => {
    const c = await load();
    expect(c.credentialProblem(new Error('boom'), {})).toBeUndefined();
    expect(c.credentialProblem(Object.assign(new Error('x'), { code: 'reviews-changed' }), {})).toBeUndefined();
  });

  it('cause 繞成圈也要結束(不無窮迴圈),而且認不出來回 undefined', async () => {
    const c = await load();
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(c.credentialProblem(a, {})).toBeUndefined();
  });
});

describe('credentialMessage:兩句固定樣板(驗收 1)', () => {
  it('缺:全文', async () => {
    const c = await load();
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY']) {
      expect(c.credentialMessage(c.credentialProblem(new MissingCredentialError(key), {}))).toBe(MISSING(key));
    }
  });

  it('被拒絕:全文', async () => {
    const c = await load();
    expect(c.credentialMessage(c.credentialProblem(new GatewayCallError('chat returned 401', 401), {}))).toBe(REJECTED('GATEWAY_API_KEY'));
    expect(c.credentialMessage(c.credentialProblem(statusError(401), { LLM_CLOUD_PROVIDER: 'openai' }))).toBe(REJECTED('OPENAI_API_KEY'));
  });

  it('不帶鍵的值、不帶絕對路徑、不帶例外原文', async () => {
    const c = await load();
    const SECRET = 'sk-SECRETVALUE-0123456789';
    const PATH = '/home/someone/project/.env';
    const env = { LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: SECRET };
    const errors = [
      statusError(401, `Incorrect API key provided: ${SECRET}. See ${PATH}`),
      new GatewayCallError(`chat returned 401 token ${SECRET} at ${PATH}`, 401),
      new NoModelError('grade.apply', { detail: `${SECRET} ${PATH}`, cause: new GatewayCallError(`bad ${SECRET} ${PATH}`, 401) }),
      new MissingCredentialError('OPENAI_API_KEY'),
    ];
    for (const err of errors) {
      const problem = c.credentialProblem(err, env);
      expect(problem).toBeDefined();
      const text = c.credentialMessage(problem);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(PATH);
      expect(text).not.toContain('Incorrect');
      expect(text).not.toContain('chat returned');
      expect(text).not.toContain('missing credential');
      expect(text).not.toMatch(/\/home|\/tmp|\\/);
      expect([MISSING('OPENAI_API_KEY'), REJECTED('OPENAI_API_KEY'), REJECTED('GATEWAY_API_KEY'), MISSING('GATEWAY_API_KEY')]).toContain(text);
    }
  });

  it('可能出現的訊息是有限的幾句:三個鍵 × 兩種 = 6 句,別的都不是', async () => {
    const c = await load();
    const seen = new Set<string>();
    const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY'];
    for (const key of keys) seen.add(c.credentialMessage(c.credentialProblem(new MissingCredentialError(key), {})));
    for (const provider of ['openai', 'anthropic', undefined]) {
      const env = provider === undefined ? {} : { LLM_CLOUD_PROVIDER: provider };
      seen.add(c.credentialMessage(c.credentialProblem(statusError(401), env)));
    }
    seen.add(c.credentialMessage(c.credentialProblem(new GatewayCallError('x', 401), {})));
    expect([...seen].sort()).toEqual([...keys.map(MISSING), ...keys.map(REJECTED)].sort());
  });
});

describe('不打網路(驗收 1)', () => {
  it('把 globalThis.fetch 換成會丟錯的:四個函式全跑一遍,fetch 一次都沒被叫', async () => {
    const c = await load();
    const spy = vi.fn(() => {
      throw new Error('檢查金鑰不該打網路');
    });
    vi.stubGlobal('fetch', spy);
    try {
      for (const env of [{}, { LLM_CLOUD_PROVIDER: 'openai' }, { LLM_CLOUD_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }]) {
        c.requiredGradingKeys(env);
        c.missingGradingKeys(env);
        c.credentialProblem(new MissingCredentialError('GATEWAY_API_KEY'), env);
        c.credentialProblem(statusError(401), env);
        c.credentialMessage(c.credentialProblem(new GatewayCallError('x', 401), env));
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('函式本身是同步的純函式(回傳的不是 Promise)', async () => {
    const c = await load();
    expect(c.requiredGradingKeys({})).not.toBeInstanceOf(Promise);
    expect(c.missingGradingKeys({})).not.toBeInstanceOf(Promise);
    expect(c.credentialProblem(new Error('x'), {})).not.toBeInstanceOf(Promise);
  });
});
