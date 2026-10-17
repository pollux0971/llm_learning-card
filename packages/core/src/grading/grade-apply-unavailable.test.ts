/**
 * T31 驗收 2:`gradeApply` 遇到「模型這次不能用」→ `{ pass: null, grader: 'error' }`;其他的錯(bug、設定錯誤、憑證)原樣丟出。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 分類本身(哪些錯算模型不能用)由 `../llm/failures.test.ts` 管;這裡量 gradeApply 怎麼用它:
 *   - 模型不能用 → 回 pass null / grader error / 固定那一句 feedback、不帶 criteria;router.call 只被叫一次(不自動重打);
 *     記 witness `grading.apply.llm-unavailable`;記一筆 warning({ type, task, reason: 'llm_unavailable', cause: <原因代號> },
 *     不帶例外原文);
 *   - 其他的錯 → 丟出**同一個物件**(`toBe`),不記 llm-unavailable 的 witness;
 *   - 第一次回應解析不出來(照舊再打一次)、第二次 router.call 丟模型不能用 → 一樣 pass null;第二次丟 bug → 丟出;
 *   - 解析不出來兩次的舊行為照舊(unparsable-skipped,不是 llm-unavailable)。
 * 全部用假 router,不打網路、不花錢。
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LogEvent } from '@contracts/index.js';
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
  UnsupportedProviderError,
} from '../llm/errors.js';
import { MissingLedgerError, UnknownSpendError } from '../llm/spend.js';
import { gradeApply, type ApplyQuestion } from './grade-apply.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

const QUESTION: ApplyQuestion = { prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許 CORS'] };
const ANSWER = '瀏覽器會擋跨來源的請求,伺服器要設定 CORS 標頭才行。';
const UNAVAILABLE_FEEDBACK = '這次沒辦法批改(模型暫時連不上),請再試一次。';
const SECRET = 'SECRET-DETAIL-9f3a-do-not-log';

interface Call {
  task: LlmTask;
  prompt: string;
}
/** LlmResult 就回;其他(Error、字串、物件……)一律丟出 */
type Step = LlmResult | unknown;
const isResult = (v: unknown): v is LlmResult => typeof v === 'object' && v !== null && 'text' in v && 'provider' in v;
function scriptedRouter(steps: Step[]): { router: LlmRouter; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const router: LlmRouter = {
    async call(task, prompt) {
      calls.push({ task, prompt });
      const next = steps[Math.min(i, steps.length - 1)]!;
      i += 1;
      if (!isResult(next)) throw next;
      return next;
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls };
}
function verdict(criteria: boolean[], feedback = '理由'): LlmResult {
  return { text: JSON.stringify({ criteria, feedback }), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
}
function garbage(): LlmResult {
  return { text: 'not json at all', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
}
function withStatus(status: number, message = SECRET): Error {
  return Object.assign(new Error(message), { status });
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

const UNAVAILABLE: [string, () => Error, string][] = [
  ['LlmTimeoutError', () => new LlmTimeoutError('grade.apply', 60_000), 'timeout'],
  ['AbortError', () => Object.assign(new Error('aborted'), { name: 'AbortError' }), 'timeout'],
  ['OutputTruncatedError', () => new OutputTruncatedError('grade.apply', 500, 500), 'truncated'],
  ['NoModelError', () => new NoModelError('grade.apply', { detail: SECRET }), 'no-model'],
  ['NoModelError 包著閘道 503', () => new NoModelError('grade.apply', { cause: new GatewayCallError('chat returned 503', 503) }), 'no-model'],
  ['OpenAI APIConnectionError', () => new OpenAI.APIConnectionError({ message: SECRET, cause: new Error('socket closed') }), 'network'],
  ['OpenAI APIConnectionTimeoutError', () => new OpenAI.APIConnectionTimeoutError(), 'network'],
  ['Anthropic APIConnectionError', () => new Anthropic.APIConnectionError({ message: SECRET, cause: new Error('socket closed') }), 'network'],
  ['Anthropic APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError(), 'network'],
  ['TypeError("fetch failed")', () => new TypeError('fetch failed', { cause: Object.assign(new Error(SECRET), { code: 'ECONNREFUSED' }) }), 'network'],
  ['status 429', () => withStatus(429), 'rate-limited'],
  ['status 500', () => withStatus(500), 'server-error'],
  ['status 503', () => withStatus(503), 'server-error'],
  ['OpenAI InternalServerError', () => OpenAI.APIError.generate(503, { error: { message: SECRET } }, SECRET, new Headers()) as unknown as Error, 'server-error'],
  ['Anthropic RateLimitError', () => Anthropic.APIError.generate(429, { error: { message: SECRET } }, SECRET, new Headers()) as unknown as Error, 'rate-limited'],
  ['包在 cause 第 3 層的逾時', () => new Error('l1', { cause: new Error('l2', { cause: new LlmTimeoutError('grade.apply', 1) }) }), 'timeout'],
];

const PASS_THROUGH: [string, () => unknown][] = [
  ['TypeError(bug)', () => new TypeError("Cannot read properties of undefined (reading 'text')")],
  ['RangeError', () => new RangeError('Invalid array length')],
  ['ReferenceError', () => new ReferenceError('x is not defined')],
  ['普通的 Error', () => new Error('boom')],
  ['ZodError', zodError],
  ['UnknownTaskError', () => new UnknownTaskError('grade.nope')],
  ['UnaccountableLlmCallError', () => new UnaccountableLlmCallError()],
  ['MissingLedgerError', () => new MissingLedgerError()],
  ['UnknownSpendError', () => new UnknownSpendError('/tmp/x/log.jsonl', { lineNumber: 2, line: '{', what: '不是 JSON' })],
  ['GatewayModelRejectedError(設定錯誤)', () => new GatewayModelRejectedError('auto')],
  ['UnsupportedProviderError(設定錯誤)', () => new UnsupportedProviderError('azure')],
  ['CloudRequiredError(設定錯誤)', () => new CloudRequiredError('ingest.cards')],
  ['雲端 400', () => withStatus(400, 'Unsupported parameter')],
  ['雲端 403', () => withStatus(403, 'forbidden')],
  ['雲端 404', () => withStatus(404, 'model not found')],
  ['MissingCredentialError(OPENAI_API_KEY)', () => new MissingCredentialError('OPENAI_API_KEY')],
  ['MissingCredentialError(GATEWAY_API_KEY)', () => new MissingCredentialError('GATEWAY_API_KEY')],
  ['雲端 401', () => withStatus(401, 'Incorrect API key provided')],
  ['OpenAI AuthenticationError', () => OpenAI.APIError.generate(401, { error: { message: 'bad key' } }, 'bad key', new Headers())],
  ['Anthropic AuthenticationError', () => Anthropic.APIError.generate(401, { error: { message: 'bad key' } }, 'bad key', new Headers())],
  ['閘道 401', () => new GatewayCallError('token exchange returned 401', 401)],
  ['NoModelError 包著閘道 401(憑證不能被收成「連不上」)', () => new NoModelError('grade.apply', { cause: new GatewayCallError('token exchange returned 401', 401) })],
  ['NoModelError 包著缺鍵', () => new NoModelError('grade.apply', { cause: new MissingCredentialError('GATEWAY_API_KEY') })],
  ['四層深才有逾時(第 4 層不看)', () => new Error('l1', { cause: new Error('l2', { cause: new Error('l3', { cause: new LlmTimeoutError('grade.apply', 1) }) }) })],
  ['不是 Error 的丟出物(字串)', () => 'fetch failed'],
  ['不是 Error 的丟出物(帶 status 的物件)', () => ({ status: 503 })],
];

describe('模型不能用 → 評分失敗的結果(驗收 2)', () => {
  it.each(UNAVAILABLE)('%s:回 pass null / grader error / 固定 feedback,不帶 criteria', async (_name, make) => {
    const { router } = scriptedRouter([make()]);
    const result = await gradeApply(QUESTION, ANSWER, router);
    expect(result).toEqual({ pass: null, feedback: UNAVAILABLE_FEEDBACK, grader: 'error' });
    expect('criteria' in result).toBe(false);
  });

  it.each(UNAVAILABLE)('%s:這一題 router.call 只打一次(不自動重打,使用者不會多等一倍)', async (_name, make) => {
    const { router, calls } = scriptedRouter([make(), verdict([true, true])]);
    await gradeApply(QUESTION, ANSWER, router);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe('grade.apply');
  });

  it('固定那一句 feedback 不含例外原文(也不含 SECRET)', async () => {
    const { router } = scriptedRouter([new NoModelError('grade.apply', { detail: SECRET })]);
    const result = await gradeApply(QUESTION, ANSWER, router);
    expect(result.feedback).not.toContain(SECRET);
    expect(result.feedback).toBe(UNAVAILABLE_FEEDBACK);
  });

  it('空白答案照舊不碰 router,也不記 llm-unavailable', async () => {
    const { router, calls } = scriptedRouter([new LlmTimeoutError('grade.apply', 1)]);
    const result = await gradeApply(QUESTION, '   ', router);
    expect(result).toEqual({ pass: false, feedback: '沒有作答', grader: 'empty' });
    expect(calls).toHaveLength(0);
    expect(witnessed()['grading.apply.llm-unavailable']).toBeUndefined();
  });
});

describe('其他的錯原樣丟出(驗收 2:bug 不藏、設定錯誤不收、憑證不收)', () => {
  it.each(PASS_THROUGH)('%s:gradeApply 丟出同一個物件', async (_name, make) => {
    const thrown = make();
    const { router } = scriptedRouter([thrown]);
    let caught: unknown = Symbol('沒有丟');
    try {
      await gradeApply(QUESTION, ANSWER, router);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(thrown);
  });

  it.each(PASS_THROUGH)('%s:不記 llm-unavailable 的 witness、不寫 llm_unavailable 的 warning', async (_name, make) => {
    const events: LogEvent[] = [];
    const { router } = scriptedRouter([make()]);
    await gradeApply(QUESTION, ANSWER, router, { logAppender: (e) => events.push(e) }).catch(() => undefined);
    expect(witnessed()['grading.apply.llm-unavailable']).toBeUndefined();
    expect(events.filter((e) => (e as { reason?: unknown }).reason === 'llm_unavailable')).toEqual([]);
  });

  it('丟出時 router.call 也只打了一次', async () => {
    const { router, calls } = scriptedRouter([new TypeError('bug')]);
    await expect(gradeApply(QUESTION, ANSWER, router)).rejects.toThrow('bug');
    expect(calls).toHaveLength(1);
  });
});

describe('兩次嘗試的迴圈:解析不出來照舊再打一次(驗收 2)', () => {
  it('第一次解析不出來、第二次 router.call 丟模型不能用 → 一樣 pass null(打了兩次)', async () => {
    const { router, calls } = scriptedRouter([garbage(), new LlmTimeoutError('grade.apply', 1)]);
    const result = await gradeApply(QUESTION, ANSWER, router);
    expect(result).toEqual({ pass: null, feedback: UNAVAILABLE_FEEDBACK, grader: 'error' });
    expect(calls).toHaveLength(2);
    const w = witnessed();
    expect(w['grading.apply.llm-unavailable']).toBe(1);
    expect(w['grading.apply.invalid-response-retry']).toBe(1);
    expect(w['grading.apply.unparsable-skipped']).toBeUndefined();
  });

  it('第一次解析不出來、第二次丟 bug → 丟出同一個物件', async () => {
    const bug = new TypeError('x is not a function');
    const { router, calls } = scriptedRouter([garbage(), bug]);
    await expect(gradeApply(QUESTION, ANSWER, router)).rejects.toBe(bug);
    expect(calls).toHaveLength(2);
  });

  it('第一次解析不出來、第二次丟憑證錯誤 → 丟出同一個物件(不收)', async () => {
    const cred = new MissingCredentialError('OPENAI_API_KEY');
    const { router } = scriptedRouter([garbage(), cred]);
    await expect(gradeApply(QUESTION, ANSWER, router)).rejects.toBe(cred);
  });

  it('兩次都解析不出來:舊行為照舊(unparsable-skipped,不是 llm-unavailable;feedback 是舊的那一句)', async () => {
    const { router, calls } = scriptedRouter([garbage(), garbage()]);
    const result = await gradeApply(QUESTION, ANSWER, router);
    expect(result).toEqual({ pass: null, feedback: '模型回應無法解析,略過本次審核', grader: 'error' });
    expect(calls).toHaveLength(2);
    const w = witnessed();
    expect(w['grading.apply.unparsable-skipped']).toBe(1);
    expect(w['grading.apply.llm-unavailable']).toBeUndefined();
  });

  it('第一次解析不出來、第二次成功 → 照舊通過', async () => {
    const { router, calls } = scriptedRouter([garbage(), verdict([true, true], '都有提到')]);
    const result = await gradeApply(QUESTION, ANSWER, router);
    expect(result).toEqual({ pass: true, criteria: [true, true], feedback: '都有提到', grader: 'cloud' });
    expect(calls).toHaveLength(2);
    expect(witnessed()['grading.apply.llm-unavailable']).toBeUndefined();
  });

  it('一次就成功 → 不記 llm-unavailable', async () => {
    const { router } = scriptedRouter([verdict([true, false])]);
    const result = await gradeApply(QUESTION, ANSWER, router);
    expect(result.pass).toBe(false);
    expect(witnessed()['grading.apply.llm-unavailable']).toBeUndefined();
  });
});

describe('退化訊號 witness(驗收 2)', () => {
  it.each(UNAVAILABLE)('%s:記 grading.apply.llm-unavailable 恰好一次', async (_name, make) => {
    const { router } = scriptedRouter([make()]);
    await gradeApply(QUESTION, ANSWER, router);
    const w = witnessed();
    expect(w['grading.apply.llm-unavailable']).toBe(1);
    expect(w['grading.apply.unparsable-skipped']).toBeUndefined();
    expect(w['grading.apply.invalid-response-retry']).toBeUndefined();
  });
});

describe('warning 記錄(驗收 2)', () => {
  it.each(UNAVAILABLE)('%s:記一筆 { type: warning, task: grade.apply, reason: llm_unavailable, cause: <原因代號> },不含例外原文', async (_name, make, reason) => {
    const events: LogEvent[] = [];
    const { router } = scriptedRouter([make()]);
    await gradeApply(QUESTION, ANSWER, router, { logAppender: (e) => events.push(e) });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ ts: expect.any(String), type: 'warning', task: 'grade.apply', reason: 'llm_unavailable', cause: reason });
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(Number.isNaN(Date.parse(events[0]!.ts))).toBe(false);
  });

  it('給 logPath:log.jsonl 多一行,同樣的欄位,不含例外原文;沒給 logPath / logAppender 就不寫', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't31-apply-'));
    try {
      const logPath = join(dir, 'log.jsonl');
      const { router } = scriptedRouter([new NoModelError('grade.apply', { detail: SECRET })]);
      await gradeApply(QUESTION, ANSWER, router, { logPath });
      const lines = readFileSync(logPath, 'utf8').split('\n').filter((l) => l !== '');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual({ ts: expect.any(String), type: 'warning', task: 'grade.apply', reason: 'llm_unavailable', cause: 'no-model' });
      expect(lines[0]).not.toContain(SECRET);

      const { router: r2 } = scriptedRouter([new NoModelError('grade.apply')]);
      const result = await gradeApply(QUESTION, ANSWER, r2);
      expect(result.grader).toBe('error');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('logAppender 優先於 logPath(照 gradeApply 現在的寫法)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't31-apply-'));
    try {
      const logPath = join(dir, 'log.jsonl');
      const events: LogEvent[] = [];
      const { router } = scriptedRouter([new LlmTimeoutError('grade.apply', 1)]);
      await gradeApply(QUESTION, ANSWER, router, { logPath, logAppender: (e) => events.push(e) });
      expect(events).toHaveLength(1);
      expect(() => readFileSync(logPath, 'utf8')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('解析不出來再打一次的 warning(invalid_response_retry)照舊;模型不能用的那筆接在後面', async () => {
    const events: LogEvent[] = [];
    const { router } = scriptedRouter([garbage(), new LlmTimeoutError('grade.apply', 1)]);
    await gradeApply(QUESTION, ANSWER, router, { logAppender: (e) => events.push(e) });
    expect(events.map((e) => (e as { reason?: unknown }).reason)).toEqual(['invalid_response_retry', 'llm_unavailable']);
  });
});
