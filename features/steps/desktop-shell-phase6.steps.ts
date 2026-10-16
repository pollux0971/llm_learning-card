/**
 * 10-desktop-shell / phase-6(工單 T16)的步驟定義。測試 agent 寫;開發 worker 不改。
 *
 * 檢查邏輯在 apps/desktop/src/test-support/window-frame.ts(vitest 的 window-frameless.test.ts 跑同一份)。
 * 場景 3 與 Scenario Outline:「視窗打開」= 用 Rust 真的組出來的 init script(cargo test 的 emit 測試),
 * 放進一個假的頁面根元素跑,再看根元素的 class。Given 沒說桌面能不能畫透明時,兩種都跑。
 * 只接 phase-6.feature 的非 @manual 場景;@manual 由前端用 tauri build 的產物在 Xvfb 裡拍。
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { openedWindows, type OpenedWindow } from './_phase6-window.js';
import { readTauriConf, type TauriConf } from '../../apps/desktop/src/test-support/frontend-dist.js';
import {
  EMIT_TIMEOUT_MS, REQUIRED_PERMISSIONS, capabilityProblems, decorationsProblems, layoutClassNames, readCapability, runInitScript,
  rustInitScript, transparentProblems,
} from '../../apps/desktop/src/test-support/window-frame.js';

interface Phase6State { conf?: TauriConf; capability?: ReturnType<typeof readCapability>; composited?: boolean }
const states = new WeakMap<LearningWorld, Phase6State>();
function st(w: LearningWorld): Phase6State {
  let s = states.get(w);
  if (!s) { s = {}; states.set(w, s); }
  return s;
}
const none = (problems: string[]) => assert.deepEqual(problems, [], problems.join('\n'));

// ---------------------------------------------------------------- 場景 1:視窗設定
When('the window configuration is read', function (this: LearningWorld) {
  st(this).conf = readTauriConf();
});
Then('both windows have the system decorations turned off', function (this: LearningWorld) {
  const conf = st(this).conf;
  assert.ok(conf, '還沒讀 tauri.conf.json');
  none(decorationsProblems(conf));
});
Then('both windows are transparent', function (this: LearningWorld) {
  const conf = st(this).conf;
  assert.ok(conf, '還沒讀 tauri.conf.json');
  none(transparentProblems(conf));
});

// ---------------------------------------------------------------- 場景 2:權限
When('the desktop capability file is read', function (this: LearningWorld) {
  st(this).capability = readCapability();
});
Then('it allows starting a drag, starting a resize, minimizing and closing', function (this: LearningWorld) {
  const cap = st(this).capability;
  assert.ok(cap, '還沒讀 capabilities/default.json');
  const got = Array.isArray(cap.permissions) ? (cap.permissions as string[]) : [];
  const four = ['core:window:allow-start-dragging', 'core:window:allow-start-resize-dragging', 'core:window:allow-minimize', 'core:window:allow-close'];
  none(four.filter((p) => !got.includes(p)).map((p) => `少了權限 ${p}`));
});
Then('it grants no other window operation beyond the defaults', function (this: LearningWorld) {
  const cap = st(this).capability;
  assert.ok(cap, '還沒讀 capabilities/default.json');
  assert.equal((REQUIRED_PERMISSIONS as readonly string[]).length, 6);
  none(capabilityProblems(cap));
});

// ---------------------------------------------------------------- 場景 3 與 Scenario Outline:頁面被告知的模式
Given(/^a desktop that (can|cannot) draw transparency$/, function (this: LearningWorld, can: string) {
  st(this).composited = can === 'can';
});

When('a window opens', { timeout: EMIT_TIMEOUT_MS + 30_000 }, function (this: LearningWorld) {
  const wanted = st(this).composited === undefined ? [true, false] : [st(this).composited!];
  const opened: OpenedWindow[] = wanted.map((composited) => {
    const run = runInitScript(rustInitScript(composited));
    return { composited, classes: run.classes, touched: run.touched, ...(run.threw === undefined ? {} : { threw: run.threw }) };
  });
  openedWindows.set(this, opened);
});

// 「Then the page root has the frameless class」跟 14 phase-1 的 Given 是同一句話,定義在 hud-skin.steps.ts(那邊在有視窗打開時做斷言)。

Then(/^the page root (has|does not have) the solid class$/, function (this: LearningWorld, has: string) {
  const opened = openedWindows.get(this);
  assert.ok(opened && opened.length > 0, '還沒打開視窗(少了 When a window opens)');
  const solid = layoutClassNames().solid;
  for (const w of opened) {
    assert.equal(w.threw, undefined, `頁面那段程式丟了錯:${w.threw}`);
    assert.equal(w.classes.includes(solid), has === 'has',
      `桌面${w.composited ? '能' : '不能'}畫透明時,根元素${has === 'has' ? '要有' : '不能有'} ${solid};實際 class:[${w.classes.join(', ')}]`);
  }
});
