/**
 * 05-grading / phase-1:填空三層審核。phase-2(@phase-2 tag):應用題 rubric
 * 逐條審核(見檔案下半的 apply* 系列)。
 *
 * 大部分 scenario 只用 Given 佈置狀態,實際審核在第一個需要結果的 Then 才觸發
 * (ensureGraded/ensureApplyGraded 做快取,同一個 scenario 內重複呼叫不會重複跑
 * 或重複呼叫模型)。「the answer passes」「the answer fails」「the grader is
 * recorded as {}」三句 phase-1、phase-2 共用同一個 Then 定義——用
 * `this.tags`(Before hook 從 pickle 填的 feature/scenario tags)判斷要跑
 * 填空還是應用題那條路,不新增第二個同文字的定義(cucumber 不允許同一句話
 * 有兩個定義,會報 ambiguous step)。
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
import {
  APPLY_FEEDBACK_WORD_LIMIT,
  buildApplyPrompt,
  gradeApply,
  type ApplyGradeResult,
  type ApplyQuestion,
} from '../../packages/core/src/grading/grade-apply.js';
import { countWords } from '@core/schema/word-count.js';
import type { LogEvent } from '@contracts/index.js';

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

// ==================================================================
// phase-2:應用題 rubric 逐條審核
// ==================================================================

interface ApplyState {
  question: ApplyQuestion;
  answer: string;
  router: LlmRouter;
  result?: ApplyGradeResult;
  logEvents: LogEvent[];
}

const applyStates = new WeakMap<LearningWorld, ApplyState>();

/** 跟 FEATURE.md 單獨執行範例(scripts/grade.ts --apply)同一份題目與 CORS 答案,方便對照。 */
const DEFAULT_APPLY_QUESTION: ApplyQuestion = {
  prompt: '前端跨來源呼叫 API 會遇到什麼問題?',
  rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許跨來源標頭', '有提出至少一個解法'],
};

function applyStateOf(world: LearningWorld): ApplyState {
  let s = applyStates.get(world);
  if (!s) {
    s = {
      question: DEFAULT_APPLY_QUESTION,
      // 預設答案命中 contracts/fixtures/llm/grade.apply.pass.json(prompt_contains: "CORS")。
      answer: '這是跨來源請求,後端要加 CORS header',
      router: new FakeLlmRouter(loadFixturesFromDir(FIXTURES_DIR), (call) => world.llmCalls.push(call)),
      logEvents: [],
    };
    applyStates.set(world, s);
  }
  return s;
}

async function ensureApplyGraded(world: LearningWorld): Promise<ApplyGradeResult> {
  const s = applyStateOf(world);
  if (!s.result) {
    s.result = await gradeApply(s.question, s.answer, s.router, { logAppender: (event) => s.logEvents.push(event) });
    world.lastResult = s.result;
  }
  return s.result;
}

/** phase-2.feature 的 scenario 都掛 @phase-2(見 feature 檔第一行的 feature-level tag)。 */
function isApplyScenario(world: LearningWorld): boolean {
  return world.tags.includes('@phase-2');
}

/**
 * 「the answer passes」「the answer fails」「the grader is recorded as {}」是
 * phase-1、phase-2 共用的句子,依 tag 分派到對應的 ensure 函式。回傳型別刻意
 * 只取兩邊都有的欄位(pass/feedback/grader),criteria 只有應用題有。
 */
async function ensureGradedAny(world: LearningWorld): Promise<{ pass: boolean | null; feedback: string; grader: string; criteria?: boolean[] }> {
  return isApplyScenario(world) ? ensureApplyGraded(world) : ensureGraded(world);
}

function splitAnswerList(raw: string): string[] {
  return raw
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 填空(五個值,型別 Grader)跟應用題(cloud/local-provisional/error,見
 * grade-apply.ts 的 ApplyGrader)共用「the grader is recorded as {}」這句 Then——
 * 兩邊都不改對方的 Grader 型別(理由見 ../../packages/core/src/grading/grade-apply.ts
 * 開頭的說明),所以這裡放寬成 string,兩邊的字面值都收得進來。
 */
const GRADER_WORDS: Record<string, string> = {
  exact: 'exact',
  fuzzy: 'fuzzy',
  'the local model': 'local-llm',
  'a strict fallback': 'fallback-strict',
  empty: 'empty',
  'the cloud': 'cloud',
  'an error': 'error',
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
  await ensureGradedAny(this);
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
  const result = await ensureGradedAny(this);
  assert.equal(result.pass, true, `期望通過,實際 ${JSON.stringify(result)}`);
});

Then('the answer fails', async function (this: LearningWorld) {
  const result = await ensureGradedAny(this);
  assert.equal(result.pass, false, `期望失敗,實際 ${JSON.stringify(result)}`);
});

Then('the question fails', async function (this: LearningWorld) {
  const result = await ensureGraded(this);
  assert.equal(result.pass, false, `期望整題失敗,實際 ${JSON.stringify(result)}`);
});

Then('the grader is recorded as {}', async function (this: LearningWorld, raw: string) {
  const expected = GRADER_WORDS[raw];
  assert.ok(expected, `不認得的 grader 描述:「${raw}」`);
  const result = await ensureGradedAny(this);
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

// ==================================================================
// phase-2:應用題 rubric 逐條審核
// ==================================================================

// ---------------------------------------------------------------- Given (Background)

Given('an apply question with three rubric criteria', function (this: LearningWorld) {
  // 純敘述:applyStateOf() 的預設題目本來就是三條 rubric,佈置由後面的 Given/When 決定要用哪個 fixture。
  assert.equal(applyStateOf(this).question.rubric.length, 3, '預設題目的 rubric 應該是三條');
});

Given('the network is available', function (this: LearningWorld) {
  // 純敘述:grader 是 'cloud' 還是 'local-provisional' 由 LlmResult.provisional 決定
  // (見 grade-apply.ts 的說明),不是由這句話本身佈置狀態;fixtures 一律 provisional:false。
});

// ---------------------------------------------------------------- Given (挑 fixture)

Given('the model returns all three criteria as met', function (this: LearningWorld) {
  applyStateOf(this).answer = '這是跨來源請求,後端要加 CORS header';
});

Given('the model returns the second criterion as unmet', function (this: LearningWorld) {
  // 命中 grade.apply.fail.json:criteria=[false,false,true],第二條(index 1)未達成。
  applyStateOf(this).answer = '重開瀏覽器應該就會恢復正常';
});

Given('the model returns sixty words of feedback', function (this: LearningWorld) {
  applyStateOf(this).answer = 'LONG_FEEDBACK_TEST';
});

Given('the model returns something that is not JSON on the first attempt', function (this: LearningWorld) {
  applyStateOf(this).answer = 'MALFORMED_TEST';
});

Given('valid JSON on the second', function (this: LearningWorld) {
  // 純敘述:grade.apply.malformed.a2.json 已經備好第二次呼叫的合法回應。
});

Given('the model returns something unparseable twice', function (this: LearningWorld) {
  applyStateOf(this).answer = 'DOUBLE_MALFORMED_TEST';
});

Given('the rubric has three criteria', function (this: LearningWorld) {
  // 純敘述,同 Background 的「an apply question with three rubric criteria」。
});

Given('the model returns two verdicts', function (this: LearningWorld) {
  applyStateOf(this).answer = 'COUNT_MISMATCH_TEST';
});

// ---------------------------------------------------------------- When

When('an answer is submitted', function (this: LearningWorld) {
  // 預設答案已經是這句話要的「一個正常的回答」,這裡顯式設一次方便閱讀。
  applyStateOf(this).answer = '這是跨來源請求,後端要加 CORS header';
});

When('the person submits only whitespace', function (this: LearningWorld) {
  applyStateOf(this).answer = '   \n\t  ';
});

When('any apply question is graded', async function (this: LearningWorld) {
  await ensureApplyGraded(this);
});

// ---------------------------------------------------------------- Then

Then('a model call is made for the apply grading task', async function (this: LearningWorld) {
  await ensureApplyGraded(this);
  const call = this.llmCalls.find((c) => c.task === 'grade.apply');
  assert.ok(call, `沒有找到 grade.apply 的呼叫:${JSON.stringify(this.llmCalls)}`);
});

Then('the prompt contains the question, every rubric line and the answer', async function (this: LearningWorld) {
  await ensureApplyGraded(this);
  const s = applyStateOf(this);
  const call = this.llmCalls.find((c) => c.task === 'grade.apply');
  assert.ok(call, '沒有模型呼叫可以檢查 prompt');
  assert.equal(call!.prompt, buildApplyPrompt(s.question, s.answer), 'prompt 應該就是 buildApplyPrompt() 的輸出');
});

Then('the response is required to be JSON with one verdict per criterion', async function (this: LearningWorld) {
  const result = await ensureApplyGraded(this);
  const s = applyStateOf(this);
  assert.ok(result.criteria, '成功的回應應該帶 criteria');
  assert.equal(result.criteria!.length, s.question.rubric.length, 'criteria 數量應該等於 rubric 數量');
});

Then('the feedback refers to the second criterion', async function (this: LearningWorld) {
  const result = await ensureApplyGraded(this);
  // feedback 是模型的自由文字,不逐字比對中文措辭;結構上檢查第二條(index 1)確實被判為未達成,
  // 這才是「refers to」這句話要驗的東西。
  assert.ok(result.criteria, '失敗的回應也應該帶 criteria');
  assert.equal(result.criteria![1], false, `第二條 rubric 應該是 false,實際 ${JSON.stringify(result.criteria)}`);
});

Then('the feedback is truncated to the contract limit', async function (this: LearningWorld) {
  const result = await ensureApplyGraded(this);
  assert.ok(countWords(result.feedback) <= APPLY_FEEDBACK_WORD_LIMIT, `feedback 應該 <= ${APPLY_FEEDBACK_WORD_LIMIT} 字,實際 ${countWords(result.feedback)} 字:「${result.feedback}」`);
});

Then('the truncation is logged', async function (this: LearningWorld) {
  await ensureApplyGraded(this);
  const s = applyStateOf(this);
  const hit = s.logEvents.some((e) => e.type === 'warning' && e['task'] === 'grade.apply' && e['reason'] === 'feedback_truncated');
  assert.ok(hit, `沒有找到 feedback_truncated 的 warning 事件:${JSON.stringify(s.logEvents)}`);
});

Then('the second response is used', async function (this: LearningWorld) {
  const result = await ensureApplyGraded(this);
  // grade.apply.malformed.a2.json 是第二次呼叫的合法回應,feedback 是它的固定內容。
  assert.equal(result.feedback, '第二點沒提到。', `應該用第二次回應的內容,實際 ${JSON.stringify(result)}`);
});

Then('one retry is logged', async function (this: LearningWorld) {
  await ensureApplyGraded(this);
  const s = applyStateOf(this);
  const retries = s.logEvents.filter((e) => e.type === 'warning' && e['task'] === 'grade.apply' && e['reason'] === 'invalid_response_retry');
  assert.equal(retries.length, 1, `應該剛好記錄一次重試,實際 ${retries.length} 次:${JSON.stringify(s.logEvents)}`);
});

Then('the pass value is null', async function (this: LearningWorld) {
  const result = await ensureApplyGraded(this);
  assert.equal(result.pass, null, `pass 應該是 null,實際 ${JSON.stringify(result.pass)}`);
});

Then('the caller must not advance or roll back the stage', async function (this: LearningWorld) {
  // 契約 §5:pass===null 只能發生在 grader==='error',呼叫端(04-scheduler)看到這個
  // 組合就不該推進或回退 stage。這裡驗的是「這個不變量成立」,推進/回退本身不是
  // gradeApply() 的職責,不在這個函式裡發生。
  const result = await ensureApplyGraded(this);
  assert.equal(result.grader, 'error');
  assert.equal(result.pass, null);
  assert.equal(result.criteria, undefined, 'grader===error 時不應該帶 criteria');
});

Then('the response is treated as invalid and retried', async function (this: LearningWorld) {
  await ensureApplyGraded(this);
  const applyCalls = this.llmCalls.filter((c) => c.task === 'grade.apply');
  assert.equal(applyCalls.length, 2, `verdict 數量不對應該觸發一次重試(共兩次呼叫),實際 ${applyCalls.length} 次`);
});

Then('the result contains pass, criteria, feedback and grader', async function (this: LearningWorld) {
  const result = await ensureApplyGraded(this);
  assert.ok(
    'pass' in result && 'criteria' in result && 'feedback' in result && 'grader' in result,
    `結果缺欄位:${JSON.stringify(result)}`,
  );
});
