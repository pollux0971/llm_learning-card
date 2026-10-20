/**
 * 07-teach-card / phase-2 的步驟定義(工單 T37 驗收 1)。測試 agent 寫;開發 worker 不改。
 *
 * 接真的零件:真的側車子行程(`features/support/review-sidecar-harness.ts` 的 `spawnSidecar`,跟 Rust 起的同一支
 * `scripts/review-sidecar.ts`)、視窗那一側的 `createTeachSession`(`apps/teach-card/src/teach-session.ts`,
 * 注入真的 `createReviewClient` 與 Map 做的 localStorage)。「看磁碟,不看畫面」:Then 都讀 `state/reviews.json` 與 `state/log.jsonl`。
 *
 * 全部用暫存根(learning、XDG_*、HOME 同一個 mkdtemp,`teach-harness.ts` 的 `createTeachVault`)、假雲端,不碰真的 learning/,不准 live。
 *
 * 共用步驟「When the person presses next」在 `teach-card.steps.ts`(phase 1,記憶體裡的 deck):
 * Background 的「three categories are configured」把這個 world 標成 phase-2,那一條就改派到這裡(`phase2Active` / `phase2PressNext`)。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LearningWorld } from './_world.js';
import { createReviewClient } from '../../apps/desktop/src/webview/review-client.js';
import { spawnSidecar, type Sidecar } from '../support/review-sidecar-harness.js';
import {
  SECURITY_ID_ORDER,
  SECURITY_ORDER,
  TODAY,
  TOMORROW,
  createTeachVault,
  freshLearned,
  learnedEvents,
  readReviews,
  removeOrder,
  removeVault,
  warningEvents,
  type TeachView,
  type Vault,
} from '../support/teach-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const SESSION_URL = pathToFileURL(join(ROOT, 'apps/teach-card/src/teach-session.ts')).href;
const LAST_CATEGORY_KEY = 'lc-teach-last-category';

interface ViewState {
  state: string;
  category: string | undefined;
  card: { id: string; path: string; title: string } | undefined;
  prereqs: { id: string; title: string }[];
}
interface TeachSession {
  view(): ViewState;
  open(): Promise<void>;
  next(): Promise<void>;
  openCategories(): void;
  chooseCategory(id: string): Promise<void>;
}
interface SessionModule {
  createTeachSession(deps: Record<string, unknown>): TeachSession;
}

interface Phase2State {
  vault: Vault | undefined;
  sidecar: Sidecar | undefined;
  session: TeachSession | undefined;
  /** 視窗的 localStorage(關掉視窗再開還在) */
  storage: Map<string, string>;
  /** 送給側車的每一行請求 */
  sent: string[];
  displayed: string | undefined;
  shown: string[];
}

const states = new WeakMap<LearningWorld, Phase2State>();
function st(world: LearningWorld): Phase2State {
  let s = states.get(world);
  if (!s) {
    s = { vault: undefined, sidecar: undefined, session: undefined, storage: new Map(), sent: [], displayed: undefined, shown: [] };
    states.set(world, s);
  }
  return s;
}

export function phase2Active(world: LearningWorld): boolean {
  return states.get(world)?.vault !== undefined;
}

function vaultOf(world: LearningWorld): Vault {
  const v = st(world).vault;
  assert.ok(v, '還沒有 learning 目錄(Background 的「three categories are configured」要先跑)');
  return v;
}

async function closeWindow(world: LearningWorld): Promise<void> {
  const s = st(world);
  if (s.sidecar) {
    s.sidecar.endStdin();
    const code = await s.sidecar.exited(15_000);
    if (code === 'timeout') s.sidecar.kill();
    s.sidecar = undefined;
  }
  s.session = undefined;
}

/** 視窗:真的側車子行程 + 真的 ReviewClient + 視窗邏輯(注入記憶體做的 localStorage)。 */
async function openWindow(world: LearningWorld): Promise<TeachSession> {
  const s = st(world);
  const vault = vaultOf(world);
  const proc = spawnSidecar(vault, { today: world.today });
  s.sidecar = proc;
  const hello = await proc.nextLine(60_000);
  assert.ok(hello, `側車沒有在 60 秒內送出 hello(stderr:${proc.stderr().slice(-400)})`);
  assert.equal((JSON.parse(hello) as { kind?: string }).kind, 'hello', `第一行應該是 hello:${hello}`);
  const client = createReviewClient({
    handler: async (line: string) => {
      s.sent.push(line);
      proc.writeRaw(`${line}\n`);
      const reply = await proc.nextLine(60_000);
      if (reply === undefined) throw new Error(`側車沒有回應(stderr:${proc.stderr().slice(-400)})`);
      return reply;
    },
  });
  const mod = (await import(/* @vite-ignore */ SESSION_URL)) as SessionModule;
  const session = mod.createTeachSession({
    client,
    fs: { read: async (rel: string): Promise<string> => readFileSync(join(vault.dir, rel), 'utf8') },
    storage: { getItem: (k: string) => s.storage.get(k) ?? null, setItem: (k: string, v: string) => void s.storage.set(k, v) },
  });
  s.session = session;
  await session.open();
  return session;
}

function current(world: LearningWorld): ViewState {
  const s = st(world);
  assert.ok(s.session, '視窗還沒開');
  return s.session.view();
}

After({ tags: '@teach-card and @phase-2' }, async function (this: LearningWorld) {
  const s = states.get(this);
  if (!s) return;
  s.sidecar?.kill();
  if (s.vault) removeVault(s.vault);
});

// ---------------------------------------------------------------- Background

Given('three categories are configured', function (this: LearningWorld) {
  const s = st(this);
  s.vault = createTeachVault();
  const yaml = readFileSync(join(s.vault.dir, 'config/categories.yaml'), 'utf8');
  const ids = [...yaml.matchAll(/^- id: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['security', 'language', 'network'], '設定檔應該有三個類別');
});

Given('a real learning directory with order files', function (this: LearningWorld) {
  const vault = vaultOf(this);
  const order = JSON.parse(readFileSync(join(vault.dir, 'graph/order-security.json'), 'utf8')) as string[];
  assert.deepEqual(order, SECURITY_ORDER, 'security 的 order 檔');
  assert.deepEqual(readReviews(vault), {}, '一開始什麼都沒學');
});

// ---------------------------------------------------------------- 換類別也算學過

When('the person switches to another category', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const session = await openWindow(this);
  s.displayed = session.view().card?.id;
  assert.ok(s.displayed, '開啟之後應該有一張卡');
  session.openCategories();
  await session.chooseCategory('language');
  assert.equal(session.view().category, 'language', '應該換到 language');
});

Then('the card that was displayed is recorded as learned', function (this: LearningWorld) {
  const s = st(this);
  const vault = vaultOf(this);
  assert.ok(s.displayed);
  assert.deepEqual(readReviews(vault), { [s.displayed]: freshLearned(TODAY, TOMORROW) }, '磁碟上的 reviews.json 應該剛好多了離開的那張卡(stage 1、今天學、明天到期)');
  assert.deepEqual(
    learnedEvents(vault).map((e) => e['card']),
    [s.displayed],
    'log.jsonl 應該多一行 learned',
  );
});

// ---------------------------------------------------------------- 記住上次的類別

Given('the interface was closed while showing the language category', { timeout: 180_000 }, async function (this: LearningWorld) {
  const session = await openWindow(this);
  session.openCategories();
  await session.chooseCategory('language');
  assert.equal(session.view().category, 'language');
  await closeWindow(this);
  assert.equal(st(this).storage.get(LAST_CATEGORY_KEY), 'language', '視窗關掉之前,應該已經把 language 記在 localStorage 的 lc-teach-last-category');
});

When('it is opened again', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  s.sent.length = 0;
  await openWindow(this);
});

Then('the language category is shown', function (this: LearningWorld) {
  const s = st(this);
  const first = JSON.parse(s.sent[0] ?? '{}') as { method?: string; params?: { category?: string } };
  assert.equal(first.method, 'teach.open');
  assert.equal(first.params?.category, 'language', '重開之後,視窗應該把記住的類別帶給側車');
  const view = current(this);
  assert.equal(view.category, 'language');
  assert.ok(view.card?.path.startsWith('cards/language/'), `應該是 language 的卡:${view.card?.path}`);
});

// ---------------------------------------------------------------- order 檔

Given('the order file lists three unlearned cards in a particular sequence', function (this: LearningWorld) {
  const vault = vaultOf(this);
  const order = JSON.parse(readFileSync(join(vault.dir, 'graph/order-security.json'), 'utf8')) as string[];
  assert.equal(order.length, 3);
  assert.notDeepEqual(order, SECURITY_ID_ORDER, 'order 檔的順序要跟 id 順序不同,不然量不出差別');
  assert.deepEqual(readReviews(vault), {}, '三張都還沒學');
});

When('the person presses next twice', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const session = await openWindow(this);
  s.shown = [session.view().card?.id ?? '(沒有卡)'];
  for (let i = 0; i < 2; i += 1) {
    await session.next();
    s.shown.push(session.view().card?.id ?? '(沒有卡)');
  }
});

Then('the cards appear in that sequence', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(s.shown, SECURITY_ORDER, '依序出現的卡應該照 order 檔');
  assert.deepEqual(Object.keys(readReviews(vaultOf(this))).sort(), ['sec-0002', 'sec-0003'], '按了兩次下一個,磁碟上該有前兩張');
});

// ---------------------------------------------------------------- 沒有 order 檔

Given('no order file exists for the category', function (this: LearningWorld) {
  removeOrder(vaultOf(this), 'security');
});

/** 共用的「When the interface loads」在 phase-2 的版本(test-card.steps.ts 分派過來):開視窗,一路按下一個,記下依序出現的卡 */
export async function phase2Load(world: LearningWorld): Promise<void> {
  const s = st(world);
  const session = await openWindow(world);
  s.shown = [];
  for (let i = 0; i < 6 && session.view().card; i += 1) {
    s.shown.push(session.view().card!.id);
    await session.next();
  }
}

Then('cards are shown in id order', function (this: LearningWorld) {
  assert.deepEqual(st(this).shown, SECURITY_ID_ORDER);
});

Then('a warning is logged suggesting the order be rebuilt', function (this: LearningWorld) {
  const warnings = warningEvents(vaultOf(this));
  assert.ok(warnings.length >= 1, 'log.jsonl 應該多一筆 warning');
  const message = String(warnings[0]!['message']);
  assert.match(message, /order/i, `warning 應該提到 order:${message}`);
  assert.match(message, /ingest/i, `warning 應該建議重跑 ingest:${message}`);
});

// ---------------------------------------------------------------- 先備沒學不擋

Given('the displayed card has an unlearned prerequisite', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const session = await openWindow(this);
  const view = session.view();
  assert.ok(view.card, '應該有一張卡');
  assert.ok(view.prereqs.length >= 1, `顯示中的 ${view.card.id} 應該有沒學的先備`);
  s.displayed = view.card.id;
});

/** 共用的「When the person presses next」在 phase-2 的版本(teach-card.steps.ts 分派過來) */
export async function phase2PressNext(world: LearningWorld): Promise<void> {
  const session = st(world).session;
  assert.ok(session, '視窗還沒開');
  await session.next();
}

Then('the card is marked learned as normal', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.displayed);
  assert.deepEqual(readReviews(vaultOf(this))[s.displayed], freshLearned(TODAY, TOMORROW), '先備沒學不擋:顯示中的那張照樣標成學過');
  const view = current(this);
  assert.notEqual(view.card?.id, s.displayed, '應該前進到下一張');
});

export type { TeachView };
