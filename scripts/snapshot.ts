/**
 * ADR-042 / 契約 §11b:把 learning/ 目前的狀態 commit 成一份可以回溯的快照。
 *
 * 用法:
 *   npx tsx scripts/snapshot.ts [--dir learning]
 *   npm run snapshot
 *
 * 做的事就是 `git -C <dir> add -A && git commit -m "snapshot <YYYY-MM-DD>"`。
 * 沒有變更就什麼都不做(不製造空 commit),退出 0。
 *
 * 退出碼:
 *   0  有變更並且 commit 了,或是沒有變更
 *   1  目錄不存在、目錄不是它自己的 git repo、或這台機器沒有 git
 *
 * v1 沒有 daemon,所以這支程式**不自己排程**。呼叫的人是:
 *   - 11-review-cli 每次複習結束時(見 features/11-review-cli/FEATURE.md)
 *   - 使用者自己(cron / 手動)
 *   - I5 之後的桌面殼
 */
import './_env.js';
import { resolve } from 'node:path';
import { snapshotLearningDir } from '../packages/core/src/schema/git-repo.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = resolve(arg('--dir') ?? 'learning');
const result = snapshotLearningDir(dir);

switch (result.status) {
  case 'committed':
    console.log(`snapshot 已建立:${result.message}`);
    process.exit(0);
    break;
  case 'no-changes':
    console.log('沒有變更,不建立 snapshot。');
    process.exit(0);
    break;
  default:
    console.error(`snapshot 失敗(${result.status}):${result.hint ?? ''}`);
    process.exit(1);
}
