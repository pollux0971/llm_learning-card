/**
 * T55 單元測試 E:`scripts/ingest.ts --topic` 的 CLI 層(只測不需要 LLM 的部分——`--fake` 的回應檔在 contracts/fixtures/llm,這張不新增)。測試 agent 寫;開發 worker 不改。
 *   - 主題正規化後空的、超過 200 個 code point:退出碼 1,輸出目錄前後相同,而且不是因為「假 router 沒有預錄回應」才失敗(要是 LLM 被叫了,輸出會有那句)
 *   - 同一個分類、同一個主題已經生成過:退出碼 0,印「已經生成過」並列出卡 id,不呼叫 LLM、卡與 ingested.json 不動
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REPO_ROOT, loadScan, makeLearning, treeHash } from './t53-test-support.js';
import { topicRouter } from './t55-test-support.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const SCRIPT = join(REPO_ROOT, 'scripts/ingest.ts');
function run(args: string[]): { status: number | null; out: string } {
  const { NODE_OPTIONS: _ignored, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--fake', ...args], { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 120_000 });
  return { status: r.error ? null : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const peach = () => makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);

describe('T55 E. CLI:主題不合法', () => {
  for (const [name, topic] of [['只有空白', '   '], ['201 個字', '字'.repeat(201)]] as const) {
    it(`${name}:退出碼 1、目錄前後相同、LLM 沒被叫`, () => {
      const dir = peach();
      const before = treeHash(dir);
      const r = run(['--out', dir, '--category', 'peach', '--topic', topic]);
      expect(r.status, r.out).toBe(1);
      expect(r.out, 'LLM 被叫了的話假 router 會抱怨沒有預錄回應').not.toMatch(/預錄回應|FakeLlmRouter/);
      expect(treeHash(dir)).toBe(before);
    });
  }
});

describe('T55 E. CLI:已經生成過', () => {
  it('同一個主題(只差空白)再跑:退出碼 0、印「已經生成過」與卡 id、卡與 ingested.json 位元組不變、LLM 沒被叫', async () => {
    const scan = await loadScan();
    const dir = peach();
    const first = await scan({ outDir: dir, router: topicRouter().router, category: 'peach', topic: '光合作用 的基本過程', today: '2026-09-10', levelZeroOnly: true });
    const ids = first.topicGenerated!;
    expect(ids.length).toBe(3);
    const cards = treeHash(join(dir, 'cards'));
    const state = readFileSync(join(dir, 'state/ingested.json'), 'utf8');
    const r = run(['--out', dir, '--category', 'peach', '--topic', '  光合作用   的基本過程 ']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/已經生成過/);
    for (const id of ids) expect(r.out).toContain(id);
    expect(r.out).not.toMatch(/預錄回應|FakeLlmRouter/);
    expect(treeHash(join(dir, 'cards'))).toBe(cards);
    expect(readFileSync(join(dir, 'state/ingested.json'), 'utf8')).toBe(state);
  });
});
