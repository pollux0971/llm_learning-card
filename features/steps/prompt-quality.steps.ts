/**
 * features/12-prompt-quality/phase-1.feature 的步驟定義。
 * 邏輯全部在 packages/core/src/prompt-quality/,這裡只是薄薄的轉接。
 *
 * this.llmCalls 只用來記錄「會真的碰模型/網路」的呼叫(見 _world.ts 的用途註解:
 * 斷言「沒有呼叫模型」)。fake 模式下 FakeLlmRouter 讀的是本機 fixture,不是模型,
 * 所以不推進 this.llmCalls——這樣「no network request is made」這句通用斷言
 * (見 common.steps.ts)在這裡才會通過,同時不影響「outputs come from the recorded
 * fixtures」的驗證(那句直接看指令輸出)。
 */
import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { ROOT, runGolden, MissingGoldenSetError, type RunGoldenOptions } from '../../packages/core/src/prompt-quality/golden-run.js';
import { compareRuns, NotComparableError } from '../../packages/core/src/prompt-quality/compare.js';
import { runStructuralChecks } from '../../packages/core/src/prompt-quality/structural-checks.js';
import { parseScoresSheet } from '../../packages/core/src/prompt-quality/scores.js';
import { getGoldenSet } from '../../packages/core/src/prompt-quality/golden-sets/registry.js';
import { SCORE_DIMENSIONS, type GoldenRunResult, type GoldenSetId, type StructuralCheckResult, type CompareResult } from '../../packages/core/src/prompt-quality/types.js';

interface PqState {
  tmpDirs: string[];
  demoSet: GoldenSetId;
  goldenResult?: GoldenRunResult;
  runDirA?: string;
  runDirB?: string;
  compareResult?: CompareResult;
  structuralResult?: StructuralCheckResult;
  recordedOutput?: string;
  missingSetError?: Error;
  notComparableError?: Error;
}

let pq: PqState;

Before(function () {
  pq = { tmpDirs: [], demoSet: 'selftest' };
});

After(function () {
  for (const dir of pq.tmpDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function newTmpBaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pq-accept-'));
  pq.tmpDirs.push(dir);
  return dir;
}

async function performGoldenRun(world: LearningWorld, opts: Partial<RunGoldenOptions> = {}): Promise<GoldenRunResult> {
  return runGolden({
    set: pq.demoSet,
    today: opts.today ?? world.today,
    baseDir: opts.baseDir ?? newTmpBaseDir(),
  });
}

// ---------------------------------------------------------------- Given

Given('a task with three golden inputs', function () {
  pq.demoSet = 'selftest'; // 內建 demo golden set,固定 3 個輸入
});

Given('a task with no golden inputs defined', function () {
  pq.demoSet = 'not-registered' as GoldenSetId; // registry.ts 沒有登記這一組
});

Given('two golden runs exist for the same task', async function (this: LearningWorld) {
  const baseDir = newTmpBaseDir();
  const runA = await runGolden({ set: pq.demoSet, today: '2026-09-10', baseDir });
  const runB = await runGolden({ set: pq.demoSet, today: '2026-09-11', baseDir });
  pq.runDirA = runA.dir;
  pq.runDirB = runB.dir;
});

const STRUCTURAL_FIXTURES: Record<string, string> = {
  'a card body exceeds the word limit': JSON.stringify([{ title: '超長卡', body: '同'.repeat(101), examples: [] }]),
  'the response is not valid JSON': '這不是 JSON,忘了收尾的大括號 {',
  'a rubric has fewer than two criteria': JSON.stringify({ prompt: '說明同源政策', rubric: ['只有一條'] }),
  'a rubric has more than four criteria': JSON.stringify({ prompt: '說明同源政策', rubric: ['a', 'b', 'c', 'd', 'e'] }),
  'the blank count does not match the answers': JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定']] }),
  'a required field is missing': JSON.stringify([{ body: '沒有標題的卡片內容' }]),
};

for (const [problem, output] of Object.entries(STRUCTURAL_FIXTURES)) {
  Given(`a recorded output where ${problem}`, function () {
    pq.recordedOutput = output;
  });
}

Given('a recorded output that is structurally perfect but says something wrong', function () {
  pq.recordedOutput = JSON.stringify([
    { title: '同源政策', body: '同源政策其實跟安全完全無關,這句話是錯的,但格式完全正確。', examples: [] },
  ]);
});

// ---------------------------------------------------------------- When

When('the standalone prompt check command is run in fake mode', function (this: LearningWorld) {
  this.runStandalone();
});

When('the command is run in fake mode', function (this: LearningWorld) {
  this.runStandalone();
});

When('a golden run is performed', async function (this: LearningWorld) {
  pq.goldenResult = await performGoldenRun(this);
});

When('the structural checks run', function () {
  assert.ok(pq.recordedOutput, 'Given 步驟要先設定 recordedOutput');
  pq.structuralResult = runStructuralChecks(pq.recordedOutput);
});

When('they are compared', function () {
  assert.ok(pq.runDirA && pq.runDirB, 'Given 步驟要先建立兩次 run');
  pq.compareResult = compareRuns(pq.runDirA!, pq.runDirB!);
});

When('a comparison is attempted across two different tasks', async function () {
  const baseDir = newTmpBaseDir();
  const runA = await runGolden({ set: 'selftest', today: '2026-09-10', baseDir });

  const dirB = join(baseDir, 'ingest.cards', '2026-09-10');
  mkdirSync(dirB, { recursive: true });
  writeFileSync(
    join(dirB, 'meta.json'),
    JSON.stringify({ set: 'ingest.cards', task: 'ingest.cards', date: '2026-09-10', model: 'm', provider: 'fake', promptFileGitCommit: 'x', mode: 'fake' }),
  );

  try {
    compareRuns(runA.dir, dirB);
  } catch (e) {
    pq.notComparableError = e as Error;
  }
});

When('a golden run is attempted', async function () {
  try {
    await runGolden({ set: pq.demoSet, baseDir: newTmpBaseDir() });
  } catch (e) {
    pq.missingSetError = e as Error;
  }
});

// ---------------------------------------------------------------- Then

Then('it reports how many golden inputs were processed', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過任何指令');
  assert.match(this.lastRun.output, /\d+ 個 golden 輸入/, this.lastRun.output);
});

Then('the outputs come from the recorded fixtures', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過任何指令');
  assert.equal(this.lastRun.status, 0, this.lastRun.output);
  assert.doesNotMatch(this.lastRun.output, /FixtureNotFoundError/);
});

Then('a dated directory is created for that task', function () {
  assert.ok(pq.goldenResult);
  assert.ok(existsSync(pq.goldenResult.dir), pq.goldenResult.dir);
  assert.match(pq.goldenResult.dir, /\d{4}-\d{2}-\d{2}$/);
});

Then('it contains one output file per input', function () {
  assert.ok(pq.goldenResult);
  const files = readdirSync(pq.goldenResult.dir).filter((f) => f.endsWith('.output.json'));
  assert.equal(files.length, pq.goldenResult.outputs.length);
  assert.ok(files.length > 0);
});

Then('it contains the prompt file as it was at that moment', function () {
  assert.ok(pq.goldenResult);
  const set = getGoldenSet(pq.demoSet);
  assert.ok(set);
  const original = readFileSync(join(ROOT, set.promptFile), 'utf8');
  const snapshot = readFileSync(join(pq.goldenResult.dir, 'prompt.snapshot.md'), 'utf8');
  assert.equal(snapshot, original);
});

Then('the run records the model name, the provider and the date', function () {
  assert.ok(pq.goldenResult);
  assert.ok(pq.goldenResult.meta.model);
  assert.ok(pq.goldenResult.meta.provider);
  assert.ok(pq.goldenResult.meta.date);
});

Then('it records the git commit of the prompt file', function () {
  assert.ok(pq.goldenResult);
  assert.ok(pq.goldenResult.meta.promptFileGitCommit);
});

Then('the problem is reported', function () {
  assert.ok(pq.structuralResult);
  assert.ok(pq.structuralResult.issues.length > 0, JSON.stringify(pq.structuralResult));
});

Then('no problem is reported', function () {
  assert.ok(pq.structuralResult);
  assert.deepEqual(pq.structuralResult.issues, []);
});

Then('the run notes that quality requires human scoring', function () {
  assert.ok(pq.structuralResult);
  assert.ok(pq.structuralResult.note.length > 0);
});

Then('a scoring file is written in the run directory', function () {
  assert.ok(pq.goldenResult);
  assert.ok(existsSync(join(pq.goldenResult.dir, 'SCORES.md')));
});

Then('it lists each input with empty score fields', function () {
  assert.ok(pq.goldenResult);
  const content = readFileSync(join(pq.goldenResult.dir, 'SCORES.md'), 'utf8');
  for (const o of pq.goldenResult.outputs) assert.ok(content.includes(o.id));
  assert.deepEqual(parseScoresSheet(content), {});
});

Then('it names the two scoring dimensions', function () {
  assert.ok(pq.goldenResult);
  const content = readFileSync(join(pq.goldenResult.dir, 'SCORES.md'), 'utf8');
  for (const dim of SCORE_DIMENSIONS) assert.ok(content.includes(dim));
});

Then('each input is shown with both outputs', function () {
  assert.ok(pq.compareResult);
  assert.ok(pq.compareResult.items.length > 0);
  for (const item of pq.compareResult.items) {
    assert.notEqual(item.outputA, null);
    assert.notEqual(item.outputB, null);
  }
});

Then('differences are made visible without judging them', function () {
  assert.ok(pq.compareResult);
  for (const item of pq.compareResult.items) {
    assert.equal(typeof item.same, 'boolean');
  }
});

Then('the scores from each run are shown if they were filled in', function () {
  assert.ok(pq.compareResult);
  for (const item of pq.compareResult.items) {
    assert.ok('scoresA' in item);
    assert.ok('scoresB' in item);
  }
});

Then('it reports that the runs are not comparable', function () {
  assert.ok(pq.notComparableError instanceof NotComparableError, String(pq.notComparableError));
});

Then('it reports that the task has no golden set', function () {
  assert.ok(pq.missingSetError instanceof MissingGoldenSetError, String(pq.missingSetError));
});

Then('it names the file where the set should be defined', function () {
  assert.ok(pq.missingSetError);
  assert.match(pq.missingSetError.message, /registry\.ts/);
});
