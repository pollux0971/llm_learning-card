/**
 * ADR-051:learning/ 帳本要在所有 git worktree 之間解析成同一個路徑,理由跟
 * scripts/mutate.ts 的 strykerLockPath 測試同一套(`describe('strykerLockPath')`)——
 * 這裡照抄那套「main repo + 兩個 worktree」的手法,驗同一個保證。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveVaultLearningDir, resolveVaultRoot } from './vault.js';

const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** git init 一個 repo,再掛兩個 worktree。回主 repo 與兩個 worktree 的路徑。 */
function gitRepoWithWorktrees(): { main: string; wtA: string; wtB: string } {
  const base = tmp('vault-git');
  const main = join(base, 'main');
  mkdirSync(main, { recursive: true });
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${r.stderr ?? ''}`);
    return (r.stdout ?? '').trim();
  };
  git(main, 'init', '-q', '-b', 'main', '.');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  const wtA = join(base, 'wt-a');
  const wtB = join(base, 'wt-b');
  git(main, 'worktree', 'add', '-q', '-b', 'a', wtA);
  git(main, 'worktree', 'add', '-q', '-b', 'b', wtB);
  return { main, wtA, wtB };
}

describe('resolveVaultRoot', () => {
  it('兩個不同 worktree 算出來是同一個主簽出', () => {
    const { wtA, wtB } = gitRepoWithWorktrees();
    // 這條是整個修復的地基。算出各自 worktree 的話,每個 worktree 就有自己一份
    // learning/,花費上限也就跟著變成「每個簽出各自一份」——這正是 ADR-051 要堵的洞。
    expect(resolveVaultRoot(wtA)).toBe(resolveVaultRoot(wtB));
  });

  it('worktree 與主 repo 算出來也是同一個', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    expect(resolveVaultRoot(wtA)).toBe(resolveVaultRoot(main));
  });

  it('算出來的就是主 repo 本人的工作目錄', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    expect(resolveVaultRoot(wtA)).toBe(main);
  });

  it('回的是絕對路徑(主 repo 裡 git 會回相對的 .git,不 resolve 就會算錯)', () => {
    const { main } = gitRepoWithWorktrees();
    const p = resolveVaultRoot(main);
    expect(p).toBe(resolve(p));
  });

  it('worktree 的子目錄算出來還是同一個', () => {
    const { main, wtA } = gitRepoWithWorktrees();
    const sub = join(wtA, 'packages', 'core');
    mkdirSync(sub, { recursive: true });
    expect(resolveVaultRoot(sub)).toBe(main);
  });
});

describe('resolveVaultLearningDir', () => {
  it('是主簽出底下的 learning/,不是呼叫者站的那個 worktree', () => {
    const { main, wtA, wtB } = gitRepoWithWorktrees();
    const expected = join(main, 'learning');
    expect(resolveVaultLearningDir(wtA)).toBe(expected);
    expect(resolveVaultLearningDir(wtB)).toBe(expected);
    expect(resolveVaultLearningDir(main)).toBe(expected);
  });
});
