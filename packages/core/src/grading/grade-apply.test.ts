import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEvent } from '@contracts/index.js';
import { countWords } from '@core/schema/word-count.js';
import {
  APPLY_FEEDBACK_WORD_LIMIT,
  buildApplyPrompt,
  gradeApply,
  parseApplyVerdict,
  truncateFeedback,
  type ApplyQuestion,
} from './grade-apply.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

const QUESTION: ApplyQuestion = {
  prompt: '前端跨來源呼叫 API 會遇到什麼問題?',
  rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許 CORS', '有提出至少一個解法'],
};

interface Call {
  task: LlmTask;
  prompt: string;
  timeoutMs?: number;
}

/** 依序回應多次呼叫;超過陣列長度就重複最後一筆。回應可以是 LlmResult 或要丟出的 Error。 */
function sequentialRouter(responses: (LlmResult | Error)[]): { router: LlmRouter; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const router: LlmRouter = {
    async call(task, prompt, opts) {
      calls.push(opts?.timeoutMs === undefined ? { task, prompt } : { task, prompt, timeoutMs: opts.timeoutMs });
      const next = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      if (next instanceof Error) throw next;
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

function verdictResult(criteria: boolean[], feedback: string, provisional = false): LlmResult {
  return {
    text: JSON.stringify({ criteria, feedback }),
    provider: 'fake',
    model: 'recorded',
    latency_ms: 0,
    provisional,
  };
}

function textResult(text: string, provisional = false): LlmResult {
  return { text, provider: 'fake', model: 'recorded', latency_ms: 0, provisional };
}

function collectingLog(): { logAppender: (event: LogEvent) => void; events: LogEvent[] } {
  const events: LogEvent[] = [];
  return { logAppender: (event) => events.push(event), events };
}

const tmpDirs: string[] = [];
function tmpLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grade-apply-'));
  tmpDirs.push(dir);
  return join(dir, 'log.jsonl');
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

// ---------------------------------------------------------------- buildApplyPrompt

describe('buildApplyPrompt', () => {
  it('contains the question prompt, every rubric line and the answer', () => {
    const prompt = buildApplyPrompt(QUESTION, '這是跨來源請求,後端要加 CORS header');
    expect(prompt).toContain(QUESTION.prompt);
    for (const line of QUESTION.rubric) expect(prompt).toContain(line);
    expect(prompt).toContain('這是跨來源請求,後端要加 CORS header');
  });

  it('numbers each rubric line in order, one criterion per own line', () => {
    const prompt = buildApplyPrompt(QUESTION, 'answer');
    const lines = prompt.split('\n');
    QUESTION.rubric.forEach((line, i) => {
      expect(lines).toContain(`${i + 1}. ${line}`);
    });
  });

  it('includes the rubric header and the JSON-format instructions as their own lines', () => {
    const prompt = buildApplyPrompt(QUESTION, 'answer');
    const lines = prompt.split('\n');
    expect(lines).toContain('評分規準(rubric):');
    expect(lines).toContain(
      '請針對每一條 rubric 判斷使用者回答是否達成,回傳 JSON,格式為 {"criteria": boolean[], "feedback": string};',
    );
    expect(lines).toContain('criteria 陣列的順序與長度必須對應上面 rubric 的順序與條數,一條 rubric 對應一個 boolean;');
    expect(lines).toContain('feedback 用一句話簡短說明理由。只回傳 JSON,不要有其他文字。');
  });
});

// ---------------------------------------------------------------- parseApplyVerdict

describe('parseApplyVerdict', () => {
  it('parses a valid JSON verdict whose criteria length matches the rubric', () => {
    const verdict = parseApplyVerdict('{"criteria":[true,true,true],"feedback":"三個要點都有講到。"}', 3);
    expect(verdict).toEqual({ criteria: [true, true, true], feedback: '三個要點都有講到。' });
  });

  it('returns null for text that is not JSON', () => {
    expect(parseApplyVerdict('我覺得這個答案還不錯,大概有講到重點吧。', 3)).toBeNull();
  });

  it('returns null when criteria length does not match the rubric length', () => {
    expect(parseApplyVerdict('{"criteria":[true,false],"feedback":"x"}', 3)).toBeNull();
  });

  it('returns null when criteria entries are not booleans', () => {
    expect(parseApplyVerdict('{"criteria":["yes","no","yes"],"feedback":"x"}', 3)).toBeNull();
  });

  it('returns null when feedback is missing', () => {
    expect(parseApplyVerdict('{"criteria":[true,true,true]}', 3)).toBeNull();
  });

  it('returns null for valid JSON that is not an object (e.g. an array)', () => {
    expect(parseApplyVerdict('[true,true,true]', 3)).toBeNull();
  });
});

// ---------------------------------------------------------------- truncateFeedback

describe('truncateFeedback', () => {
  it('returns feedback unchanged when it is within the contract limit', () => {
    const result = truncateFeedback('三個要點都有講到。');
    expect(result).toEqual({ text: '三個要點都有講到。', truncated: false });
  });

  it('truncates feedback over the contract limit and reports it as truncated', () => {
    const long = '這是一段用來測試截斷邏輯的回饋文字'.repeat(6); // 遠超過 40 字
    const result = truncateFeedback(long);
    expect(result.truncated).toBe(true);
    expect(countWords(result.text)).toBeLessThanOrEqual(APPLY_FEEDBACK_WORD_LIMIT);
  });

  it('never returns text longer than a custom limit', () => {
    const long = '一二三四五六七八九十'.repeat(3);
    const result = truncateFeedback(long, 5);
    expect(countWords(result.text)).toBeLessThanOrEqual(5);
  });

  it('keeps feedback unchanged when it is exactly at the word limit (boundary)', () => {
    const exact = '好'.repeat(APPLY_FEEDBACK_WORD_LIMIT);
    expect(countWords(exact)).toBe(APPLY_FEEDBACK_WORD_LIMIT);
    const result = truncateFeedback(exact);
    expect(result).toEqual({ text: exact, truncated: false });
  });

  it('truncates to exactly the word limit and keeps the original prefix, not one word short or extra junk', () => {
    const long = '好'.repeat(APPLY_FEEDBACK_WORD_LIMIT + 10);
    const result = truncateFeedback(long);
    expect(result.truncated).toBe(true);
    expect(countWords(result.text)).toBe(APPLY_FEEDBACK_WORD_LIMIT);
    expect(result.text).toBe(long.slice(0, APPLY_FEEDBACK_WORD_LIMIT));
  });
});

// ---------------------------------------------------------------- gradeApply

describe('gradeApply', () => {
  it('fails an empty answer as grader empty, without touching the model', async () => {
    const { router, calls } = sequentialRouter([verdictResult([true, true, true], 'x')]);
    const result = await gradeApply(QUESTION, '', router);
    expect(result).toEqual({ pass: false, feedback: '沒有作答', grader: 'empty' });
    expect(calls).toEqual([]);
  });

  it('treats a whitespace-only answer as empty, without touching the model', async () => {
    const { router, calls } = sequentialRouter([verdictResult([true, true, true], 'x')]);
    const result = await gradeApply(QUESTION, '   \n\t ', router);
    expect(result.grader).toBe('empty');
    expect(result.pass).toBe(false);
    expect(calls).toEqual([]);
  });

  it('sends the grade.apply task with a prompt built from the question, rubric and answer', async () => {
    const { router, calls } = sequentialRouter([verdictResult([true, true, true], '三個要點都有講到。')]);
    await gradeApply(QUESTION, '這是跨來源請求,後端要加 CORS header', router);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe('grade.apply');
    expect(calls[0]!.prompt).toBe(buildApplyPrompt(QUESTION, '這是跨來源請求,後端要加 CORS header'));
  });

  it('passes when every rubric criterion is met, and records the grader as cloud', async () => {
    const { router } = sequentialRouter([verdictResult([true, true, true], '三個要點都有講到。', false)]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(result.pass).toBe(true);
    expect(result.criteria).toEqual([true, true, true]);
    expect(result.grader).toBe('cloud');
  });

  it('fails when any rubric criterion is unmet', async () => {
    const { router } = sequentialRouter([verdictResult([false, false, true], '沒有指出跨來源問題,也沒提到解法。')]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(result.pass).toBe(false);
    expect(result.criteria).toEqual([false, false, true]);
  });

  it('records the grader as local-provisional when the router marks the result provisional', async () => {
    const { router } = sequentialRouter([verdictResult([true, true, true], 'x', true)]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(result.grader).toBe('local-provisional');
  });

  it('forwards opts.timeoutMs to the router call', async () => {
    const { router, calls } = sequentialRouter([verdictResult([true, true, true], 'x')]);
    await gradeApply(QUESTION, 'answer', router, { timeoutMs: 12_345 });
    expect(calls[0]!.timeoutMs).toBe(12_345);
  });

  it('retries once with the same prompt when the first response is not JSON, and uses the second', async () => {
    const { router, calls } = sequentialRouter([
      textResult('我覺得這個答案還不錯,大概有講到重點吧。'),
      verdictResult([true, false, true], '第二點沒提到。'),
    ]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.prompt).toBe(calls[1]!.prompt);
    expect(result.criteria).toEqual([true, false, true]);
    expect(result.feedback).toBe('第二點沒提到。');
    expect(result.grader).not.toBe('error');
  });

  it('logs exactly one retry event when the first response is invalid and the second succeeds', async () => {
    const { logAppender, events } = collectingLog();
    const { router } = sequentialRouter([
      textResult('不是 JSON'),
      verdictResult([true, true, true], 'ok'),
    ]);
    await gradeApply(QUESTION, 'answer', router, { logAppender });
    const retryEvents = events.filter((e) => e.type === 'warning' && e['task'] === 'grade.apply' && e['reason'] === 'invalid_response_retry');
    expect(retryEvents).toHaveLength(1);
  });

  it('retries once when the verdict count does not match the rubric length, and uses the valid retry', async () => {
    const { router, calls } = sequentialRouter([
      verdictResult([true, false], '只有兩個 verdict。'),
      verdictResult([true, true, true], '三個都對。'),
    ]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(calls).toHaveLength(2);
    expect(result.criteria).toEqual([true, true, true]);
  });

  it('leaves the card untouched (grader error, pass null) when both attempts are unparseable', async () => {
    const { router, calls } = sequentialRouter([textResult('第一次也不是 JSON'), textResult('第二次還是不是 JSON')]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(calls).toHaveLength(2);
    expect(result.pass).toBeNull();
    expect(result.grader).toBe('error');
    expect(result.criteria).toBeUndefined();
    expect(result.feedback).toBe('模型回應無法解析,略過本次審核');
  });

  it('logs exactly one retry event, not two, when both attempts are unparseable', async () => {
    const { logAppender, events } = collectingLog();
    const { router } = sequentialRouter([textResult('第一次也不是 JSON'), textResult('第二次還是不是 JSON')]);
    await gradeApply(QUESTION, 'answer', router, { logAppender });
    const retryEvents = events.filter((e) => e.type === 'warning' && e['task'] === 'grade.apply' && e['reason'] === 'invalid_response_retry');
    expect(retryEvents).toHaveLength(1);
  });

  it('writes the retry warning to logPath (file) when given a path instead of an appender', async () => {
    const logPath = tmpLogPath();
    const { router } = sequentialRouter([
      textResult('不是 JSON'),
      verdictResult([true, true, true], 'ok'),
    ]);
    await gradeApply(QUESTION, 'answer', router, { logPath });
    const events = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as LogEvent);
    const retryEvents = events.filter((e) => e.type === 'warning' && e['task'] === 'grade.apply' && e['reason'] === 'invalid_response_retry');
    expect(retryEvents).toHaveLength(1);
  });

  it('leaves the card untouched when both attempts have a verdict count mismatch', async () => {
    const { router, calls } = sequentialRouter([
      verdictResult([true], '只有一個。'),
      verdictResult([true, false], '還是不夠。'),
    ]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(calls).toHaveLength(2);
    expect(result.pass).toBeNull();
    expect(result.grader).toBe('error');
  });

  it('truncates feedback over the contract limit and logs the truncation', async () => {
    const { logAppender, events } = collectingLog();
    const long = '這段回饋文字刻意寫得很長用來測試契約字數上限的截斷邏輯是否真的會生效並且記錄一筆警告事件到記錄檔裡'.repeat(2);
    const { router } = sequentialRouter([verdictResult([true, true, true], long)]);
    const result = await gradeApply(QUESTION, 'answer', router, { logAppender });
    expect(countWords(result.feedback)).toBeLessThanOrEqual(APPLY_FEEDBACK_WORD_LIMIT);
    const truncationEvents = events.filter((e) => e.type === 'warning' && e['task'] === 'grade.apply' && e['reason'] === 'feedback_truncated');
    expect(truncationEvents).toHaveLength(1);
  });

  it('does not truncate or log when feedback is already within the contract limit', async () => {
    const { logAppender, events } = collectingLog();
    const { router } = sequentialRouter([verdictResult([true, true, true], '三個要點都有講到。')]);
    const result = await gradeApply(QUESTION, 'answer', router, { logAppender });
    expect(result.feedback).toBe('三個要點都有講到。');
    expect(events.filter((e) => e['reason'] === 'feedback_truncated')).toEqual([]);
  });

  it('returns a result containing pass, criteria, feedback and grader for a passing answer', async () => {
    const { router } = sequentialRouter([verdictResult([true, true, true], 'ok')]);
    const result = await gradeApply(QUESTION, 'answer', router);
    expect(Object.keys(result).sort()).toEqual(['criteria', 'feedback', 'grader', 'pass'].sort());
  });

  it('does not throw or write a log when no logPath/logAppender is given', async () => {
    const { router } = sequentialRouter([textResult('壞掉'), textResult('還是壞掉')]);
    await expect(gradeApply(QUESTION, 'answer', router)).resolves.toMatchObject({ grader: 'error' });
  });
});
