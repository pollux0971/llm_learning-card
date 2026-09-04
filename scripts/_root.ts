// SOURCE: template v1.3.0 (ee4f611) — 勿手改;升版用 sync-gates.sh
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
