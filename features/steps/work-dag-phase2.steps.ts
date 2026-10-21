/**
 * 13-work-dag phase-2 的步驟定義(工單 T39)。測試 agent(-5c)寫;開發 worker 不改。
 *
 * 跟 phase-1 一樣只是薄薄一層轉接:把假樹(工單檔、落點表)寫進暫存目錄、起 `scripts/dag.ts` 子行程、比輸出。
 * 規則本身(R1–R5、落點比對、檔頭解析)都在 scripts/dag.ts,單元測試在 scripts/dag.test.ts。
 * 跟 phase-1 共用的步驟(「the fake tree has these features:」「the report has the line」「the summary line says」
 * 「the dag tool runs on the fake tree」…)定義在 work-dag.steps.ts,這裡不重複;假樹的根用它匯出的 treeRoot。
 *
 * - 「the dag check runs on the fake tree」= 加 `--check`(`npm run dag:check` 背後的指令)。
 * - 「--orca」的輸出照 FEATURE.md「輸出形狀」:一行一個 `Tn=$(orca orchestration task-create …)`;
 *   整行由 features/support/dag-p2-harness.ts 的 orcaLine 組出(步驟文字不塞反斜線)。
 * - 假的 `orca`:PATH 最前面放一支會記錄每次呼叫的程式;工具只印不執行,所以它一次都不該被叫到。
 */
import { Given, Then, When, type DataTable } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import {
  addLandingRow,
  DEFAULT_HEADER,
  headerFile,
  isTaskLine,
  makeOrcaStub,
  orcaLine,
  stubWasCalled,
  ticketFileName,
  writeLanding,
  writeRaw,
  writeTicket,
} from '../support/dag-p2-harness.js';
import { ROOT, type LearningWorld } from './_world.js';
import { lines, runDag, treeRoot } from './work-dag.steps.js';

interface P2State {
  stub?: { dir: string; log: string };
  gates?: { chain?: string[] };
  pkg?: { scripts?: Record<string, string> };
}
const stateByWorld = new WeakMap<LearningWorld, P2State>();
function state(world: LearningWorld): P2State {
  let s = stateByWorld.get(world);
  if (!s) {
    s = {};
    stateByWorld.set(world, s);
  }
  return s;
}

// ───────────────────────────────────────────────────────────────────── Given
Given('the fake tree has this landing table:', function (this: LearningWorld, table: DataTable) {
  const rows = table.hashes().map((r) => [r.prefix!, r.landing!] as [string, string]);
  writeLanding(treeRoot(this), rows);
});

Given('the landing table also has the row {string} to {string}', function (this: LearningWorld, prefix: string, landing: string) {
  addLandingRow(treeRoot(this), prefix, landing);
});

Given('the fake tree has these tickets:', function (this: LearningWorld, table: DataTable) {
  const root = treeRoot(this);
  const seen = new Map<string, number>();
  for (const r of table.hashes()) {
    const id = r.id!;
    // 同一個 id 出現第二次(重複 id 場景):檔名加序號,否則第二張把第一張蓋掉
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const fileName = n === 1 ? ticketFileName(id) : `${id}-example-${n}.md`;
    writeTicket(root, { id, deps: r.deps ?? '', touches: r.touches ?? '', cpu: r.cpu, status: r.status, budget_usd: r.budget_usd, owner: r.owner }, fileName);
  }
});

Given('the ticket file {string} has a valid header except that {string} is missing', function (this: LearningWorld, file: string, field: string) {
  const fields: Record<string, string | undefined> = { ...DEFAULT_HEADER };
  fields[field] = undefined;
  writeRaw(treeRoot(this), `docs/tickets/${file}`, headerFile(fields));
});

Given('the ticket file {string} has a valid header except that {string} is {string}', function (this: LearningWorld, file: string, field: string, value: string) {
  const fields: Record<string, string | undefined> = { ...DEFAULT_HEADER };
  fields[field] = value;
  writeRaw(treeRoot(this), `docs/tickets/${file}`, headerFile(fields));
});

Given('the ticket file {string} has a valid header whose {string} is written one item per line with commas inside the items', function (this: LearningWorld, file: string, field: string) {
  const fields: Record<string, string | undefined> = { ...DEFAULT_HEADER, [field]: '@@ITEMS@@' };
  const text = headerFile(fields).replace(`${field}: @@ITEMS@@`, `${field}:\n  - 第一項,裡面有逗號, 還有第二個逗號\n  - 第二項(a, b, c)`);
  writeRaw(treeRoot(this), `docs/tickets/${file}`, text);
});

Given('the same header writes {string} and {string} as lists on one line followed by a comment', function (this: LearningWorld, a: string, b: string) {
  const dir = join(treeRoot(this), 'docs/tickets');
  const file = join(dir, 'T9-example.md');
  let text = readFileSync(file, 'utf8');
  const values: Record<string, string> = { deps: '[]', touches: '[docs/a/, scripts/dag.ts]' };
  for (const field of [a, b]) {
    const re = new RegExp(`^${field}:.*$`, 'm');
    assert.ok(re.test(text), `檔頭沒有 ${field} 這一行`);
    text = text.replace(re, `${field}: ${values[field]}   # 這一行後面有註解,不是清單的一部分`);
  }
  writeFileSync(file, text, 'utf8');
});

Given(
  'the fake tree has a chain of tickets T1 to T5 where each depends on the one before and the status of T1 is {string}',
  function (this: LearningWorld, first: string) {
    const root = treeRoot(this);
    for (let n = 1; n <= 5; n += 1) {
      writeTicket(root, { id: `T${n}`, deps: n === 1 ? '' : `T${n - 1}`, touches: 'docs/a/', status: n === 1 ? first : 'todo' });
    }
  },
);

Given('a stub program named {string} is first on the path and records every call', function (this: LearningWorld, name: string) {
  assert.equal(name, 'orca');
  state(this).stub = makeOrcaStub(treeRoot(this));
});

Given('the fake tree has a ticket file {string} with no header', function (this: LearningWorld, file: string) {
  writeRaw(treeRoot(this), `docs/tickets/${file}`, '# 沒有檔頭的舊工單\n\n第一行不是 ---。\n');
});

Given('the gates configuration of this repository', function (this: LearningWorld) {
  state(this).gates = JSON.parse(readFileSync(join(ROOT, 'scripts/gates.config.json'), 'utf8')) as { chain?: string[] };
});

Given('the package file of this repository', function (this: LearningWorld) {
  state(this).pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
});

// ───────────────────────────────────────────────────────────────────── When
When('the dag check runs on the fake tree', { timeout: 120_000 }, function (this: LearningWorld) {
  runDag(this, ['--root', treeRoot(this), '--check']);
});

When('the dag tool runs on the fake tree with the flag {string}', { timeout: 120_000 }, function (this: LearningWorld, flag: string) {
  const stub = state(this).stub;
  const extra = stub ? { PATH: `${stub.dir}${delimiter}${process.env.PATH ?? ''}` } : {};
  runDag(this, ['--root', treeRoot(this), flag], extra);
});

// ───────────────────────────────────────────────────────────────────── Then
Then('the report has no START line for {string}', function (this: LearningWorld, node: string) {
  const hit = lines(this).filter((l) => l === `START ${node}` || l.startsWith(`START ${node} `));
  assert.deepEqual(hit, [], `不該有 ${node} 的 START 行\n${this.lastRun?.stdout ?? ''}`);
});

Then('the report has no HELD line for {string}', function (this: LearningWorld, node: string) {
  const hit = lines(this).filter((l) => l.startsWith(`HELD ${node} `));
  assert.deepEqual(hit, [], `不該有 ${node} 的 HELD 行\n${this.lastRun?.stdout ?? ''}`);
});

Then('the report has no line starting with {string}', function (this: LearningWorld, prefix: string) {
  const hit = lines(this).filter((l) => l.startsWith(prefix));
  assert.deepEqual(hit, [], `不該有以「${prefix}」開頭的行\n${this.lastRun?.stdout ?? ''}`);
});

Then(/^the report (has|has no) a line starting with "([^"]*)"$/, function (this: LearningWorld, has: string, prefix: string) {
  const hit = lines(this).filter((l) => l.startsWith(prefix));
  if (has === 'has') assert.ok(hit.length > 0, `報告裡沒有以「${prefix}」開頭的行\n${this.lastRun?.stdout ?? ''}`);
  else assert.deepEqual(hit, [], `不該有以「${prefix}」開頭的行\n${this.lastRun?.stdout ?? ''}`);
});

Then('the line {string} comes before the line {string}', function (this: LearningWorld, first: string, second: string) {
  const all = lines(this);
  const a = all.indexOf(first);
  const b = all.indexOf(second);
  assert.ok(a >= 0, `沒有這一整行:${first}`);
  assert.ok(b >= 0, `沒有這一整行:${second}`);
  assert.ok(a < b, `「${first}」(第 ${a + 1} 行)應該在「${second}」(第 ${b + 1} 行)前面`);
});

function taskLine(world: LearningWorld, id: string, file: string, deps: string[]): void {
  const want = orcaLine(id, file.split('/').pop()!, deps);
  assert.ok(lines(world).includes(want), `輸出裡沒有這一整行:\n${want}\n--- 輸出 ---\n${world.lastRun?.stdout ?? ''}`);
}

Then('the output has a line that creates the task for {string} from the file {string} with no dependency variables', function (this: LearningWorld, id: string, file: string) {
  taskLine(this, id, file, []);
});

Then('the output has a line that creates the task for {string} from the file {string} with the dependency variables {string}', function (this: LearningWorld, id: string, file: string, vars: string) {
  taskLine(this, id, file, vars.split(',').map((v) => v.trim()));
});

Then('the lines for {string}, {string} and {string} appear in that order', function (this: LearningWorld, a: string, b: string, c: string) {
  const all = lines(this);
  const at = (id: string): number => all.findIndex((l) => isTaskLine(l) && l.startsWith(`${id}=`));
  const [ia, ib, ic] = [at(a), at(b), at(c)];
  assert.ok(ia >= 0 && ib >= 0 && ic >= 0, `找不到三行都在:${a}=${ia} ${b}=${ib} ${c}=${ic}`);
  assert.ok(ia < ib && ib < ic, `順序不對:${a}=第${ia + 1}行 ${b}=第${ib + 1}行 ${c}=第${ic + 1}行`);
});

Then('the stub program was never called', function (this: LearningWorld) {
  const stub = state(this).stub;
  assert.ok(stub, '這個場景沒有放假的 orca');
  assert.equal(stubWasCalled(stub.log), false, `工具只印不執行,但假的 orca 被叫到了:\n${readFileSync(stub.log, 'utf8')}`);
});

Then(/^the output has exactly (\d+) lines? that creates a task$/, function (this: LearningWorld, count: string) {
  const hit = lines(this).filter(isTaskLine);
  assert.equal(hit.length, Number(count), `建 task 的行數應為 ${count},實際 ${hit.length}\n${this.lastRun?.stdout ?? ''}`);
});

Then('the check chain lists {string}', function (this: LearningWorld, name: string) {
  const chain = state(this).gates?.chain;
  assert.ok(Array.isArray(chain), 'gates.config.json 沒有 chain');
  assert.ok(chain.includes(name), `chain 裡沒有 ${name}:${chain.join(', ')}`);
});

Then('the package file has a script named {string}', function (this: LearningWorld, name: string) {
  const scripts = state(this).pkg?.scripts ?? {};
  assert.ok(typeof scripts[name] === 'string', `package.json 沒有 npm script ${name}`);
});

Then('that script runs the dag tool with the check flag', function (this: LearningWorld) {
  const cmd = state(this).pkg?.scripts?.['dag:check'] ?? '';
  assert.match(cmd, /scripts\/dag\.ts/, `dag:check 沒有跑 scripts/dag.ts:${cmd}`);
  assert.match(cmd, /(^|\s)--check(\s|$)/, `dag:check 沒有 --check:${cmd}`);
});
