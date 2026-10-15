/**
 * 14-hud-skin / phase-1:根元素兩個 class 與「畫哪些東西」。測試 agent 擁有。
 * 釘住的介面:hud/layout.ts
 *   FRAMELESS_CLASS = 'hud-frameless'、SOLID_CLASS = 'hud-solid'
 *   hudChrome({ frameless, tauri }) → { titleBar, resizeHandles, windowButtons }
 *     titleBar、resizeHandles 只看 frameless;windowButtons = frameless 且 tauri
 *   readRootFlags(root: { classList: { contains(c: string): boolean } }) → { frameless, solid }
 */
import { importHud, type Chrome } from './test-support.js';

interface Layout {
  FRAMELESS_CLASS: string;
  SOLID_CLASS: string;
  hudChrome(o: { frameless: boolean; tauri: boolean }): Chrome;
  readRootFlags(root: { classList: { contains(c: string): boolean } }): { frameless: boolean; solid: boolean };
}
const load = () => importHud<Layout>('layout');

describe('hudChrome', () => {
  it.each([
    // frameless, tauri → titleBar, resizeHandles, windowButtons
    [false, false, false, false, false],
    [false, true, false, false, false], // 沒有 hud-frameless:系統標題列還在,不能出現第二條
    [true, false, true, true, false], // 瀏覽器:有標題列與把手,沒有 – ×
    [true, true, true, true, true],
  ])('frameless=%s tauri=%s → 標題列 %s、把手 %s、按鈕 %s', async (frameless, tauri, bar, handles, buttons) => {
    const { hudChrome } = await load();
    expect(hudChrome({ frameless, tauri })).toEqual({ titleBar: bar, resizeHandles: handles, windowButtons: buttons });
  });
});

describe('readRootFlags', () => {
  it('class 名稱是 hud-frameless 與 hud-solid(桌面殼 10 phase-6 照這兩個名字設)', async () => {
    const l = await load();
    expect(l.FRAMELESS_CLASS).toBe('hud-frameless');
    expect(l.SOLID_CLASS).toBe('hud-solid');
  });

  it('兩個 class 各自獨立判斷', async () => {
    const { readRootFlags } = await load();
    const root = (...cls: string[]) => ({ classList: { contains: (c: string) => cls.includes(c) } });
    expect(readRootFlags(root())).toEqual({ frameless: false, solid: false });
    expect(readRootFlags(root('hud-frameless'))).toEqual({ frameless: true, solid: false });
    expect(readRootFlags(root('hud-solid'))).toEqual({ frameless: false, solid: true });
    expect(readRootFlags(root('hud-solid', 'hud-frameless', 'other'))).toEqual({ frameless: true, solid: true });
    // 名字要完全相等,不是子字串
    expect(readRootFlags(root('hud-frameless-x', 'not-hud-solid'))).toEqual({ frameless: false, solid: false });
  });
});
