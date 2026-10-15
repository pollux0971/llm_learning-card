/**
 * 14-hud-skin phase-2(工單 T15)展示頁的部分:HudField、D1 頁首對比、hud.css 的新設計值。
 * 測試 agent 寫;開發 worker 不改。檢查邏輯在 gallery-phase2-test-support.ts,cucumber 與這裡共用。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  accentProblems, darkSwitchReachableProblems, faceBackgroundProblems, fieldCssProblems, fieldRenderProblems, galleryStaticProblems, gallerySlotsProblems,
  headContrastProblems, panelFitsViewportProblems, passFailContrastProblems,
} from './gallery-phase2-test-support.js';
import { openGallery, type GalleryPage } from './render-test-support.js';
import { HUD_DIR, countHook, renderSvelte, createRawSnippetOrThrow, closeViteServer } from './test-support.js';

describe('hud.css 的新設計值(驗收 2、4)', () => {
  it('--hud-pass 與 --hud-fail 對面板的最差對比 ≥ 4.5,而且兩個值不同', () => {
    expect(passFailContrastProblems()).toEqual([]);
  });

  it('HudField 的樣式寫在 hud.css:有 :focus-within 規則,只引用 var(--hud-*),橘色不印字', () => {
    expect(fieldCssProblems()).toEqual([]);
  });
});

describe('作答欄與按鈕的底色(第三輪)', () => {
  it('底色只來自 var(--hud-panel):沒有寫死的不透明色,沒有 --hud-field 這類專用變數;一般狀態不墊黑底', () => {
    expect(faceBackgroundProblems()).toEqual([]);
  });
});

describe('HudField 元件(驗收 4)', () => {
  afterAll(async () => { await closeViteServer(); });

  it('hud/HudField.svelte 存在,伺服器端 render 出一個 data-hud="field",包住它的 children(原生 input)', async () => {
    expect(existsSync(join(HUD_DIR, 'HudField.svelte'))).toBe(true);
    const html = await renderSvelte('HudField', { children: await createRawSnippetOrThrow('<input type="text" id="x">') });
    expect(countHook(html, 'field')).toBe(1);
    expect(html).toMatch(/data-hud=["']field["'][^>]*>[\s\S]*<input type="text" id="x">[\s\S]*<\/div>/);
  }, 60_000);

  it('沒有 children 也 render 得出來(不丟錯)', async () => {
    const html = await renderSvelte('HudField', {});
    expect(countHook(html, 'field')).toBe(1);
  }, 60_000);
});

describe('展示頁的標記(驗收 4、8)', () => {
  it('只有 1 個 HudPanel;頁首容器在面板外、含深色背景開關;兩個 HudField 在面板裡 HP 條後面;前三顆按鈕不動', () => {
    expect(galleryStaticProblems()).toEqual([]);
  });
});

describe('展示頁的渲染(headless Chrome,720 × 900)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openGallery(); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => { if (!page) throw new Error('展示頁沒有開起來'); return page; };

  it('驗收 4:HudField 的框線 1 像素、切角斜邊有線、高 ≥ 36、寬等於容器、焦點與停用看得出來,輸入框自己沒有框與底色', async () => {
    expect(await fieldRenderProblems(p())).toEqual([]);
  }, 90_000);

  it('驗收 8 / D1:一般背景,頁首每個直接有字的元素,字色對底色每個像素的對比 ≥ 4.5', async () => {
    expect(await headContrastProblems(p(), false)).toEqual([]);
  }, 60_000);

  it('驗收 8 / D1:深色背景勾起來,頁首的字照樣看得清楚(對比 ≥ 4.5)', async () => {
    expect(await headContrastProblems(p(), true)).toEqual([]);
  }, 60_000);

  it('驗收 8 / D1:深色背景的開關在頁首裡,而且點得到', async () => {
    expect(await darkSwitchReachableProblems(p())).toEqual([]);
  }, 60_000);

  it('第三輪:hover 與 focus 還是橘色,focus 與 hover 分得出來;作答欄 focus-within 框線變橘', async () => {
    expect(await accentProblems(p())).toEqual([]);
  }, 90_000);

  it('驗收 9:加了頁首與作答欄之後,面板整個還在 720 × 900 的視窗裡(T14 的量尺才量得到)', async () => {
    expect(await panelFitsViewportProblems(p())).toEqual([]);
  }, 60_000);

  it('驗收 4:第一個 [data-hud="panel"] 與前三顆 [data-hud="button"] 維持原樣(T14 的量尺用索引找)', async () => {
    expect(await gallerySlotsProblems(p())).toEqual([]);
  }, 60_000);
});
