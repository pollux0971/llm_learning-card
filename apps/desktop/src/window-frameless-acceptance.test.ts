/**
 * T16 驗收補測(驗收者寫):main.rs 的「逾時退路」與「載入完才顯示」接線,要看的是**真的接上了**,不是名字出現在檔案裡。
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

  it('arm_show_fallback 的本體:另開執行緒 → 睡 SHOW_FALLBACK → 問 on_timeout → 回 true 才 log::warn! 與 show()', () => {
    const body = fnBody(code, 'arm_show_fallback');
    expect(body, '找不到 fn arm_show_fallback').not.toBe('');
    const at = (re: RegExp): number => body.search(re);
    const spawn = at(/\bthread\s*::\s*spawn\s*\(/);
    const sleep = at(/\bsleep\s*\(\s*(?:\w+\s*::\s*)*SHOW_FALLBACK\s*\)/);
    const timeout = at(/\bon_timeout\s*\(/);
    const warn = at(/\blog\s*::\s*warn\s*!/);
    const show = at(/\.show\s*\(\s*\)/);
    expect([spawn, sleep, timeout, warn, show].every((i) => i >= 0), `缺少:spawn=${spawn} sleep=${sleep} on_timeout=${timeout} warn=${warn} show=${show}`).toBe(true);
    expect(spawn).toBeLessThan(sleep);
    expect(sleep).toBeLessThan(timeout);
    expect(timeout).toBeLessThan(warn);
    expect(timeout).toBeLessThan(show);
    // warn 與 show 要在「on_timeout() 回 true」的 if 區塊裡
    const guard = /\bif\s+[\w.]*on_timeout\s*\(\s*\)\s*\{/.exec(body);
    expect(guard, 'on_timeout 的結果要用 if 判斷,回 false(已經顯示過)時什麼都不做').not.toBeNull();
    const inside = balanced(body, guard!.index, '{', '}');
    expect(inside).toMatch(/\blog\s*::\s*warn\s*!/);
    expect(inside).toMatch(/\.show\s*\(\s*\)/);
  });

  it('on_page_load 的閉包:只在 Finished 處理,問 on_page_finished,回 true 才 show(),而且不寫 warn', () => {
    const at = code.search(/\.on_page_load\s*\(/);
    expect(at, '沒有 .on_page_load(').toBeGreaterThanOrEqual(0);
    const closure = balanced(code, at, '(', ')');
    expect(closure).toMatch(/PageLoadEvent\s*::\s*Finished/);
    const guard = /\bif\s+[\w.]*on_page_finished\s*\(\s*\)\s*\{/.exec(closure);
    expect(guard, 'on_page_finished 的結果要用 if 判斷').not.toBeNull();
    expect(balanced(closure, guard!.index, '{', '}')).toMatch(/\.show\s*\(\s*\)/);
    expect(closure, '載入先完成時不該寫 warn').not.toMatch(/\blog\s*::\s*warn\s*!/);
    expect(closure, '載入完成這條路不該自己計時').not.toMatch(/\bsleep\s*\(/);
  });
});
