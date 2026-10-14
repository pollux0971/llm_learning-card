/**
 * T0 特徵測試（驗收條件 3、4）。描述的是**現在的行為**，不是修好以後想守的行為。
 *
 * 合成 git 世界裡各呼叫一次 `createDefaultLiveRouter()` 裝上的 log appender
 * （假事件，不經過 adapter、不設 API key、不打網路）：
 * - 合成主簽出寫進自己的 `learning/state/log.jsonl`。
 * - 合成 worktree 寫進**合成主簽出**的帳本（ADR-051 在 worktree 層仍有效）。
 * - 合成 clone 寫進**那個 clone 自己的**帳本，不是合成主簽出。
 *
 * 對照放在同一條裡才是 T0 的內容：worktree 有效、clone 無效。現在會綠，用來證明
 * 問題存在。以後帳本範圍改成跨 clone 共用或 fail-closed 時，clone 那一半要翻紅，
 * 必須有意識地改這條，不能把它當成「clone 就該各記各的」來守護。
 *
 * 清理目標只有本檔 `mkdtempSync` 的回傳值。子行程在呼叫 router 之前若發現
 * 解析結果不在該沙箱裡，直接以非 0 結束、不寫帳；父行程仍斷言退出碼 0，
 * 所以那不是跳過斷言。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** 與 `packages/core/src/lint/index.test.ts` 同深度：`src/<dir>/` 再上四層是 repo 根。只拿來讀取要複製的原始碼。 */
const ROOT = resolve(import.meta.dirname, '../../../..');

const RUNNER = [
  "import { writeSync } from 'node:fs';",
  "import { createDefaultLiveRouter, ROOT } from './packages/core/src/prompt-quality/golden-run.ts';",
  "import { resolveVaultLearningDir } from './packages/core/src/llm/vault.ts';",
  '',
  'const marker = process.argv[2];',
  "const sandbox = process.env.T0_SANDBOX ?? '';",
  'const resolved = resolveVaultLearningDir(ROOT);',
  "if (sandbox.length === 0 || !resolved.startsWith(`${sandbox}/`)) {",
  '  writeSync(2, `refusing ledger outside sandbox: ${resolved}\\n`);',
  '  process.exit(2);',
  '}',
  'const router = createDefaultLiveRouter() as unknown as { cloudRouter?: { log?: (event: unknown) => void } };',
  'const log = router.cloudRouter?.log;',
  "if (typeof log !== 'function') {",
  "  writeSync(2, 'default router did not create a log appender\\n');",
  '  process.exit(3);',
  '}',
  'log({',
  "  ts: '2026-10-14T00:00:00+08:00',",
  "  type: 'llm_call',",
  "  provider: 'openai',",
  '  tokens_in: 1,',
  '  tokens_out: 1,',
  '  marker,',
  '});',
  'writeSync(1, `T0_RESOLVED=${resolved}\\n`);',
  'process.exit(0);',
  '',
].join('\n');

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失敗:${result.stderr ?? ''}`);
  }
}

function markersOf(logPath: string): string[] {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const event = JSON.parse(line) as { type?: string; marker?: string };
      expect(event.type).toBe('llm_call');
      return String(event.marker);
    });
}

describe('T0 特徵：repo 根帳本在 worktree 合成一份、在 clone 各記各的', () => {
  it(
    '合成 worktree 寫進合成主簽出的帳本；合成 clone 寫進自己的帳本（現況會綠，clone 範圍修好後這條要翻紅）',
    () => {
      const sandbox = mkdtempSync(join(tmpdir(), 't0-vault-clone-'));
      const main = join(sandbox, 'main');
      const worktree = join(sandbox, 'worktree');
      const clone = join(sandbox, 'clone');
      try {
        mkdirSync(main, { recursive: true });
        cpSync(join(ROOT, 'packages'), join(main, 'packages'), { recursive: true });
        cpSync(join(ROOT, 'contracts'), join(main, 'contracts'), { recursive: true });
        cpSync(join(ROOT, 'tsconfig.json'), join(main, 'tsconfig.json'));
        cpSync(join(ROOT, 'package.json'), join(main, 'package.json'));
        git(main, ['init', '-q', '-b', 'main', '.']);
        git(main, ['add', 'packages', 'contracts', 'tsconfig.json', 'package.json']);
        git(main, ['commit', '-q', '-m', 'synthetic source']);
        git(main, ['worktree', 'add', '-q', '-b', 'synthetic-worktree', worktree]);
        git(sandbox, ['clone', '-q', main, clone]);
        symlinkSync(join(ROOT, 'node_modules'), join(main, 'node_modules'));
        symlinkSync(join(ROOT, 'node_modules'), join(worktree, 'node_modules'));
        symlinkSync(join(ROOT, 'node_modules'), join(clone, 'node_modules'));

        const resolvedByMarker = new Map<string, string>();
        for (const [checkout, marker] of [
          [main, 'from-main'],
          [worktree, 'from-worktree'],
          [clone, 'from-clone'],
        ] as const) {
          const runner = join(checkout, '.t0-append-ledger.ts');
          writeFileSync(runner, RUNNER);
          const child = spawnSync(process.execPath, ['--import=tsx', runner, marker], {
            cwd: checkout,
            encoding: 'utf8',
            timeout: 60_000,
            env: { PATH: process.env.PATH ?? '', T0_SANDBOX: sandbox },
          });
          expect(child.status, `${marker}\n${child.stdout ?? ''}\n${child.stderr ?? ''}`).toBe(0);
          const line = (child.stdout ?? '').split('\n').find((row) => row.startsWith('T0_RESOLVED='));
          expect(line, child.stdout).toBeDefined();
          resolvedByMarker.set(marker, line?.slice('T0_RESOLVED='.length) ?? '');
        }

        const mainLearning = join(main, 'learning');
        const cloneLearning = join(clone, 'learning');
        expect(resolvedByMarker.get('from-main')).toBe(mainLearning);
        expect(resolvedByMarker.get('from-worktree')).toBe(mainLearning);
        expect(resolvedByMarker.get('from-clone')).toBe(cloneLearning);
        expect(cloneLearning).not.toBe(mainLearning);

        const mainLog = join(mainLearning, 'state/log.jsonl');
        const cloneLog = join(cloneLearning, 'state/log.jsonl');
        expect(markersOf(mainLog)).toEqual(['from-main', 'from-worktree']);
        expect(existsSync(join(worktree, 'learning'))).toBe(false);
        expect(markersOf(cloneLog)).toEqual(['from-clone']);
        expect(readFileSync(mainLog, 'utf8')).not.toContain('"marker":"from-clone"');
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
