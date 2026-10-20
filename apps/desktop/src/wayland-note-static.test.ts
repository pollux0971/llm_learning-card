/**
 * 10-desktop-shell(工單 T34 B)Wayland 一次性提示的靜態檢查:提示程式的原始碼、main.rs 的接法、頁面 CSP。
 * 測試 agent 寫;開發 worker 不改。行為由真 Chrome(packages/ui-shared/src/hud/card-render-wayland-note.test.ts)與
 * Rust(src-tauri/tests/wayland_note.rs)量;這裡只擋那些「執行起來看不出來」的寫法。
 *
 * 自測用的片段一律是最小的合成片段(一兩行),不放可以直接抄的完整實作。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAIN_RS, rustFnBody, stripRustComments } from './test-support/window-frame.js';

const REPO = join(import.meta.dirname, '../../..');
export const WAYLAND_NOTE_JS = join(REPO, 'apps/desktop/src-tauri/src/wayland_note.js');
const TAURI_CONF = join(REPO, 'apps/desktop/src-tauri/tauri.conf.json');
const NOTE_TEXT = 'Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。';
const STORAGE_KEY = 'lc-wayland-note-dismissed';

/** 去掉 // 行註解與 /* *\/ 區塊註解(字串裡的 // 如 http:// 不動) */
export function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** 提示程式的靜態問題;回傳每一條的說明,空 = 通過 */
export function noteScriptProblems(src: string): string[] {
  const code = stripJsComments(src);
  const problems: string[] = [];
  if (!code.includes(NOTE_TEXT)) problems.push('沒有提示的字樣');
  if (!code.includes('知道了')) problems.push('沒有「知道了」鍵的字');
  if (!code.includes(STORAGE_KEY)) problems.push(`沒有 localStorage 的鍵 ${STORAGE_KEY}`);
  if (!/\bDOMContentLoaded\b|\breadyState\b/.test(code)) problems.push('沒有等頁面載入(DOMContentLoaded / readyState):document start 時還沒有 body');
  if (/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b/.test(code)) problems.push('用了 innerHTML / outerHTML / insertAdjacentHTML / document.write(CSP 擋行內樣式,而且是 XSS 的洞)');
  if (/setAttribute\(\s*['"`]style['"`]/.test(code)) problems.push("用 setAttribute('style', …) 設樣式(CSP 擋 style 屬性)");
  if (/\bstyle\s*=\s*["'`\\]/.test(code) || /<\s*style\b/i.test(code)) problems.push('字串裡有 style="…" 或 <style>');
  if (/createElement\(\s*['"`]style['"`]\s*\)/.test(code)) problems.push('建了 <style> 元素(CSP 的 style-src 沒有 unsafe-inline)');
  if (/#[0-9a-fA-F]{3,8}\b/.test(code)) problems.push('寫死了十六進位色碼(顏色只能用 var(--hud-*))');
  if (/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/i.test(code)) problems.push('寫死了函式寫法的顏色(rgb( / hsl( / color-mix( …)');
  const vars = [...code.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!);
  for (const v of vars) if (!v.startsWith('--hud-')) problems.push(`用了不是 --hud-* 的變數 ${v}`);
  if (/\b(?:fetch|XMLHttpRequest|invoke|__TAURI__|eval)\b|new\s+Function\b/.test(code)) problems.push('提示程式不該碰網路、invoke、eval');
  return problems;
}

/** main.rs 的接法問題 */
export function mainRsNoteProblems(mainRs: string): string[] {
  const src = stripRustComments(mainRs);
  const problems: string[] = [];
  if (/__lcShowWaylandNote/.test(src)) problems.push('main.rs 還在叫 window.__lcShowWaylandNote(placeholder 的做法,真前端沒有載入它)');
  if (/\.eval\s*\(/.test(src)) problems.push('main.rs 還有 .eval(…):build() 之後馬上 eval 會比頁面載入早,提示改走 initialization_script');
  const assigned = /\blet\s+(?:mut\s+)?(\w+)\s*=\s*(?:window_mode::)?with_wayland_note\s*\(/.exec(src)?.[1];
  if (!assigned) problems.push('main.rs 沒有 let <變數> = window_mode::with_wayland_note(…)');
  else if (!new RegExp(`\\.initialization_script\\(\\s*${assigned}\\b`).test(src)) problems.push(`with_wayland_note 的結果(${assigned})沒有交給 .initialization_script`);
  if (!/\bsession_actions\s*\(/.test(src)) problems.push('main.rs 沒有用 window_mode::session_actions 決定要不要置頂');
  if (!/\bsession::detect_from_env\s*\(/.test(src)) problems.push('main.rs 沒有用 session::detect_from_env()(10 phase-1 的偵測規則不改)');
  if (!/set_always_on_top\s*\(\s*true\s*\)/.test(src)) problems.push('X11 的 set_always_on_top(true) 不見了(置頂要照舊)');
  // Wayland 底下不呼叫 set_always_on_top:每個含 set_always_on_top 的函式,要嘛有 always_on_top 的判斷,要嘛 Wayland 那一支裡沒有
  for (const name of [...src.matchAll(/\bfn\s+(\w+)/g)].map((m) => m[1]!)) {
    const body = rustFnBody(src, name);
    if (body === undefined || !/set_always_on_top/.test(body)) continue;
    const guarded = /\.always_on_top\b/.test(body);
    const wayland = body.indexOf('SessionType::Wayland');
    const waylandArm = wayland === -1 ? '' : body.slice(wayland);
    if (!guarded && /set_always_on_top/.test(waylandArm)) problems.push(`${name}:Wayland 那一支還呼叫 set_always_on_top`);
    if (!guarded && wayland === -1) problems.push(`${name}:呼叫 set_always_on_top 卻沒有依 session 判斷(要看 session_actions(...).always_on_top)`);
  }
  return problems;
}

describe('wayland_note.js 的原始碼(驗收 B5)', () => {
  it('檔案存在(Rust 用 include_str! 帶進頁面)', () => {
    expect(existsSync(WAYLAND_NOTE_JS), 'apps/desktop/src-tauri/src/wayland_note.js 不存在').toBe(true);
  });
  it('字樣、鍵名、等頁面載入;沒有 innerHTML、style 屬性、<style>、寫死的顏色、非 --hud-* 的變數、網路或 eval', () => {
    expect(noteScriptProblems(readFileSync(WAYLAND_NOTE_JS, 'utf8'))).toEqual([]);
  });
});

describe('main.rs 的接法(驗收 B1、B3)', () => {
  it('提示走 initialization_script(with_wayland_note),不再 build() 之後 eval;置頂由 session_actions 決定,Wayland 不呼叫 set_always_on_top', () => {
    expect(mainRsNoteProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
});

describe('頁面的 CSP 沒變(量尺的前提)', () => {
  it("tauri.conf.json 的 csp 仍以 `default-src 'self'; script-src 'self'` 開頭,沒有 unsafe-inline", () => {
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8')) as { app?: { security?: { csp?: string } } };
    const csp = conf.app?.security?.csp ?? '';
    expect(csp.startsWith("default-src 'self'; script-src 'self'")).toBe(true);
    expect(csp).not.toContain('unsafe-inline');
  });
});

describe('量尺自測:壞的提示程式會被抓到(最小合成片段)', () => {
  const good = `var KEY = '${STORAGE_KEY}'; document.addEventListener('DOMContentLoaded', function () { t.textContent = '${NOTE_TEXT}'; b.textContent = '知道了'; t.style.color = 'var(--hud-text)'; });`;
  it('合成的好片段沒有問題(量尺不誤殺)', () => {
    expect(noteScriptProblems(good)).toEqual([]);
  });
  const bad: [string, string, RegExp][] = [
    ['innerHTML', `${good} n.innerHTML = '<b>x</b>';`, /innerHTML/],
    ['setAttribute style', `${good} n.setAttribute('style', 'color:red');`, /setAttribute\('style'/],
    ['字串裡的 style 屬性', `${good} var h = '<div style="x:y">';`, /style="…"/],
    ['建 <style> 元素', `${good} document.createElement('style');`, /<style>/],
    ['十六進位色碼', `${good} t.style.color = '#e87820';`, /十六進位/],
    ['rgb( 色', `${good} t.style.color = 'rgb(1,2,3)';`, /函式寫法的顏色/],
    ['非 --hud 的變數', `${good} t.style.color = 'var(--my-color)';`, /--my-color/],
    ['不等頁面載入', `var KEY = '${STORAGE_KEY}'; t.textContent = '${NOTE_TEXT}'; b.textContent = '知道了';`, /等頁面載入/],
    ['缺鍵名', good.replace(STORAGE_KEY, 'other-key'), /localStorage 的鍵/],
    ['碰 invoke', `${good} invoke('x');`, /invoke/],
    ['註解裡的 innerHTML 不算', `${good} // 不要用 innerHTML\n/* style="x" */`, /^$/],
  ];
  for (const [name, src, want] of bad) {
    it(`抓得到:${name}`, () => {
      const got = noteScriptProblems(src).join('\n');
      if (name.endsWith('不算')) expect(got).toBe('');
      else expect(got).toMatch(want);
    });
  }
});

describe('量尺自測:main.rs 的壞接法會被抓到(最小合成片段)', () => {
  const ok = `fn x(window: &W) { let script = window_mode::with_wayland_note(window_mode::init_script(mode), session); b.initialization_script(script.clone()); let a = window_mode::session_actions(session); if a.always_on_top { w.set_always_on_top(true); } }
let session = session::detect_from_env();`;
  it('合成的好接法沒有問題', () => {
    expect(mainRsNoteProblems(ok)).toEqual([]);
  });
  it('還在 eval 提示函式 → 抓得到', () => {
    expect(mainRsNoteProblems(`${ok}\nfn y(w: &W) { w.eval("window.__lcShowWaylandNote && window.__lcShowWaylandNote();"); }`).join('\n')).toMatch(/__lcShowWaylandNote/);
  });
  it('with_wayland_note 的結果沒有交給 initialization_script → 抓得到', () => {
    expect(mainRsNoteProblems(ok.replace('initialization_script(script.clone())', 'initialization_script(other)')).join('\n')).toMatch(/沒有交給/);
  });
  it('Wayland 那一支呼叫 set_always_on_top → 抓得到', () => {
    const wrong = `fn x(w: &W, session: SessionType) { match session { SessionType::X11 => { w.set_always_on_top(true); } SessionType::Wayland => { w.set_always_on_top(true); } } }
let script = window_mode::with_wayland_note(s, session); b.initialization_script(script); window_mode::session_actions(session); session::detect_from_env();`;
    expect(mainRsNoteProblems(wrong).join('\n')).toMatch(/Wayland 那一支/);
  });
  it('X11 的 set_always_on_top(true) 拿掉 → 抓得到', () => {
    expect(mainRsNoteProblems(ok.replace('w.set_always_on_top(true);', '')).join('\n')).toMatch(/置頂要照舊/);
  });
});
