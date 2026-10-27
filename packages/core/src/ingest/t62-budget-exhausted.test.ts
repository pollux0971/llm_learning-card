/**
 * T62 紅測試(單元):runIngest 遇到「今日預算已用完」(BUDGET_EXCEEDED)回一句話、不寫任何卡。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T62-ingest-cli-verified-ledger.md 第 5 點。跟 isCloudRequiredError 一樣看 `code`,不看類別名。
 *   - router 丟 DailyBudgetExceededError → { ok:false, exitCode:1 },訊息有「今日預算已用完」與 LLM_DAILY_CAP_USD、只有一行;
 *     cards/ 與 state/ 的樹雜湊前後一樣;
 *   - 只有 code 是 BUDGET_EXCEEDED 的普通物件也一樣(不看類別名);類別名叫 DailyBudgetExceededError 但 code 不是 → 照丟;
 *   - 別的錯照丟(一般錯誤、GraphFileCorruptError);原本的 CLOUD_REQUIRED 訊息不變;
 *   - 掃描:每個檔都被拒絕也不停下(兩個都進失敗清單),沒有丟錯。
 * 學習資料夾用暫存目錄、假 router;LLM 真呼叫 0。
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CloudRequiredError, DailyBudgetExceededError } from '@core/llm/index.js';
import type { LlmResult } from '@core/llm/index.js';
import { GraphFileCorruptError } from './errors.js';
import { runIngest } from './ingest.js';
import { loadScan, makeLearning, rawText, treeHash, writeRaw } from './t53-test-support.js';
import type { LlmRouter } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function learning(): string {
  const d = makeLearning();
  dirs.push(d);
  return d;
}

function throwingRouter(error: unknown): { router: LlmRouter; calls: () => number } {
  let n = 0;
  const router = {
    async call(): Promise<LlmResult> {
      n += 1;
      throw error;
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  } as unknown as LlmRouter;
  return { router, calls: () => n };
}

async function ingestWith(error: unknown) {
  const dir = learning();
  writeRaw(dir, 'security', 'x.md', rawText('t62'));
  const before = { cards: treeHash(join(dir, 'cards')), state: treeHash(join(dir, 'state')) };
  const { router, calls } = throwingRouter(error);
  const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router });
  return { result, calls: calls(), before, after: { cards: treeHash(join(dir, 'cards')), state: treeHash(join(dir, 'state')) } };
}

describe('T62 runIngest:預算用完', () => {
  it('router 丟 DailyBudgetExceededError:ok:false、exitCode 1、一句話(今日預算已用完 + LLM_DAILY_CAP_USD)、cards/ 與 state/ 不變', async () => {
    const r = await ingestWith(new DailyBudgetExceededError('ingest.cards', 1.2345, 1));
    expect(r.result.ok).toBe(false);
    expect(r.result.exitCode).toBe(1);
    expect(r.result.cardsCreated).toEqual([]);
    expect(r.result.message).toContain('今日預算已用完');
    expect(r.result.message).toContain('LLM_DAILY_CAP_USD');
    expect(r.result.message.includes('\n'), `只能一行:${JSON.stringify(r.result.message)}`).toBe(false);
    expect(r.after).toEqual(r.before);
    expect(r.calls).toBe(1);
  });

  it('只有 code 是 BUDGET_EXCEEDED 的普通物件(不是那個類別)也一樣:看 code,不看類別名', async () => {
    const r = await ingestWith(Object.assign(new Error('預算'), { code: 'BUDGET_EXCEEDED' }));
    expect(r.result.ok).toBe(false);
    expect(r.result.message).toContain('今日預算已用完');
    expect(r.after).toEqual(r.before);
  });

  it('名字叫 DailyBudgetExceededError、code 卻不是 BUDGET_EXCEEDED:不是預算用完,照丟', async () => {
    const fake = Object.assign(new Error('長得像'), { name: 'DailyBudgetExceededError', code: 'SOMETHING_ELSE' });
    await expect(ingestWith(fake)).rejects.toBe(fake);
  });

  it('別的錯照丟:一般錯誤、GraphFileCorruptError', async () => {
    const boom = new Error('boom');
    await expect(ingestWith(boom)).rejects.toBe(boom);
    const corrupt = new GraphFileCorruptError('/x/deps.json', '{', new Error('bad'));
    await expect(ingestWith(corrupt)).rejects.toBe(corrupt);
  });

  it('原本的 CLOUD_REQUIRED 還是原本那句話(不被預算那個分支蓋掉)', async () => {
    const r = await ingestWith(new CloudRequiredError('ingest.cards'));
    expect(r.result.ok).toBe(false);
    expect(r.result.message).toContain('ingest 需要雲端模型');
    expect(r.result.message).not.toContain('預算');
  });
});

describe('T62 掃描:每個檔都被預算拒絕也不停下', () => {
  it('兩個新檔:兩個都進失敗清單(message 有兩個檔名與「今日預算已用完」),掃描沒有丟錯,router 各被叫過(第二個沒被第一個的失敗擋掉)', async () => {
    const scan = await loadScan();
    const dir = learning();
    writeRaw(dir, 'security', 'a.md', rawText('a'));
    writeRaw(dir, 'security', 'b.md', rawText('b'));
    const { router, calls } = throwingRouter(new DailyBudgetExceededError('ingest.cards', 2, 1));
    const result = await scan({ outDir: dir, router, category: 'security', today: '2026-09-10', levelZeroOnly: true });
    expect(result.processed).toEqual([]);
    expect(result.message).toContain('raw/security/a.md');
    expect(result.message).toContain('raw/security/b.md');
    expect(result.message).toContain('今日預算已用完');
    expect(calls()).toBe(2);
  });
});
