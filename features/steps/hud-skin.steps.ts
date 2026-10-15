/**
 * 14-hud-skin / phase-1 的步驟定義(測試 agent 寫,開發 worker 不改)。
 *
 * 實際的檢查邏輯都在 packages/ui-shared/src/hud/test-support.ts,vitest 單元測試跑同一份;
 * 這裡只是把 Gherkin 的句子接上去。實作模組一律動態載入(importHud),實作還不存在時 tsc 仍是 0 錯。
 * 元件用 vite 的 ssrLoadModule 在 node 裡載入並做伺服器端 render,不需要 DOM。
 */
import { After, AfterAll, Given, Then, When } from '@cucumber/cucumber';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { ROOT } from './_world.js';
import {
  HUD_DIR, allStyleNodes, bodyContrast, closeViteServer, countHook, createRawSnippetOrThrow, expandAnimationProblems,
  fontFiles, fontLicenceProblems, importHud, jsMotionProblems, makeWindowSpy, openingTag, readHudCss, readText,
  reducedMotionProblems, renderSvelte, scanHudLoads, windowApiProblems,
  type ControlsDeps, type WindowControls, type WindowSpy,
} from '../../packages/ui-shared/src/hud/test-support.js';

interface HudState {
  frameless?: boolean;
  tauri?: boolean;
  htmls: string[];
  errors: string[];
  spy?: WindowSpy;
  contrast?: number;
  percentModule?: number;
  percentHtml?: string;
  scan?: { files: number; problems: string[] };
  fontListed?: boolean;
  stylesApplied?: boolean;
  gallery?: GalleryResult;
}
const states = new WeakMap<LearningWorld, HudState>();
function st(w: LearningWorld): HudState {
  let s = states.get(w);
  if (!s) { s = { htmls: [], errors: [] }; states.set(w, s); }
  return s;
}

AfterAll(async () => { await closeViteServer(); });
const killers = new WeakMap<LearningWorld, () => void>();
After(function (this: LearningWorld) { killers.get(this)?.(); killers.delete(this); });

async function makeControls(tauri: boolean, s: HudState): Promise<WindowControls> {
  const m = (await importHud('window-controls')) as { createWindowControls(d?: ControlsDeps): WindowControls };
  s.spy = makeWindowSpy(tauri);
  return m.createWindowControls(s.spy.deps);
}

// ---------------------------------------------------------------- 場景 1:展示頁自己跑得起來
interface GalleryResult { url: string; modules: string[]; bodies: Map<string, string>; failures: string[] }

const ANSI = /\u001b\[[0-9;]*m/g;

When('the HUD gallery command is run', { timeout: 120_000 }, async function (this: LearningWorld) {
  const manifest = this.manifest() as Record<string, { cmd: string; interactive: boolean }>;
  const entry = manifest['14-hud-skin'];
  assert.ok(entry, 'standalone.json 沒有 14-hud-skin');
  assert.equal(entry.cmd, 'npx vite packages/ui-shared/src/hud/gallery', 'standalone.json 的指令要照 FEATURE.md「單獨執行」');
  assert.equal(entry.interactive, true);
  const { NODE_OPTIONS: _drop, ...env } = process.env;
  const child = spawn(entry.cmd, { cwd: ROOT, shell: true, env, detached: true });
  killers.set(this, () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* 已結束 */ } });
  let out = '';
  const url = await new Promise<string>((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`dev server 沒在時限內 ready:\n${out.slice(-800)}`)), 90_000);
    const onData = (d: Buffer) => {
      out += d.toString().replace(ANSI, '');
      const m = /Local:\s+(http:\/\/\S+)/.exec(out);
      if (m) { clearTimeout(timer); resolveUrl(m[1]!); }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`dev server 結束了(${code}):\n${out.slice(-800)}`)); });
  });
  const base = new URL(url);
  const result: GalleryResult = { url, modules: [], bodies: new Map(), failures: [] };
  const queue = ['/'];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 80) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await fetch(new URL(path, base));
    const body = await res.text();
    if (!res.ok) { result.failures.push(`${path} → ${res.status}`); continue; }
    result.modules.push(path);
    result.bodies.set(path, body);
    const specs = path === '/'
      ? [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]!)
      : [...body.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of specs) {
      if (/^(https?:)?\/\//.test(spec) || spec.startsWith('data:')) continue;
      const next = new URL(spec, new URL(path, base));
      const target = next.pathname + next.search;
      if (/\/node_modules\/|^\/@(vite|id)\b/.test(target)) continue;
      if (next.origin !== base.origin) continue;
      queue.push(target);
    }
  }
  st(this).gallery = result;
});

Then('a development server starts', function (this: LearningWorld) {
  const g = st(this).gallery;
  assert.ok(g, '還沒有跑展示頁指令');
  assert.match(g.url, /^http:\/\//);
  assert.deepEqual(g.failures, [], `展示頁的模組有載入失敗:${g.failures.join('; ')}`);
  assert.ok(g.modules.length >= 5, `只載到 ${g.modules.length} 個模組(入口、Gallery、面板、按鈕、HP 條至少 5 個)`);
});

Then('opening it shows every HUD piece filled with fixture card text', function (this: LearningWorld) {
  const g = st(this).gallery!;
  const joined = g.modules.join('\n');
  for (const piece of ['HudPanel.svelte', 'HudButton.svelte', 'HpBar.svelte', 'HudTitleBar.svelte', 'HudResizeHandles.svelte', 'hud.css']) {
    assert.ok(joined.includes(piece), `展示頁的模組圖裡沒有 ${piece}`);
  }
  const fixtureDir = join(ROOT, 'contracts/fixtures/cards');
  const fixtures = readdirSync(fixtureDir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => readFileSync(join(fixtureDir, f), 'utf8'));
  const raw = g.modules.filter((m) => m.includes('contracts/fixtures/cards/'));
  assert.ok(raw.length > 0, '展示頁沒有載入 contracts/fixtures/cards/ 的卡片文字');
  const filled = raw.some((m) => {
    const lit = /export default (".*");?\s*$/s.exec(g.bodies.get(m)!.split('\n').filter((l) => l.startsWith('export default')).join('\n'))?.[1];
    return lit !== undefined && fixtures.includes(JSON.parse(lit) as string);
  });
  assert.ok(filled, '載入的卡片模組內容跟任何一份 fixture 不一樣');
});

// ---------------------------------------------------------------- 場景 2:對比
When('the body text colour and the panel colour are read from the HUD stylesheet', function (this: LearningWorld) {
  st(this).contrast = bodyContrast(readHudCss().nodes);
});
Then('their contrast ratio is at least 4.5 to 1', function (this: LearningWorld) {
  const c = st(this).contrast;
  assert.ok(c !== undefined, 'When 要先量對比');
  assert.ok(c >= 4.5, `對比 ${c.toFixed(2)}:1 < 4.5:1`);
});

// ---------------------------------------------------------------- 場景 3:HP 條
When('the HP bar is given {int} done out of {int}', async function (this: LearningWorld, done: number, total: number) {
  const s = st(this);
  const { hpPercent } = (await importHud('hp-bar')) as { hpPercent(d: number, t: number): number };
  s.percentModule = hpPercent(done, total);
  s.percentHtml = await renderSvelte('HpBar', { done, total });
});
Then('it is filled to {int} percent', function (this: LearningWorld, percent: number) {
  const s = st(this);
  assert.equal(s.percentModule, percent);
  const attr = (n: string) => new RegExp(`${n}=["']([^"']*)["']`).exec(s.percentHtml ?? '')?.[1];
  assert.equal(Number(attr('data-percent')), percent, 'data-percent');
  assert.equal(Number(attr('aria-valuenow')), percent, 'aria-valuenow');
});

// ---------------------------------------------------------------- 場景 4–6:標題列與把手
Given('the page root does not have the frameless class', function (this: LearningWorld) { st(this).frameless = false; });
Given('the page root has the frameless class', function (this: LearningWorld) { st(this).frameless = true; });
Given('the page is not running inside the desktop app', function (this: LearningWorld) { st(this).tauri = false; });
Given('the page is running inside the desktop app', function (this: LearningWorld) { st(this).tauri = true; });

When('a HUD panel is shown', async function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.frameless !== undefined, 'Given 要先決定有沒有 frameless class');
  // 場景沒說在不在桌面程式裡的時候,兩種都要成立
  const modes = s.tauri === undefined ? [false, true] : [s.tauri];
  const err = console.error;
  console.error = (...a: unknown[]) => { s.errors.push(a.join(' ')); };
  try {
    s.htmls = [];
    for (const tauri of modes) {
      const controls = await makeControls(tauri, s);
      s.htmls.push(await renderSvelte('HudPanel', {
        title: 'Card title', frameless: s.frameless, controls, children: await createRawSnippetOrThrow('<p>body</p>'),
      }));
    }
  } catch (e) { s.errors.push(String(e)); } finally { console.error = err; }
  assert.ok(s.htmls.length > 0, `面板 render 失敗:${s.errors.join('; ')}`);
});

Then('there is no drawn title bar', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.htmls.length > 0 && s.htmls.every((h) => /data-hud=["']panel["']/.test(h)), '面板要真的 render 出來(防止空 HTML 綠)');
  for (const h of s.htmls) assert.equal(countHook(h, 'titlebar'), 0);
});
Then('there are no resize handles', function (this: LearningWorld) {
  for (const h of st(this).htmls) assert.equal(countHook(h, 'resize-handle'), 0);
});
Then('the drawn title bar shows the window title', function (this: LearningWorld) {
  for (const h of st(this).htmls) {
    assert.equal(countHook(h, 'titlebar'), 1);
    assert.match(h, /data-hud=["']title["'][^>]*>[^<]*Card title/);
  }
});
Then('it has no minimize button and no close button', function (this: LearningWorld) {
  for (const h of st(this).htmls) {
    assert.equal(countHook(h, 'minimize'), 0);
    assert.equal(countHook(h, 'close'), 0);
  }
});
Then('no error is reported', function (this: LearningWorld) {
  assert.deepEqual(st(this).errors, []);
});

When('the drawn close button is pressed', async function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.tauri, true, 'Given 要先說在桌面程式裡');
  const bar = readText(join(HUD_DIR, 'HudTitleBar.svelte'));
  const tag = openingTag(bar, 'close');
  assert.ok(tag, 'HudTitleBar.svelte 找不到 data-hud="close"');
  assert.match(tag, /onclick\s*=\s*\{[^}]*\.close\b/, '關閉鈕的 onclick 要呼叫 controls.close');
  const controls = await makeControls(true, s);
  const html = await renderSvelte('HudPanel', {
    title: 'Card title', frameless: s.frameless, controls, children: await createRawSnippetOrThrow('<p>body</p>'),
  });
  assert.equal(countHook(html, 'close'), 1, '桌面程式裡 + frameless 應該有一個關閉鈕');
  await controls.close();
});
Then('the window is asked to close through the same request the system close button sends', function (this: LearningWorld) {
  assert.deepEqual(st(this).spy!.calls, ['close']);
});
Then('nothing ends the application or hides the window directly', function (this: LearningWorld) {
  const calls = st(this).spy!.calls;
  for (const bad of ['hide', 'destroy', 'exit', 'setVisible']) assert.ok(!calls.some((c) => c.startsWith(bad)), `不該呼叫 ${bad}`);
  assert.deepEqual(windowApiProblems(), []);
});

// ---------------------------------------------------------------- 場景 7–8:不載外部、字型授權
When('the HUD stylesheets and components are scanned', function (this: LearningWorld) {
  st(this).scan = scanHudLoads();
});
Then('no element carries an inline style attribute', function (this: LearningWorld) {
  const r = st(this).scan!;
  assert.ok(r.files > 3, `只掃到 ${r.files} 個檔`);
  assert.deepEqual(r.problems.filter((p) => /style/i.test(p)), []);
});
Then('no font, image or stylesheet is loaded from another host', function (this: LearningWorld) {
  const r = st(this).scan!;
  assert.deepEqual(r.problems.filter((p) => !/style/i.test(p)), []);
});

When('the HUD font directory is listed', function (this: LearningWorld) {
  assert.ok(fontFiles().length > 0, 'hud/fonts/ 沒有字型檔');
  st(this).fontListed = true;
});
Then('every font file has an open font licence text next to it', function (this: LearningWorld) {
  assert.ok(st(this).fontListed);
  assert.deepEqual(fontLicenceProblems(), []);
});

// ---------------------------------------------------------------- 場景 9:減少動態
Given('the system asks for reduced motion', function (this: LearningWorld) { st(this).stylesApplied = false; });
When('the HUD stylesheet is applied', function (this: LearningWorld) { st(this).stylesApplied = true; });
Then('no HUD piece animates or transitions', function (this: LearningWorld) {
  assert.ok(st(this).stylesApplied);
  const nodes = allStyleNodes();
  assert.deepEqual(expandAnimationProblems(readHudCss().nodes), [], '要有展開動畫,關閉才有東西可驗');
  assert.deepEqual(reducedMotionProblems(nodes), []);
  assert.deepEqual(jsMotionProblems(), []);
});
