/**
 * 對照 phase-1.feature 裡跟「答一題」有關的場景:
 *   - A fill question is answered on one line
 *   - An apply question is answered across several lines
 *   - A passing answer advances the schedule immediately
 *   - A failing answer returns the card immediately
 *   - A card at stage two is only resolved after both questions
 *   - A grading error leaves the card alone and keeps going
 *   - Answers land one at a time
 *
 * submitAnswer 的前置條件是 session.current 已經由 presentNextCard 設定好——
 * 這裡直接手動組出 session.current,跳過 present.ts,單獨測 answer.ts 的
 * 控制流程(checkpoint 何時解決、何時落地)。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardId, Review } from '@contracts/index.js';
import type { LlmResult, LlmRouter, LlmTask } from '@core/grading/index.js';
import { joinApplyLines, splitFillAnswer, submitAnswer } from './answer.js';
import type { CurrentQuestion, Session } from './types.js';

const TODAY = '2026-09-10';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeLearningDir(reviews: Record<CardId, Review>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-session-answer-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'state/reviews.json'), `${JSON.stringify(reviews, null, 2)}\n`);
  return dir;
}

function readReviews(dir: string): Record<CardId, Review> {
  return JSON.parse(readFileSync(join(dir, 'state/reviews.json'), 'utf8')) as Record<CardId, Review>;
}

/** 依序回應多次呼叫;超過陣列長度就重複最後一筆。仿 grade-apply.test.ts 的 sequentialRouter。 */
function sequentialRouter(responses: LlmResult[]): LlmRouter {
  let i = 0;
  return {
    async call(_task: LlmTask, _prompt: string): Promise<LlmResult> {
      const next = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      return next;
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function textResult(text: string): LlmResult {
  return { text, provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
}

function noopRouter(): LlmRouter {
  return sequentialRouter([textResult('yes')]);
}

function makeSession(dir: string, overrides: Partial<Session> = {}): Session {
  return {
    learningDir: dir,
    today: TODAY,
    dailyCap: 10,
    router: noopRouter(),
    queue: [],
    reteachQueue: [],
    totalDue: 0,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    ...overrides,
  };
}

function stage1FillCurrent(card: CardId): CurrentQuestion {
  return {
    card,
    stage: 1,
    overdueDays: 0,
    overdueRatio: 0,
    stuck: false,
    types: ['fill'],
    typeIndex: 0,
    fillQuestion: {
      prompt: '同源的判定條件是 ___、___、___ 三者相同。',
      answers: [['協定'], ['主機'], ['埠號']],
    },
    pendingAnswers: [],
    hadError: false,
  };
}

function stage3ApplyCurrent(card: CardId): CurrentQuestion {
  return {
    card,
    stage: 3,
    overdueDays: 0,
    overdueRatio: 0,
    stuck: false,
    types: ['apply'],
    typeIndex: 0,
    applyQuestion: {
      prompt: '跨來源請求會遇到什麼問題?',
      rubric: ['有指出這是跨來源請求', '有提出至少一個解法'],
    },
    pendingAnswers: [],
    hadError: false,
  };
}

function stage2Current(card: CardId): CurrentQuestion {
  return {
    card,
    stage: 2,
    overdueDays: 0,
    overdueRatio: 0,
    stuck: false,
    types: ['fill', 'apply'],
    typeIndex: 0,
    fillQuestion: { prompt: '答案是 ___。', answers: [['對']] },
    applyQuestion: { prompt: '解釋一下。', rubric: ['有講到重點', '沒有事實錯誤'] },
    pendingAnswers: [],
    hadError: false,
  };
}

// ---------------------------------------------------------------- splitFillAnswer / joinApplyLines

describe('splitFillAnswer', () => {
  it('splits a comma-separated single line into trimmed answers', () => {
    expect(splitFillAnswer('協定, 主機, 埠號')).toEqual(['協定', '主機', '埠號']);
  });

  it('tolerates missing spaces after commas', () => {
    expect(splitFillAnswer('a,b,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('joinApplyLines', () => {
  it('joins collected lines with newlines as a single answer', () => {
    expect(joinApplyLines(['第一行', '第二行'])).toBe('第一行\n第二行');
  });

  it('trims a trailing blank line left over from ending input', () => {
    expect(joinApplyLines(['一段回答', ''])).toBe('一段回答');
  });
});

// ---------------------------------------------------------------- submitAnswer: fill / pass / fail

describe('submitAnswer — fill question, single-type checkpoint (stage 1)', () => {
  it('grades each blank and advances stage on disk before returning', async () => {
    const card = 'sec-0001';
    const review: Review = { stage: 1, learned_at: '2026-09-09', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] };
    const dir = makeLearningDir({ [card]: review });
    const session = makeSession(dir, {
      queue: [{ card, stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: stage1FillCurrent(card),
    });

    const outcome = await submitAnswer(session, '協定, 主機, 埠號');

    expect(outcome.status).toBe('passed');
    expect(outcome.cardDone).toBe(true);
    expect(outcome.newStage).toBe(2);

    // 「the change is written before the next question is shown」——回傳時磁碟已經是新狀態
    const onDisk = readReviews(dir)[card]!;
    expect(onDisk.stage).toBe(2);
    expect(session.queue).toHaveLength(0);
    expect(session.passed).toBe(1);
    expect(session.current).toBeUndefined();
  });
});

describe('submitAnswer — apply question, single-type checkpoint (stage 3)', () => {
  it('regresses to stage 1 with tomorrow’s due date on an incorrect answer', async () => {
    const card = 'sec-0003';
    const review: Review = { stage: 3, learned_at: '2026-08-01', next_due: '2026-09-10', fails_in_row: 0, total_fails: 1, stuck: false, history: [] };
    const dir = makeLearningDir({ [card]: review });
    const session = makeSession(dir, {
      router: sequentialRouter([textResult(JSON.stringify({ criteria: [false, false], feedback: '沒有講到重點' }))]),
      queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: stage3ApplyCurrent(card),
    });

    const outcome = await submitAnswer(session, '我不知道');

    expect(outcome.status).toBe('failed');
    expect(outcome.cardDone).toBe(true);
    expect(outcome.newStage).toBe(1);

    const onDisk = readReviews(dir)[card]!;
    expect(onDisk.stage).toBe(1);
    expect(onDisk.next_due).toBe('2026-09-11');
  });
});

describe('submitAnswer — stage 2 checkpoint spans two questions', () => {
  it('writes no transition after the fill question, then one failure after the apply question', async () => {
    const card = 'sec-0002';
    const review: Review = {
      stage: 2,
      learned_at: '2026-09-01',
      next_due: '2026-09-10',
      fails_in_row: 0,
      total_fails: 0,
      stuck: false,
      history: [],
    };
    const dir = makeLearningDir({ [card]: review });
    const before = readFileSync(join(dir, 'state/reviews.json'), 'utf8');
    const current = stage2Current(card);
    const session = makeSession(dir, {
      router: sequentialRouter([textResult(JSON.stringify({ criteria: [false, true], feedback: '沒講到重點' }))]),
      queue: [{ card, stage: 2, types: ['fill', 'apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current,
    });

    // Given ... the fill question is answered correctly / Then no transition has been written yet
    const fillOutcome = await submitAnswer(session, '對');
    expect(fillOutcome.status).toBe('partial');
    expect(fillOutcome.cardDone).toBe(false);
    expect(readFileSync(join(dir, 'state/reviews.json'), 'utf8')).toBe(before);
    expect(session.queue).toHaveLength(1);
    expect(session.current).toBeDefined();

    // When the apply question is answered incorrectly / Then one failure is written
    const applyOutcome = await submitAnswer(session, '不知道');
    expect(applyOutcome.status).toBe('failed');
    expect(applyOutcome.cardDone).toBe(true);
    expect(applyOutcome.newStage).toBe(1);

    const onDisk = readReviews(dir)[card]!;
    expect(onDisk.stage).toBe(1);
    expect(onDisk.fails_in_row).toBe(1);
    // And the history contains both answers
    expect(onDisk.history).toHaveLength(2);
    expect(onDisk.history.map((h) => h.type).sort()).toEqual(['apply', 'fill']);
    expect(onDisk.history.every((h) => h.date === TODAY)).toBe(true);
    expect(session.queue).toHaveLength(0);
    expect(session.current).toBeUndefined();
  });
});

describe('submitAnswer — grading error', () => {
  it('leaves the card alone on disk and reports the error, but moves the session on', async () => {
    const card = 'sec-0009';
    const review: Review = { stage: 3, learned_at: '2026-08-01', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] };
    const dir = makeLearningDir({ [card]: review });
    const before = readFileSync(join(dir, 'state/reviews.json'), 'utf8');
    const session = makeSession(dir, {
      // 兩次都回傳無法解析成 JSON 的文字 → gradeApply 的 grader 'error'(pass: null)
      router: sequentialRouter([textResult('嗯我想一下。'), textResult('還是講不出結構化的答案。')]),
      queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: stage3ApplyCurrent(card),
    });

    const outcome = await submitAnswer(session, '一些回答');

    expect(outcome.status).toBe('error');
    expect(outcome.pass).toBeNull();
    expect(outcome.cardDone).toBe(true);
    expect(readFileSync(join(dir, 'state/reviews.json'), 'utf8')).toBe(before);
    expect(session.errors).toBe(1);
    expect(session.queue).toHaveLength(0);
    expect(session.passed).toBe(0);
    expect(session.failed).toBe(0);
  });
});

describe('submitAnswer — answers land one at a time', () => {
  it('leaves exactly the answered cards changed on disk when the rest are never submitted', async () => {
    const cards = ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0004', 'sec-0005'];
    const reviews: Record<CardId, Review> = {};
    for (const card of cards) {
      reviews[card] = { stage: 1, learned_at: '2026-09-09', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false, history: [] };
    }
    const dir = makeLearningDir(reviews);
    const session = makeSession(dir, {
      queue: cards.map((card) => ({ card, stage: 1 as const, types: ['fill' as const], overdue_days: 0, overdue_ratio: 0, stuck: false })),
      totalDue: 5,
    });

    // 只答前兩張,模擬「process 被殺掉」——之後不再呼叫 submitAnswer
    session.current = stage1FillCurrent('sec-0001');
    await submitAnswer(session, '協定, 主機, 埠號');
    session.current = stage1FillCurrent('sec-0002');
    await submitAnswer(session, '協定, 主機, 埠號');

    const onDisk = readReviews(dir);
    expect(onDisk['sec-0001']!.stage).toBe(2);
    expect(onDisk['sec-0002']!.stage).toBe(2);
    for (const untouched of ['sec-0003', 'sec-0004', 'sec-0005']) {
      expect(onDisk[untouched]).toEqual(reviews[untouched]);
    }
    expect(session.queue.map((d) => d.card)).toEqual(['sec-0003', 'sec-0004', 'sec-0005']);
  });
});
