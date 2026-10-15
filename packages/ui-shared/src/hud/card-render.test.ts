/**
 * 14-hud-skin phase-2(工單 T15)兩張卡的渲染檢查:headless Chrome 開 dev server,視窗 360 × 480。
 * 測試 agent 寫;開發 worker 不改。檢查邏輯在 card-render-test-support.ts,cucumber 跑同一份。
 * 找不到 Chrome 就紅(設 LC_CHROME),不跳過。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enterKeyProblems, exampleMarginProblems, hpBarProblems, noResultBeforeSubmitProblems, openCard, panelFillProblems,
  resultTextProblems, scrollInsideProblems, submitLifecycleProblems, submitVisibleProblems,
} from './card-render-test-support.js';
import { PANEL_FILLS_WINDOW } from './card-design-values-test-support.js';
import type { GalleryPage } from './render-test-support.js';

describe('教學卡的版面(360 × 480)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openCard('teach-card'); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => { if (!page) throw new Error('教學卡沒有開起來'); return page; };

  it.runIf(PANEL_FILLS_WINDOW)('驗收 5:面板撐滿視窗(0,0,360,480),整頁不捲,四邊黑線在視窗邊上', async () => {
    await p().reset();
    expect(await panelFillProblems(p())).toEqual([]);
  }, 60_000);

  it.runIf(PANEL_FILLS_WINDOW)('驗收 5:第一張卡比視窗長,捲的是面板裡面', async () => {
    await p().reset();
    expect(await scrollInsideProblems(p())).toEqual([]);
  }, 60_000);

  it('驗收 6:例子框左右離面板捲動區都 ≥ 12 像素,捲動區沒有橫向凸出', async () => {
    await p().reset();
    expect(await exampleMarginProblems(p())).toEqual([]);
  }, 60_000);
});

describe('考試卡的版面與互動(360 × 480)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openCard('test-card'); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => { if (!page) throw new Error('考試卡沒有開起來'); return page; };

  it.runIf(PANEL_FILLS_WINDOW)('驗收 5:面板撐滿視窗(0,0,360,480),整頁不捲,四邊黑線在視窗邊上', async () => {
    await p().reset();
    expect(await panelFillProblems(p())).toEqual([]);
  }, 60_000);

  it('驗收 7:第一題(填空)的「送出」整顆在視窗與捲動區看得到的範圍裡,不用捲動,沒被蓋住', async () => {
    await p().reset();
    expect(await submitVisibleProblems(p())).toEqual([]);
  }, 60_000);

  it('驗收 2:送出鍵只在題目顯示中出現,看到結果後只剩「下一題」', async () => {
    await p().reset();
    expect(await submitLifecycleProblems(p())).toEqual([]);
  }, 60_000);

  it('驗收 2:填好在輸入框按 Enter 照舊能送出(鍵盤路徑不動)', async () => {
    await p().reset();
    expect(await enterKeyProblems(p())).toEqual([]);
  }, 60_000);

  it('驗收 3:HP 條剛載入是 0 / 3,答完一題長到 1/3(data-percent、畫出來的綠色那一段、「1 / 3」那行字)', async () => {
    await p().reset();
    expect(await hpBarProblems(p())).toEqual([]);
  }, 90_000);

  it('驗收 2:對錯不只靠顏色:剛好「✓ 答對了」與「× 答錯了」,兩者不同;兩個顏色換成同一色字樣不變', async () => {
    expect(await resultTextProblems(p())).toEqual([]);
  }, 90_000);

  it('驗收 2:還沒送出之前沒有 data-result 元素', async () => {
    await p().reset();
    expect(await noResultBeforeSubmitProblems(p())).toEqual([]);
  }, 60_000);
});
