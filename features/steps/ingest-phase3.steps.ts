/**
 * 步驟定義:02-ingest-pipeline / phase-3(場景 1、3、4、5、6、7、8;場景 2 留給 T55,它的步驟這裡不定義)。
 * 共用句子:「ingest runs」「no cards are written」在 ingest.steps.ts(phase-1);「ingest runs」那一句先問這個檔案有沒有 phase-3 的情境(runPhase3IfActive),有就掃描。
 * 被測的新函式是 `runIngestScan`(從 packages/core/src/ingest/index.ts 載;還沒匯出就丟清楚的錯)。LLM 用假 router(數呼叫次數,記在 world.llmCalls)。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { LearningWorld } from './_world.js';
import { ensureInitialized, setCategory } from '../../packages/core/src/ingest/init.js';
import { validateCard } from '../../packages/core/src/schema/validate-card.js';
import { buildDueList } from '../../packages/core/src/scheduler/index.js';
import {
  cardPath, countingRouter, expectedMarked, ingestOne, loadScan, rawText, readCard, treeHash, writeRaw, type ScanResult,
} from '../../packages/core/src/ingest/t53-test-support.js';

interface P3 {
  files: Record<string, string[]>;
  category: string;
  rawRel?: string;
  oldCardIds?: string[];
  oldCardBytes?: string[];
  originals?: string[];
  result?: ScanResult;
  topicResult?: ScanResult;
  before?: string;
  due?: string[];
  staleCardId?: string;
}
const store = new WeakMap<LearningWorld, P3>();
const p3 = (w: LearningWorld): P3 => {
  let s = store.get(w);
  if (!s) {
    s = { files: {}, category: 'security' };
    store.set(w, s);
  }
  return s;
};

const TODAY = '2026-09-10';

function freshDir(w: LearningWorld): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-ingest-p3-'));
  ensureInitialized(dir);
  w.dir = dir;
  return dir;
}

async function scan(w: LearningWorld, extra: { category?: string; topic?: string }): Promise<ScanResult> {
  const run = await loadScan();
  const { router, calls } = countingRouter(p3(w).files);
  try {
    return await run({ outDir: w.dir!, router, today: TODAY, levelZeroOnly: true, ...extra });
  } finally {
    w.llmCalls.push(...calls); // 呼叫次數記在 world.llmCalls(斷言「沒有呼叫模型」用)
  }
}

/** ingest.steps.ts 的「When ingest runs」先問這裡:有 phase-3 的情境就掃描,回 true */
export async function runPhase3IfActive(w: LearningWorld): Promise<boolean> {
  const s = store.get(w);
  if (!s || !s.rawRel) return false;
  s.result = await scan(w, { category: s.category });
  return true;
}

const cardsIn = (dir: string, category: string): string[] =>
  existsSync(join(dir, 'cards', category)) ? readdirSync(join(dir, 'cards', category)).filter((f) => f.endsWith('.md')).sort() : [];

// ---------------------------------------------------------------- 場景 1:要求 raw、沒有 raw

Given('the category security requires raw and has none', function (this: LearningWorld) {
  const dir = freshDir(this);
  setCategory(dir, { id: 'security', name: '資安', require_raw: true });
  p3(this).category = 'security';
});

When('ingest runs with a topic for that category', async function (this: LearningWorld) {
  const s = p3(this);
  s.result = await scan(this, { category: s.category, topic: '同源政策' });
});

Then('it reports that the category requires raw material', function (this: LearningWorld) {
  const s = p3(this);
  assert.equal(s.result?.refused, 'requires_raw', JSON.stringify(s.result));
  assert.ok((s.result?.message ?? '').length > 0);
  assert.equal(this.llmCalls.length, 0, `LLM 呼叫數要是 0,實際 ${JSON.stringify(this.llmCalls)}`);
});

// ---------------------------------------------------------------- 場景 3:raw 優先

Given('the category peach has a raw file', function (this: LearningWorld) {
  const dir = freshDir(this);
  const s = p3(this);
  s.category = 'peach';
  setCategory(dir, { id: 'peach', name: '桃子', require_raw: false });
  s.rawRel = writeRaw(dir, 'peach', 'peach-notes.md', rawText('peach'));
  s.files = { 'peach-notes.md': ['桃一', '桃二', '桃三'] };
});

Then('the produced cards have source raw', function (this: LearningWorld) {
  const s = p3(this);
  const files = cardsIn(this.dir!, s.category);
  assert.ok(files.length >= 1, '要有卡');
  for (const f of files) assert.equal(matter(readFileSync(join(this.dir!, 'cards', s.category, f), 'utf8')).data['source'], 'raw', f);
});

Then('it reports that the topic was ignored', function (this: LearningWorld) {
  assert.equal(p3(this).result?.topicIgnored, true);
});

// ---------------------------------------------------------------- 場景 4:只處理新檔

Given('two raw files where one has already been ingested', async function (this: LearningWorld) {
  const dir = freshDir(this);
  const s = p3(this);
  setCategory(dir, { id: 'security', name: '資安', require_raw: true });
  writeRaw(dir, 'security', 'p3-old.md', rawText('old'));
  s.rawRel = writeRaw(dir, 'security', 'p3-new.md', rawText('new'));
  s.oldCardIds = await ingestOne(dir, 'security', 'p3-old.md', ['舊一', '舊二', '舊三']);
  s.oldCardBytes = s.oldCardIds.map((id) => readCard(dir, 'security', id));
  s.files = { 'p3-new.md': ['新一', '新二'] }; // 沒錄 p3-old.md:叫了就丟錯
});

Then('only the unprocessed file is handled', function (this: LearningWorld) {
  const r = p3(this).result!;
  assert.deepEqual(r.processed, ['raw/security/p3-new.md']);
  assert.deepEqual(r.skipped, ['raw/security/p3-old.md']);
  assert.equal(this.llmCalls.length, 1, JSON.stringify(this.llmCalls));
  assert.ok(this.llmCalls[0]!.prompt.includes('p3-new.md'));
});

Then('the existing cards are untouched', function (this: LearningWorld) {
  const s = p3(this);
  s.oldCardIds!.forEach((id, i) => assert.equal(readCard(this.dir!, 'security', id), s.oldCardBytes![i], `舊卡 ${id} 位元組不變`));
});

// ---------------------------------------------------------------- 場景 5:raw 改了 → stale

Given('a raw file has already produced three cards', async function (this: LearningWorld) {
  const dir = freshDir(this);
  const s = p3(this);
  setCategory(dir, { id: 'security', name: '資安', require_raw: true });
  s.rawRel = writeRaw(dir, 'security', 'p3-src.md', rawText('v1'));
  s.oldCardIds = await ingestOne(dir, 'security', 'p3-src.md', ['卡一', '卡二', '卡三']);
  assert.equal(s.oldCardIds.length, 3);
  s.originals = s.oldCardIds.map((id) => readCard(dir, 'security', id));
  s.files = {}; // 標 stale 不叫 LLM:沒錄任何回應
});

Given('that file has since been edited', function (this: LearningWorld) {
  writeFileSync(join(this.dir!, p3(this).rawRel!), rawText('v2-edited'), 'utf8');
});

Then('those three cards are marked stale', function (this: LearningWorld) {
  const s = p3(this);
  assert.deepEqual([...s.result!.staleCards].sort(), [...s.oldCardIds!].sort());
  for (const id of s.oldCardIds!) assert.equal(matter(readCard(this.dir!, 'security', id)).data['stale'], true, id);
});

Then('their content is not overwritten', function (this: LearningWorld) {
  const s = p3(this);
  s.oldCardIds!.forEach((id, i) => assert.equal(readCard(this.dir!, 'security', id), expectedMarked(s.originals![i]!, 'stale'), `卡 ${id}:除了插的那一行位元組相同`));
  assert.equal(this.llmCalls.length, 0, '標 stale 不叫 LLM');
});

Then('it reports how many cards have a changed source', function (this: LearningWorld) {
  const r = p3(this).result!;
  assert.equal(r.staleCards.length, 3);
  assert.match(r.message, /3/);
});

// ---------------------------------------------------------------- 場景 6:raw 刪了 → source_missing

Given('a raw file has already produced cards', async function (this: LearningWorld) {
  const dir = freshDir(this);
  const s = p3(this);
  setCategory(dir, { id: 'security', name: '資安', require_raw: true });
  s.rawRel = writeRaw(dir, 'security', 'p3-gone.md', rawText('v1'));
  s.oldCardIds = await ingestOne(dir, 'security', 'p3-gone.md', ['卡一', '卡二']);
  s.originals = s.oldCardIds.map((id) => readCard(dir, 'security', id));
  s.files = {};
});

Given('that file has been deleted', function (this: LearningWorld) {
  rmSync(join(this.dir!, p3(this).rawRel!));
});

Then('the cards still exist', function (this: LearningWorld) {
  const s = p3(this);
  for (const id of s.oldCardIds!) assert.ok(existsSync(cardPath(this.dir!, 'security', id)), `卡 ${id} 還在`);
});

Then('they are marked as having a missing source', function (this: LearningWorld) {
  const s = p3(this);
  assert.deepEqual([...s.result!.missingSourceCards].sort(), [...s.oldCardIds!].sort());
  s.oldCardIds!.forEach((id, i) => assert.equal(readCard(this.dir!, 'security', id), expectedMarked(s.originals![i]!, 'source_missing'), `卡 ${id}`));
});

// ---------------------------------------------------------------- 場景 7:分類沒有設定

When('ingest runs for a category that is not configured', async function (this: LearningWorld) {
  const dir = freshDir(this);
  const s = p3(this);
  setCategory(dir, { id: 'security', name: '資安', require_raw: true });
  s.before = treeHash(dir);
  s.result = await scan(this, { category: 'ghost' });
  s.topicResult = await scan(this, { category: 'ghost', topic: '怎麼煮咖啡' });
});

Then('it reports that the category is not defined', function (this: LearningWorld) {
  const s = p3(this);
  assert.equal(s.result?.refused, 'category_undefined', '掃描跑法');
  assert.equal(s.topicResult?.refused, 'category_undefined', '主題跑法');
  assert.equal(this.llmCalls.length, 0);
});

/**
 * 「no directory is created」這句同時是 12-prompt-quality phase-2 的步驟(prompt-quality-phase2.steps.ts);cucumber 不准兩份定義,
 * 所以那邊的定義先問這裡:有 phase-3 場景 7 的情境(記了掃描前的目錄雜湊)就在這裡驗,回 true;不然回 false,走原本的。
 */
export function checkPhase3NoDirectory(w: LearningWorld): boolean {
  const s = store.get(w);
  if (!s || s.before === undefined) return false;
  assert.equal(treeHash(w.dir!), s.before, '輸出目錄前後完全相同');
  assert.ok(!existsSync(join(w.dir!, 'raw/ghost')) && !existsSync(join(w.dir!, 'cards/ghost')));
  return true;
}

// ---------------------------------------------------------------- 場景 8:stale 的卡照樣複習

Given('a card is marked stale', function (this: LearningWorld) {
  const dir = freshDir(this);
  const s = p3(this);
  setCategory(dir, { id: 'security', name: '資安', require_raw: true });
  s.staleCardId = 'sec-0001';
  const text = ['---', 'id: sec-0001', 'category: security', 'title: 標了 stale 的卡', 'level: 0', 'source: llm', 'created: 2026-09-01', 'stale: true', '---', '', '這張卡的來源改過了。', ''].join('\n');
  mkdirSync(join(dir, 'cards/security'), { recursive: true });
  writeFileSync(join(dir, 'cards/security/sec-0001.md'), text, 'utf8');
});

When("the scheduler builds today's list", function (this: LearningWorld) {
  const s = p3(this);
  const reviews = {
    'sec-0001': { stage: 2, learned_at: '2026-09-01', next_due: '2026-09-09', fails_in_row: 0, total_fails: 0, stuck: false, history: [] },
  };
  s.due = buildDueList(reviews as never, TODAY).map((d) => d.card);
});

Then('that card is included as normal', function (this: LearningWorld) {
  const s = p3(this);
  assert.ok(s.due!.includes(s.staleCardId!), `今天的清單:${JSON.stringify(s.due)}`);
  const check = validateCard(readFileSync(join(this.dir!, 'cards/security/sec-0001.md'), 'utf8'));
  assert.ok(check.ok, `卡本身還是合法的:${check.errors.join(';')}`);
  assert.equal(check.card?.frontmatter.stale, true);
});
