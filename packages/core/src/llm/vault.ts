/**
 * `learning/` 是使用者跨 git worktree 共用的帳本(`state/log.jsonl`、
 * `config/settings.yaml` 等)——不是每個 worktree 各自一份。
 *
 * ADR-051:2026-09-12 實測,`learning/` 被當成「每個簽出各自的資料夾」處理時,
 * 每日花費上限(`LLM_DAILY_CAP_USD`)也跟著變成「每個簽出各自一份」——
 * N 個 worktree 就能實際花到 N 倍的錢,而每一個 worktree 都會誠實回報
 * 「未達上限」,因為它只看得到自己那份 log。而且 worktree 會被清掉,
 * 清掉的那一刻,那份 log 裡的花費紀錄就永久消失、沒有任何痕跡。
 * 帳本必須活得比 worktree 久,所以只能有一份,而且要放在不會被
 * `git worktree remove` 清掉的地方——主簽出。
 *
 * 解法跟 `scripts/mutate.ts` 的 `strykerLockPath()` 同一招:
 * `git rev-parse --git-common-dir` 在任何 worktree 裡都指向主 repo 的 `.git/`,
 * 取它的上一層就是主簽出的工作目錄,所有 worktree 算出來會是同一個路徑。
 * 不重用 `strykerLockPath()` 本人——那是 `infra` owner,`03-llm-router`
 * 依賴 `infra` 的下一步會是 library 依賴一支 script,方向反了;這幾行
 * 本身夠小、夠穩,照抄一份比跨層 import 乾淨(跟 router-gateway.ts 重複
 * `createFileLogAppender` 而不是跨檔案共用私有函式同一個判斷)。
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

/** 主簽出(`git rev-parse --git-common-dir` 的上一層)的絕對路徑。 */
export function resolveVaultRoot(cwd: string = process.cwd()): string {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return dirname(resolve(cwd, common));
}

/** `learning/` 帳本的絕對路徑——不管呼叫的人現在站在哪個 worktree。 */
export function resolveVaultLearningDir(cwd: string = process.cwd()): string {
  return join(resolveVaultRoot(cwd), 'learning');
}
