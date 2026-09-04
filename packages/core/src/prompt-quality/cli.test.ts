import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './cli.js';
import { DEFAULT_GOLDEN_BASE_DIR, DEFAULT_FAKE_GOLDEN_BASE_DIR } from './golden-run.js';

// 每個會寫檔的測試都用 --out 指到自己的暫存目錄,afterEach 只清這些暫存目錄。
// 絕對不對 repo 裡的 golden/ 或 golden-fake/ 讀寫或刪除:那些是真的基準資料,
// 「跑 npm test 就把 git 追蹤的 golden 檔刪掉」正是 ADR-032 要防的靜默毀掉品質(審核意見)。
const tmpDirs: string[] = [];
function tmpOutDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pq-cli-'));
  tmpDirs.push(d);
  return d;
}

function snapshotRepoGoldenDirs(): string {
  const list = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);
  return JSON.stringify({ golden: list(DEFAULT_GOLDEN_BASE_DIR), fake: list(DEFAULT_FAKE_GOLDEN_BASE_DIR) });
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('cli main', () => {
  it('--golden --fake 沒指定 task 時,跑內建的 demo golden set,退出碼 0', async () => {
    const out = tmpOutDir();
    const result = await main(['--golden', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.output).toContain('golden');
    expect(result.output).toMatch(/處理了 \d+ 個 golden 輸入/);
    expect(existsSync(join(out, 'grade.apply'))).toBe(true);
  });

  it('--golden --out 指到哪裡就寫到哪裡,不碰 repo 裡的 golden 目錄', async () => {
    const before = snapshotRepoGoldenDirs();
    const out = tmpOutDir();
    const result = await main(['--golden', '--task', 'grade.apply', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.output).toContain(out);
    expect(snapshotRepoGoldenDirs()).toBe(before);
  });

  it('--out 沒接目錄時報錯', async () => {
    const result = await main(['--golden', '--fake', '--out']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--out');
  });

  it('--golden --task 指定不存在的 task,清楚報錯並指出定義檔位置', async () => {
    const result = await main(['--golden', '--task', 'deepen', '--fake', '--out', tmpOutDir()]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('deepen');
    expect(result.output).toMatch(/registry\.ts/);
  });

  // phase-2 起 --live 是真的模式(見 live-run.test.ts)。這裡只驗 CLI 這一層的旗標處理,
  // 不打網路——真正的 live 行為由 runGolden 負責。
  it('--fake 與 --live 同時給時拒絕', async () => {
    const result = await main(['--golden', '--fake', '--live', '--out', tmpOutDir()]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--live');
  });

  it('用法字串把 --live 列出來', async () => {
    const result = await main([]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--live');
  });

  it('--diff 少給目錄時報錯', async () => {
    const result = await main(['--diff', 'only-one-dir']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--diff');
  });

  it('沒有任何已知旗標時顯示用法並以非 0 結束', async () => {
    const result = await main([]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('用法');
  });

  it('跑兩次 golden 再 diff,兩邊輸出都顯示出來', async () => {
    const out = tmpOutDir();
    const first = await main(['--golden', '--task', 'grade.apply', '--fake', '--out', out]);
    expect(first.code).toBe(0);

    // 找出剛剛寫出的目錄(golden-run.test.ts 已驗證過寫檔細節,這裡只重用它產生的路徑)
    const match = first.output.match(/→ (.+grade\.apply\/[\d-]+)\(/);
    expect(match).toBeTruthy();
    const dir = match![1]!;
    expect(dir.startsWith(out)).toBe(true);
    expect(existsSync(dir)).toBe(true);

    const diff = await main(['--diff', dir, dir]);
    expect(diff.code).toBe(0);
    expect(diff.output).toContain('grade.apply');
    for (const line of diff.output.split('\n')) {
      if (line.startsWith('- ')) expect(line).toContain('(相同)');
    }
  });
});
