import { isTauri as detectTauri } from '@tauri-apps/api/core';

export type ResizeDirection =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

export interface WindowLike {
  minimize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
}

export interface WindowControls {
  readonly available: boolean;
  minimize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
}

export interface ControlsDeps {
  isTauri?: () => boolean;
  loadWindow?: () => Promise<WindowLike>;
}

async function defaultLoadWindow(): Promise<WindowLike> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

/**
 * 視窗 API 的包裝。available 在建立時就決定。
 * 不在 Tauri:四個方法都是不丟錯的空動作,也不載入視窗模組。
 * 在 Tauri:第一次用到才載入視窗;關閉只轉給視窗的 close()。
 */
export function createWindowControls(deps?: ControlsDeps): WindowControls {
  const available = (deps?.isTauri ?? detectTauri)();
  let pending: Promise<WindowLike> | undefined;

  function current(): Promise<WindowLike> {
    const load = deps?.loadWindow ?? defaultLoadWindow;
    pending ??= load();
    return pending;
  }

  return {
    available,
    async minimize(): Promise<void> {
      if (!available) return;
      const appWindow = await current();
      await appWindow.minimize();
    },
    async close(): Promise<void> {
      if (!available) return;
      const appWindow = await current();
      await appWindow.close();
    },
    async startDragging(): Promise<void> {
      if (!available) return;
      const appWindow = await current();
      await appWindow.startDragging();
    },
    async startResizeDragging(direction: ResizeDirection): Promise<void> {
      if (!available) return;
      const appWindow = await current();
      await appWindow.startResizeDragging(direction);
    },
  };
}
