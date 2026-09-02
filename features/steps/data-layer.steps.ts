/**
 * 01-data-layer 的步驟定義:schema、卡片驗證器、字數計算、init CLI。
 * 業務邏輯都在 packages/core/src/schema/,這裡只是薄薄一層轉接。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { validateCard, type ValidationResult } from '@core/schema/validate-card.js';
import { countWords } from '@core/schema/word-count.js';
import { parseCardText } from '@core/schema/parse-card.js';
import { initLearningDir, isoWeek, DEFAULT_SETTINGS } from '@core/schema/init.js';
import { ROOT, type LearningWorld } from './_world.js';

/** 這個功能的步驟需要在 LearningWorld 之外多存幾個暫存欄位,只在這個檔案內用。 */
interface DataLayerWorld extends LearningWorld {
  cardFrontmatterLines?: string[];
  cardBodyText?: string;
  cardExampleFences?: string[];
  wordCounterInput?: string;
  fixtureResults?: { file: string; result: ValidationResult }[];
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
  this.lastResult = validateCard(assembleCardText(this));
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
