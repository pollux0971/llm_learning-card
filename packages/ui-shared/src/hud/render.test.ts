/**
 * 14-hud-skin phase-1 修補(工單 T14)的渲染檢查:headless Chrome 畫展示頁,量像素與計算樣式。
 * 規格作者(UI/Tauri 負責人)寫;開發 worker 不改。檢查邏輯在 render-test-support.ts,cucumber 跑同一份。
 * 找不到 Chrome 就紅(設 LC_CHROME),不跳過。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  capHeightProblems, focusDistinctProblems, frameLineProblems, openGallery, panelSeeThroughProblems, rootBackgroundProblems,
  sizeAdjustProblems, type GalleryPage,
} from './render-test-support.js';

describe('展示頁的渲染(headless Chrome)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openGallery(); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => {
    if (!page) throw new Error('展示頁沒有開起來');
    return page;
  };

  it('G1 面板真的半透明:內距那一條直線上,每個像素 = --hud-panel 疊在面板後面那個像素上', async () => {
    expect(await panelSeeThroughProblems(p())).toEqual([]);
  }, 60_000);

  it('G3 框線在每條直邊都是 1 像素(面板、三顆按鈕;第 3 顆換成純英文 NEXT),切角斜邊也有線', async () => {
    expect(await frameLineProblems(p())).toEqual([]);
  }, 60_000);

  it('G3 對照:按鈕都是中文時,框線也是 1 像素', async () => {
    expect(await frameLineProblems(p(), { latinOnlyThird: false })).toEqual([]);
  }, 60_000);

  it('G5 鍵盤焦點跟 hover、跟一般狀態都看得出不同(像素),計算樣式也跟 hover 不同', async () => {
    expect(await focusDistinctProblems(p())).toEqual([]);
  }, 60_000);

  it('G6 中英混排:Rajdhani 的大寫高度是中文字的 0.78–0.92', async () => {
    expect(await capHeightProblems(p())).toEqual([]);
  }, 60_000);
});

describe('hud.css 的靜態規則', () => {
  it('G2 指整個頁面的規則(html、:root、body)不畫底色與格線,只有 hud-solid 可以', () => {
    expect(rootBackgroundProblems()).toEqual([]);
  });

  it('G6 Rajdhani 的 @font-face 有 size-adjust,而且大於 100%', () => {
    expect(sizeAdjustProblems()).toEqual([]);
  });
});
