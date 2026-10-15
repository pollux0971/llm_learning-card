/**
 * 14-hud-skin phase-2(工單 T15)的步驟定義。測試 agent 寫;開發 worker 不改。
 *
 * 檢查邏輯都在 packages/ui-shared/src/hud/ 的 *-test-support.ts(vitest 的 card-*.test.ts 跑同一份),這裡只接句子。
 * 讀卡片的檔用 fs、開 dev server 用目錄路徑,**不 import 06、07 的模組**(boundaries 只開 06→14、07→14)。
 * 兩張卡的 dev server 與 headless Chrome 整個 cucumber 行程各開一次(第一次用到時),AfterAll 收掉。
 * 只接 phase-2.feature 的非 @manual 場景;@manual 由前端用 tauri build 的產物拍。
 */
import { AfterAll, Given, Then, When } from '@cucumber/cucumber';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { ROOT } from './_world.js';
import { DONE_PHASES_TAG_EXPRESSION, type CardName } from '../../packages/ui-shared/src/hud/card-design-values-test-support.js';
import { doneFeatureProblems } from '../../packages/ui-shared/src/hud/card-regression-test-support.js';
import { hpBarProblems, openCard, progressText } from '../../packages/ui-shared/src/hud/card-render-test-support.js';
import { allCardProblems } from '../../packages/ui-shared/src/hud/card-static-test-support.js';
import type { GalleryPage } from '../../packages/ui-shared/src/hud/render-test-support.js';

const pages = new Map<CardName, Promise<GalleryPage>>();
function cardPage(name: CardName): Promise<GalleryPage> {
  let p = pages.get(name);
  if (!p) { p = openCard(name); pages.set(name, p); }
  return p;
}
AfterAll({ timeout: 30_000 }, async () => {
  for (const p of pages.values()) { try { await (await p).close(); } catch { /* 開不起來的那次已經在場景裡報過 */ } }
});

interface Phase2State {
  scanned?: CardName;
  kit: Partial<Record<CardName, string[]>>;
  own: Partial<Record<CardName, string[]>>;
  page?: GalleryPage;
  hpProblems?: string[];
  childStatus?: number | null;
  childOutput?: string;
}
const states = new WeakMap<LearningWorld, Phase2State>();
function st(w: LearningWorld): Phase2State {
  let s = states.get(w);
  if (!s) { s = { kit: {}, own: {} }; states.set(w, s); }
  return s;
}
const none = (problems: string[]) => assert.deepEqual(problems, [], problems.join('\n'));

// ---------------------------------------------------------------- 場景 1、2:原始碼掃描
function scan(w: LearningWorld, name: CardName): void {
  const s = st(w);
  const r = allCardProblems(name);
  s.scanned = name; s.kit[name] = r.kit; s.own[name] = r.own;
}
When('the teach card source is scanned', function (this: LearningWorld) { scan(this, 'teach-card'); });
When('the test card source is scanned', function (this: LearningWorld) { scan(this, 'test-card'); });

function kitProblems(w: LearningWorld, name: CardName, pick: (p: string) => boolean): string[] {
  const s = st(w);
  assert.equal(s.scanned, name, `先要掃 ${name}`);
  return (s.kit[name] ?? []).filter(pick);
}
const isPanel = (p: string) => /HudPanel|title|controls|h1|frameless|solid|classList|最外層|createWindowControls/.test(p);
const isButton = (p: string) => /按鈕|<button>|HudButton|onclick|disabled|送出|下一題|下一個|handle|submit/.test(p);
const isField = (p: string) => /HudField|<input>|<textarea>|bind:|輸入框|單行|第一格|rows/.test(p);
const isProgress = (p: string) => /HpBar|header\.progress|進度|x \/ y|answeredCount|totalCount/.test(p);

Then('its panel, its three buttons and its title bar come from the HUD kit', function (this: LearningWorld) {
  // Q1(顧問 2026-10-16):「three buttons」讀成「07 設計的三顆裡已經存在的那幾顆」,檢查每一顆按鈕都是 HudButton、沒有原生 <button>
  const problems = kitProblems(this, 'teach-card', () => true);
  none(problems);
});

Then('its panel, its answer field, its submit button and its progress bar come from the HUD kit', function (this: LearningWorld) {
  const all = kitProblems(this, 'test-card', () => true);
  const known = all.filter((p) => isPanel(p) || isButton(p) || isField(p) || isProgress(p));
  none(known);
  none(all.filter((p) => !known.includes(p)));
});

Then('it draws no frame or title bar of its own', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.scanned, '先要掃原始碼');
  none(s.own[s.scanned] ?? []);
});

// ---------------------------------------------------------------- 場景 3:HP 條
Given('a session of three questions with one answered', { timeout: 120_000 }, async function (this: LearningWorld) {
  // 考試卡自己的 fixture 就是三題到期;答完一題由 When 之後的步驟量。這裡先把頁面開好、重新載入,確認總數是 3
  const page = await cardPage('test-card');
  await page.reset();
  st(this).page = page;
  assert.match(await progressText(page), /(^|\s)0 \/ 3(\s|$)/, '考試卡的 fixture 要是三題');
});

When('the test card is shown', { timeout: 120_000 }, async function (this: LearningWorld) {
  const page = st(this).page;
  assert.ok(page, '先要有考試卡');
  // hpBarProblems 自己會先量剛載入的 0 / 3、再答完一題;場景裡的「答完一題」就在那一步發生
  st(this).hpProblems = await hpBarProblems(page);
});

Then('the progress is drawn as an HP bar filled to one third', function (this: LearningWorld) {
  const problems = st(this).hpProblems;
  assert.ok(problems, '先要把考試卡畫出來量');
  none(problems.filter((p) => !/進度那一區的字/.test(p)));
});

Then('the text 1 \\/ 3 is still shown next to it', function (this: LearningWorld) {
  const problems = st(this).hpProblems;
  assert.ok(problems, '先要把考試卡畫出來量');
  none(problems.filter((p) => /進度那一區的字/.test(p)));
});

// ---------------------------------------------------------------- 場景 4:不退步
When('the scenarios of every done phase of the teach card and the test card are run', { timeout: 900_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const child = spawn('npx', ['cucumber-js', '--tags', DONE_PHASES_TAG_EXPRESSION, '--format', 'summary'], {
    cwd: ROOT, env: { ...process.env, NODE_OPTIONS: process.env['NODE_OPTIONS'] ?? '--import=tsx' },
  });
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
  s.childStatus = await new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  s.childOutput = out;
});

Then('they all pass', function (this: LearningWorld) {
  const s = st(this);
  assert.notEqual(s.childOutput, undefined, '先要跑子行程');
  assert.equal(s.childStatus, 0, `子行程 exit ${s.childStatus}:\n${(s.childOutput ?? '').slice(-1500)}`);
  const n = Number(/(\d+) scenarios?/.exec(s.childOutput ?? '')?.[1] ?? 0);
  assert.ok(n > 0, `子行程沒有跑到任何場景(防止空集合綠):\n${(s.childOutput ?? '').slice(-600)}`);
});

Then('none of their feature files was changed', function () {
  none(doneFeatureProblems());
});
