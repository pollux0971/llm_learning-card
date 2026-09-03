import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** 單卡 router,cards 內容由呼叫端組出——用於測邊界行為(clampLines、parked、regenerate)。 */
function singleCardRouter(cards: Array<{ title: string; body: string; examples: string[]; lines: [number, number] }>): LlmRouter {
  return {
    async call(): Promise<LlmResult> {
      return { text: JSON.stringify(cards), provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

/** 每次呼叫都回傳超過 100 字上限的 body,逼 generate-cards.ts 重試 3 次後把卡片 park 掉。 */
function alwaysOverLimitRouter(): LlmRouter {
  const overLimitBody = '超'.repeat(150);
  const cardJson = JSON.stringify([{ title: '太長的卡', body: overLimitBody, examples: [], lines: [1, 2] }]);
  return {
    async call(): Promise<LlmResult> {
      return { text: cardJson, provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

/** 第一次回應超過字數上限,重試後合格——用於測 regenerateEvents 記錄。 */
function regenerateOnceRouter(): LlmRouter {
  let calls = 0;
  const overLimitBody = '超'.repeat(150);
  return {
    async call(): Promise<LlmResult> {
      calls += 1;
      const body = calls === 1 ? overLimitBody : '合格的正文內容,字數在上限以內。';
      const text = JSON.stringify([{ title: '會重試的卡', body, examples: [], lines: [1, 2] }]);
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

/** router 丟一個「不是」CloudRequiredError 的錯誤——isCloudRequiredError() 不該把它認成雲端問題。 */
function throwingRouter(err: unknown): LlmRouter {
  return {
    async call() {
      throw err;
    },
    async probeOnline() {
      return true;
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
    // Date.now() - t0,不是 + t0:應該是個很小的非負值,不是天文數字。
    expect(ingested!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(ingested!.duration_ms).toBeLessThan(5000);
    expect(result.message).toBe('建立了 3 張卡');
    // 沒有任何卡片被 park:if (parked.length > 0) 這個守門條件真的要擋住 needs-review.json / warning 事件。
    expect(existsSync(join(dir, 'state/needs-review.json'))).toBe(false);
    expect(events.some((e) => e.type === 'warning')).toBe(false);

    // 沒有 example:卡片內容應該就此結束,不該有多餘的尾端內容。
    const card1 = readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8');
    expect(card1.endsWith('第一張卡的正文內容。\n')).toBe(true);
    // yaml frontmatter 用 trimEnd(),閉合的 --- 前面不該多一個空行。
    expect(card1).toContain('prereqs: []\n---\n\n第一張卡');
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
    expect(second.ok).toBe(true);
    expect(second.exitCode).toBe(0);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.cardsCreated).toHaveLength(3);
    expect(second.message).toBe('raw/security/x.md 已經處理過,略過(已產生 3 張卡)');
    expect(calls).toBe(0);
  });

  it('空白 raw 檔:不寫卡,回報無可用內容,exitCode 非 0', async () => {
    writeFileSync(join(dir, 'raw/security/empty.md'), '   \n\t\n', 'utf8');
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/empty.md', category: 'security', router: threeCardRouter() });
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.cardsCreated).toHaveLength(0);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.message).toBe('raw 檔案沒有可用內容(空白)');
  });

  it('router 回報 CLOUD_REQUIRED:不寫卡,不拋出未捕捉的例外', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: alwaysCloudRequired() });
    expect(result.ok).toBe(false);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.cardsCreated).toHaveLength(0);
    expect(result.message).toMatch(/雲端/);
  });

  it('router 丟出非 CloudRequiredError 的例外:isCloudRequiredError() 不誤判,原樣往外拋', async () => {
    await expect(
      runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: throwingRouter(new Error('模型逾時')) }),
    ).rejects.toThrow('模型逾時');
  });

  it('router 丟出有 code 但不是 CLOUD_REQUIRED 的物件:一樣原樣往外拋,不當成雲端問題吞掉', async () => {
    await expect(
      runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: throwingRouter({ code: 'NO_MODEL' }) }),
    ).rejects.toEqual({ code: 'NO_MODEL' });
  });

  it('router 丟出 null:isCloudRequiredError() 對 null 回 false(typeof null === "object" 但 null === null),原樣往外拋', async () => {
    await expect(
      runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: throwingRouter(null) }),
    ).rejects.toBeNull();
  });

  it('router 丟出非物件(字串):isCloudRequiredError() 對非物件回 false,原樣往外拋', async () => {
    await expect(
      runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: throwingRouter('plain string error') }),
    ).rejects.toBe('plain string error');
  });

  it('router 丟出 typeof 不是 object 但 code === CLOUD_REQUIRED 的東西(函式):typeof 檢查要先擋下來,不能只看 code', async () => {
    // 函式的 typeof 是 'function' 不是 'object',但函式可以掛任意屬性——刻意做出一個
    // code 對得上、但 typeof 對不上的例外,逼 isCloudRequiredError() 的 typeof 檢查真的要生效。
    const fn = () => {};
    (fn as unknown as { code: string }).code = 'CLOUD_REQUIRED';
    await expect(
      runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: throwingRouter(fn) }),
    ).rejects.toBe(fn);
  });

  it('outDir 事先沒 ensureInitialized 過:runIngest() 自己初始化骨架,不需要呼叫端先做', async () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'lc-ingest-fresh-'));
    try {
      mkdirSync(join(freshDir, 'raw/security'), { recursive: true });
      writeFileSync(join(freshDir, 'raw/security/x.md'), '一些原始內容\n'.repeat(10), 'utf8');
      const result = await runIngest({ outDir: freshDir, rawRelPath: 'raw/security/x.md', category: 'security', router: threeCardRouter() });
      expect(result.ok).toBe(true);
      expect(result.cardsCreated).toHaveLength(3);
      // ensureInitialized() 真的被呼叫了:骨架設定檔是它建的,不是任何其他步驟的副作用。
      expect(existsSync(join(freshDir, 'config/settings.yaml'))).toBe(true);
      expect(existsSync(join(freshDir, 'config/categories.yaml'))).toBe(true);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('raw 檔不存在:不寫卡,exitCode 非 0', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/nope.md', category: 'security', router: threeCardRouter() });
    expect(result.ok).toBe(false);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toBe('raw 檔案不存在:raw/security/nope.md');
  });

  it('候選卡的 lines 超出 raw 檔行數範圍:source_ref 夾到合法範圍內(1..totalLines)', async () => {
    // raw 只有 10 行(beforeEach 寫的內容),候選卡宣稱從第 0 行到第 999 行。
    const router = singleCardRouter([{ title: '越界卡', body: '正文內容。', examples: [], lines: [0, 999] }]);
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router });
    expect(result.ok).toBe(true);
    const card = readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8');
    // raw 內容是 '一些原始內容\n'.repeat(10),結尾的 \n 讓 split('\n') 多出一個空字串元素,
    // totalLines 因此是 11,不是看起來的 10。
    expect(card).toContain('source_ref: raw/security/x.md#L1-L11');
  });

  it('候選卡帶 example:body 去頭尾空白、每個 example 圍欄各自去頭尾空白、兩個圍欄間空一行', async () => {
    const router = singleCardRouter([
      { title: '帶範例的卡', body: '  正文內容,前後都有空白。  \n', examples: ['  console.log(1)  ', '  console.log(2)  '], lines: [1, 2] },
    ]);
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router });
    const card = readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8');
    expect(card).toContain('\n\n正文內容,前後都有空白。\n\n```example\nconsole.log(1)\n```\n\n```example\nconsole.log(2)\n```\n');
  });

  it('字數重試後合格:記一筆 regenerate 事件,卡片正常建立', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: regenerateOnceRouter() });
    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(1);
    expect(result.regenerateEvents).toBe(1);

    const events = readFileSync(join(dir, 'state/log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const regenerate = events.filter((e) => e.type === 'regenerate');
    expect(regenerate).toHaveLength(1);
    expect(regenerate[0]).toMatchObject({ file: 'raw/security/x.md' });
  });

  it('重試 3 次仍超過字數上限:卡片被 park,寫進 needs-review.json,並記警告事件', async () => {
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router: alwaysOverLimitRouter() });
    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(0);
    expect(result.parkedCount).toBe(1);
    expect(result.message).toBe('建立了 0 張卡');

    const parked = JSON.parse(readFileSync(join(dir, 'state/needs-review.json'), 'utf8'));
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({
      category: 'security',
      title: '太長的卡',
      source: 'raw/security/x.md',
      reason: 'body_over_limit',
    });
    expect(parked[0].attempts).toHaveLength(3);

    const events = readFileSync(join(dir, 'state/log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const warning = events.find((e) => e.type === 'warning');
    expect(warning).toMatchObject({ file: 'raw/security/x.md', message: '1 張卡因字數超過上限被暫緩,見 needs-review.json' });
  });

  it('省略 category 與 today:從 3 段式 rawRelPath 推導分類,today 用系統日期(YYYY-MM-DD,不是完整 ISO 字串)', async () => {
    mkdirSync(join(dir, 'raw/other-cat'), { recursive: true });
    writeFileSync(join(dir, 'raw/other-cat/y.md'), '一些內容\n'.repeat(10), 'utf8');
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/other-cat/y.md', router: threeCardRouter() });
    expect(result.ok).toBe(true);
    const card = readFileSync(join(dir, `cards/other-cat/${result.cardsCreated[0]}.md`), 'utf8');
    expect(card).toContain('category: other-cat');
    const todayStr = new Date().toISOString().slice(0, 10);
    // 精確到行尾:不能只是「以 todayStr 開頭的字串」(那樣完整 ISO 時間戳也會通過)。
    expect(card).toMatch(new RegExp(`created: ${todayStr}\\n`));
  });

  it('省略 category 且路徑不是 3 段(raw/<file>):inferCategory() 判斷不出來,退回預設 security', async () => {
    writeFileSync(join(dir, 'raw/z.md'), '一些內容\n'.repeat(10), 'utf8');
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/z.md', router: threeCardRouter() });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8')).toContain('category: security');
  });

  it('省略 category 且路徑不是以 raw/ 開頭(即使剛好 3 段):inferCategory() 判斷不出來,退回預設 security', async () => {
    mkdirSync(join(dir, 'other/other-cat'), { recursive: true });
    writeFileSync(join(dir, 'other/other-cat/w.md'), '一些內容\n'.repeat(10), 'utf8');
    const result = await runIngest({ outDir: dir, rawRelPath: 'other/other-cat/w.md', router: threeCardRouter() });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8')).toContain('category: security');
  });

  it('搭配真的 FakeLlmRouter 讀 contracts/fixtures/llm 的 web-basics 情境', async () => {
    writeFileSync(join(dir, 'raw/security/web-basics.md'), '一些內容\n'.repeat(100), 'utf8');
    const router = new FakeLlmRouter({ fixturesDir: join(process.cwd(), 'contracts/fixtures/llm') });
    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/web-basics.md', category: 'security', router });
    expect(result.ok).toBe(true);
    expect(result.cardsCreated.length).toBeGreaterThanOrEqual(3);
  });
});
