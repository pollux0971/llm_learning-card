/**
 * 首次啟動與路徑設定的決定(不開視窗)。
 * 設定檔是 JSON:`{ "learningDir": "<absolute path>" }`。
 */

export interface StartupDecision {
  askChoose: boolean;
  offerInit: boolean;
  notFound: boolean;
  askAgain: boolean;
}

export function decideStartup(_configPath: string): StartupDecision {
  throw new Error('T2b: decideStartup 尚未實作');
}

export function saveChosenPath(_configPath: string, _chosen: string): void {
  throw new Error('T2b: saveChosenPath 尚未實作');
}
