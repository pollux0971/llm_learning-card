/**
 * 07-teach-card / phase-3「深入這個」的步驟定義(工單 T43 驗收 1)。測試 agent 寫;開發 worker 不改。
 * 場景原文在 features/07-teach-card/phase-3.feature(不改)。`@manual` 兩條(生成中的畫面、回上一層)不在這裡,由前端量、有 vitest。
 *
 * 接真的零件:真的側車子行程(`spawnSidecar`)+ 真的 `createReviewClient` + 視窗邏輯 `createTeachSession`(注入 `pause`)。
 * 網路層是假的(`features/steps/_fake-deepen-cloud.mjs`,換掉 fetch):真 router / adapter / 帳本照跑,不打真網路、不 live。
 * 「看磁碟,不看畫面」:Then 讀 `cards/` `questions/` `graph/` `state/reviews.json` 的雜湊與 `state/log.jsonl`;
 * 打了幾次模型看假網路的請求紀錄(也塞進 world.llmCalls,所以共用的「no model call is made」照用)。
 *
 * 共用步驟:「the person presses next」(teach-card.steps.ts)與「no file is written」(review-cli.steps.ts)在 phase-3 的 world 裡改派到這裡
 * (`phase3Active` / `phase3PressNext` / `phase3NoFileWritten`)。Background「the displayed card is at level 1」把 world 標成 phase-3。
 *
 * 佈置是「延後」的:Given 只記下要什麼(有沒有子卡、離線、超字…),第一個 When 才建暫存根、起側車、開視窗(`ensureWindow`),
 * 因為 Background 先於「已經有兩張子卡」這類 Given。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { LearningWorld } from './_world.js';
import { createReviewClient } from '../../apps/desktop/src/webview/review-client.js';
import { ERROR_MESSAGES } from '../../packages/core/src/session/protocol.js';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { validateQuestionFile } from '../../packages/core/src/schema/validate-question.js';
import { spawnSidecar, type Sidecar } from '../support/review-sidecar-harness.js';
import {
  PARENT,
  PARENT_TITLE,
  AFTER_PARENT,
  cardFiles,
  createDeepenVault,
  diskHashes,
  logEvents,
  newIds,
  readCardText,
  readDeps,
  readReviews,
  removeVault,
  type DeepenVaultOpts,
  type Vault,
} from '../support/t43-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const SESSION_URL = pathToFileURL(join(ROOT, 'apps/teach-card/src/teach-session.ts')).href;
const FAKE = join(import.meta.dirname, '_fake-deepen-cloud.mjs');
const BASE = ['sec-0001', 'sec-0002', 'sec-0003'];

interface ViewState {
  state: string;
  card: { id: string; path: string; title: string } | undefined;
  cardText: string | undefined;
  from: { id: string; title: string } | undefined;
  canBack: boolean;
  generating: boolean;
  deepenError: string | undefined;
}
interface TeachSession {
  view(): ViewState;
  open(): Promise<void>;
  next(): Promise<void>;
  deepen(): Promise<void>;
  cancel(): Promise<void>;
}

interface Phase3State {
  started: boolean;
  opts: DeepenVaultOpts;
  env: Record<string, string | undefined>;
  /** 開窗後先走到哪裡:'child' = 深入到第一張子卡;'floor' = 一路深入到 level 4 */
  goto: 'parent' | 'child' | 'floor';
  vault: Vault | undefined;
  sidecar: Sidecar | undefined;
  session: TeachSession | undefined;
  ctrl: string | undefined;
  reqLog: string | undefined;
  before: Record<string, string>;
  logBefore: string;
  cancelledDuring: boolean;
}

const states = new WeakMap<LearningWorld, Phase3State>();
function st(world: LearningWorld): Phase3State {
  const s = states.get(world);
  assert.ok(s, '還沒有 phase-3 的世界(Background 的「the displayed card is at level 1」要先跑)');
  return s;
}

export function phase3Active(world: LearningWorld): boolean {
  return states.get(world)?.started === true;
}

const nap = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function requests(s: Phase3State): { via: string; kind: string; card?: string; title?: string }[] {
  if (!s.reqLog || !existsSync(s.reqLog)) return [];
  return readFileSync(s.reqLog, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { via: string; kind: string; card?: string; title?: string });
}

function syncLlmCalls(world: LearningWorld): void {
  const s = st(world);
  world.llmCalls = requests(s).map((q) => ({ task: q.kind, prompt: JSON.stringify(q) }));
}

async function until(pred: () => boolean, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`等不到:${what}`);
    await nap(25);
  }
}

/** 第一個 When 才建世界:暫存根、側車、視窗。 */
async function ensureWindow(world: LearningWorld): Promise<TeachSession> {
  const s = st(world);
  if (s.session) return s.session;
  const vault = createDeepenVault(s.opts);
  s.vault = vault;
  s.ctrl = join(vault.scratch, 'ctrl');
  mkdirSync(s.ctrl, { recursive: true });
  s.reqLog = join(vault.scratch, 'requests.log');
  writeFileSync(s.reqLog, '', 'utf8');
  const proc = spawnSidecar(vault, {
    today: world.today,
    fakeCloud: FAKE,
    env: { GATEWAY_API_KEY: 'fake-gateway-key', GATEWAY_BASE_URL: 'https://gateway.invalid', FAKE_DEEPEN_REQUEST_LOG: s.reqLog, FAKE_DEEPEN_CTRL: s.ctrl, ...s.env },
  });
  s.sidecar = proc;
  const hello = await proc.nextLine(60_000);
  assert.ok(hello, `側車沒有在 60 秒內送出 hello(stderr:${proc.stderr().slice(-400)})`);
  const client = createReviewClient({
    handler: async (line: string) => {
      proc.writeRaw(`${line}\n`);
      const reply = await proc.nextLine(120_000);
      if (reply === undefined) throw new Error(`側車沒有回應(stderr:${proc.stderr().slice(-400)})`);
      return reply;
    },
  });
  const mod = (await import(/* @vite-ignore */ SESSION_URL)) as { createTeachSession(deps: Record<string, unknown>): TeachSession };
  const store = new Map<string, string>();
  const session = mod.createTeachSession({
    client,
    fs: { read: async (rel: string): Promise<string> => readFileSync(join(vault.dir, rel), 'utf8') },
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    pause: (ms: number) => nap(Math.min(ms, 40)),
  });
  s.session = session;
  await session.open();
  assert.equal(session.view().card?.id, PARENT, '背景:目前顯示的那張是 level 1 的 sec-0002');
  if (s.goto === 'child') {
    await session.deepen();
    assert.equal(session.view().card?.id, 'sec-0004', '先深入到第一張子卡');
  } else if (s.goto === 'floor') {
    await session.deepen();
    await session.deepen();
    await session.deepen();
    assert.equal(session.view().card?.id, 'sec-0006', 'level 4 那張');
  }
  s.before = diskHashes(vault);
  s.logBefore = existsSync(join(vault.dir, 'state/log.jsonl')) ? readFileSync(join(vault.dir, 'state/log.jsonl'), 'utf8') : '';
  return session;
}

async function waitDeepenDone(world: LearningWorld): Promise<void> {
  const s = st(world);
  // session.deepen() 已經輪詢到結果才回來;這裡再等一下,讓可能的背景尾巴(舊呼叫)落地
  await nap(150);
  syncLlmCalls(world);
  void s;
}

After({ tags: '@teach-card and @phase-3' }, function (this: LearningWorld) {
  const s = states.get(this);
  if (!s) return;
  s.sidecar?.kill();
  if (s.ctrl) rmSync(join(s.ctrl, 'hold-children'), { force: true });
  if (s.vault) removeVault(s.vault);
});

// ---------------------------------------------------------------- Background 與 Given(只記下要什麼)

Given('the displayed card is at level 1', function (this: LearningWorld) {
  states.set(this, { started: true, opts: {}, env: {}, goto: 'parent', vault: undefined, sidecar: undefined, session: undefined, ctrl: undefined, reqLog: undefined, before: {}, logBefore: '', cancelledDuring: false });
});

Given('the card already has two children', function (this: LearningWorld) {
  st(this).opts.children = 2;
});

Given('the card has no children', function (this: LearningWorld) {
  assert.equal(st(this).opts.children ?? 0, 0);
});

Given('the network is unavailable and a local model is running', function (this: LearningWorld) {
  st(this).env['FAKE_DEEPEN_OFFLINE'] = '1';
});

Given('the network is unavailable and no local model is running', function (this: LearningWorld) {
  const s = st(this);
  s.env['FAKE_DEEPEN_OFFLINE'] = '1';
  s.env['FAKE_DEEPEN_GATEWAY_DOWN'] = '1';
});

Given('the model returns an overlong body', function (this: LearningWorld) {
  st(this).env['FAKE_DEEPEN_LONG_TITLE'] = '新卡2';
});

Given('the displayed card is one of two children of the same parent', function (this: LearningWorld) {
  const s = st(this);
  s.opts.children = 2;
  s.goto = 'child';
});

Given('the displayed card is at the deepest allowed level', function (this: LearningWorld) {
  const s = st(this);
  s.opts = { chain: true };
  s.goto = 'floor';
});

// ---------------------------------------------------------------- When

When('the person presses deepen', { timeout: 180_000 }, async function (this: LearningWorld) {
  const session = await ensureWindow(this);
  await session.deepen();
  await waitDeepenDone(this);
});

When('generation runs', { timeout: 180_000 }, async function (this: LearningWorld) {
  const session = await ensureWindow(this);
  await session.deepen();
  await waitDeepenDone(this);
});

When('the person cancels during generation', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const session = await ensureWindow(this);
  assert.ok(s.ctrl);
  appendFileSync(join(s.ctrl, 'hold-children'), '', 'utf8');
  const running = session.deepen();
  await until(() => requests(s).length >= 1, '子卡的請求到達假網路');
  assert.equal(session.view().generating, true, '生成中');
  await session.cancel();
  await running;
  s.cancelledDuring = true;
  // 放行那一個被攔住的呼叫,等它回來、記完帳
  rmSync(join(s.ctrl, 'hold-children'), { force: true });
  await until(() => logEvents(s.vault!, 'llm_call').length >= 1, '被攔住的那個呼叫回來並記帳');
  await nap(500);
  syncLlmCalls(this);
});

export async function phase3PressNext(world: LearningWorld): Promise<void> {
  const session = await ensureWindow(world);
  await session.next();
  syncLlmCalls(world);
}

export function phase3NoFileWritten(world: LearningWorld): void {
  const s = st(world);
  assert.deepEqual(diskHashes(s.vault!), s.before, '取消之後 cards/ questions/ graph/ state/reviews.json 一個位元組都不能變');
  assert.equal(logEvents(s.vault!, 'deepened').length, 0, '不能記 deepened');
}

// ---------------------------------------------------------------- Then:已有子卡

Then('the first child is shown', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.card?.id, 'sec-0004', '子卡照 id 排,第一張是 sec-0004');
  assert.equal(view.state, 'card');
  assert.equal(view.generating, false);
});

Then('the header notes which card it came from', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.deepEqual(view.from, { id: PARENT, title: PARENT_TITLE }, '標示列要有「來自」的父卡');
  assert.equal(view.canBack, true);
});

// ---------------------------------------------------------------- Then:生成

Then('between one and three cards are created one level deeper', function (this: LearningWorld) {
  const s = st(this);
  const created = cardFiles(s.vault!).filter((id) => !BASE.includes(id));
  assert.ok(created.length >= 1 && created.length <= 3, `新卡張數 ${created.length} 不在 1 到 3`);
  for (const id of created) {
    const fm = parseCardText(readCardText(s.vault!, id)).frontmatter as Record<string, unknown>;
    assert.equal(fm['level'], 2, `${id} 的 level 要是父卡(1)加 1`);
  }
  for (const q of requests(s)) assert.notEqual(q.kind, 'other');
  const calls = logEvents(s.vault!, 'llm_call');
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.equal(c['task'], 'deepen', '一次深入裡每一筆 llm_call 的 task 都是 deepen');
});

Then('each names this card as its parent', function (this: LearningWorld) {
  const s = st(this);
  for (const id of cardFiles(s.vault!).filter((x) => !BASE.includes(x))) {
    const fm = parseCardText(readCardText(s.vault!, id)).frontmatter as Record<string, unknown>;
    assert.equal(fm['parent'], PARENT, `${id} 的 parent`);
    assert.deepEqual(fm['prereqs'], [PARENT], `${id} 的 prereqs`);
  }
});

Then('each has source generated and is not provisional', function (this: LearningWorld) {
  const s = st(this);
  for (const id of cardFiles(s.vault!).filter((x) => !BASE.includes(x))) {
    const fm = parseCardText(readCardText(s.vault!, id)).frontmatter as Record<string, unknown>;
    assert.equal(fm['source'], 'llm', `${id} 的 source`);
    assert.equal(fm['provisional'], false, `${id} 的 provisional`);
  }
});

Then('each gets a question file', function (this: LearningWorld) {
  const s = st(this);
  for (const id of cardFiles(s.vault!).filter((x) => !BASE.includes(x))) {
    const path = join(s.vault!.dir, 'questions', `${id}.yaml`);
    assert.ok(existsSync(path), `${id} 要有考題檔`);
    const file = parseYaml(readFileSync(path, 'utf8')) as unknown;
    assert.equal(validateQuestionFile(file).ok, true, `${id} 的考題檔要過 validateQuestionFile`);
  }
});

Then('an edge is added to the graph for each', function (this: LearningWorld) {
  const s = st(this);
  const created = cardFiles(s.vault!).filter((x) => !BASE.includes(x));
  const graph = readDeps(s.vault!)['security']!;
  for (const id of created) {
    assert.ok(graph.nodes.includes(id), `${id} 要在圖的節點裡`);
    assert.ok(graph.edges.some(([a, b]) => a === PARENT && b === id), `圖要有 [${PARENT}, ${id}] 這條邊`);
  }
});

Then('the first one is shown', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.card?.id, newIds(1)[0], '畫面是第一張新卡');
  assert.equal(view.state, 'card');
});

// ---------------------------------------------------------------- Then:離線與沒有模型

Then('the local model is used', function (this: LearningWorld) {
  const s = st(this);
  const calls = logEvents(s.vault!, 'llm_call');
  assert.ok(calls.length >= 1, '帳本要有 llm_call');
  assert.ok(calls.some((c) => c['provider'] === 'ollama'), 'provider 是 ollama(本機閘道)');
  for (const q of requests(s)) assert.equal(q.via, 'gateway', '離線時所有請求都走閘道');
  for (const c of calls) assert.equal(c['task'], 'deepen');
});

Then('each new card is marked provisional', function (this: LearningWorld) {
  const s = st(this);
  const created = cardFiles(s.vault!).filter((x) => !BASE.includes(x));
  assert.ok(created.length >= 1);
  for (const id of created) {
    assert.equal((parseCardText(readCardText(s.vault!, id)).frontmatter as Record<string, unknown>)['provisional'], true, `${id} 要標 provisional`);
    assert.ok(existsSync(join(s.vault!.dir, 'questions', `${id}.yaml`)), `${id} 的考題檔也出得來`);
  }
});

Then('the marker is visible in the interface', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.ok(view.cardText, '畫面上有卡片原文');
  const fm = parseCardText(view.cardText!).frontmatter as Record<string, unknown>;
  assert.equal(fm['provisional'], true, '畫面顯示的那張卡帶 provisional(「待審核」徽章由 App.svelte 依此顯示,vitest 量)');
});

Then('it says nothing can be generated right now', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.deepenError, ERROR_MESSAGES['no-model']);
  assert.equal(view.deepenError, '現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。');
  const s = st(this);
  assert.deepEqual(diskHashes(s.vault!), s.before, '沒有模型時磁碟不能變');
});

Then('the current card stays on screen', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.state, 'card', '不進出錯畫面');
  assert.equal(view.card?.id, PARENT);
  assert.equal(view.generating, false);
});

// ---------------------------------------------------------------- Then:取消

Then('the request is aborted', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.cancelledDuring, '要先取消');
  const reqs = requests(s);
  assert.equal(reqs.length, 1, '取消之後不再發新的請求(假網路剛好 1 行:考題一個都沒出)');
  const calls = logEvents(s.vault!, 'llm_call');
  assert.equal(calls.length, 1, '已經送出的那一個呼叫不中斷,照常記帳(ADR-050,帳只能多不能少)');
  assert.equal(calls[0]!['task'], 'deepen');
  assert.equal(logEvents(s.vault!, 'deepened').length, 0, '不能記 deepened');
});

Then('the current card is still shown', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.card?.id, PARENT);
  assert.equal(view.generating, false);
  assert.equal(view.canBack, false);
});

// ---------------------------------------------------------------- Then:字數

Then('it is retried in the same way as ingest', function (this: LearningWorld) {
  const s = st(this);
  const regen = requests(s).filter((q) => q.kind === 'regenerate');
  assert.equal(regen.length, 2, '超字那張重寫剛好 2 次(初稿 + 2 次重寫 = 3 次嘗試,跟 ingest 的 MAX_ATTEMPTS 一樣)');
  for (const c of logEvents(s.vault!, 'llm_call')) assert.equal(c['task'], 'deepen', '重寫也是 task deepen');
});

Then('a card that fails three times is skipped while the others are kept', function (this: LearningWorld) {
  const s = st(this);
  const created = cardFiles(s.vault!).filter((x) => !BASE.includes(x));
  assert.equal(created.length, 1, '超字的那張略過,另一張留下');
  const fm = parseCardText(readCardText(s.vault!, created[0]!)).frontmatter as Record<string, unknown>;
  assert.equal(fm['title'], '新卡1');
  assert.equal(logEvents(s.vault!, 'deepened')[0]?.['skipped'], 1);
});

// ---------------------------------------------------------------- Then:一組子卡裡的下一個

Then('the current child is marked learned', function (this: LearningWorld) {
  const s = st(this);
  assert.ok('sec-0004' in readReviews(s.vault!), '第一張子卡進了 reviews.json');
  assert.deepEqual(
    logEvents(s.vault!, 'learned').map((e) => e['card']),
    ['sec-0004'],
  );
});

Then('the sibling is shown', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.card?.id, 'sec-0005', '換到下一張兄弟');
  assert.equal(view.from?.id, PARENT);
});

Then('after the last sibling the next card after the parent is shown', async function (this: LearningWorld) {
  const s = st(this);
  await s.session!.next();
  const reviews = readReviews(s.vault!);
  for (const id of ['sec-0004', 'sec-0005', PARENT]) assert.ok(id in reviews, `${id} 要在 reviews.json`);
  assert.equal(s.session!.view().card?.id, AFTER_PARENT, '最後一張子卡之後,顯示的是主流程裡父卡之後那張');
  assert.equal(s.session!.view().from, undefined);
});

// ---------------------------------------------------------------- Then:最深一層

Then('it says this is as deep as it goes', function (this: LearningWorld) {
  const view = st(this).session!.view();
  assert.equal(view.deepenError, '這張已經是最深的一層了。');
  assert.equal(view.state, 'card');
  assert.equal(view.card?.id, 'sec-0006');
  const s = st(this);
  assert.deepEqual(diskHashes(s.vault!), s.before, '磁碟不能變');
});
