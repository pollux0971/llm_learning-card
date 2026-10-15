/**
 * 14-hud-skin / phase-1:靜態檢查(樣式與元件不載入外部東西、沒有 inline style、字型帶授權、視窗 API 守則)。
 * 測試 agent 擁有。檢查邏輯在 test-support.ts,cucumber 步驟用同一份。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  HUD_DIR, fontFiles, fontLicenceProblems, hudSourceFiles, openingTag, readText, relPath, scanHudLoads,
  windowApiProblems,
} from './test-support.js';

describe('不從外面載東西、沒有 inline style', () => {
  it('掃到的檔案有 .css 也有 .svelte,而且沒有違規', () => {
    const r = scanHudLoads();
    expect(r.files).toBeGreaterThan(3);
    expect(r.problems).toEqual([]);
  });
});

describe('字型', () => {
  it('至少有一個字型檔,且每個旁邊都有 SIL OFL 1.1 授權文字', () => {
    expect(fontFiles().length).toBeGreaterThan(0);
    expect(fontLicenceProblems()).toEqual([]);
  });

  it('@font-face 的 url() 都是 hud/ 內存在的本機檔(不連外部字型服務)', () => {
    const css = readText(join(HUD_DIR, 'hud.css'));
    const urls = [...css.matchAll(/@font-face[^{]*\{[^}]*\}/g)].flatMap((m) => [...m[0].matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((u) => u[1]!));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).not.toMatch(/^(https?:)?\/\//);
      expect(existsSync(resolve(dirname(join(HUD_DIR, 'hud.css')), u.split('?')[0]!)), `字型檔不存在:${u}`).toBe(true);
    }
  });
});

describe('視窗 API 守則', () => {
  it('hud/ 的原始碼沒有 invoke / exit / relaunch / hide / destroy / setVisible / window.close(只准視窗物件的 close())', () => {
    expect(windowApiProblems()).toEqual([]);
  });
});

describe('元件接線(原始碼層)', () => {
  const src = (name: string) => readText(join(HUD_DIR, name));

  it('關閉鈕的 onclick 呼叫 controls.close;縮小鈕呼叫 controls.minimize', () => {
    const bar = src('HudTitleBar.svelte');
    const close = openingTag(bar, 'close');
    const min = openingTag(bar, 'minimize');
    expect(close, '找不到 data-hud="close" 的標籤').toBeDefined();
    expect(min, '找不到 data-hud="minimize" 的標籤').toBeDefined();
    expect(close).toMatch(/onclick\s*=\s*\{[^}]*\.close\b/);
    expect(min).toMatch(/onclick\s*=\s*\{[^}]*\.minimize\b/);
  });

  it('標題列有拖曳入口(startDragging 或 data-tauri-drag-region)', () => {
    const bar = src('HudTitleBar.svelte');
    expect(/startDragging|data-tauri-drag-region/.test(bar)).toBe(true);
  });

  it('縮放把手呼叫 startResizeDragging', () => {
    expect(src('HudResizeHandles.svelte')).toMatch(/startResizeDragging/);
  });

  it('hud/ 底下的原始碼有檔案可掃(防止全空時上面全綠)', () => {
    expect(hudSourceFiles().map((f) => relPath(f))).toEqual(expect.arrayContaining(['hud.css', 'HudPanel.svelte']));
  });
});
