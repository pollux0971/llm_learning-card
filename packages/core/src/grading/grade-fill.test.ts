import { describe, expect, it } from 'vitest';
import { gradeFillBlank, gradeFillQuestion } from './grade-fill.js';
import type { FillQuestion, LlmResult, LlmRouter } from './types.js';

function trackingRouter(response: LlmResult | Error): { router: LlmRouter; calls: { task: string; prompt: string }[] } {
  const calls: { task: string; prompt: string }[] = [];
  const router: LlmRouter = {
    async call(task, prompt) {
      calls.push({ task, prompt });
      if (response instanceof Error) throw response;
      return response;
    },
    async probeOnline() {
      return false;
    },
    async probeLocal() {
      return { available: true, models: ['fake'] };
    },
  };
  return { router, calls };
}

const YES: LlmResult = { text: 'yes', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
const NO: LlmResult = { text: 'no', provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };

describe('gradeFillBlank', () => {
  it('passes an empty answer as grader empty, without touching the model', async () => {
    const { router, calls } = trackingRouter(YES);
    const result = await gradeFillBlank(['protocol'], '', router);
    expect(result).toEqual({ pass: false, feedback: '沒有作答', grader: 'empty' });
    expect(calls).toEqual([]);
  });

  it('treats whitespace-only input as empty', async () => {
    const { router } = trackingRouter(YES);
    const result = await gradeFillBlank(['protocol'], '   ', router);
    expect(result.grader).toBe('empty');
    expect(result.pass).toBe(false);
  });

  it('passes an exact match without touching the model', async () => {
    const { router, calls } = trackingRouter(YES);
    const result = await gradeFillBlank(['協定', 'protocol', 'scheme'], 'PROTOCOL', router);
    expect(result).toEqual({ pass: true, feedback: '正確', grader: 'exact' });
    expect(calls).toEqual([]);
  });

  it('passes a fuzzy match without touching the model', async () => {
    const { router, calls } = trackingRouter(YES);
    const result = await gradeFillBlank(['protocol'], 'protocl', router);
    expect(result).toEqual({ pass: true, feedback: '正確(容許一字之差)', grader: 'fuzzy' });
    expect(calls).toEqual([]);
  });

  it('reaches the model when neither exact nor fuzzy match, and the prompt names both answers', async () => {
    const { router, calls } = trackingRouter(YES);
    const result = await gradeFillBlank(['協定'], '通訊協定', router);
    expect(result).toEqual({ pass: true, feedback: '模型判定語意相同', grader: 'local-llm' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe('grade.fill.llm');
    expect(calls[0]!.prompt).toContain('協定');
    expect(calls[0]!.prompt).toContain('通訊協定');
  });

  it('builds the model prompt with labelled sections and every accepted synonym', async () => {
    const { router, calls } = trackingRouter(YES);
    await gradeFillBlank(['協定', 'scheme'], '通訊協定', router);
    expect(calls[0]!.prompt).toBe('標準答案:協定、scheme\n使用者回答:通訊協定\n這兩者是否語意相同?只回答 yes 或 no。');
  });

  it('trims the model response before comparing it to yes', async () => {
    const { router } = trackingRouter({ ...YES, text: 'yes\n' });
    const result = await gradeFillBlank(['協定'], '通訊協定', router);
    expect(result.pass).toBe(true);
  });

  it('fails when the model says the meanings differ', async () => {
    const { router } = trackingRouter(NO);
    const result = await gradeFillBlank(['協定'], '完全不同的答案', router);
    expect(result).toEqual({ pass: false, feedback: '模型判定語意不同', grader: 'local-llm' });
  });

  it('reaches the model for a short accepted answer that fuzzy would skip', async () => {
    const { router, calls } = trackingRouter(YES);
    await gradeFillBlank(['埠號'], '埠', router);
    expect(calls).toHaveLength(1);
  });

  it('falls back to strict failure when no model is available', async () => {
    const { router } = trackingRouter(new Error('NO_MODEL'));
    const result = await gradeFillBlank(['protocol'], 'something else entirely', router);
    expect(result.pass).toBe(false);
    expect(result.grader).toBe('fallback-strict');
    expect(result.feedback).toContain('沒有');
    expect(result.feedback).toContain('模型');
  });
});

describe('gradeFillQuestion', () => {
  const question: FillQuestion = {
    prompt: '同源的判定條件是 ___、___、___ 三者相同。',
    answers: [
      ['協定', 'protocol', 'scheme'],
      ['主機', 'host', 'domain'],
      ['埠號', 'port'],
    ],
  };

  it('passes when every blank is correct', async () => {
    const { router } = trackingRouter(YES);
    const result = await gradeFillQuestion(question, ['協定', 'host', 'port'], router);
    expect(result.pass).toBe(true);
    expect(result.feedback).toBe('全部正確');
  });

  it('fails the whole question when only the third blank is wrong, naming it and its answer', async () => {
    const { router } = trackingRouter(new Error('NO_MODEL'));
    const result = await gradeFillQuestion(question, ['協定', 'host', 'nope'], router);
    expect(result.pass).toBe(false);
    expect(result.feedback).toBe('第3格答案應為:埠號/port');
  });

  it('lists only the first two accepted synonyms when a blank has three or more', async () => {
    const wideQuestion: FillQuestion = { prompt: '___', answers: [['協定', 'protocol', 'scheme']] };
    const { router } = trackingRouter(new Error('NO_MODEL'));
    const result = await gradeFillQuestion(wideQuestion, ['nope'], router);
    expect(result.feedback).toBe('第1格答案應為:協定/protocol');
    expect(result.feedback).not.toContain('scheme');
  });

  it('reports the deepest layer used when every blank passes through a different layer', async () => {
    const twoBlanks: FillQuestion = { prompt: '___ ___', answers: [['protocol'], ['protocol']] };
    const { router } = trackingRouter(YES);
    const exactThenFuzzy = await gradeFillQuestion(twoBlanks, ['protocol', 'protocl'], router);
    expect(exactThenFuzzy.pass).toBe(true);
    expect(exactThenFuzzy.grader).toBe('fuzzy');
    const fuzzyThenExact = await gradeFillQuestion(twoBlanks, ['protocl', 'protocol'], router);
    expect(fuzzyThenExact.grader).toBe('fuzzy');
  });

  it('reports the first wrong blank even if a later one is also wrong', async () => {
    const { router } = trackingRouter(new Error('NO_MODEL'));
    const result = await gradeFillQuestion(question, ['nope', 'host', 'nope'], router);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('1');
  });

  it('grades missing trailing answers as empty rather than throwing', async () => {
    const { router } = trackingRouter(YES);
    const result = await gradeFillQuestion(question, ['協定', 'host'], router);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('3');
  });
});
