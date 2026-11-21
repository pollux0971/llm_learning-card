/**
 * 07-teach-card / phase-5(今日負擔提示,T67、ADR-085)的步驟定義。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T67-teach-card-daily-load-hint.md。.feature:features/07-teach-card/phase-5.feature(8 個自動場景 + 1 個 `@manual`)。
 *
 * 接真的零件(同 phase-2):真的側車子行程(`spawnSidecar`,跟 Rust 起的同一支 `scripts/review-sidecar.ts`)、視窗那一側的
 * `createTeachSession`(注入真的 `createReviewClient` 與 Map 做的 localStorage)。「頁尾說的數字」= 視窗那一側 `view().load`(畫面印的就是它);
 * 畫面真的畫出來、一行、不推動按鈕等,由 `apps/teach-card/src/t67-load-render.test.ts` 量。
 * `LC_REVIEW_TODAY` 釘 2026-09-10(`TODAY`),**不是**機器的日期:學過的紀錄的 learned_at 都用這一天,數錯日子(機器日期、UTC)就會數錯。
 * 全部用暫存根(learning、XDG_*、HOME 同一個 mkdtemp)、假雲端;不碰真的 learning/,不准 live。
 *
 * 只在 `@teach-card and @phase-5` 的場景掛 Before / After(只寫 @phase-5 會碰到別的 feature)。
 * 共用步驟「When the person presses next」在 `teach-card.steps.ts`:phase-5 的場景改派到這裡(`phase5Active` / `phase5PressNext`)。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LearningWorld } from './_world.js';
import { createReviewClient } from '../../apps/desktop/src/webview/review-client.js';
import { request, spawnSidecar, type Sidecar } from '../support/review-sidecar-harness.js';
import { reviewRecord, seedDue } from '../support/review-session-harness.js';
import { TODAY, TOMORROW, createTeachVault, freshLearned, readReviews, removeVault, writeReviews, type Vault } from '../support/teach-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const SESSION_URL = pathToFileURL(join(ROOT, 'apps/teach-card/src/teach-session.ts')).href;
const TAGS = '@teach-card and @phase-5';
const YESTERDAY = '2026-09-09';

interface Load {
  learnedToday: number;
  dueTomorrow: number;
}
interface ViewState {
  state: string;
  message: string | undefined;
  card: { id: string; path: string; title: string } | undefined;
  load: Load | undefined;
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

interface Phase5State {
  vault: Vault | undefined;
  sidecar: Sidecar | undefined;
  session: TeachSession | undefined;
  /** 視窗的 localStorage(關掉視窗再開還在) */
  storage: Map<string, string>;
  /** 場景 5:視窗打開(還沒按下一個)時的「明天約幾張」 */
  dueBefore: number | undefined;
  /** 場景 6:考試卡小結的明天預估(shown) */
  summaryShown: number | undefined;
  /** 場景 7:設定檔的每日上限 */
  cap: number | undefined;
}

const states = new WeakMap<LearningWorld, Phase5State>();
function st(world: LearningWorld): Phase5State {
  const s = states.get(world);
  assert.ok(s, '這個場景沒有 phase-5 的狀態(Before 沒跑?)');
  return s;
}

export function phase5Active(world: LearningWorld): boolean {
  return states.get(world) !== undefined;
}

Before({ tags: TAGS }, function (this: LearningWorld) {
  states.set(this, { vault: undefined, sidecar: undefined, session: undefined, storage: new Map(), dueBefore: undefined, summaryShown: undefined, cap: undefined });
});

After({ tags: TAGS }, function (this: LearningWorld) {
  const s = states.get(this);
  if (!s) return;
  s.sidecar?.kill();
  if (s.vault) removeVault(s.vault);
  states.delete(this);
});

function vaultOf(world: LearningWorld): Vault {
  const v = st(world).vault;
  assert.ok(v, '還沒有 learning 目錄(Given 要先佈置)');
  return v;
}

function setDailyCap(vault: Vault, cap: number): void {
  const path = join(vault.dir, 'config/settings.yaml');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^daily_cap:.*$/m, `daily_cap: ${cap}`), 'utf8');
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
  await closeWindow(world);
  const proc = spawnSidecar(vault, { today: TODAY });
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
  const mod = (await import(/* @vite-ignore */ SESSION_URL)) as SessionModule;
  const session = mod.createTeachSession({
    client,
    fs: { read: async (rel: string): Promise<string> => readFileSync(join(vault.dir, rel), 'utf8'), assetUrl: (rel: string): string => `fake://asset/${rel}` },
    storage: { getItem: (k: string) => s.storage.get(k) ?? null, setItem: (k: string, v: string) => void s.storage.set(k, v) },
    pause: async () => undefined,
  });
  s.session = session;
  await session.open();
  return session;
}

function sessionOf(world: LearningWorld): TeachSession {
  const s = st(world);
  assert.ok(s.session, '視窗還沒開');
  return s.session;
}

function loadOf(world: LearningWorld): Load {
  const load = sessionOf(world).view().load;
  assert.ok(load, `頁尾沒有數字(view().load 是 ${JSON.stringify(load)});畫面狀態:${sessionOf(world).view().state}`);
  return load;
}

export async function phase5PressNext(world: LearningWorld): Promise<void> {
  await sessionOf(world).next();
}

// ---------------------------------------------------------------- Given

Given('4 cards were learned today and 1 card was learned yesterday', function (this: LearningWorld) {
  const s = st(this);
  const vault = createTeachVault();
  s.vault = vault;
  // 學過的都不在 security(視窗一開就顯示 security 的第一張沒學的,按下一個或換類別才會把「目前這張」記成學過)
  // 場景 5 要求「多學一張,明天的估計就多 1」:每日上限設成 50,遠高於明天到期的張數(今天學的 4 張 + 昨天學的 1 張 + 這一張 = 6),不會碰上限。
  setDailyCap(vault, 50);
  s.cap = 50;
  writeReviews(vault, {
    'lang-0001': freshLearned(TODAY, TOMORROW),
    'lang-0002': freshLearned(TODAY, TOMORROW),
    'net-0001': freshLearned(TODAY, TOMORROW),
    'net-0002': freshLearned(TODAY, TOMORROW),
    'net-0003': freshLearned(YESTERDAY, TODAY),
  });
  const reviews = readReviews(vault);
  assert.equal(Object.values(reviews).filter((r) => r.learned_at === TODAY).length, 4);
  assert.equal(Object.values(reviews).filter((r) => r.learned_at === YESTERDAY).length, 1);
});

Given('the teach card is open', { timeout: 180_000 }, async function (this: LearningWorld) {
  const session = await openWindow(this);
  assert.equal(session.view().state, 'card', `視窗要在卡片畫面:${JSON.stringify(session.view())}`);
  st(this).dueBefore = loadOf(this).dueTomorrow;
});

Given('the person pressed next and then closed the teach card', { timeout: 180_000 }, async function (this: LearningWorld) {
  const session = await openWindow(this);
  await session.next();
  assert.equal(loadOf(this).learnedToday, 5, '按下一個之後,同一次回應就帶新的數字');
  await closeWindow(this);
});

Given('some cards are due today and some are due tomorrow', function (this: LearningWorld) {
  const s = st(this);
  const vault = createTeachVault();
  s.vault = vault;
  seedDue(vault, ['sec-0001', 'sec-0002'], [0, 0]);
  const reviews = readReviews(vault);
  reviews['lang-0001'] = reviewRecord({ next_due: TOMORROW });
  reviews['lang-0002'] = reviewRecord({ next_due: TOMORROW });
  writeReviews(vault, reviews);
});

Given('today\'s test card session ended with 2 cards returned', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const vault = vaultOf(this);
  const proc = spawnSidecar(vault, { today: TODAY });
  try {
    const hello = await proc.nextLine(60_000);
    assert.ok(hello, `考試卡的側車沒有送出 hello(stderr:${proc.stderr().slice(-400)})`);
    let id = 0;
    const call = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      id += 1;
      const res = await request(proc, id, method, params);
      assert.equal(res['ok'], true, `${method} 應該成功:${JSON.stringify(res)}`);
      return res['result'] as Record<string, unknown>;
    };
    await call('start');
    for (let i = 0; i < 20; i += 1) {
      const q = await call('next');
      if (q['kind'] === 'done') break;
      assert.equal(q['kind'], 'question');
      await call('submit', q['type'] === 'fill' ? { fill: Array.from({ length: Number(q['blanks']) }, () => 'x') } : { apply: 'x' });
    }
    const summary = await call('summary');
    assert.equal(summary['returned'], 2, '兩張到期的卡都答錯 = 回退 2 張');
    s.summaryShown = Number((summary['tomorrow'] as Record<string, unknown>)['shown']);
    assert.ok(Number.isInteger(s.summaryShown), '考試卡小結要有明天預估');
  } finally {
    proc.endStdin();
    const code = await proc.exited(15_000);
    if (code === 'timeout') proc.kill();
  }
});

Given('more cards are due tomorrow than the daily cap in the settings', function (this: LearningWorld) {
  const s = st(this);
  const vault = createTeachVault();
  s.vault = vault;
  setDailyCap(vault, 3);
  s.cap = 3;
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  for (const id of ['sec-0001', 'sec-0002', 'sec-0003', 'lang-0001', 'lang-0002']) reviews[id] = reviewRecord({ next_due: TOMORROW });
  writeReviews(vault, reviews);
});

Given('the categories are configured but there are no cards and no review state', function (this: LearningWorld) {
  const s = st(this);
  const vault = createTeachVault();
  s.vault = vault;
  rmSync(join(vault.dir, 'cards'), { recursive: true, force: true });
  mkdirSync(join(vault.dir, 'cards'), { recursive: true });
  rmSync(join(vault.dir, 'graph'), { recursive: true, force: true });
  rmSync(join(vault.dir, 'state/reviews.json'), { force: true });
});

// ---------------------------------------------------------------- When

When('the teach card is opened', { timeout: 180_000 }, async function (this: LearningWorld) {
  await openWindow(this);
});

When('the person picks another category in the teach card', { timeout: 180_000 }, async function (this: LearningWorld) {
  const session = sessionOf(this);
  session.openCategories();
  await session.chooseCategory('network');
  assert.equal((session.view() as ViewState & { category?: string }).category, 'network', '應該換到 network');
});

// ---------------------------------------------------------------- Then

Then(/^the footer (?:now )?says (\d+) were learned today$/, function (this: LearningWorld, n: string) {
  assert.equal(loadOf(this).learnedToday, Number(n));
});

Then('the footer\'s estimate for tomorrow is one more than before', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.dueBefore !== undefined, '「before」要在 the teach card is open 時記下');
  assert.equal(loadOf(this).dueTomorrow, s.dueBefore + 1);
});

Then('the footer\'s estimate for tomorrow equals the estimate in the test card summary', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.summaryShown !== undefined, '考試卡小結的數字要先記下');
  assert.equal(loadOf(this).dueTomorrow, s.summaryShown);
});

Then('the footer\'s estimate for tomorrow is the daily cap', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.cap !== undefined);
  assert.equal(loadOf(this).dueTomorrow, s.cap, '明天到期 5 張、上限 3:頁尾要顯示上限那個數');
});

Then('the footer says {int} were learned today and {int} are due tomorrow', function (this: LearningWorld, learned: number, due: number) {
  assert.deepEqual(loadOf(this), { learnedToday: learned, dueTomorrow: due });
});

Then('the teach card shows no error', function (this: LearningWorld) {
  const view = sessionOf(this).view();
  assert.notEqual(view.state, 'error', `不該出錯:${JSON.stringify(view)}`);
  assert.equal(view.message === undefined || view.state === 'finished', true, `不該有錯誤字樣:${view.message}`);
});
