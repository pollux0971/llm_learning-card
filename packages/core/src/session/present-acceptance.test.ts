/**
 * T27(驗收補測):presentNextCard 的「題目呈現」分支 —— 原本的 present.test.ts 只量到填空題,
 * Stryker(單檔 present.ts)的存活全在這裡:fill / apply 分支的條件與 type 字樣、stage 2 的第二題走
 * 「session.current 已設定」那條、current 初值(pendingAnswers、hadError)、current 對不上時重新載入。
 * 全部暫存目錄,不碰真的 learning/。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LlmRouter } from '@core/grading/index.js';
import { presentNextCard } from './present.js';
import type { Session } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const router: LlmRouter = {
  async call() {
    throw new Error('不該呼叫 router');
  },
  async probeOnline() {
    return true;
  },
  async probeLocal() {
    return { available: false, models: [] };
  },
};

function vault(): string {
  const d = mkdtempSync(join(tmpdir(), 'lc-t27-'));
  dirs.push(d);
  mkdirSync(join(d, 'questions'), { recursive: true });
  return d;
}

/** 每張卡的填空題是 FILL-<id>(兩個空格),應用題是 APPLY-<id>,從題幹就認得出是哪一張、哪一種。 */
function writeQuestions(dir: string, id: string): void {
  writeFileSync(
    join(dir, 'questions', `${id}.yaml`),
    [
      `card: ${id}`,
      'fill:',
      `  - prompt: "FILL-${id} 第一格 ___ 第二格 ___。"`,
      '    answers:',
      '      - ["甲"]',
      '      - ["乙"]',
      `  - prompt: "FILL2-${id} ___。"`,
      '    answers:',
      '      - ["丙"]',
      'apply:',
      `  - prompt: "APPLY-${id}"`,
      '    rubric:',
      '      - "有講到重點"',
      '      - "沒有事實錯誤"',
      `  - prompt: "APPLY2-${id}"`,
      '    rubric:',
      '      - "有講到重點"',
      '      - "沒有事實錯誤"',
      '',
    ].join('\n'),
  );
}

type Item = Session['queue'][number];
const item = (card: string, stage: Item['stage'], types: Item['types'], over: Partial<Item> = {}): Item => ({
  card,
  stage,
  types,
  overdue_days: 2,
  overdue_ratio: 0.5,
  stuck: false,
  ...over,
});

function session(dir: string, queue: Item[], over: Partial<Session> = {}): Session {
  return { learningDir: dir, today: '2026-09-10', dailyCap: 10, router, queue, reteachQueue: [], totalDue: queue.length, deferred: 0, passed: 0, failed: 0, errors: 0, ...over };
}

describe('pickQuestion 的 fill / apply 分支', () => {
  it('填空題:回傳的鍵與值逐一釘住(type fill、題幹、blanks 是題幹的空格數、stage、progress、stuck)', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0001');
    const s = session(dir, [item('sec-0001', 1, ['fill'])]);
    const result = await presentNextCard(s);
    expect(result).toEqual({
      kind: 'question',
      card: 'sec-0001',
      stage: 1,
      type: 'fill',
      prompt: 'FILL-sec-0001 第一格 ___ 第二格 ___。',
      blanks: 2,
      progress: { index: 1, total: 1 },
      stuck: false,
    });
    expect(Object.keys(result).sort()).toEqual(['blanks', 'card', 'kind', 'progress', 'prompt', 'stage', 'stuck', 'type']);
  });

  it('應用題(stage 3 只有 apply):type apply、取 apply[0] 的題幹、沒有 blanks 這個鍵、stage 是 3', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0003');
    const s = session(dir, [item('sec-0003', 3, ['apply'])]);
    const result = await presentNextCard(s);
    expect(result).toEqual({
      kind: 'question',
      card: 'sec-0003',
      stage: 3,
      type: 'apply',
      prompt: 'APPLY-sec-0003',
      progress: { index: 1, total: 1 },
      stuck: false,
    });
    expect('blanks' in result).toBe(false);
  });

  it('stuck 旗標原樣帶出(填空與應用都是)', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0001');
    writeQuestions(dir, 'sec-0003');
    const fill = await presentNextCard(session(dir, [item('sec-0001', 1, ['fill'], { stuck: true })]));
    expect(fill).toMatchObject({ type: 'fill', stuck: true });
    const apply = await presentNextCard(session(dir, [item('sec-0003', 3, ['apply'], { stuck: true })]));
    expect(apply).toMatchObject({ type: 'apply', stuck: true });
  });

  it('進度的分子是 totalDue − 還在 queue 的張數 + 1:5 題答了 2 題(queue 剩 3)→ 3/5', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0001');
    const queue = [item('sec-0001', 1, ['fill']), item('sec-0001', 1, ['fill']), item('sec-0001', 1, ['fill'])];
    const result = await presentNextCard(session(dir, queue, { totalDue: 5 }));
    expect(result).toMatchObject({ progress: { index: 3, total: 5 } });
  });
});

describe('stage 2:同一張卡的第二題走「session.current 已設定」那條', () => {
  it('第一題 fill;submitAnswer 把 typeIndex 推到 1 之後,同一張卡回 apply 題,不重新載入、progress 與第一題相同、current 還是同一個物件', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0002');
    const s = session(dir, [item('sec-0002', 2, ['fill', 'apply']), item('sec-0001', 1, ['fill'])]);
    const first = await presentNextCard(s);
    expect(first).toMatchObject({ type: 'fill', card: 'sec-0002', stage: 2, progress: { index: 1, total: 2 } });
    const current = s.current!;
    current.typeIndex = 1;
    // 第二題之前把磁碟上的題目檔換掉:要是重新載入,題幹會變
    writeFileSync(join(dir, 'questions', 'sec-0002.yaml'), readQuestionsReplaced());
    const second = await presentNextCard(s);
    expect(second).toEqual({ kind: 'question', card: 'sec-0002', stage: 2, type: 'apply', prompt: 'APPLY-sec-0002', progress: { index: 1, total: 2 }, stuck: false });
    expect(s.current).toBe(current);
    expect(s.queue).toHaveLength(2);
  });

  it('current 的卡跟 queue 第一張對不上(上一張已解決、queue 往前走)→ 重新載入新的那張,current 換掉', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0001');
    writeQuestions(dir, 'sec-0002');
    const s = session(dir, [item('sec-0001', 1, ['fill']), item('sec-0002', 1, ['fill'])]);
    await presentNextCard(s);
    const old = s.current!;
    s.queue.shift(); // 第一張解決了
    const next = await presentNextCard(s);
    expect(next).toMatchObject({ card: 'sec-0002', type: 'fill', prompt: 'FILL-sec-0002 第一格 ___ 第二格 ___。' });
    expect(s.current).not.toBe(old);
    expect(s.current!.card).toBe('sec-0002');
  });

  it('queue 空了、current 還留著 → 回 done(不丟錯)', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0001');
    const s = session(dir, [item('sec-0001', 1, ['fill'])]);
    await presentNextCard(s);
    s.queue.length = 0;
    expect(await presentNextCard(s)).toEqual({ kind: 'done' });
  });
});

describe('第一次呈現時建立的 current', () => {
  it('欄位逐一釘住:卡、stage、overdue、stuck、types、typeIndex 0、fill/apply 取第 0 題、pendingAnswers 空陣列、hadError false', async () => {
    const dir = vault();
    writeQuestions(dir, 'sec-0002');
    const s = session(dir, [item('sec-0002', 2, ['fill', 'apply'], { overdue_days: 4, overdue_ratio: 1.5, stuck: true })]);
    await presentNextCard(s);
    expect(s.current).toEqual({
      card: 'sec-0002',
      stage: 2,
      overdueDays: 4,
      overdueRatio: 1.5,
      stuck: true,
      types: ['fill', 'apply'],
      typeIndex: 0,
      fillQuestion: { prompt: 'FILL-sec-0002 第一格 ___ 第二格 ___。', answers: [['甲'], ['乙']] },
      applyQuestion: { prompt: 'APPLY-sec-0002', rubric: ['有講到重點', '沒有事實錯誤'] },
      pendingAnswers: [],
      hadError: false,
    });
  });
});

function readQuestionsReplaced(): string {
  return ['card: sec-0002', 'fill:', '  - prompt: "已被換掉 ___。"', '    answers:', '      - ["甲"]', '  - prompt: "也被換掉 ___。"', '    answers:', '      - ["乙"]', 'apply:', '  - prompt: "已被換掉的應用題"', '    rubric:', '      - "a"', '      - "b"', ''].join('\n');
}
