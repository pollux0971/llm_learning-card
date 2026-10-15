/**
 * T11 驗收補測(驗收者寫):「底下」的路徑邊界,兩個 e5 的測試沒釘到的方向。
 *
 * 突變 Q2:`rel.startsWith(`..${sep}`)` 改成 `startsWith('..')` —— 名字以兩個點開頭的目錄(`golden/..hidden`)
 *   會被當成 golden/ 的外面,dirty 的 prompt 就能寫進 golden/。
 * 突變 Q3:拿掉 `rel === '..'` —— golden/ 的上一層(`prompt-quality/`)會被當成 golden/ 底下,誤拒絕。
 * 全部在 mkdtemp 的 git repo 裡做,不碰真的 golden/。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DirtyPromptError, runGolden } from './golden-run.js';
import { getGoldenSet } from './golden-sets/registry.js';
import type { GoldenRunMeta } from './types.js';

const PROMPT = (getGoldenSet('selftest') ?? { promptFile: 'MISSING' }).promptFile;
const GOLDEN_REL = 'packages/core/src/prompt-quality/golden';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.test', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗:${r.stderr}`);
  return r.stdout.trim();
}

function dirtyPromptRepo(): string {
  const root = tmp('pq-bound-repo-');
  git(root, 'init', '-q');
  mkdirSync(join(root, PROMPT, '..'), { recursive: true });
  writeFileSync(join(root, PROMPT), '# committed\n');
  git(root, 'add', '--', PROMPT);
  git(root, 'commit', '-q', '-m', 'c');
  writeFileSync(join(root, PROMPT), '# edited, not committed\n');
  return root;
}

describe('T11 驗收補測:golden/ 底下的路徑邊界', () => {
  it('名字以兩個點開頭的目錄在 golden/ 底下(golden/..hidden):dirty 的 prompt 被拒絕,什麼都沒建', async () => {
    const root = dirtyPromptRepo();
    const out = join(root, GOLDEN_REL, '..hidden');
    await expect(runGolden({ set: 'selftest', today: '2026-09-10', mode: 'fake', root, baseDir: out })).rejects.toBeInstanceOf(DirtyPromptError);
    expect(existsSync(join(root, GOLDEN_REL))).toBe(false);
  });

  it('golden/ 的上一層(prompt-quality/)在 golden/ 外面:dirty 的 prompt 照常寫,meta 是 -dirty', async () => {
    const root = dirtyPromptRepo();
    const out = join(root, 'packages/core/src/prompt-quality');
    const result = await runGolden({ set: 'selftest', today: '2026-09-10', mode: 'fake', root, baseDir: out });
    expect(result.dir.startsWith(out)).toBe(true);
    const meta = JSON.parse(readFileSync(join(result.dir, 'meta.json'), 'utf8')) as GoldenRunMeta;
    expect(meta.promptFileGitCommit).toMatch(/-dirty$/);
  });

  it('golden/ 本身與它底下很深的新路徑都拒絕;golden/ 的兄弟(golden-fake、golden-extra)與 root 本身不拒絕', async () => {
    for (const rel of [GOLDEN_REL, `${GOLDEN_REL}/a/b/c`]) {
      const root = dirtyPromptRepo();
      await expect(runGolden({ set: 'selftest', today: '2026-09-10', mode: 'fake', root, baseDir: join(root, rel) })).rejects.toBeInstanceOf(DirtyPromptError);
    }
    for (const rel of ['packages/core/src/prompt-quality/golden-fake', 'packages/core/src/prompt-quality/golden-extra', 'out']) {
      const root = dirtyPromptRepo();
      const result = await runGolden({ set: 'selftest', today: '2026-09-10', mode: 'fake', root, baseDir: join(root, rel) });
      expect(result.dir.startsWith(join(root, rel))).toBe(true);
    }
  });
});
