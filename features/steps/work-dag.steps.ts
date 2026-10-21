/**
 * 13-work-dag phase-1 的步驟定義(工單 T33)。測試 agent(-e5)寫;開發 worker 不改。
 *
 * 步驟只是薄薄一層轉接:把 .feature 裡的假樹寫進暫存目錄、起 `scripts/dag.ts` 子行程、比輸出。
 * 解析與排序的邏輯都在 scripts/dag.ts,單元測試在 scripts/dag.test.ts。
 *
 * - 假樹:`<暫存>/features/<folder>/FEATURE.md`(Phase 表)與 `NEXT.md`;決策地圖在 `<暫存>/docs/02-decision-map.md`。
 * - tag 場景:在暫存樹 `git init`、空 commit、`git tag`(真的 git,沒有測試專用旗標)。
 * - 子行程用乾淨的 env(去掉 NODE_OPTIONS):cucumber 本身是 `--import=tsx` 啟動的,不該汙染被測指令。
 * - 「it exits with status {int}」是 common.steps.ts 的通用步驟,讀 world.lastRun.status;這裡的 When 負責填 lastRun。
 */
import { After, DataTable, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT, type LearningWorld } from './_world.js';

const DAG_TS = join(ROOT, 'scripts/dag.ts');
const TSX_CLI = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const FIXTURES = join(ROOT, 'features/13-work-dag/fixtures');

interface DagScratch {
  /** 假樹或暫存樹的根(也放進 world.dir,讓 After 清掉) */
  root?: string;
  /** 其他要清掉的暫存目錄(例如「空的暫存資料夾」) */
  extra: string[];
  /** 「記下每個檔的位元組」之後的快照 */
  recorded?: Record<string, string>;
  /** 跑兩次時的兩份輸出 */
  outputs: string[];
}

const scratchByWorld = new WeakMap<LearningWorld, DagScratch>();
function scratch(world: LearningWorld): DagScratch {
  let s = scratchByWorld.get(world);
  if (!s) {
    s = { extra: [], outputs: [] };
    scratchByWorld.set(world, s);
  }
  return s;
}

After(function (this: LearningWorld) {
  const s = scratchByWorld.get(this);
  if (s) for (const d of s.extra) rmSync(d, { recursive: true, force: true });
  scratchByWorld.delete(this);
});

// ───────────────────────────────────────────────────────────────────── 小工具
export function treeRoot(world: LearningWorld): string {
  const s = scratch(world);
  if (!s.root) {
    s.root = mkdtempSync(join(tmpdir(), 'lc-dag-'));
    world.dir = s.root;
  }
  return s.root;
}

export function runDag(world: LearningWorld, args: string[], envExtra: Record<string, string> = {}): void {
  const env = { ...process.env, ...envExtra };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [TSX_CLI, DAG_TS, ...args], { cwd: ROOT, encoding: 'utf8', env, timeout: 90_000 });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  world.lastRun = { status: r.error ? null : r.status, stdout, stderr, output: stdout + stderr };
}

export const lines = (world: LearningWorld): string[] => (world.lastRun?.stdout ?? '').split('\n');

function mermaidBlock(world: LearningWorld): string[] | null {
  const all = lines(world);
  const start = all.indexOf('```mermaid');
  if (start === -1) return null;
  const end = all.indexOf('```', start + 1);
  if (end === -1) return null;
  return all.slice(start + 1, end);
}

/** 每個檔(含目錄)的相對路徑 → 內容雜湊 */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = relative(root, p);
      if (statSync(p).isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(p);
      } else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=lc-test', '-c', 'user.email=lc-test@example.invalid', '-C', root, ...args], { stdio: 'pipe' });
}

// ───────────────────────────────────────────────────────────────────── Given
Given('the fake tree has these features:', function (this: LearningWorld, table: DataTable) {
  const root = treeRoot(this);
  const byFolder = new Map<string, { phase: string; status: string }[]>();
  for (const row of table.hashes()) {
    const rows = byFolder.get(row.folder!) ?? [];
    rows.push({ phase: row.phase!, status: row.status! });
    byFolder.set(row.folder!, rows);
  }
  for (const [folder, rows] of byFolder) {
    const dir = join(root, 'features', folder);
    mkdirSync(dir, { recursive: true });
    const body = rows.map((r) => `| ${r.phase} | title ${r.phase} | Wave 0 | ${r.status} | |`).join('\n');
    writeFileSync(join(dir, 'FEATURE.md'), `# ${folder}\n\n## Phase\n\n| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n${body}\n`);
  }
});

function writeNext(world: LearningWorld, folder: string, text: string): void {
  const dir = join(treeRoot(world), 'features', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'NEXT.md'), `${text}\n`);
}

Given('the next file of {string} says:', function (this: LearningWorld, folder: string, doc: string) {
  writeNext(this, folder, doc);
});

Given('the next file of {string} says {string}', function (this: LearningWorld, folder: string, text: string) {
  writeNext(this, folder, text);
});

Given('the tree has the tag {string}', function (this: LearningWorld, tag: string) {
  const root = treeRoot(this);
  if (!existsSync(join(root, '.git'))) {
    git(root, 'init', '-q');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'fixture');
  }
  git(root, 'tag', tag);
});

Given('the fake tree has a decision map with the heading {string}', function (this: LearningWorld, heading: string) {
  const dir = join(treeRoot(this), 'docs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '02-decision-map.md'), `# Decision map\n\n${heading}\n\n- **Status**: accepted\n`);
});

Given('the fake tree has a feature folder {string} whose FEATURE file has no phase table', function (this: LearningWorld, folder: string) {
  const dir = join(treeRoot(this), 'features', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'FEATURE.md'), `# ${folder}\n\n## One line\n\nNo phase table here.\n`);
});

Given('the bundled fixture tree {string} is copied to a temporary directory', function (this: LearningWorld, name: string) {
  const root = treeRoot(this);
  cpSync(join(FIXTURES, name), root, { recursive: true });
});

Given('the bytes of every file in the temporary tree are recorded', function (this: LearningWorld) {
  const s = scratch(this);
  s.recorded = snapshot(treeRoot(this));
});

// ───────────────────────────────────────────────────────────────────── When
When('the dag tool runs on the bundled fixture tree {string}', { timeout: 120_000 }, function (this: LearningWorld, name: string) {
  runDag(this, ['--root', join(FIXTURES, name)]);
});

When('the dag tool runs on the fake tree', { timeout: 120_000 }, function (this: LearningWorld) {
  runDag(this, ['--root', treeRoot(this)]);
});

When('the dag tool runs on the temporary tree', { timeout: 120_000 }, function (this: LearningWorld) {
  runDag(this, ['--root', treeRoot(this)]);
});

When('the dag tool runs on the temporary tree twice', { timeout: 180_000 }, function (this: LearningWorld) {
  const s = scratch(this);
  s.outputs = [];
  for (let i = 0; i < 2; i += 1) {
    runDag(this, ['--root', treeRoot(this)]);
    s.outputs.push(this.lastRun?.stdout ?? '');
  }
});

When('the dag tool runs with the arguments {string}', { timeout: 120_000 }, function (this: LearningWorld, args: string) {
  const s = scratch(this);
  let text = args;
  if (text.includes('<an empty temporary folder>')) {
    const empty = mkdtempSync(join(tmpdir(), 'lc-dag-empty-'));
    s.extra.push(empty);
    text = text.replace('<an empty temporary folder>', empty);
  }
  runDag(this, text.split(/\s+/).filter((a) => a !== ''));
});

// ───────────────────────────────────────────────────────────────────── Then
Then('the report has the line {string}', function (this: LearningWorld, line: string) {
  assert.ok(lines(this).includes(line), `報告裡沒有這一整行:${line}\n--- 報告 ---\n${this.lastRun?.stdout ?? '(沒有輸出)'}\n--- stderr ---\n${this.lastRun?.stderr ?? ''}`);
});

Then('the report has no READY line for {string}', function (this: LearningWorld, node: string) {
  const hit = lines(this).filter((l) => l === `READY ${node}` || l.startsWith(`READY ${node} `));
  assert.deepEqual(hit, [], `不該有 ${node} 的 READY 行`);
});

Then('the report has no BLOCKED line for {string}', function (this: LearningWorld, node: string) {
  const hit = lines(this).filter((l) => l.startsWith(`BLOCKED ${node} `));
  assert.deepEqual(hit, [], `不該有 ${node} 的 BLOCKED 行`);
});

Then('the summary line says {string}', function (this: LearningWorld, fragment: string) {
  const summary = lines(this).filter((l) => l.startsWith('gate=dag '));
  assert.equal(summary.length, 1, `應該剛好一行摘要行,實際 ${summary.length} 行\n${this.lastRun?.stdout ?? ''}`);
  assert.ok(summary[0]!.includes(fragment), `摘要行是「${summary[0]}」,沒有「${fragment}」`);
  assert.ok(summary[0]!.startsWith('gate=dag result=OK '), `摘要行開頭應為 gate=dag result=OK:${summary[0]}`);
});

Then('the report contains a mermaid block that starts with {string}', function (this: LearningWorld, first: string) {
  const block = mermaidBlock(this);
  assert.ok(block, `報告裡沒有 mermaid 圍欄區塊\n${this.lastRun?.stdout ?? ''}`);
  assert.equal(block[0], first, `mermaid 區塊第一行應為「${first}」,實際「${block[0]}」`);
});

Then('the mermaid block has an edge from {string} to {string}', function (this: LearningWorld, from: string, to: string) {
  const block = mermaidBlock(this);
  assert.ok(block, '報告裡沒有 mermaid 圍欄區塊');
  const want = `"${from}" --> "${to}"`;
  assert.ok(block.some((l) => l.trim() === want), `mermaid 區塊沒有邊 ${want}\n${block.join('\n')}`);
});

Then(/^the mermaid block has exactly (\d+) edges?$/, function (this: LearningWorld, count: string) {
  const block = mermaidBlock(this);
  assert.ok(block, '報告裡沒有 mermaid 圍欄區塊');
  const edges = block.filter((l) => l.includes('-->'));
  assert.equal(edges.length, Number(count), `邊數應為 ${count},實際 ${edges.length}\n${block.join('\n')}`);
});

Then('the mermaid block has no node {string}', function (this: LearningWorld, node: string) {
  const block = mermaidBlock(this);
  assert.ok(block, '報告裡沒有 mermaid 圍欄區塊');
  assert.ok(!block.some((l) => l.includes(`"${node}"`)), `mermaid 區塊不該出現節點 ${node}\n${block.join('\n')}`);
});

Then('the report is not empty', function (this: LearningWorld) {
  const s = scratch(this);
  const text = s.outputs.length > 0 ? s.outputs[0]! : (this.lastRun?.stdout ?? '');
  assert.ok(text.trim().length > 0, '報告是空的');
});

Then('the bytes of every file in the temporary tree are the same as recorded', function (this: LearningWorld) {
  const s = scratch(this);
  assert.ok(s.recorded, '還沒有記下每個檔的位元組');
  const now = snapshot(treeRoot(this));
  const changed = Object.keys(s.recorded).filter((k) => k in now && now[k] !== s.recorded![k]);
  assert.deepEqual(changed, [], `這些檔的內容變了:${changed.join(', ')}`);
});

Then('no file was added to or removed from the temporary tree', function (this: LearningWorld) {
  const s = scratch(this);
  assert.ok(s.recorded, '還沒有記下每個檔的位元組');
  const now = Object.keys(snapshot(treeRoot(this))).sort();
  assert.deepEqual(now, Object.keys(s.recorded).sort(), '檔案(或目錄)有增減');
});

Then('the two reports are identical byte for byte', function (this: LearningWorld) {
  const s = scratch(this);
  assert.equal(s.outputs.length, 2, '應該有兩份輸出');
  assert.equal(s.outputs[1], s.outputs[0], '兩次輸出不一樣');
});

Then('the error output contains {string}', function (this: LearningWorld, text: string) {
  assert.ok((this.lastRun?.stderr ?? '').includes(text), `stderr 沒有「${text}」:\n${this.lastRun?.stderr ?? ''}`);
});

Then('the standard output has no summary line', function (this: LearningWorld) {
  assert.ok(!(this.lastRun?.stdout ?? '').includes('gate=dag'), `stdout 不該有摘要行:\n${this.lastRun?.stdout ?? ''}`);
});
