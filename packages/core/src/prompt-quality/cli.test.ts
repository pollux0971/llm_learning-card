import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { main } from './cli.js';
import { DEFAULT_GOLDEN_BASE_DIR } from './golden-run.js';

// runGolden() 預設寫進真的 repo 目錄(packages/core/src/prompt-quality/golden/)。
// 每個會呼叫 --golden 的測試跑完都要清掉,不留下測試產生的目錄。
const DEMO_TASK_DIR = join(DEFAULT_GOLDEN_BASE_DIR, 'grade.apply');

afterEach(() => {
  if (existsSync(DEMO_TASK_DIR)) rmSync(DEMO_TASK_DIR, { recursive: true, force: true });
});

describe('cli main', () => {
  it('--golden --fake 沒指定 task 時,跑內建的 demo golden set,退出碼 0', async () => {
    const result = await main(['--golden', '--fake']);
    expect(result.code).toBe(0);
    expect(result.output).toContain('golden');
    expect(result.output).toMatch(/處理了 \d+ 個 golden 輸入/);
  });

  it('--golden --task 指定不存在的 task,清楚報錯並指出定義檔位置', async () => {
    const result = await main(['--golden', '--task', 'deepen', '--fake']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('deepen');
    expect(result.output).toMatch(/registry\.ts/);
  });

  it('--live 在 phase-1 明確拒絕', async () => {
    const result = await main(['--golden', '--live']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('phase-2');
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
    const first = await main(['--golden', '--task', 'grade.apply', '--fake']);
    expect(first.code).toBe(0);

    // 找出剛剛寫出的目錄(golden-run.test.ts 已驗證過寫檔細節,這裡只重用它產生的路徑)
    const match = first.output.match(/→ (.+grade\.apply\/[\d-]+)\(/);
    expect(match).toBeTruthy();
    const dir = match![1]!;
    expect(existsSync(dir)).toBe(true);

    const diff = await main(['--diff', dir, dir]);
    expect(diff.code).toBe(0);
    expect(diff.output).toContain('grade.apply');
    for (const line of diff.output.split('\n')) {
      if (line.startsWith('- ')) expect(line).toContain('(相同)');
    }
  });
});
