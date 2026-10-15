/**
 * 14-hud-skin phase-2(工單 T15)紅測試用的數值,集中在這一個檔。
 * 測試 agent 寫;開發 worker 不改。
 *
 * 其中三組是前端(規格作者)依 FEATURE.md 設計值與使用者選的 A 自訂的,技術顧問 2026-10-16 審過同意;
 * 之後要改,只改這裡:
 *   1. 送出鍵出現的時機(SUBMIT_HIDDEN_AFTER_RESULT)
 *   2. 面板撐滿卡片視窗(PANEL_FILLS_WINDOW、PANEL_FILL_TOLERANCE_PX)
 *   3. --hud-pass / --hud-fail 的對比下限(PASS_FAIL_MIN_CONTRAST)與對錯字樣(RESULT_TEXT)
 *
 * 這個檔不 import 任何卡片(06、07)的模組:hud/ 對 06、07 沒有 import 例外(boundaries 只開 06→14、07→14)。
 */
import { join } from 'node:path';
import { REPO_ROOT } from './test-support.js';

/** `tauri.conf.json` 的預設視窗大小 */
export const CARD_VIEWPORT = { width: 360, height: 480 } as const;

export const TEACH_CARD_DIR = join(REPO_ROOT, 'apps/teach-card');
export const TEST_CARD_DIR = join(REPO_ROOT, 'apps/test-card');
export type CardName = 'teach-card' | 'test-card';
export const CARD_DIRS: Record<CardName, string> = { 'teach-card': TEACH_CARD_DIR, 'test-card': TEST_CARD_DIR };

/** 兩張卡的視窗標題(HudPanel 的 title) */
export const CARD_TITLES: Record<CardName, string> = { 'teach-card': '教學卡', 'test-card': '考試卡' };

// ── 設計值 1:送出鍵 ────────────────────────────────────────────────────────
export const SUBMIT_LABEL = '送出';
export const NEXT_LABEL = '下一題';
/** 看到評分結果之後,送出鍵就不在了,只剩「下一題」(工單驗收 2) */
export const SUBMIT_HIDDEN_AFTER_RESULT = true;

// ── 設計值 2:面板撐滿視窗 ──────────────────────────────────────────────────
export const PANEL_FILLS_WINDOW = true;
/** 面板矩形離 (0, 0, 寬, 高) 的容許誤差(像素) */
export const PANEL_FILL_TOLERANCE_PX = 1;
/** 例子框左右離面板捲動區 client 範圍的最小距離(像素) */
export const EXAMPLE_MIN_MARGIN_PX = 12;

// ── 設計值 3:對錯字色與字樣 ────────────────────────────────────────────────
/** `--hud-pass` / `--hud-fail` 對面板的最差對比下限(算法同內文:`worstContrast`) */
export const PASS_FAIL_MIN_CONTRAST = 4.5;
/**
 * 結果那一行剛好是這兩串(符號後一個半形空格)。✓ = U+2713、× = U+00D7(乘號;不是 U+2717,不是字母 x)。
 * 寫成 codePoint,不在原始碼裡貼符號,避免編碼被轉。
 */
export const RESULT_TEXT = {
  pass: `${String.fromCodePoint(0x2713)} 答對了`,
  fail: `${String.fromCodePoint(0xd7)} 答錯了`,
} as const;
export const RESULT_SYMBOL = { pass: String.fromCodePoint(0x2713), fail: String.fromCodePoint(0xd7) } as const;
/** 評分失敗不是對錯結果 */
export const ERROR_TEXT = '評分失敗,請再試一次';

// ── 第二輪(顧問看過 @manual 的四個觀察,2026-10-16) ───────────────────────
/**
 * O1(第三輪改嚴):作答欄與 HUD 按鈕的內部,每個取樣像素都等於「--hud-panel 疊在它後面那個像素上」(跟 T14 G1 同一套公式)。
 * 為了讓「不透明白 / 灰 230 / 半透明疊在黑底上」都分得出來:量的時候在頁面上疊一個測試用的覆寫——
 * `--hud-panel` 換成明顯的半透明紅、頁面背景換成深色。真正跟著 --hud-panel 走的內部會變紅,寫死的白或灰不會。
 */
export const FACE_TEST_PANEL = { r: 255, g: 0, b: 0, a: 0.5 } as const;
export const FACE_TEST_BACKDROP = '#202020';
/** 每個通道容許的誤差(同 T14 G1 的 3,再放寬 1 給抗鋸齒) */
export const FACE_CHANNEL_TOLERANCE = 4;
/** hover / focus 還在用橘色:按鈕或作答欄外擴 6 像素的範圍裡,接近 --hud-accent 的像素至少這麼多 */
export const ACCENT_MIN_PIXELS = 20;
export const ACCENT_CHANNEL_TOLERANCE = 32;

/** O2:應用題 textarea 不能讓使用者拖縮放把手(把手會壓在切角線上),高度固定、捲動在裡面 */
export const TEXTAREA_RESIZE = 'none';
export const TEXTAREA_MIN_ROWS = 5;
/** O3:「送出」鍵上緣離上方作答欄(HudField 外框)下緣的最小距離(像素) */
export const SUBMIT_FIELD_MIN_GAP_PX = 8;
/** O4:例子框左邊那條線的粗細(像素;跟面板的黑線一樣細) */
export const EXAMPLE_BORDER_LEFT_PX = 1;

// ── HP 條 ──────────────────────────────────────────────────────────────────
/** 綠色那一段寬度離「內寬 × 比例」的容許誤差(右端斜切,正中間那一列少約 3.6 像素) */
export const HP_FILL_TOLERANCE_PX = 6;
export const HP_PERCENT_ONE_THIRD: readonly [number, number] = [33.3, 33.4];

// ── HudField(展示頁 720 × 900) ───────────────────────────────────────────
export const FIELD_MIN_HEIGHT_PX = 36;
export const FIELD_WIDTH_TOLERANCE_PX = 2;
export const FIELD_FOCUS_MIN_DIFF_PIXELS = 30;

// ── D1:展示頁頁首 ─────────────────────────────────────────────────────────
export const HEAD_MIN_CONTRAST = 4.5;

// ── 不退步:06、07 已 done 的 phase ────────────────────────────────────────
/**
 * 現在 06、07 都只有 phase-1 done。新出現 done 的 phase,這份清單沒有它就紅,
 * 逼人有意識地把它的 feature 雜湊釘進來(紅測試作者更新),不默默放過。
 * 雜湊是基底 b4d7e6d 時 `.feature` 檔內容的 sha256。
 */
export const DONE_PHASE_FEATURES: readonly { folder: string; phase: string; file: string; sha256: string }[] = [
  { folder: '06-test-card', phase: 'phase-1', file: 'features/06-test-card/phase-1.feature', sha256: 'cafdb78488aaf22bace7c18bf658706cb5bc321959739549aa8559992bc5fe7f' },
  { folder: '07-teach-card', phase: 'phase-1', file: 'features/07-teach-card/phase-1.feature', sha256: '057a70ba167e60fe12f5cbb01607cb61f25cba17e7b3a202755da74765c02a1c' },
];
/** 子行程跑的標籤式(場景 4) */
export const DONE_PHASES_TAG_EXPRESSION = '(@test-card or @teach-card) and @phase-1 and not @manual';
