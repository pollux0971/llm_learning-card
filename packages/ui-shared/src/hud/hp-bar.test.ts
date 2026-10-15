/**
 * 14-hud-skin / phase-1:HP 條的比例算法。測試 agent 擁有,開發 worker 不改。
 * 釘住的介面:hud/hp-bar.ts 匯出 hpPercent(done: number, total: number): number
 *   0..100,不四捨五入(1/3 → 33.333…);done 超過 total → 100;total ≤ 0 → 0;負數、NaN、Infinity → 0 或夾進範圍,不丟錯。
 * 元件 HpBar.svelte(props done、total)render 出 role="progressbar"、data-percent、aria-valuenow(同值)。
 */
import { importHud, renderSvelte } from './test-support.js';

type HpPercent = (done: number, total: number) => number;
async function hp(): Promise<HpPercent> {
  return ((await importHud('hp-bar')) as { hpPercent: HpPercent }).hpPercent;
}

describe('hpPercent', () => {
  it.each([
    [0, 4, 0], [1, 4, 25], [2, 4, 50], [3, 4, 75], [4, 4, 100], [5, 4, 100], [0, 0, 0], [3, 0, 0], [100, 1, 100],
  ])('%i / %i → %i', async (done, total, want) => {
    expect((await hp())(done, total)).toBe(want);
  });

  it('不四捨五入:1/3 與 2/3 保留小數(HP 條要平滑)', async () => {
    const f = await hp();
    expect(f(1, 3)).toBeCloseTo(33.33333, 4);
    expect(f(2, 3)).toBeCloseTo(66.66667, 4);
  });

  it('壞輸入夾進 0..100,不丟錯(進度資料不該把畫面弄壞)', async () => {
    const f = await hp();
    for (const [d, t] of [[-1, 4], [1, -4], [Number.NaN, 4], [1, Number.NaN], [Infinity, 4], [1, Infinity]] as const) {
      const v = f(d, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(f(-1, 4)).toBe(0);
    expect(f(1, -4)).toBe(0);
  });

  it('單調:done 增加,百分比不減少', async () => {
    const f = await hp();
    let prev = -1;
    for (let d = 0; d <= 12; d += 1) { const v = f(d, 10); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
});

describe('HpBar.svelte', () => {
  const attr = (html: string, name: string) => new RegExp(`${name}=["']([^"']*)["']`).exec(html)?.[1];

  it.each([[0, 4, '0'], [1, 4, '25'], [4, 4, '100'], [5, 4, '100'], [0, 0, '0']])(
    '%i / %i → data-percent 與 aria-valuenow 都是 %s', async (done, total, want) => {
      const html = await renderSvelte('HpBar', { done, total });
      expect(html).toMatch(/data-hud=["']hp-bar["']/);
      expect(html).toMatch(/role=["']progressbar["']/);
      expect(attr(html, 'data-percent')).toBe(want);
      expect(attr(html, 'aria-valuenow')).toBe(want);
      expect(attr(html, 'aria-valuemin')).toBe('0');
      expect(attr(html, 'aria-valuemax')).toBe('100');
    });
});
