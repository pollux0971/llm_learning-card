/** 桌面殼(10 phase-6)設在頁面根元素上的兩個 class。本目錄只照著畫。 */
export const FRAMELESS_CLASS = 'hud-frameless';
export const SOLID_CLASS = 'hud-solid';

export interface Chrome {
  titleBar: boolean;
  resizeHandles: boolean;
  windowButtons: boolean;
}

/**
 * 沒有 hud-frameless 時不畫標題列與縮放把手(系統標題列還在,不能出現兩條)。
 * 縮小 / 關閉鈕還要在 Tauri 裡才畫。
 */
export function hudChrome(options: { frameless: boolean; tauri: boolean }): Chrome {
  return {
    titleBar: options.frameless,
    resizeHandles: options.frameless,
    windowButtons: options.frameless && options.tauri,
  };
}

export function readRootFlags(root: { classList: { contains(name: string): boolean } }): {
  frameless: boolean;
  solid: boolean;
} {
  return {
    frameless: root.classList.contains(FRAMELESS_CLASS),
    solid: root.classList.contains(SOLID_CLASS),
  };
}
