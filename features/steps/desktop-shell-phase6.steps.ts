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
import { readFileSync } from 'node:fs';
import type { LearningWorld } from './_world.js';
import { openedWindows, type OpenedWindow } from './_phase6-window.js';
import { readTauriConf, type TauriConf } from '../../apps/desktop/src/test-support/frontend-dist.js';
import {
  EMIT_TIMEOUT_MS, REQUIRED_PERMISSIONS, capabilityProblems, decorationsProblems, layoutClassNames, readCapability, runInitScript,
  rustInitScript, rustStartupOrder, rustSurface, transparencyLeftToAppProblems, type StartupOrderEmit,
  MAIN_RS, actionExecutorProblems, rustFnBody, stripRustComments,
} from '../../apps/desktop/src/test-support/window-frame.js';

interface Phase6State { conf?: TauriConf; capability?: ReturnType<typeof readCapability>; composited?: boolean; windowsOpening?: boolean; teachNotShown?: boolean; onlyTest?: boolean; order?: StartupOrderEmit }
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
Then('the configuration leaves transparency to the app', function (this: LearningWorld) {
  const conf = st(this).conf;
  assert.ok(conf, '還沒讀 tauri.conf.json');
  none(transparencyLeftToAppProblems(conf));
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
    return { composited, classes: run.classes, touched: run.touched, surface: rustSurface(composited), ...(run.threw === undefined ? {} : { threw: run.threw }) };
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

Then(/^the window (is|is not) transparent$/, function (this: LearningWorld, is: string) {
  const opened = openedWindows.get(this);
  assert.ok(opened && opened.length > 0, '還沒打開視窗(少了 When a window opens)');
  for (const w of opened) {
    assert.ok(w.surface, 'Rust 沒有回 surface_for 的結果');
    assert.equal(w.surface.transparent, is === 'is', `桌面${w.composited ? '能' : '不能'}畫透明時,視窗${is === 'is' ? '要' : '不能'}透明;Rust 的 surface_for 回 transparent=${w.surface.transparent}`);
  }
});

Then(/^the window background is (left clear|the solid fallback colour)$/, function (this: LearningWorld, what: string) {
  const opened = openedWindows.get(this);
  assert.ok(opened && opened.length > 0, '還沒打開視窗(少了 When a window opens)');
  for (const w of opened) {
    assert.ok(w.surface, 'Rust 沒有回 surface_for 的結果');
    if (what === 'left clear') {
      assert.equal(w.surface.background, null, `桌面能畫透明時不塗底色(切角才看得到桌面);實際 ${JSON.stringify(w.surface.background)}`);
    } else {
      assert.deepEqual(w.surface.background, w.surface.solidBackground, '沒有合成器時底色是 SOLID_BACKGROUND');
      assert.equal(w.surface.background?.[3], 255, '底色的 alpha 是 255(不透明)');
    }
  }
});

// ---------------------------------------------------------------- 啟動順序:教學卡先、考試卡後(T21 第 3 輪)
/** 把 Rust 回的動作依事件順序攤平成一串 */
const flatten = (order: StartupOrderEmit) => order.steps.flatMap((step) => step.actions);

Given('the card windows are opening', function (this: LearningWorld) {
  st(this).windowsOpening = true;
});

Given('the teach card has not been shown', function (this: LearningWorld) {
  st(this).teachNotShown = true;
});

Given('only the test card window is opening', function (this: LearningWorld) {
  st(this).windowsOpening = true;
  st(this).onlyTest = true;
});

When(/^the (teach|test) window is ready first and the other one after it$/, { timeout: EMIT_TIMEOUT_MS + 30_000 }, function (this: LearningWorld, first: string) {
  assert.ok(st(this).windowsOpening, '少了 Given the card windows are opening');
  st(this).order = rustStartupOrder(first === 'teach' ? 'ready-teach-first' : 'ready-test-first');
});

When('the backstop time has passed', { timeout: EMIT_TIMEOUT_MS + 30_000 }, function (this: LearningWorld) {
  assert.ok(st(this).teachNotShown, '少了 Given the teach card has not been shown');
  st(this).order = rustStartupOrder('backstop');
});

When('it is ready', { timeout: EMIT_TIMEOUT_MS + 30_000 }, function (this: LearningWorld) {
  assert.ok(st(this).onlyTest, '少了 Given only the test card window is opening');
  st(this).order = rustStartupOrder('single-test');
});

Then('the teach card is shown before the test card', function (this: LearningWorld) {
  const order = st(this).order;
  assert.ok(order, '還沒有事件(少了 When … is ready first …)');
  const actions = flatten(order);
  const teach = actions.indexOf('Show(teach)');
  const test = actions.indexOf('Show(test)');
  assert.ok(teach >= 0, `教學卡沒有被顯示:${JSON.stringify(actions)}`);
  assert.ok(test >= 0, `考試卡沒有被顯示:${JSON.stringify(actions)}`);
  assert.ok(teach < test, `教學卡要先於考試卡顯示:${JSON.stringify(actions)}`);
  assert.equal(actions.filter((a) => a.startsWith('Show(')).length, 2, '每個視窗只顯示一次');
});

Then('the keyboard focus is given to the test card right after it is shown', function (this: LearningWorld) {
  const order = st(this).order;
  assert.ok(order, '還沒有事件');
  const actions = flatten(order);
  const test = actions.indexOf('Show(test)');
  assert.ok(test >= 0, `考試卡沒有被顯示:${JSON.stringify(actions)}`);
  assert.equal(actions[test + 1], 'Focus(test)', `Focus(test) 要緊接在 Show(test) 之後:${JSON.stringify(actions)}`);
  assert.equal(actions.filter((a) => a.startsWith('Focus(')).length, 1, `焦點只給一次、只給考試卡:${JSON.stringify(actions)}`);
});

Then('the test card is shown anyway', function (this: LearningWorld) {
  const order = st(this).order;
  assert.ok(order, '還沒有事件');
  assert.deepEqual(flatten(order), ['Show(test)', 'Focus(test)'], '教學卡一直沒顯示:退路讓考試卡照樣顯示並拿焦點');
});

Then('a warning says the test card was shown before the teach card', function () {
  // 警告是 main.rs 的事(Rust 純函式不寫 log):靜態看接線,回傳不是空的才 warn。
  const mainRs = stripRustComments(readFileSync(MAIN_RS, 'utf8'));
  const at = mainRs.search(/\bon_backstop\s*\(/);
  assert.ok(at >= 0, 'main.rs 沒有呼叫 on_backstop()');
  const region = mainRs.slice(Math.max(0, at - 300), at + 700);
  const empty = region.indexOf('is_empty');
  const warn = region.search(/log\s*::\s*warn\s*!/);
  assert.ok(empty >= 0 && warn > empty, 'on_backstop() 回傳不是空的時,要在 is_empty 判斷之後 log::warn!(考試卡在教學卡之前被顯示)');
  const [problems] = actionExecutorProblems(mainRs);
  none(problems);
  assert.ok(rustFnBody(mainRs, 'open_windows'), 'main.rs 找不到 open_windows');
});

Then('it is shown at once and gets the keyboard focus', function (this: LearningWorld) {
  const order = st(this).order;
  assert.ok(order, '還沒有事件');
  assert.deepEqual(flatten(order), ['Show(test)', 'Focus(test)'], '只開考試卡時不等教學卡');
});
