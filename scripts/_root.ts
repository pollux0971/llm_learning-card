// SOURCE: template v1.3.2 (7eecc51) sha256=a530cc724f807154577176aa59ed936f4e3613dd3c0faf9157113c534af27cab — 勿手改;升版用 sync-gates.sh
/**
 * 六支守門腳本共用的 repo 根解析。
 *
 * 舊版用 `resolve(import.meta.dirname, '..')`,也就是「腳本自己所在目錄的上一層」——
 * 這要求腳本必須先被複製進目標 repo 的 scripts/ 才能用。改成用 git 找目前 cwd 所在
 * 的 repo 頂層,腳本就能留在模板裡,直接用 `npx tsx <template>/scripts/x.ts`
 * 對「執行時的 cwd 所在的 repo」跑,不必複製。
 *
 * 解法:優先問 git(`git rev-parse --show-toplevel`,以 process.cwd() 為準);
 * 不在 git repo 裡(或找不到 git 執行檔)就退回 process.cwd() 本身。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveRoot(): string {
  try {
    // stdio 顯式指定,避免不在 git repo 裡時 git 把 "fatal: not a git repository" 印到
    // 終端機——這條路徑是刻意的退回,不是使用者需要看到的錯誤。
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

export const ROOT: string = resolveRoot();

/**
 * 設定檔位置解析(CHANGELOG 1.3.2 (A))。
 *
 * `sync-gates.sh` 把守門腳本複製進 consumer 的**安裝目錄**——預設是 `scripts/`,
 * 但 cucumber 設定不在根目錄的專案常把它裝在別處(例如 `features/scripts/`),設定檔
 * (`gates.config.json`、`boundaries.*.json`)也一起裝在那裡。過去每支腳本只認
 * `ROOT/scripts/<name>`,裝在別處的設定就永遠讀不到——不會報錯,只會安靜套用預設值
 * 或觸發自動偵測,像是設定死掉了一樣(專案 B 實測的迴歸)。
 *
 * 找設定檔的順序:
 *   1. 呼叫端腳本自己所在的目錄(`import.meta.dirname`,sync 後就是 consumer 的安裝目錄)
 *   2. `ROOT/scripts/`
 * 兩處都沒有 → 回傳 `undefined`,呼叫端印「設定檔未找到於 <兩個路徑>」(必要設定)
 * 或靜默套用內建預設(選填設定,行為不變)。
 */
export function resolveConfig(scriptDir: string, name: string): string | undefined {
  for (const candidate of configSearchPaths(scriptDir, name)) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** `resolveConfig` 實際會依序嘗試的兩個路徑,供找不到時的錯誤訊息使用。 */
export function configSearchPaths(scriptDir: string, name: string): string[] {
  return [join(scriptDir, name), join(ROOT, 'scripts', name)];
}
