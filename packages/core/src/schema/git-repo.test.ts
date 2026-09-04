/**
 * ADR-042:learning/ 自成 git repo + 每日 snapshot。
 *
 * 每個測試都在 mkdtemp 出來的暫存目錄裡跑 `git init`,**絕對不在這個 repo 或任何
 * worktree 裡面 init**。暫存目錄在 afterEach 一律刪掉。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_IDENTITY,
  GIT_UNAVAILABLE_WARNING,
  INIT_COMMIT_MESSAGE,
  LEARNING_GITIGNORE,
  MISSING_DIR_HINT,
  NOT_A_REPO_HINT,
  initGitRepo,
  isGitAvailable,
  isOwnGitRepo,
  snapshotLearningDir,
  snapshotMessage,
} from './git-repo.js';
import { initLearningDir } from './init.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(prefix = 'lc-git-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

/** 在暫存目錄裡跑 git,身分寫死,不依賴跑測試的人有沒有設過 user.email */
function git(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', `user.name=${FALLBACK_IDENTITY.name}`, '-c', `user.email=${FALLBACK_IDENTITY.email}`, '-C', dir, ...args],
    { encoding: 'utf8' },
  );
}

/** 這個目錄的 commit 數(沒有 commit 時回 0) */
function commitCount(dir: string): number {
  const r = spawnSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  return Number(r.stdout.trim());
}

/** HEAD 往下每一個 commit 的訊息,新的在前 */
function commitMessages(dir: string): string[] {
  const r = spawnSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter((l) => l.length > 0);
}

/** HEAD 這個 commit 追蹤到的檔案清單 */
function trackedFiles(dir: string): string[] {
  return git(dir, 'ls-tree', '-r', '--name-only', 'HEAD')
    .split('\n')
    .filter((l) => l.length > 0)
    .sort();
}

/** 把 PATH 換成一個空目錄跑一段程式,模擬「這台機器沒有 git」 */
function withoutGitOnPath<T>(fn: () => T): T {
  const empty = tempDir('lc-nopath-');
  const original = process.env.PATH;
  process.env.PATH = empty;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
}

/** 一個建好目錄樹、但還沒有版本控制的 learning 目錄 */
function learningDir(): string {
  const d = tempDir('lc-learning-');
  initLearningDir(d, { today: new Date('2026-09-10T00:00:00Z') });
  return d;
}

// ---------------------------------------------------------------- 純函式

describe('snapshotMessage', () => {
  it.each([
    [new Date(2026, 8, 4), 'snapshot 2026-09-04'],
    [new Date(2026, 0, 1), 'snapshot 2026-01-01'],
    [new Date(2026, 11, 31), 'snapshot 2026-12-31'],
  ])('%s -> %s', (date, expected) => {
    expect(snapshotMessage(date)).toBe(expected);
  });

  it('pads both the month and the day to two digits', () => {
    expect(snapshotMessage(new Date(2026, 4, 7))).toBe('snapshot 2026-05-07');
  });

  it('uses the local calendar date, not the UTC instant', () => {
    // 當地時間 2026-09-04 23:30。UTC 在 UTC+N 的時區會已經是 09-05,
    // 但「今天」對使用者來說還是 09-04。
    expect(snapshotMessage(new Date(2026, 8, 4, 23, 30))).toBe('snapshot 2026-09-04');
  });
});

// ---------------------------------------------------------------- .gitignore 的內容

describe('LEARNING_GITIGNORE', () => {
  /** 寫進一個真的 repo 再問 git,而不是比對字串——真正重要的是 git 的判定 */
  function checkIgnored(paths: string[]): Record<string, boolean> {
    const dir = tempDir('lc-ignore-');
    git(dir, 'init', '-q');
    writeFileSync(join(dir, '.gitignore'), LEARNING_GITIGNORE, 'utf8');
    const out: Record<string, boolean> = {};
    for (const p of paths) {
      const full = join(dir, p);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, 'x', 'utf8');
      const r = spawnSync('git', ['-C', dir, 'check-ignore', '-q', p], { encoding: 'utf8' });
      out[p] = r.status === 0;
    }
    return out;
  }

  it('ignores the top level assets directory', () => {
    expect(checkIgnored(['assets/diagram.png'])['assets/diagram.png']).toBe(true);
  });

  it('ignores atomic-write temp files from both tmp naming schemes', () => {
    const result = checkIgnored([
      'state/needs-review.json.tmp',
      'state/.reviews.json.1234.1700000000000.tmp',
    ]);
    expect(result['state/needs-review.json.tmp']).toBe(true);
    expect(result['state/.reviews.json.1234.1700000000000.tmp']).toBe(true);
  });

  it('tracks everything else the contract §12 tree contains', () => {
    const tracked = [
      'raw/security/basics.md',
      'cards/security/sec-0001.md',
      'questions/sec-0001.yaml',
      'state/reviews.json',
      'state/weekly.json',
      'state/log.jsonl',
      'graph/deps.json',
      'config/categories.yaml',
      'config/settings.yaml',
    ];
    const result = checkIgnored(tracked);
    for (const p of tracked) expect(result[p], `${p} 不該被忽略`).toBe(false);
  });

  it('does not ignore a nested assets directory, only the top level one', () => {
    const p = 'cards/security/assets/note.md';
    expect(checkIgnored([p])[p]).toBe(false);
  });

  it('mentions the contract section it comes from', () => {
    expect(LEARNING_GITIGNORE).toContain('§11b');
    expect(LEARNING_GITIGNORE).toContain('ADR-042');
  });

  it('ends with a newline', () => {
    expect(LEARNING_GITIGNORE.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------- 給人看的訊息
//
// 下面每個 `expect(result.hint).toBe(NOT_A_REPO_HINT)` 都是拿常數比常數,常數被清空
// 也照樣綠。這幾條盯的是「裡面到底寫了什麼」——訊息沒說清楚要做什麼,使用者就卡住了。

describe('the hints and warnings', () => {
  it('tells the person git is missing and that they can re-run init later', () => {
    expect(GIT_UNAVAILABLE_WARNING).toContain('warning');
    expect(GIT_UNAVAILABLE_WARNING).toContain('找不到 git 命令');
    expect(GIT_UNAVAILABLE_WARNING).toContain('§11b');
    expect(GIT_UNAVAILABLE_WARNING).toContain('再跑一次 init');
  });

  it('tells the person the directory is missing and points at --dir', () => {
    expect(MISSING_DIR_HINT).toContain('不存在');
    expect(MISSING_DIR_HINT).toContain('--dir');
  });

  it('tells the person the directory is not its own repo and points at the init command', () => {
    expect(NOT_A_REPO_HINT).toContain('不是它自己的 git repo');
    expect(NOT_A_REPO_HINT).toContain('cli.ts init');
  });
});

// ---------------------------------------------------------------- isGitAvailable / isOwnGitRepo

describe('isGitAvailable', () => {
  it('is true on a machine that has git', () => {
    expect(isGitAvailable()).toBe(true);
  });

  it('is false when git is not on the PATH', () => {
    expect(withoutGitOnPath(() => isGitAvailable())).toBe(false);
  });
});

describe('isOwnGitRepo', () => {
  it('is false for a plain directory', () => {
    expect(isOwnGitRepo(learningDir())).toBe(false);
  });

  it('is true for a directory that has been git init-ed', () => {
    const dir = learningDir();
    git(dir, 'init', '-q');
    expect(isOwnGitRepo(dir)).toBe(true);
  });

  it('is false for a directory that merely sits inside another repo', () => {
    // 這是真正的情況:learning/ 常常就放在主 repo 底下。
    // `rev-parse --is-inside-work-tree` 在這裡會回 true(它找到上層的 repo),
    // 所以不能用那句話判斷。
    const parent = tempDir('lc-parent-');
    git(parent, 'init', '-q');
    const nested = join(parent, 'learning');
    mkdirSync(nested);
    expect(isOwnGitRepo(nested)).toBe(false);
  });

  it('is false for a directory that does not exist', () => {
    expect(isOwnGitRepo(join(tempDir(), 'nope'))).toBe(false);
  });

  it('is false when git is not on the PATH', () => {
    const dir = learningDir();
    git(dir, 'init', '-q');
    expect(withoutGitOnPath(() => isOwnGitRepo(dir))).toBe(false);
  });
});

// ---------------------------------------------------------------- initGitRepo

describe('initGitRepo', () => {
  it('creates the repo, the .gitignore and one commit named init', () => {
    const dir = learningDir();

    const result = initGitRepo(dir);

    expect(result).toEqual({ status: 'created', wroteGitignore: true, committed: true });
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(LEARNING_GITIGNORE);
    expect(commitMessages(dir)).toEqual([INIT_COMMIT_MESSAGE]);
  });

  it('commits the state and config files but not assets', () => {
    const dir = learningDir();
    writeFileSync(join(dir, 'assets/diagram.png'), 'not really a png', 'utf8');

    initGitRepo(dir);

    expect(trackedFiles(dir)).toEqual([
      '.gitignore',
      'config/categories.yaml',
      'config/settings.yaml',
      'graph/deps.json',
      'state/reviews.json',
      'state/weekly.json',
    ]);
  });

  it('leaves a clean working tree behind', () => {
    const dir = learningDir();
    writeFileSync(join(dir, 'assets/diagram.png'), 'not really a png', 'utf8');

    initGitRepo(dir);

    expect(git(dir, 'status', '--porcelain').trim()).toBe('');
  });

  it('is idempotent: a second run neither re-inits nor adds a second init commit', () => {
    const dir = learningDir();
    initGitRepo(dir);
    const headBefore = git(dir, 'rev-parse', 'HEAD').trim();

    const second = initGitRepo(dir);

    expect(second).toEqual({ status: 'existing', wroteGitignore: false, committed: false });
    expect(commitCount(dir)).toBe(1);
    expect(commitMessages(dir)).toEqual([INIT_COMMIT_MESSAGE]);
    expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(headBefore);
  });

  it('does not overwrite a .gitignore the user has edited', () => {
    const dir = learningDir();
    initGitRepo(dir);
    writeFileSync(join(dir, '.gitignore'), '/assets/\nmy-own-rule/\n', 'utf8');

    initGitRepo(dir);

    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('/assets/\nmy-own-rule/\n');
  });

  it('initialises a directory that sits inside another repo as its own repo', () => {
    const parent = tempDir('lc-parent-');
    git(parent, 'init', '-q');
    const nested = join(parent, 'learning');
    mkdirSync(nested);
    initLearningDir(nested, { today: new Date('2026-09-10T00:00:00Z') });

    const result = initGitRepo(nested);

    expect(result.status).toBe('created');
    expect(existsSync(join(nested, '.git'))).toBe(true);
    expect(isOwnGitRepo(nested)).toBe(true);
    // 上層的 repo 完全沒有被動到
    expect(commitCount(parent)).toBe(0);
  });

  it('warns instead of failing when git is not installed', () => {
    const dir = learningDir();

    const result = withoutGitOnPath(() => initGitRepo(dir));

    expect(result.status).toBe('git-unavailable');
    expect(result.wroteGitignore).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.warning).toBe(GIT_UNAVAILABLE_WARNING);
    expect(existsSync(join(dir, '.git'))).toBe(false);
  });

  it('still works when the machine has no configured git identity', () => {
    const dir = learningDir();
    const originalGlobal = process.env.GIT_CONFIG_GLOBAL;
    const originalSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';
    try {
      const result = initGitRepo(dir);
      expect(result.status).toBe('created');
      expect(commitMessages(dir)).toEqual([INIT_COMMIT_MESSAGE]);
      expect(git(dir, 'log', '-1', '--format=%ae').trim()).toBe(FALLBACK_IDENTITY.email);
    } finally {
      if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
      if (originalSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = originalSystem;
    }
  });

  it('keeps the identity the user has configured for that repo', () => {
    const dir = learningDir();
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'Someone Real');
    git(dir, 'config', 'user.email', 'someone@example.com');
    // 已經是 repo 了,所以 initGitRepo 會跳過。身分要驗到,就得讓**我們的程式**真的
    // 做出一個 commit——所以先鋪一個底,再製造變更讓 snapshot 非 commit 不可。
    // (helper git() 一律帶 `-c user.email=…`,而 `-c` 的優先權高於 repo local config,
    //  所以由 helper 做的 commit 驗不到 identityArgs();HEAD 必須是程式做的那一個。)
    writeFileSync(join(dir, '.gitignore'), LEARNING_GITIGNORE, 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', INIT_COMMIT_MESSAGE);
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');

    const result = snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(result.status).toBe('committed');
    expect(commitMessages(dir)).toEqual(['snapshot 2026-09-04', INIT_COMMIT_MESSAGE]);
    // 這一行才是重點:HEAD 是 snapshotLearningDir() 做的 commit,
    // 它的身分必須是使用者設在這個 repo 上的那一個,不是 FALLBACK_IDENTITY。
    expect(git(dir, 'log', '-1', '--format=%ae').trim()).toBe('someone@example.com');
    expect(git(dir, 'log', '-1', '--format=%an').trim()).toBe('Someone Real');
    expect(git(dir, 'log', '-1', '--format=%ae').trim()).not.toBe(FALLBACK_IDENTITY.email);
  });
});

// ---------------------------------------------------------------- snapshotLearningDir

describe('snapshotLearningDir', () => {
  /** 一個已經 init 過、有第一個 commit 的 learning repo */
  function initialised(): string {
    const dir = learningDir();
    initGitRepo(dir);
    return dir;
  }

  it('commits the changes with a snapshot message carrying the date', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');

    const result = snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(result.status).toBe('committed');
    expect(result.message).toBe('snapshot 2026-09-04');
    expect(commitMessages(dir)).toEqual(['snapshot 2026-09-04', INIT_COMMIT_MESSAGE]);
  });

  it('picks up new files as well as changed ones (add -A)', () => {
    const dir = initialised();
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), '# card\n', 'utf8');

    snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(trackedFiles(dir)).toContain('cards/security/sec-0001.md');
  });

  it('picks up deletions as well (add -A)', () => {
    const dir = initialised();
    rmSync(join(dir, 'graph/deps.json'));

    snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(trackedFiles(dir)).not.toContain('graph/deps.json');
  });

  it('does not commit the ignored assets directory', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'assets/diagram.png'), 'not really a png', 'utf8');
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');

    snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(trackedFiles(dir)).not.toContain('assets/diagram.png');
  });

  it('makes no commit when nothing changed and still succeeds', () => {
    const dir = initialised();
    const before = commitCount(dir);

    const result = snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(result.status).toBe('no-changes');
    expect(result.message).toBeUndefined();
    expect(commitCount(dir)).toBe(before);
  });

  it('running twice in a row makes exactly one commit', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');

    const first = snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });
    const countAfterFirst = commitCount(dir);
    const second = snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(first.status).toBe('committed');
    expect(second.status).toBe('no-changes');
    expect(commitCount(dir)).toBe(countAfterFirst);
  });

  it('reports not-a-repo with the init hint for a directory that was never initialised', () => {
    const dir = learningDir();

    const result = snapshotLearningDir(dir, { today: new Date(2026, 8, 4) });

    expect(result.status).toBe('not-a-repo');
    expect(result.hint).toBe(NOT_A_REPO_HINT);
  });

  it('never commits into the parent repo when the learning dir is nested inside one', () => {
    const parent = tempDir('lc-parent-');
    git(parent, 'init', '-q');
    const nested = join(parent, 'learning');
    mkdirSync(nested);
    initLearningDir(nested, { today: new Date('2026-09-10T00:00:00Z') });

    const result = snapshotLearningDir(nested, { today: new Date(2026, 8, 4) });

    expect(result.status).toBe('not-a-repo');
    expect(commitCount(parent)).toBe(0);
    expect(git(parent, 'status', '--porcelain')).toContain('learning/');
  });

  it('reports missing-dir for a directory that does not exist', () => {
    const result = snapshotLearningDir(join(tempDir(), 'nope'), { today: new Date(2026, 8, 4) });

    expect(result.status).toBe('missing-dir');
    expect(result.hint).toBe(MISSING_DIR_HINT);
  });

  it('reports git-unavailable when git is not installed', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');

    const result = withoutGitOnPath(() => snapshotLearningDir(dir, { today: new Date(2026, 8, 4) }));

    expect(result.status).toBe('git-unavailable');
    expect(result.hint).toBe(GIT_UNAVAILABLE_WARNING);
    expect(commitCount(dir)).toBe(1);
  });

  it('defaults to today when no date is given', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');

    const result = snapshotLearningDir(dir);

    expect(result.message).toBe(snapshotMessage(new Date()));
  });

  it('throws instead of quietly reporting success when a git command fails', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');
    // 卡住索引 → `git add -A` 一定失敗。這一步安靜吞掉的話,使用者會以為今天的
    // snapshot 建好了,真正需要回溯的那一天才發現什麼都沒有。
    writeFileSync(join(dir, '.git/index.lock'), '', 'utf8');
    try {
      expect(() => snapshotLearningDir(dir, { today: new Date(2026, 8, 4) })).toThrow(/git add 失敗/);
    } finally {
      rmSync(join(dir, '.git/index.lock'), { force: true });
    }
    // 而且真的沒有多出一個 commit
    expect(commitCount(dir)).toBe(1);
  });

  it('works when the machine has no configured git identity', () => {
    const dir = initialised();
    writeFileSync(join(dir, 'state/reviews.json'), '{"sec-0001":{"stage":2}}\n', 'utf8');
    const originalGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    try {
      expect(snapshotLearningDir(dir, { today: new Date(2026, 8, 4) }).status).toBe('committed');
    } finally {
      if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
    }
  });
});
