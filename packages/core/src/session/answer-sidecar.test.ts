/**
 * T22 驗收 2:`submitAnswer` 給側車的兩個小改(`packages/core/src/session/answer.ts`)。
 * 紅測試作者寫;開發 worker 不改。既有的 `answer.test.ts` 不改、全綠(沒給 opts 的 CLI 行為跟現在一模一樣)。
 *
 *   submitAnswer(session, answer: string | string[], opts?: { keepOnError?: boolean })
 *   - answer 是陣列(只用於填空)→ 每個空格的答案,**不再用逗號切**;應用題收到陣列 → 丟錯
 *   - keepOnError 且這一題批改 pass === null → 不設 hadError、不前進 typeIndex、不 shift queue、不寫 reviews.json、
 *     session.errors 不加;回 { status: 'error', pass: null, feedback, cardDone: false };下一次 presentNextCard 回同一題
 *
 * 簽名還沒改,所以呼叫用型別轉換(tsc 乾淨;紅是因為行為還沒有)。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CardId, Review } from '@contracts/index.js';
import type { LlmResult, LlmRouter, LlmTask } from '@core/grading/index.js';
import { submitAnswer } from './answer.js';
import { presentNextCard } from './present.js';
import type { AnswerOutcome, CurrentQuestion, Session } from './types.js';

type Submit = (session: Session, answer: string | string[], opts?: { keepOnError?: boolean }) => Promise<AnswerOutcome>;
const submit = submitAnswer as unknown as Submit;

const TODAY = '2026-09-10';
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeLearningDir(reviews: Record<CardId, Review>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-t22-answer-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'state/reviews.json'), `${JSON.stringify(reviews, null, 2)}\n`);
  return dir;
}
const reviewsText = (dir: string): string => readFileSync(join(dir, 'state/reviews.json'), 'utf8');
const reviewsOf = (dir: string): Record<CardId, Review> => JSON.parse(reviewsText(dir)) as Record<CardId, Review>;

function textResult(text: string): LlmResult {
  return { text, provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
}
/** 依序回應;超過就重複最後一筆。記下被呼叫的次數。 */
function sequentialRouter(responses: LlmResult[]): LlmRouter & { calls: number } {
  const router = {
    calls: 0,
    async call(_task: LlmTask, _prompt: string): Promise<LlmResult> {
      const next = responses[Math.min(router.calls, responses.length - 1)]!;
      router.calls += 1;
      return next;
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return router;
}
const garbageRouter = (): LlmRouter & { calls: number } => sequentialRouter([textResult('嗯我想一下。'), textResult('還是講不出結構化的答案。')]);
const passingApplyRouter = (): LlmRouter & { calls: number } => sequentialRouter([textResult(JSON.stringify({ criteria: [true, true], feedback: '每一條都達成。' }))]);

function review(stage: number, over: Partial<Review> = {}): Review {
  return { stage, learned_at: '2026-08-01', next_due: TODAY, fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...over } as Review;
}

function makeSession(dir: string, over: Partial<Session> = {}): Session {
  return { learningDir: dir, today: TODAY, dailyCap: 10, router: passingApplyRouter(), queue: [], reteachQueue: [], totalDue: 0, deferred: 0, passed: 0, failed: 0, errors: 0, ...over };
}

function applyCurrent(card: CardId, stage: 3 | 2 = 3): CurrentQuestion {
  return {
    card,
    stage,
    overdueDays: 0,
    overdueRatio: 0,
    stuck: false,
    types: stage === 3 ? ['apply'] : ['fill', 'apply'],
    typeIndex: 0,
    fillQuestion: { prompt: '答案是 ___。', answers: [['對']] },
    applyQuestion: { prompt: '跨來源請求會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提出至少一個解法'] },
    pendingAnswers: [],
    hadError: false,
  };
}

describe('陣列送出:填空題的答案不再用逗號切(驗收 2)', () => {
  function fillSession(answers: string[][]): { dir: string; session: Session } {
    const card = 'sec-0001';
    const dir = makeLearningDir({ [card]: review(1) });
    const session = makeSession(dir, {
      queue: [{ card, stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: {
        card, stage: 1, overdueDays: 0, overdueRatio: 0, stuck: false, types: ['fill'], typeIndex: 0,
        fillQuestion: { prompt: '第一格 ___、第二格 ___。', answers },
        pendingAnswers: [], hadError: false,
      },
    });
    return { dir, session };
  }

  it('每個空格一個陣列項目:答案本身含逗號時原樣比對,算通過', async () => {
    const { dir, session } = fillSession([['a,b'], ['z']]);
    const outcome = await submit(session, ['a,b', 'z']);
    expect(outcome.status).toBe('passed');
    expect(reviewsOf(dir)['sec-0001']!.stage).toBe(2);
  });

  it('同樣的答案用字串送(逗號會切)照舊:切成三段,跟兩個空格對不起來 → 不通過', async () => {
    const { session } = fillSession([['a,b'], ['z']]);
    const outcome = await submit(session, 'a,b,z');
    expect(outcome.status).toBe('failed');
  });

  it('陣列項目數要跟空格數一致:少一個項目不通過', async () => {
    const { session } = fillSession([['a'], ['z']]);
    const outcome = await submit(session, ['a']);
    expect(outcome.status).toBe('failed');
  });

  it('陣列的順序就是空格的順序', async () => {
    const { session } = fillSession([['左'], ['右']]);
    expect((await submit(session, ['右', '左'])).status).toBe('failed');
  });

  it('應用題收到陣列 → 丟錯(呼叫端寫錯),而且沒有動到磁碟與 session', async () => {
    const card = 'sec-0003';
    const dir = makeLearningDir({ [card]: review(3) });
    const before = reviewsText(dir);
    const router = passingApplyRouter();
    const session = makeSession(dir, { router, queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }], totalDue: 1, current: applyCurrent(card) });
    await expect(submit(session, ['一段', '回答'])).rejects.toThrow();
    expect(router.calls, '丟錯之前不該已經叫了審核').toBe(0);
    expect(reviewsText(dir)).toBe(before);
    expect(session.queue).toHaveLength(1);
    expect(session.errors).toBe(0);
  });
});

describe('keepOnError:批改失敗時題目留在原地(驗收 2)', () => {
  it('單題型(stage 3 應用題)批改失敗:回 error、cardDone false,什麼都沒動,下一次 present 回同一題', async () => {
    const card = 'sec-0003';
    const dir = makeLearningDir({ [card]: review(3) });
    const before = reviewsText(dir);
    const session = makeSession(dir, {
      router: garbageRouter(),
      queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: applyCurrent(card),
    });

    const outcome = await submit(session, '一些回答', { keepOnError: true });

    expect(outcome.status).toBe('error');
    expect(outcome.pass).toBeNull();
    expect(outcome.cardDone).toBe(false);
    expect(outcome.feedback.length).toBeGreaterThan(0);
    expect(reviewsText(dir), 'reviews.json 逐位元不變').toBe(before);
    expect(session.errors, 'errors 不加').toBe(0);
    expect(session.queue, 'queue 不 shift').toHaveLength(1);
    expect(session.passed + session.failed).toBe(0);
    expect(session.current, 'current 還在').toBeDefined();
    expect(session.current!.typeIndex, 'typeIndex 不前進').toBe(0);
    expect(session.current!.hadError, 'hadError 不設').toBe(false);
    expect(session.current!.pendingAnswers).toEqual([]);

    const again = await presentNextCard(session);
    expect(again.kind).toBe('question');
    if (again.kind === 'question') {
      expect(again.card).toBe(card);
      expect(again.type).toBe('apply');
      expect(again.progress).toEqual({ index: 1, total: 1 });
    }
  });

  it('再送一次(這次批改成功)就正常通過、落地一次、queue 前進', async () => {
    const card = 'sec-0003';
    const dir = makeLearningDir({ [card]: review(3) });
    const session = makeSession(dir, {
      router: garbageRouter(),
      queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: applyCurrent(card),
    });
    expect((await submit(session, '第一次', { keepOnError: true })).status).toBe('error');
    session.router = passingApplyRouter();
    const second = await submit(session, '第二次', { keepOnError: true });
    expect(second.status).toBe('passed');
    expect(second.cardDone).toBe(true);
    expect(reviewsOf(dir)[card]!.stage).toBe(4);
    expect(session.queue).toHaveLength(0);
    expect(session.passed).toBe(1);
    expect(session.errors, '失敗過一次也不算進 errors').toBe(0);
  });

  it('連續失敗兩次也一樣:每次都是 error / cardDone false,磁碟始終沒動', async () => {
    const card = 'sec-0003';
    const dir = makeLearningDir({ [card]: review(3) });
    const before = reviewsText(dir);
    const session = makeSession(dir, {
      router: garbageRouter(),
      queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: applyCurrent(card),
    });
    for (let i = 0; i < 3; i += 1) {
      const outcome = await submit(session, `第 ${i} 次`, { keepOnError: true });
      expect(outcome.status).toBe('error');
      expect(outcome.cardDone).toBe(false);
    }
    expect(reviewsText(dir)).toBe(before);
    expect(session.errors).toBe(0);
  });

  it('兩題型的卡(stage 2:填空再應用):應用題失敗 → typeIndex 停在應用題、填空的答案還在,重送成功後兩題一起落地', async () => {
    const card = 'sec-0002';
    const dir = makeLearningDir({ [card]: review(2) });
    const session = makeSession(dir, {
      router: garbageRouter(),
      queue: [{ card, stage: 2, types: ['fill', 'apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: applyCurrent(card, 2),
    });

    const first = await submit(session, ['對'], { keepOnError: true });
    expect(first.status).toBe('partial');
    expect(first.cardDone).toBe(false);
    expect(session.current!.typeIndex).toBe(1);

    const before = reviewsText(dir);
    const failed = await submit(session, '一些回答', { keepOnError: true });
    expect(failed.status).toBe('error');
    expect(failed.cardDone).toBe(false);
    expect(session.current!.typeIndex, '停在應用題,不前進').toBe(1);
    expect(session.current!.hadError).toBe(false);
    expect(session.current!.pendingAnswers, '填空題已經過的答案不丟').toHaveLength(1);
    expect(reviewsText(dir)).toBe(before);
    expect(session.queue).toHaveLength(1);

    session.router = passingApplyRouter();
    const done = await submit(session, '好的回答', { keepOnError: true });
    expect(done.status).toBe('passed');
    expect(done.cardDone).toBe(true);
    expect(reviewsOf(dir)[card]!.history, '兩題的結果一起進 history').toHaveLength(2);
    expect(reviewsOf(dir)[card]!.stage).toBe(3);
  });

  it('keepOnError 開著、批改成功:行為跟沒開一樣(通過寫入一次)', async () => {
    const card = 'sec-0003';
    const dir = makeLearningDir({ [card]: review(3) });
    const session = makeSession(dir, {
      queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
      current: applyCurrent(card),
    });
    const outcome = await submit(session, '好的回答', { keepOnError: true });
    expect(outcome).toMatchObject({ status: 'passed', pass: true, cardDone: true, newStage: 4 });
    expect(reviewsOf(dir)[card]!.stage).toBe(4);
  });

  it('沒給 opts、或 keepOnError:false(CLI):批改失敗那張卡今天跳過,跟現在一模一樣', async () => {
    for (const opts of [undefined, {}, { keepOnError: false }]) {
      const card = 'sec-0003';
      const dir = makeLearningDir({ [card]: review(3) });
      const before = reviewsText(dir);
      const session = makeSession(dir, {
        router: garbageRouter(),
        queue: [{ card, stage: 3, types: ['apply'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
        totalDue: 1,
        current: applyCurrent(card),
      });
      const outcome = await submit(session, '一些回答', opts);
      expect(outcome.status, JSON.stringify(opts)).toBe('error');
      expect(outcome.cardDone, JSON.stringify(opts)).toBe(true);
      expect(session.errors, JSON.stringify(opts)).toBe(1);
      expect(session.queue, JSON.stringify(opts)).toHaveLength(0);
      expect(session.current, JSON.stringify(opts)).toBeUndefined();
      expect(reviewsText(dir)).toBe(before);
    }
  });
});
