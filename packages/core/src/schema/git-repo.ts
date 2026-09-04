/**
 * ADR-042:把 `learning/` 變成它自己的 git repo,並提供每日 snapshot。
 *
 * 契約 §11b 最後一段:「另外,`learning/` 建議是一個 git repo。`state/` 的變更每天
 * 自動 commit 一次(由 `scripts/snapshot.ts` 做,或你自己排程),這樣任何損毀都可以
 * 回溯。」§11b 前半(tmp → fsync → rename → fsync 目錄)擋的是「一次寫入寫壞」,
 * 這裡擋的是另一半:寫對了、但內容被誤刪或被寫成錯的東西,幾個月的複習資料沒有任何
 * 回得去的版本。
 *
 * 兩個入口:
 *   - initGitRepo(dir)          由 `cli.ts init <dir>` 在建完目錄樹之後呼叫
 *   - snapshotLearningDir(dir)  由 `scripts/snapshot.ts` 與 11-review-cli 每次複習結束呼叫
 *
 * 兩個都必須是**冪等**的,而且**沒有 git 的環境照樣要能用**——§11b 說的是「建議」,
 * 不是硬約定,把 git 變成 init 的必要條件等於讓一個建議去擋掉整個產品。
 *
 * ⚠️ 「dir 是不是一個 repo」一律用 `rev-parse --show-toplevel` 比對真實路徑,
 * **不可以**用 `--is-inside-work-tree`——見 isOwnGitRepo() 的說明。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 寫進 `<learning>/.gitignore` 的內容(ADR-042)。
 *
 * 原則是「**除了 assets/ 的大檔以外都追蹤**」:cards、questions、state、graph、config
 * 全部進版控,因為它們才是「壞掉就沒了」的東西。
 *
 * `/assets/` 前面那條斜線是有意義的:只擋最上層那一個 assets/(契約 §12 的目錄),
 * 不擋 `cards/<category>/assets/` 這種將來可能出現的同名子目錄。
 *
 * `*.tmp` 擋的是原子寫入的殘留檔。schema/atomic-write.ts 用 `.<name>.<pid>.<ts>.tmp`、
 * ingest/state.ts 用 `<name>.tmp`,兩種都以 `.tmp` 結尾。正常情況下 rename 完就不存在,
 * 但 snapshot 剛好跟一次寫入撞在一起時會看到,commit 進去就是半個檔案。
 */
export const LEARNING_GITIGNORE = `# learning/ 是你自己的資料庫。除了 assets/ 的大檔以外全部進版控——
# cards、questions、state、graph、config 才是「壞掉就沒了」的東西。
# 見 contracts/types.md §11b 與 docs/02-decision-map.md 的 ADR-042。

# 圖片、音訊之類的素材:進版控會讓 repo 一直長大,而且它們是可以重新取得的東西。
# 開頭的斜線表示只擋最上層這一個目錄,不擋 cards/<category>/assets/。
/assets/

# 原子寫入(§11b)的暫存檔。rename 之後就不存在,但 snapshot 剛好卡在
# 一次寫入中間時會看到,commit 進去就是半個檔案。
*.tmp
`;

/** `cli.ts init` 建立 repo 時用的 commit 訊息(ADR-042)。 */
export const INIT_COMMIT_MESSAGE = 'init';

/**
 * 沒有設 `user.email` 的環境(全新的機器、CI 容器)用的退路身分。
 * 只在該 repo 讀不到 `user.email` 時用 `-c` 帶進去,使用者自己設過的身分永遠優先。
 */
export const FALLBACK_IDENTITY = {
  name: 'learning-cards',
  email: 'learning-cards@localhost',
} as const;

/** 找不到 git 命令時,init 印出的警告(ADR-042:warning,不是失敗)。 */
export const GIT_UNAVAILABLE_WARNING =
  'warning: 找不到 git 命令,已跳過版本控制。目錄樹建好了可以正常使用,' +
  '但 learning/ 不會有可以回溯的歷史(契約 §11b 的建議)。裝好 git 之後再跑一次 init 即可補上。';

/** snapshot 遇到「目錄不存在」時印出的指引(ADR-042)。 */
export const MISSING_DIR_HINT =
  '這個目錄不存在。請確認 --dir 指到正確的 learning 目錄。';

/** snapshot 遇到「不是 git repo」時印出的指引(ADR-042)。 */
export const NOT_A_REPO_HINT =
  '這個目錄不是它自己的 git repo,沒有東西可以 snapshot。' +
  '請跑 npx tsx packages/core/src/schema/cli.ts init <dir> 建立版本控制。';

export type GitInitStatus =
  /** 這次真的做了 git init + 第一個 commit */
  | 'created'
  /** 已經是它自己的 repo,整段跳過 */
  | 'existing'
  /** 找不到 git 命令,跳過(不是失敗) */
  | 'git-unavailable';

export interface GitInitResult {
  status: GitInitStatus;
  /** 這次是否寫了 .gitignore */
  wroteGitignore: boolean;
  /** 這次是否做了 init commit */
  committed: boolean;
  /** status 為 git-unavailable 時的警告文字,其餘情況 undefined */
  warning?: string;
}

export type SnapshotStatus =
  /** 有變更,已經 commit */
  | 'committed'
  /** 沒有任何變更,沒有製造空 commit */
  | 'no-changes'
  /** 目錄存在但不是它自己的 git repo */
  | 'not-a-repo'
  /** 目錄根本不存在 */
  | 'missing-dir'
  /** 找不到 git 命令 */
  | 'git-unavailable';

export interface SnapshotResult {
  status: SnapshotStatus;
  /** committed 時實際用的 commit 訊息 */
  message?: string;
  /**
   * 失敗類的狀態給使用者看的指引。committed / no-changes 時 undefined,
   * 其餘三個狀態一定有值(not-a-repo → NOT_A_REPO_HINT、missing-dir →
   * MISSING_DIR_HINT、git-unavailable → GIT_UNAVAILABLE_WARNING)。
   */
  hint?: string;
}

/**
 * snapshot 的 commit 訊息:`snapshot YYYY-MM-DD`。
 *
 * 用**當地**日曆日期,不是 UTC 那一瞬間——這是給人看的「哪一天的資料」,
 * 跟 isoWeek() 一樣看當地日曆(半夜跑 snapshot 時 UTC 會差一天)。
 */
export function snapshotMessage(today: Date): string {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `snapshot ${y}-${m}-${d}`;
}

/**
 * 跑一次 git,回傳退出碼與 stdout。**不丟錯**——「沒有 git」在這裡是一個要回報的
 * 狀態,不是例外(§11b 說 git 是建議)。所以一律用 spawnSync 而不是 execFileSync。
 *
 * `leading` 放在 `-C` 前面,給 `-c user.email=…` 這種只對這一次呼叫生效的設定用。
 */
function runGit(dir: string, args: string[], leading: string[] = []): { status: number | null; out: string } {
  const r = spawnSync('git', [...leading, '-C', dir, ...args], { encoding: 'utf8' });
  // Stryker disable next-line all: `?? ''` 只在 spawn 本身失敗(這台機器沒有 git)時會用到,
  // 而那種情況 status 也是 null——isOwnGitRepo 只在 status === 0 時讀 out,identityArgs 不讀,
  // mustGit 讀的是自己丟出去的錯誤訊息。換掉 fallback 沒有任何呼叫端看得到的行為差異。
  return { status: r.status, out: (r.stdout ?? '').trim() };
}

/**
 * 跑一次 git,失敗就丟錯。
 *
 * 只用在「已經確認 git 可用、目錄狀態也確認過」之後的那幾步(init / add / commit)。
 * 那些步驟失敗代表磁碟或 git 本身出了問題,不是我們預期得到的狀態——安靜吞掉的話,
 * 使用者會以為版本控制建好了,真正需要回溯的那天才發現什麼都沒有。
 */
function mustGit(dir: string, args: string[], leading: string[] = []): void {
  const r = runGit(dir, args, leading);
  if (r.status !== 0) throw new Error(`git ${args[0]} 失敗(exit ${r.status}):${r.out}`);
}

/**
 * commit 時要不要帶一個退路身分進去。
 *
 * 這個 repo 讀得到 `user.email` 就回空陣列——**使用者自己設過的身分永遠優先**,
 * 這是他的 repo,不是我們的。讀不到(全新的機器、CI 容器)才用 `-c` 帶
 * FALLBACK_IDENTITY,否則 `git commit` 會直接失敗。
 */
function identityArgs(dir: string): string[] {
  if (runGit(dir, ['config', 'user.email']).status === 0) return [];
  return ['-c', `user.name=${FALLBACK_IDENTITY.name}`, '-c', `user.email=${FALLBACK_IDENTITY.email}`];
}

/**
 * `dir` 是不是**它自己**的 git repo。
 *
 * 不能只問 `git -C <dir> rev-parse --is-inside-work-tree`:`learning/` 常常就放在
 * 主 repo 底下,那句話會因為找到**上層**的 repo 而回 true。真正要問的是
 * 「這個目錄的 repo 根就是它自己嗎」——比對 `rev-parse --show-toplevel` 與 dir 的
 * 真實路徑。搞錯的後果是把使用者的卡片 commit 進錯的 repo。
 *
 * 兩邊都先過 `realpathSync` 再比:`/tmp` 在某些系統上是 symlink,git 回的是解開之後
 * 的路徑,直接比字串會把「是自己的 repo」誤判成「不是」。
 */
export function isOwnGitRepo(dir: string): boolean {
  const r = runGit(dir, ['rev-parse', '--show-toplevel']);
  // 目錄不存在、不在任何 repo 裡、或這台機器沒有 git,都走這一條
  if (r.status !== 0) return false;
  return realpathSync(r.out) === realpathSync(dir);
}

/** 這台機器上有沒有可用的 git 命令。 */
export function isGitAvailable(): boolean {
  // Stryker disable next-line all: 這裡只讀 .status。encoding 只決定 stdout 是 string 還是
  // Buffer,而 stdout 根本沒有被讀——拿掉它沒有任何可觀察的行為差異。
  return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
}

/**
 * 把 `dir` 變成它自己的 git repo:`git init` → 寫 `.gitignore` → 第一個 commit(`init`)。
 *
 * 冪等:已經是它自己的 repo 就整段跳過(不重新 init、不再產生一個 init commit、
 * 不覆寫使用者可能改過的 .gitignore)。
 *
 * 找不到 git 命令時回 `git-unavailable` 加一段 warning,**不丟錯**。
 */
export function initGitRepo(dir: string): GitInitResult {
  if (!isGitAvailable()) {
    return {
      status: 'git-unavailable',
      wroteGitignore: false,
      committed: false,
      warning: GIT_UNAVAILABLE_WARNING,
    };
  }
  // 冪等的那一格。注意這裡問的是「是不是**它自己**的 repo」——如果 dir 只是躺在
  // 上層 repo 底下,答案是 false,我們照樣要幫它 init 一個自己的。
  if (isOwnGitRepo(dir)) {
    return { status: 'existing', wroteGitignore: false, committed: false };
  }
  mustGit(dir, ['init', '-q']);
  writeFileSync(join(dir, '.gitignore'), LEARNING_GITIGNORE, 'utf8');
  mustGit(dir, ['add', '-A']);
  mustGit(dir, ['commit', '-q', '-m', INIT_COMMIT_MESSAGE], identityArgs(dir));
  return { status: 'created', wroteGitignore: true, committed: true };
}

/**
 * `git -C <dir> add -A && git commit -m "snapshot <日期>"`。
 *
 * 沒有變更就回 `no-changes`,**不製造空 commit**——每天一個空 commit 會讓歷史裡
 * 真正有變化的那幾天找不到。
 */
export function snapshotLearningDir(dir: string, opts: { today?: Date } = {}): SnapshotResult {
  // 三道關卡的順序是有意義的:目錄不存在跟沒有 git 各自有自己的指引文字,
  // 而「不是它自己的 repo」一定要在 add -A 之前擋掉——不然就是把使用者的卡片
  // commit 進上層那個 repo。
  if (!existsSync(dir)) return { status: 'missing-dir', hint: MISSING_DIR_HINT };
  if (!isGitAvailable()) return { status: 'git-unavailable', hint: GIT_UNAVAILABLE_WARNING };
  if (!isOwnGitRepo(dir)) return { status: 'not-a-repo', hint: NOT_A_REPO_HINT };

  mustGit(dir, ['add', '-A']);
  // 進了索引之後才問「跟 HEAD 有沒有差」。先 add 再比,才抓得到新增與刪除;
  // 退出碼 0 表示沒有差異,那就什麼都不做。
  if (runGit(dir, ['diff', '--cached', '--quiet']).status === 0) return { status: 'no-changes' };

  const message = snapshotMessage(opts.today ?? new Date());
  mustGit(dir, ['commit', '-q', '-m', message], identityArgs(dir));
  return { status: 'committed', message };
}
