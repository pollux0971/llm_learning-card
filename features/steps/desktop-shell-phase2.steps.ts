/**
 * 10-desktop-shell / phase-2。
 *
 * 步驟只呼叫 apps/desktop/src/ 的邊界。拒絕往返之後,由那個 TS 呼叫端
 * 自己 recordEvent;這裡只斷言 log 裡出現 warning。asset handler 的拒絕
 * 不該出現在 learning log。
 *
 * 暫存目錄一律 mkdtemp,symlink 與哨兵檔也在那個暫存目錄裡,不指向真的 learning/。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { openBoundary, type Boundary, type BoundaryResult } from '../../apps/desktop/src/boundary.js';
import { decideStartup, saveChosenPath, type StartupDecision } from '../../apps/desktop/src/startup.js';
import {
  assetProtocolStatus,
  frontEndStatus,
  pluginDirectRead,
  type AssetProtocolStatus,
  type FrontEndStatus,
  type PluginRefusal,
} from '../../apps/desktop/src/shell-config.js';

const REPO = join(import.meta.dirname, '../..');

interface Bag {
  parent: string;
  root: string;
  outsideFile: string;
  configPath: string;
  logPath: string;
  mode: 'startup' | 'frontends' | 'config' | 'boundary';
  boundary?: Boundary;
  last?: BoundaryResult;
  err?: unknown;
  startup?: StartupDecision;
  chosen?: string;
  linkRel?: string;
  listDir?: string;
  decoded?: string;
  bytes?: number;
  rawHash?: string;
  assetStatus?: AssetProtocolStatus;
  front?: FrontEndStatus;
  plugin?: PluginRefusal;
  url?: string;
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
  const parent = mkdtempSync(join(tmpdir(), 'lc-p2-'));
  const root = join(parent, 'learning');
  const outsideDir = join(parent, 'outside');
  mkdirSync(root, { recursive: true });
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
  };
  bags.set(world, b);
  return b;
}

function boundaryOf(world: LearningWorld): Boundary {
  const b = ensure(world, 'boundary');
  if (!b.boundary) b.boundary = openBoundary(b.root);
  return b.boundary;
}

function parseJsonPath(raw: string): string {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'string') throw new Error(`路徑欄不是 JSON 字串: ${raw}`);
  return parsed;
}

function refused(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { refused?: boolean }).refused === true;
}

async function callOp(world: LearningWorld, op: string, rel: string): Promise<void> {
  const b = ensure(world, 'boundary');
  const boundary = boundaryOf(world);
  b.err = undefined;
  try {
    if (op === 'read') {
      await boundary.read(rel);
    } else if (op === 'write') {
      await boundary.write(rel, 'phase-2');
    } else if (op === 'exists') {
      await boundary.exists(rel);
    } else if (op === 'list') {
      await boundary.list(rel);
    } else {
      throw new Error(`未知操作 ${op}`);
    }
    b.last = boundary.last();
  } catch (err) {
    b.err = err;
    b.last = boundary.last();
  }
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

function warnings(logPath: string): { type?: string; path?: string }[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { type?: string; path?: string });
}

function plant(root: string, rel: string, content = 'ok'): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
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

Given('the boundary sits in front of a file system that records every call it receives', function (this: LearningWorld) {
  boundaryOf(this);
});

Given('the application configuration', function (this: LearningWorld) {
  const b = ensure(this, 'config');
  b.assetStatus = assetProtocolStatus(REPO);
});

Given('a directory that contains a hidden entry ".hidden" and a file "ok.md"', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  b.listDir = 'cards';
  mkdirSync(join(b.root, 'cards'), { recursive: true });
  writeFileSync(join(b.root, 'cards', '.hidden'), 'nope');
  writeFileSync(join(b.root, 'cards', 'ok.md'), 'yes');
});

Given('a symbolic link inside the learning directory points outside it', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  mkdirSync(join(b.root, 'cards'), { recursive: true });
  b.linkRel = 'cards/link.md';
  symlinkSync(b.outsideFile, join(b.root, b.linkRel));
});

// ---------------------------------------------------------------- When

When('the application starts', function (this: LearningWorld) {
  const b = bags.get(this);
  if (b?.mode === 'startup') {
    b.startup = decideStartup(b.configPath);
    return;
  }
  const front = ensure(this, 'frontends');
  front.front = frontEndStatus(REPO);
});

When('the front end requests a card file', async function (this: LearningWorld) {
  const rel = 'cards/security/sec-0042.md';
  const b = ensure(this, 'boundary');
  plant(b.root, rel, '# card');
  await callOp(this, 'read', rel);
});

When(
  /^the front end requests the JSON-encoded path (.*) through the read command$/,
  async function (this: LearningWorld, raw: string) {
    const rel = parseJsonPath(raw);
    const b = ensure(this, 'boundary');
    b.decoded = rel;
    await callOp(this, 'read', rel);
  },
);

When(
  /^the front end requests the path "cards\/a\.md", then a NUL character, then "\.png" through the read command$/,
  async function (this: LearningWorld) {
    await callOp(this, 'read', 'cards/a.md\0.png');
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
    if (rel === 'cards/%EA%B0%80.md') plant(b.root, 'cards/\uac00.md', 'hangul');
    const boundary = boundaryOf(this);
    b.last = await boundary.requestAsset(rel);
    b.err = b.last.ok ? undefined : { refused: true };
  },
);

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

When(
  /^the front end calls assetUrl with the JSON-encoded path (.*)$/,
  function (this: LearningWorld, raw: string) {
    const rel = parseJsonPath(raw);
    const b = ensure(this, 'boundary');
    const boundary = boundaryOf(this);
    b.url = undefined;
    b.err = undefined;
    b.decoded = rel;
    try {
      b.url = boundary.assetUrl(rel);
      b.last = boundary.last();
    } catch (err) {
      b.err = err;
      b.last = boundary.last();
    }
  },
);

When(/^the front end lists the JSON-encoded directory (.*)$/, async function (this: LearningWorld, raw: string) {
  await callOp(this, 'list', parseJsonPath(raw));
});

When('the front end lists that directory', async function (this: LearningWorld) {
  const b = bag(this);
  await callOp(this, 'list', b.listDir ?? 'cards');
  // 「the result is ["ok.md"]」由 common.steps.ts 的 `the result is {}` 比對 resultText。
  if (b.err) {
    this.resultText = `error:${(b.err as Error).message ?? 'refused'}`;
    return;
  }
  this.resultText = JSON.stringify(b.last?.value);
  this.lastResult = b.last?.value;
});

When('the front end requests that path', async function (this: LearningWorld) {
  const b = bag(this);
  await callOp(this, 'read', b.linkRel ?? '');
});

When('the front end attempts a direct file read outside the scope', function (this: LearningWorld) {
  const b = ensure(this, 'boundary');
  b.plugin = pluginDirectRead(REPO, b.outsideFile);
});

When('an asset url is requested for an image inside the assets directory', function (this: LearningWorld) {
  const boundary = boundaryOf(this);
  const b = bag(this);
  b.url = boundary.assetUrl('assets/sec-0042-diagram.png');
  b.last = boundary.last();
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
  assert.equal(refused(b.err) || b.last?.refused === true, true, '拒絕要回到呼叫端');
});

Then('the refusal is returned to the TypeScript caller', function (this: LearningWorld) {
  const b = bag(this);
  assert.equal(refused(b.err) || b.last?.refused === true, true);
});

Then('the TypeScript caller records a warning event through recordEvent', function (this: LearningWorld) {
  const b = bag(this);
  const path = b.last?.fsCalls[0]?.path ?? b.decoded;
  const hits = warnings(b.logPath).filter((e) => e.type === 'warning');
  assert.ok(hits.length >= 1, `log 裡沒有 warning: ${b.logPath}`);
  if (path) assert.ok(hits.some((e) => e.path === path), `warning 沒有帶路徑 ${path}`);
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
  assert.equal(b.err, undefined);
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

Then('the refusal is written to the Rust log only', function (this: LearningWorld) {
  const lines = bag(this).last?.rustLog ?? [];
  assert.ok(lines.some((l) => /refus/i.test(l)), `Rust log 沒有拒絕: ${JSON.stringify(lines)}`);
});

Then('no warning event is written to the learning log', function (this: LearningWorld) {
  const hits = warnings(bag(this).logPath).filter((e) => e.type === 'warning');
  assert.equal(hits.length, 0);
});

Then('the asset protocol is enabled with a scope limited to the learning directory', function (this: LearningWorld) {
  const s = bag(this).assetStatus;
  assert.ok(s, '沒有讀到協定設定');
  assert.equal(s.customEnabled, true);
  assert.equal(s.scopeIsLearningRoot, true);
  assert.equal(s.scheme, 'lc');
  assert.equal(s.builtinEnabled, false);
  assert.deepEqual(s.builtinScope, []);
});

Then('the asset protocol applies the same path checks as the read command', async function (this: LearningWorld) {
  const s = bag(this).assetStatus;
  assert.equal(s?.sameChecksAsRead, true);
  const b = ensure(this, 'boundary');
  await callOp(this, 'read', '../etc/passwd');
  const readRefused = bag(this).last?.ok !== true;
  const asset = await boundaryOf(this).requestAsset('../etc/passwd');
  b.last = asset;
  assert.equal(readRefused, true);
  assert.equal(asset.ok, false);
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
  assert.equal(refused(b.err), true);
});

// 「the result is ["ok.md"]」交給 common.steps.ts 的 `the result is {}`(比對 resultText)。
// 「no error is raised」已定義在 llm-router.steps.ts,看的是 probe 錯誤,不是這條邊界。
// 不能再定義。清單若丟錯,上一句 resultText 不會是 ["ok.md"],場景仍紅。碰撞寫進報告。

Then('the plugin refuses it independently of the command check', function (this: LearningWorld) {
  const p = bag(this).plugin;
  assert.equal(p?.refused, true);
  assert.equal(p?.by, 'plugin');
  assert.equal(p?.commandCheckCalled, false);
});

Then('a url the web view can load is returned', function (this: LearningWorld) {
  assert.equal(bag(this).url, 'lc://localhost/assets/sec-0042-diagram.png');
});

Then('the same path checks apply', function (this: LearningWorld) {
  const boundary = boundaryOf(this);
  assert.throws(() => boundary.assetUrl('assets/../secret'), (err: unknown) => refused(err));
});

Then('the teach card and test card front ends are loaded', function (this: LearningWorld) {
  const f = bag(this).front;
  assert.equal(f?.teachLoaded, true);
  assert.equal(f?.testLoaded, true);
});

Then('no placeholder content remains', function (this: LearningWorld) {
  assert.equal(bag(this).front?.placeholderRemains, false);
});
