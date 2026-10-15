/**
 * 10-desktop-shell phase-2:learning 根目錄只有一個來源(T2c-2,測試 agent 寫)。
 *
 * 對應 features/10-desktop-shell/phase-2.feature 裡「Where the learning directory is」那一段。
 * 全部經 probe(`lc-fs`)——跟 Tauri command、lc 協定呼叫同一份 library 的 `learning_root::resolve`。
 * probe 的 JSON 介面寫在 apps/desktop/src/test-support/probe.ts 的檔頭(startup / session / pointer-path / marker-compare / pointer-parse)。
 *
 * 隔離:每個場景一個 mkdtemp 沙箱(HOME、XDG_CONFIG_HOME、learning、cwd、TMPDIR 全在裡面)。
 * 不碰真的指標檔 `~/.config/llm-learning-cards/vault.json`,不碰真的 learning/。
 * 「沒寫任何檔」= 沙箱整棵目錄(含 HOME、XDG、learning、TMPDIR)啟動前後的檔案清單、內容雜湊、模式都一樣。
 */
import { After, Given, Then, When, BeforeAll } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { LearningWorld } from './_world.js';
import { BUILD_LC_FS_TIMEOUT_MS, buildLcFs } from '../../apps/desktop/src/test-support/build-lc-fs.js';
import { hexToBytes, runProbe, type ProbeResponse, type TraceEntry } from '../../apps/desktop/src/test-support/probe.js';
import {
  START_REASONS,
  VAULT_ID_A,
  VAULT_ID_B,
  VECTORS_ROW_COUNTS,
  VECTORS_SHA256,
  VECTORS_TOTAL_ROWS,
  arrangeStateRow,
  chmodZeroIsEffective,
  cleanupAllSandboxes,
  diffSnapshots,
  loadPointerVectors,
  makeSandbox,
  snapshotSandbox,
  vectorsFingerprint,
  writeMarker,
  writePointer,
  writePointerRaw,
  type Sandbox,
  type Snapshot,
  type StartReason,
} from '../../apps/desktop/src/test-support/learning-root-sandbox.js';

BeforeAll({ timeout: BUILD_LC_FS_TIMEOUT_MS }, function () {
  buildLcFs();
});

interface Ctx {
  sb: Sandbox;
  extraEnv: Record<string, string>;
  /** 要用 syscall shim 追蹤的目錄(數指標檔被開了幾次) */
  traceDir?: string;
  before?: Snapshot;
  after?: Snapshot;
  start?: ProbeResponse;
  trace: TraceEntry[];
  /** read / write / list / exists 那一次 */
  command?: ProbeResponse;
  asset?: ProbeResponse;
  session?: ProbeResponse;
  rows: { label: string; got: unknown; expect: unknown }[];
  rowSets: string[];
}

const ctxs = new WeakMap<LearningWorld, Ctx>();

After(function () {
  cleanupAllSandboxes();
});

function fresh(world: LearningWorld): Ctx {
  const sb = makeSandbox();
  world.dir = sb.parent;
  const c: Ctx = { sb, extraEnv: {}, trace: [], rows: [], rowSets: [] };
  ctxs.set(world, c);
  return c;
}

function ctx(world: LearningWorld): Ctx {
  const c = ctxs.get(world);
  if (!c) throw new Error('這個場景還沒有建立沙箱');
  return c;
}

function probeEnv(c: Ctx): Record<string, string> {
  return { XDG_CONFIG_HOME: c.sb.xdg, HOME: c.sb.home, TMPDIR: c.sb.tmp, ...c.extraEnv };
}

function run(c: Ctx, body: Record<string, unknown>): { resp: ProbeResponse; trace: TraceEntry[]; stderr: string } {
  assert.ok(!('root' in body), '請求裡不能有 root:根目錄只能經指標檔給');
  const shim = c.traceDir ? { dir: c.traceDir } : undefined;
  return runProbe(body, shim, { env: probeEnv(c), cwd: c.sb.cwd });
}

function requireChmod(): void {
  assert.ok(chmodZeroIsEffective(), '這個行程以 root 跑或檔案系統不認 chmod 000,「讀取失敗」的情境擺不出來——不能靜默略過');
}

function viewText(c: Ctx): string {
  const view = c.start?.view as { text?: unknown } | undefined;
  assert.ok(view && typeof view.text === 'string', `startup 的回應沒有 view.text: ${JSON.stringify(c.start)}`);
  return view.text;
}

const INIT_CMD = /npx tsx scripts\/vault\.ts init --learning-dir\s+\S+/;

// ---------------------------------------------------------------- Given

Given('the user-level pointer file does not exist', function (this: LearningWorld) {
  const c = fresh(this);
  // 旁邊放一個有合法標記的學習資料夾當誘餌:沒有指標檔就不能用它
  writeMarker(c.sb, `${VAULT_ID_A}\n`);
  assert.equal(existsSync(c.sb.pointer), false);
});

Given('the environment variable LC_LEARNING_ROOT names an existing directory', function (this: LearningWorld) {
  const c = ctx(this);
  writeMarker(c.sb, `${VAULT_ID_A}\n`);
  c.extraEnv.LC_LEARNING_ROOT = c.sb.learning;
});

Given(
  /^the user-level pointer file exists but (it is not valid JSON|reading it fails with a permission error|a field has the wrong type|learning_dir is a relative path)$/,
  function (this: LearningWorld, problem: string) {
    const c = fresh(this);
    writeMarker(c.sb, `${VAULT_ID_A}\n`);
    if (problem === 'it is not valid JSON') {
      writePointerRaw(c.sb, '{');
    } else if (problem === 'reading it fails with a permission error') {
      requireChmod();
      writePointer(c.sb, c.sb.learning, VAULT_ID_A);
      chmodSync(c.sb.pointer, 0o000);
    } else if (problem === 'a field has the wrong type') {
      writePointerRaw(c.sb, JSON.stringify({ learning_dir: 1, vault_id: VAULT_ID_A }));
    } else {
      // 相對路徑剛好能從 probe 的工作目錄走到存在的、標記相符的資料夾:仍然要拒絕
      writePointer(c.sb, relative(c.sb.cwd, c.sb.learning), VAULT_ID_A);
    }
    assert.ok(existsSync(c.sb.pointer) || problem === 'reading it fails with a permission error');
  },
);

Given('the pointer file names a learning directory that does not exist', function (this: LearningWorld) {
  const c = fresh(this);
  writePointer(c.sb, c.sb.missing, VAULT_ID_A);
  assert.equal(existsSync(c.sb.missing), false);
});

Given('the pointer file names an existing learning directory', function (this: LearningWorld) {
  const c = fresh(this);
  writePointer(c.sb, c.sb.learning, VAULT_ID_A);
});

Given(
  /^the identity marker of that directory (holds a different identity|does not exist|cannot be read|matches only in its first 8 characters|has two trailing newlines)$/,
  function (this: LearningWorld, marker: string) {
    const c = ctx(this);
    if (marker === 'holds a different identity') writeMarker(c.sb, `${VAULT_ID_B}\n`);
    else if (marker === 'does not exist') assert.equal(existsSync(c.sb.marker), false);
    else if (marker === 'cannot be read') {
      requireChmod();
      writeMarker(c.sb, `${VAULT_ID_A}\n`);
      chmodSync(c.sb.marker, 0o000);
    } else if (marker === 'matches only in its first 8 characters') writeMarker(c.sb, 'aaaaaaaa-0000-4000-8000-000000000000\n');
    else writeMarker(c.sb, `${VAULT_ID_A}\n\n`);
  },
);

Given('the identity marker of that directory matches the pointer file', function (this: LearningWorld) {
  writeMarker(ctx(this).sb, `${VAULT_ID_A}\n`);
});

Given('XDG_CONFIG_HOME names a temporary directory containing a valid pointer file', function (this: LearningWorld) {
  const c = fresh(this);
  writePointer(c.sb, c.sb.learning, VAULT_ID_A);
  writeMarker(c.sb, `${VAULT_ID_A}\n`);
  // 兩個誘餌:Tauri 的 app_config_dir(`<XDG>/<identifier>/`)與忽略 XDG 的 `~/.config`。找錯地方就會看到「別的」結果。
  const decoys = [join(c.sb.xdg, 'dev.learningcards.desktop'), join(c.sb.home, '.config', 'llm-learning-cards'), join(c.sb.home, '.config', 'dev.learningcards.desktop')];
  for (const dir of decoys) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'vault.json'), JSON.stringify({ learning_dir: c.sb.missing, vault_id: VAULT_ID_B }));
  }
  c.traceDir = join(c.sb.xdg, 'dev.learningcards.desktop');
});

function startFor(c: Ctx): void {
  c.before = snapshotSandbox(c.sb);
  const r = run(c, { op: 'startup' });
  c.start = r.resp;
  c.trace = r.trace;
  c.after = snapshotSandbox(c.sb);
}

const STATE_RE = /^the start state is (pointer-missing|pointer-unreadable|learning-dir-missing|marker-mismatch|ok)$/;

/**
 * 同一句話在 Given(擺好這個狀態並啟動)與 Then(檢查啟動的結果)都出現;cucumber 不分關鍵字,所以只能有一個定義:
 * 已經啟動過(When「the application starts」之後)就是檢查,還沒有就是擺好並啟動。
 */
Given(STATE_RE, function (this: LearningWorld, state: string) {
  assert.ok((START_REASONS as string[]).includes(state));
  const existing = ctxs.get(this);
  if (existing?.start) {
    assert.equal(existing.start.ok, true, JSON.stringify(existing.start));
    assert.equal(existing.start.state, state, `啟動狀態不對: ${JSON.stringify(existing.start)}`);
    return;
  }
  const c = fresh(this);
  const reason = state as StartReason;
  const writeValidMarker = (): void => writeMarker(c.sb, `${VAULT_ID_A}\n`);
  if (reason === 'pointer-missing') writeValidMarker();
  else if (reason === 'pointer-unreadable') {
    writeValidMarker();
    writePointerRaw(c.sb, '{');
  } else if (reason === 'learning-dir-missing') writePointer(c.sb, c.sb.missing, VAULT_ID_A);
  else if (reason === 'marker-mismatch') {
    writePointer(c.sb, c.sb.learning, VAULT_ID_A);
    writeMarker(c.sb, `${VAULT_ID_B}\n`);
  } else {
    writePointer(c.sb, c.sb.learning, VAULT_ID_A);
    writeValidMarker();
    mkdirSync(join(c.sb.learning, 'cards'), { recursive: true });
    writeFileSync(join(c.sb.learning, 'cards', 'c.md'), 'CARD-IN-ROOT');
  }
  startFor(c);
  assert.equal(c.start?.state, reason, `擺好的狀態沒有啟動成 ${reason}: ${JSON.stringify(c.start)}`);
});

// ---------------------------------------------------------------- When

When('the application starts', function (this: LearningWorld) {
  startFor(ctx(this));
});

When(
  'the front end reads a card through the read command and the web view requests the same card through the asset protocol',
  function (this: LearningWorld) {
    const c = ctx(this);
    c.traceDir = join(c.sb.xdg, 'llm-learning-cards');
    c.before = snapshotSandbox(c.sb);
    const r = run(c, {
      op: 'session',
      requests: [
        { kind: 'read', path: 'cards/c.md' },
        { kind: 'asset', path: 'cards/c.md' },
      ],
    });
    c.session = r.resp;
    c.trace = r.trace;
    c.after = snapshotSandbox(c.sb);
  },
);

When(
  /^the front end calls the (read|write|list|exists) command with a legal relative path$/,
  function (this: LearningWorld, command: string) {
    const c = ctx(this);
    const path = command === 'list' ? 'cards' : 'cards/c.md';
    c.before = snapshotSandbox(c.sb);
    const body: Record<string, unknown> = { op: command, path };
    if (command === 'write') body.content = 'x';
    c.command = run(c, body).resp;
    c.asset = run(c, { op: 'asset', path: 'cards/c.md' }).resp;
    c.after = snapshotSandbox(c.sb);
  },
);

When('the Rust resolver computes the pointer path for every row of the pointer_path vectors', function (this: LearningWorld) {
  const c = fresh(this);
  for (const row of loadPointerVectors().pointer_path) {
    const xdg = row.env.XDG_CONFIG_HOME;
    const pure = run(c, { op: 'pointer-path', xdg: xdg ?? null, home: row.home }).resp;
    c.rows.push({ label: `pure ${row.why}`, got: pure.value, expect: row.expect });
    // 同一列用「真的環境變數」再跑一次 startup:probe 從 XDG_CONFIG_HOME / HOME 自己找
    const env: Record<string, string | undefined> = { HOME: row.home, TMPDIR: c.sb.tmp, XDG_CONFIG_HOME: xdg };
    const real = runProbe({ op: 'startup' }, undefined, { env, cwd: c.sb.cwd }).resp;
    c.rows.push({ label: `env ${row.why}`, got: real.pointerPath, expect: row.expect });
    c.rowSets.push(xdg === undefined ? 'unset' : xdg === '' ? 'empty' : 'set');
  }
});

When('the Rust resolver compares the marker text and the vault id of every row of the marker_compare vectors', function (this: LearningWorld) {
  const c = fresh(this);
  for (const row of loadPointerVectors().marker_compare) {
    const got = run(c, { op: 'marker-compare', markerText: row.marker_text, vaultId: row.vault_id }).resp;
    c.rows.push({ label: row.why, got: got.value, expect: row.expect });
  }
});

When('the Rust resolver parses the raw content of every row of the pointer_content vectors', function (this: LearningWorld) {
  const c = fresh(this);
  for (const row of loadPointerVectors().pointer_content) {
    const got = run(c, { op: 'pointer-parse', raw: row.raw }).resp;
    const summary = { value: got.value, learningDir: got.learningDir, vaultId: got.vaultId };
    const expected =
      row.expect === 'ok'
        ? { value: 'ok', learningDir: row.learning_dir, vaultId: row.vault_id }
        : { value: 'unreadable', learningDir: undefined, vaultId: undefined };
    c.rows.push({ label: row.why, got: summary, expect: expected });
  }
});

When('the Rust resolver runs every row of the states vectors in a temporary directory', function (this: LearningWorld) {
  const holder = fresh(this);
  for (const row of loadPointerVectors().states) {
    if (row.pointer.kind === 'io-error' || row.marker.kind === 'io-error') requireChmod();
    const sb = makeSandbox();
    const c: Ctx = { sb, extraEnv: {}, trace: [], rows: [], rowSets: [] };
    Object.assign(c.extraEnv, arrangeStateRow(sb, row));
    const before = snapshotSandbox(sb);
    const resp = run(c, { op: 'startup' }).resp;
    const problems = diffSnapshots(before, snapshotSandbox(sb));
    holder.rows.push({ label: row.why, got: { state: resp.state, writes: problems }, expect: { state: row.expect, writes: [] } });
    sb.cleanup();
  }
});

// ---------------------------------------------------------------- Then

Then('the screen says the learning directory is not set up yet', function (this: LearningWorld) {
  assert.ok(viewText(ctx(this)).includes('還沒有設定 learning 資料夾'));
});

Then('the screen shows the full command {string} followed by a path placeholder', function (this: LearningWorld, command: string) {
  assert.equal(command, 'npx tsx scripts/vault.ts init --learning-dir');
  // 指令後面接一個不是空白的記號(路徑佔位,例如 <路徑>)
  assert.match(viewText(ctx(this)), new RegExp(`${command.replaceAll('.', '\\.')}\\s+\\S+`));
});

Then('the application wrote no file anywhere', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.before && c.after, '沒有前後快照');
  assert.deepEqual(diffSnapshots(c.before, c.after), []);
});

Then('the screen says the settings file cannot be read', function (this: LearningWorld) {
  assert.ok(viewText(ctx(this)).includes('設定檔讀不到'));
});

Then('the screen shows the absolute path of the pointer file', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.start?.pointerPath, c.sb.pointer);
  assert.ok(viewText(c).includes(c.sb.pointer), `畫面沒有指標檔的絕對路徑 ${c.sb.pointer}`);
});

Then('the pointer file is byte-identical to before', function (this: LearningWorld) {
  const c = ctx(this);
  const rel = relative(c.sb.parent, c.sb.pointer);
  const b = c.before?.get(rel);
  const a = c.after?.get(rel);
  assert.ok(b && a, '指標檔不見了');
  assert.deepEqual(a, b);
  // 讀得到的情況再直接比位元組
  try {
    assert.equal(readFileSync(c.sb.pointer, 'utf8').length > 0, true);
  } catch {
    /* chmod 000 的那一列讀不了;快照比對已經涵蓋 */
  }
});

Then('the screen says the folder could not be found', function (this: LearningWorld) {
  assert.ok(viewText(ctx(this)).includes('找不到資料夾'));
});

Then('the screen shows that path and the full init command', function (this: LearningWorld) {
  const c = ctx(this);
  const text = viewText(c);
  assert.ok(text.includes(c.sb.missing), `畫面沒有那個路徑 ${c.sb.missing}`);
  assert.match(text, INIT_CMD);
});

Then('the screen says this is not the same folder', function (this: LearningWorld) {
  assert.ok(viewText(ctx(this)).includes('這不是同一個資料夾'));
});

Then('neither the pointer file nor the marker is changed', function (this: LearningWorld) {
  const c = ctx(this);
  for (const p of [c.sb.pointer, c.sb.marker]) {
    const rel = relative(c.sb.parent, p);
    assert.deepEqual(c.after?.get(rel), c.before?.get(rel), `${rel} 被改了`);
  }
});

Then('the teach card window and the test card window are opened', function (this: LearningWorld) {
  assert.deepEqual(ctx(this).start?.windows, ['teach', 'test']);
});

Then('both were served from the same learning directory', function (this: LearningWorld) {
  const c = ctx(this);
  const results = (c.session?.results ?? []) as { kind: string; ok: boolean; valueText?: string; status?: number; bodyHex?: string; fsCalls?: { path: string }[] }[];
  assert.equal(results.length, 2, JSON.stringify(c.session));
  const [read, asset] = results;
  assert.equal(read?.kind, 'read');
  assert.equal(read?.ok, true, JSON.stringify(read));
  assert.equal(read?.valueText, 'CARD-IN-ROOT');
  assert.equal(asset?.kind, 'asset');
  assert.equal(asset?.status, 200, JSON.stringify(asset));
  assert.equal(hexToBytes(String(asset?.bodyHex ?? '')).toString('utf8'), 'CARD-IN-ROOT');
  for (const r of results) {
    for (const call of r.fsCalls ?? []) {
      // fsCalls 記的是相對根目錄的路徑(或根底下的絕對路徑);往上跳或別的絕對路徑都不行
      const inside = isAbsolute(call.path) ? call.path.startsWith(`${c.sb.learning}/`) : !call.path.split('/').includes('..');
      assert.ok(inside, `${r.kind} 碰了根目錄以外的路徑 ${call.path}`);
    }
  }
  assert.equal(c.session?.root, c.sb.learning);
});

Then('the pointer file was read once for the whole run', function (this: LearningWorld) {
  const c = ctx(this);
  const opens = c.trace.filter((t) => t.call === 'open:file' && (t.fields.path ?? '').endsWith('/vault.json'));
  assert.equal(opens.length, 1, `指標檔被開了 ${opens.length} 次: ${c.trace.map((t) => `${t.call} ${t.fields.path}`).join(' | ')}`);
});

Then('the call fails with the not-configured error', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.command?.ok, false, JSON.stringify(c.command));
  const err = c.command?.error as { kind?: string } | null | undefined;
  assert.equal(err?.kind, 'not-configured', JSON.stringify(c.command));
  assert.deepEqual(c.command?.fsCalls ?? [], [], '未設定時不該碰任何檔案');
});

Then('the error is neither a refusal nor an io error', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.command?.refused, false);
  const err = c.command?.error as { kind?: string } | null | undefined;
  assert.ok(err && err.kind !== 'refused' && err.kind !== 'io', JSON.stringify(err));
});

Then('the learning log gets no new line', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.before && c.after);
  assert.deepEqual(diffSnapshots(c.before, c.after), [], '失敗狀態下不該有任何新檔或改動,包括 state/log.jsonl');
  assert.equal(existsSync(join(c.sb.learning, 'state', 'log.jsonl')), false);
});

Then('the asset protocol answers 403 for the same path', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.asset?.status, 403, JSON.stringify(c.asset));
  assert.ok(c.before && c.after);
  assert.deepEqual(diffSnapshots(c.before, c.after), []);
});

Then('each result equals the expected path of its row', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.rows.length, VECTORS_ROW_COUNTS.pointer_path * 2);
  for (const r of c.rows) assert.equal(r.got, r.expect, r.label);
});

Then('the rows cover XDG_CONFIG_HOME set, unset and the empty string', function (this: LearningWorld) {
  assert.deepEqual([...new Set(ctx(this).rowSets)].sort(), ['empty', 'set', 'unset']);
});

Then('each result is equal or not-equal exactly as its row says', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.rows.length, VECTORS_ROW_COUNTS.marker_compare);
  for (const r of c.rows) assert.equal(r.got, r.expect, r.label);
});

Then(
  "each result is ok with the row's learning_dir and vault_id, or unreadable, exactly as its row says",
  function (this: LearningWorld) {
    const c = ctx(this);
    assert.equal(c.rows.length, VECTORS_ROW_COUNTS.pointer_content);
    for (const r of c.rows) assert.deepEqual(r.got, r.expect, r.label);
  },
);

Then('each start state equals the expected reason of its row', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.rows.length, VECTORS_ROW_COUNTS.states);
  for (const r of c.rows) assert.deepEqual(r.got, r.expect, r.label);
  // 五種原因每一種至少出現一次,沒有哪個狀態是空轉
  const seen = new Set(c.rows.map((r) => (r.expect as { state: string }).state));
  assert.deepEqual([...seen].sort(), [...START_REASONS].sort());
});

Then('the vectors file has 47 rows in total and its sha256 is the pinned value', function () {
  const f = vectorsFingerprint();
  assert.equal(f.total, VECTORS_TOTAL_ROWS);
  assert.deepEqual(f.counts, VECTORS_ROW_COUNTS);
  assert.equal(f.sha256, VECTORS_SHA256);
});

Then('the pointer file was not looked up under the Tauri application config directory', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.start?.pointerPath, join(c.sb.xdg, 'llm-learning-cards', 'vault.json'));
  const decoyOpens = c.trace.filter((t) => t.call.startsWith('open:') && (t.fields.path ?? '').includes('dev.learningcards.desktop'));
  assert.equal(decoyOpens.length, 0, `去開了 Tauri 的設定目錄: ${decoyOpens.map((t) => t.fields.path).join(', ')}`);
});
