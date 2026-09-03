import { describe, it, expect, vi } from 'vitest';
import { LlmRouterImpl } from './router-impl.js';

/**
 * 對照 features/03-llm-router/phase-2.feature 的三個非 Outline scenario:
 * 「The local model being absent is not an error」、「Connectivity is cached
 * briefly」、「The cache expires」。路由表 11 組的 Outline 測試在 routing.test.ts
 * (decideRoute 是純函式,不需要透過這個類別)。
 */

describe('LlmRouterImpl.probeLocal — 本機探測可注入,預設固定 unavailable(ADR-037)', () => {
  it('本機模型伺服器拒絕連線時,回報不可用,不把錯誤往外丟', async () => {
    const refusingProber = vi.fn(async (): Promise<never> => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    });
    const router = new LlmRouterImpl({ localProber: refusingProber });

    await expect(router.probeLocal()).resolves.toEqual({ available: false, models: [] });
    expect(refusingProber).toHaveBeenCalledTimes(1);
  });

  it('沒有注入探測器時,預設一律回報不可用(phase-2 沒有真的本機模型可偵測)', async () => {
    const router = new LlmRouterImpl();
    await expect(router.probeLocal()).resolves.toEqual({ available: false, models: [] });
  });
});

describe('LlmRouterImpl.probeOnline — 快取(FEATURE.md:60 秒快取)', () => {
  it('十秒內第二次呼叫,只打一次真的探測', async () => {
    let now = 0;
    const onlineProber = vi.fn(async () => true);
    const router = new LlmRouterImpl({ onlineProber, now: () => now });

    await router.probeOnline();
    now += 10_000;
    const second = await router.probeOnline();

    expect(onlineProber).toHaveBeenCalledTimes(1);
    expect(second).toBe(true);
  });

  it('九十秒後快取過期,第二次呼叫會再打一次真的探測', async () => {
    let now = 0;
    const onlineProber = vi.fn(async () => true);
    const router = new LlmRouterImpl({ onlineProber, now: () => now });

    await router.probeOnline();
    now += 90_000;
    await router.probeOnline();

    expect(onlineProber).toHaveBeenCalledTimes(2);
  });

  it('快取的是探測「結果」,不是固定回傳 true——離線的結果一樣被快取住', async () => {
    let now = 0;
    const onlineProber = vi.fn(async () => false);
    const router = new LlmRouterImpl({ onlineProber, now: () => now });

    await router.probeOnline();
    now += 5_000;
    const second = await router.probeOnline();

    expect(onlineProber).toHaveBeenCalledTimes(1);
    expect(second).toBe(false);
  });
});

describe('LlmRouterImpl — LLM_LOCAL_MODEL 設定來源(契約 §11:環境變數覆蓋 settings)', () => {
  it('環境變數 LLM_LOCAL_MODEL 覆蓋 settings.llm.local_model', () => {
    const router = new LlmRouterImpl({
      env: { LLM_LOCAL_MODEL: 'from-env' },
      settings: { local_model: 'from-settings' },
    });

    expect(router.resolveLocalModel()).toBe('from-env');
  });

  it('沒有環境變數時,退回 settings.llm.local_model', () => {
    const router = new LlmRouterImpl({ env: {}, settings: { local_model: 'from-settings' } });
    expect(router.resolveLocalModel()).toBe('from-settings');
  });

  it('兩邊都沒設定時回傳 undefined,不丟錯(本機模型可以不存在,ADR-037)', () => {
    const router = new LlmRouterImpl({ env: {}, settings: {} });
    expect(router.resolveLocalModel()).toBeUndefined();
  });
});
