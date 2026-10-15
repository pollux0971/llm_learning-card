/**
 * 10-desktop-shell / phase-2(T2c-1 起由測試 agent 維護;開發 worker 不改這個檔)。
 *
 * 邊界走 apps/desktop/src/test-support/probe-boundary.ts:webview 端真的 LearningFs,只把 Tauri 的 invoke
 * 換成「叫 probe」,probe 呼叫跟 Tauri command 同一個 learning_fs 函式。ADR-069 之後 warning 事件由 Rust 寫,
 * TS 這邊不 recordEvent;這裡只看 log.jsonl 多了幾行、每行長什麼樣。
 *
 * 只有 Rust 才看得到的東西(§11b 四步的順序、log 是不是一次 write、目錄 fsync 回什麼 errno)用
 * test-support/syscall-shim.c 在**真的** lc-fs 上記錄與注入,不是 Rust 的測試替身。
 *
 * 暫存目錄一律 mkdtemp,symlink 與哨兵檔也在那個暫存目錄裡,不指向真的 learning/。
 */
import { BeforeAll, Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { LearningWorld } from './_world.js';
import { recordEvent, validateLogEvent } from '../../packages/core/src/schema/log.js';
import { BUILD_LC_FS_TIMEOUT_MS, buildLcFs } from '../../apps/desktop/src/test-support/build-lc-fs.js';
import { decideStartup, saveChosenPath, type StartupDecision } from '../../apps/desktop/src/startup.js';
import {
  assetProtocolStatus,
  pluginDirectRead,
  type AssetProtocolStatus,
  type PluginRefusal,
} from '../../apps/desktop/src/test-support/probe-shell-config.js';
import { openProbeBoundary, type BoundaryResult, type ProbeBoundary } from '../../apps/desktop/src/test-support/probe-boundary.js';
import { hexToBytes, runProbe, type ProbeResponse, type TraceEntry } from '../../apps/desktop/src/test-support/probe.js';
import { buildSyscallShim } from '../../apps/desktop/src/test-support/syscall-shim.js';
import { missingCsp, parseCsp } from '../../apps/desktop/src/test-support/csp.js';
import {
  BUILD_FRONTENDS_TIMEOUT_MS,
  checkFrontendDist,
  frontendDistDir,
  readTauriConf,
  referencedAssets,
  runBeforeBuild,
  windowEntries,
  type TauriConf,
} from '../../apps/desktop/src/test-support/frontend-dist.js';
import { isNodeModule, isSchemaLog, scanImportGraph, type ImportGraph } from '../../apps/desktop/src/test-support/import-scan.js';
import { WEBVIEW_LEARNING_FS } from '../../apps/desktop/src/test-support/webview-learning-fs.js';

const REPO = join(import.meta.dirname, '../..');
const ATOMIC_VECTORS = join(REPO, 'packages/core/src/schema/atomic-write.vectors.json');
const SEGMENT_VECTORS = join(REPO, 'contracts/fixtures/path-segment-vectors.json');
const SEGMENT_VECTORS_SHA256 = '71dded0ecbe5376fdb9adbe417f82e0d27d756d7256d359c6516e75e8ac7a1c6';
const ATOMIC_VECTOR_COUNT = 11;
const ERRNO = osConstants.errno as Record<string, number>;
const O_APPEND = 0o2000;

/** T2b 的 apps/desktop/src-tauri/frontend/teach.html,原樣(引用 TypeScript 原始檔、沒有建置)。 */
const T2B_TEACH_HTML = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <title>教學卡</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/teach-card/src/main.ts"></script>
  </body>
</html>
`;

/**
 * cucumber 每次先重編 lc-fs(預先編好的 debug 二進位可能是舊的),再編 syscall shim。
 * 重編邏輯與 vitest 共用 apps/desktop/src/test-support/build-lc-fs.ts,不留兩份。
 */
BeforeAll({ timeout: BUILD_LC_FS_TIMEOUT_MS }, function () {
  const finished = buildLcFs();
  console.log(`lc-fs rebuilt: ${finished || 'cargo ok'}`);
  buildSyscallShim();
});

interface VectorRow {
  name: string;
  setup: { target: string; content: string; prior_target: string | null; extra_files: { name: string; bytes: string }[] };
  inject: { call: string; nth: number; code: string }[];
  expect: {
    outcome: 'ok' | 'error';
    code: string | null;
    identity?: string;
    remaining: string[];
    target_bytes: string | null;
    absent?: string[];
    untouched?: { name: string; bytes: string }[];
    order?: string[];
    tmp_basename?: string;
    fds_closed?: boolean;
    open_count?: number;
    cleanup_attempted?: boolean;
    saw_calls?: string[];
  };
}

interface VectorRun {
  name: string;
  problems: string[];
  injectedSeen: string[];
}

interface Bag {
  parent: string;
  root: string;
  outsideFile: string;
  configPath: string;
  logPath: string;
  mode: 'startup' | 'config' | 'boundary';
  boundary?: ProbeBoundary;
  last?: BoundaryResult;
  err?: unknown;
  startup?: StartupDecision;
  chosen?: string;
  linkRel?: string;
  listDir?: string;
  decoded?: string;
  requested?: string;
  bytes?: number;
  rawHash?: string;
  assetStatus?: AssetProtocolStatus;
  plugin?: PluginRefusal;
  url?: string;
  answer?: unknown;
  /** 場景用「the learning directory is in the state」指定了狀態:read 之前不要自己建檔 */
  stateGiven?: boolean;
  /** 這個場景第一個動作之前,log.jsonl 有幾行 */
  logMark?: number;
  /** 最近一個動作之前,log.jsonl 有幾行 */
  logBefore: number;
  trace: TraceEntry[];
  writtenRel?: string;
  writtenContent?: string;
  danglingTarget?: string;
  assetRel?: string;
  assetBytes?: Buffer;
  sequence?: { at: number; path: string }[] | undefined;
  endAt?: number | null;
  sequenceResp?: ProbeResponse;
  vectorRuns?: VectorRun[];
  segmentRan?: number;
  segmentIgnored?: number;
  segmentWrong?: string[];
  tsEvent?: Record<string, unknown>;
  rustEvent?: Record<string, unknown>;
  fsyncErrno?: string;
  fsyncResp?: ProbeResponse;
  conf?: TauriConf;
  distDir?: string;
  distEntries?: { label: string; html: string }[];
  distProblems?: string[];
  fixtureProblems?: string[];
  graph?: ImportGraph;
}

const bags = new WeakMap<LearningWorld, Bag>();

function bag(world: LearningWorld): Bag {
  const b = bags.get(world);
  if (!b) throw new Error('這個場景還沒建立暫存目錄');
  return b;
}

function ensure(world: LearningWorld, mode: Bag['mode']): Bag {
  const existing = bags.get(world);
  if (existing) {
    existing.mode = mode;
    return existing;
  }
  // learning_fs 會 canonicalize 根目錄;shim 比對的是 canonical 路徑。
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'lc-p2-')));
  const root = join(parent, 'learning');
  const outsideDir = join(parent, 'outside');
  mkdirSync(join(root, 'state'), { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const outsideFile = join(outsideDir, 'secret');
  writeFileSync(outsideFile, 'OUTSIDE-SENTINEL');
  world.dir = parent;
  const b: Bag = {
    parent,
    root,
    outsideFile,
    configPath: join(parent, 'config.json'),
    logPath: join(root, 'state', 'log.jsonl'),
    mode,
    logBefore: 0,
    trace: [],
  };
  bags.set(world, b);
  return b;
}

async function boundaryOf(world: LearningWorld): Promise<ProbeBoundary> {
  const b = ensure(world, 'boundary');
  if (!b.boundary) b.boundary = await openProbeBoundary(b.root);
  return b.boundary;
}

function parseJsonPath(raw: string): string {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'string') throw new Error(`路徑欄不是 JSON 字串: ${raw}`);
  return parsed;
}

function logLines(b: Bag): string[] {
  if (!existsSync(b.logPath)) return [];
  const text = readFileSync(b.logPath, 'utf8');
  if (text.length === 0) return [];
  assert.ok(text.endsWith('\n'), `log.jsonl 最後一行不完整: ${JSON.stringify(text.slice(-80))}`);
  return text.slice(0, -1).split('\n');
}

function markLog(b: Bag): void {
  const n = logLines(b).length;
  b.logBefore = n;
  if (b.logMark === undefined) b.logMark = n;
}

function linesSinceMark(b: Bag): string[] {
  return logLines(b).slice(b.logMark ?? 0);
}

function parseLine(line: string): Record<string, unknown> {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`log 的一行不是 JSON: ${JSON.stringify(line)} (${(err as Error).message})`);
  }
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** LogEventSchema(§10)+ 契約說的「ISO 8601 含時區」(schema 只檢查非空,這裡補上時區)。 */
function assertSchemaLine(line: string): Record<string, unknown> {
  const event = parseLine(line);
  const result = validateLogEvent(event);
  assert.ok(result.ok, `LogEventSchema 不過: ${result.errors.join('; ')} — ${line}`);
  assert.match(String(event.ts), ISO_WITH_ZONE, `ts 不是含時區的 ISO 8601: ${line}`);
  return event;
}

function assertWarning(line: string, path: string): Record<string, unknown> {
  const event = assertSchemaLine(line);
  assert.equal(event.type, 'warning', line);
  assert.equal(event.reason, 'path-refused', line);
  assert.equal(event.path, path, `warning 的 path 不是被拒絕的那一個: ${line}`);
  return event;
}

function isRefusal(b: Bag, err: unknown): boolean {
  return b.boundary !== undefined && b.boundary.isRefusal(err);
}

function isIoError(b: Bag, err: unknown): boolean {
  return b.boundary !== undefined && b.boundary.isIoError(err);
}

/** 在讀之前、log 所在目錄掛 shim(記 log 的 open/write/fsync);寫的時候掛在目標目錄(記 §11b 四步)。 */
function shimFor(b: Bag, op: string, rel: string): { dir: string } | undefined {
  if (rel.includes('\0')) return { dir: join(b.root, 'state') };
  if (op === 'write') return { dir: dirname(join(b.root, rel)) };
  return { dir: join(b.root, 'state') };
}

async function callOp(world: LearningWorld, op: string, rel: string, content = 'phase-2'): Promise<void> {
  const b = ensure(world, 'boundary');
  const boundary = await boundaryOf(world);
  b.err = undefined;
  b.requested = rel;
  markLog(b);
  boundary.shimNext = shimFor(b, op, rel);
  try {
    if (op === 'read') {
      await boundary.read(rel);
    } else if (op === 'write') {
      b.writtenRel = rel;
      b.writtenContent = content;
      await boundary.write(rel, content);
    } else if (op === 'exists') {
      b.answer = await boundary.exists(rel);
    } else if (op === 'list') {
      b.answer = await boundary.list(rel);
    } else {
      throw new Error(`未知操作 ${op}`);
    }
  } catch (err) {
    b.err = err;
  }
  b.last = boundary.last();
  b.trace = boundary.lastTrace;
}

async function requestAsset(world: LearningWorld, encodedRel: string): Promise<void> {
  const b = ensure(world, 'boundary');
  const boundary = await boundaryOf(world);
  b.err = undefined;
  b.requested = encodedRel;
  markLog(b);
  b.last = boundary.requestAsset(encodedRel);
  if (!b.last.ok) b.err = { assetRefused: b.last.refused };
}

function rawHash(root: string): string {
  const raw = join(root, 'raw');
  if (!existsSync(raw)) return 'absent';
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else files.push(`${full}\0${readFileSync(full)}`);
    }
  };
  walk(raw);
  files.sort();
  return createHash('sha256').update(files.join('\n')).digest('hex');
}

function plant(root: string, rel: string, content: string | Buffer = 'ok'): string {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x00, 0xfe, 0xff, 0x80, 0x00, 0x0a, 0x0d, 0xc3, 0x28]);
}

function header(b: Bag, name: string): string | undefined {
  const headers = b.last?.resp?.headers ?? {};
  return headers[name.toLowerCase()];
}

function loadAtomicVectors(): VectorRow[] {
  return (JSON.parse(readFileSync(ATOMIC_VECTORS, 'utf8')) as { vectors: VectorRow[] }).vectors;
}

/** 在真的 lc-fs 上跑一列 §11b 向量:目標放在 <root>/state/,shim 追蹤這個目錄並照列注入。 */
function runAtomicRow(row: VectorRow): VectorRun {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'lc-vec-')));
  try {
    return runAtomicRowIn(parent, row);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

function runAtomicRowIn(parent: string, row: VectorRow): VectorRun {
  const problems: string[] = [];
  const root = join(parent, 'learning');
  const dir = join(root, 'state');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, row.setup.target);
  if (row.setup.prior_target !== null) writeFileSync(target, row.setup.prior_target);
  for (const extra of row.setup.extra_files) writeFileSync(join(dir, extra.name), extra.bytes);
  const inject = row.inject.map((i) => `${i.call}@${i.nth}@${i.code}`);
  const { resp, trace } = runProbe(
    { op: 'write', root, path: `state/${row.setup.target}`, content: row.setup.content },
    { dir, inject },
  );
  const calls = trace.map((t) => t.call);
  const e = row.expect;

  if (e.outcome === 'ok') {
    if (!resp.ok || resp.error) problems.push(`expected ok, got ${JSON.stringify(resp.error ?? resp)}`);
  } else {
    if (resp.ok || !resp.error) problems.push('expected an error, got ok');
    else {
      if (resp.error.kind !== 'io') problems.push(`expected an io error, got ${JSON.stringify(resp.error)}`);
      if (e.code !== null && resp.error.errno !== ERRNO[e.code]) {
        problems.push(`expected errno ${e.code} (${ERRNO[e.code]}), got ${JSON.stringify(resp.error)}`);
      }
    }
  }
  if (e.identity) {
    const hit = trace.find((t) => t.call === e.identity && t.fields.injected);
    if (!hit) problems.push(`the injection at ${e.identity} did not happen: ${calls.join(' → ')}`);
  }
  const remaining = readdirSync(dir).sort();
  const wanted = [...e.remaining].sort();
  if (JSON.stringify(remaining) !== JSON.stringify(wanted)) problems.push(`remaining ${JSON.stringify(remaining)}, expected ${JSON.stringify(wanted)}`);
  if (e.target_bytes === null) {
    if (existsSync(target)) problems.push('target must not exist');
  } else if (!existsSync(target) || readFileSync(target, 'utf8') !== e.target_bytes) {
    problems.push(`target holds ${existsSync(target) ? JSON.stringify(readFileSync(target, 'utf8')) : '(missing)'}, expected ${JSON.stringify(e.target_bytes)}`);
  }
  for (const name of e.absent ?? []) if (existsSync(join(dir, name))) problems.push(`${name} must not be left behind`);
  for (const f of e.untouched ?? []) {
    const got = existsSync(join(dir, f.name)) ? readFileSync(join(dir, f.name), 'utf8') : '(missing)';
    if (got !== f.bytes) problems.push(`${f.name} must stay ${JSON.stringify(f.bytes)}, got ${JSON.stringify(got)}`);
  }
  if (e.order) {
    const set = new Set(e.order);
    const actual = calls.filter((c) => set.has(c));
    if (JSON.stringify(actual) !== JSON.stringify(e.order)) problems.push(`order ${actual.join(' → ')}, expected ${e.order.join(' → ')} (all: ${calls.join(' → ')})`);
  }
  if (e.tmp_basename) {
    const first = trace.find((t) => t.call === 'open:tmp');
    if (!first) problems.push(`no <name>.tmp was opened: ${calls.join(' → ')}`);
    else if (first.fields.path !== join(dir, e.tmp_basename)) problems.push(`tmp opened at ${first.fields.path}, expected ${join(dir, e.tmp_basename)}`);
  }
  const opens = trace.filter((t) => t.call.startsWith('open:') && t.fields.fd !== undefined);
  if (e.fds_closed) {
    for (const o of opens) {
      const idx = trace.indexOf(o);
      const closed = trace.slice(idx + 1).some((t) => t.call.startsWith('close:') && t.fields.fd === o.fields.fd);
      if (!closed) problems.push(`fd ${o.fields.fd} (${o.call} ${o.fields.path}) was never closed`);
    }
  }
  if (e.open_count !== undefined) {
    const n = trace.filter((t) => t.call.startsWith('open:')).length;
    if (n !== e.open_count) problems.push(`opened ${n} times in the directory, expected ${e.open_count}: ${calls.join(' → ')}`);
  }
  if (e.cleanup_attempted && !calls.includes('unlink')) problems.push(`cleanup was not attempted: ${calls.join(' → ')}`);
  for (const c of e.saw_calls ?? []) if (!calls.includes(c)) problems.push(`never called ${c}: ${calls.join(' → ')}`);
  const injectedSeen = trace.filter((t) => t.fields.injected).map((t) => `${t.call}@${t.fields.injected}`);
  for (const i of row.inject) {
    if (!injectedSeen.includes(`${i.call}@${i.code}`)) problems.push(`injection ${i.call}@${i.nth}@${i.code} never fired: ${calls.join(' → ')}`);
  }
  return { name: row.name, problems: problems.map((p) => `${row.name}: ${p}`), injectedSeen };
}

async function ensureSequence(b: Bag): Promise<void> {
  if (!b.sequence || b.sequenceResp) return;
  const boundary = b.boundary!;
  markLog(b);
  const requests = [...b.sequence].sort((x, y) => x.at - y.at);
  b.sequenceResp = boundary.assetSequence(requests, b.endAt ?? null);
  const statuses = b.sequenceResp.responses?.map((r) => r.status) ?? [];
  assert.deepEqual(statuses, requests.map(() => 403), `every request in the sequence must be refused: ${JSON.stringify(b.sequenceResp)}`);
}

function lineFor(b: Bag, path: string): Record<string, unknown> {
  const hits = linesSinceMark(b).map(parseLine).filter((e) => e.path === path);
  assert.equal(hits.length, 1, `應該剛好一行 path=${path}: ${linesSinceMark(b).join('\n')}`);
  return hits[0]!;
}

// ---------------------------------------------------------------- Given

Given('no configuration file exists', function (this: LearningWorld) {
  const b = ensure(this, 'startup');
  assert.equal(existsSync(b.configPath), false);
});

Given('the configured path does not exist', function (this: LearningWorld) {
  const b = ensure(this, 'startup');
  const missing = join(b.parent, 'missing-learning');
  writeFileSync(b.configPath, JSON.stringify({ learningDir: missing }));
  assert.equal(existsSync(missing), false);
});

Given('the boundary sits in front of a file system that records every call it receives', async function (this: LearningWorld) {
  await boundaryOf(this);
});

Given('the application configuration', function (this: LearningWorld) {
  const b = ensure(this, 'config');
  b.assetStatus = assetProtocolStatus(REPO);
  b.conf = readTauriConf();
});

Given('a directory that contains a hidden entry ".hidden" and a file "ok.md"', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  b.listDir = 'cards';
  mkdirSync(join(b.root, 'cards'), { recursive: true });
  writeFileSync(join(b.root, 'cards', '.hidden'), 'nope');
  writeFileSync(join(b.root, 'cards', 'ok.md'), 'yes');
});

Given(
  /^a directory with the files "([^"]+)" and one entry whose metadata cannot be read$/,
  function (this: LearningWorld, name: string) {
    const b = ensure(this, 'boundary');
    b.listDir = 'cards';
    plant(b.root, `cards/${name}`, 'yes');
    // 懸空 symlink:跟隨之後 stat 失敗,metadata 讀不到。
    symlinkSync(join(b.parent, 'nowhere'), join(b.root, 'cards', 'ghost.md'));
  },
);

Given('a symbolic link inside the learning directory points outside it', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  mkdirSync(join(b.root, 'cards'), { recursive: true });
  b.linkRel = 'cards/link.md';
  symlinkSync(b.outsideFile, join(b.root, b.linkRel));
});

Given(
  /^a symbolic link "([^"]+)" inside the learning directory points to a path outside it that does not exist$/,
  function (this: LearningWorld, rel: string) {
    const b = ensure(this, 'boundary');
    const target = join(dirname(b.outsideFile), 'new');
    mkdirSync(dirname(join(b.root, rel)), { recursive: true });
    symlinkSync(target, join(b.root, rel));
    assert.equal(existsSync(target), false);
    b.danglingTarget = target;
  },
);

Given(/^the learning directory is in the state: (.+)$/, function (this: LearningWorld, state: string) {
  const b = ensure(this, 'boundary');
  b.stateGiven = true;
  if (state === 'no such file') return;
  if (state === 'the path is a directory') {
    mkdirSync(join(b.root, 'cards'), { recursive: true });
    return;
  }
  if (state === 'the file is not readable by the caller') {
    if (process.getuid?.() === 0) return 'skipped';
    chmodSync(plant(b.root, 'cards/locked.md', 'secret'), 0o000);
    return;
  }
  if (state === 'the file is not valid UTF-8') {
    plant(b.root, 'cards/bad.md', Buffer.from([0xff, 0xfe, 0x00]));
    return;
  }
  throw new Error(`未知的狀態 ${state}`);
});

Given('the asset refusal limiter has no earlier refusals', async function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  await boundaryOf(this);
  // 每次叫 probe 都是新的行程,限流器從零開始;這裡確認 log 也是空的。
  assert.equal(logLines(b).length, 0);
  b.sequence = undefined;
  b.endAt = null;
});

Given(
  /^the file "([^"]+)" holds a PNG header followed by bytes including 00 and FF$/,
  function (this: LearningWorld, rel: string) {
    const b = ensure(this, 'boundary');
    b.assetBytes = pngBytes();
    plant(b.root, rel, b.assetBytes);
  },
);

Given(/^a file with the extension (\w+) under assets$/, function (this: LearningWorld, ext: string) {
  const b = ensure(this, 'boundary');
  b.assetRel = `assets/x.${ext}`;
  b.assetBytes = pngBytes();
  plant(b.root, b.assetRel, b.assetBytes);
});

Given(/^the file "([^"]+)" exists$/, function (this: LearningWorld, rel: string) {
  const b = ensure(this, 'boundary');
  plant(b.root, rel, `<svg xmlns="http://www.w3.org/2000/svg"><script>document.title='pwned'</script></svg>`);
});

Given('a built front end folder whose html references a .ts source file', function (this: LearningWorld) {
  const b = ensure(this, 'config');
  b.distDir = join(b.parent, 'fixture-dist');
  mkdirSync(b.distDir, { recursive: true });
  writeFileSync(join(b.distDir, 'teach.html'), T2B_TEACH_HTML);
});

// ---------------------------------------------------------------- When

When('the application starts', function (this: LearningWorld) {
  const b = bags.get(this);
  if (b?.mode !== 'startup') throw new Error('「the application starts」只用在首次啟動與設定路徑的場景');
  b.startup = decideStartup(b.configPath);
});

When('the front end requests a card file', async function (this: LearningWorld) {
  const rel = 'cards/security/sec-0042.md';
  const b = ensure(this, 'boundary');
  plant(b.root, rel, '# card');
  await callOp(this, 'read', rel);
});

/**
 * 「合法路徑讀得到」的場景沒有另寫 Given 建檔(T2b 時讀不到的檔回 "",現在是 io 錯誤 not_found)。
 * 所以 read 之前先把檔建出來,但只在:這個場景沒有用「the learning directory is in the state」指定狀態、
 * 路徑看起來是乾淨的相對路徑(不碰 raw/、沒有 . 開頭的段、沒有反斜線/NUL/%)、而且解析後確定在暫存根目錄裡。
 * 被拒絕的路徑不建(也不需要:拒絕發生在碰檔案之前)。
 */
function plantIfPlain(b: Bag, rel: string): void {
  if (b.stateGiven) return;
  if (!/^[^/\\\0%]+(\/[^/\\\0%]+)*$/.test(rel)) return;
  const segs = rel.split('/');
  if (segs.some((s) => s.startsWith('.') || s.endsWith('.'))) return;
  if (segs[0]!.toLowerCase() === 'raw') return;
  if (Buffer.byteLength(rel, 'utf8') > 240 || rel.normalize('NFC') !== rel) return;
  const full = resolve(b.root, rel);
  if (!full.startsWith(`${b.root}${sep}`)) return;
  if (existsSync(full)) return;
  plant(b.root, rel, 'ok');
}

When(
  /^the front end requests the JSON-encoded path (.*) through the read command$/,
  async function (this: LearningWorld, raw: string) {
    const rel = parseJsonPath(raw);
    const b = ensure(this, 'boundary');
    b.decoded = rel;
    plantIfPlain(b, rel);
    await callOp(this, 'read', rel);
  },
);

When(
  /^the front end requests the JSON-encoded path (.*) through the read command (\d+) times$/,
  async function (this: LearningWorld, raw: string, times: string) {
    const rel = parseJsonPath(raw);
    const b = ensure(this, 'boundary');
    b.decoded = rel;
    markLog(b);
    for (let i = 0; i < Number(times); i++) await callOp(this, 'read', rel);
  },
);

When(
  /^the front end requests the path "cards\/a\.md", then a NUL character, then "\.png" through the read command$/,
  async function (this: LearningWorld) {
    await callOp(this, 'read', 'cards/a.md\0.png');
  },
);

When(
  /^the front end requests a path with one segment of (\d+) bytes through the read command$/,
  async function (this: LearningWorld, n: string) {
    const seg = `${'a'.repeat(Number(n) - 3)}.md`;
    assert.equal(Buffer.byteLength(seg, 'utf8'), Number(n));
    const rel = `cards/${seg}`;
    assert.ok(Buffer.byteLength(rel, 'utf8') <= 240, `${rel.length} 超過 240,這條場景就不是在測段的上限`);
    await callOp(this, 'read', rel);
  },
);

When(
  /^the front end writes to the JSON-encoded path (.*) through the write command$/,
  async function (this: LearningWorld, raw: string) {
    await callOp(this, 'write', parseJsonPath(raw));
  },
);

When(
  /^the web view requests the asset url for the JSON-encoded path (.*) directly$/,
  async function (this: LearningWorld, raw: string) {
    const rel = parseJsonPath(raw);
    const b = ensure(this, 'boundary');
    b.decoded = rel;
    if (rel === 'cards/%EA%B0%80.md') plant(b.root, 'cards/가.md', 'hangul');
    await requestAsset(this, rel);
  },
);

When('the web view requests the asset url for that file directly', async function (this: LearningWorld) {
  const b = bag(this);
  assert.ok(b.assetRel, '前一步沒有建檔');
  await requestAsset(this, b.assetRel);
});

When(/^the front end requests the path ([^"].+)$/, async function (this: LearningWorld, rel: string) {
  const b = ensure(this, 'boundary');
  plant(b.root, rel, 'ok');
  await callOp(this, 'read', rel);
});

When(
  /^the front end requests "cards\/" followed by (\d+) repetitions of the JSON-encoded unit (.*) followed by "\.md" through the read command$/,
  async function (this: LearningWorld, countRaw: string, unitRaw: string) {
    const unit = parseJsonPath(unitRaw);
    const count = Number(countRaw);
    const rel = `cards/${unit.repeat(count)}.md`;
    const b = ensure(this, 'boundary');
    b.decoded = rel;
    b.bytes = Buffer.byteLength(rel, 'utf8');
    if (b.bytes <= 240) plant(b.root, rel, 'ok');
    await callOp(this, 'read', rel);
  },
);

When(
  /^the front end calls (read|write|exists|list) with the JSON-encoded path (.*)$/,
  async function (this: LearningWorld, op: string, raw: string) {
    const rel = parseJsonPath(raw);
    const b = ensure(this, 'boundary');
    mkdirSync(join(b.root, 'raw', 'security'), { recursive: true });
    writeFileSync(join(b.root, 'raw', 'security', 'x.md'), 'secret');
    b.rawHash = rawHash(b.root);
    await callOp(this, op, rel);
  },
);

When(/^the front end calls assetUrl with the JSON-encoded path (.*)$/, async function (this: LearningWorld, raw: string) {
  const rel = parseJsonPath(raw);
  const b = ensure(this, 'boundary');
  const boundary = await boundaryOf(this);
  delete b.url;
  b.err = undefined;
  b.decoded = rel;
  try {
    b.url = boundary.assetUrl(rel);
  } catch (err) {
    b.err = err;
  }
  b.last = boundary.last();
});

When(/^the front end lists the JSON-encoded directory (.*)$/, async function (this: LearningWorld, raw: string) {
  await callOp(this, 'list', parseJsonPath(raw));
});

When(
  /^the front end asks whether the JSON-encoded path (.*) exists$/,
  async function (this: LearningWorld, raw: string) {
    await callOp(this, 'exists', parseJsonPath(raw));
  },
);

When('the front end lists that directory', async function (this: LearningWorld) {
  const b = bag(this);
  await callOp(this, 'list', b.listDir ?? 'cards');
  // 「the result is ["ok.md"]」由 common.steps.ts 的 `the result is {}` 比對 resultText。
  if (b.err) {
    this.resultText = `error:${(b.err as Error).message ?? 'refused'}`;
    return;
  }
  this.resultText = JSON.stringify(b.answer);
  this.lastResult = b.answer;
});

When('the front end requests that path', async function (this: LearningWorld) {
  const b = bag(this);
  await callOp(this, 'read', b.linkRel ?? '');
});

When('the front end attempts a direct file read outside the scope', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  b.plugin = pluginDirectRead(REPO, b.outsideFile);
});

When('an asset url is requested for an image inside the assets directory', async function (this: LearningWorld) {
  const boundary = await boundaryOf(this);
  const b = bag(this);
  b.url = boundary.assetUrl('assets/sec-0042-diagram.png');
  b.last = boundary.last();
});

When(/^the web view is refused with reason structure at seconds (\d+)((?:, \d+)*) and (\d+)$/, function (this: LearningWorld, first: string, middle: string, last: string) {
  const b = bag(this);
  const seconds = [first, ...middle.split(',').map((s) => s.trim()).filter((s) => s.length > 0), last].map(Number);
  b.sequence ??= [];
  for (const at of seconds) b.sequence.push({ at, path: `../s${at}.png` });
});

When(/^the web view is refused with reason raw at second (\d+)$/, function (this: LearningWorld, at: string) {
  const b = bag(this);
  b.sequence ??= [];
  b.sequence.push({ at: Number(at), path: `raw/r${at}.png` });
});

When(/^the application ends normally at second (\d+)$/, function (this: LearningWorld, at: string) {
  bag(this).endAt = Number(at);
});

When('the same refused path is recorded by the TypeScript recordEvent and by the Rust side', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  // Rust:probe 的 read 拒絕 raw/x.md,Rust 自己往 log.jsonl 寫一行。
  const { resp } = runProbe({ op: 'read', root: b.root, path: 'raw/x.md' });
  assert.equal(resp.refused, true, JSON.stringify(resp));
  const rustLines = logLines(b);
  assert.equal(rustLines.length, 1, `Rust 應該剛好寫一行: ${rustLines.join('\n')}`);
  b.rustEvent = parseLine(rustLines[0]!);
  // TS:T2b 在 Node 裡記的那個事件(boundary.ts 的 noteRefusal),用真的 recordEvent 寫進另一個 log。
  const tsLog = join(b.parent, 'ts-log.jsonl');
  recordEvent(tsLog, { ts: new Date().toISOString(), type: 'warning', path: 'raw/x.md', reason: 'path-refused' });
  const tsLines = readFileSync(tsLog, 'utf8').split('\n').filter((l) => l.length > 0);
  assert.equal(tsLines.length, 1);
  b.tsEvent = parseLine(tsLines[0]!);
});

When('the Rust atomic write runs every row of the shared atomic write vectors', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  b.vectorRuns = loadAtomicVectors().map(runAtomicRow);
});

When(/^the directory fsync reports (E[A-Z]+)$/, function (this: LearningWorld, errno: string) {
  const b = ensure(this, 'boundary');
  const dir = join(b.root, 'state');
  writeFileSync(join(dir, 'reviews.json'), 'OLD');
  b.fsyncErrno = errno;
  b.writtenRel = 'state/reviews.json';
  b.writtenContent = 'NEW';
  const run = runProbe({ op: 'write', root: b.root, path: 'state/reviews.json', content: 'NEW' }, { dir, inject: [`fsync:dir@1@${errno}`] });
  b.fsyncResp = run.resp;
  b.trace = run.trace;
  assert.ok(
    run.trace.some((t) => t.call === 'fsync:dir' && t.fields.injected === errno),
    `the directory fsync was never reached: ${run.trace.map((t) => t.call).join(' → ')}`,
  );
});

When(
  'the Rust segment check runs every row of the shared segment vectors whose applies_to has segment',
  async function (this: LearningWorld) {
    const b = ensure(this, 'boundary');
    const boundary = await boundaryOf(this);
    const rows = (JSON.parse(readFileSync(SEGMENT_VECTORS, 'utf8')) as {
      vectors: { segment: string; expect: string; applies_to: string[]; rule: string }[];
    }).vectors;
    b.segmentRan = 0;
    b.segmentIgnored = 0;
    b.segmentWrong = [];
    for (const row of rows) {
      if (!row.applies_to.includes('segment')) {
        b.segmentIgnored++;
        continue;
      }
      b.segmentRan++;
      const resp = boundary.segment(row.segment);
      if (resp.ok === resp.refused) b.segmentWrong.push(`${JSON.stringify(row.segment)}: probe answered ok=${resp.ok} refused=${resp.refused}`);
      const accepted = resp.ok && !resp.refused;
      if (accepted !== (row.expect === 'accept')) {
        b.segmentWrong.push(`${JSON.stringify(row.segment)} (rule ${row.rule}) expected ${row.expect}, got ${JSON.stringify(resp.error ?? 'accept')}`);
      }
    }
  },
);

When('the files of the web view LearningFs and everything it imports are scanned', function (this: LearningWorld) {
  const b = ensure(this, 'config');
  b.graph = scanImportGraph(WEBVIEW_LEARNING_FS);
});

When('the application is built', { timeout: BUILD_FRONTENDS_TIMEOUT_MS + 10_000 }, function (this: LearningWorld) {
  const b = ensure(this, 'config');
  b.conf = readTauriConf();
  const tail = runBeforeBuild(b.conf);
  console.log(`front ends built: ${tail.split('\n').filter((l) => l.trim()).pop() ?? 'ok'}`);
  b.distDir = frontendDistDir(b.conf);
  b.distEntries = windowEntries(b.conf);
  b.distProblems = checkFrontendDist(b.distDir, b.distEntries.map((e) => e.html));
});

When('the static front end check runs', function (this: LearningWorld) {
  const b = bag(this);
  b.fixtureProblems = checkFrontendDist(b.distDir!, ['teach.html']);
});

// ---------------------------------------------------------------- Then

Then('it asks the person to choose a learning directory', function (this: LearningWorld) {
  assert.equal(bag(this).startup?.askChoose, true);
});

Then('it offers to initialise the directory if it is empty', function (this: LearningWorld) {
  assert.equal(bag(this).startup?.offerInit, true);
});

Then('the chosen path is saved to the configuration', function (this: LearningWorld) {
  const b = bag(this);
  b.chosen = join(b.parent, 'chosen-learning');
  mkdirSync(b.chosen, { recursive: true });
  saveChosenPath(b.configPath, b.chosen);
  const saved = JSON.parse(readFileSync(b.configPath, 'utf8')) as { learningDir?: string };
  assert.equal(saved.learningDir, b.chosen);
});

Then('it says the directory could not be found', function (this: LearningWorld) {
  assert.equal(bag(this).startup?.notFound, true);
});

Then('it asks the person to choose again', function (this: LearningWorld) {
  assert.equal(bag(this).startup?.askAgain, true);
});

Then('the read command is invoked with a path relative to the learning directory', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.err, undefined, `read failed: ${String(b.err)}`);
  const calls = b.last?.fsCalls ?? [];
  assert.equal(calls.length, 1);
  const path = calls[0]!.path;
  assert.equal(path.startsWith('/'), false);
  assert.equal(path.includes(b.root), false);
  assert.equal(path, 'cards/security/sec-0042.md');
});

Then('the request is refused', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.last?.ok === true, false, '請求不該成功');
  const assetRefused = (b.err as { assetRefused?: boolean } | undefined)?.assetRefused === true;
  assert.equal(isRefusal(b, b.err) || assetRefused, true, `應該是拒絕,實際是 ${describeErr(b.err)}`);
});

Then('the refusal is returned to the TypeScript caller', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(isRefusal(b, b.err), true, `TS 呼叫端應該收到 PathRefusedError,實際是 ${describeErr(b.err)}`);
});

Then('the Rust side appends one warning event line to the learning log', function (this: LearningWorld) {
  const b = bag(this);
  const fresh = logLines(b).slice(b.logBefore);
  assert.equal(fresh.length, 1, `應該剛好多一行 warning: ${fresh.join('\n') || '(沒有)'}`);
  const expected = b.last?.checked ?? b.requested ?? '';
  assertWarning(fresh[0]!, expected);
});

Then('the warning line passes the LogEventSchema check', function (this: LearningWorld) {
  const b = bag(this);
  const fresh = logLines(b).slice(b.logBefore);
  assert.equal(fresh.length, 1);
  assertSchemaLine(fresh[0]!);
});

Then('no file outside the learning directory is read', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(readFileSync(b.outsideFile, 'utf8'), 'OUTSIDE-SENTINEL');
  assert.equal((b.last?.fsCalls ?? []).length, 0);
});

Then('the file system behind the boundary received no call', function (this: LearningWorld) {
  assert.equal((bag(this).last?.fsCalls ?? []).length, 0);
});

Then('the request succeeds', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.err, undefined, `不該失敗: ${describeErr(b.err)}`);
  assert.equal(b.last?.ok, true);
});

Then('the file system behind the boundary received exactly one call', function (this: LearningWorld) {
  assert.equal((bag(this).last?.fsCalls ?? []).length, 1);
});

Then(/^the string it received is byte-identical to (".*")$/, function (this: LearningWorld, raw: string) {
  const expected = parseJsonPath(raw);
  assert.equal(bag(this).last?.fsCalls[0]?.path, expected);
});

Then('the string it received is byte-identical to the decoded path', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.last?.fsCalls[0]?.path, b.decoded);
});

Then('the asset protocol is enabled with a scope limited to the learning directory', async function (this: LearningWorld) {
  const s = bag(this).assetStatus;
  assert.ok(s, '沒有讀到協定設定');
  assert.equal(s.customRegistered, true, 'src/main.rs 沒有 register_uri_scheme_protocol(SCHEME, …)');
  assert.equal(s.scheme, 'lc');
  assert.equal(s.builtinEnabled, false);
  assert.deepEqual(s.builtinScope, []);
  // 真的請求:根裡放一個指向根外檔案的 symlink,經 lc 要它 → 403,body 不含根外內容。
  // 對照組:根裡的正常檔 → 200 且拿到內容,證明 403 不是「什麼都拒」。
  const b = bag(this);
  plant(b.root, 'cards/inside.md', 'INSIDE-SENTINEL');
  mkdirSync(join(b.root, 'cards'), { recursive: true });
  symlinkSync(b.outsideFile, join(b.root, 'cards', 'escape.md'));
  await requestAsset(this, 'cards/inside.md');
  const okResp = bag(this).last?.resp;
  assert.equal(okResp?.status, 200, '根裡的正常檔應該是 200');
  assert.equal(hexToBytes(String(okResp?.bodyHex ?? '')).toString('utf8'), 'INSIDE-SENTINEL');
  await requestAsset(this, 'cards/escape.md');
  const resp = bag(this).last?.resp;
  assert.equal(resp?.status, 403, `symlink 逃出根目錄應該是 403: ${JSON.stringify(resp?.status)}`);
  const body = hexToBytes(String(resp?.bodyHex ?? '')).toString('utf8');
  assert.ok(!body.includes('OUTSIDE-SENTINEL'), 'body 洩漏了根外檔案的內容');
  assert.equal(readFileSync(b.outsideFile, 'utf8'), 'OUTSIDE-SENTINEL');
});

/** 跟 assetUrl 一樣:逐段 encodeURIComponent,斜線留著。 */
function encodeLikeAssetUrl(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

Then('the asset protocol applies the same path checks as the read command', async function (this: LearningWorld) {
  // 同一張樣本表逐列送:read 收原字串,lc 收逐段編碼後的字串。「拒」= 拒絕;read 的 io 錯誤與 lc 的 404 都算「放」。
  const samples = [
    '../etc/passwd',
    'cards/a.',
    'nul.md',
    'raw/x',
    'cards/a.md',
    'cards/\u{AC00}.md', // 가 → %EA%B0%80:lc 不解碼就會拒絕,這列才真的測到解碼
    'cards/100%.md', // 含 % → 兩邊都拒(lc 收到 cards/100%25.md,解一次得 100%)
    'cards/a%2emd', // 含 % → 兩邊都拒
    'cards/a b.md', // 空白不在允許字元集
  ];
  const rows: string[] = [];
  for (const p of samples) {
    await callOp(this, 'read', p);
    const readRefused = isRefusal(bag(this), bag(this).err);
    await requestAsset(this, encodeLikeAssetUrl(p));
    const status = bag(this).last?.resp?.status;
    assert.ok(status === 200 || status === 403 || status === 404, `${JSON.stringify(p)}: lc 回了意外的狀態 ${String(status)}`);
    const lcRefused = status === 403;
    rows.push(`${JSON.stringify(p)} read=${readRefused ? '拒' : '放'} lc=${lcRefused ? '拒' : '放'}`);
    assert.equal(lcRefused, readRefused, `兩邊判斷不同: ${rows[rows.length - 1]}`);
  }
  // 至少有拒有放,表才不是空轉
  assert.ok(rows.some((r) => r.includes('read=拒')) && rows.some((r) => r.includes('read=放')), rows.join('\n'));
  // 只送 lc:%252e 解一次是 %2e(含 %),必須拒絕;解兩次才會變成合法的 a.md
  await requestAsset(this, 'cards/a%252emd');
  assert.equal(bag(this).last?.resp?.status, 403, '解碼不只一次');
});

Then(/^the path is (\d+) UTF-8 bytes long$/, function (this: LearningWorld, n: string) {
  assert.equal(bag(this).bytes, Number(n));
});

Then(/^the string checked and used is (.*)$/, function (this: LearningWorld, raw: string) {
  assert.equal(bag(this).last?.checked, parseJsonPath(raw));
});

Then('no file under raw is read, created or changed', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(rawHash(b.root), b.rawHash);
  assert.equal((b.last?.fsCalls ?? []).length, 0);
});

Then('the call is refused and returns no url', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.url, undefined);
  assert.equal(isRefusal(b, b.err), true, `assetUrl 應該丟 PathRefusedError,實際是 ${describeErr(b.err)}`);
});

// 「the result is ["ok.md"]」交給 common.steps.ts 的 `the result is {}`(比對 resultText)。
// 「no error is raised」已定義在 llm-router.steps.ts,看的是 probe 錯誤,不是這條邊界。
// 不能再定義。清單若丟錯,上一句 resultText 不會是 ["ok.md"],場景仍紅。

Then('the plugin refuses it independently of the command check', function (this: LearningWorld) {
  const p = bag(this).plugin;
  assert.equal(p?.refused, true);
  assert.equal(p?.by, 'plugin');
  assert.equal(p?.commandCheckCalled, false);
});

Then('a url the web view can load is returned', function (this: LearningWorld) {
  assert.equal(bag(this).url, 'lc://localhost/assets/sec-0042-diagram.png');
});

Then('the same path checks apply', async function (this: LearningWorld) {
  const b = bag(this);
  const boundary = await boundaryOf(this);
  assert.throws(() => boundary.assetUrl('assets/../secret'), (err: unknown) => isRefusal(b, err));
});

// ---- 限流與 log 行數

Then(/^the learning log gets exactly (one|two|three) warning lines?$/, async function (this: LearningWorld, word: string) {
  const b = bag(this);
  await ensureSequence(b);
  const n = { one: 1, two: 2, three: 3 }[word as 'one' | 'two' | 'three'];
  const lines = linesSinceMark(b);
  assert.equal(lines.length, n, `log 應該多 ${n} 行:\n${lines.join('\n') || '(沒有)'}`);
  for (const line of lines) {
    const e = assertSchemaLine(line);
    assert.equal(e.type, 'warning', line);
  }
});

Then(/^the (structure|raw) line written at second (\d+) has count (\d+)$/, async function (this: LearningWorld, reason: string, at: string, count: string) {
  const b = bag(this);
  await ensureSequence(b);
  const path = reason === 'structure' ? `../s${at}.png` : `raw/r${at}.png`;
  const line = lineFor(b, path);
  assert.equal(line.count, Number(count), JSON.stringify(line));
});

Then('every written line passes the LogEventSchema check', async function (this: LearningWorld) {
  const b = bag(this);
  await ensureSequence(b);
  const lines = linesSinceMark(b);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const e = assertSchemaLine(line);
    assert.equal(e.reason, 'path-refused', line);
    assert.equal(typeof e.count, 'number', `asset 的 warning 要帶 count: ${line}`);
  }
});

Then(/^the last line has count (\d+)$/, async function (this: LearningWorld, count: string) {
  const b = bag(this);
  await ensureSequence(b);
  const lines = linesSinceMark(b);
  assert.ok(lines.length > 0);
  assert.equal(parseLine(lines[lines.length - 1]!).count, Number(count), lines.join('\n'));
});

Then('the learning log has no new line', function (this: LearningWorld) {
  const b = bag(this);
  const fresh = logLines(b).slice(b.logBefore);
  assert.deepEqual(fresh, [], 'io 錯誤或 404 不寫 warning');
});

// ---- log 一次 write、一整行、落地

function logWrites(b: Bag): { opens: TraceEntry[]; writes: TraceEntry[]; syncs: TraceEntry[] } {
  const opens = b.trace.filter((t) => t.call.startsWith('open:') && t.fields.path === b.logPath);
  const fds = new Set(opens.map((o) => o.fields.fd));
  const writes = b.trace.filter((t) => t.call.startsWith('write') && fds.has(t.fields.fd));
  const syncs = b.trace.filter((t) => t.call.startsWith('fsync:') && fds.has(t.fields.fd));
  return { opens, writes, syncs };
}

Then('the Rust side wrote the line with exactly one write call', function (this: LearningWorld) {
  const b = bag(this);
  const { opens, writes } = logWrites(b);
  assert.equal(opens.length, 1, `log.jsonl 應該被開一次: ${b.trace.map((t) => `${t.call} ${t.fields.path ?? t.fields.fd}`).join(' | ')}`);
  assert.ok((Number(opens[0]!.fields.flags) & O_APPEND) !== 0, `log.jsonl 要用 O_APPEND 開: flags=${opens[0]!.fields.flags}`);
  assert.equal(writes.length, 1, `JSON 與換行要一次 write: ${writes.map((w) => `${w.call} len=${w.fields.len}`).join(', ')}`);
  const fresh = logLines(b).slice(b.logBefore);
  assert.equal(fresh.length, 1);
  assert.equal(Number(writes[0]!.fields.len), Buffer.byteLength(`${fresh[0]}\n`, 'utf8'), '那一次 write 寫的就是整行(含換行)');
});

Then('the line ends with a newline', function (this: LearningWorld) {
  const b = bag(this);
  const text = readFileSync(b.logPath, 'utf8');
  assert.ok(text.endsWith('\n'), JSON.stringify(text.slice(-40)));
});

Then('the line was flushed to disk before the command returned', function (this: LearningWorld) {
  const b = bag(this);
  const { writes, syncs } = logWrites(b);
  assert.equal(writes.length, 1);
  const w = b.trace.indexOf(writes[0]!);
  assert.ok(
    syncs.some((s) => b.trace.indexOf(s) > w),
    `write 之後沒有對 log.jsonl fsync: ${b.trace.map((t) => t.call).join(' → ')}`,
  );
});

Then('the line parses as JSON', function (this: LearningWorld) {
  const b = bag(this);
  for (const line of logLines(b).slice(b.logMark ?? 0)) parseLine(line);
});

Then('the path in the parsed line is byte-identical to the requested path', function (this: LearningWorld) {
  const b = bag(this);
  const lines = logLines(b).slice(b.logMark ?? 0);
  assert.equal(lines.length, 1);
  const path = String(parseLine(lines[0]!).path);
  assert.ok(Buffer.from(path, 'utf8').equals(Buffer.from(b.requested ?? '', 'utf8')), `${JSON.stringify(path)} vs ${JSON.stringify(b.requested)}`);
});

Then(
  'after removing ts and the Rust-only fields op, check and count the two parsed events are deeply equal',
  function (this: LearningWorld) {
    const b = bag(this);
    const strip = (e: Record<string, unknown>, rustOnly: boolean) => {
      const { ts: _ts, ...rest } = e;
      if (rustOnly) {
        delete rest.op;
        delete rest.check;
        delete rest.count;
      }
      return rest;
    };
    assert.ok(b.rustEvent && b.tsEvent);
    assert.deepEqual(strip(b.rustEvent, true), strip(b.tsEvent, false));
  },
);

// ---- io 錯誤與拒絕

function describeErr(err: unknown): string {
  if (err === undefined) return '(沒有錯誤)';
  if (err instanceof Error) return `${err.constructor.name}: ${err.message}`;
  return JSON.stringify(err);
}

Then(/^the request fails with an io error whose code is (\w+)$/, function (this: LearningWorld, code: string) {
  const b = bag(this);
  assert.equal(isIoError(b, b.err), true, `應該是 LearningIoError,實際是 ${describeErr(b.err)}`);
  assert.equal((b.err as { code?: string }).code, code);
});

Then('the error is not a refusal', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(isRefusal(b, b.err), false, describeErr(b.err));
});

Then('the error is not an io error', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(isIoError(b, b.err), false, describeErr(b.err));
});

Then('the answer is false', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.err, undefined, describeErr(b.err));
  assert.equal(b.answer, false);
});

Then('nothing was created at the target outside the learning directory', function (this: LearningWorld) {
  const b = bag(this);
  assert.ok(b.danglingTarget);
  assert.equal(existsSync(b.danglingTarget), false, `根外的 ${b.danglingTarget} 被建出來了`);
});

Then('the request is not refused', function (this: LearningWorld) {
  const b = bag(this);
  assert.ok(b.boundary, '沒有走邊界');
  assert.equal(isRefusal(b, b.err), false, `234 位元組的段不該被拒絕: ${describeErr(b.err)}`);
});

// ---- §11b

Then('every row has the same injected failure and the same expected outcome as in TypeScript', function (this: LearningWorld) {
  const runs = bag(this).vectorRuns ?? [];
  const problems = runs.flatMap((r) => r.problems);
  assert.deepEqual(problems, [], `${problems.length} 個不符:\n${problems.join('\n')}`);
});

Then('Rust did not add or skip any row', function (this: LearningWorld) {
  const runs = bag(this).vectorRuns ?? [];
  const names = loadAtomicVectors().map((r) => r.name);
  assert.equal(names.length, ATOMIC_VECTOR_COUNT, '向量檔的列數變了;TS 的 VECTOR_NAMES 與 Rust 的清單要一起改');
  assert.deepEqual(
    runs.map((r) => r.name),
    names,
  );
});

Then('the Rust atomic write is used', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(b.err, undefined, describeErr(b.err));
  const target = join(b.root, b.writtenRel!);
  const order = loadAtomicVectors().find((r) => r.name === 'syscall-order')!.expect.order!;
  const set = new Set(order);
  const calls = b.trace.map((t) => t.call);
  assert.deepEqual(calls.filter((c) => set.has(c)), order, `不是 §11b 的四步: ${calls.join(' → ')}`);
  const tmp = b.trace.find((t) => t.call === 'open:tmp');
  assert.equal(tmp?.fields.path, `${target}.tmp`);
  const rename = b.trace.find((t) => t.call === 'rename');
  assert.equal(rename?.fields.path, `${target}.tmp`);
  assert.equal(rename?.fields.to, target);
  const dirOpen = b.trace.find((t) => t.call === 'open:dir');
  assert.equal(dirOpen?.fields.path, dirname(target));
});

Then('the target holds the new content and no temporary file is left', function (this: LearningWorld) {
  const b = bag(this);
  const target = join(b.root, b.writtenRel!);
  assert.equal(readFileSync(target, 'utf8'), b.writtenContent);
  const leftovers = readdirSync(dirname(target)).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], `${basename(target)} 旁邊留下暫存檔`);
});

Then('the write succeeds and leaves no temporary file', function (this: LearningWorld) {
  const b = bag(this);
  const resp = b.fsyncResp!;
  assert.equal(resp.ok, true, `EINVAL 要算成功: ${JSON.stringify(resp.error)}`);
  assert.equal(resp.error ?? null, null);
  assert.deepEqual(readdirSync(join(b.root, 'state')).filter((n) => n.endsWith('.tmp')), []);
});

Then('the write fails with that error', function (this: LearningWorld) {
  const b = bag(this);
  const resp = b.fsyncResp!;
  assert.equal(resp.ok, false, `${b.fsyncErrno} 不能被吞掉`);
  assert.equal(resp.error?.kind, 'io', JSON.stringify(resp.error));
  assert.equal(resp.error?.errno, ERRNO[b.fsyncErrno!], `往外丟的要是 ${b.fsyncErrno} 本身: ${JSON.stringify(resp.error)}`);
});

Then('the target holds the new content', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(readFileSync(join(b.root, b.writtenRel!), 'utf8'), b.writtenContent, 'rename 已經完成,目標應該是新內容');
});

// ---- 段向量

Then('each row is accepted or refused exactly as its expect says', function (this: LearningWorld) {
  const b = bag(this);
  assert.deepEqual(b.segmentWrong, [], (b.segmentWrong ?? []).join('\n'));
  assert.equal(b.segmentRan, 47);
});

Then('the rows whose applies_to does not have segment are ignored and counted', function (this: LearningWorld) {
  assert.equal(bag(this).segmentIgnored, 4);
});

Then(/^the file has (\d+) rows, (\d+) of them for segment, and its sha256 is the pinned value$/, function (this: LearningWorld, total: string, seg: string) {
  const b = bag(this);
  const text = readFileSync(SEGMENT_VECTORS);
  assert.equal(createHash('sha256').update(text).digest('hex'), SEGMENT_VECTORS_SHA256, 'path-segment-vectors.json 改了');
  const rows = (JSON.parse(text.toString('utf8')) as { vectors: unknown[] }).vectors;
  assert.equal(rows.length, Number(total));
  assert.equal((b.segmentRan ?? 0) + (b.segmentIgnored ?? 0), Number(total));
  assert.equal(b.segmentRan, Number(seg));
});

// ---- asset 回應

Then(/^the response status is (\d+)$/, function (this: LearningWorld, status: string) {
  const b = bag(this);
  assert.equal(b.last?.resp?.status, Number(status), JSON.stringify(b.last?.resp));
});

Then('the sha256 of the response body equals the sha256 of the file', function (this: LearningWorld) {
  const b = bag(this);
  const body = hexToBytes(b.last?.resp?.bodyHex ?? '');
  const sha = (x: Buffer) => createHash('sha256').update(x).digest('hex');
  assert.equal(sha(body), sha(b.assetBytes!), `body ${body.length} bytes, file ${b.assetBytes!.length} bytes`);
});

Then(/^the content type is (\S+)$/, function (this: LearningWorld, type: string) {
  assert.equal(header(bag(this), 'content-type'), type);
});

Then(/^the response has the header ([A-Za-z-]+) set to (.+)$/, function (this: LearningWorld, name: string, rawValue: string) {
  const value = rawValue.startsWith('"') ? parseJsonPath(rawValue) : rawValue;
  assert.equal(header(bag(this), name), value, JSON.stringify(bag(this).last?.resp?.headers));
});

// ---- csp

Then('the content security policy is a string and not null', function (this: LearningWorld) {
  const csp = bag(this).conf?.app?.security?.csp;
  assert.equal(typeof csp, 'string', `app.security.csp is ${JSON.stringify(csp)}`);
});

Then('it contains the directives default-src, script-src, object-src, frame-src and img-src', function (this: LearningWorld) {
  assert.deepEqual(missingCsp(String(bag(this).conf?.app?.security?.csp)), []);
});

Then('script-src does not allow unsafe-inline or unsafe-eval', function (this: LearningWorld) {
  const map = parseCsp(String(bag(this).conf?.app?.security?.csp));
  const script = map.get('script-src') ?? map.get('default-src') ?? [];
  assert.equal(script.includes("'unsafe-inline'"), false);
  assert.equal(script.includes("'unsafe-eval'"), false);
});

// ---- webview 的 import

Then('none of them imports a node: module', function (this: LearningWorld) {
  const g = bag(this).graph!;
  assert.deepEqual(g.imports.filter((i) => i.spec.startsWith('UNRESOLVED:')), []);
  assert.deepEqual(g.imports.filter((i) => isNodeModule(i.spec)), []);
});

Then('none of them imports the schema log module', function (this: LearningWorld) {
  const g = bag(this).graph!;
  assert.deepEqual(g.imports.filter((i) => isSchemaLog(i.spec, i.file)), []);
});

// ---- 真前端

Then('the teach card and test card windows each point to an html file inside the built front end folder', function (this: LearningWorld) {
  const b = bag(this);
  const labels = (b.distEntries ?? []).map((e) => e.label).sort();
  assert.deepEqual(labels, ['teach', 'test']);
  for (const e of b.distEntries ?? []) {
    const html = join(b.distDir!, e.html);
    assert.ok(existsSync(html) && statSync(html).isFile(), `${e.label}: ${e.html} 不在 ${b.distDir}`);
  }
});

Then('every script and link in those html files resolves to a file that exists in that folder', function (this: LearningWorld) {
  const b = bag(this);
  assert.deepEqual(b.distProblems, []);
  for (const e of b.distEntries ?? []) {
    const refs = referencedAssets(readFileSync(join(b.distDir!, e.html), 'utf8'));
    assert.ok(refs.some((r) => /\.js$/.test(r.replace(/[?#].*$/, ''))), `${e.html} 沒有載入任何建置後的 script`);
  }
});

Then('no referenced file ends in .ts', function (this: LearningWorld) {
  const b = bag(this);
  for (const e of b.distEntries ?? []) {
    const refs = referencedAssets(readFileSync(join(b.distDir!, e.html), 'utf8'));
    assert.deepEqual(refs.filter((r) => r.replace(/[?#].*$/, '').endsWith('.ts')), [], e.html);
  }
});

Then('no placeholder content remains', function (this: LearningWorld) {
  const b = bag(this);
  for (const e of b.distEntries ?? []) {
    const html = readFileSync(join(b.distDir!, e.html), 'utf8');
    assert.equal(/placeholder/i.test(html), false, `${e.html} 還有 placeholder`);
  }
});

Then('the check fails and names the file', function (this: LearningWorld) {
  const problems = bag(this).fixtureProblems ?? [];
  assert.ok(problems.length > 0, 'T2b 的 teach.html 應該讓檢查失敗');
  assert.ok(problems.some((p) => p.includes('/teach-card/src/main.ts')), problems.join('\n'));
});
