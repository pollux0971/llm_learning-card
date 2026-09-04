/**
 * features/12-prompt-quality/phase-2.feature 的步驟定義。
 * 邏輯全部在 packages/core/src/prompt-quality/,這裡只是薄薄的轉接
 * (跟 prompt-quality.steps.ts 同一個模式,但狀態各自獨立)。
 *
 * live 的場景**不打真 API**:只在最外層的網路邊界(globalThis.fetch)造假,
 * 03 的 LlmRouterImpl / CloudLlmRouter / anthropicAdapter / SDK 全都跑真的
 * ——理由同 features/steps/_fake-cloud.mjs 的註解。真的花錢的 golden run 是
 * @manual @llm 的場景,由人另外安排。
 */
import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmRouterImpl } from '../../packages/core/src/llm/index.js';
import type { LogEvent } from '../../packages/contracts/src/index.js';
import {
  LiveRunOfflineError,
  runGolden,
  type ModelPriceTable,
} from '../../packages/core/src/prompt-quality/golden-run.js';
import { runBatchChecks } from '../../packages/core/src/prompt-quality/structural-checks.js';
import { renderScoresSheet, renderBatchCheckSection } from '../../packages/core/src/prompt-quality/scores.js';
import { compareRuns } from '../../packages/core/src/prompt-quality/compare.js';
import { detectPromptDrift, findBaseline, markBaseline, reviewRegression } from '../../packages/core/src/prompt-quality/regression.js';
import { I1_SECURITY_BATCH } from '../../packages/core/src/prompt-quality/fixtures/i1-security-batch.js';
import {
  BOUNDARY_BODY_A,
  BOUNDARY_BODY_EXACTLY_AT,
  BOUNDARY_BODY_JUST_BELOW,
  BAD_GRAPH_SHAPE,
  FOUR_DUPLICATE_PAIRS,
  GOOD_GRAPH_SHAPE,
  NO_DUPLICATES,
  TITLE_ONLY_DUPLICATE,
  batchCard,
} from '../../packages/core/src/prompt-quality/fixtures/synthetic-batches.js';
import type {
  BatchCard,
  BatchCheckResult,
  GoldenRunResult,
  LlmRouter,
  PromptDrift,
  RegressionReview,
} from '../../packages/core/src/prompt-quality/types.js';

const MODEL = 'claude-sonnet-5';
const PRICES: ModelPriceTable = { [MODEL]: { inPerMTok: 3, outPerMTok: 15 } };
/** grade.apply 的合法輸出:criteria 長度 2..4(契約 §5) */
const REPLY_TEXT = JSON.stringify({ criteria: [true, false], feedback: '方向對,細節再補' });

interface P2State {
  tmpDirs: string[];
  online: boolean;
  prices: ModelPriceTable;
  realFetch?: typeof globalThis.fetch;
  requests: string[];
  log: LogEvent[];
  baseDir?: string;
  cards: BatchCard[];
  batch?: BatchCheckResult;
  golden?: GoldenRunResult;
  liveError?: Error;
  drift?: PromptDrift | undefined;
  review?: RegressionReview;
  baselineBase?: string;
  baselineDir?: string;
}

let p2: P2State;
/** 回歸流程場景要比對的兩個 run 目錄,由 Given 造好、When 拿去 compareRuns */
let compareTargets: [string, string] | undefined;

Before(function () {
  p2 = { tmpDirs: [], online: true, prices: PRICES, requests: [], log: [], cards: [] };
  compareTargets = undefined;
});

After(function () {
  if (p2.realFetch) globalThis.fetch = p2.realFetch;
  for (const dir of p2.tmpDirs) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function newTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pq2-'));
  p2.tmpDirs.push(dir);
  return dir;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 只在網路邊界造假;router / adapter / SDK 全都跑真的。 */
function installFakeCloud(): void {
  p2.realFetch ??= globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    p2.requests.push(url);
    if (url.includes('/v1/models')) return jsonResponse({ data: [] }, p2.online ? 200 : 500);
    if (url.includes('/v1/messages')) {
      const raw = init?.body ?? '';
      const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer)) as { model?: string };
      return jsonResponse({
        id: 'msg_fake', type: 'message', role: 'assistant', model: body.model ?? MODEL,
        content: [{ type: 'text', text: REPLY_TEXT }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40 },
      });
    }
    throw new Error(`prompt-quality-phase2.steps 沒有預期到的請求:${url}`);
  }) as typeof globalThis.fetch;
}

function liveRouter(): LlmRouter {
  return new LlmRouterImpl({
    env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: MODEL, ANTHROPIC_API_KEY: 'test-key' },
    logAppender: (e: LogEvent) => p2.log.push(e),
  });
}

async function performLiveRun(): Promise<void> {
  installFakeCloud();
  p2.baseDir = newTmpDir();
  try {
    p2.golden = await runGolden({
      set: 'selftest',
      today: '2026-09-10',
      baseDir: p2.baseDir,
      mode: 'live',
      createRouter: liveRouter,
      prices: p2.prices,
    });
  } catch (e) {
    p2.liveError = e as Error;
  }
}

/** 在暫存目錄裡假造一次已經寫好的 run(不呼叫模型),給回歸流程的場景用。 */
function makeRun(baseDir: string, date: string, outputs: Record<string, string>, opts: { commit?: string; scores?: string } = {}): string {
  const dir = join(baseDir, 'selftest', date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ set: 'selftest', task: 'grade.apply', date, model: MODEL, provider: 'anthropic', promptFileGitCommit: opts.commit ?? 'aaa1111', mode: 'live' }),
  );
  for (const [id, text] of Object.entries(outputs)) {
    writeFileSync(join(dir, `${id}.output.json`), JSON.stringify({ id, text, structural: { issues: [], note: '' } }));
  }
  writeFileSync(join(dir, 'SCORES.md'), opts.scores ?? renderScoresSheet('selftest', date, Object.keys(outputs)));
  return dir;
}

const FILLED_SCORES = ['| id | 正確嗎 | 是一個概念嗎 |', '|---|---|---|', '| demo-1 | 5 | 4 |', '| demo-2 | 2 | 3 |', '| demo-3 | 4 | 4 |'].join('\n');

// ---------------------------------------------------------------- Given:live

// 刻意不叫「the network is available」——那句已經被 grading / i1-content-pipeline
// 定義過了,再定義一次會讓那些 feature 的場景全部變 ambiguous。這裡講的也確實是
// 雲端 provider 通不通,不是整個網路。
Given('the cloud is reachable', function () {
  p2.online = true;
});

Given('the cloud is not reachable', function () {
  p2.online = false;
});

Given('the configured model is not in the price table', function () {
  p2.prices = {};
});

// -------------------------------------------------------------- Given:批次

Given('a batch where four pairs of cards repeat each other', function () {
  p2.cards = FOUR_DUPLICATE_PAIRS;
});

Given('a batch where no two cards repeat each other', function () {
  p2.cards = NO_DUPLICATES;
});

Given('two cards whose titles differ only in case, spacing and punctuation', function () {
  p2.cards = TITLE_ONLY_DUPLICATE;
});

Given('two cards whose body similarity is exactly at the threshold', function () {
  p2.cards = [batchCard('e-0001', '邊界甲', BOUNDARY_BODY_A), batchCard('e-0002', '邊界乙', BOUNDARY_BODY_EXACTLY_AT)];
});

Given('two cards whose body similarity is just below the threshold', function () {
  p2.cards = [batchCard('e-0001', '邊界甲', BOUNDARY_BODY_A), batchCard('e-0002', '邊界乙', BOUNDARY_BODY_JUST_BELOW)];
});

Given('the twenty five cards from the I1 run', function () {
  p2.cards = I1_SECURITY_BATCH;
});

Given('a level 0 card whose prereqs contain a level 1 card', function () {
  p2.cards = BAD_GRAPH_SHAPE;
});

Given('a level 1 card whose prereqs contain a level 0 card', function () {
  p2.cards = GOOD_GRAPH_SHAPE;
});

// ------------------------------------------------------------ Given:回歸流程

Given('no previous golden run exists for a task', function () {
  p2.baselineBase = newTmpDir();
  assert.equal(findBaseline(p2.baselineBase, 'selftest'), undefined);
});

Given('a prompt file has changed since the last golden run', function () {
  p2.baselineBase = newTmpDir();
  markBaseline(p2.baselineBase, makeRun(p2.baselineBase, '2026-09-10', { 'demo-1': 'x' }, { commit: 'aaa1111' }));
});

Given('a new run produces an identical output for one input', function () {
  const base = newTmpDir();
  compareTargets = [
    makeRun(base, '2026-09-10', { 'demo-1': '一', 'demo-2': '二' }, { scores: FILLED_SCORES }),
    makeRun(base, '2026-09-11', { 'demo-1': '一', 'demo-2': '二號改了' }),
  ];
});

Given('a new run differs on two of three inputs', function () {
  const base = newTmpDir();
  compareTargets = [
    makeRun(base, '2026-09-10', { 'demo-1': '一', 'demo-2': '二', 'demo-3': '三' }, { scores: FILLED_SCORES }),
    makeRun(base, '2026-09-11', { 'demo-1': '一', 'demo-2': '二號改了', 'demo-3': '三號也改了' }),
  ];
});

// ----------------------------------------------------------------- When

When('a golden run is performed in live mode', async function () {
  await performLiveRun();
});

When('a golden run is attempted in live mode', async function () {
  await performLiveRun();
});

When('the batch checks run', function () {
  p2.batch = runBatchChecks(p2.cards);
});

When('a live golden run is performed and scored', async function () {
  await performLiveRun();
  assert.ok(p2.golden, String(p2.liveError));
  assert.ok(p2.baseDir);
  p2.baselineBase = p2.baseDir;
  p2.baselineDir = p2.golden.dir;
  markBaseline(p2.baseDir, p2.golden.dir);
});

When('the check command is run', function () {
  assert.ok(p2.baselineBase, 'Given 步驟要先立基準');
  p2.drift = detectPromptDrift(p2.baselineBase, 'selftest', 'bbb2222');
});

When('the comparison runs', function () {
  assert.ok(compareTargets, 'Given 步驟要先造出兩次 run');
  p2.review = reviewRegression(compareRuns(compareTargets[0], compareTargets[1]));
});

// ------------------------------------------------------------ Then:live

Then('the real router is used with the cloud provider', function () {
  assert.ok(p2.golden, String(p2.liveError));
  assert.equal(p2.golden.meta.mode, 'live');
  assert.equal(p2.golden.meta.provider, 'anthropic');
  assert.equal(p2.golden.meta.model, MODEL);
  // 真的走到了 SDK / adapter / router 的網路邊界,不是被假 router 短路掉
  assert.ok(p2.requests.some((u) => u.includes('/v1/messages')), JSON.stringify(p2.requests));
});

Then('each call is recorded in the log', function () {
  assert.ok(p2.golden);
  const calls = p2.log.filter((e) => e.type === 'llm_call');
  assert.equal(calls.length, p2.golden.outputs.length);
});

Then('the run reports the estimated token cost', function () {
  assert.ok(p2.golden);
  assert.ok((p2.golden.meta.tokens_in ?? 0) > 0);
  assert.equal(typeof p2.golden.meta.estimated_cost_usd, 'number');
});

Then('the run reports the token counts', function () {
  assert.ok(p2.golden);
  assert.equal(typeof p2.golden.meta.tokens_in, 'number');
  assert.equal(typeof p2.golden.meta.tokens_out, 'number');
});

Then('it reports no cost estimate', function () {
  assert.ok(p2.golden);
  assert.equal(p2.golden.meta.estimated_cost_usd, undefined);
});

Then('it reports that a live run needs the cloud', function () {
  assert.ok(p2.liveError instanceof LiveRunOfflineError, String(p2.liveError));
});

Then('no directory is created', function () {
  assert.ok(p2.baseDir);
  assert.deepEqual(readdirSync(p2.baseDir), []);
});

Then('the structural checks run on every output', function () {
  assert.ok(p2.golden, String(p2.liveError));
  assert.ok(p2.golden.outputs.length > 0);
  for (const o of p2.golden.outputs) assert.ok(Array.isArray(o.structural.issues));
});

Then('it notes that quality still requires human scoring', function () {
  assert.ok(p2.golden);
  for (const o of p2.golden.outputs) assert.ok(o.structural.note.length > 0);
});

// ------------------------------------------------------------ Then:批次

Then('the duplicate rate is reported as pairs over cards', function () {
  assert.ok(p2.batch);
  const { pairs, cardCount, rate } = p2.batch.duplicates;
  assert.equal(pairs.length, 4);
  assert.equal(cardCount, p2.cards.length);
  assert.ok(Math.abs(rate - pairs.length / cardCount) < 1e-9, `rate=${rate}`);
});

Then('each duplicate pair is listed by id', function () {
  assert.ok(p2.batch);
  const ids = new Set(p2.cards.map((c) => c.id));
  for (const pair of p2.batch.duplicates.pairs) {
    assert.ok(ids.has(pair.a), pair.a);
    assert.ok(ids.has(pair.b), pair.b);
    assert.ok(pair.a < pair.b, `${pair.a} 應該排在 ${pair.b} 前面`);
  }
});

Then('the duplicate rate is zero', function () {
  assert.ok(p2.batch);
  assert.equal(p2.batch.duplicates.rate, 0);
});

Then('no pair is listed', function () {
  assert.ok(p2.batch);
  assert.deepEqual(p2.batch.duplicates.pairs, []);
});

Then('they are counted as one duplicate pair', function () {
  assert.ok(p2.batch);
  assert.equal(p2.batch.duplicates.pairs.length, 1);
  assert.equal(p2.batch.duplicates.pairs[0]!.reason, 'title');
});

Then('the pair is counted', function () {
  assert.ok(p2.batch);
  assert.equal(p2.batch.duplicates.pairs.length, 1);
});

Then('the pair is not counted', function () {
  assert.ok(p2.batch);
  assert.deepEqual(p2.batch.duplicates.pairs, []);
});

Then('the duplicate rate is zero at the current threshold', function () {
  assert.ok(p2.batch);
  assert.equal(p2.cards.length, 25);
  assert.deepEqual(p2.batch.duplicates.pairs, []);
  assert.equal(p2.batch.duplicates.rate, 0);
});

Then('the count is recorded in the scoring sheet', function () {
  assert.ok(p2.batch);
  const section = renderBatchCheckSection(p2.batch);
  assert.match(section, /重複對數 \/ 卡數 = \d+ \/ \d+/);
  assert.match(section, /圖形狀 = \d+/);
});

Then('that prereq is listed as a graph shape problem', function () {
  assert.ok(p2.batch);
  assert.deepEqual(p2.batch.prereqShape, [{ card: 'g-0001', cardLevel: 0, prereq: 'g-0002', prereqLevel: 1 }]);
});

Then('no graph shape problem is reported', function () {
  assert.ok(p2.batch);
  assert.deepEqual(p2.batch.prereqShape, []);
});

Then('four graph shape problems are listed', function () {
  assert.ok(p2.batch);
  assert.equal(p2.batch.prereqShape.length, 4);
});

// ------------------------------------------------------- Then:評分表

Then('the scoring sheet lists exactly two dimensions for the person', function () {
  assert.ok(p2.golden, String(p2.liveError));
  const sheet = renderScoresSheet('selftest', '2026-09-10', ['demo-1']);
  const header = sheet.split('\n').find((l) => l.startsWith('| id'));
  assert.equal(header, '| id | 正確嗎 | 是一個概念嗎 |');
});

Then('the machine checks are reported in a separate section', function () {
  const section = renderBatchCheckSection(runBatchChecks(I1_SECURITY_BATCH));
  assert.match(section, /^## 機器檢查/m);
  assert.ok(!section.includes('正確嗎'), '機器檢查不該混進人打分的欄位');
});

Then('that section is present even when both counts are zero', function () {
  const section = renderBatchCheckSection(runBatchChecks(GOOD_GRAPH_SHAPE));
  assert.match(section, /^## 機器檢查/m);
  assert.match(section, /重複對數 \/ 卡數 = 0 \/ 2/);
  assert.match(section, /圖形狀 = 0/);
});

// ------------------------------------------------------- Then:回歸流程

Then('that run is marked as the baseline', function () {
  assert.ok(p2.baselineBase && p2.baselineDir);
  assert.equal(findBaseline(p2.baselineBase, 'selftest')?.dir, p2.baselineDir);
});

Then('later runs are compared against it by default', function () {
  assert.ok(p2.baselineBase);
  const baseline = findBaseline(p2.baselineBase, 'selftest');
  assert.ok(baseline, '找不到基準');
  assert.ok(existsSync(baseline.dir), baseline.dir);
});

Then('it reports that the prompt has changed without a new baseline', function () {
  assert.ok(p2.drift, ' 沒有偵測到 prompt 漂移');
});

Then('it names the prompt file and both commits', function () {
  assert.ok(p2.drift);
  assert.ok(p2.drift.promptFile.length > 0);
  assert.equal(p2.drift.baselineCommit, 'aaa1111');
  assert.equal(p2.drift.currentCommit, 'bbb2222');
});

Then("that input's previous score is carried forward", function () {
  assert.ok(p2.review);
  assert.deepEqual(p2.review.carriedForward, { 'demo-1': { 正確嗎: '5', 是一個概念嗎: '4' } });
});

Then('it is marked as unchanged rather than needing rescoring', function () {
  assert.ok(p2.review);
  assert.deepEqual(p2.review.unchanged, ['demo-1']);
  assert.ok(!p2.review.needsScoring.includes('demo-1'));
});

Then('those two are listed as needing scoring', function () {
  assert.ok(p2.review);
  assert.deepEqual(p2.review.needsScoring, ['demo-2', 'demo-3']);
});

Then('the unchanged one is listed separately', function () {
  assert.ok(p2.review);
  assert.deepEqual(p2.review.unchanged, ['demo-1']);
});
