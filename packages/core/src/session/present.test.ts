/**
 * 對照 phase-1.feature:
 *   - A session asks each due card in order
 *   - Reteach cards are shown before the questions
 *   - A stuck card is flagged when asked
 *
 * 這裡真的寫卡片與題目檔到暫存目錄,presentNextCard 會從磁碟讀
 * (跟 io.ts 的 loadCardBody / loadQuestionFile 是同一份資料)。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmRouter } from '@core/grading/index.js';
import { presentNextCard } from './present.js';
import type { Session } from './types.js';

const TODAY = '2026-09-10';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function noopRouter(): LlmRouter {
  return {
    async call() {
      throw new Error('presentNextCard 不應該呼叫 router');
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function writeCard(dir: string, id: string, opts: { short?: boolean; body: string } = { body: '' }): void {
  const category = 'security';
  mkdirSync(join(dir, 'cards', category), { recursive: true });
  const suffix = opts.short ? '.short.md' : '.md';
  const frontmatter = opts.short
    ? `---\nid: ${id}\ncategory: ${category}\ntitle: ${id}\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n`
    : `---\nid: ${id}\ncategory: ${category}\ntitle: ${id}\nlevel: 0\nsource: raw\nsource_ref: raw/${category}/x.md#L1-L2\ncreated: 2026-09-01\n---\n`;
  writeFileSync(join(dir, 'cards', category, `${id}${suffix}`), `${frontmatter}${opts.body}\n`);
}

function writeQuestions(dir: string, id: string): void {
  mkdirSync(join(dir, 'questions'), { recursive: true });
  const yaml = [
    `card: ${id}`,
    'fill:',
    '  - prompt: "答案是 ___。"',
    '    answers:',
    '      - ["對"]',
    '  - prompt: "另一個 ___。"',
    '    answers:',
    '      - ["也對"]',
    'apply:',
    '  - prompt: "解釋一下。"',
    '    rubric:',
    '      - "有講到重點"',
    '      - "沒有事實錯誤"',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'questions', `${id}.yaml`), yaml);
}

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-session-present-'));
  tmpDirs.push(dir);
  return dir;
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

describe('presentNextCard — order and progress', () => {
  it('presents due cards in queue order, with progress against the fixed total', async () => {
    const dir = makeDir();
    for (const id of ['sec-0001', 'sec-0002', 'sec-0003']) {
      writeCard(dir, id, { body: `卡片 ${id} 的內容。` });
      writeQuestions(dir, id);
    }
    const session = makeSession(dir, {
      queue: [
        { card: 'sec-0003', stage: 3, types: ['apply'], overdue_days: 3, overdue_ratio: 3, stuck: false },
        { card: 'sec-0001', stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false },
        { card: 'sec-0002', stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false },
      ],
      totalDue: 3,
    });

    const first = await presentNextCard(session);
    expect(first).toMatchObject({ kind: 'question', card: 'sec-0003', progress: { index: 1, total: 3 } });

    // 模擬答完第一張,queue 前進一格(current 從沒設過,answer.ts 解決 checkpoint 後也會清掉它)
    session.queue.shift();
    const second = await presentNextCard(session);
    expect(second).toMatchObject({ kind: 'question', card: 'sec-0001', progress: { index: 2, total: 3 } });
  });

  it('reports done once both the reteach and due queues are empty', async () => {
    const dir = makeDir();
    const session = makeSession(dir);
    const result = await presentNextCard(session);
    expect(result).toEqual({ kind: 'done' });
  });
});

describe('presentNextCard — reteach', () => {
  it('shows the shortened card before the first question, without affecting progress', async () => {
    const dir = makeDir();
    writeCard(dir, 'sec-0001', { body: '完整版內容。' });
    writeCard(dir, 'sec-0001', { short: true, body: '縮短版內容。' });
    writeQuestions(dir, 'sec-0001');
    const session = makeSession(dir, {
      reteachQueue: ['sec-0001'],
      queue: [{ card: 'sec-0001', stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: false }],
      totalDue: 1,
    });

    const reteach = await presentNextCard(session);
    expect(reteach).toEqual({ kind: 'reteach', card: 'sec-0001', shortBody: '縮短版內容。' });
    expect(session.reteachQueue).toHaveLength(0);
    expect(session.queue).toHaveLength(1); // 還沒被消耗,progress 分母/分子都沒動

    const question = await presentNextCard(session);
    expect(question).toMatchObject({ kind: 'question', card: 'sec-0001', progress: { index: 1, total: 1 } });
  });
});

describe('presentNextCard — stuck card', () => {
  it('notes the repeated failures when presenting a stuck card', async () => {
    const dir = makeDir();
    writeCard(dir, 'sec-0007', { body: '內容。' });
    writeQuestions(dir, 'sec-0007');
    const session = makeSession(dir, {
      queue: [{ card: 'sec-0007', stage: 1, types: ['fill'], overdue_days: 0, overdue_ratio: 0, stuck: true }],
      totalDue: 1,
    });

    const result = await presentNextCard(session);
    expect(result).toMatchObject({ kind: 'question', card: 'sec-0007', stuck: true });
  });
});
