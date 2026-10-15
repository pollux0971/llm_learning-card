/**
 * 10-desktop-shell phase-6(工單 T16)的外觀量測:標題列的縮小 / 關閉鈕、縮放把手、停用狀態、hover / focus 的框線顏色。
 * 測試 agent 寫;開發 worker 不改。檢查邏輯在 window-frame-test-support.ts,數值在 window-frame-design-values-test-support.ts。
 *
 * 展示頁勾「無框」與「假視窗按鈕」(瀏覽器裡沒有 Tauri,縮小、關閉鈕要靠這個開關才畫得出來)。
 * 每一種狀態都量:一般、hover、focus-visible、停用(標題列的按鈕沒有停用,縮放把手沒有 focus 與停用)。
 * 量法要分得開不透明與半透明(放大法)。hover / focus 不送滑鼠鍵盤,用 CDP 強制偽類。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openGallery, type GalleryPage } from './render-test-support.js';
import {
  buttonLineColourProblems, chipFaceProblems, chipLineColourProblems, chipOutlineProblems, chipShapeProblems, chipStateDistinctProblems,
  disabledProblems, fieldLineColourProblems, frameGalleryStaticProblems, openFrameGallery, resizeHandleProblems, seeThroughStateProblems,
} from './window-frame-test-support.js';

describe('展示頁的標記(驗收 8、9)', () => {
  it('有「假視窗按鈕」開關(checkbox),有停用的 HudButton 與停用的作答欄', () => {
    expect(frameGalleryStaticProblems()).toEqual([]);
  });
});

describe('展示頁勾「無框」與「假視窗按鈕」(驗收 5–8)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openGallery(); }, 90_000);
  afterAll(async () => { await page?.close(); });
  const p = () => { if (!page) throw new Error('展示頁沒有開起來'); return page; };

  it('勾了之後標題列有縮小與關閉鈕各一顆,縮放把手 8 個', async () => {
    expect(await openFrameGallery(p())).toEqual([]);
  }, 60_000);

  it('縮小 / 關閉鈕 一般:內部跟著 --hud-panel 走(放大法:半透明紅疊深色頁底,寫死的不透明白、灰、--hud-solid 都抓得到)', async () => {
    expect(await chipFaceProblems(p())).toEqual([]);
  }, 90_000);

  it('縮小 / 關閉鈕 一般、hover、focus-visible:切角外側 = 背景,外圍 2–4 像素沒有橘色(沒有方形 outline),貼邊的橘色還在,黑線 1 像素', async () => {
    expect(await chipShapeProblems(p())).toEqual([]);
  }, 150_000);

  it('縮小 / 關閉鈕 三種狀態的計算樣式 outline 是 none 或 0(HudButton 一起量)', async () => {
    expect(await chipOutlineProblems(p())).toEqual([]);
  }, 90_000);

  it('縮小 / 關閉鈕 hover、focus-visible、一般 兩兩差 ≥ 30 個像素(focus 跟 hover 分得出來)', async () => {
    expect(await chipStateDistinctProblems(p())).toEqual([]);
  }, 90_000);

  it('縮小 / 關閉鈕 hover、focus-visible 的框線:四條直邊正中間是飽和橘 (231,119,31) ±10,不是淡橘填色 (247,208,177)', async () => {
    expect(await chipLineColourProblems(p())).toEqual([]);
  }, 150_000);

  it('HudButton hover、focus-visible 的框線:四條直邊正中間是飽和橘 ±10', async () => {
    expect(await buttonLineColourProblems(p())).toEqual([]);
  }, 90_000);

  it('HudField focus 的框線:四條直邊正中間是飽和橘 ±10', async () => {
    expect(await fieldLineColourProblems(p())).toEqual([]);
  }, 90_000);

  it('hover / focus 下內部仍是半透明:縮小、關閉鈕、HudButton、HudField 換兩個頁底,內部顏色跟著變', async () => {
    expect(await seeThroughStateProblems(p())).toEqual([]);
  }, 150_000);

  it('縮放把手 hover:計算 background-color 透明、沒有填色,把手範圍裡 0 個橘色像素(四個角不會在切角裡畫橘色方塊)', async () => {
    expect(await resizeHandleProblems(p())).toEqual([]);
  }, 150_000);

  it('停用的 HudButton 與 HudField:排在現有元件後面、跟一般差 ≥ 30 像素、沒有橘色(滑鼠移上去也不變橘)、切角外側與外圍乾淨', async () => {
    expect(await disabledProblems(p())).toEqual([]);
  }, 150_000);
});
