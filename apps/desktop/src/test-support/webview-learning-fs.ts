/**
 * 載入 webview 端的 LearningFs(開發 worker 寫的 `apps/desktop/src/webview/learning-fs.ts`)。
 * 測試 agent 寫的;這裡定的是測試期待的介面,worker 照這個做。
 *
 * 用動態 import 而不是靜態 import:那個檔還沒寫的時候,只有用到它的測試紅(訊息是找不到模組),
 * 不會讓整個 cucumber 或 tsc 先炸掉。
 *
 * 期待的匯出:
 *   createLearningFs({ invoke?, os? }) → { read, write, list, exists, assetUrl }(契約 §13 的五個方法)
 *     invoke 預設是 `@tauri-apps/api/core` 的 invoke;command 名與參數:
 *       read → invoke('read', { relPath })      write → invoke('write', { relPath, content })
 *       list → invoke('list', { relDir })       exists → invoke('exists', { relPath })
 *     參數原樣交出去(TS 不先檢查、不轉換;權威在 Rust)。
 *     invoke 被拒絕時收到的是 command 的錯誤 JSON:
 *       { kind: 'refused', reason } → 丟 PathRefusedError(.reason)
 *       { kind: 'io', code, errno? } → 丟 LearningIoError(.code、.errno)
 *     assetUrl 同步:先做 TS 端的提示檢查(raw/、結構……),不過就丟 PathRefusedError,不呼叫 invoke;
 *       過了就回 assetUrlPrefix(os) + 逐段 encodeURIComponent。
 *   assetUrlPrefix(os):'linux'、'macos' → 'lc://localhost/';'windows'、'android' → 'http://lc.localhost/'。
 *   PathRefusedError、LearningIoError:兩個不同的 Error 子類別。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WEBVIEW_LEARNING_FS = join(import.meta.dirname, '../webview/learning-fs.ts');

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface WebviewLearningFs {
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
}

export interface CreateOptions {
  invoke?: InvokeFn;
  os?: string;
}

export type RefusedErrorClass = abstract new (...args: never[]) => Error & { reason: string };
export type IoErrorClass = abstract new (...args: never[]) => Error & { code: string; errno?: number };

export interface WebviewLearningFsModule {
  createLearningFs(options?: CreateOptions): WebviewLearningFs;
  PathRefusedError: RefusedErrorClass;
  LearningIoError: IoErrorClass;
  assetUrlPrefix(os: string): string;
}

export async function loadWebviewLearningFs(): Promise<WebviewLearningFsModule> {
  const mod = (await import(pathToFileURL(WEBVIEW_LEARNING_FS).href)) as Partial<WebviewLearningFsModule>;
  for (const name of ['createLearningFs', 'PathRefusedError', 'LearningIoError', 'assetUrlPrefix'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(`apps/desktop/src/webview/learning-fs.ts 沒有匯出 ${name}`);
    }
  }
  return mod as WebviewLearningFsModule;
}
