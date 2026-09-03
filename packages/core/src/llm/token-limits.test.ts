import { describe, it, expect } from 'vitest';
import { TASK_MAX_TOKENS } from './token-limits.js';
import { LLM_TASKS } from './types.js';

describe('TASK_MAX_TOKENS — 契約 §7 的 7 個 LlmTask 各自的 token 上限', () => {
  it.each(LLM_TASKS)('has an entry for task=%s', (task) => {
    expect(TASK_MAX_TOKENS[task]).toBeTypeOf('number');
    expect(TASK_MAX_TOKENS[task]).toBeGreaterThan(0);
  });

  it('covers exactly the 7 tasks in the contract, no more, no fewer', () => {
    expect(Object.keys(TASK_MAX_TOKENS).sort()).toEqual([...LLM_TASKS].sort());
  });

  it('ingest.cards >= 4096 (回歸鎖:這是最容易被手滑改小的一個,卡片生成需要最多字)', () => {
    expect(TASK_MAX_TOKENS['ingest.cards']).toBeGreaterThanOrEqual(4096);
  });

  it('matches the values decided for this fix', () => {
    expect(TASK_MAX_TOKENS).toEqual({
      'ingest.cards': 8192,
      'ingest.questions': 4096,
      'ingest.deps': 2048,
      deepen: 2048,
      'reteach.short': 512,
      'grade.fill.llm': 256,
      'grade.apply': 512,
    });
  });
});
