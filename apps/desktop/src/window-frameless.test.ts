/**
 * 10-desktop-shell phase-6(工單 T16)的 vitest:視窗設定、權限、頁面那段程式、main.rs 與 Cargo 的靜態檢查、不退步。
 * 測試 agent 寫;開發 worker 不改。量尺在 test-support/window-frame.ts(cucumber 的 desktop-shell-phase6.steps.ts 共用)。
 *
 * 自測用的片段一律是最小的合成片段(一兩行、每一條只為了讓量尺的某一個判斷出聲),不放可以直接抄的完整實作。
 * 合成器偵測(GDK)沒有自動測試,靠 @manual 的 Xvfb 有 / 沒有 xcompmgr。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTauriConf } from './test-support/frontend-dist.js';
import {
  CARGO_LOCK, CARGO_TOML, MAIN_RS, REQUIRED_PERMISSIONS, assembleInitScript, capabilityProblems, decorationsProblems, gdkDependencyProblems,
  hiddenUntilLoadedProblems, layoutClassNames, mainRsProblems, mainRsUnchangedProblems, readCapability, readWindowModeJs, runInitScript, stateFlagsProblems,
  transparentProblems, windowModeJsBehaviourProblems, windowModeJsStaticProblems,
} from './test-support/window-frame.js';

const REPO = join(import.meta.dirname, '../../..');

describe('兩個視窗的設定(驗收 1、場景 1)', () => {
  it('兩個視窗都沒有系統外框:decorations 明寫 false', () => {
    expect(decorationsProblems()).toEqual([]);
  });
  it('兩個視窗都透明:transparent 明寫 true', () => {
    expect(transparentProblems()).toEqual([]);
  });
  it('兩個視窗都先藏起來:visible 明寫 false,載入完才由 Rust 顯示', () => {
    expect(hiddenUntilLoadedProblems()).toEqual([]);
  });
  it('setup 視窗(啟動失敗的畫面)不在設定檔裡,仍由 main.rs 動態建立、不改', () => {
    const labels = (readTauriConf().app?.windows ?? []).map((w) => w.label).sort();
    expect(labels).toEqual(['teach', 'test']);
    expect(mainRsUnchangedProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
  it('window-state 外掛的 StateFlags 拿掉 VISIBLE(不然它在頁面載入前就把視窗打開)', () => {
    expect(stateFlagsProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
});

describe('權限剛好六條(驗收 2、場景 2)', () => {
  it('permissions 跟那六條集合相等、沒有重複,windows 仍是 teach 與 test', () => {
    expect(capabilityProblems()).toEqual([]);
  });
  it('六條裡有開始拖曳、開始縮放拖曳、縮小、關閉', () => {
    const got = readCapability().permissions as string[];
    for (const p of ['core:window:allow-start-dragging', 'core:window:allow-start-resize-dragging', 'core:window:allow-minimize', 'core:window:allow-close']) {
      expect(got, p).toContain(p);
    }
    expect(REQUIRED_PERMISSIONS).toHaveLength(6);
  });
});

describe('頁面那段程式 window_mode.js(驗收 3、場景 3 與 Scenario Outline)', () => {
  it('class 名字跟 14 的 layout.ts 一樣(hud-frameless、hud-solid),不是自己寫一份', () => {
    const names = layoutClassNames();
    expect(names).toEqual({ frameless: 'hud-frameless', solid: 'hud-solid' });
    const js = readWindowModeJs();
    expect(js).toContain(names.frameless);
    expect(js).toContain(names.solid);
  });
  it('有合成器:根元素只有 hud-frameless;沒有合成器:hud-frameless 與 hud-solid;不碰 classList 以外的東西;根元素是 null 不丟錯', () => {
    expect(windowModeJsBehaviourProblems(readWindowModeJs())).toEqual([]);
  });
  it('靜態:不用 innerHTML、不插 <style>、不設 style 屬性、不呼叫 invoke、不等任何非同步、不帶外部資料', () => {
    expect(windowModeJsStaticProblems(readWindowModeJs())).toEqual([]);
  });
  it('跟 Rust 組出來的那一行接起來之後也成立(兩行格式:先賦值,再接這個檔)', () => {
    const r = runInitScript(assembleInitScript({ frameless: true, solid: false }, readWindowModeJs()));
    expect(r.threw).toBeUndefined();
    expect(r.classes).toEqual(['hud-frameless']);
  });
});

describe('量尺自測:壞的頁面程式會被抓到(最小合成片段)', () => {
  const mode = { frameless: true, solid: false };
  const classesOf = (js: string) => runInitScript(assembleInitScript(mode, js)).classes;

  it('不論模式都加 solid → 行為檢查紅', () => {
    expect(windowModeJsBehaviourProblems(`document.documentElement.classList.add('hud-frameless', 'hud-solid');`).join('\n')).toMatch(/solid=false/);
  });
  it('class 名字寫錯字 → 行為檢查紅', () => {
    expect(windowModeJsBehaviourProblems(`document.documentElement.classList.add('hud-frame-less');`).join('\n')).toMatch(/要是 \[hud-frameless\]/);
  });
  it('根元素是 null 時丟錯 → 行為檢查紅', () => {
    expect(windowModeJsBehaviourProblems(`document.documentElement.classList.add('hud-frameless');`).join('\n')).toMatch(/null 時丟了錯/);
  });
  it('設 style 屬性 → 行為檢查與靜態檢查都紅', () => {
    const js = `document.documentElement.style.background = 'red';`;
    expect(windowModeJsBehaviourProblems(js).join('\n')).toMatch(/碰了 classList 以外的東西:documentElement\.style/);
    expect(windowModeJsStaticProblems(js).join('\n')).toMatch(/style/);
  });
  it('靜態檢查逐項抓得到', () => {
    for (const bad of ['a.innerHTML = 1;', "x('<style>');", 'a.setAttribute("x","y");', 'invoke("m");', 'await z;', 'setTimeout(f, 0);', 'fetch("u");', "addEventListener('x', f);"]) {
      expect(windowModeJsStaticProblems(bad), bad).not.toEqual([]);
    }
  });
  it('註解裡提到被禁的字不算', () => {
    expect(windowModeJsStaticProblems('// 不用 innerHTML\n/* invoke 也不用 */\nvoid 0;')).toEqual([]);
  });
  it('跑的是 window.__LC_WINDOW_MODE__ 的值:給 solid 才出現 solid', () => {
    const js = `if (window.__LC_WINDOW_MODE__.solid) document.documentElement.classList.add('s');`;
    expect(classesOf(js)).toEqual([]);
    expect(runInitScript(assembleInitScript({ frameless: true, solid: true }, js)).classes).toEqual(['s']);
  });
});

describe('main.rs 的接線(靜態;驗收 1、3)', () => {
  it('問 GDK、用 initialization_script、page load 的 Finished 與另開的計時各呼叫 ShowGate,逾時寫 warn', () => {
    expect(mainRsProblems(readFileSync(MAIN_RS, 'utf8'))).toEqual([]);
  });
  it('StateFlags 檢查抓得到:沒呼叫、用 all()、把 VISIBLE 加進去', () => {
    expect(stateFlagsProblems('Builder::default().build()')).not.toEqual([]);
    expect(stateFlagsProblems('Builder::default().with_state_flags(StateFlags::all()).build()')).not.toEqual([]);
    expect(stateFlagsProblems('x.with_state_flags(StateFlags::SIZE | StateFlags::VISIBLE).build()')).not.toEqual([]);
    expect(stateFlagsProblems('x.with_state_flags(StateFlags::all() - StateFlags::VISIBLE).build()')).toEqual([]);
    expect(stateFlagsProblems('x.with_state_flags(StateFlags::SIZE | StateFlags::POSITION).build()')).toEqual([]);
  });
});

describe('Cargo:gdk 是直接依賴、lock 裡不多出第二份(驗收 3)', () => {
  it('Cargo.toml 直接依賴 gdk(或 gtk),Cargo.lock 的 gdk 仍是唯一一份 0.18.2', () => {
    expect(gdkDependencyProblems(readFileSync(CARGO_TOML, 'utf8'), readFileSync(CARGO_LOCK, 'utf8'))).toEqual([]);
  });
  it('檢查抓得到:沒直接依賴、兩份 gdk、版本不同', () => {
    const lock = '[[package]]\nname = "gdk"\nversion = "0.18.2"\n';
    expect(gdkDependencyProblems('[dependencies]\nlog = "0.4"\n', lock).join('\n')).toMatch(/沒有直接依賴/);
    expect(gdkDependencyProblems('[dependencies]\ngdk = "0.18"\n', `${lock}\n[[package]]\nname = "gdk"\nversion = "0.19.0"\n`).join('\n')).toMatch(/2 份/);
    expect(gdkDependencyProblems('[dependencies]\ngdk = "0.19"\n', lock).join('\n')).toMatch(/同一個/);
    expect(gdkDependencyProblems('[dependencies]\ngdk = "0.18"\n', lock)).toEqual([]);
  });
});

describe('不退步:done phase 的 .feature 沒改(驗收 10)', () => {
  // 雜湊是基底(t16-base)時的內容。10 phase-6 的 .feature 工單說「不改」。
  const PINNED: [string, string][] = [
    ['features/10-desktop-shell/phase-1.feature', '39b0cf091a2309fc12033471652ba3d9389652e2f38900ebf9b3192612290f66'],
    ['features/10-desktop-shell/phase-2.feature', '73c22987e9565f1893a97b9f2fe8bd71dcdb56b7724e86638572e81d04fab505'],
    ['features/10-desktop-shell/phase-6.feature', '1740f3361559555f1574344a7e1d351332b1b445e08e36f4f105726acb4af281'],
    ['features/14-hud-skin/phase-1.feature', '7bddbc8f67fb626a39770a403af365b508ed65ece345cd23fcdc2e178659633a'],
    ['features/14-hud-skin/phase-2.feature', 'fd79522575336c324bef608e47a8ce790c3f7d53422b7c3cb4fc1255409cccd4'],
  ];
  it.each(PINNED)('%s 內容沒變', (file, sha) => {
    expect(createHash('sha256').update(readFileSync(join(REPO, file))).digest('hex')).toBe(sha);
  });
});
