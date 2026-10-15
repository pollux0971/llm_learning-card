/**
 * 14-hud-skin / phase-1:展示頁的結構(靜態檢查;dev server 真的起得來由 cucumber 場景 1 驗)。
 * 測試 agent 擁有。釘住的檔案:hud/gallery/index.html、main.ts、Gallery.svelte。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HUD_DIR, REPO_ROOT, readText } from './test-support.js';

const G = join(HUD_DIR, 'gallery');

describe('展示頁', () => {
  it('index.html、main.ts、Gallery.svelte 都在;index.html 載入 main.ts', () => {
    for (const f of ['index.html', 'main.ts', 'Gallery.svelte']) expect(existsSync(join(G, f)), `gallery/${f}`).toBe(true);
    expect(readText(join(G, 'index.html'))).toMatch(/<script[^>]+type=["']module["'][^>]+src=["'][^"']*main\.ts["']/);
  });

  it('Gallery.svelte 用到每一種元件:面板、標題列(經面板)、縮放把手(經面板)、按鈕 ×3、HP 條 0/3 2/3 3/3', () => {
    const t = readText(join(G, 'Gallery.svelte'));
    for (const c of ['HudPanel', 'HudButton', 'HpBar']) expect(t, c).toContain(c);
    expect((t.match(/<HudButton\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(t).toMatch(/<HpBar\b[^>]*\bdone=\{?["']?0["']?\}?[^>]*\btotal=\{?["']?3/);
    expect(t).toMatch(/<HpBar\b[^>]*\bdone=\{?["']?2["']?\}?[^>]*\btotal=\{?["']?3/);
    expect(t).toMatch(/<HpBar\b[^>]*\bdone=\{?["']?3["']?\}?[^>]*\btotal=\{?["']?3/);
  });

  it('兩個開關會切換根元素的 hud-frameless 與 hud-solid', () => {
    const t = readText(join(G, 'Gallery.svelte')) + readText(join(G, 'main.ts'));
    expect(t).toMatch(/hud-frameless|FRAMELESS_CLASS/);
    expect(t).toMatch(/hud-solid|SOLID_CLASS/);
    expect(t).toMatch(/classList\.(toggle|add|remove)/);
    expect((readText(join(G, 'Gallery.svelte')).match(/type=["']checkbox["']/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('文字來自 contracts/fixtures/cards/ 的卡片 fixture(不 import 06、07 的程式)', () => {
    const t = readText(join(G, 'Gallery.svelte')) + readText(join(G, 'main.ts'));
    expect(t).toMatch(/contracts\/fixtures\/cards\//);
    expect(t).not.toMatch(/apps\/(teach-card|test-card)/);
    expect(readdirSync(join(REPO_ROOT, 'contracts/fixtures/cards')).some((f) => f.endsWith('.md'))).toBe(true);
  });

  it('main.ts 載入 hud.css(樣式只有一份)', () => {
    const t = readText(join(G, 'main.ts')) + readText(join(G, 'Gallery.svelte')) + readText(join(G, 'index.html'));
    expect(t).toMatch(/hud\.css/);
  });
});
