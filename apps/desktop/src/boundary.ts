/**
 * 10-desktop-shell phase-2 的 LearningFs 邊界。
 *
 * 測試先釘死這份簽名(步驟定義只呼叫這裡)。實作換掉函式本體,不改簽名。
 * assetUrl 是同步的:自己丟錯,不呼叫 recordEvent。權威是 requestAsset
 * (webview 真的打 URL 時,Rust handler 解恰好一次再跑同一份白名單)。
 */

export interface FsCall {
  op: string;
  path: string;
}

export interface BoundaryResult {
  ok: boolean;
  value?: string | boolean | string[];
  refused?: boolean;
  fsCalls: FsCall[];
  rustLog: string[];
  /** asset handler 解恰好一次之後、拿去檢查與使用的字串 */
  checked?: string;
  url?: string;
}

export interface Boundary {
  root: string;
  logPath: string;
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
  requestAsset(urlPath: string): Promise<BoundaryResult>;
  last(): BoundaryResult;
}

export function openBoundary(_root: string): Boundary {
  throw new Error('T2b: openBoundary 尚未實作');
}
