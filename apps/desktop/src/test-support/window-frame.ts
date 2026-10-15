/**
 * 10-desktop-shell phase-6(工單 T16)的量尺:視窗設定、權限、頁面那段程式(window_mode.js)、main.rs 與 Cargo 的靜態檢查。
 * 測試 agent 寫;開發 worker 不改。vitest(window-frameless.test.ts)與 cucumber(desktop-shell-phase6.steps.ts)共用。
 *
 * 不 import 14-hud-skin 的任何模組(boundaries):layout.ts 的 class 名字用讀文字的方式取。
 * 所有函式回傳「問題清單」;空 = 通過。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { SRC_TAURI, readTauriConf, type TauriConf } from './frontend-dist.js';

export const CAPABILITY_FILE = join(SRC_TAURI, 'capabilities/default.json');
export const WINDOW_MODE_JS = join(SRC_TAURI, 'src/window_mode.js');
export const WINDOW_MODE_RS = join(SRC_TAURI, 'src/window_mode.rs');
export const MAIN_RS = join(SRC_TAURI, 'src/main.rs');
export const CARGO_TOML = join(SRC_TAURI, 'Cargo.toml');
export const CARGO_LOCK = join(SRC_TAURI, 'Cargo.lock');
const LAYOUT_TS = join(SRC_TAURI, '../../../packages/ui-shared/src/hud/layout.ts');

/** 驗收 2:剛好這六條 */
export const REQUIRED_PERMISSIONS = [
  'core:default', 'window-state:default',
  'core:window:allow-start-dragging', 'core:window:allow-start-resize-dragging',
  'core:window:allow-minimize', 'core:window:allow-close',
] as const;

// ───────────────────────────── 視窗設定(驗收 1)

const CARD_WINDOWS = ['teach', 'test'] as const;

function windowOf(conf: TauriConf, label: string): Record<string, unknown> | undefined {
  return (conf.app?.windows ?? []).find((w) => w.label === label);
}

/** 兩個卡片視窗每個欄位都要是指定的值;沒寫不算(預設值不是我們要的) */
export function windowFlagProblems(conf: TauriConf, key: string, want: boolean, what: string): string[] {
  const problems: string[] = [];
  for (const label of CARD_WINDOWS) {
    const w = windowOf(conf, label);
    if (!w) { problems.push(`tauri.conf.json 沒有 label 是 ${label} 的視窗`); continue; }
    if (w[key] !== want) problems.push(`視窗 ${label} 的 ${key} 是 ${JSON.stringify(w[key] ?? '(沒寫)')},要明寫 ${want}(${what})`);
  }
  return problems;
}
export const decorationsProblems = (conf: TauriConf = readTauriConf()) => windowFlagProblems(conf, 'decorations', false, '沒有系統外框');
export const transparentProblems = (conf: TauriConf = readTauriConf()) => windowFlagProblems(conf, 'transparent', true, '透明視窗');
export const hiddenUntilLoadedProblems = (conf: TauriConf = readTauriConf()) => windowFlagProblems(conf, 'visible', false, '載入完才由 Rust 顯示');

// ───────────────────────────── 權限(驗收 2)

interface Capability { identifier?: string; windows?: unknown; permissions?: unknown }

export function readCapability(path = CAPABILITY_FILE): Capability {
  return JSON.parse(readFileSync(path, 'utf8')) as Capability;
}

/** 權限的集合跟六條相等(不多不少、沒有重複)、windows 照舊 */
export function capabilityProblems(cap: Capability = readCapability()): string[] {
  const problems: string[] = [];
  const perms = Array.isArray(cap.permissions) ? cap.permissions : null;
  if (!perms || perms.some((p) => typeof p !== 'string')) return ['permissions 要是字串陣列'];
  const got = perms as string[];
  for (const p of REQUIRED_PERMISSIONS) if (!got.includes(p)) problems.push(`少了權限 ${p}`);
  for (const p of got) if (!(REQUIRED_PERMISSIONS as readonly string[]).includes(p)) problems.push(`多開了權限 ${p}(只准那六條)`);
  if (new Set(got).size !== got.length) problems.push('permissions 有重複的項目');
  if (got.length !== REQUIRED_PERMISSIONS.length) problems.push(`permissions 有 ${got.length} 條,要剛好 ${REQUIRED_PERMISSIONS.length} 條`);
  const windows = cap.windows;
  if (!Array.isArray(windows) || windows.length !== 2 || windows[0] !== 'teach' || windows[1] !== 'test') {
    problems.push(`windows 要照舊是 ["teach","test"],實際是 ${JSON.stringify(windows)}`);
  }
  return problems;
}

// ───────────────────────────── 14 的 class 名字

/** layout.ts 的 FRAMELESS_CLASS、SOLID_CLASS(讀文字,不 import) */
export function layoutClassNames(): { frameless: string; solid: string } {
  const text = readFileSync(LAYOUT_TS, 'utf8');
  const read = (name: string) => {
    const m = new RegExp(`export const ${name} = '([^']+)'`).exec(text);
    if (!m) throw new Error(`layout.ts 沒有 ${name}`);
    return m[1]!;
  };
  return { frameless: read('FRAMELESS_CLASS'), solid: read('SOLID_CLASS') };
}

// ───────────────────────────── 頁面那段程式(window_mode.js)

export interface RunResult {
  /** 跑完之後根元素的 class(集合) */
  classes: string[];
  /** 對根元素(及 classList)做過的事:除了 classList 之外的任何讀寫都列在這裡 */
  touched: string[];
  threw?: string;
}

export interface Mode { frameless: boolean; solid: boolean }

/** 跟 Rust `init_script` 同一個形狀:先一行賦值,再接 window_mode.js */
export function assembleInitScript(mode: Mode, js: string): string {
  return `window.__LC_WINDOW_MODE__ = ${JSON.stringify(mode)};\n${js}`;
}

/**
 * 在 node:vm 裡跑一份完整的 init script。`document.documentElement` 是會記帳的假根元素:
 * 只准碰 classList 的 add / remove / toggle / contains;別的屬性(style、innerHTML、setAttribute…)讀或寫都記在 touched。
 * root = 'null' 時 documentElement 是 null(WebKit 的 document start 防呆)。
 */
export function runInitScript(script: string, opts: { root?: 'present' | 'null' } = {}): RunResult {
  const classes = new Set<string>();
  const touched: string[] = [];
  const classList = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'add') return (...names: string[]) => { for (const n of names) classes.add(n); };
      if (prop === 'remove') return (...names: string[]) => { for (const n of names) classes.delete(n); };
      if (prop === 'toggle') return (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      };
      if (prop === 'contains') return (name: string) => classes.has(name);
      touched.push(`classList.${String(prop)}`);
      return undefined;
    },
    set(_t, prop) { touched.push(`classList.${String(prop)} = …`); return true; },
  });
  const root = opts.root === 'null' ? null : new Proxy({}, {
    get(_t, prop) {
      if (prop === 'classList') return classList;
      touched.push(`documentElement.${String(prop)}`);
      return undefined;
    },
    set(_t, prop) { touched.push(`documentElement.${String(prop)} = …`); return true; },
  });
  const sandbox: Record<string, unknown> = {};
  sandbox['window'] = sandbox;
  sandbox['document'] = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'documentElement') return root;
      touched.push(`document.${String(prop)}`);
      return undefined;
    },
    set(_t, prop) { touched.push(`document.${String(prop)} = …`); return true; },
  });
  vm.createContext(sandbox);
  let threw: string | undefined;
  try { vm.runInContext(script, sandbox, { timeout: 1000 }); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  return { classes: [...classes].sort(), touched, ...(threw === undefined ? {} : { threw }) };
}

/** 去掉註解再掃(註解可以提到被禁的字) */
function stripComments(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** 禁用清單:不 innerHTML、不插 <style>、不設 style、不 invoke、不等任何非同步的東西、不連外 */
const FORBIDDEN: [RegExp, string][] = [
  [/innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write/, '用 HTML 字串寫進頁面(innerHTML 一類)'],
  [/<\s*style/i, '插 <style>'],
  [/\.\s*style\b|setAttribute|cssText|adoptedStyleSheets|insertRule|createElement/, '設 style 屬性或建立元素'],
  [/\binvoke\b|__TAURI/, '呼叫 Tauri 的 invoke(非同步,會先畫一次錯的)'],
  [/\bawait\b|\basync\b|\bPromise\b|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|\.then\s*\(/, '等非同步的東西'],
  [/addEventListener|DOMContentLoaded|MutationObserver|readyState/, '等事件或等文件狀態'],
  [/\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|\bimport\b|\beval\b|new\s+Function/, '帶外部資料或動態載入'],
];

export function windowModeJsStaticProblems(js: string): string[] {
  const code = stripComments(js);
  const problems: string[] = [];
  if (code.trim().length === 0) return ['window_mode.js 是空的'];
  for (const [re, what] of FORBIDDEN) if (re.test(code)) problems.push(`window_mode.js 不准${what}(${re.source.split('|')[0]}…)`);
  return problems;
}

/**
 * 行為:兩種模式各跑一次,看根元素最後的 class、有沒有碰別的東西、根元素是 null 時不丟錯。
 * frameless 是 false 的組合也跑(Rust 端永遠給 true,但頁面那段只該照值做事)。
 */
export function windowModeJsBehaviourProblems(js: string): string[] {
  const names = layoutClassNames();
  const problems: string[] = [];
  const cases: { mode: Mode; want: string[] }[] = [
    { mode: { frameless: true, solid: false }, want: [names.frameless] },
    { mode: { frameless: true, solid: true }, want: [names.frameless, names.solid] },
    { mode: { frameless: false, solid: false }, want: [] },
    { mode: { frameless: false, solid: true }, want: [names.solid] },
  ];
  for (const { mode, want } of cases) {
    const r = runInitScript(assembleInitScript(mode, js));
    const tag = `frameless=${mode.frameless} solid=${mode.solid}`;
    if (r.threw) { problems.push(`${tag}:丟了錯 ${r.threw}${r.touched.length ? `(丟錯之前碰了 classList 以外的東西:${r.touched.join(', ')})` : ''}`); continue; }
    if (JSON.stringify(r.classes) !== JSON.stringify([...want].sort())) {
      problems.push(`${tag}:根元素的 class 是 [${r.classes.join(', ')}],要是 [${[...want].sort().join(', ')}]`);
    }
    if (r.touched.length > 0) problems.push(`${tag}:碰了 classList 以外的東西:${r.touched.join(', ')}`);
  }
  const nullRoot = runInitScript(assembleInitScript({ frameless: true, solid: true }, js), { root: 'null' });
  if (nullRoot.threw) problems.push(`document.documentElement 是 null 時丟了錯:${nullRoot.threw}(要直接結束,不丟錯)`);
  return problems;
}

export function readWindowModeJs(): string {
  if (!existsSync(WINDOW_MODE_JS)) throw new Error('apps/desktop/src-tauri/src/window_mode.js 不存在');
  return readFileSync(WINDOW_MODE_JS, 'utf8');
}

// ───────────────────────────── Rust 端:真的組出來的 init script(給 cucumber 場景用)

export const EMIT_TIMEOUT_MS = 300_000;

/** 跑 Rust 測試檔裡的 emit_init_script_for_the_scenarios,取回 `init_script(mode_for(composited))` 的全文 */
export function rustInitScript(composited: boolean): string {
  const { NODE_OPTIONS: _drop, ...env } = process.env;
  const r = spawnSync('cargo', ['test', '--test', 'window_mode', 'emit_init_script_for_the_scenarios', '--', '--exact', '--nocapture'], {
    cwd: SRC_TAURI, encoding: 'utf8', timeout: EMIT_TIMEOUT_MS,
    env: { ...env, LC_WINDOW_MODE_COMPOSITED: composited ? '1' : '0' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error || r.status !== 0) throw new Error(`cargo test --test window_mode 失敗 status=${r.status ?? 'error'}\n${out.slice(-2500)}`);
  const m = /LC-INIT-SCRIPT-BEGIN\n([\s\S]*?)\nLC-INIT-SCRIPT-END/.exec(out);
  if (!m) throw new Error(`輸出裡找不到 init script:\n${out.slice(-1500)}`);
  return m[1]!;
}

// ───────────────────────────── main.rs、Cargo(靜態)

/** window-state 外掛的 StateFlags 要拿掉 VISIBLE,不然它在頁面載入之前就把視窗打開(驗收 1 的注意) */
export function stateFlagsProblems(mainRs: string): string[] {
  const code = mainRs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const open = /with_state_flags\s*\(/.exec(code);
  if (!open) return ['main.rs 的 window-state 外掛沒有呼叫 with_state_flags(...)(要拿掉 StateFlags::VISIBLE)'];
  let depth = 1; let i = open.index + open[0].length; const from = i;
  for (; i < code.length && depth > 0; i += 1) { if (code[i] === '(') depth += 1; else if (code[i] === ')') depth -= 1; }
  const arg = code.slice(from, i - 1);
  if (!/VISIBLE/.test(arg)) {
    // 沒提到 VISIBLE:只有明列旗標(不含 all())才算拿掉了
    return /all\s*\(\s*\)/.test(arg) ? ['with_state_flags 用了 StateFlags::all() 卻沒有拿掉 VISIBLE'] : [];
  }
  // 提到 VISIBLE:要在「減掉」的位置
  const removed = /(-|&\s*!|&\s*~|\.remove\s*\(|\.difference\s*\()\s*(?:\w+::)*StateFlags\s*::\s*VISIBLE|!\s*(?:\w+::)*StateFlags\s*::\s*VISIBLE/.test(arg)
    || /\bremove\s*\([^)]*VISIBLE|\bdifference\s*\([^)]*VISIBLE/.test(arg);
  const added = /\|\s*(?:\w+::)*StateFlags\s*::\s*VISIBLE|(?:\w+::)*StateFlags\s*::\s*VISIBLE\s*\|/.test(arg);
  if (added || !removed) return [`with_state_flags(${arg.trim()}) 裡的 VISIBLE 不是被拿掉,而是被加進去或看不出被拿掉`];
  return [];
}

/** main.rs 接線(名字由測試檔的 Rust 端固定:ShowGate、SHOW_FALLBACK、on_page_finished、on_timeout) */
export function mainRsProblems(mainRs: string): string[] {
  const code = mainRs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const need: [RegExp, string][] = [
    [/\bis_composited\s*\(/, '沒有問 GDK 有沒有合成器(Screen::is_composited)'],
    [/\binitialization_script\s*\(/, '沒有用 initialization_script 把模式交給頁面'],
    [/\binit_script\s*\(/, '沒有用 window_mode::init_script 組那段程式'],
    [/\bmode_for\s*\(/, '沒有用 window_mode::mode_for 決定模式'],
    [/PageLoadEvent\s*::\s*Finished/, '沒有在 page load 的 Finished 時處理'],
    [/\bShowGate\b/, '沒有用 ShowGate 管「只顯示一次」'],
    [/\bon_page_finished\s*\(/, 'Finished 時沒有呼叫 on_page_finished'],
    [/\bon_timeout\s*\(/, '沒有另開計時、到時呼叫 on_timeout'],
    [/\bSHOW_FALLBACK\b/, '計時沒有用 SHOW_FALLBACK(3 秒)'],
    [/log\s*::\s*warn\s*!/, '逾時顯示時沒有寫 log::warn!'],
    [/\.show\s*\(\s*\)/, '沒有呼叫視窗的 show()'],
  ];
  const problems = need.filter(([re]) => !re.test(code)).map(([, what]) => `main.rs:${what}`);
  problems.push(...stateFlagsProblems(mainRs));
  return problems;
}

/** 置頂、setup 視窗照舊(驗收 1 的最後兩條不退步) */
export function mainRsUnchangedProblems(mainRs: string): string[] {
  const problems: string[] = [];
  if (!/set_always_on_top\s*\(\s*true\s*\)/.test(mainRs)) problems.push('main.rs 不再呼叫 set_always_on_top(true)(置頂要照舊)');
  if (!/Focused\s*\(\s*true\s*\)/.test(mainRs)) problems.push('main.rs 不再處理 Focused(true)(拿到焦點時再置頂一次)');
  const setup = /WebviewWindowBuilder::new\s*\(\s*app\s*,\s*start_screen::WINDOW_LABEL[\s\S]*?\.build\s*\(\s*\)/.exec(mainRs)?.[0] ?? '';
  if (!setup) problems.push('main.rs 找不到 setup 視窗的建立(start_screen::WINDOW_LABEL)');
  else if (/decorations\s*\(\s*false\s*\)|transparent\s*\(\s*true\s*\)|initialization_script/.test(setup)) problems.push('setup 視窗(啟動失敗的畫面)被改成無框/透明/帶模式了:它不改,照舊有系統外框');
  return problems;
}

/** gdk 是直接依賴,而且 lock 裡只有一份(版本 0.18.2) */
export function gdkDependencyProblems(toml: string, lock: string): string[] {
  const problems: string[] = [];
  const deps = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(toml)?.[1] ?? '';
  const targetDeps = [...toml.matchAll(/\[target\.[^\]]*dependencies\]([\s\S]*?)(?:\n\[|$)/g)].map((m) => m[1] ?? '').join('\n');
  const direct = /^\s*(gdk|gtk)\s*=/m.test(deps) || /^\s*(gdk|gtk)\s*=/m.test(targetDeps);
  if (!direct) problems.push('Cargo.toml 沒有直接依賴 gdk(或 gtk)');
  const versions = [...lock.matchAll(/\[\[package\]\]\nname = "gdk"\nversion = "([^"]+)"/g)].map((m) => m[1]);
  if (versions.length !== 1) problems.push(`Cargo.lock 裡有 ${versions.length} 份 gdk(${versions.join(', ')}),要剛好一份`);
  else if (versions[0] !== '0.18.2') problems.push(`Cargo.lock 的 gdk 是 ${versions[0]},要維持 0.18.2`);
  const line = /^\s*(?:gdk|gtk)\s*=\s*(.+)$/m.exec(`${deps}\n${targetDeps}`)?.[1] ?? '';
  const spec = /"([^"]+)"/.exec(line)?.[1] ?? /version\s*=\s*"([^"]+)"/.exec(line)?.[1] ?? '';
  if (direct && spec && !/^[=^~]?\s*0\.18(\.2)?$/.test(spec)) problems.push(`Cargo.toml 的 gdk 版本寫 "${spec}",要跟 lock 的 0.18.2 同一個(寫 "0.18" 或 "0.18.2")`);
  return problems;
}
