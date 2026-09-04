/**
 * 鎖住 `resolveRenamedAwayRouter`。
 *
 * 這支測試存在的原因是一個實測出來的退步:把「the fake router fixtures directory
 * is renamed away」改成 `state.router ??= build()` 之後,把 I1 Background 的
 * `ctx(this).router = buildReachableCloudRouter(this)` 拿掉,
 * 「The pipeline works without any fake in the loop」從 **1 failed** 變成 **1 passed**。
 * 下面第一個測試就是那個情況的單元版本。
 */
import { describe, expect, it } from 'vitest';
import { resolveRenamedAwayRouter } from './_router-guard.js';

describe('resolveRenamedAwayRouter', () => {
  it('Background 宣告過 provider 卻沒留下 router 時丟例外,不就地補一個', () => {
    let built = 0;
    const state = { cloudProviderConfigured: true };

    expect(() => resolveRenamedAwayRouter(state, () => (built++, 'fresh'))).toThrow(/沒有留下 router/);
    expect(built).toBe(0);
  });

  it('Background 宣告過 provider 且 router 在,就用 Background 那一個', () => {
    let built = 0;
    const state = { cloudProviderConfigured: true, router: 'from-background' };

    expect(resolveRenamedAwayRouter(state, () => (built++, 'fresh'))).toBe('from-background');
    expect(built).toBe(0);
  });

  it('Background 沒宣告 provider(I2 借用這句)就就地建一個,並記在 state 上', () => {
    const state: { cloudProviderConfigured?: boolean; router?: string } = {};

    expect(resolveRenamedAwayRouter(state, () => 'fresh')).toBe('fresh');
    expect(state.router).toBe('fresh');
  });

  it('沒宣告 provider 但已經有 router 時不重建', () => {
    let built = 0;
    const state = { router: 'existing' };

    expect(resolveRenamedAwayRouter(state, () => (built++, 'fresh'))).toBe('existing');
    expect(built).toBe(0);
  });
})
