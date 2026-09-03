/**
 * 對照 phase-1.feature:
 *   - Listing what is due without answering anything(建立 session 本身,
 *     不寫任何檔案——dry-run 的輸出交給 summary.test.ts 的 renderDryRun,
 *     這裡只驗證 session.queue 的內容跟順序是對的)
 *   - Nothing due says so and exits cleanly
 *   - A session asks each due card in order
 *   - Reteach cards are shown before the questions(這裡測 deriveReteachQueue
 *     怎麼決定哪些卡進佇列;「顯示」的行為在 present.test.ts)
 *
 * 也覆蓋 04-scheduler 的 daily_cap 上限確實有被組合層接上。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardId, Review } from '@contracts/index.js';
import { buildTodaySession, deriveReteachQueue } from './build.js';

const TODAY = '2026-09-10';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeLearningDir(reviews: Record<CardId, Review>, settingsOverrides: { daily_cap?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-session-build-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'state'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'state/reviews.json'), `${JSON.stringify(reviews, null, 2)}\n`);
  const dailyCap = settingsOverrides.daily_cap ?? 10;
  writeFileSync(
    join(dir, 'config/settings.yaml'),
    [
      `daily_cap: ${dailyCap}`,
      'weekly_target: 7',
      'short_body_limit: 50',
      'llm:',
      '  cloud_provider: anthropic',
      '  cloud_model: claude-sonnet-4-6',
      '  local_model: qwen2.5:14b',
      '',
    ].join('\n'),
  );
  return dir;
}

function review(overrides: Partial<Review> & Pick<Review, 'stage' | 'learned_at' | 'next_due'>): Review {
  return { fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...overrides };
}

describe('buildTodaySession', () => {
  it('reports nothing due when no card is due today', async () => {
    const dir = makeLearningDir({
      'sec-0001': review({ stage: 1, learned_at: TODAY, next_due: '2026-09-11' }),
    });
    const session = await buildTodaySession({ learningDir: dir, today: TODAY });
    expect(session.queue).toHaveLength(0);
    expect(session.reteachQueue).toHaveLength(0);
    expect(session.totalDue).toBe(0);
  });

  it('orders the queue by overdue ratio, matching what selectSession returns', async () => {
    const dir = makeLearningDir({
      // stage 1 間隔 1 天,逾期 3 天 → overdue_ratio 3.0(排最前)
      'sec-low': review({ stage: 3, learned_at: '2026-08-01', next_due: '2026-09-09' }), // stage3 間隔30天,逾期1天,ratio ~0.033
      'sec-high': review({ stage: 1, learned_at: '2026-09-05', next_due: '2026-09-07' }), // stage1 間隔1天,逾期3天,ratio 3.0
    });
    const session = await buildTodaySession({ learningDir: dir, today: TODAY });
    expect(session.queue.map((d) => d.card)).toEqual(['sec-high', 'sec-low']);
  });

  it('applies daily_cap from config/settings.yaml and reports the deferred count', async () => {
    const dir = makeLearningDir(
      {
        a: review({ stage: 1, learned_at: '2026-09-01', next_due: '2026-09-09' }),
        b: review({ stage: 1, learned_at: '2026-09-02', next_due: '2026-09-09' }),
        c: review({ stage: 1, learned_at: '2026-09-03', next_due: '2026-09-09' }),
      },
      { daily_cap: 2 },
    );
    const session = await buildTodaySession({ learningDir: dir, today: TODAY });
    expect(session.dailyCap).toBe(2);
    expect(session.queue).toHaveLength(2);
    expect(session.deferred).toBe(1);
    expect(session.totalDue).toBe(2);
  });

  it('does not write anything to disk while building the session', async () => {
    const dir = makeLearningDir({ a: review({ stage: 1, learned_at: '2026-09-09', next_due: '2026-09-10' }) });
    const before = readFileSync(join(dir, 'state/reviews.json'), 'utf8');
    await buildTodaySession({ learningDir: dir, today: TODAY });
    expect(readFileSync(join(dir, 'state/reviews.json'), 'utf8')).toBe(before);
  });
});

describe('deriveReteachQueue', () => {
  it('queues cards whose most recent failure just crossed into reteach territory (fails_in_row === 2)', () => {
    const reviews: Record<CardId, Review> = {
      reteach: review({ stage: 1, learned_at: '2026-09-01', next_due: TODAY, fails_in_row: 2 }),
      fine: review({ stage: 1, learned_at: '2026-09-01', next_due: TODAY, fails_in_row: 0 }),
      stuck: review({ stage: 1, learned_at: '2026-09-01', next_due: TODAY, fails_in_row: 3, stuck: true }),
    };
    const result = deriveReteachQueue(reviews, ['reteach', 'fine', 'stuck']);
    expect(result).toEqual(['reteach']);
  });

  it('returns an empty queue when nothing qualifies', () => {
    const reviews: Record<CardId, Review> = {
      fine: review({ stage: 1, learned_at: '2026-09-01', next_due: TODAY }),
    };
    expect(deriveReteachQueue(reviews, ['fine'])).toEqual([]);
  });
});
