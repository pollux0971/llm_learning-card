/**
 * 10-desktop-shell phase-6(工單 T16)場景之間共用的「視窗打開了」狀態。測試 agent 寫;開發 worker 不改。
 *
 * 為什麼有這個檔:場景 3 的 `Then the page root has the frameless class` 跟 14 phase-1 的
 * `Given the page root has the frameless class`(hud-skin.steps.ts)是同一句話,cucumber 不分關鍵字,
 * 同一句只能有一個定義。所以 hud-skin.steps.ts 的那一個在「已經有視窗打開」時改成斷言(見該檔),
 * 沒有視窗打開時照舊是設定(14 phase-1 的行為不變)。
 */
export interface OpenedWindow {
  /** 這次打開時桌面能不能畫透明(Given 沒說時兩種都跑) */
  composited: boolean;
  /** 跑完 Rust 組出來的 init script 之後,假的頁面根元素上的 class */
  classes: string[];
  /** 除了 classList 之外碰過的東西 */
  touched: string[];
  threw?: string;
  /** Rust 端真的算出來的 surface_for(mode_for(composited))(T21) */
  surface?: { transparent: boolean; background: number[] | null; solidBackground: number[] };
}

/** key 是 cucumber 的 World;值是這個場景裡打開過的視窗(沒有就是沒打開) */
export const openedWindows = new WeakMap<object, OpenedWindow[]>();
