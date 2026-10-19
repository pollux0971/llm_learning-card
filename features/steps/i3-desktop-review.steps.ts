/**
 * I3 整合(docs/integration/i3-desktop-review.feature)的步驟定義(工單 T34 A)。測試 agent(-e5)寫;產品程式一個字沒改。
 *
 * 整合點自己的驗收要接上**真的零件**:
 *   - 「視窗」= 考試卡的 `TestSession` ← `ReviewClient`(handler 模式)← **真的側車子行程**(`scripts/review-sidecar.ts`,
 *     跟 Rust 起的同一支;harness 是 features/support/review-sidecar-harness.ts 的 spawnSidecar);
 *   - 「終端機」= 真的 `scripts/review.ts --dry-run`;
 *   - 「Tauri 邊界」= webview 端真的 `createLearningFs()`,`invoke` 轉到 lc-fs probe(跟 Tauri command 同一份 learning_fs)。
 *
 * 全部用暫存根(learning 是 Background 的 fixture 複本;XDG_*、HOME 同一個 mkdtemp)、假雲端(LC_REVIEW_FAKE_CLOUD),
 * 不碰真的 learning/、不碰網路。
 *
 * 日期釘住:側車的 `LC_REVIEW_TODAY` 與 `review.ts` 的 `--today` 都取 `world.today`(同一個值),跨午夜也不會假紅。
 * 「same session」與「same state」兩條,終端機那份名單**先於視窗**算(--dry-run 不建、不改快取):
 * 若先讓視窗寫了當日快取,終端機的 --dry-run 會讀視窗的快取,側車排錯也會「一樣」。
 *
 * 跟其他 feature 共用的兩句(「a fixed learning directory and a fixed date」「the person has answered one question」)
 * 的定義在 test-card-phase2.steps.ts,依 `isI3(world)` 分派到這裡的函式(cucumber 不准同一句定義兩次)。
 * 「Then a full session can be completed as in I2」在 i2-review-loop.steps.ts(要用它的內部函式)。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { BUILD_LC_FS_TIMEOUT_MS, buildLcFs } from '../../apps/desktop/src/test-support/build-lc-fs.js';
import { LC_FS_BIN, runProbe } from '../../apps/desktop/src/test-support/probe.js';
import { loadWebviewLearningFs } from '../../apps/desktop/src/test-support/webview-learning-fs.js';
import { createReviewClient } from '../../apps/desktop/src/webview/review-client.js';
import { runReview, readReviews, type Vault } from '../support/review-session-harness.js';
import { spawnSidecar, type Sidecar } from '../support/review-sidecar-harness.js';
import { answerCurrent, makeSession, vaultFs, walkToEnd, type Session } from '../support/test-card-rig.js';

const FIXED_TODAY = '2026-09-10';

interface I3State {
  active: boolean;
  scratch?: string;
  vault?: Vault;
  sidecar?: Sidecar;
  session?: Session;
  /** 終端機 --dry-run 先算的完整名單(視窗還沒碰任何東西) */
  expected: string[];
  windowList: string[];
  terminalList: string[];
  terminalOut: string;
  answeredCard?: string;
  /** 邊界:webview 的 createLearningFs 叫過的 command */
  invokes: { cmd: string; args: Record<string, unknown>; refused: boolean }[];
  readText?: string;
  readPath?: string;
  fs?: { read(relPath: string): Promise<string> };
  mod?: Awaited<ReturnType<typeof loadWebviewLearningFs>>;
  outsideFile?: string;
}

const states = new WeakMap<LearningWorld, I3State>();
function st(world: LearningWorld): I3State {
  let s = states.get(world);
  if (!s) {
    s = { active: false, expected: [], windowList: [], terminalList: [], terminalOut: '', invokes: [] };
    states.set(world, s);
  }
  return s;
}

/** 這個場景屬於 I3 整合 feature(其他步驟檔共用的句子用它分派) */
export function isI3(world: LearningWorld): boolean {
  return states.get(world)?.active === true;
}

Before(function (this: LearningWorld, { pickle }) {
  if (pickle.uri.endsWith('docs/integration/i3-desktop-review.feature')) st(this).active = true;
});

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (!s?.active) return;
  if (s.sidecar?.isAlive()) s.sidecar.kill();
  if (s.scratch) rmSync(s.scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 暫存世界

function dirOf(world: LearningWorld): string {
  assert.ok(world.dir, 'Background 應該先建立 learning 目錄(a learning directory populated by the I1 pipeline)');
  return world.dir;
}

/** Background 建好的 learning 目錄 + 同一個 mkdtemp 底下的 XDG_*、HOME、指標檔、帳本身分(跟 I2 的 setupVault 同一個樣子) */
function vaultOf(world: LearningWorld): Vault {
  const s = st(world);
  if (s.vault) return s.vault;
  const dir = dirOf(world);
  const scratch = mkdtempSync(join(tmpdir(), 'lc-i3-'));
  s.scratch = scratch;
  const xdgConfig = join(scratch, 'config-home');
  const xdgCache = join(scratch, 'cache-home');
  const home = join(scratch, 'home');
  for (const d of [xdgConfig, xdgCache, home]) mkdirSync(d, { recursive: true });
  const vaultId = randomUUID();
  mkdirSync(join(xdgConfig, 'llm-learning-cards'), { recursive: true });
  writeFileSync(join(xdgConfig, 'llm-learning-cards', 'vault.json'), JSON.stringify({ learning_dir: dir, vault_id: vaultId }), 'utf8');
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config/vault-id'), `${vaultId}\n`, 'utf8');
  s.vault = { scratch, dir, xdgConfig, xdgCache, home, vaultId };
  return s.vault;
}

/** 終端機那一邊:真的 `review.ts --dry-run`,依序回卡 id;日期用 world.today(跟側車同一個值) */
async function terminalCards(world: LearningWorld): Promise<{ cards: string[]; output: string }> {
  const out = await runReview(vaultOf(world), { today: world.today, args: ['--dry-run'] });
  assert.equal(out.status, 0, `review.ts --dry-run 失敗(${out.status}):\n${out.output}`);
  const cards = out.stdout
    .split('\n')
    .map((l) => /^(sec-\d{4})\s+stage\s+\d/.exec(l)?.[1])
    .filter((id): id is string => id !== undefined);
  return { cards, output: out.stdout };
}

/** 視窗那一邊:真的側車子行程 + ReviewClient(handler 把一行 JSON 寫進它的 stdin、讀它 stdout 的下一行)+ TestSession */
async function openWindow(world: LearningWorld): Promise<Session> {
  const s = st(world);
  const vault = vaultOf(world);
  const proc = spawnSidecar(vault, { today: world.today });
  s.sidecar = proc;
  const hello = await proc.nextLine(60_000);
  assert.ok(hello, `側車沒有在 60 秒內送出 hello(stderr:${proc.stderr().slice(-400)})`);
  assert.equal((JSON.parse(hello) as { kind?: string }).kind, 'hello', `第一行應該是 hello:${hello}`);
  const client = createReviewClient({
    handler: async (line: string) => {
      proc.writeRaw(`${line}\n`);
      const reply = await proc.nextLine(60_000);
      if (reply === undefined) throw new Error(`側車沒有回應(stderr:${proc.stderr().slice(-400)})`);
      return reply;
    },
  });
  const session = await makeSession(client, vaultFs(vault));
  s.session = session;
  return session;
}

// ---------------------------------------------------------------- Background

Given('the desktop application is built for Linux', { timeout: BUILD_LC_FS_TIMEOUT_MS + 30_000 }, function () {
  assert.equal(process.platform, 'linux', `整合點 I3 在 Linux 上驗收(process.platform = ${process.platform})`);
  const finished = buildLcFs();
  assert.ok(existsSync(LC_FS_BIN), `lc-fs 編完了卻沒有 ${LC_FS_BIN}:${finished}`);
});

// ---------------------------------------------------------------- 場景:視窗與終端機排出同一個 session

/** 「a fixed learning directory and a fixed date」的 I3 版(test-card-phase2.steps.ts 分派過來) */
export function i3FixedDirectoryAndDate(world: LearningWorld): void {
  assert.equal(world.today, FIXED_TODAY, `固定日期應該是 ${FIXED_TODAY}`);
  vaultOf(world);
}

When('the question list is built in the window and in the terminal', { timeout: 300_000 }, async function (this: LearningWorld) {
  const s = st(this);
  // 終端機先:--dry-run 不建、不改快取,視窗還沒碰任何東西。
  const terminal = await terminalCards(this);
  s.terminalList = terminal.cards;
  const session = await openWindow(this);
  await session.init();
  s.windowList = await walkToEnd(session);
});

Then('the two lists are identical in content and order', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.terminalList.length, 5, `終端機應該列出 5 張到期的卡:${JSON.stringify(s.terminalList)}`);
  assert.deepEqual(s.windowList, s.terminalList, '視窗(真的側車)依序問的卡,應該跟終端機(review.ts --dry-run)列的內容與順序一樣');
});

// ---------------------------------------------------------------- 場景:檔案存取走 Tauri 邊界

When('the window reads a card file', { timeout: 120_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const dir = dirOf(this);
  s.mod = await loadWebviewLearningFs();
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const path = cmd === 'list' ? args.relDir : args.relPath;
    assert.equal(typeof path, 'string', `invoke(${cmd}) 要有字串路徑參數:${JSON.stringify(args)}`);
    const body: Record<string, unknown> = { op: cmd, root: dir, path };
    if (cmd === 'write') body.content = args.content;
    const run = runProbe(body);
    s.invokes.push({ cmd, args, refused: run.resp.refused });
    if (run.resp.error) throw run.resp.error;
    return run.resp.value ?? null;
  };
  s.fs = s.mod.createLearningFs({ invoke, os: 'linux' });
  s.readPath = 'cards/security/sec-0001.md';
  s.readText = await s.fs.read(s.readPath);
});

Then('it calls the read command', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.invokes.length, 1, `應該剛好叫了一次 command:${JSON.stringify(s.invokes)}`);
  const call = s.invokes[0]!;
  assert.equal(call.cmd, 'read', '讀卡片要走 read 這個 command');
  assert.equal(call.args.relPath, s.readPath, 'command 的參數是相對 learning 目錄的路徑,原樣');
  assert.ok(!String(call.args.relPath).startsWith('/'), '路徑不能是絕對路徑');
  assert.ok(!String(call.args.relPath).includes(dirOf(this)), '路徑不能帶 learning 目錄的絕對位置');
  assert.equal(call.refused, false);
  assert.equal(s.readText, readFileSync(join(dirOf(this), s.readPath!), 'utf8'), '讀回來的內容就是磁碟上那張卡');
});

/** learning 目錄外的哨兵檔:讀得到內容就是守門失敗 */
function outsideSentinel(world: LearningWorld): string {
  const s = st(world);
  if (s.outsideFile) return s.outsideFile;
  const scratch = (vaultOf(world).scratch);
  const file = join(scratch, 'outside-secret.txt');
  writeFileSync(file, 'SENTINEL-OUTSIDE-THE-LEARNING-DIRECTORY', 'utf8');
  s.outsideFile = file;
  return file;
}

async function expectRefused(world: LearningWorld, path: string): Promise<void> {
  const s = st(world);
  const fs = s.fs;
  assert.ok(fs && s.mod, '先要有「the window reads a card file」建好的 webview LearningFs');
  const before = s.invokes.length;
  let got: unknown;
  let value: string | undefined;
  try {
    value = await fs.read(path);
  } catch (err) {
    got = err;
  }
  assert.equal(value, undefined, `路徑 ${JSON.stringify(path)} 不該讀得到東西(讀到了:${JSON.stringify(value)?.slice(0, 80)})`);
  assert.ok(got instanceof s.mod.PathRefusedError, `路徑 ${JSON.stringify(path)} 應該被拒絕,而且拒絕要回到 TypeScript 這邊(PathRefusedError);實際丟的是 ${String(got)}`);
  assert.equal(s.invokes.length, before + 1, `${JSON.stringify(path)} 應該真的走了 read command`);
  assert.equal(s.invokes[before]!.cmd, 'read');
  assert.equal(s.invokes[before]!.refused, true, `${JSON.stringify(path)}:command(Rust)必須自己拒絕,不是 TS 先擋掉`);
}

Then('the command rejects any path containing {string}', async function (this: LearningWorld, dots: string) {
  assert.equal(dots, '..');
  for (const path of ['..', '../outside-secret.txt', 'cards/../state/log.jsonl', 'cards/security/../../outside-secret.txt', 'a/../../b']) {
    await expectRefused(this, path);
  }
});

Then('the command rejects any path outside the learning directory', async function (this: LearningWorld) {
  const outside = outsideSentinel(this);
  // 絕對路徑(指到 learning 外面的哨兵檔與系統檔)
  for (const path of [outside, '/etc/passwd']) await expectRefused(this, path);
  // 指出去的符號連結:連結本身在 learning 目錄裡,目標在外面
  const link = join(dirOf(this), 'cards/security/escape-link.md');
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(outside, link);
  await expectRefused(this, 'cards/security/escape-link.md');
});

// ---------------------------------------------------------------- 場景:答案馬上寫進去

/** 「the person has answered one question」的 I3 版(test-card-phase2.steps.ts 分派過來):真側車、答一題、拿到 submit 的回應為止 */
export async function i3AnsweredOneQuestion(world: LearningWorld): Promise<void> {
  const s = st(world);
  const session = await openWindow(world);
  await session.init();
  s.answeredCard = session.getView().current!.card;
  await answerCurrent(session); // 回來就是側車已經回了 submit 的回應
}

When('the application is killed without a clean exit', { timeout: 60_000 }, async function (this: LearningWorld) {
  // 不叫 summary、不關 stdin:對側車行程直接送 SIGKILL
  const proc = st(this).sidecar;
  if (!proc) throw new Error('側車還沒起來');
  assert.ok(proc.isAlive(), '側車應該還活著(殺它之前)');
  proc.kill();
  const exit = await proc.exited(15_000);
  assert.notEqual(exit, 'timeout', '側車沒有在 15 秒內被殺掉');
  assert.notEqual(exit, 0, `被 SIGKILL 殺掉的行程不該是乾淨結束(退出碼 ${String(exit)})`);
});

Then('that answer is present in {string}', function (this: LearningWorld, file: string) {
  assert.equal(file, 'state/reviews.json');
  const s = st(this);
  const record = readReviews(vaultOf(this))[s.answeredCard!];
  assert.ok(record, `${s.answeredCard} 不在 reviews.json`);
  assert.equal(record!.history.length, 1, '那一題的答案應該已經在磁碟上(殺掉側車之前就寫了)');
  assert.equal(record!.history[0]!.date, this.today);
});

// ---------------------------------------------------------------- 場景:視窗與終端機看到同一個狀態

Given('the person answers two questions in the window', { timeout: 300_000 }, async function (this: LearningWorld) {
  const s = st(this);
  // 完整名單先從終端機拿(視窗還沒碰任何東西);之後視窗才答
  s.expected = (await terminalCards(this)).cards;
  assert.equal(s.expected.length, 5, `一開始應該有 5 張到期的卡:${JSON.stringify(s.expected)}`);
  const session = await openWindow(this);
  await session.init();
  for (let i = 0; i < 2; i += 1) {
    await answerCurrent(session);
    await session.next();
  }
});

When('the person runs the review command in the terminal', { timeout: 120_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const terminal = await terminalCards(this);
  s.terminalList = terminal.cards;
  s.terminalOut = terminal.output;
});

Then('it shows the remaining three questions', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(s.terminalList, s.expected.slice(2), '終端機應該只列視窗還沒答的三張,順序不變');
  // 視窗答過的題由側車寫進當日快取(同一個帳本身分),終端機讀得到:印出「已答 2 / 共 5」
  assert.match(s.terminalOut, /已答 2 \/ 共 5/, `終端機應該讀到視窗留下的當日快取(已答 2 / 共 5):\n${s.terminalOut}`);
});
