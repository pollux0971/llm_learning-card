/**
 * 06-test-card / phase-2:T22 加的四個場景的步驟(顧問裁決:紅測試作者補,另開 commit)。
 * 這四個測的是已合併的 T22,基底上就是綠;每個都用「丟棄式改壞 T22 程式」證明會轉紅(見 commit 說明)。
 *
 * 能用 Node 的用 Node:直接起 `scripts/review-sidecar.ts` 走 stdio(features/support/review-sidecar-harness.ts),
 * 訊息形狀用 `packages/core/src/session/protocol.ts`,視窗端用 `ReviewClient`。
 * Rust 那一側不寫新邏輯:包一層去叫既有的 cargo 測試(`cargo test --test review_sidecar <名字> --exact`,CARGO_BUILD_JOBS=2)。
 * 「The helper does not outlive the application」是 @manual,不在這裡。
 */
import { After, Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { createReviewClient, ReviewError } from '../../apps/desktop/src/webview/review-client.js';
import {
  ERROR_KINDS,
  REQUEST_METHODS,
  classifyRequestLine,
  parseHelloLine,
  parseResponseLine,
} from '../../packages/core/src/session/protocol.js';
import { request, spawnSidecar, type Sidecar } from '../support/review-sidecar-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const TAURI = join(ROOT, 'apps/desktop/src-tauri');
const VECTORS = join(ROOT, 'packages/core/src/session/protocol.vectors.json');

interface Bag {
  proc?: Sidecar;
  replies: Record<string, unknown>[];
  hello?: Record<string, unknown>;
  cargo?: { status: number | null; output: string; names: string[] };
  tsMismatches: string[];
}
const bags = new WeakMap<LearningWorld, Bag>();
function bag(world: LearningWorld): Bag {
  let b = bags.get(world);
  if (!b) {
    b = { replies: [], tsMismatches: [] };
    bags.set(world, b);
  }
  return b;
}
function vault(world: LearningWorld) {
  const rig = world.testCardP2?.rig;
  if (!rig) throw new Error('尚未執行 Background');
  return rig.vault;
}

After({ tags: '@test-card and @phase-2' }, function (this: LearningWorld) {
  const b = bags.get(this);
  if (b?.proc?.isAlive()) b.proc.kill();
});

/** 跑既有的 Rust 測試(一個或多個名字,逐字比對),全部要過。 */
function runCargo(names: string[]): { status: number | null; output: string; names: string[] } {
  const r = spawnSync('cargo', ['test', '--test', 'review_sidecar', '--', '--exact', ...names], {
    cwd: TAURI,
    encoding: 'utf8',
    timeout: 1_500_000,
    env: { ...process.env, CARGO_BUILD_JOBS: '2' },
  });
  return { status: r.error ? null : r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, names };
}
function assertCargoPassed(c: { status: number | null; output: string; names: string[] }): void {
  assert.equal(c.status, 0, `cargo 測試沒過:\n${c.output.slice(-2000)}`);
  for (const name of c.names) assert.match(c.output, new RegExp(`test ${name} \\.\\.\\. ok`), `${name} 沒有跑到或沒過:\n${c.output.slice(-1500)}`);
}

// ---------------------------------------------------------------- 場景:側車只收複習動作

When('the window sends the review helper an action other than start, next, submit, summary or status', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  b.proc = spawnSidecar(vault(this));
  b.hello = parseHelloLine((await b.proc.nextLine(60_000)) ?? '') as never;
  const others = ['stop', 'read', 'write', 'exec', 'list', 'quit', 'START', 'start ', 'review', ''];
  assert.ok(others.every((m) => !(REQUEST_METHODS as readonly string[]).includes(m)));
  let id = 1;
  for (const method of others) b.replies.push(await request(b.proc, id++, method, {}));
});

Then('the action is refused', { timeout: 180_000 }, function (this: LearningWorld) {
  const b = bag(this);
  assert.ok(b.replies.length > 0);
  for (const r of b.replies) {
    assert.equal(r.ok, false, `不認得的動作不該成功:${JSON.stringify(r)}`);
    const kind = (r.error as { kind?: string } | undefined)?.kind;
    assert.ok(kind === 'unknown-method' || kind === 'bad-request', `錯誤種類是 ${kind}`);
    assert.ok((ERROR_KINDS as readonly string[]).includes(kind!), `${kind} 不在固定清單`);
  }
});

Then('the helper keeps running', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  assert.ok(b.proc!.isAlive(), '側車不該因為被拒絕的動作結束');
  const status = await request(b.proc!, 1000, 'status', {});
  assert.equal(status.ok, true, `之後的 status 該照常回:${JSON.stringify(status)}`);
});

Then('no action the window can send carries a path or a card id', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  // 九個動作(T37 加四個)的參數都是封閉的:帶 path / card / file 之類的欄位一律被拒絕,側車照常活著
  const attempts: [string, Record<string, unknown>][] = [
    ['start', { path: '/etc/passwd' }],
    ['start', { dir: '/tmp' }],
    ['next', { card: 'sec-0001' }],
    ['submit', { fill: ['a'], card: 'sec-0001' }],
    ['submit', { apply: 'x', path: 'cards/security/sec-0001.md' }],
    ['summary', { card: 'sec-0001' }],
    ['status', { path: '../x' }],
    // T37(ADR-077):四個教學卡動作的參數也是封閉的,只收類別 id 與先備序號,不收路徑、不收卡 id
    ['teach.open', { path: 'cards/security/sec-0001.md' }],
    ['teach.next', { card: 'sec-0001' }],
    ['teach.switch', { category: 'language', path: 'cards/language' }],
    ['teach.prereq', { index: 0, card: 'sec-0001' }],
  ];
  let id = 2000;
  for (const [method, params] of attempts) {
    const r = await request(b.proc!, id++, method, params);
    assert.equal(r.ok, false, `${method} 帶 ${JSON.stringify(params)} 不該被接受:${JSON.stringify(r)}`);
    assert.equal((r.error as { kind?: string }).kind, 'bad-request', `${method}:${JSON.stringify(r)}`);
  }
  assert.ok(b.proc!.isAlive());
  // 視窗端的 ReviewClient 本身也沒有任何能帶 path 或 card 的方法(T40:多了 onWait,它收一個聽眾函式,不是 path 或 card)
  const client = createReviewClient({ handler: async () => '' }) as unknown as Record<string, { length: number }>;
  assert.deepEqual(Object.keys(client).sort(), ['next', 'onWait', 'start', 'status', 'submit', 'summary', 'teachNext', 'teachOpen', 'teachPrereq', 'teachSwitch']);
  for (const name of ['start', 'next', 'summary', 'status', 'teachNext']) assert.equal(client[name]!.length, 0, `${name} 不收參數`);
});

// ---------------------------------------------------------------- 場景:兩邊的訊息形狀一樣

interface VEntry {
  name: string;
  line?: string;
  parts?: (string | { cp: number } | { repeat: string; times: number })[];
  ts: { ok: boolean; kind?: string };
  rust?: string;
}
function lineOf(e: VEntry): string {
  if (e.line !== undefined) return e.line;
  return (e.parts ?? []).map((p) => (typeof p === 'string' ? p : 'cp' in p ? String.fromCodePoint(p.cp) : p.repeat.repeat(p.times))).join('');
}

When('the shared message vectors are read by the window side and by the desktop shell', { timeout: 180_000 }, function (this: LearningWorld) {
  const b = bag(this);
  const v = JSON.parse(readFileSync(VECTORS, 'utf8')) as { requests: VEntry[]; responses: VEntry[]; hello: VEntry[] };
  // 視窗側(TS):每一列照 ts 欄判
  for (const e of v.requests) {
    const got = classifyRequestLine(lineOf(e));
    if (got.ok !== e.ts.ok) b.tsMismatches.push(`請求「${e.name}」ts 期待 ok=${e.ts.ok},實際 ${got.ok}`);
    else if (!got.ok && e.ts.kind !== undefined && got.kind !== e.ts.kind) b.tsMismatches.push(`請求「${e.name}」kind 期待 ${e.ts.kind},實際 ${got.kind}`);
  }
  for (const e of v.responses) if (parseResponseLine(lineOf(e)).ok !== e.ts.ok) b.tsMismatches.push(`回應「${e.name}」`);
  for (const e of v.hello) if (parseHelloLine(lineOf(e)).ok !== e.ts.ok) b.tsMismatches.push(`hello「${e.name}」`);
  // Rust 只看信封、不看 params 內容(向量如此),所以 Rust 接受而 TS 拒絕是設計;但 Rust 拒絕的,TS 一定也要拒絕
  for (const e of [...v.requests, ...v.responses]) {
    if (e.rust === 'reject' && e.ts.ok) b.tsMismatches.push(`「${e.name}」Rust 拒絕、TS 接受`);
  }
  // 桌面殼(Rust):既有的三個向量測試
  b.cargo = runCargo([
    'the_vector_file_is_the_one_ts_reads',
    'request_line_judges_every_request_vector_the_way_the_file_says',
    'parse_response_line_judges_every_response_vector_the_way_the_file_says',
  ]);
});

Then('both accept and refuse exactly the same lines', { timeout: 180_000 }, function (this: LearningWorld) {
  const b = bag(this);
  assert.deepEqual(b.tsMismatches, [], `視窗側判決跟向量不一致:\n${b.tsMismatches.join('\n')}`);
  assertCargoPassed(b.cargo!);
});

// ---------------------------------------------------------------- 場景:側車結束了,下一個動作換新的

Given('the review helper has exited', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  b.proc = spawnSidecar(vault(this));
  await b.proc.nextLine(60_000);
  b.proc.kill();
  assert.notEqual(await b.proc.exited(10_000), 'timeout', '側車應該被收掉了');
});

When('the window sends an action', { timeout: 180_000 }, function (this: LearningWorld) {
  // 「已結束的側車」由 Rust 的 SidecarHost 處理:既有測試涵蓋「回報結束」與「下一個動作起新的」
  bag(this).cargo = runCargo(['a_sidecar_that_exits_is_reported_and_the_next_call_starts_a_new_one']);
});

Then('the window is told the helper has exited', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  assert.ok(b.cargo, 'Rust 側的測試沒有跑');
  assertCargoPassed(b.cargo!);
  // 視窗端:command 回 sidecar-exited 時,ReviewClient 丟的是 kind 為 sidecar-exited 的 ReviewError
  const client = createReviewClient({
    invoke: async () => {
      throw { kind: 'sidecar-exited', message: '複習程式已經結束。' };
    },
  });
  await assert.rejects(client.next(), (e: unknown) => e instanceof ReviewError && e.kind === 'sidecar-exited');
});

Then('the action after that is answered by a new helper', { timeout: 180_000 }, function (this: LearningWorld) {
  // 同一個 Rust 測試的後半(下一個呼叫起新的側車並得到回答)已經在上一步確認過
  const b = bag(this);
  assert.match(b.cargo!.output, /a_sidecar_that_exits_is_reported_and_the_next_call_starts_a_new_one \.\.\. ok/);
});

// ---------------------------------------------------------------- 場景:假批改只能在啟動時打開

Given('the application was started without the fake grader variable', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  b.proc = spawnSidecar(vault(this), { fakeCloud: null });
  b.hello = parseHelloLine((await b.proc.nextLine(60_000)) ?? '') as never;
});

When('the window sends any action', { timeout: 180_000 }, async function (this: LearningWorld) {
  const b = bag(this);
  if (b.replies.length === 0 && b.proc && b.hello) {
    // 動作裡帶「想打開假批改」的欄位也沒用:只有啟動環境變數算數
    b.replies.push(await request(b.proc, 1, 'start', { fakeCloud: true, LC_REVIEW_FAKE_CLOUD: '/tmp/x.mjs' }));
    b.replies.push(await request(b.proc, 2, 'start', {}));
  }
});

Then('the grading stays real', { timeout: 180_000 }, function (this: LearningWorld) {
  const b = bag(this);
  const hello = b.hello as { ok?: boolean; value?: { fakeCloud?: boolean } };
  assert.equal(hello.ok, true);
  assert.equal(hello.value?.fakeCloud, false, 'hello 說這是假批改,但啟動時沒給變數');
  const [withField, plain] = b.replies as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(withField.ok, false, '帶額外欄位的 start 應該被當格式錯誤拒絕');
  // 真的 start:要嘛成功但 fakeCloud 是 false,要嘛因為帳本 / router 不可用而失敗;絕不是 fakeCloud true
  if (plain.ok === true) assert.equal((plain.result as { fakeCloud?: boolean }).fakeCloud, false);
  else assert.ok(['router-unavailable', 'root-mismatch'].includes((plain.error as { kind: string }).kind), JSON.stringify(plain));
});

Then('a release build drops the fake grader variable before starting the helper', { timeout: 180_000 }, function (this: LearningWorld) {
  const b = bag(this);
  b.cargo = runCargo([
    'a_release_child_gets_only_the_allowlist_and_never_the_two_test_variables',
    'a_debug_child_also_gets_the_two_test_variables_but_nothing_else_outside_the_list',
  ]);
  assertCargoPassed(b.cargo);
});
