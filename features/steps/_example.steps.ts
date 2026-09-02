/**
 * 範例步驟定義。這個檔案的目的是示範模式,不是實際使用的步驟。
 * 寫第一個真的步驟時照這個結構,然後把這個檔刪掉或留著當參考。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';

// ---- Given:設定狀態,不斷言 ----

Given('a learning directory populated by the I1 pipeline', function (this: LearningWorld) {
  this.useFixture('learning-minimal');
});

Given('today is {string}', function (this: LearningWorld, date: string) {
  this.today = date;
});

// ---- When:做一件事,把結果放進 lastResult,把錯誤放進 lastError ----

When('the validator runs', async function (this: LearningWorld) {
  // 真實版本會 import packages/core 的 validateCard
  try {
    // this.lastResult = validateCard(this.read('cards/security/sec-0001.md'));
    this.lastResult = { ok: true, bodyCount: 47 };
  } catch (e) {
    this.lastError = e as Error;
  }
});

// ---- Then:只斷言,不做事 ----

Then('the result is a pass', function (this: LearningWorld) {
  assert.equal(this.lastError, undefined, `不該拋錯:${this.lastError?.message}`);
  assert.equal((this.lastResult as { ok: boolean }).ok, true);
});

Then('the reported body count is {int}', function (this: LearningWorld, n: number) {
  assert.equal((this.lastResult as { bodyCount: number }).bodyCount, n);
});

// ---- 斷言「沒有發生」的模式 ----

Then('no model call is made', function (this: LearningWorld) {
  assert.equal(this.llmCalls.length, 0, `不該呼叫模型,實際呼叫了 ${this.llmCalls.length} 次`);
});
