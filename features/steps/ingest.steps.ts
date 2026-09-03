/** 步驟定義:02-ingest-pipeline / phase-1。共用句子見 common.steps.ts,不重複定義。 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { ROOT, type LearningWorld } from './_world.js';
import { FakeLlmRouter, type FakeFixtureRecord } from '../../packages/core/src/ingest/fake-llm.js';
import { runIngest, type RunIngestResult } from '../../packages/core/src/ingest/ingest.js';
import { ensureInitialized, setCategory } from '../../packages/core/src/ingest/init.js';
import { countBodyWords } from '../../packages/core/src/ingest/word-count-min.js';
import { readJsonOr, readLogEvents } from '../../packages/core/src/ingest/state.js';

// ---------------------------------------------------------------- 場景內狀態

interface IngestCtx {
  category: string;
  rawRelPath: string;
  overlongPlan?: [number, number];
  alwaysOverlong?: boolean;
  cloudUnavailable?: boolean;
  cardCountAfterFirstRun?: number;
  lastResult?: RunIngestResult;
}

const store = new WeakMap<LearningWorld, IngestCtx>();

function ctx(world: LearningWorld): IngestCtx {
  let c = store.get(world);
  if (!c) {
    c = { category: 'security', rawRelPath: 'raw/security/web-basics.md' };
    store.set(world, c);
  }
  return c;
}

// ---------------------------------------------------------------- 小工具

function fixture(marker: string, attempt: number, cards: unknown[]): FakeFixtureRecord {
  return {
    task: 'ingest.cards',
    prompt_contains: marker,
    attempt,
    response: { text: JSON.stringify(cards), provider: 'fake', model: 'scenario', latency_ms: 0, provisional: false },
  };
}

/** ~2000 字、超過 96 行的填充內容,足以覆蓋 ingest.cards.web-basics.json 的行號範圍(最大到 96)。 */
function buildFillerRawFile(): string {
  const paragraph =
    '網路安全牽涉到很多層面,包括身份驗證、資料加密、存取控制與稽核紀錄。每一個環節都可能是攻擊者尋找弱點的地方,因此防禦需要縱深部署,而不是只靠單一措施,這也是這篇長文用來墊高行數與字數的填充段落。';
  const lines: string[] = ['# 測試用長文', ''];
  for (let i = 0; i < 40; i++) {
    lines.push(`## 小節 ${i + 1}`, '', paragraph, '');
  }
  return lines.join('\n');
}

function writeRawFile(dir: string, relPath: string, content: string): void {
  const p = join(dir, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function readAllCards(dir: string, category: string): { id: string; data: Record<string, unknown>; content: string }[] {
  const catDir = join(dir, 'cards', category);
  if (!existsSync(catDir)) return [];
  return readdirSync(catDir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('.short.md'))
    .sort()
    .map((f) => {
      const parsed = matter(readFileSync(join(catDir, f), 'utf8'));
      return { id: f.replace(/\.md$/, ''), data: parsed.data, content: parsed.content };
    });
}

function minimalCardMarkdown(id: string, category: string): string {
  return [
    '---',
    `id: ${id}`,
    `category: ${category}`,
    'title: 預先存在的卡',
    'level: 0',
    'source: llm',
    'created: 2026-09-01',
    '---',
    '',
    '這張卡是測試預先放好的,用來驗證 id 接續配發。',
    '',
  ].join('\n');
}

async function doIngestRun(world: LearningWorld): Promise<void> {
  const s = ctx(world);
  if (!world.dir) throw new Error('尚未初始化輸出目錄(先跑 "an output directory that has been initialised")');

  const extra: FakeFixtureRecord[] = [];
  let rawRelPath = s.rawRelPath;

  if (s.overlongPlan) {
    rawRelPath = 'raw/security/overlong-test.md';
    writeRawFile(world.dir, rawRelPath, '# 重試路徑測試\n\n用來測重試路徑的短文。\n');
    const [first, second] = s.overlongPlan;
    extra.push(
      fixture('overlong-test.md', 1, [{ title: '測試用卡', body: '測'.repeat(first), examples: [], lines: [1, 3] }]),
      fixture('overlong-test.md', 2, [{ title: '測試用卡', body: '測'.repeat(second), examples: [], lines: [1, 3] }]),
    );
  } else if (s.alwaysOverlong) {
    rawRelPath = 'raw/security/overlong-always.md';
    writeRawFile(world.dir, rawRelPath, '# 三次都超長測試\n\n用來測「三次都超長」路徑的短文。\n');
    extra.push(
      fixture('overlong-always.md', 1, [
        { title: '正常卡', body: '這是一張字數正常、可以直接寫入的卡片內容。', examples: [], lines: [1, 2] },
        { title: '超長卡', body: '測'.repeat(120), examples: [], lines: [3, 4] },
      ]),
      fixture('overlong-always.md', 2, [{ title: '超長卡', body: '測'.repeat(121), examples: [], lines: [3, 4] }]),
      fixture('overlong-always.md', 3, [{ title: '超長卡', body: '測'.repeat(122), examples: [], lines: [3, 4] }]),
    );
  }

  const router = new FakeLlmRouter({
    fixturesDir: join(ROOT, 'contracts/fixtures/llm'),
    extra,
    cloudUnavailable: s.cloudUnavailable ?? false,
    onCall: (call) => world.llmCalls.push(call),
  });

  const result = await runIngest({ outDir: world.dir, rawRelPath, category: s.category, router, today: world.today });
  s.rawRelPath = rawRelPath;
  s.lastResult = result;
  world.lastResult = result;
  world.resultText = result.message;
}

// ---------------------------------------------------------------- Given

Given('an output directory that has been initialised', function (this: LearningWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-ingest-'));
  ensureInitialized(dir);
  this.dir = dir;
});

Given('a category security configured with require_raw true', function (this: LearningWorld) {
  setCategory(this.dir!, { id: 'security', name: '資安', require_raw: true });
  ctx(this).category = 'security';
});

Given('a raw file of about 2000 words under that category', function (this: LearningWorld) {
  const s = ctx(this);
  s.rawRelPath = 'raw/security/web-basics.md';
  writeRawFile(this.dir!, s.rawRelPath, buildFillerRawFile());
});

Given('a raw file containing only whitespace', function (this: LearningWorld) {
  const s = ctx(this);
  s.rawRelPath = 'raw/security/whitespace-only.md';
  writeRawFile(this.dir!, s.rawRelPath, '   \n\t\n   \n');
});

Given('the fake router returns {int} words on the first attempt', function (this: LearningWorld, n: number) {
  const s = ctx(this);
  s.overlongPlan = [n, s.overlongPlan?.[1] ?? 0];
});

Given('{int} words on the second', function (this: LearningWorld, n: number) {
  const s = ctx(this);
  s.overlongPlan = [s.overlongPlan?.[0] ?? 0, n];
});

Given('the fake router returns an overlong body three times', function (this: LearningWorld) {
  ctx(this).alwaysOverlong = true;
});

Given('ingest has already run for that file', async function (this: LearningWorld) {
  await doIngestRun(this);
  const s = ctx(this);
  s.cardCountAfterFirstRun = readAllCards(this.dir!, s.category).length;
  this.cardCountBefore = s.cardCountAfterFirstRun;
});

Given('the category already contains cards numbered up to sec-{int}', function (this: LearningWorld, maxNum: number) {
  const s = ctx(this);
  const dir = join(this.dir!, 'cards', s.category);
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= maxNum; i++) {
    const id = `sec-${String(i).padStart(4, '0')}`;
    writeFileSync(join(dir, `${id}.md`), minimalCardMarkdown(id, s.category), 'utf8');
  }
});

Given('the router reports that the cloud is required and unavailable', function (this: LearningWorld) {
  ctx(this).cloudUnavailable = true;
});

// ---------------------------------------------------------------- When

When('the standalone ingest command is run with the fake flag', function (this: LearningWorld) {
  const tmp = join(ROOT, 'tmp-learning');
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  this.runStandalone();
});

When('ingest runs for that file', async function (this: LearningWorld) {
  await doIngestRun(this);
});

When('ingest runs', async function (this: LearningWorld) {
  await doIngestRun(this);
});

When('it runs again', async function (this: LearningWorld) {
  await doIngestRun(this);
});

When('ingest produces three new cards', async function (this: LearningWorld) {
  await doIngestRun(this);
});

// ---------------------------------------------------------------- Then

Then('it prints the list of cards it created', function (this: LearningWorld) {
  assert.ok(this.lastRun, '尚未執行 standalone 指令');
  const matches = this.lastRun.output.match(/sec-\d{4}/g) ?? [];
  assert.ok(matches.length >= 3, `輸出應列出至少 3 張卡的 id,實際:\n${this.lastRun.output}`);
});

Then('at least 3 cards are written under the category directory', function (this: LearningWorld) {
  const s = ctx(this);
  const cards = readAllCards(this.dir!, s.category);
  assert.ok(cards.length >= 3, `應至少 3 張卡,實際 ${cards.length}`);
});

Then('every card is at level 0', function (this: LearningWorld) {
  const s = ctx(this);
  for (const c of readAllCards(this.dir!, s.category)) assert.equal(c.data.level, 0, c.id);
});

Then('every card belongs to that category', function (this: LearningWorld) {
  const s = ctx(this);
  for (const c of readAllCards(this.dir!, s.category)) assert.equal(c.data.category, s.category, c.id);
});

Then('every card has source raw', function (this: LearningWorld) {
  const s = ctx(this);
  for (const c of readAllCards(this.dir!, s.category)) assert.equal(c.data.source, 'raw', c.id);
});

Then('every source reference names the file and a line range', function (this: LearningWorld) {
  const s = ctx(this);
  for (const c of readAllCards(this.dir!, s.category)) {
    const ref = c.data.source_ref as string;
    assert.match(ref, /^raw\/[^/]+\/[^#]+#L\d+-L\d+$/, `${c.id}: ${ref}`);
  }
});

Then('every line range falls inside the file', function (this: LearningWorld) {
  const s = ctx(this);
  const totalLines = readFileSync(join(this.dir!, s.rawRelPath), 'utf8').split('\n').length;
  for (const c of readAllCards(this.dir!, s.category)) {
    const ref = c.data.source_ref as string;
    const m = /#L(\d+)-L(\d+)$/.exec(ref);
    assert.ok(m, ref);
    const [, a, b] = m!;
    assert.ok(Number(a) >= 1 && Number(b) <= totalLines, `${c.id}: ${ref} 超出檔案範圍(共 ${totalLines} 行)`);
  }
});

Then('the written card has a {int} word body', function (this: LearningWorld, n: number) {
  const s = ctx(this);
  const cards = readAllCards(this.dir!, s.category);
  assert.equal(cards.length, 1, `預期只有一張卡,實際 ${cards.length}`);
  assert.equal(countBodyWords(cards[0]!.content.trim()), n);
});

Then('one regenerate event is logged', function (this: LearningWorld) {
  const events = readLogEvents(join(this.dir!, 'state/log.jsonl'));
  const regen = events.filter((e) => e.type === 'regenerate');
  assert.equal(regen.length, 1, JSON.stringify(events));
});

Then('that card is not written', function (this: LearningWorld) {
  const s = ctx(this);
  const cards = readAllCards(this.dir!, s.category);
  const needsReview = readJsonOr<{ title: string }[]>(join(this.dir!, 'state/needs-review.json'), []);
  assert.ok(needsReview.length >= 1, '應該至少有一張卡進入 needs-review');
  for (const nr of needsReview) {
    assert.ok(!cards.some((c) => c.data.title === nr.title), `${nr.title} 不應被寫入`);
  }
});

Then('it is recorded in the needs review file with all three attempts', function (this: LearningWorld) {
  const needsReview = readJsonOr<{ attempts: unknown[] }[]>(join(this.dir!, 'state/needs-review.json'), []);
  assert.equal(needsReview.length, 1, JSON.stringify(needsReview));
  assert.equal(needsReview[0]!.attempts.length, 3, JSON.stringify(needsReview[0]));
});

Then('the other cards are still produced', function (this: LearningWorld) {
  const s = ctx(this);
  const cards = readAllCards(this.dir!, s.category);
  assert.ok(cards.length >= 1, '正常的卡也應該被寫入');
});

Then('the number of cards is unchanged', function (this: LearningWorld) {
  const s = ctx(this);
  assert.equal(readAllCards(this.dir!, s.category).length, this.cardCountBefore);
});

Then('it reports that the file was already processed', function (this: LearningWorld) {
  const s = ctx(this);
  assert.ok(s.lastResult?.alreadyProcessed, JSON.stringify(s.lastResult));
});

Then('they are numbered sec-{int}, sec-{int} and sec-{int}', function (this: LearningWorld, a: number, b: number, c: number) {
  const s = ctx(this);
  const expected = [a, b, c].map((n) => `sec-${String(n).padStart(4, '0')}`);
  assert.deepEqual(s.lastResult?.cardsCreated, expected);
});

Then('the log contains an ingested event', function (this: LearningWorld) {
  const events = readLogEvents(join(this.dir!, 'state/log.jsonl'));
  assert.ok(events.some((e) => e.type === 'ingested'), JSON.stringify(events));
});

Then('it records the file, the number of cards created and the duration', function (this: LearningWorld) {
  const s = ctx(this);
  const events = readLogEvents(join(this.dir!, 'state/log.jsonl'));
  const ev = events.find((e) => e.type === 'ingested');
  assert.ok(ev, 'log 裡沒有 ingested 事件');
  assert.equal(ev!.file, s.rawRelPath);
  assert.equal(typeof ev!.cards_created, 'number');
  assert.equal(typeof ev!.duration_ms, 'number');
});

Then('no cards are written', function (this: LearningWorld) {
  const s = ctx(this);
  const cards = readAllCards(this.dir!, s.category);
  assert.equal(cards.length, 0, JSON.stringify(cards.map((c) => c.id)));
});

Then('it reports that ingest needs a cloud model', function (this: LearningWorld) {
  const s = ctx(this);
  assert.match(s.lastResult?.message ?? '', /雲端|cloud/i);
});

Then('it does not fall back to a local model', function (this: LearningWorld) {
  assert.equal(this.llmCalls.length, 1, `應該只嘗試一次雲端呼叫,不該有額外的本機呼叫:${JSON.stringify(this.llmCalls)}`);
});

Then('it reports that the file has no usable content', function (this: LearningWorld) {
  const s = ctx(this);
  assert.match(s.lastResult?.message ?? '', /沒有可用內容|空白/);
});

Then('it exits with a non zero status', function (this: LearningWorld) {
  const s = ctx(this);
  assert.notEqual(s.lastResult?.exitCode, 0);
});
