/**
 * 10-desktop-shell / phase-1。
 *
 * 大部分場景是 @manual(要在真的桌面環境操作視窗),不寫步驟。
 * 這裡只覆蓋兩個非 @manual 的場景:
 *   - session 類型偵測(純函式,直接呼叫 apps/desktop/src/session.ts)
 *   - 視窗位置/大小持久化(呼叫 apps/desktop/src/window-state.ts 模擬存檔/重啟)
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { detectSessionType, type SessionEnv, type SessionType } from '../../apps/desktop/src/session.js';
import { saveWindowState, loadWindowState, type WindowStateMap } from '../../apps/desktop/src/window-state.js';

// ---------------------------------------------------------------- session detection

Given(
  /^the session type variable is (.*) and the display variable is (.*)$/,
  function (this: LearningWorld, session: string, display: string) {
    const env: SessionEnv = {
      sessionType: session.trim() || undefined,
      display: display.trim() || undefined,
    };
    this.lastResult = env;
  },
);

When('the session is detected', function (this: LearningWorld) {
  const env = this.lastResult as SessionEnv;
  this.resultText = detectSessionType(env);
});

Then('it is treated as {word}', function (this: LearningWorld, expected: SessionType) {
  assert.equal(this.resultText, expected);
});

// ---------------------------------------------------------------- window state persistence

When('both windows are moved and resized and the application is closed', async function (this: LearningWorld) {
  const dir = await mkdtemp(join(tmpdir(), 'lc-window-state-'));
  const file = join(dir, 'window-state.json');
  const moved: WindowStateMap = {
    teach: { x: 42, y: 7, width: 500, height: 600 },
    test: { x: 900, y: 300, width: 320, height: 400 },
  };
  await saveWindowState(file, moved);
  this.lastResult = { dir, file, moved };
});

Then('the window state is persisted', async function (this: LearningWorld) {
  const { file, moved } = this.lastResult as { dir: string; file: string; moved: WindowStateMap };
  const persisted = await loadWindowState(file);
  assert.deepEqual(persisted, moved, '關掉應用程式後,存檔內容應該跟移動/縮放後的視窗一致');
});

Then('starting again restores both to the same place and size', async function (this: LearningWorld) {
  const { dir, file, moved } = this.lastResult as { dir: string; file: string; moved: WindowStateMap };
  const restored = await loadWindowState(file);
  assert.deepEqual(restored, moved, '重新啟動應該讀回一樣的位置大小');
  await rm(dir, { recursive: true, force: true });
});
