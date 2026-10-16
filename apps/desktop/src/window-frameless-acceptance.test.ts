/**
 * T16 驗收補測(驗收者寫;T21 第 3 輪改成新規格的等價斷言,見下面的說明):main.rs 的「逾時退路」與「載入完才顯示」接線,要看的是**真的接上了**,不是名字出現在檔案裡。
 *
 * 缺口:window-frameless.test.ts 的 mainRsProblems 只檢查標記字串在 main.rs 任何地方出現過一次。
 * 驗收時把 `arm_show_fallback(&window, gate);` 那一行(真正啟動 3 秒計時的呼叫)拿掉,函式定義還在、
 * 標記都還在,測試全綠——但頁面一直不完成載入時視窗就永遠不顯示(工單 must_catch 第 4 條)。
 *
 * 這裡把 main.rs 去掉註解後,取出三段來各自查:
 *   1. open_windows 裡真的呼叫了 arm_show_fallback(不是只有定義);
 *   2. arm_show_fallback 的本體:另開執行緒、先睡 SHOW_FALLBACK、再問 on_timeout,回 true 才 warn 與 show;
 *   3. on_page_load 的閉包:只處理 Finished、問 on_page_finished,回 true 才 show,不寫 warn。
 * 不啟動視窗、不計時;跟 ShowGate 的單元測試(tests/window_mode.rs)互補。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN_RS = join(import.meta.dirname, '../src-tauri/src/main.rs');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 從 `open` 所在位置之後的第一個左大括號/左括號開始,配對到對應的右邊;回傳裡面的文字。 */
function balanced(code: string, from: number, open: string, close: string): string {
  const start = code.indexOf(open, from);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === open) depth += 1;
    else if (code[i] === close) {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, i);
    }
  }
  return '';
}

function fnBody(code: string, name: string): string {
  const at = code.search(new RegExp(`\\bfn\\s+${name}\\b`));
  if (at < 0) return '';
  const sigEnd = code.indexOf('{', at);
  return balanced(code, sigEnd, '{', '}');
}

const code = stripComments(readFileSync(MAIN_RS, 'utf8'));

describe('main.rs 的顯示接線(工單 must_catch:拿掉 3 秒逾時退路必須紅)', () => {
  it('open_windows 真的呼叫 arm_show_fallback(不是只有定義),而且在建窗(.build())之後', () => {
    const body = fnBody(code, 'open_windows');
    expect(body, '找不到 fn open_windows').not.toBe('');
    const call = /\barm_show_fallback\s*\(/.exec(body);
    expect(call, 'open_windows 沒有呼叫 arm_show_fallback:頁面一直不完成載入時視窗永遠不會顯示').not.toBeNull();
    const build = body.search(/\.build\s*\(\s*\)\s*\?/);
    expect(build).toBeGreaterThanOrEqual(0);
    expect(call!.index, '計時要在視窗建好之後才啟動').toBeGreaterThan(build);
  });

  // ───────── T21 第 3 輪(顧問批准的新規格)取代 T16 驗收寫的兩條舊斷言 ─────────
  // 舊規格:退路與載入完成兩處**直接** `.show()`。新規格:那兩處只准問 StartupFocus::on_ready,
  // 把回來的動作交給 run_startup_actions;視窗的 show / set_focus 全檔各只在 run_startup_actions 一處。
  // 這不是放寬:同樣釘住「順序(spawn → sleep → on_timeout → 回 true 才 warn → 交動作)」、
  // 「on_page_finished 回 true 才動作」、「載入先完成不寫 warn、不計時」,另外多釘「那兩處不准自己 .show()」。

  it('arm_show_fallback 的本體:另開執行緒 → 睡 SHOW_FALLBACK → 問 on_timeout → 回 true 才 log::warn! 再 on_ready、run_startup_actions;自己不 .show()', () => {
    const body = fnBody(code, 'arm_show_fallback');
    expect(body, '找不到 fn arm_show_fallback').not.toBe('');
    const at = (re: RegExp): number => body.search(re);
    const spawn = at(/\bthread\s*::\s*spawn\s*\(/);
    const sleep = at(/\bsleep\s*\(\s*(?:\w+\s*::\s*)*SHOW_FALLBACK\s*\)/);
    const timeout = at(/\bon_timeout\s*\(/);
    const warn = at(/\blog\s*::\s*warn\s*!/);
    const ready = at(/\bon_ready\s*\(/);
    const run = at(/\brun_startup_actions\s*\(/);
    expect([spawn, sleep, timeout, warn, ready, run].every((i) => i >= 0), `缺少:spawn=${spawn} sleep=${sleep} on_timeout=${timeout} warn=${warn} on_ready=${ready} run_startup_actions=${run}`).toBe(true);
    expect(spawn).toBeLessThan(sleep);
    expect(sleep).toBeLessThan(timeout);
    expect(timeout).toBeLessThan(warn);
    expect(warn).toBeLessThan(ready);
    expect(ready).toBeLessThan(run);
    expect(body, '退路不准自己 show():顯不顯示由 on_ready 回的動作決定').not.toMatch(/\.show\s*\(\s*\)/);
    expect(body, '退路不准自己 set_focus()').not.toMatch(/\.set_focus\s*\(\s*\)/);
    const guard = /\bif\s+[\w.]*on_timeout\s*\(\s*\)\s*\{/.exec(body);
    expect(guard, 'on_timeout 的結果要用 if 判斷,回 false(已經準備過)時什麼都不做').not.toBeNull();
    const inside = balanced(body, guard!.index, '{', '}');
    expect(inside).toMatch(/\blog\s*::\s*warn\s*!/);
    expect(inside).toMatch(/\bon_ready\s*\(/);
    expect(inside).toMatch(/\brun_startup_actions\s*\(/);
  });

  it('on_page_load 的閉包:只在 Finished 處理,問 on_page_finished,回 true 才 on_ready 並交給 run_startup_actions;自己不 .show()、不寫 warn、不計時', () => {
    const at = code.search(/\.on_page_load\s*\(/);
    expect(at, '沒有 .on_page_load(').toBeGreaterThanOrEqual(0);
    const closure = balanced(code, at, '(', ')');
    expect(closure).toMatch(/PageLoadEvent\s*::\s*Finished/);
    const guard = /\bif\s+[\w.]*on_page_finished\s*\(\s*\)\s*\{/.exec(closure);
    expect(guard, 'on_page_finished 的結果要用 if 判斷').not.toBeNull();
    const inside = balanced(closure, guard!.index, '{', '}');
    const ready = inside.search(/\bon_ready\s*\(/);
    const run = inside.search(/\brun_startup_actions\s*\(/);
    expect(ready, 'Finished 且 ShowGate 回 true 時要問 on_ready').toBeGreaterThanOrEqual(0);
    expect(run, '要把 on_ready 回的動作交給 run_startup_actions').toBeGreaterThan(ready);
    expect(closure, '載入完成那條路不准自己 show()').not.toMatch(/\.show\s*\(\s*\)/);
    expect(closure, '載入先完成時不該寫 warn').not.toMatch(/\blog\s*::\s*warn\s*!/);
    expect(closure, '載入完成這條路不該自己計時').not.toMatch(/\bsleep\s*\(/);
  });

  it('視窗的 show() 與 set_focus() 全檔各只出現一次,而且都在 run_startup_actions 裡', () => {
    const shows = code.match(/\.show\s*\(\s*\)/g) ?? [];
    const focuses = code.match(/\.set_focus\s*\(\s*\)/g) ?? [];
    expect(shows, 'main.rs 的 .show() 只准在 run_startup_actions 一處').toHaveLength(1);
    expect(focuses, 'main.rs 的 .set_focus() 只准在 run_startup_actions 一處').toHaveLength(1);
    const run = fnBody(code, 'run_startup_actions');
    expect(run, '找不到 fn run_startup_actions').not.toBe('');
    expect(run).toMatch(/\.show\s*\(\s*\)/);
    expect(run).toMatch(/\.set_focus\s*\(\s*\)/);
  });

  it('順序退路 arm_order_backstop:另開執行緒 → 睡 ORDER_BACKSTOP → on_backstop → 有動作才 log::warn! 再 run_startup_actions;open_windows 真的呼叫它', () => {
    const body = fnBody(code, 'arm_order_backstop');
    expect(body, '找不到 fn arm_order_backstop').not.toBe('');
    const at = (re: RegExp): number => body.search(re);
    const spawn = at(/\bthread\s*::\s*spawn\s*\(/);
    const sleep = at(/\bsleep\s*\(\s*(?:\w+\s*::\s*)*ORDER_BACKSTOP\s*\)/);
    const backstop = at(/\bon_backstop\s*\(/);
    const warn = at(/\blog\s*::\s*warn\s*!/);
    const run = at(/\brun_startup_actions\s*\(/);
    expect([spawn, sleep, backstop, warn, run].every((i) => i >= 0), `缺少:spawn=${spawn} sleep=${sleep} on_backstop=${backstop} warn=${warn} run=${run}`).toBe(true);
    expect(spawn).toBeLessThan(sleep);
    expect(sleep).toBeLessThan(backstop);
    expect(backstop).toBeLessThan(warn);
    expect(warn).toBeLessThan(run);
    const guard = /\bif\s+!\s*actions\s*\.\s*is_empty\s*\(\s*\)\s*\{/.exec(body);
    expect(guard, '要先看有沒有動作(沒有就什麼都不做、不寫 warn)').not.toBeNull();
    const inside = balanced(body, guard!.index, '{', '}');
    expect(inside).toMatch(/\blog\s*::\s*warn\s*!/);
    expect(inside).toMatch(/\brun_startup_actions\s*\(/);
    expect(body, '順序退路不准自己 show()').not.toMatch(/\.show\s*\(\s*\)/);
    expect(fnBody(code, 'open_windows'), 'open_windows 沒有呼叫 arm_order_backstop:教學卡一直不出現時考試卡永遠不顯示').toMatch(/\barm_order_backstop\s*\(/);
  });
});
