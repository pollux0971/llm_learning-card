/**
 * 視窗位置/大小的持久化。這是 tauri-plugin-window-state 在執行期實際做的事的一個可獨立測試的模型
 * (phase-1.feature「Position and size survive a restart」不是 @manual,要能在沒有真的 GUI 的情況下驗收)。
 *
 * 寫入採「寫暫存檔 → rename」,跟契約 §11b 的 state/ 寫入紀律一致,雖然這份檔案不在 learning/state/ 底下。
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WindowLabel = 'teach' | 'test';
export type WindowStateMap = Record<WindowLabel, WindowGeometry>;

/** 跟 src-tauri/tauri.conf.json 裡兩個視窗的預設值一致,兩者互不覆蓋。 */
export function defaultLayout(): WindowStateMap {
  return {
    teach: { x: 100, y: 100, width: 360, height: 480 },
    test: { x: 520, y: 100, width: 360, height: 480 },
  };
}

export async function saveWindowState(filePath: string, state: WindowStateMap): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state), 'utf8');
  await rename(tmpPath, filePath);
}

/** 檔案不存在時回傳預設佈局,對應「應用程式第一次啟動」。 */
export async function loadWindowState(filePath: string): Promise<WindowStateMap> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as WindowStateMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultLayout();
    throw err;
  }
}
