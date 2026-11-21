/**
 * I4 整合(docs/integration/i4-two-card-system.feature)的步驟定義(工單 T66)。測試 agent 寫;產品程式與 .feature 一個字沒改。
 *
 * 整合點自己的驗收要接上**真的零件**,每條場景看磁碟(cards/、questions/、graph/、state/),不看畫面:
 *   - 「側車」= 真的子行程 `scripts/review-sidecar.ts`(跟 Rust 起的同一支),網路層換成假的(`_fake-deepen-cloud.mjs`,真 router / adapter / 帳本照跑);
 *   - 「視窗」= 教學卡的 `createTeachSession` / 考試卡的 `TestSession`,client 是真的 `createReviewClient`(一行 JSON 寫進側車的 stdin);
 *   - 「讀卡片內文」= webview 的 `createLearningFs()`,`invoke` 轉到 lc-fs probe(Rust 的 learning_fs,learning 根目錄只經指標檔);
 *   - 「order 檔」= 暫存根裡的 `graph/order-<類別>.json`,側車自己讀;
 *   - 「排程」= 側車寫的 `state/reviews.json`;隔天用真的 `scripts/review.ts --dry-run --today <隔天>` 看它到期;
 *   - 「主題生成」= 真的 `scripts/ingest.ts --topic`(經 `features/support/ingest-cli-runner.ts`,帶 `_fake-cloud.mjs`)。
 * 全部用暫存根(learning、XDG_*、HOME 同一個 mkdtemp),不碰真的 learning/,不打網路,不用 --live。
 * 世界(三個類別、order 檔、先備、子卡)的佈置與觀測在 features/support/i4-harness.ts。
 *
 * 側車與視窗**延到第一個 When 才起**:後面的 Given(已經有兩張子卡、peach 類別…)會改佈置。
 *
 * 跟別的功能撞名的三句(the network is available / the person presses deepen / each has a question file)在原本的定義裡
 * 依 `isI4(world)` 分派到這裡的函式(cucumber 不准同一句定義兩次)。
 *
 * 不在這裡量的(.feature 的 @manual 與渲染):「來源標示」本身(生成 / 原始)由 features/support/t66-source-marker-render.test.ts 量(真 Chrome);
 * 第 55 行「範例的 markdown 與圖片」引用 07 phase-1、phase-4 的自動場景與 T46、T48 的 @manual 證據;第 12 行 @e2e 要真資料、真的跨一天,
 * 「隔天考」那條的自動版是最後一個場景(它不算第 12 行的人工確認)。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { LearningWorld } from './_world.js';
import { BUILD_LC_FS_TIMEOUT_MS, buildLcFs } from '../../apps/desktop/src/test-support/build-lc-fs.js';
import { LC_FS_BIN } from '../../apps/desktop/src/test-support/probe.js';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { validateCard } from '../../packages/core/src/schema/validate-card.js';
import { validateQuestionFile } from '../../packages/core/src/schema/validate-question.js';
import { countWords } from '../../packages/core/src/schema/word-count.js';
import { applyLearnedTransition, applyPassTransition } from '../../packages/core/src/scheduler/transitions.js';
import {
  DEEPEN_PARENT,
  LANGUAGE_ORDER,
  SECURITY_ID_ORDER,
  TOMORROW,
  addChildren,
  addPeachCategory,
  createI4Vault,
  lintNumbers,
  openTeachWindow,
  openTestWindow,
  readGraphs,
  readOrder,
  seedLearned,
  terminalDueCards,
  topologicalViolations,
  type I4Window,
  type TeachSession,
  type TeachView,
  type Vault,
} from '../support/i4-harness.js';
import { cleanupTmps, mdFilesUnder, runIngestCli } from '../support/ingest-cli-runner.js';
import { ledgerEvents, readReviews, removeVault } from '../support/review-session-harness.js';
import { answerCurrent, type Session } from '../support/test-card-rig.js';
import { cardFiles, readCardText } from '../support/t43-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const I4_FEATURE = 'docs/integration/i4-two-card-system.feature';
const BASE_CARDS = SECURITY_ID_ORDER;
const SOURCES = { deepen: join(ROOT, 'packages/core/src/ingest/deepen.ts'), ingest: join(ROOT, 'packages/core/src/ingest/ingest.ts'), generate: join(ROOT, 'packages/core/src/ingest/generate-cards.ts') };

interface I4State {
  active: boolean;
  vault?: Vault;
  /** Background 量到的 lint 每一種問題各幾筆(證據檔要列) */
  lint?: Record<string, number>;
  teach?: (I4Window & { session: TeachSession }) | undefined;
  test?: I4Window & { session: Session };
  /** 佈置:深入場景(第一個 When 才套用) */
  deepen?: { children: string[]; longTitle: boolean };
  /** 一路按下一個時,依序顯示的卡、每張顯示時的先備提示、畫面上的卡內文 */
  shown: string[];
  notes: Record<string, string[]>;
  texts: Record<string, string>;
  nextPresses: number;
  nextBlocked: boolean;
  /** 換類別前顯示的那張 */
  displayedBefore?: string | undefined;
  /** 深入之前的快照 */
  logCallsBefore: number;
  /** 主題生成 */
  ingestOutput?: string;
  /** 隔天考 */
  oldRecord?: ReturnType<typeof readReviews>[string] | undefined;
  answered?: string;
  openedToday?: string;
}

const states = new WeakMap<LearningWorld, I4State>();
function st(world: LearningWorld): I4State {
  let s = states.get(world);
  if (!s) {
    s = { active: false, shown: [], notes: {}, texts: {}, nextPresses: 0, nextBlocked: false, logCallsBefore: 0 };
    states.set(world, s);
  }
  return s;
}

/** 這個場景屬於 I4 整合 feature(其他步驟檔共用的句子用它分派) */
export function isI4(world: LearningWorld): boolean {
  return states.get(world)?.active === true;
}

function vaultOf(world: LearningWorld): Vault {
  const v = st(world).vault;
  assert.ok(v, 'Background 應該先建立 learning 目錄(a learning directory with three categories)');
  return v;
}

Before(function (this: LearningWorld, { pickle }) {
  if (pickle.uri.endsWith(I4_FEATURE)) st(this).active = true;
});

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (!s?.active) return;
  s.teach?.close();
  s.test?.close();
  if (s.vault) removeVault(s.vault);
  cleanupTmps();
});

const cardPath = (vault: Vault, id: string): string => join(vault.dir, 'cards', id.startsWith('sec-') ? 'security' : id.startsWith('lang-') ? 'language' : id.startsWith('net-') ? 'network' : 'peach', `${id}.md`);

/** 側車起來、視窗開好,畫面是第一張(第一個 When 才呼叫) */
async function ensureTeach(world: LearningWorld, env: Record<string, string | undefined> = {}): Promise<I4Window & { session: TeachSession }> {
  const s = st(world);
  if (s.teach) return s.teach;
  s.teach = await openTeachWindow(vaultOf(world), { today: world.today, env });
  await s.teach.session.open();
  return s.teach;
}

function viewOf(world: LearningWorld): TeachView {
  const win = st(world).teach;
  assert.ok(win, '教學卡視窗還沒開');
  return win.session.view();
}

/** 畫面上顯示的卡內文,必須就是磁碟上那張(讀的路徑是 cards/…,經 lc-fs,Rust 沒有拒絕) */
function assertShownFromDisk(world: LearningWorld, id: string, text: string | undefined): void {
  assert.equal(text, readFileSync(cardPath(vaultOf(world), id), 'utf8'), `${id}:畫面上的內文要是磁碟上那張卡(經 lc-fs 讀回來的)`);
}

function assertReadsWentThroughLcFs(world: LearningWorld, ids: string[]): void {
  const win = st(world).teach;
  assert.ok(win);
  const reads = win.invokes.filter((i) => i.cmd === 'read');
  for (const id of ids) {
    const rel = reads.find((r) => String(r.args['relPath']).endsWith(`/${id}.md`));
    assert.ok(rel, `${id}:讀卡片內文要走 lc-fs 的 read command(叫過的:${JSON.stringify(reads.map((r) => r.args['relPath']))})`);
    assert.equal(rel.refused, false, `${id}:lc-fs 的 read 不能拒絕 cards/ 底下的路徑`);
    assert.ok(!String(rel.args['relPath']).startsWith('/'), '路徑是相對 learning 目錄的,不是絕對路徑');
  }
}

const logCalls = (vault: Vault): Record<string, unknown>[] => ledgerEvents(vault).filter((e) => e['type'] === 'llm_call');

// ---------------------------------------------------------------- Background

Given('the desktop application is running', { timeout: BUILD_LC_FS_TIMEOUT_MS + 30_000 }, function () {
  assert.equal(process.platform, 'linux', `整合點 I4 在 Linux 上驗收(process.platform = ${process.platform})`);
  const finished = buildLcFs();
  assert.ok(existsSync(LC_FS_BIN), `lc-fs 編完了卻沒有 ${LC_FS_BIN}:${finished}`);
});

Given('a learning directory with three categories', function (this: LearningWorld) {
  const s = st(this);
  const vault = createI4Vault();
  s.vault = vault;
  this.dir = vault.dir;
  const categories = parseYaml(readFileSync(join(vault.dir, 'config/categories.yaml'), 'utf8')) as { id: string }[];
  assert.deepEqual(
    categories.map((c) => c.id),
    ['security', 'language', 'network'],
    '設定檔三個類別',
  );
  // 佈置要過真的 lint(D1 的條件):先備與圖對得上、先備都存在、沒有環。其他種也量,證據檔照實列出。
  const numbers = lintNumbers(vault);
  s.lint = numbers;
  for (const kind of ['prereq_mismatch', 'missing_prereq', 'cycle'] as const) assert.equal(numbers[kind], 0, `真的 lint 的 ${kind} 要是 0:${JSON.stringify(numbers)}`);
});

Given('{string} exists', function (this: LearningWorld, rel: string) {
  assert.ok(existsSync(join(vaultOf(this).dir, rel)), `${rel} 不在暫存根裡`);
});

// ---------------------------------------------------------------- 場景:教學順序照依賴圖

Given('{string} is a topological order of the graph', function (this: LearningWorld, rel: string) {
  assert.equal(rel, 'graph/order-security.json');
  const vault = vaultOf(this);
  const order = readOrder(vault, 'security');
  const graphs = readGraphs(vault);
  // 只看兩端都在 order 檔裡的邊:跨類別那條([lang-0001 → sec-0002],起點是別類別的卡)起點不在這個類別的 order 檔裡,不算(D1)。
  assert.deepEqual(topologicalViolations(order, graphs), [], 'order 檔要是圖的拓樸順序(每條邊的起點排在終點前面)');
  assert.deepEqual([...order].sort(), [...graphs['security']!.nodes].sort(), 'order 檔列的就是這個類別圖的所有節點');
  // 跟 id 順序不同:不然照 id 排也會過
  assert.notDeepEqual(order, [...order].sort(), 'order 檔順序不能剛好等於 id 順序(不然「照 id 排」也會通過)');
});

When('the person presses next repeatedly', { timeout: 300_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const win = await ensureTeach(this);
  for (let i = 0; i < 10; i += 1) {
    const view = win.session.view();
    if (view.state !== 'card' || !view.card) break;
    const id = view.card.id;
    s.shown.push(id);
    s.notes[id] = view.prereqs.map((p) => p.id);
    s.texts[id] = view.cardText ?? '';
    await win.session.next();
    s.nextPresses += 1;
    const after = win.session.view();
    if (after.state === 'card' && after.card?.id === id) {
      s.nextBlocked = true;
      break;
    }
  }
});

Then('cards are shown in that order', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(s.shown, readOrder(vaultOf(this), 'security'), '依序出現的卡就是 order 檔的順序');
  for (const id of s.shown) assertShownFromDisk(this, id, s.texts[id]);
  assertReadsWentThroughLcFs(this, s.shown);
});

Then('a card whose prereqs are unlearned shows a prerequisite note', function (this: LearningWorld) {
  const s = st(this);
  const withNote = Object.entries(s.notes).filter(([, ids]) => ids.length > 0);
  assert.ok(withNote.length >= 1, `路上至少要有一張卡畫面上列出沒學的先備:${JSON.stringify(s.notes)}`);
  // 提示是從卡片的 prereqs 與「還沒學」算出來的:sec-0002 的先備是 sec-0001(已學)與 lang-0001(別的類別,沒學)
  assert.deepEqual(s.notes['sec-0002'], ['lang-0001'], '提示只列沒學的先備,而且看得到別的類別的卡');
  for (const [id] of withNote) assert.ok((parseCardText(readFileSync(cardPath(vaultOf(this), id), 'utf8')).frontmatter as Record<string, unknown>)['prereqs'], `${id} 的 prereqs 欄位有值`);
});

Then('pressing next is not blocked', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.nextBlocked, false, '有沒學的先備時,按下一個照樣前進');
  assert.equal(s.nextPresses, 3, '三張卡按了三次');
  assert.equal(viewOf(this).state, 'finished', '類別學完');
  const reviews = readReviews(vaultOf(this));
  assert.deepEqual(Object.keys(reviews).sort(), [...SECURITY_ID_ORDER].sort(), '三張都記成學過(有先備提示的那張也是)');
  for (const id of s.shown) assert.deepEqual(reviews[id], applyLearnedTransition({ card: id, learnedAt: this.today }), `${id}:紀錄是排程的學過轉移`);
});

// ---------------------------------------------------------------- 場景:換類別也記成學過

When('the person switches from security to language', { timeout: 300_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const win = await ensureTeach(this);
  const view = win.session.view();
  assert.equal(view.category, 'security', '一開始是第一個類別');
  assert.equal(view.card?.id, readOrder(vaultOf(this), 'security')[0], '一開始是 order 檔的第一張');
  s.displayedBefore = view.card?.id;
  win.session.openCategories();
  await win.session.chooseCategory('language');
});

Then('the security card that was displayed is recorded as learned', async function (this: LearningWorld) {
  const s = st(this);
  const vault = vaultOf(this);
  const id = s.displayedBefore!;
  const reviews = readReviews(vault);
  assert.deepEqual(Object.keys(reviews), [id], '剛好多了離開的那張,沒有別的');
  assert.deepEqual(reviews[id], applyLearnedTransition({ card: id, learnedAt: this.today }), '紀錄等於排程的學過轉移(stage 1、學過日今天、明天到期)');
  const learned = ledgerEvents(vault).filter((e) => e['type'] === 'learned');
  assert.deepEqual(
    learned.map((e) => e['card']),
    [id],
    '帳本多一行 learned',
  );
  // 隔天,真的 review.ts --dry-run 把它列在到期名單裡(排程真的認得這筆紀錄)
  const tomorrow = await terminalDueCards(vault, TOMORROW);
  assert.ok(tomorrow.cards.includes(id), `隔天的 review.ts --dry-run 沒列出 ${id}:\n${tomorrow.output}`);
  const today = await terminalDueCards(vault, this.today);
  assert.ok(!today.cards.includes(id), '今天還沒到期');
});

Then('the first unlearned language card is shown', function (this: LearningWorld) {
  const vault = vaultOf(this);
  const view = viewOf(this);
  const learned = Object.keys(readReviews(vault));
  const first = readOrder(vault, 'language').find((id) => !learned.includes(id));
  assert.equal(first, LANGUAGE_ORDER[0]);
  assert.equal(view.category, 'language');
  assert.equal(view.card?.id, first, '換過去之後,顯示的是那個類別 order 檔裡第一張沒學的');
  assertShownFromDisk(this, first!, view.cardText);
  assertReadsWentThroughLcFs(this, [first!]);
});

// ---------------------------------------------------------------- 場景:深入(新生成 / 重用 / 字數)

Given('the displayed card has no children', function (this: LearningWorld) {
  const vault = vaultOf(this);
  assert.deepEqual(cardFiles(vault), BASE_CARDS, '佈置:沒有子卡');
  st(this).deepen = { children: [], longTitle: false };
});

Given('the displayed card already has two children', function (this: LearningWorld) {
  const vault = vaultOf(this);
  st(this).deepen = { children: addChildren(vault, DEEPEN_PARENT, ['sec-0004', 'sec-0005']), longTitle: false };
});

/** 「the network is available」的 I4 版(grading.steps.ts 分派過來):假網路預設就是通的,什麼都不用設 */
export function i4NetworkAvailable(world: LearningWorld): void {
  assert.equal(st(world).teach, undefined, '網路狀態要在視窗開起來之前定');
}

/** 深入前的世界:學過第一張(order 檔第一張,level 0),所以顯示的是 level 1 的 sec-0003;開窗、記下深入前的帳 */
async function openForDeepen(world: LearningWorld, longTitle: boolean): Promise<I4Window & { session: TeachSession }> {
  const s = st(world);
  const vault = vaultOf(world);
  s.deepen ??= { children: [], longTitle };
  seedLearned(vault, ['sec-0001'], world.today);
  const win = await ensureTeach(world, longTitle ? { FAKE_DEEPEN_LONG_TITLE: '新卡2' } : {});
  const view = win.session.view();
  assert.equal(view.card?.id, DEEPEN_PARENT, '背景:顯示的是 level 1 的那張');
  assert.equal((parseCardText(readCardText(vault, DEEPEN_PARENT)).frontmatter as Record<string, unknown>)['level'], 1);
  s.logCallsBefore = logCalls(vault).length;
  return win;
}

/** 「the person presses deepen」的 I4 版(teach-card-phase3.steps.ts 分派過來) */
export async function i4PressDeepen(world: LearningWorld): Promise<void> {
  const win = await openForDeepen(world, false);
  await win.session.deepen();
}

When('a card is generated by deepen', { timeout: 300_000 }, async function (this: LearningWorld) {
  st(this).deepen = { children: [], longTitle: true };
  const win = await openForDeepen(this, true);
  await win.session.deepen();
});

const createdCards = (world: LearningWorld): string[] => cardFiles(vaultOf(world)).filter((id) => !BASE_CARDS.includes(id));

Then('between 1 and 3 cards are created with level one greater than the parent', function (this: LearningWorld) {
  const vault = vaultOf(this);
  const created = createdCards(this);
  assert.ok(created.length >= 1 && created.length <= 3, `新卡張數 ${created.length} 不在 1 到 3`);
  const parentLevel = (parseCardText(readCardText(vault, DEEPEN_PARENT)).frontmatter as Record<string, unknown>)['level'] as number;
  for (const id of created) {
    const fm = parseCardText(readCardText(vault, id)).frontmatter as Record<string, unknown>;
    assert.equal(fm['level'], parentLevel + 1, `${id} 的 level 要是父卡(${parentLevel})加 1`);
    assert.equal(fm['parent'], DEEPEN_PARENT, `${id} 的 parent`);
  }
  // 模型請求經過驗證帳本的 router:每個到達假網路的請求,帳本裡都有一筆 task 是 deepen 的 llm_call
  const requests = st(this).teach!.requests();
  const calls = logCalls(vault);
  assert.ok(calls.length >= 1, 'log.jsonl 要有 llm_call(請求要經過驗證帳本的 router)');
  for (const c of calls) assert.equal(c['task'], 'deepen', '一次深入裡每一筆 llm_call 的 task 都是 deepen');
  assert.equal(calls.length, requests.length, `假網路收到 ${requests.length} 個請求,帳本要剛好記 ${requests.length} 筆 llm_call`);
});

/** 「each has a question file」的 I4 版(ingest-phase3.steps.ts 分派過來):深入新生成的每張卡 */
export function i4EachHasQuestionFile(world: LearningWorld): void {
  const vault = vaultOf(world);
  const created = createdCards(world);
  assert.ok(created.length >= 1, '沒有新卡');
  for (const id of created) {
    const path = join(vault.dir, 'questions', `${id}.yaml`);
    assert.ok(existsSync(path), `${id} 要有考題檔`);
    assert.equal(validateQuestionFile(parseYaml(readFileSync(path, 'utf8')) as unknown).ok, true, `${id} 的考題檔要過 validateQuestionFile`);
  }
}

Then('{string} gains an edge from the parent to each new card', function (this: LearningWorld, rel: string) {
  assert.equal(rel, 'graph/deps.json');
  const graph = readGraphs(vaultOf(this))['security']!;
  const created = createdCards(this);
  assert.ok(created.length >= 1);
  for (const id of created) {
    assert.ok(graph.nodes.includes(id), `${id} 要在圖的節點裡`);
    assert.ok(graph.edges.some(([a, b]) => a === DEEPEN_PARENT && b === id), `圖要有 [${DEEPEN_PARENT}, ${id}] 這條邊`);
  }
});

Then('the first new card is displayed', function (this: LearningWorld) {
  const created = createdCards(this).sort();
  const view = viewOf(this);
  assert.equal(view.state, 'card');
  assert.equal(view.generating, false);
  assert.equal(view.card?.id, created[0], '畫面是第一張新卡');
  assertShownFromDisk(this, created[0]!, view.cardText);
});

Then('no LLM call is made', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(s.teach!.requests(), [], '假網路一個請求都不能收到');
  assert.equal(logCalls(vaultOf(this)).length, s.logCallsBefore, 'log.jsonl 不能多 llm_call');
  assert.deepEqual(createdCards(this), ['sec-0004', 'sec-0005'], '沒有多出新卡(只有佈置的那兩張)');
});

Then('the first child is displayed', function (this: LearningWorld) {
  const view = viewOf(this);
  assert.equal(view.card?.id, 'sec-0004', '子卡照 id 排,第一張是 sec-0004');
  assert.equal(view.state, 'card');
  assertShownFromDisk(this, 'sec-0004', view.cardText);
});

Then('its body does not exceed 100 words', function (this: LearningWorld) {
  const vault = vaultOf(this);
  const created = createdCards(this);
  assert.ok(created.length >= 1, '至少留下一張(超字的那張略過,另一張留下)');
  for (const id of created) {
    const body = parseCardText(readCardText(vault, id)).body;
    assert.ok(countWords(body) <= 100, `${id} 的 body ${countWords(body)} 字,超過 100`);
    assert.notEqual((parseCardText(readCardText(vault, id)).frontmatter as Record<string, unknown>)['title'], '新卡2', '超字的那張不能照寫');
  }
});

Then('it passes the same validator used by ingest', function (this: LearningWorld) {
  const vault = vaultOf(this);
  for (const id of createdCards(this)) {
    const verdict = validateCard(readCardText(vault, id));
    assert.equal(verdict.ok, true, `${id} 要過 validateCard:${JSON.stringify(verdict)}`);
  }
  // 「同一個」驗證器:靜態量,ingest 與 deepen 都從 schema/validate-card 拿 validateCard,深入的重寫走 generate-cards.ts 的 enforceWordLimit(不是兩份)
  const validatorImport = /import \{[^}]*\bvalidateCard\b[^}]*\} from '@core\/schema\/validate-card\.js';/;
  const deepen = readFileSync(SOURCES.deepen, 'utf8');
  const ingest = readFileSync(SOURCES.ingest, 'utf8');
  const generate = readFileSync(SOURCES.generate, 'utf8');
  assert.match(deepen, validatorImport, 'deepen.ts 要從 schema/validate-card 拿 validateCard');
  assert.match(ingest, validatorImport, 'ingest.ts 要從 schema/validate-card 拿 validateCard');
  assert.match(deepen, /import \{[^}]*\benforceWordLimit\b[^}]*\} from '\.\/generate-cards\.js';/, 'deepen.ts 的字數重寫要走 generate-cards.ts 的 enforceWordLimit');
  assert.match(generate, /export async function enforceWordLimit\(/, 'enforceWordLimit 是 generate-cards.ts 匯出的唯一一份');
  for (const [name, text] of [['deepen.ts', deepen], ['ingest.ts', ingest]] as const) {
    assert.ok(!/function validateCard\b/.test(text), `${name} 不能自己再寫一份 validateCard`);
  }
});

// ---------------------------------------------------------------- 場景:沒有 raw 素材的類別

Given('the category {string} has require_raw false and no raw files', function (this: LearningWorld, id: string) {
  assert.equal(id, 'peach');
  const vault = vaultOf(this);
  addPeachCategory(vault);
  assert.ok(!existsSync(join(vault.dir, 'raw', id)), 'raw/ 底下沒有它的檔');
  const yaml = parseYaml(readFileSync(join(vault.dir, 'config/categories.yaml'), 'utf8')) as { id: string; require_raw: boolean }[];
  assert.equal(yaml.find((c) => c.id === id)?.require_raw, false);
});

When('the person ingests with a topic for that category', { timeout: 240_000 }, function (this: LearningWorld) {
  const s = st(this);
  const vault = vaultOf(this);
  // 真的 scripts/ingest.ts(子行程,帶 _fake-cloud.mjs、沒有 .env、HOME 與 XDG 指暫存);learning 指標檔就是這個世界自己的
  const run = runIngestCli(['--out', vault.dir, '--category', 'peach', '--topic', '光合作用 的基本過程'], { xdg: vault.xdgConfig, env: { FAKE_CLOUD_LEVEL0_COUNT: '2' } });
  s.ingestOutput = run.output;
  assert.equal(run.status, 0, `scripts/ingest.ts --topic 失敗(${run.status}):\n${run.output}`);
});

const peachCards = (world: LearningWorld): { id: string; data: Record<string, unknown> }[] =>
  mdFilesUnder(join(vaultOf(world).dir, 'cards/peach')).map((path) => ({
    id: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    data: parseCardText(readFileSync(path, 'utf8')).frontmatter as Record<string, unknown>,
  }));

Then('cards are generated with source llm and no source_ref', function (this: LearningWorld) {
  const cards = peachCards(this);
  assert.ok(cards.length >= 1, `沒有生成任何卡:\n${st(this).ingestOutput}`);
  for (const c of cards) {
    assert.equal(c.data['source'], 'llm', `${c.id} 的 source`);
    assert.ok(!('source_ref' in c.data), `${c.id} 不該有 source_ref`);
  }
  assert.ok(!existsSync(join(vaultOf(this).dir, 'raw/peach')), '沒有為這個類別建出 raw 資料夾');
});

Then('the teach card shows the llm source marker on them', { timeout: 300_000 }, async function (this: LearningWorld) {
  // 「標示」本身(生成 / 原始)由 features/support/t66-source-marker-render.test.ts 在真 Chrome 量;這裡量資料來源:
  // 教學卡換到這個類別,畫面上那張卡的內文(經 lc-fs 從磁碟讀回來的)frontmatter 是 source: llm,標示就是依這一欄顯示的。
  const win = await ensureTeach(this);
  win.session.openCategories();
  await win.session.chooseCategory('peach');
  const view = win.session.view();
  assert.equal(view.category, 'peach');
  const ids = peachCards(this).map((c) => c.id).sort();
  assert.equal(view.card?.id, ids[0], '換到 peach 之後顯示的是它的第一張');
  assert.ok(view.cardText, '畫面上有卡片原文');
  assert.equal((parseCardText(view.cardText!).frontmatter as Record<string, unknown>)['source'], 'llm', '畫面上那張卡的 source 是 llm');
  assertShownFromDisk(this, view.card!.id, view.cardText);
  assertReadsWentThroughLcFs(this, [view.card!.id]);
});

// ---------------------------------------------------------------- 場景:考試卡照 I3(今天學、隔天考:07 → 04 → 06)

When('the person opens the test card and answers a question', { timeout: 300_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const vault = vaultOf(this);
  // 今天(日期 D):教學卡學一張。按下一個 = 目前這張記成學過,然後關掉(視窗歸零、側車結束)。
  const teach = await ensureTeach(this);
  s.displayedBefore = teach.session.view().card?.id;
  assert.ok(s.displayedBefore, '教學卡有第一張');
  await teach.session.next();
  teach.close();
  assert.notEqual(await teach.sidecar.exited(15_000), 'timeout', '教學卡的側車要結束');
  s.teach = undefined;
  s.oldRecord = readReviews(vault)[s.displayedBefore!];
  assert.deepEqual(s.oldRecord, applyLearnedTransition({ card: s.displayedBefore!, learnedAt: this.today }), '佈置:今天學的那張是排程的學過轉移');
  // 隔天(D+1):新的側車,LC_REVIEW_TODAY 釘成隔天;考試卡開起來,那張就在題目裡,答一題(答對)。
  const test = await openTestWindow(vault, { today: TOMORROW });
  s.test = test;
  await test.session.init();
  const current = test.session.getView().current;
  assert.ok(current, `隔天考試卡開起來要有題目:${JSON.stringify(test.session.getView())}`);
  assert.equal(current.card, s.displayedBefore, '到期的就是今天學的那張');
  assert.equal(current.type, 'fill', 'stage 1 先出填空題');
  const q = parseYaml(readFileSync(join(vault.dir, 'questions', `${current.card}.yaml`), 'utf8')) as { fill: { answers: string[][] }[] };
  const answers = q.fill[0]!.answers.map((group) => group[0]!);
  assert.equal(answers.length, current.blanks, '空格數跟答案組數一樣');
  s.answered = current.card;
  await test.session.submitFill(answers);
});

Then('the schedule advances as in I3', function (this: LearningWorld) {
  const s = st(this);
  const id = s.answered!;
  const record = readReviews(vaultOf(this))[id]!;
  assert.equal(record.history.length, 1, '這張卡多了一筆 history');
  assert.equal(record.history[0]!.date, TOMORROW, 'history 的日期是隔天(側車的 LC_REVIEW_TODAY)');
  const expected = applyPassTransition(s.oldRecord as unknown as Parameters<typeof applyPassTransition>[0], { card: id, today: TOMORROW, answers: [{ type: 'fill', grader: 'exact' }] }).review;
  assert.deepEqual(record, expected, 'stage 與 next_due 跟排程轉移函式對同一筆舊紀錄算出來的一樣');
  // 注意:這是「今天學、隔天考」的自動證據(07 → 04 → 06 串在一起),不算 i4 第 12 行 @e2e @manual 的人工確認(真資料、真的跨一天)。
});
