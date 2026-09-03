/**
 * 01-data-layer 的步驟定義:schema、卡片驗證器、字數計算、init CLI。
 * 業務邏輯都在 packages/core/src/schema/,這裡只是薄薄一層轉接。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import type { CardId, Review } from '@contracts/index.js';
import { validateCard, type ValidationResult } from '@core/schema/validate-card.js';
import { countWords } from '@core/schema/word-count.js';
import { parseCardText } from '@core/schema/parse-card.js';
import { initLearningDir, isoWeek, DEFAULT_SETTINGS } from '@core/schema/init.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';
import {
  validateFillQuestion,
  validateApplyQuestion,
  validateQuestionFile,
  findCardsMissingQuestions,
} from '@core/schema/validate-question.js';
import { validateReview, createInitialReview } from '@core/schema/review.js';
import { validateLogEvent, recordEvent, parseLogLines } from '@core/schema/log.js';
import { validateCategory, validateSettings } from '@core/schema/validate-config.js';
import {
  checkPrereqConsistency,
  computeAndSaveCategoryOrder,
  detectCycle,
  readCategoryGraph,
  topologicalSort,
  validateGraphEdges,
  type CardPrereqs,
  type CycleResult,
  type Graph,
} from '@core/schema/graph.js';
import { ROOT, type LearningWorld } from './_world.js';

/** phase-2「the validator runs」要對付好幾種格式,用這個 tagged union 決定要呼叫哪個驗證器。 */
type PendingValidation =
  | { kind: 'fillQuestion'; data: Record<string, unknown> }
  | { kind: 'applyQuestion'; data: Record<string, unknown> }
  | { kind: 'questionFile'; data: Record<string, unknown> }
  | { kind: 'review'; data: Record<string, unknown> }
  | { kind: 'category'; data: Record<string, unknown> }
  | { kind: 'settings'; data: Record<string, unknown> };

/** 這個功能的步驟需要在 LearningWorld 之外多存幾個暫存欄位,只在這個檔案內用。 */
interface DataLayerWorld extends LearningWorld {
  cardFrontmatterLines?: string[];
  cardBodyText?: string;
  cardExampleFences?: string[];
  wordCounterInput?: string;
  fixtureResults?: { file: string; result: ValidationResult }[];
  // ---- phase-2 ----
  pendingValidation?: PendingValidation;
  expectedMissingId?: CardId;
  logPath?: string;
  lastLogEvent?: Record<string, unknown>;
  settingsUnderTest?: Record<string, unknown>;
  // ---- phase-3:依賴圖 ----
  graphNodes?: CardId[];
  graphEdges?: [CardId, CardId][];
  graphNoEdgePair?: [string, string];
  pendingGraphValidation?: boolean;
  expectedGraph?: Graph;
  prereqCards?: CardPrereqs[];
  languageOrderSnapshot?: string;
}

/** stage 6 就是 next_due 必須 null,其他 stage 給一個合法日期,單純只測 stage 的邊界。 */
function buildReviewAtStage(stage: number): Record<string, unknown> {
  return {
    stage,
    learned_at: '2026-09-01',
    next_due: stage === 6 ? null : '2026-09-02',
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };
}

function buildCardText(frontmatterLines: string[], body: string, exampleFences: string[] = []): string {
  const fencesText = exampleFences.map((f) => `\n\n\`\`\`example\n${f}\n\`\`\`\n`).join('');
  return `---\n${frontmatterLines.join('\n')}\n---\n${body}${fencesText}\n`;
}

const BASE_FRONTMATTER = (overrides: Record<string, string> = {}): string[] => {
  const fields: Record<string, string> = {
    id: 'sec-0001',
    category: 'security',
    title: '測試卡',
    level: '0',
    source: 'llm',
    created: '2026-09-01',
    ...overrides,
  };
  return Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
};

/** Background「the category security contains the cards sec-0001 through sec-0004」的固定素材。 */
const SECURITY_CARDS: CardId[] = ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0004'];

/** phase-3 的 Given 步驟只累積 graphNodes / graphEdges,實際的 Graph 在 When 步驟時才組起來。 */
function currentGraph(world: DataLayerWorld): Graph {
  return { nodes: world.graphNodes ?? [...SECURITY_CARDS], edges: world.graphEdges ?? [] };
}

/**
 * 解析「A to B, C to D and E to F」這種邊描述,回傳 [from, to] 陣列。
 * 先把「, X and Y」/「X and Y」統一成逗號分隔,再逐段用 " to " 拆開。
 */
function parseEdgeSpec(spec: string): [CardId, CardId][] {
  const commaSeparated = spec.replace(/,?\s+and\s+/g, ', ');
  return commaSeparated.split(',').map((part) => {
    const [from, to] = part.trim().split(/\s+to\s+/);
    assert.ok(from && to, `無法解析邊描述:"${part}"`);
    return [from as CardId, to as CardId];
  });
}

function assembleCardText(world: DataLayerWorld): string {
  if (world.cardFrontmatterLines) {
    return buildCardText(world.cardFrontmatterLines, world.cardBodyText ?? '字'.repeat(10), world.cardExampleFences ?? []);
  }
  if (world.cardText) return world.cardText;
  throw new Error('沒有卡片內容可驗證:先呼叫某個 "Given a card ..." 步驟');
}

// ---------------------------------------------------------------- Background

Given(/^the contract version is ([\d.]+)$/, function (this: DataLayerWorld, _version: string) {
  // 只是宣告背景,契約版本不影響任何斷言。
});

// ---------------------------------------------------------------- 驗證器:Given

Given('a card with id, category, title, level, source and created', function (this: DataLayerWorld) {
  this.cardFrontmatterLines = BASE_FRONTMATTER();
});

Given('a body of {int} words', function (this: DataLayerWorld, n: number) {
  this.cardBodyText = '字'.repeat(n);
});

Given('a card without the field {word}', function (this: DataLayerWorld, field: string) {
  this.cardFrontmatterLines = BASE_FRONTMATTER().filter((line) => !line.startsWith(`${field}:`));
  this.cardBodyText = '字'.repeat(10);
});

Given('a card whose body is {int} words', function (this: DataLayerWorld, n: number) {
  this.cardFrontmatterLines = BASE_FRONTMATTER();
  this.cardBodyText = '字'.repeat(n);
});

Given('a card with a {int} word body', function (this: DataLayerWorld, n: number) {
  this.cardFrontmatterLines = BASE_FRONTMATTER();
  this.cardBodyText = '字'.repeat(n);
});

Given('an example fence containing {int} words and an image', function (this: DataLayerWorld, n: number) {
  const fence = `${'例'.repeat(n)}\n![圖](example.png)`;
  this.cardExampleFences = [...(this.cardExampleFences ?? []), fence];
});

Given('a card at level {int} with no parent field', function (this: DataLayerWorld, level: number) {
  this.cardFrontmatterLines = BASE_FRONTMATTER({ level: String(level) });
  this.cardBodyText = '字'.repeat(10);
});

Given('a card whose source is {word} with no source_ref field', function (this: DataLayerWorld, source: string) {
  this.cardFrontmatterLines = BASE_FRONTMATTER({ source });
  this.cardBodyText = '字'.repeat(10);
});

Given('a card with id {word}', function (this: DataLayerWorld, id: string) {
  this.cardFrontmatterLines = BASE_FRONTMATTER({ id });
  this.cardBodyText = '字'.repeat(10);
});

Given(/^a body containing (.*)$/, function (this: DataLayerWorld, content: string) {
  this.wordCounterInput = content;
});

// ---------------------------------------------------------------- 驗證器:When

When('the validator runs', function (this: DataLayerWorld) {
  if (this.pendingGraphValidation) {
    this.lastResult = validateGraphEdges(currentGraph(this));
    return;
  }
  const pending = this.pendingValidation;
  if (!pending) {
    this.lastResult = validateCard(assembleCardText(this));
    return;
  }
  switch (pending.kind) {
    case 'fillQuestion':
      this.lastResult = validateFillQuestion(pending.data);
      break;
    case 'applyQuestion':
      this.lastResult = validateApplyQuestion(pending.data);
      break;
    case 'questionFile':
      this.lastResult = validateQuestionFile(pending.data);
      break;
    case 'review':
      this.lastResult = validateReview(pending.data);
      break;
    case 'category':
      this.lastResult = validateCategory(pending.data);
      break;
    case 'settings':
      this.lastResult = validateSettings(pending.data);
      break;
  }
});

When('the word counter runs', function (this: DataLayerWorld) {
  this.lastResult = countWords(this.wordCounterInput ?? '');
});

When('the word counter runs against the word count fixture card', function (this: DataLayerWorld) {
  const raw = this.readFixture('cards/wordcount-cases.md');
  const parsed = parseCardText(raw);
  this.lastResult = countWords(parsed.body);
});

const CARDS_FIXTURE_DIR = join(ROOT, 'contracts/fixtures/cards');

When('the validator runs against every file under the cards fixture directory', function (this: DataLayerWorld) {
  const files = readdirSync(CARDS_FIXTURE_DIR).filter((f) => f.startsWith('valid-') || f.startsWith('invalid-'));
  this.fixtureResults = files.map((file) => ({
    file,
    result: validateCard(readFileSync(join(CARDS_FIXTURE_DIR, file), 'utf8')),
  }));
});

// ---------------------------------------------------------------- 驗證器:Then

Then('the error mentions {word}', function (this: DataLayerWorld, field: string) {
  const result = this.lastResult as ValidationResult;
  assert.ok(
    result.errors.some((e) => e.includes(field)),
    `錯誤訊息應提到 "${field}",實際:${JSON.stringify(result.errors)}`,
  );
});

Then('the error reports {int} against a limit of {int}', function (this: DataLayerWorld, actual: number, limit: number) {
  const result = this.lastResult as ValidationResult;
  assert.ok(
    result.errors.some((e) => e.includes(String(actual)) && e.includes(String(limit))),
    `錯誤訊息應同時提到 ${actual} 與 ${limit},實際:${JSON.stringify(result.errors)}`,
  );
});

Then('the reported body count is {int}', function (this: DataLayerWorld, n: number) {
  const result = this.lastResult as ValidationResult;
  assert.equal(result.bodyWordCount, n);
});

Then('three example blocks are parsed', function (this: DataLayerWorld) {
  const result = this.lastResult as ValidationResult;
  assert.equal(result.examplesCount, 3);
});

Then('zero example blocks are parsed', function (this: DataLayerWorld) {
  const result = this.lastResult as ValidationResult;
  assert.equal(result.examplesCount, 0);
});

Then('the error mentions that level {int} requires a parent', function (this: DataLayerWorld, level: number) {
  const result = this.lastResult as ValidationResult;
  assert.ok(
    result.errors.some((e) => e.includes(`level ${level} requires a parent`)),
    `錯誤訊息應提到 "level ${level} requires a parent",實際:${JSON.stringify(result.errors)}`,
  );
});

Then('the count is {int}', function (this: DataLayerWorld, n: number) {
  assert.equal(this.lastResult, n);
});

const INVALID_FIXTURE_REASONS: Record<string, string> = {
  'invalid-body-101-words.md': '101',
  'invalid-id-format.md': 'id',
  'invalid-level1-no-parent.md': 'parent',
  'invalid-missing-title.md': 'title',
  'invalid-raw-no-source-ref.md': 'source_ref',
};

Then('every file named valid passes', function (this: DataLayerWorld) {
  const results = this.fixtureResults ?? [];
  const validOnes = results.filter((r) => r.file.startsWith('valid-'));
  assert.ok(validOnes.length > 0, '沒有找到任何 valid- 開頭的 fixture');
  for (const { file, result } of validOnes) {
    assert.ok(result.ok, `${file} 應該通過,實際錯誤:${JSON.stringify(result.errors)}`);
  }
});

Then('every file named invalid fails for the reason its filename states', function (this: DataLayerWorld) {
  const results = this.fixtureResults ?? [];
  const invalidOnes = results.filter((r) => r.file.startsWith('invalid-'));
  assert.ok(invalidOnes.length > 0, '沒有找到任何 invalid- 開頭的 fixture');
  for (const { file, result } of invalidOnes) {
    assert.equal(result.ok, false, `${file} 應該失敗,但通過了`);
    const reason = INVALID_FIXTURE_REASONS[file];
    if (reason) {
      assert.ok(
        result.errors.some((e) => e.includes(reason)),
        `${file} 的錯誤應提到 "${reason}",實際:${JSON.stringify(result.errors)}`,
      );
    }
  }
});

// ---------------------------------------------------------------- init:When

const CLI = 'npx tsx packages/core/src/schema/cli.ts';

When('the standalone validate command is run against a valid fixture card', function (this: DataLayerWorld) {
  this.runStandalone();
});

When('the standalone init command is run against an empty directory', function (this: DataLayerWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
  this.dir = dir;
  this.runCommand(`${CLI} init "${dir}"`);
});

Given('a learning directory that already contains one review entry', function (this: DataLayerWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-init-'));
  initLearningDir(dir);
  writeFileSync(join(dir, 'state/reviews.json'), JSON.stringify({ 'sec-0001': { stage: 1 } }, null, 2));
  this.dir = dir;
});

When('the init command is run again', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 learning 目錄');
  this.runCommand(`${CLI} init "${this.dir}"`);
});

// ---------------------------------------------------------------- init:Then

Then('it prints OK and the counted body length', function (this: DataLayerWorld) {
  assert.ok(this.lastRun, '還沒有跑過任何指令');
  assert.match(this.lastRun.output, /OK \d+/);
});

Then(
  'the directories raw, cards, questions, assets, state, graph and config exist',
  function (this: DataLayerWorld) {
    assert.ok(this.dir, '尚未建立 learning 目錄');
    for (const name of ['raw', 'cards', 'questions', 'assets', 'state', 'graph', 'config']) {
      assert.ok(existsSync(join(this.dir!, name)), `${name}/ 應該存在`);
    }
  },
);

Then('reviews.json contains an empty object', function (this: DataLayerWorld) {
  assert.deepEqual(JSON.parse(this.read('state/reviews.json')), {});
});

Then('weekly.json contains the current ISO week and a target', function (this: DataLayerWorld) {
  const weekly = JSON.parse(this.read('state/weekly.json'));
  assert.equal(weekly.week, isoWeek(new Date()));
  assert.ok(typeof weekly.target === 'number' && weekly.target > 0);
});

Then('deps.json contains an empty object', function (this: DataLayerWorld) {
  assert.deepEqual(JSON.parse(this.read('graph/deps.json')), {});
});

Then('categories.yaml contains an empty list', function (this: DataLayerWorld) {
  assert.deepEqual(yamlParse(this.read('config/categories.yaml')), []);
});

Then(
  'settings.yaml contains the default daily cap, weekly target and short body limit',
  function (this: DataLayerWorld) {
    const settings = yamlParse(this.read('config/settings.yaml'));
    assert.equal(settings.daily_cap, DEFAULT_SETTINGS.daily_cap);
    assert.equal(settings.weekly_target, DEFAULT_SETTINGS.weekly_target);
    assert.equal(settings.short_body_limit, DEFAULT_SETTINGS.short_body_limit);
  },
);

Then('that review entry is still present', function (this: DataLayerWorld) {
  const reviews = JSON.parse(this.read('state/reviews.json'));
  assert.deepEqual(reviews['sec-0001'], { stage: 1 });
});

// ================================================================== phase-2

// ---------------------------------------------------------------- 考題一致性:Given/When/Then

Given('a card exists with no matching question file', function (this: DataLayerWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-coverage-'));
  mkdirSync(join(dir, 'cards/security'), { recursive: true });
  mkdirSync(join(dir, 'questions'), { recursive: true });
  writeFileSync(join(dir, 'cards/security/sec-0001.md'), '---\nid: sec-0001\n---\nbody');
  this.dir = dir;
  this.expectedMissingId = 'sec-0001';
});

When('the consistency check runs', function (this: DataLayerWorld) {
  if (this.prereqCards) {
    this.lastResult = checkPrereqConsistency(this.prereqCards, currentGraph(this));
    return;
  }
  assert.ok(this.dir, '尚未建立 learning 目錄');
  this.lastResult = findCardsMissingQuestions(this.dir);
});

Then('it reports the missing question file for that card', function (this: DataLayerWorld) {
  const missing = this.lastResult as CardId[];
  assert.ok(
    missing.includes(this.expectedMissingId!),
    `應該回報 ${this.expectedMissingId} 缺考題,實際:${JSON.stringify(missing)}`,
  );
});

// ---------------------------------------------------------------- 考題格式:Given

const VALID_FILL = { prompt: 'a ___', answers: [['x']] };
const VALID_APPLY = { prompt: 'p', rubric: ['criterion a', 'criterion b'] };

Given('a question file with one fill and no apply question', function (this: DataLayerWorld) {
  this.pendingValidation = {
    kind: 'questionFile',
    data: { card: 'sec-0001', fill: [VALID_FILL], apply: [] },
  };
});

Given('a fill question whose prompt has three blanks', function (this: DataLayerWorld) {
  this.pendingValidation = { kind: 'fillQuestion', data: { prompt: 'a ___ b ___ c ___', answers: [] } };
});

Given('only two answer groups', function (this: DataLayerWorld) {
  const pending = this.pendingValidation;
  assert.ok(pending && pending.kind === 'fillQuestion', '要先呼叫 "a fill question whose prompt has ... blanks"');
  pending.data['answers'] = [['x'], ['y']];
});

Given('a fill question with an empty answer group', function (this: DataLayerWorld) {
  this.pendingValidation = { kind: 'fillQuestion', data: { prompt: 'a ___ b ___', answers: [[], ['y']] } };
});

Given('an apply question with {int} rubric criteria', function (this: DataLayerWorld, n: number) {
  const rubric = Array.from({ length: n }, (_, i) => `criterion ${i}`);
  this.pendingValidation = { kind: 'applyQuestion', data: { prompt: 'p', rubric } };
});

// ---------------------------------------------------------------- 考題格式:Then

Then('the error mentions both shortfalls', function (this: DataLayerWorld) {
  const result = this.lastResult as ValidationResult;
  assert.ok(result.errors.some((e) => e.includes('fill')), `錯誤應提到 fill 短缺:${JSON.stringify(result.errors)}`);
  assert.ok(result.errors.some((e) => e.includes('apply')), `錯誤應提到 apply 短缺:${JSON.stringify(result.errors)}`);
});

Then('the error reports three blanks against two groups', function (this: DataLayerWorld) {
  const result = this.lastResult as ValidationResult;
  assert.ok(
    result.errors.some((e) => e.includes('3') && e.includes('2')),
    `錯誤訊息應同時提到 3 與 2,實際:${JSON.stringify(result.errors)}`,
  );
});

// ---------------------------------------------------------------- 複習狀態:Given/Then

Given('a review entry with stage {int}', function (this: DataLayerWorld, stage: number) {
  this.pendingValidation = { kind: 'review', data: buildReviewAtStage(stage) };
});

Given('a review entry at stage 6', function (this: DataLayerWorld) {
  this.pendingValidation = { kind: 'review', data: buildReviewAtStage(6) };
});

Then('next_due must be null', function (this: DataLayerWorld) {
  const pending = this.pendingValidation;
  assert.ok(pending && pending.kind === 'review', '要先呼叫 "a review entry at stage 6"');
  assert.equal(pending.data['next_due'], null);
  const result = this.lastResult as ValidationResult;
  assert.ok(result.ok, `stage 6 配 next_due null 應該通過:${JSON.stringify(result.errors)}`);
});

Then('a non null next_due at stage 6 is a failure', function (this: DataLayerWorld) {
  const pending = this.pendingValidation;
  assert.ok(pending && pending.kind === 'review', '要先呼叫 "a review entry at stage 6"');
  const bad = { ...pending.data, next_due: '2026-09-20' };
  const result = validateReview(bad);
  assert.equal(result.ok, false, 'stage 6 配非 null 的 next_due 應該失敗');
});

// ---------------------------------------------------------------- 初始值產生器:Given/When/Then

Given('a card that has no review entry', function (this: DataLayerWorld) {
  // 只是宣告背景:這張卡在 reviews.json 裡還沒有紀錄,所以下一步是「產生初始值」而不是「更新」。
});

When('it is marked learned on {word}', function (this: DataLayerWorld, date: string) {
  this.lastResult = createInitialReview(date);
});

// 這句故意跟 04-scheduler 的 "its stage is {int}" 不同字——原本文字會撞名
// (cucumber 的 step 是全域註冊,不分 tag),見 FEATURE.md「待協調」。
Then('the initial stage is {int}', function (this: DataLayerWorld, stage: number) {
  const review = this.lastResult as Review;
  assert.equal(review.stage, stage);
});

Then('learned_at is {word}', function (this: DataLayerWorld, date: string) {
  const review = this.lastResult as Review;
  assert.equal(review.learned_at, date);
});

Then('next_due is {word}', function (this: DataLayerWorld, date: string) {
  const review = this.lastResult as Review;
  assert.equal(review.next_due, date);
});

Then('both failure counters are zero', function (this: DataLayerWorld) {
  const review = this.lastResult as Review;
  assert.equal(review.fails_in_row, 0);
  assert.equal(review.total_fails, 0);
});

Then('stuck is false', function (this: DataLayerWorld) {
  const review = this.lastResult as Review;
  assert.equal(review.stuck, false);
});

Then('history is empty', function (this: DataLayerWorld) {
  const review = this.lastResult as Review;
  assert.deepEqual(review.history, []);
});

// ---------------------------------------------------------------- log:When/Then

function ensureLogDir(world: DataLayerWorld): string {
  if (!world.dir) world.dir = mkdtempSync(join(tmpdir(), 'lc-log-'));
  if (!world.logPath) world.logPath = join(world.dir, 'log.jsonl');
  return world.logPath;
}

When('a learned event is recorded for a card', function (this: DataLayerWorld) {
  const logPath = ensureLogDir(this);
  recordEvent(logPath, { ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'sec-0001' });
});

Then('the last line of the log parses as JSON', function (this: DataLayerWorld) {
  assert.ok(this.logPath, '還沒有寫過任何事件');
  const lines = readFileSync(this.logPath, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.length > 0);
  assert.ok(lines.length > 0, 'log 檔是空的');
  this.lastLogEvent = JSON.parse(lines[lines.length - 1] as string);
});

Then('it contains a timestamp, a type and a card id', function (this: DataLayerWorld) {
  assert.ok(this.lastLogEvent, '還沒有 parse 過任何一行 log');
  assert.ok(typeof this.lastLogEvent['ts'] === 'string' && this.lastLogEvent['ts'].length > 0);
  assert.ok(typeof this.lastLogEvent['type'] === 'string' && this.lastLogEvent['type'].length > 0);
  assert.ok(typeof this.lastLogEvent['card'] === 'string' && this.lastLogEvent['card'].length > 0);
});

When('an event of type {word} is recorded', function (this: DataLayerWorld, type: string) {
  this.lastResult = validateLogEvent({ ts: '2026-09-02T00:00:00Z', type, card: 'sec-0001' });
});

// ---------------------------------------------------------------- categories / settings:Given/When/Then

Given('a category entry missing the raw requirement flag', function (this: DataLayerWorld) {
  this.pendingValidation = { kind: 'category', data: { id: 'security', name: 'Security' } };
});

When('a freshly initialised settings file is read', function (this: DataLayerWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-settings-'));
  initLearningDir(dir);
  this.dir = dir;
  this.settingsUnderTest = yamlParse(readFileSync(join(dir, 'config/settings.yaml'), 'utf8'));
});

Then('the default daily cap is {int}', function (this: DataLayerWorld, n: number) {
  assert.ok(this.settingsUnderTest, '還沒有讀過任何 settings 檔');
  assert.equal(this.settingsUnderTest['daily_cap'], n);
});

Then('the default weekly target is {int}', function (this: DataLayerWorld, n: number) {
  assert.ok(this.settingsUnderTest, '還沒有讀過任何 settings 檔');
  assert.equal(this.settingsUnderTest['weekly_target'], n);
});

Then('the default short body limit is {int}', function (this: DataLayerWorld, n: number) {
  assert.ok(this.settingsUnderTest, '還沒有讀過任何 settings 檔');
  assert.equal(this.settingsUnderTest['short_body_limit'], n);
});

Then(
  'the llm section contains a cloud provider, a cloud model and a local model',
  function (this: DataLayerWorld) {
    assert.ok(this.settingsUnderTest, '還沒有讀過任何 settings 檔');
    const llm = this.settingsUnderTest['llm'] as Record<string, unknown>;
    assert.ok(typeof llm?.['cloud_provider'] === 'string' && llm['cloud_provider'].length > 0);
    assert.ok(typeof llm?.['cloud_model'] === 'string' && llm['cloud_model'].length > 0);
    assert.ok(typeof llm?.['local_model'] === 'string' && llm['local_model'].length > 0);
  },
);

Given('a settings file where {word} is {word}', function (this: DataLayerWorld, key: string, rawValue: string) {
  this.pendingValidation = { kind: 'settings', data: { ...DEFAULT_SETTINGS, [key]: Number(rawValue) } };
});

// ---------------------------------------------------------------- 原子寫入:When/Then

Given('the review state contains one entry', function (this: DataLayerWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'state/reviews.json'), JSON.stringify({ 'sec-0001': { stage: 1 } }));
  this.dir = dir;
});

When('the review state is written', function (this: DataLayerWorld) {
  const dir = this.dir ?? mkdtempSync(join(tmpdir(), 'lc-atomic-'));
  mkdirSync(join(dir, 'state'), { recursive: true });
  this.dir = dir;
  writeFileAtomic(join(dir, 'state/reviews.json'), JSON.stringify({ 'sec-0001': createInitialReview('2026-09-02') }));
});

Then('a temporary file is written and renamed into place', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未寫入 review state');
  const files = readdirSync(join(this.dir, 'state'));
  assert.deepEqual(files, ['reviews.json'], `state/ 底下不該留有暫存檔:${JSON.stringify(files)}`);
});

Then('no partial file is ever visible at the target path', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未寫入 review state');
  // rename 是原子的:讀者永遠只會看到完整的舊檔或完整的新檔,所以能完整 parse 就是證明。
  const parsed = JSON.parse(readFileSync(join(this.dir, 'state/reviews.json'), 'utf8'));
  assert.ok(parsed['sec-0001']);
});

When('a write is interrupted before the rename', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 learning 目錄');
  // 模擬:tmp 檔寫完(甚至 fsync 完)但行程在 rename 前被殺掉——tmp 留在原地,目標檔完全沒被動過。
  const stray = join(this.dir, 'state', `.reviews.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(stray, '{"sec-0001":{"stage":1},"sec-0002":{"stage"'); // 寫到一半的內容
});

Then('the existing file still contains that entry', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 learning 目錄');
  const reviews = JSON.parse(readFileSync(join(this.dir, 'state/reviews.json'), 'utf8'));
  assert.deepEqual(reviews['sec-0001'], { stage: 1 });
});

Then('a stray temporary file is cleaned up on the next write', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 learning 目錄');
  const target = join(this.dir, 'state/reviews.json');
  writeFileAtomic(target, JSON.stringify({ 'sec-0001': { stage: 1 }, 'sec-0002': { stage: 2 } }));
  const files = readdirSync(join(this.dir, 'state'));
  assert.deepEqual(files, ['reviews.json'], `殘留的 tmp 檔應該被下一次寫入清掉:${JSON.stringify(files)}`);
});

// ---------------------------------------------------------------- log 逐行 append:When/Then

When('two events are recorded in quick succession', function (this: DataLayerWorld) {
  const logPath = ensureLogDir(this);
  recordEvent(logPath, { ts: '2026-09-02T00:00:00Z', type: 'learned', card: 'sec-0001' });
  recordEvent(logPath, { ts: '2026-09-02T00:00:01Z', type: 'reviewed', card: 'sec-0002' });
});

Then('the log contains two complete lines', function (this: DataLayerWorld) {
  assert.ok(this.logPath, '還沒有寫過任何事件');
  const events = parseLogLines(readFileSync(this.logPath, 'utf8'));
  assert.equal(events.length, 2);
});

Then('neither line is interleaved with the other', function (this: DataLayerWorld) {
  assert.ok(this.logPath, '還沒有寫過任何事件');
  const events = parseLogLines(readFileSync(this.logPath, 'utf8'));
  assert.equal(events[0]?.['card'], 'sec-0001');
  assert.equal(events[1]?.['card'], 'sec-0002');
});

// ================================================================== phase-3

function ensureGraphDir(world: DataLayerWorld): string {
  if (!world.dir) world.dir = mkdtempSync(join(tmpdir(), 'lc-graph-'));
  mkdirSync(join(world.dir, 'graph'), { recursive: true });
  return world.dir;
}

// ---------------------------------------------------------------- Background

Given('the category security contains the cards sec-0001 through sec-0004', function (this: DataLayerWorld) {
  this.graphNodes = [...SECURITY_CARDS];
  this.graphEdges = [];
});

// ---------------------------------------------------------------- 分類篩選:Given/When/Then

Given('the graph file contains both security and language', function (this: DataLayerWorld) {
  const dir = ensureGraphDir(this);
  const securityGraph: Graph = { nodes: this.graphNodes ?? [...SECURITY_CARDS], edges: [['sec-0001', 'sec-0002']] };
  const languageGraph: Graph = { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] };
  writeFileSync(join(dir, 'graph/deps.json'), JSON.stringify({ security: securityGraph, language: languageGraph }));
  this.graphEdges = securityGraph.edges;
  this.expectedGraph = securityGraph;
});

When('the security graph is read', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 graph 檔案');
  this.lastResult = readCategoryGraph(this.dir, 'security');
});

Then('only the nodes and edges for security are returned', function (this: DataLayerWorld) {
  const result = this.lastResult as Graph;
  assert.deepEqual(result, this.expectedGraph);
  assert.ok(!result.nodes.some((id) => id.startsWith('lan-')), '不該混入 language 分類的節點');
  assert.ok(!result.edges.some(([a, b]) => a.startsWith('lan-') || b.startsWith('lan-')), '不該混入 language 分類的邊');
});

// ---------------------------------------------------------------- 邊的組成:Given(多個場景共用)

Given(/^edges from (.+)$/, function (this: DataLayerWorld, spec: string) {
  this.graphNodes = this.graphNodes ?? [...SECURITY_CARDS];
  this.graphEdges = parseEdgeSpec(spec);
});

Given(/^an edge from (\S+) to itself$/, function (this: DataLayerWorld, cardId: string) {
  this.graphNodes = this.graphNodes ?? [...SECURITY_CARDS];
  this.graphEdges = [[cardId as CardId, cardId as CardId]];
});

Given(/^an edge from (\S+) to a card that does not exist$/, function (this: DataLayerWorld, from: string) {
  this.graphNodes = this.graphNodes ?? [...SECURITY_CARDS];
  this.expectedMissingId = 'sec-9999';
  this.graphEdges = [[from as CardId, this.expectedMissingId]];
  this.pendingGraphValidation = true;
});

// ---------------------------------------------------------------- 邊驗證:Then

Then('the error names the missing card', function (this: DataLayerWorld) {
  const result = this.lastResult as ValidationResult;
  assert.ok(
    result.errors.some((e) => e.includes(this.expectedMissingId!)),
    `錯誤應點名缺的卡片 ${this.expectedMissingId},實際:${JSON.stringify(result.errors)}`,
  );
});

// ---------------------------------------------------------------- 循環偵測:When/Then

When('cycle detection runs', function (this: DataLayerWorld) {
  this.lastResult = detectCycle(currentGraph(this));
});

Then('the cycle is reported as a path through all three cards', function (this: DataLayerWorld) {
  const result = this.lastResult as CycleResult;
  assert.equal(result.hasCycle, true, '應該偵測到循環');
  assert.equal(result.path[0], result.path[result.path.length - 1], '路徑頭尾應該是同一張卡');
  const middle = [...new Set(result.path.slice(0, -1))].sort();
  assert.deepEqual(middle, ['sec-0001', 'sec-0002', 'sec-0003']);
});

Then('a cycle is reported', function (this: DataLayerWorld) {
  const result = this.lastResult as CycleResult;
  assert.equal(result.hasCycle, true, '應該偵測到循環');
});

// ---------------------------------------------------------------- 拓樸排序:Given/When/Then

Given(/^(\S+) and (\S+) have no edge between them$/, function (this: DataLayerWorld, a: string, b: string) {
  this.graphNodes = this.graphNodes ?? [...SECURITY_CARDS];
  this.graphEdges = this.graphEdges ?? [];
  this.graphNoEdgePair = [a, b];
});

Given(/^(\S+) appears earlier in the raw material$/, function (this: DataLayerWorld, earlier: string) {
  const pair = this.graphNoEdgePair;
  assert.ok(pair, '要先呼叫 "... have no edge between them"');
  const other = pair.find((id) => id !== earlier)!;
  const nodes = this.graphNodes ?? [...SECURITY_CARDS];
  const insertAt = Math.min(nodes.indexOf(earlier), nodes.indexOf(other));
  const rest = nodes.filter((id) => id !== earlier && id !== other);
  rest.splice(insertAt, 0, earlier as CardId, other as CardId);
  this.graphNodes = rest;
});

Given('the category has no edges', function (this: DataLayerWorld) {
  this.graphNodes = this.graphNodes ?? [...SECURITY_CARDS];
  this.graphEdges = [];
});

When('the topological sort runs', function (this: DataLayerWorld) {
  this.lastResult = topologicalSort(currentGraph(this));
});

Then(/^(\S+) comes after both (\S+) and (\S+)$/, function (this: DataLayerWorld, target: string, a: string, b: string) {
  const order = this.lastResult as CardId[];
  assert.ok(order.indexOf(a) < order.indexOf(target), `${target} 應該排在 ${a} 之後,實際順序:${JSON.stringify(order)}`);
  assert.ok(order.indexOf(b) < order.indexOf(target), `${target} 應該排在 ${b} 之後,實際順序:${JSON.stringify(order)}`);
});

Then(/^(\S+) comes after (\S+)$/, function (this: DataLayerWorld, target: string, other: string) {
  const order = this.lastResult as CardId[];
  assert.ok(order.indexOf(other) < order.indexOf(target), `${target} 應該排在 ${other} 之後,實際順序:${JSON.stringify(order)}`);
});

Then(/^(\S+) comes before (\S+)$/, function (this: DataLayerWorld, a: string, b: string) {
  const order = this.lastResult as CardId[];
  assert.ok(order.indexOf(a) < order.indexOf(b), `${a} 應該排在 ${b} 之前,實際順序:${JSON.stringify(order)}`);
});

Then('the order matches the order the cards appear in the raw material', function (this: DataLayerWorld) {
  const order = this.lastResult as CardId[];
  assert.deepEqual(order, this.graphNodes ?? [...SECURITY_CARDS]);
});

// ---------------------------------------------------------------- prereqs 一致性:Given/Then

Given(/^(\S+) lists (\S+) as a prerequisite$/, function (this: DataLayerWorld, cardId: string, prereqId: string) {
  this.prereqCards = this.prereqCards ?? [];
  const existing = this.prereqCards.find((c) => c.id === cardId);
  if (existing) existing.prereqs.push(prereqId as CardId);
  else this.prereqCards.push({ id: cardId as CardId, prereqs: [prereqId as CardId] });
});

Given(/^the graph only has an edge from (\S+) to (\S+)$/, function (this: DataLayerWorld, from: string, to: string) {
  this.graphNodes = this.graphNodes ?? [...SECURITY_CARDS];
  this.graphEdges = [[from as CardId, to as CardId]];
});

Then(/^the disagreement is reported for (\S+)$/, function (this: DataLayerWorld, cardId: string) {
  const result = this.lastResult as ValidationResult;
  assert.equal(result.ok, false, '應該回報不一致');
  assert.ok(
    result.errors.some((e) => e.includes(cardId)),
    `錯誤應點名 ${cardId},實際:${JSON.stringify(result.errors)}`,
  );
});

// ---------------------------------------------------------------- 寫入 order 檔:When/Then

When('the topological sort for security is saved', function (this: DataLayerWorld) {
  const dir = ensureGraphDir(this);
  writeFileSync(join(dir, 'graph/deps.json'), JSON.stringify({ security: currentGraph(this) }));
  this.lastResult = computeAndSaveCategoryOrder(dir, 'security');
});

Then('a file named for that category exists under the graph directory', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 graph 檔案');
  assert.ok(existsSync(join(this.dir, 'graph/order-security.json')), 'graph/order-security.json 應該存在');
});

Then('it contains an ordered array of card ids', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 graph 檔案');
  const content = JSON.parse(readFileSync(join(this.dir, 'graph/order-security.json'), 'utf8'));
  assert.ok(Array.isArray(content), 'order 檔應該是一個陣列');
  for (const id of content) assert.equal(typeof id, 'string');
});

Then('every card in the category appears exactly once', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 graph 檔案');
  const content = JSON.parse(readFileSync(join(this.dir, 'graph/order-security.json'), 'utf8')) as string[];
  const expected = this.graphNodes ?? [...SECURITY_CARDS];
  assert.deepEqual([...content].sort(), [...expected].sort());
  assert.equal(new Set(content).size, content.length, '不該有重複的卡片');
});

// ---------------------------------------------------------------- 只動目標分類:Given/When/Then

Given('an order file already exists for language', function (this: DataLayerWorld) {
  const dir = ensureGraphDir(this);
  const content = JSON.stringify(['lan-0002', 'lan-0001']);
  writeFileSync(join(dir, 'graph/order-language.json'), content);
  this.languageOrderSnapshot = content;
});

When('the security order is regenerated', function (this: DataLayerWorld) {
  const dir = ensureGraphDir(this);
  writeFileSync(join(dir, 'graph/deps.json'), JSON.stringify({ security: currentGraph(this) }));
  this.lastResult = computeAndSaveCategoryOrder(dir, 'security');
});

Then('the language order file is unchanged', function (this: DataLayerWorld) {
  assert.ok(this.dir, '尚未建立 graph 檔案');
  const content = readFileSync(join(this.dir, 'graph/order-language.json'), 'utf8');
  assert.equal(content, this.languageOrderSnapshot);
});
