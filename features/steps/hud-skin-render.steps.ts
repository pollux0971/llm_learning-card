/**
 * 14-hud-skin phase-1 修補(工單 T14)的步驟定義:headless Chrome 畫展示頁,量像素與計算樣式。
 * 規格作者(UI/Tauri 負責人)寫;開發 worker 不改。
 *
 * 檢查邏輯都在 packages/ui-shared/src/hud/render-test-support.ts(vitest 的 render.test.ts 跑同一份),這裡只接句子。
 * 展示頁(vite dev server)與 headless Chrome 整個 cucumber 行程只開一次(第一次用到時),AfterAll 收掉;
 * 每一項檢查開始時自己會重新載入展示頁,場景之間不互相影響。
 */
import { AfterAll, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import {
  CAP_TO_CJK, capHeightProblems, darkBackdropProblems, focusDistinctProblems, frameLineProblems, galleryOnlyProblems, openGallery,
  panelSeeThroughProblems, rootBackgroundProblems, sizeAdjustProblems, type GalleryPage,
} from '../../packages/ui-shared/src/hud/render-test-support.js';

let shared: Promise<GalleryPage> | undefined;
function gallery(): Promise<GalleryPage> {
  shared ??= openGallery();
  return shared;
}
AfterAll({ timeout: 30_000 }, async () => {
  if (!shared) return;
  try { await (await shared).close(); } catch { /* 開不起來的那次已經在場景裡報過 */ }
});

interface RenderState { page?: GalleryPage; latinOnlyThird: boolean; darkBackdrop: boolean; rootProblems?: string[] }
const states = new WeakMap<LearningWorld, RenderState>();
function st(w: LearningWorld): RenderState {
  let s = states.get(w);
  if (!s) { s = { latinOnlyThird: false, darkBackdrop: false }; states.set(w, s); }
  return s;
}
function pageOf(w: LearningWorld): GalleryPage {
  const p = st(w).page;
  if (!p) throw new Error('展示頁還沒畫(少了 When the gallery is drawn in a headless browser)');
  return p;
}
const none = (problems: string[]) => assert.deepEqual(problems, [], problems.join('\n'));

Given('the third gallery button is labelled with Latin letters only', function (this: LearningWorld) {
  st(this).latinOnlyThird = true;
});

Given('the gallery backdrop is switched to dark', function (this: LearningWorld) {
  // 每項檢查都會重新載入展示頁,所以這裡只記下來;量的時候才去勾 data-gallery="dark-backdrop"
  st(this).darkBackdrop = true;
});

When('the gallery is drawn in a headless browser', { timeout: 90_000 }, async function (this: LearningWorld) {
  st(this).page = await gallery();
});

When('the HUD stylesheet rules for the page root are read', function (this: LearningWorld) {
  st(this).rootProblems = rootBackgroundProblems();
});

Then('every sampled pixel in the panel padding equals the panel colour laid over the pixel behind it', { timeout: 60_000 },
  async function (this: LearningWorld) {
    none(await panelSeeThroughProblems(pageOf(this), { darkBackdrop: st(this).darkBackdrop }));
  });

Then('the page behind the panel is dark and carries a high contrast pattern', { timeout: 60_000 }, async function (this: LearningWorld) {
  assert.ok(st(this).darkBackdrop, '這一步要先切到深色背景');
  none(await darkBackdropProblems(pageOf(this)));
});

Then('the shared stylesheet says nothing about the gallery', function (this: LearningWorld) {
  none(galleryOnlyProblems());
});

Then('each straight edge of the panel and of every button is one pixel wide', { timeout: 60_000 }, async function (this: LearningWorld) {
  const problems = await frameLineProblems(pageOf(this), { latinOnlyThird: st(this).latinOnlyThird });
  none(problems.filter((p) => !p.includes('切角')));
});

Then('each cut corner of the panel still has its thin line', { timeout: 60_000 }, async function (this: LearningWorld) {
  const problems = await frameLineProblems(pageOf(this), { latinOnlyThird: st(this).latinOnlyThird });
  none(problems.filter((p) => p.includes('切角')));
});

Then('the focused second button differs in pixels from both the hovered and the normal one', { timeout: 60_000 },
  async function (this: LearningWorld) {
    none((await focusDistinctProblems(pageOf(this))).filter((p) => !p.includes('計算樣式')));
  });

Then('its computed style differs from the hovered one', { timeout: 60_000 }, async function (this: LearningWorld) {
  none((await focusDistinctProblems(pageOf(this))).filter((p) => p.includes('計算樣式')));
});

Then('none of them sets a background, except under the solid class', function (this: LearningWorld) {
  const problems = st(this).rootProblems;
  assert.ok(problems, '還沒讀 hud.css');
  none(problems);
});

Then('a Latin capital in the display font is between {float} and {float} of the height of a Chinese character', { timeout: 60_000 },
  async function (this: LearningWorld, low: number, high: number) {
    assert.deepEqual([low, high], [...CAP_TO_CJK], `場景寫的範圍跟 render-test-support.ts 的 CAP_TO_CJK 不一樣`);
    none(await capHeightProblems(pageOf(this)));
  });

Then('the Rajdhani font face declares a size adjustment above {int} percent', function (this: LearningWorld, percent: number) {
  assert.equal(percent, 100);
  none(sizeAdjustProblems());
});
