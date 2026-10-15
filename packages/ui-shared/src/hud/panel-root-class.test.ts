/**
 * 14-hud-skin / phase-1 驗收補測:HudPanel 沒傳 frameless / solid 時,讀頁面根元素的 class
 * (桌面殼 10 phase-6 把 `hud-frameless`、`hud-solid` 設在 <html> 上;元件在 render 當下讀,不等 onMount)。
 * 驗收者(測試 agent)寫。原有的 components.test.ts 只測 prop 與「沒有 document」,
 * 突變「忽略根元素 class」存活,所以補在這裡。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeViteServer, countHook, createRawSnippetOrThrow, renderSvelte } from './test-support.js';

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await closeViteServer(); });

function stubRoot(classes: string[]): void {
  vi.stubGlobal('document', { documentElement: { classList: { contains: (name: string) => classes.includes(name) } } });
}

async function panel(extra: Record<string, unknown> = {}): Promise<string> {
  return renderSvelte('HudPanel', { title: 'Card title', children: await createRawSnippetOrThrow('<p>hi</p>'), ...extra });
}

describe('HudPanel 讀根元素的 class', () => {
  it('根元素有 hud-frameless、沒傳 prop → 畫標題列與 8 個縮放把手', async () => {
    stubRoot(['hud-frameless']);
    const html = await panel();
    expect(countHook(html, 'titlebar')).toBe(1);
    expect(countHook(html, 'resize-handle')).toBe(8);
  });

  it('根元素沒有 hud-frameless、沒傳 prop → 不畫標題列也不畫把手(系統標題列還在,不能出現兩條)', async () => {
    stubRoot(['something-else']);
    const html = await panel();
    expect(countHook(html, 'titlebar')).toBe(0);
    expect(countHook(html, 'resize-handle')).toBe(0);
  });

  it('prop 優先於根元素:frameless={false} 即使根元素有 class 也不畫', async () => {
    stubRoot(['hud-frameless']);
    const html = await panel({ frameless: false });
    expect(countHook(html, 'titlebar')).toBe(0);
  });

  it('根元素有 hud-solid、沒傳 prop → 面板帶 hud-solid;沒有就不帶;prop 優先', async () => {
    stubRoot(['hud-solid']);
    expect(await panel()).toMatch(/class="[^"]*hud-solid/);
    stubRoot([]);
    expect(await panel()).not.toMatch(/hud-solid/);
    stubRoot(['hud-solid']);
    expect(await panel({ solid: false })).not.toMatch(/hud-solid/);
  });
});
