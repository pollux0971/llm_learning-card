/**
 * 通用步驟:同一句話在兩個以上的 feature 資料夾出現,就只能在這裡定義一次
 * (cucumber 對重複定義直接報錯)。各功能的步驟檔負責把值填進 World,這裡只讀。
 *
 * 只有協調者改這個檔。worker 需要新的通用步驟,寫在自己 FEATURE.md 的「待協調」段。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';

// ---------------------------------------------------------------- Given

Given('a learning directory populated by the I1 pipeline', function (this: LearningWorld) {
  this.useFixture('learning-minimal');
});

// 04 寫 `today is 2026-09-10`,11 寫 `today is "2026-09-10"`,兩種都接
Given(/^today is "?(\d{4}-\d{2}-\d{2})"?$/, function (this: LearningWorld, date: string) {
  this.today = date;
});

// 02、12:各功能的 When 讀 this.useFakeRouter 決定要不要建自己的 FakeLlmRouter
Given('a fake router replaying the recorded fixtures', function (this: LearningWorld) {
  this.useFakeRouter = true;
  this.llmCalls = [];
  this.networkRequests = [];
});

// 01、07:載入原文,各功能用自己的 parser 處理 this.cardText
Given('a card with three example fences', function (this: LearningWorld) {
  this.cardText = this.readFixture('cards/valid-three-examples.md');
});

Given('a card with a body and no example fence', function (this: LearningWorld) {
  this.cardText = this.readFixture('cards/valid-no-example.md');
});

// ---------------------------------------------------------------- When

// 06、07 的 dev server:啟動、等 ready、關掉。Then 用「the server starts」
When('the standalone dev command is run', { timeout: 90_000 }, async function (this: LearningWorld) {
  await this.startDevServer();
});

// ---------------------------------------------------------------- Then

Then('it exits with status {int}', function (this: LearningWorld, code: number) {
  assert.ok(this.lastRun, '還沒有跑過任何指令(When 要呼叫 runStandalone / runCommand)');
  assert.equal(
    this.lastRun.status,
    code,
    `退出碼應為 ${code},實際 ${this.lastRun.status}\n${this.lastRun.output.trim().split('\n').slice(-15).join('\n')}`,
  );
});

Then('the server starts', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有啟動 dev server');
  assert.equal(this.lastRun.status, 0, `dev server 沒有在時限內 ready:\n${this.lastRun.output.slice(-800)}`);
});

// 03、05、02、12、06 各有一種說法,語意相同:沒有碰模型也沒有碰網路
for (const phrase of [
  'it makes no model call',
  'no model call is made',
  'no network request is made',
  'no network connection is attempted',
  'no network request leaves the machine',
]) {
  Then(phrase, function (this: LearningWorld) {
    assert.deepEqual(this.llmCalls, [], `不該有模型呼叫:${JSON.stringify(this.llmCalls)}`);
    assert.deepEqual(this.networkRequests, [], `不該有網路請求:${JSON.stringify(this.networkRequests)}`);
  });
}

// 04、08 的純函式檢查。When 要先 this.trackInput(input),再把回傳值放進 lastResult
Then('the original object is unchanged', function (this: LearningWorld) {
  assert.ok(this.inputSnapshot !== undefined, 'When 步驟要先呼叫 this.trackInput(input)');
  assert.equal(JSON.stringify(this.inputRef), this.inputSnapshot, '輸入物件被修改了');
});

Then('a new object is returned', function (this: LearningWorld) {
  assert.ok(this.inputRef !== undefined, 'When 步驟要先呼叫 this.trackInput(input)');
  assert.notStrictEqual(this.lastResult, this.inputRef, '回傳的是同一個物件,不是新物件');
  const r = this.lastResult as { review?: unknown } | null;
  if (r && typeof r === 'object' && 'review' in r) {
    assert.notStrictEqual(r.review, this.inputRef, 'outcome.review 是同一個物件,不是新物件');
  }
});

/**
 * 「the result is X」:01(a pass / a failure / <result>)、05(<output>)、08(<met>)都用這句。
 * 比對規則:
 *   1. 期望值是 pass/fail 類的字眼 → 取 lastResult 的布林(本身是布林,或物件的 ok/pass/valid/met/success 欄位)
 *   2. 否則用文字比對:先看 resultText,沒有就把原始值 String(),物件則 JSON.stringify()
 */
const PASS_WORDS = new Set(['a pass', 'pass', 'passes', 'valid', 'ok', 'met', 'true', 'yes']);
const FAIL_WORDS = new Set(['a failure', 'failure', 'fail', 'fails', 'invalid', 'not met', 'false', 'no']);
const BOOL_KEYS = ['ok', 'pass', 'valid', 'met', 'success'] as const;

Then('the result is {}', function (this: LearningWorld, expectedRaw: string) {
  const expected = expectedRaw.trim().replace(/^"(.*)"$/, '$1');
  const lower = expected.toLowerCase();
  const isPass = PASS_WORDS.has(lower);
  const isFail = FAIL_WORDS.has(lower);

  if (isPass || isFail) {
    const actual = booleanOf(this.lastResult);
    assert.notEqual(actual, undefined, `lastResult 沒有可判斷的布林(本身或 ${BOOL_KEYS.join('/')} 欄位):${JSON.stringify(this.lastResult)}`);
    assert.equal(actual, isPass, `期望 ${expected},實際 ${actual ? 'pass' : 'fail'};error=${this.lastError?.message ?? '無'}`);
    return;
  }

  const actualText =
    this.resultText ??
    (this.lastResult !== null && typeof this.lastResult === 'object'
      ? JSON.stringify(this.lastResult)
      : String(this.lastResult));
  assert.equal(actualText, expected);
});

function booleanOf(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v && typeof v === 'object') {
    for (const k of BOOL_KEYS) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'boolean') return x;
    }
  }
  return undefined;
}
