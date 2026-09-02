import { describe, expect, it } from 'vitest';
import { TestSession, type Grader } from './session.js';
import { advance } from './stubs/scheduler.js';
import type { DueItem, GradeResult, QuestionFile, SchedulerAdvanceFn } from './types.js';

const questions: Record<string, QuestionFile> = {
  'sec-0001': {
    card: 'sec-0001',
    fill: [{ prompt: '空格 ___', answers: [['a', 'b']] }],
    apply: [{ prompt: '應用題', rubric: ['有講重點'] }],
  },
  'sec-0002': {
    card: 'sec-0002',
    fill: [{ prompt: '空格2 ___', answers: [['x']] }],
    apply: [{ prompt: '應用題2', rubric: ['有講重點'] }],
  },
};

const dueFill: DueItem = { card: 'sec-0001', stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false };
const dueBoth: DueItem = { card: 'sec-0002', stage: 2, types: ['fill', 'apply'], overdue_days: 1, overdue_ratio: 0.1, stuck: false };

function fakeGrader(result: Partial<GradeResult> = {}): Grader {
  const base: GradeResult = { pass: true, feedback: 'ok', grader: 'exact', ...result };
  return {
    async gradeFill() {
      return base;
    },
    async gradeApply() {
      return base;
    },
  };
}

describe('TestSession', () => {
  it('decides submit for a fill question and newline for an apply question', () => {
    const session = new TestSession({ due: [dueFill], questions, grader: fakeGrader(), advance, today: '2026-09-10' });
    expect(session.decideKeydown('Enter')).toBe('submit');

    const applySession = new TestSession({ due: [dueBoth], questions, grader: fakeGrader(), advance, today: '2026-09-10' });
    applySession.next(); // 從 fill 換到 apply
    expect(applySession.decideKeydown('Enter')).toBe('newline');
    expect(applySession.decideKeydown('Enter', { ctrl: true })).toBe('submit');
    expect(applySession.decideKeydown('Enter', { meta: true })).toBe('submit');
    expect(applySession.decideKeydown('a')).toBe('ignore');
  });

  it('records the grade result and header progress after submitting', async () => {
    const session = new TestSession({ due: [dueFill], questions, grader: fakeGrader({ pass: true }), advance, today: '2026-09-10' });
    await session.submitFill(['a']);
    expect(session.getView().result?.pass).toBe(true);
    expect(session.getView().answeredCount).toBe(0);
    session.next();
    expect(session.getView().answeredCount).toBe(1);
    expect(session.getView().done).toBe(true);
  });

  it('does not advance until both question types of a stage-2 card are answered', async () => {
    let advanceCalls = 0;
    const spy: SchedulerAdvanceFn = (review, ctx) => {
      advanceCalls += 1;
      return advance(review, ctx);
    };
    const session = new TestSession({ due: [dueBoth], questions, grader: fakeGrader({ pass: true }), advance: spy, today: '2026-09-10' });

    expect(session.getView().current?.type).toBe('fill');
    await session.submitFill(['x']);
    session.next();
    expect(advanceCalls).toBe(0);
    expect(session.getView().current?.type).toBe('apply');

    await session.submitApply('答案');
    session.next();
    expect(advanceCalls).toBe(1);
  });

  it('keeps the question in place and skips the scheduler transition on a grading error', async () => {
    let advanceCalls = 0;
    const spy: SchedulerAdvanceFn = (review, ctx) => {
      advanceCalls += 1;
      return advance(review, ctx);
    };
    const errorGrader: Grader = {
      async gradeFill() {
        return { pass: null, feedback: '掛了', grader: 'error' };
      },
      async gradeApply() {
        return { pass: null, feedback: '掛了', grader: 'error' };
      },
    };
    const session = new TestSession({ due: [dueFill], questions, grader: errorGrader, advance: spy, today: '2026-09-10' });
    await session.submitFill(['a']);
    const view = session.getView();
    expect(view.error).toBeTruthy();
    expect(view.current?.card).toBe('sec-0001');
    expect(advanceCalls).toBe(0);
  });

  it('shows the empty-day view when there is nothing due', () => {
    const session = new TestSession({ due: [], questions: {}, grader: fakeGrader(), advance, today: '2026-09-10' });
    expect(session.getView().isEmpty).toBe(true);
    expect(session.getView().current).toBeUndefined();
  });
});
