/**
 * 14-hud-skin 與 10 phase-6(工單 T16)的外觀量測數值,集中在這一個檔。測試 agent 寫;開發 worker 不改。
 * 來源:工單 T16「驗收條件」第 5–8 點與「外觀類工單的規則」;前端(規格作者)與技術顧問 2026-10-16 審過。
 * 之後要改,只改這裡。
 *
 * 不 import 任何卡片(06、07)或 apps/desktop 的模組(boundaries)。
 */

/** hover / focus 時,四條直邊正中間那一點的框線顏色(= --hud-accent #e87820 差一點點):每通道容許誤差 ±10 */
export const SATURATED_ORANGE = [231, 119, 31] as const;
export const SATURATED_ORANGE_TOLERANCE = 10;
/** 淡橘填色(hover 的標籤底);線不見、只剩淡橘時,框線點的顏色會落在這附近,離飽和橘很遠 */
export const ORANGE_WASH = [247, 208, 177] as const;

/** 框線點的搜尋帶:邊線落在小數像素時會被抗鋸齒分到相鄰兩格,所以量垂直於邊的 ±1 像素,取最接近飽和橘的那一點 */
export const EDGE_BAND_PX = 1;

/** 縮小 / 關閉鈕的內部取樣點離左右邊的距離、離中心線的上下距離(避開字;切角 4–6 像素,取樣點離切角夠遠) */
export const CHIP_SAMPLE_INSET_PX = 5;
export const CHIP_SAMPLE_DY_PX = 6;

/** 放大法:換掉頁底的兩個顏色。內部有跟著 --hud-panel 走(半透明)時,兩張圖同一點會差很多;不透明的不會差 */
export const BACKDROP_DARK = '#202020';
export const BACKDROP_LIGHT = '#e0e0e0';
/** 兩個頁底下同一個內部像素,任一通道至少要差這麼多,才算「底下的東西透得出來」 */
export const SEE_THROUGH_MIN_DIFF = 20;
/** hover / focus 的格子取樣點裡,至少這個比例要隨頁底變(字與 focus 的淺色內框是不透明的,佔少數幾點) */
export const SEE_THROUGH_MIN_FRACTION = 0.4;

/** hover / focus-visible / 一般 三種狀態兩兩之間至少差幾個像素(T14 G5 同一個數字) */
export const STATE_MIN_DIFF_PIXELS = 30;

/** 停用 */
export const DISABLED_MIN_DIFF_PIXELS = 30;
export const DISABLED_MARGIN_PX = 6;
/** 展示頁現有元件的個數(T14、T15 的量尺用索引找元素):停用的元件必須排在這之後 */
export const GALLERY_EXISTING_BUTTONS = 3;
export const GALLERY_EXISTING_FIELDS = 2;

/** 縮放把手 hover:把手矩形外擴這麼多像素的範圍內,橘色像素最多幾個 */
export const HANDLE_MARGIN_PX = 2;
export const HANDLE_MAX_ORANGE_PIXELS = 0;
export const HANDLE_COUNT = 8;

/** 展示頁的開關 */
export const FAKE_CONTROLS_SWITCH = '[data-gallery="fake-window-controls"]';
