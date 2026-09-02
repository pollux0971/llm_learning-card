import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ROOT, type LearningWorld } from './_world.js';
import { lint, scanDir, countBodyWords, type LintResult } from '../../packages/core/src/lint/index.js';

// -------------------------------------------------------------- 情境暫存

interface LintScratch {
  targetCardId?: string;
  targetWordCount?: number;
  targetMissingId?: string;
  targetPath?: string;
  snapshot?: Record<string, string>;
}

const scratchByWorld = new WeakMap<LearningWorld, LintScratch>();

function scratch(world: LearningWorld): LintScratch {
  let s = scratchByWorld.get(world);
  if (!s) {
    s = {};
    scratchByWorld.set(world, s);
  }
  return s;
}

function dirOf(world: LearningWorld): string {
  if (!world.dir) throw new Error('尚未載入 fixture 目錄');
  return world.dir;
}

function runLintCore(world: LearningWorld): LintResult {
  const result = lint(dirOf(world));
  world.lastResult = result;
  return result;
}

function lastLintResult(world: LearningWorld): LintResult {
  if (!world.lastResult) return runLintCore(world);
  return world.lastResult as LintResult;
}

function relevantFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (sub: string) => {
    const full = join(dir, sub);
    if (!existsSync(full)) return;
    for (const name of readdirSync(full, { withFileTypes: true })) {
      const rel = `${sub}/${name.name}`;
      if (name.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk('cards');
  walk('questions');
  walk('graph');
  files.push('state/reviews.json');
  return files.filter((f) => existsSync(join(dir, f)));
}

function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of relevantFiles(dir)) out[rel] = readFileSync(join(dir, rel), 'utf8');
  return out;
}

// -------------------------------------------------------------- Given

Given('the deliberately broken fixture directory', function (this: LearningWorld) {
  this.useFixture('learning-broken');
});

Given('a card whose body was edited past the limit', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  const over = scanned.cards
    .map((c) => ({ id: c.id, n: countBodyWords(c.parsed.body) }))
    .filter((c) => c.n > 100)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  assert.ok(over, 'fixture 裡應該有一張超過字數上限的卡片');
  scratch(this).targetCardId = over.id;
  scratch(this).targetWordCount = over.n;
});

Given('a card whose question file was deleted', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  const withQuestions = new Set(scanned.questions.map((q) => q.id));
  const missing = scanned.cards.map((c) => c.id).filter((id) => !withQuestions.has(id)).sort()[0];
  assert.ok(missing, 'fixture 裡應該有一張沒有考題檔的卡片');
  scratch(this).targetCardId = missing;
});

Given('a question file whose card does not exist', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const orphan = scanned.questions.filter((q) => !cardIds.has(q.card)).sort((a, b) => a.card.localeCompare(b.card))[0];
  assert.ok(orphan, 'fixture 裡應該有一份孤兒考題檔');
  scratch(this).targetCardId = orphan.card;
  scratch(this).targetPath = orphan.path;
});

Given('a card listing a prerequisite that does not exist', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  for (const c of scanned.cards.sort((a, b) => a.id.localeCompare(b.id))) {
    const missing = (c.parsed.frontmatter.prereqs ?? []).find((p) => !cardIds.has(p));
    if (missing) {
      scratch(this).targetCardId = c.id;
      scratch(this).targetMissingId = missing;
      return;
    }
  }
  assert.fail('fixture 裡應該有一張 prereq 指向不存在卡片的卡片');
});

Given('a card whose parent does not exist', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const orphan = scanned.cards
    .filter((c) => c.parsed.frontmatter.parent && !cardIds.has(c.parsed.frontmatter.parent))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  assert.ok(orphan, 'fixture 裡應該有一張 parent 不存在的卡片');
  scratch(this).targetCardId = orphan.id;
  scratch(this).targetMissingId = orphan.parsed.frontmatter.parent!;
});

Given('the graph contains a cycle', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  assert.ok(Object.keys(scanned.graphs).length > 0, 'fixture 應該有 graph/deps.json');
});

// 09-lint 對迴圈成員不重複跑「prereqs 與 graph 不一致」檢查(見 EXPECTED.md),
// broken fixture 裡唯一的不一致案例都在迴圈上,所以這裡另外接上一組乾淨的卡片
// 來驗證這個檢查本身——不是造假資料,是把「迴圈」跟「不一致」兩個獨立檢查分開測。
Given('a card whose prereqs do not match the graph edges', function (this: LearningWorld) {
  const dir = dirOf(this);
  const cardA = 'sec-0095';
  const cardB = 'sec-0096';
  writeFileSync(
    join(dir, `cards/security/${cardA}.md`),
    matter.stringify('乾淨的一句正文。', {
      id: cardA,
      category: 'security',
      title: '不一致測試 A',
      level: 0,
      source: 'llm',
      created: '2026-09-01',
      prereqs: [],
    }),
  );
  writeFileSync(
    join(dir, `cards/security/${cardB}.md`),
    matter.stringify('乾淨的一句正文。', {
      id: cardB,
      category: 'security',
      title: '不一致測試 B',
      level: 0,
      source: 'llm',
      created: '2026-09-01',
      prereqs: [], // graph 會說應該是 [sec-0095],故意跟這裡不一致
    }),
  );

  const graphPath = join(dir, 'graph/deps.json');
  const graphs = JSON.parse(readFileSync(graphPath, 'utf8')) as Record<string, { nodes: string[]; edges: [string, string][] }>;
  graphs.security!.nodes.push(cardA, cardB);
  graphs.security!.edges.push([cardA, cardB]);
  writeFileSync(graphPath, JSON.stringify(graphs, null, 2));

  scratch(this).targetCardId = cardB;
});

Given('two cards marked stale and one marked as having a missing source', function (this: LearningWorld) {
  const dir = dirOf(this);
  // sec-0004 已經是 stale;再加一張 stale 與一張 source_missing,湊成「兩張 stale、一張缺來源」
  markFrontmatter(join(dir, 'cards/security/sec-0002.md'), { stale: true });
  markFrontmatter(join(dir, 'cards/security/sec-0003.md'), { source_missing: true });
});

function markFrontmatter(path: string, patch: Record<string, unknown>): void {
  const { data, content } = matter(readFileSync(path, 'utf8'));
  writeFileSync(path, matter.stringify(content, { ...data, ...patch }));
}

Given('the review state names a card that no longer exists', function (this: LearningWorld) {
  const scanned = scanDir(dirOf(this));
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const orphan = Object.keys(scanned.reviews).filter((id) => !cardIds.has(id)).sort()[0];
  assert.ok(orphan, 'fixture 的 reviews.json 裡應該有一筆指向不存在卡片的紀錄');
  scratch(this).targetCardId = orphan;
});

// -------------------------------------------------------------- When

When('the standalone lint command is run against the broken fixture', function (this: LearningWorld) {
  this.runStandalone('09-lint');
  // standalone.json 的指令直接指向 contracts/fixtures/learning-broken(不是暫存複本),
  // lint 會在那裡寫報告檔——測試跑完清乾淨,不留下未追蹤的檔案。
  cleanupGeneratedReports('contracts/fixtures/learning-broken');
});

function cleanupGeneratedReports(relDir: string): void {
  const stateDir = join(ROOT, relDir, 'state');
  if (!existsSync(stateDir)) return;
  for (const name of readdirSync(stateDir)) {
    if (/^lint-report-\d{4}-\d{2}-\d{2}\.md$/.test(name)) {
      unlinkSync(join(stateDir, name));
    }
  }
}

When('lint is run against the minimal fixture', function (this: LearningWorld) {
  this.useFixture('learning-minimal');
  this.runCommand(`npx tsx scripts/lint.ts --dir ${this.dir}`);
  runLintCore(this);
});

// 這句在好幾個情境裡出現,包括「A report is written」——所以一律真的跑 CLI
// (寫報告檔、有終端機輸出),再另外算一次結構化結果給其他 Then 用。
When('lint runs', function (this: LearningWorld) {
  this.runCommand(`npx tsx scripts/lint.ts --dir ${dirOf(this)}`);
  runLintCore(this);
});

When('lint runs against the broken fixture', function (this: LearningWorld) {
  runLintCore(this);
});

When('lint runs with no options', function (this: LearningWorld) {
  const dir = dirOf(this);
  scratch(this).snapshot = snapshotDir(dir);
  this.runCommand(`npx tsx scripts/lint.ts --dir ${dir}`);
});

// -------------------------------------------------------------- Then

Then('it reports no problems', function (this: LearningWorld) {
  const result = lastLintResult(this);
  assert.deepEqual(result.problems, []);
});

Then('it prints one line per problem', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過指令');
  const lines = problemSectionLines(this.lastRun.output);
  const declared = /(\d+) problems found/.exec(this.lastRun.output);
  assert.ok(declared, `輸出應該有「N problems found」:${this.lastRun.output.slice(0, 400)}`);
  assert.equal(lines.length, Number(declared[1]), '問題行數應該等於宣告的問題數');
  assert.ok(lines.length > 0, 'broken fixture 應該至少有一個問題');
});

Then('the card and its actual word count are reported', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  const problem = result.problems.find((p) => p.type === 'body_over_limit' && p.card === s.targetCardId);
  assert.ok(problem, `應該回報 ${s.targetCardId} 超過字數上限`);
  const reportedCount = Number(/(\d+)/.exec(problem!.detail)?.[1]);
  assert.equal(reportedCount, s.targetWordCount, '回報的字數應該跟實際算出來的一樣');
});

Then('that card is reported as missing its questions', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  assert.ok(
    result.problems.some((p) => p.type === 'missing_questions' && p.card === s.targetCardId),
    `${s.targetCardId} 應該被報缺考題`,
  );
});

Then('that question file is reported as orphaned', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  assert.ok(
    result.problems.some((p) => p.type === 'orphan_questions' && p.card === s.targetCardId),
    `${s.targetCardId} 的考題檔應該被報孤兒`,
  );
});

Then('that card and the missing prerequisite are reported', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  const problem = result.problems.find((p) => p.type === 'missing_prereq' && p.card === s.targetCardId);
  assert.ok(problem, `${s.targetCardId} 應該被報 prereq 缺失`);
  assert.ok(problem!.detail.includes(s.targetMissingId!), '應該提到缺的是哪個 id');
});

Then('that card and the missing parent are reported', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  const problem = result.problems.find((p) => p.type === 'orphan_child' && p.card === s.targetCardId);
  assert.ok(problem, `${s.targetCardId} 應該被報 parent 缺失`);
  assert.ok(problem!.detail.includes(s.targetMissingId!), '應該提到缺的是哪個 parent id');
});

Then('the cycle is reported as a path', function (this: LearningWorld) {
  const result = lastLintResult(this);
  const problem = result.problems.find((p) => p.type === 'cycle');
  assert.ok(problem, '應該找到迴圈');
  const pathPart = problem!.detail.split(':').slice(1).join(':').trim();
  const nodes = pathPart.split('→').map((s) => s.trim());
  assert.ok(nodes.length >= 3, `迴圈路徑至少要有 3 個節點(含頭尾重複):${problem!.detail}`);
  assert.equal(nodes[0], nodes[nodes.length - 1], '路徑的頭尾應該是同一個節點,證明真的是迴圈');
});

Then('each disagreement is reported', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  const mismatches = result.problems.filter((p) => p.type === 'prereq_mismatch');
  assert.ok(
    mismatches.some((p) => p.card === s.targetCardId),
    `${s.targetCardId} 的 prereqs 應該被報跟 graph 不一致`,
  );
});

Then('the two groups are reported separately', function (this: LearningWorld) {
  const result = lastLintResult(this);
  const stale = result.statuses.filter((s) => s.type === 'stale');
  const sourceMissing = result.statuses.filter((s) => s.type === 'source_missing');
  assert.equal(stale.length, 2, `應該有兩張 stale 卡片:${JSON.stringify(result.statuses)}`);
  assert.equal(sourceMissing.length, 1, `應該有一張缺來源的卡片:${JSON.stringify(result.statuses)}`);
  // 狀態不是問題:不該混進 problems,也不影響退出碼判斷
  assert.ok(result.problems.every((p) => (p.type as string) !== 'stale' && (p.type as string) !== 'source_missing'));
});

Then('that entry is reported', function (this: LearningWorld) {
  const s = scratch(this);
  const result = lastLintResult(this);
  assert.ok(
    result.problems.some((p) => p.type === 'review_orphan' && p.card === s.targetCardId),
    `${s.targetCardId} 的複習紀錄應該被報孤兒`,
  );
});

Then('a dated report file is written under the state directory', function (this: LearningWorld) {
  const stateDir = join(dirOf(this), 'state');
  const files = existsSync(stateDir) ? readdirSync(stateDir) : [];
  assert.ok(
    files.some((f) => /^lint-report-\d{4}-\d{2}-\d{2}\.md$/.test(f)),
    `state/ 底下應該有帶日期的報告檔:${files.join(', ')}`,
  );
});

Then('each problem occupies one line with a type, a card id and a path', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過指令');
  const lines = problemSectionLines(this.lastRun.output);
  assert.ok(lines.length > 0, '應該至少有一個問題');
  for (const line of lines) {
    const parts = line.slice(2).split(/\s+/);
    assert.ok(parts.length >= 3, `每行應該有型別、卡片 id、路徑三個欄位:${line}`);
  }
});

/** 只取「## Problems」小節底下的項目行,不要跟後面的「## status: …」小節混在一起 */
function problemSectionLines(output: string): string[] {
  const lines = output.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Problems');
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) out.push(line);
  }
  return out;
}

Then('the report opens with a count of problems', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過指令');
  const head = this.lastRun.output.split('\n').slice(0, 6).join('\n');
  assert.ok(/\d+ problems found\./.test(head), `報告開頭應該有問題數:${head}`);
});

Then('the same content is printed to the terminal', function (this: LearningWorld) {
  assert.ok(this.lastRun, '還沒有跑過指令');
  const stateDir = join(dirOf(this), 'state');
  const files = readdirSync(stateDir).filter((f) => /^lint-report-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.ok(files.length > 0, '應該有報告檔可以比對');
  const reportContent = readFileSync(join(stateDir, files[0]!), 'utf8').trim();
  assert.ok(this.lastRun.output.includes(reportContent), '終端機輸出應該包含跟報告檔一樣的內容');
});

Then('the cards, questions, graph and review state are byte identical to before', function (this: LearningWorld) {
  const s = scratch(this);
  assert.ok(s.snapshot, '還沒有拍過快照');
  const after = snapshotDir(dirOf(this));
  assert.deepEqual(after, s.snapshot, 'lint 不應該改動 cards / questions / graph / review state');
});

Then('the number of reported problems equals the number the fixture documents', function (this: LearningWorld) {
  const result = lastLintResult(this);
  const expectedMd = readFileSync(join(ROOT, 'contracts/fixtures/learning-broken/EXPECTED.md'), 'utf8');
  const rows = expectedMd.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  assert.ok(rows.length > 0, 'EXPECTED.md 應該有問題列表的表格');
  assert.equal(result.problems.length, rows.length, `lint 找到的問題數應該等於 EXPECTED.md 記錄的 ${rows.length} 個`);
});
