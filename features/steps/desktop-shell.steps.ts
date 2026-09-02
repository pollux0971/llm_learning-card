/**
 * 10-desktop-shell / phase-1。
 *
 * 大部分場景是 @manual(要在真的桌面環境操作視窗),不寫步驟。
 * 視窗位置/大小跨重啟保留由 Rust 端的 tauri-plugin-window-state 負責,
 * 也是 @manual(人工重啟一次桌面 app 用眼睛看),不在這裡假造 TS 模型。
 *
 * 這裡只覆蓋唯一的非 @manual 場景:
 *   - session 類型偵測(純函式,直接呼叫 apps/desktop/src/session.ts)
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { detectSessionType, type SessionEnv, type SessionType } from '../../apps/desktop/src/session.js';

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
