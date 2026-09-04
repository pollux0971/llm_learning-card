/**
 * fallback.ts 的單元測試(ADR-039)。
 *
 * 備援表有三個分組 × 三種雲端狀態 = 9 格,每一格一個測試,一格都不留白——
 * 這張表決定的是「什麼時候改用免費的閘道、什麼時候寧可失敗」,跟 routing.ts
 * 一樣是會直接影響成本與卡片品質的東西。
 *
 * 另外釘住兩件容易被改壞的事:
 *   1. `grade.fill.llm` 走閘道但 **provisional = false**——填空審核本來就該由本機
 *      做,它不是雲端結果的替代品,所以不進 I6 的複審佇列。
 *   2. `ingest.*` 預算用完時是**在花錢之前**就丟 DailyBudgetExceededError,
 *      而不是先打了再說。
 */
import { describe, expect, it } from 'vitest';
import { CloudRequiredError, DailyBudgetExceededError } from './errors.js';
import { FALLBACK_TABLE, decideFallback, type CloudStatus, type FallbackGroup } from './fallback.js';
import { LLM_TASKS, type LlmTask } from './types.js';

const GATEWAY_ALWAYS: LlmTask[] = ['grade.fill.llm'];
const GATEWAY_FALLBACK: LlmTask[] = ['deepen', 'grade.apply', 'reteach.short'];
const CLOUD_ONLY: LlmTask[] = ['ingest.cards', 'ingest.questions', 'ingest.deps'];

describe('FALLBACK_TABLE', () => {
  it('契約 §7 的七個 task 每一個都有分組', () => {
    for (const task of LLM_TASKS) {
      expect(FALLBACK_TABLE[task], `${task} 沒有分組`).toBeDefined();
    }
    expect(Object.keys(FALLBACK_TABLE).sort()).toEqual([...LLM_TASKS].sort());
  });

  it('ingest.* 三個都是 cloud-only:卡片品質還沒用本機模型驗過,不讓它產卡', () => {
    for (const task of CLOUD_ONLY) expect(FALLBACK_TABLE[task]).toBe('cloud-only');
  });

  it('deepen / grade.apply / reteach.short 可以備援', () => {
    for (const task of GATEWAY_FALLBACK) expect(FALLBACK_TABLE[task]).toBe('gateway-fallback');
  });

  it('grade.fill.llm 一律走閘道——契約 §7 本來就寫 local', () => {
    for (const task of GATEWAY_ALWAYS) expect(FALLBACK_TABLE[task]).toBe('gateway-always');
  });
});

describe('decideFallback — gateway-always(grade.fill.llm)', () => {
  const cases: CloudStatus[] = ['ok', 'failed', 'budget-exhausted'];

  it.each(cases)('雲端狀態是 %s 也照樣走閘道', (cloud) => {
    expect(decideFallback({ task: 'grade.fill.llm', cloud })).toEqual({ target: 'gateway', provisional: false });
  });

  it('不標 provisional:填空審核本來就是本機的工作,不是暫定結果', () => {
    expect(decideFallback({ task: 'grade.fill.llm', cloud: 'ok' }).provisional).toBe(false);
  });

  it('不帶備援原因——它根本沒有在備援', () => {
    expect(decideFallback({ task: 'grade.fill.llm', cloud: 'ok' }).reason).toBeUndefined();
  });
});

describe('decideFallback — gateway-fallback(deepen / grade.apply / reteach.short)', () => {
  it.each(GATEWAY_FALLBACK)('%s:雲端沒事就走雲端,不標 provisional', (task) => {
    expect(decideFallback({ task, cloud: 'ok' })).toEqual({ target: 'cloud', provisional: false });
  });

  it.each(GATEWAY_FALLBACK)('%s:雲端失敗就改走閘道並標 provisional', (task) => {
    expect(decideFallback({ task, cloud: 'failed' })).toEqual({
      target: 'gateway',
      provisional: true,
      reason: 'cloud_failed',
    });
  });

  it.each(GATEWAY_FALLBACK)('%s:預算用完也改走閘道,原因不一樣', (task) => {
    expect(decideFallback({ task, cloud: 'budget-exhausted' })).toEqual({
      target: 'gateway',
      provisional: true,
      reason: 'budget_exhausted',
    });
  });
});

describe('decideFallback — cloud-only(ingest.*)', () => {
  it.each(CLOUD_ONLY)('%s:雲端沒事就走雲端', (task) => {
    expect(decideFallback({ task, cloud: 'ok' })).toEqual({ target: 'cloud', provisional: false });
  });

  it.each(CLOUD_ONLY)('%s:雲端失敗就丟 CLOUD_REQUIRED,不備援', (task) => {
    expect(() => decideFallback({ task, cloud: 'failed' })).toThrow(CloudRequiredError);
  });

  it.each(CLOUD_ONLY)('%s:預算用完就丟 BUDGET_EXCEEDED,拒絕開始', (task) => {
    expect(() => decideFallback({ task, cloud: 'budget-exhausted' })).toThrow(DailyBudgetExceededError);
  });

  it('CLOUD_REQUIRED 的錯誤點名是哪個 task', () => {
    try {
      decideFallback({ task: 'ingest.cards', cloud: 'failed' });
      expect.unreachable('應該丟錯');
    } catch (err) {
      expect((err as CloudRequiredError).code).toBe('CLOUD_REQUIRED');
      expect((err as CloudRequiredError).task).toBe('ingest.cards');
    }
  });

  it('BUDGET_EXCEEDED 的訊息含「今日預算已用完」與金額', () => {
    try {
      decideFallback({ task: 'ingest.cards', cloud: 'budget-exhausted', spentUsd: 1.25, capUsd: 1 });
      expect.unreachable('應該丟錯');
    } catch (err) {
      const e = err as DailyBudgetExceededError;
      expect(e.code).toBe('BUDGET_EXCEEDED');
      expect(e.message).toMatch(/今日預算已用完/);
      expect(e.spentUsd).toBe(1.25);
      expect(e.capUsd).toBe(1);
    }
  });
});

describe('decideFallback 是純函式', () => {
  it('不改動傳進來的 input', () => {
    const input = { task: 'deepen' as LlmTask, cloud: 'failed' as CloudStatus };
    const snapshot = JSON.stringify(input);
    decideFallback(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('不改動預設的備援表', () => {
    const snapshot = JSON.stringify(FALLBACK_TABLE);
    for (const task of LLM_TASKS) {
      for (const cloud of ['ok', 'failed', 'budget-exhausted'] as CloudStatus[]) {
        try {
          decideFallback({ task, cloud });
        } catch {
          // cloud-only 的兩條會丟錯,這裡只在意表格有沒有被改到
        }
      }
    }
    expect(JSON.stringify(FALLBACK_TABLE)).toBe(snapshot);
  });

  it('改備援表就改行為,不用改 decideFallback 本身', () => {
    const patched: Record<LlmTask, FallbackGroup> = { ...FALLBACK_TABLE, deepen: 'cloud-only' };
    expect(() => decideFallback({ task: 'deepen', cloud: 'failed' }, patched)).toThrow(CloudRequiredError);
    // 預設表不受影響
    expect(decideFallback({ task: 'deepen', cloud: 'failed' }).target).toBe('gateway');
  });
});
