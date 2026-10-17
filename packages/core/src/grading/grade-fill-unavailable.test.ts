/**
 * T31 驗收 3:`gradeFillBlank` 的同義判斷(`grade.fill.llm`)失敗時,不再一律收成 fallback-strict。
 * 紅測試作者寫;開發 worker 不改。
 *
 *   收成 fallback-strict(照舊,記 witness grading.fill.llm-failed-strict):
 *     模型不能用(llmUnavailableReason 認得的)、NoModelError、缺閘道鍵(MissingCredentialError 且鍵是 GATEWAY_API_KEY)、
 *     閘道 401、模型名被拒(GatewayModelRejectedError)——契約 §7 的「沒有本機模型」那一家。
 *   往外丟(同一個物件):程式的 bug(TypeError 非網路、ZodError……)與其他錯。
 *   填空永遠不回 pass null、不回 credential-unavailable。
 * 全部用假 router,不打網路。
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDegradedTally, installDegradedCollector, type DegradedCollector, type DegradedTally } from '@contracts/witness.js';
import {
  CloudRequiredError,
  GatewayCallError,
  GatewayModelRejectedError,
  LlmTimeoutError,
  MissingCredentialError,
  NoModelError,
  OutputTruncatedError,
  UnaccountableLlmCallError,
  UnknownTaskError,
} from '../llm/errors.js';
import { MissingLedgerError } from '../llm/spend.js';
import { gradeFillBlank, gradeFillQuestion } from './grade-fill.js';
import type { FillQuestion, LlmRouter } from './types.js';

function throwingRouter(thrown: unknown): { router: LlmRouter; calls: number } {
  const state = { router: undefined as unknown as LlmRouter, calls: 0 };
  state.router = {
    async call() {
      state.calls += 1;
      throw thrown;
    },
    async probeOnline() {
      return false;
    },
    async probeLocal() {
      return { available: true, models: ['fake'] };
    },
  };
  return state;
}
function withStatus(status: number): Error {
  return Object.assign(new Error('upstream'), { status });
}
function zodError(): unknown {
  try {
    z.object({ a: z.string() }).parse({});
  } catch (e) {
    return e;
  }
  throw new Error('zod 該丟錯');
}

let tally: DegradedTally;
let previous: DegradedCollector | undefined;
beforeEach(() => {
  tally = createDegradedTally();
  previous = installDegradedCollector(tally);
});
afterEach(() => {
  installDegradedCollector(previous);
});
const witnessed = (): Record<string, number | undefined> => tally.drain() as Record<string, number | undefined>;

/** 打錯到走進第三層(精確、編輯距離都不中) */
const ACCEPTED = ['protocol'];
const TYPED = 'something else entirely';
const STRICT = { pass: false, feedback: '沒有可用模型,無法判斷語意是否相同', grader: 'fallback-strict' } as const;

const FALLBACK: [string, () => Error][] = [
  ['LlmTimeoutError', () => new LlmTimeoutError('grade.fill.llm', 5000)],
  ['AbortError', () => Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ['OutputTruncatedError', () => new OutputTruncatedError('grade.fill.llm', 10, 10)],
  ['NoModelError', () => new NoModelError('grade.fill.llm')],
  ['NoModelError 包著閘道 503', () => new NoModelError('grade.fill.llm', { cause: new GatewayCallError('chat returned 503', 503) })],
  ['缺閘道鍵(MissingCredentialError GATEWAY_API_KEY)', () => new MissingCredentialError('GATEWAY_API_KEY')],
  ['閘道 401', () => new GatewayCallError('token exchange returned 401', 401)],
  ['NoModelError 包著閘道 401', () => new NoModelError('grade.fill.llm', { cause: new GatewayCallError('chat returned 401', 401) })],
  ['模型名被拒(GatewayModelRejectedError)', () => new GatewayModelRejectedError('auto')],
  ['OpenAI APIConnectionError', () => new OpenAI.APIConnectionError({ message: 'Connection error.' })],
  ['Anthropic APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError()],
  ['TypeError("fetch failed")', () => new TypeError('fetch failed')],
  ['status 429', () => withStatus(429)],
  ['status 503', () => withStatus(503)],
];

const PASS_THROUGH: [string, () => unknown][] = [
  ['TypeError(bug)', () => new TypeError("Cannot read properties of undefined (reading 'trim')")],
  ['RangeError', () => new RangeError('Invalid string length')],
  ['ReferenceError', () => new ReferenceError('x is not defined')],
  ['普通的 Error', () => new Error('boom')],
  ['ZodError', zodError],
  ['UnknownTaskError', () => new UnknownTaskError('grade.nope')],
  ['UnaccountableLlmCallError', () => new UnaccountableLlmCallError()],
  ['MissingLedgerError', () => new MissingLedgerError()],
  ['CloudRequiredError', () => new CloudRequiredError('ingest.cards')],
  ['雲端 400', () => withStatus(400)],
  ['雲端 404', () => withStatus(404)],
  ['不是 Error 的丟出物(字串)', () => 'boom'],
  // T31 驗收缺口 F1:isNoLocalModel 的兩條 && 條件各自要有測試守著
  ['缺的是 OPENAI_API_KEY(不是閘道鍵)', () => new MissingCredentialError('OPENAI_API_KEY')],
  ['缺的是 ANTHROPIC_API_KEY(不是閘道鍵)', () => new MissingCredentialError('ANTHROPIC_API_KEY')],
  ['閘道 400', () => new GatewayCallError('chat returned 400', 400)],
  ['閘道 403', () => new GatewayCallError('chat returned 403', 403)],
  ['閘道 404', () => new GatewayCallError('chat returned 404', 404)],
  ['閘道錯沒有 status', () => new GatewayCallError('chat returned nothing useful')],
];

describe('填空同義判斷失敗(驗收 3)', () => {
  it.each(FALLBACK)('%s → fallback-strict,witness 記一次', async (_name, make) => {
    const { router, calls } = (() => {
      const r = throwingRouter(make());
      return { router: r.router, calls: () => r.calls };
    })();
    const result = await gradeFillBlank(ACCEPTED, TYPED, router);
    expect(result).toEqual(STRICT);
    expect(calls()).toBe(1);
    expect(witnessed()['grading.fill.llm-failed-strict']).toBe(1);
  });

  it.each(PASS_THROUGH)('%s → 丟出同一個物件,不記 fallback-strict 的 witness', async (_name, make) => {
    const thrown = make();
    const { router } = throwingRouter(thrown);
    let caught: unknown = Symbol('沒有丟');
    try {
      await gradeFillBlank(ACCEPTED, TYPED, router);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(thrown);
    expect(witnessed()['grading.fill.llm-failed-strict']).toBeUndefined();
  });

  it('填空永遠不回 pass null、不回 error:模型不能用也是 pass false', async () => {
    for (const [, make] of FALLBACK) {
      const { router } = throwingRouter(make());
      const result = await gradeFillBlank(ACCEPTED, TYPED, router);
      expect(result.pass).toBe(false);
      expect(result.grader).toBe('fallback-strict');
    }
  });

  it('精確 / 編輯距離命中的不碰 router,也就不會丟(短路不變)', async () => {
    const { router } = throwingRouter(new TypeError('不該被呼叫'));
    expect((await gradeFillBlank(ACCEPTED, 'protocol', router)).grader).toBe('exact');
    expect((await gradeFillBlank(ACCEPTED, 'protocl', router)).grader).toBe('fuzzy');
    expect((await gradeFillBlank(ACCEPTED, '', router)).grader).toBe('empty');
  });

  const QUESTION: FillQuestion = { prompt: '___ 與 ___', answers: [['protocol'], ['host']] };

  it('gradeFillQuestion:模型不能用 → 照舊把那一格當錯、其他格照算', async () => {
    const { router } = throwingRouter(new LlmTimeoutError('grade.fill.llm', 5000));
    const result = await gradeFillQuestion(QUESTION, ['protocol', 'nope nope nope'], router);
    expect(result.pass).toBe(false);
    expect(result.feedback).toBe('第2格答案應為:host');
    expect(result.grader).toBe('fallback-strict');
  });

  it('gradeFillQuestion:bug 往外丟,整題不收成錯', async () => {
    const bug = new TypeError('x.map is not a function');
    const { router } = throwingRouter(bug);
    await expect(gradeFillQuestion(QUESTION, ['protocol', 'nope nope nope'], router)).rejects.toBe(bug);
  });
});
