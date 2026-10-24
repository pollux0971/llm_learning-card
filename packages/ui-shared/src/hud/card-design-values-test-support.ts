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
/** 每個通道容許的誤差(跟 T14 G1 同為 3;顧問 2026-10-16) */
export const FACE_CHANNEL_TOLERANCE = 3;
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

// ── 第四輪(P1/P2:hover / focus 不能變方塊,2026-10-16) ─────────────────────
/** 被切掉的角(離角 ≤ 這麼遠的那一小塊三角形)的像素,在 hover / focus 下要等於後面的背景,每通道容許的誤差 */
export const CUT_CORNER_TOLERANCE = 10;
/** 元件矩形外面 [MIN, MAX] 像素那一圈不能有橘色(擋方形 outline);容許的橘色像素數 */
export const OUTER_RING_MIN_PX = 2;
export const OUTER_RING_MAX_PX = 4;
export const OUTER_RING_MAX_ACCENT_PIXELS = 0;
/** 作答欄沒有 hover 樣式:滑鼠移上去,外擴 6 像素範圍內最多這麼多個像素看得出不同(任一通道差 > 32) */
export const FIELD_HOVER_MAX_DIFF_PIXELS = 4;

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
 * 現在 06 的 phase-1、phase-2、phase-3 與 07 的 phase-1、phase-2、phase-3、phase-4 done。新出現 done 的 phase,這份清單沒有它就紅,
 * 逼人有意識地把它的 feature 雜湊釘進來(紅測試作者更新),不默默放過。
 * 雜湊是 `.feature` 檔內容的 sha256:phase-1 兩份是基底 b4d7e6d 時量的;06 phase-2 是 main 6c822c6(06 phase-2 標 done)時量的;06 phase-3 是 main 5be60bd 時量的(phase-3.feature 在 T23 沒變);07 phase-2 是 main d3a1da7 時量的(2026-10-23 標 done,證據 docs/reviews/T40-manual-2026-10-23.md;phase-2.feature 自 T37 起沒再改);07 phase-3 是 main e30a353 時量的(2026-10-24 標 done,T43/T44 @manual 通過;phase-3.feature 自初版沒再改);07 phase-4 是 main 67e2ded 時量的(2026-10-25 標 done,T46/T47/T48/T49 @manual 顧問判通過;phase-4.feature 最後改動是 2d9bd81〔T47〕)。
 */
export const DONE_PHASE_FEATURES: readonly { folder: string; phase: string; file: string; sha256: string }[] = [
  { folder: '06-test-card', phase: 'phase-1', file: 'features/06-test-card/phase-1.feature', sha256: 'cafdb78488aaf22bace7c18bf658706cb5bc321959739549aa8559992bc5fe7f' },
  { folder: '06-test-card', phase: 'phase-2', file: 'features/06-test-card/phase-2.feature', sha256: '2ea20a60ddcb8a201bb1175cd9680e0bf7089e54188dade990fcbc07ecc9cadf' },
  { folder: '06-test-card', phase: 'phase-3', file: 'features/06-test-card/phase-3.feature', sha256: '3a7f784d253df5ebc069eb81290f2d149e0c3f94a531d0f2b198dbf5472b8047' },
  { folder: '07-teach-card', phase: 'phase-1', file: 'features/07-teach-card/phase-1.feature', sha256: '057a70ba167e60fe12f5cbb01607cb61f25cba17e7b3a202755da74765c02a1c' },
  { folder: '07-teach-card', phase: 'phase-2', file: 'features/07-teach-card/phase-2.feature', sha256: '9ec41cd146fd44fb960ebeb3276596c927c372575fdb894de993cf9071f97dba' },
  { folder: '07-teach-card', phase: 'phase-3', file: 'features/07-teach-card/phase-3.feature', sha256: 'a27ff4e8c1f4159ad16147a0fd557ed1d59d0e239431e90e0d9718ea99190ccd' },
  { folder: '07-teach-card', phase: 'phase-4', file: 'features/07-teach-card/phase-4.feature', sha256: 'e779886b027dfa7e0afffdf1e4ce1ee0c56d2a3c4d134d9b4b90f84ba82bb8ed' },
];
/**
 * 子行程跑的標籤式(場景 4):06 的 phase-1、phase-2 與 phase-3、07 的 phase-1、phase-2、phase-3 與 phase-4,都不含 @manual。
 * 不能寫成 `(@test-card or @teach-card) and (@phase-1 or @phase-2 or @phase-3)`:06 的 phase-4 還不是 done,不該被拉進來。
 * 新增 done 的 phase 時,這個式子與上面的清單一起更新(紅測試作者)。
 */
export const DONE_PHASES_TAG_EXPRESSION = '((@test-card and (@phase-1 or @phase-2 or @phase-3)) or (@teach-card and (@phase-1 or @phase-2 or @phase-3 or @phase-4))) and not @manual';

/**
 * 「即將標 done」的 phase:雜湊已經釘住,但 FEATURE.md 的 phase 表還沒翻成 done(協調者標 done 的那個 commit 之前)時,
 * 列在這裡的 phase 不報「在清單裡但不是 done」;雜湊照樣檢查。平常是空的:phase 標 done 之後就清掉,
 * 否則日後有人把它翻回非 done 會被放過。下一個 phase 要先釘時,把它加進來,標 done 後再清掉。
 */
export const PENDING_DONE_PHASES: readonly { folder: string; phase: string }[] = [];

// ── T32:考試卡 header 的版面(顧問 2026-10-18 審過) ───────────────────────
/** 「逾期 N」左緣減「已答 / 總數」右緣:靠左、保留上限(`00-design.md` §5.5 是同一句話);建議 column-gap 0.75rem = 12 px */
export const HEADER_GAP_MIN_PX = 8;
export const HEADER_GAP_MAX_PX = 24;
/** HP 條上緣離兩段較低的下緣:0.2rem(T24 的值,「送出」回到 T24 位置的前提);rem 從 :root 的 font-size 讀 */
export const HEADER_HP_ROW_GAP_REM = 0.2;
/** 同一行(上緣 y)、HP 條間距、HP 條寬度與左緣的容許誤差 */
export const HEADER_LAYOUT_TOLERANCE_PX = 1;

// ── T34:Wayland 一次性提示(顧問 2026-10-18 審過) ──────────────────────────
/** 提示的字樣(照 placeholder 的;一顆按鈕,字是「知道了」) */
export const WAYLAND_NOTE_TEXT = 'Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。';
export const WAYLAND_NOTE_DISMISS_LABEL = '知道了';
/** 按掉之後存在頁面 localStorage 的鍵(兩張卡同一個來源,按一次就夠);值是 '1' */
export const WAYLAND_NOTE_STORAGE_KEY = 'lc-wayland-note-dismissed';
/** Rust 用 include_str! 帶進去的那一段頁面程式(測試與 Rust 讀同一個檔) */
export const WAYLAND_NOTE_JS = join(REPO_ROOT, 'apps/desktop/src-tauri/src/wayland_note.js');
/**
 * 桌面程式頁面的 CSP 是 `default-src 'self'; script-src 'self'; …`(apps/desktop/src-tauri/tauri.conf.json,靜態測試釘住前兩段),
 * 沒有 unsafe-inline,所以不能用 style 屬性、不能 innerHTML 塞樣式。
 * 真 Chrome 的 dev server 頁面,樣式是 vite 用 JS 塞 <style> 進去的(打包後是檔案),所以這條多開 style-src-elem 的 unsafe-inline;
 * style 屬性(style-src-attr 退回 default-src)與行內程式照樣被擋。
 */
export const DESKTOP_PAGE_CSP_PREFIX = "default-src 'self'; script-src 'self'";
export const DEV_PAGE_CSP = `${DESKTOP_PAGE_CSP_PREFIX}; style-src-elem 'self' 'unsafe-inline'`;
