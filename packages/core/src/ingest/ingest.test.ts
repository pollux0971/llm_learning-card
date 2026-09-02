import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest } from './ingest.js';
import { FakeLlmRouter, CloudRequiredError } from './fake-llm.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';
import { ensureInitialized } from './init.js';

function threeCardRouter(): LlmRouter {
  const text = JSON.stringify([
    { title: '卡一', body: '第一張卡的正文內容。', examples: [], lines: [1, 2] },
    { title: '卡二', body: '第二張卡的正文內容。', examples: [], lines: [3, 4] },
    { title: '卡三', body: '第三張卡的正文內容。', examples: [], lines: [5, 6] },
  ]);
  return {
    async call(): Promise<LlmResult> {
      return { text, provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function alwaysCloudRequired(): LlmRouter {
  return {
    async call(task: LlmTask) {
      throw new CloudRequiredError(task);
    },
    async probeOnline() {
      return false;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

describe('runIngest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-ingest-run-'));
    ensureInitialized(dir);
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    writeFileSync(join(dir, 'raw/security/x.md'), '一些原始內容\n'.repeat(10), 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('成功時寫入卡片、更新 ingested.json、記 ingested 事件', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: threeCardRouter() });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.cardsCreated).toEqual(['sec-0001', 'sec-0002', 'sec-0003']);

    const state = JSON.parse(readFileSync(join(dir, 'state/ingested.json'), 'utf8'));
    expect(state['raw/security/x.md'].cardIds).toEqual(result.cardsCreated);

    const events = readFileSync(join(dir, 'state/log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const ingested = events.find((e) => e.type === 'ingested');
    expect(ingested).toMatchObject({ file: 'raw/security/x.md', cards_created: 3 });
  });

  it('每張卡的 source_ref 指到 raw/<category>/<file>#L<a>-L<b>', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: threeCardRouter() });
    const card1 = readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8');
    expect(card1).toContain('source_ref: raw/security/x.md#L1-L2');
  });

  it('再跑一次同一個檔案:不重新呼叫 LLM,回報已處理過', async () => {
    await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: threeCardRouter() });
    let calls = 0;
    const countingRouter: LlmRouter = {
      async call() {
        calls++;
        throw new Error('不該被呼叫');
      },
      async probeOnline() {
        return true;
      },
      async probeLocal() {
        return { available: false, models: [] };
      },
    };
    const second = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: countingRouter });
    expect(second.alreadyProcessed).toBe(true);
    expect(second.cardsCreated).toHaveLength(3);
    expect(calls).toBe(0);
  });

  it('空白 raw 檔:不寫卡,回報無可用內容,exitCode 非 0', async () => {
    writeFileSync(join(dir, 'raw/security/empty.md'), '   \n\t\n', 'utf8');
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/empty.md', category: 'security', router: threeCardRouter() });
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.cardsCreated).toHaveLength(0);
  });

  it('router 回報 CLOUD_REQUIRED:不寫卡,不拋出未捕捉的例外', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: alwaysCloudRequired() });
    expect(result.ok).toBe(false);
    expect(result.cardsCreated).toHaveLength(0);
    expect(result.message).toMatch(/雲端/);
  });

  it('raw 檔不存在:不寫卡,exitCode 非 0', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/nope.md', category: 'security', router: threeCardRouter() });
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('搭配真的 FakeLlmRouter 讀 contracts/fixtures/llm 的 web-basics 情境', async () => {
    writeFileSync(join(dir, 'raw/security/web-basics.md'), '一些內容\n'.repeat(100), 'utf8');
    const router = new FakeLlmRouter({ fixturesDir: join(process.cwd(), 'contracts/fixtures/llm') });
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/web-basics.md', category: 'security', router });
    expect(result.ok).toBe(true);
    expect(result.cardsCreated.length).toBeGreaterThanOrEqual(3);
  });
});
