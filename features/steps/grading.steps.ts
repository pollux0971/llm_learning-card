/**
 * 05-grading / phase-1:填空三層審核。
 *
 * 大部分 scenario 只用 Given 佈置狀態,實際審核在第一個需要結果的 Then 才觸發
 * (ensureGraded 做快取,同一個 scenario 內重複呼叫不會重複跑或重複呼叫模型)。
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import type { LearningWorld } from './_world.js';
import { FakeLlmRouter, loadFixturesFromDir } from '../../packages/core/src/grading/fake-llm.js';
import { gradeFillBlank, gradeFillQuestion } from '../../packages/core/src/grading/grade-fill.js';
import { matchFuzzy } from '../../packages/core/src/grading/fuzzy.js';
import { normalize } from '../../packages/core/src/grading/normalize.js';
import type { FillQuestion, GradeResult, Grader, LlmRouter } from '../../packages/core/src/grading/types.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '../../contracts/fixtures/llm');

interface GradingState {
  accepted: string[];
  typed: string;
  question?: FillQuestion;
  blankAnswers?: string[];
  router: LlmRouter;
  result?: GradeResult;
}

const states = new WeakMap<LearningWorld, GradingState>();

function stateOf(world: LearningWorld): GradingState {
  let s = states.get(world);
  if (!s) {
    // 預設值刻意選得又長又不相似:確保沒特別佈置時,精確層與模糊層都不會命中,
    // 會一路走到第三層——這樣「還沒佈置就要用到模型」的 scenario 才測得到東西。
    s = {
      accepted: ['reference-phrase-xyz'],
      typed: 'completely-different-value',
      router: new FakeLlmRouter(loadFixturesFromDir(FIXTURES_DIR), (call) => world.llmCalls.push(call)),
    };
    states.set(world, s);
  }
  return s;
}

async function ensureGraded(world: LearningWorld): Promise<GradeResult> {
  const s = stateOf(world);
  if (!s.result) {
    s.result = s.question
      ? await gradeFillQuestion(s.question, s.blankAnswers ?? [], s.router)
      : await gradeFillBlank(s.accepted, s.typed, s.router);
    world.lastResult = s.result;
  }
  return s.result;
}

function splitAnswerList(raw: string): string[] {
  return raw
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const GRADER_WORDS: Record<string, Grader> = {
  exact: 'exact',
  fuzzy: 'fuzzy',
  'the local model': 'local-llm',
  'a strict fallback': 'fallback-strict',
  empty: 'empty',
};

// ---------------------------------------------------------------- Given

Given('the accepted answer is {}', function (this: LearningWorld, value: string) {
  stateOf(this).accepted = [value];
});

Given('the accepted answers are {}', function (this: LearningWorld, value: string) {
  stateOf(this).accepted = splitAnswerList(value);
});

Given('neither of the first two layers matched', function (this: LearningWorld) {
  // 純敘述,佈置由 accepted/typed 的實際值保證,不需要額外狀態
});

Given('no model is available', function (this: LearningWorld) {
  stateOf(this).router = new FakeLlmRouter([], (call) => this.llmCalls.push(call));
});

Given('the model replies that the answers mean the same', function (this: LearningWorld) {
  const s = stateOf(this);
  s.accepted = ['協定'];
  s.typed = '通訊協定';
});

Given('a question with three blanks', function (this: LearningWorld) {
  stateOf(this).question = {
    prompt: '同源的判定條件是 ___、___、___ 三者相同。',
    answers: [
      ['協定', 'protocol', 'scheme'],
      ['主機', 'host', 'domain'],
      ['埠號', 'port'],
    ],
  };
});

// ---------------------------------------------------------------- When

When(/^the person types (.+)$/, function (this: LearningWorld, raw: string) {
  const quoted = /^"(.*)"$/.exec(raw);
  stateOf(this).typed = quoted ? quoted[1]! : raw;
});

When('the person submits nothing', function (this: LearningWorld) {
  stateOf(this).typed = '';
});

When('it is normalised', function (this: LearningWorld) {
  this.resultText = normalize(stateOf(this).typed);
});

When('the third layer completes', async function (this: LearningWorld) {
  await ensureGraded(this);
});

When('grading completes', async function (this: LearningWorld) {
  await ensureGraded(this);
});

When('any fill question is graded', async function (this: LearningWorld) {
  await ensureGraded(this);
});

When('the first two answers are right and the third is wrong', async function (this: LearningWorld) {
  stateOf(this).blankAnswers = ['協定', 'host', 'nope'];
  await ensureGraded(this);
});

When('the standalone grade command is run with the fill flag against a fixture', function (this: LearningWorld) {
  this.runStandalone();
});

// ---------------------------------------------------------------- Then

Then('the answer passes', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.equal(result.pass, true, `期望通過,實際 ${JSON.stringify(result)}`);
});

Then('the answer fails', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.equal(result.pass, false, `期望失敗,實際 ${JSON.stringify(result)}`);
});

Then('the question fails', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.equal(result.pass, false, `期望整題失敗,實際 ${JSON.stringify(result)}`);
});

Then('the grader is recorded as {}', async function (this: LearningWorld, raw: string) {
  const expected = GRADER_WORDS[raw];
  assert.ok(expected, `不認得的 grader 描述:「${raw}」`);
  const result = await ensureGraded(this);
  assert.equal(result.grader, expected, `期望 grader=${expected},實際 ${result.grader}`);
});

Then('the feedback explains that no fuzzy judgement was possible', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.match(result.feedback, /沒有|模型/, `feedback 應該說明沒有模型可判斷:「${result.feedback}」`);
});

Then('the feedback names the third blank and gives its answer', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.match(result.feedback, /3/, `feedback 應該指出第三格:「${result.feedback}」`);
  assert.match(result.feedback, /埠號|port/, `feedback 應該給出正確答案:「${result.feedback}」`);
});

Then('the fuzzy layer is not used', function (this: LearningWorld) {
  const s = stateOf(this);
  const { used } = matchFuzzy(s.accepted.map(normalize), normalize(s.typed));
  assert.equal(used, false, '模糊層不該被用到');
});

Then('the fuzzy layer does not match', function (this: LearningWorld) {
  const s = stateOf(this);
  const { matched } = matchFuzzy(s.accepted.map(normalize), normalize(s.typed));
  assert.equal(matched, false, '模糊層不該命中');
});

Then('the third layer is reached', async function (this: LearningWorld) {
  await ensureGraded(this);
  assert.equal(this.llmCalls.length, 1, `第三層應該被嘗試呼叫一次,實際 ${this.llmCalls.length} 次`);
});

Then('a model call is made for the fill grading task', async function (this: LearningWorld) {
  await ensureGraded(this);
  const call = this.llmCalls.find((c) => c.task === 'grade.fill.llm');
  assert.ok(call, `沒有找到 grade.fill.llm 的呼叫:${JSON.stringify(this.llmCalls)}`);
});

Then('the prompt contains both the accepted answer and what the person typed', async function (this: LearningWorld) {
  await ensureGraded(this);
  const s = stateOf(this);
  const call = this.llmCalls.find((c) => c.task === 'grade.fill.llm');
  assert.ok(call, '沒有模型呼叫可以檢查 prompt');
  for (const answer of s.accepted) assert.ok(call!.prompt.includes(answer), `prompt 應包含標準答案「${answer}」`);
  assert.ok(call!.prompt.includes(s.typed), `prompt 應包含使用者輸入「${s.typed}」`);
});

Then('the result contains pass, feedback and grader', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.ok('pass' in result && 'feedback' in result && 'grader' in result, `結果缺欄位:${JSON.stringify(result)}`);
});

Then('the grader is one of the values allowed for fill grading', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  const allowed: Grader[] = ['exact', 'fuzzy', 'local-llm', 'fallback-strict', 'empty'];
  assert.ok(allowed.includes(result.grader), `grader「${result.grader}」不在允許值內`);
});

Then('it prints a result containing pass and grader', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過任何指令');
  assert.ok(this.lastRun.output.includes('pass'), `輸出應該含 pass:${this.lastRun.output}`);
  assert.ok(this.lastRun.output.includes('grader'), `輸出應該含 grader:${this.lastRun.output}`);
});
