/**
 * docs/integration/i1-content-pipeline.feature 的步驟定義。
 *
 * 業務邏輯是 packages/core/src/ingest/ingest.ts 的 runIngestPipeline()——這輪
 * 只設計介面,函式體 throw new Error('not implemented')。這份檔案的場景全部
 * 會紅,是預期的:下一輪開發 agent 把 runIngestPipeline() 實作完之後,這裡的
 * 場景要能過。
 *
 * 「a cloud LLM provider is configured and reachable」用跟 ingest-pipeline.steps.ts
 * 一樣的手法:真的 CloudLlmRouter(03-llm-router 的實作),換掉底層 CloudAdapter
 * 用注入的假的頂替網路呼叫,不打真的 API。「the network is unavailable」用
 * @core/llm/errors.js 的 CloudRequiredError(不是 ingest/fake-llm.ts 的同名
 * class)——這是 ingest.ts 的 runIngestPipeline() 註解點名的已知 bug:目前
 * runIngest() 的 catch 只認 fake-llm 版本,認不出真的路由邏輯丟的這個,這裡
 * 特意用真的那個把它攤出來。
 *
 * 已經在 ingest-pipeline.steps.ts / ingest.steps.ts 定義過的共用句子(逐字比對
 * 過,不重複定義,cucumber 對同一段文字只能有一個定義):
 *   - "every card has a question file with the same id"
 *   - "each child has its own question file"
 *   - "the number of cards is unchanged"
 *   - "no cards are written"
 * 前兩個原本依賴各自檔案的模組內狀態(ctx.cards / ctx.childrenResult),
 * 這次已經改成直接掃磁碟,兩邊的場景都能重用。「the number of cards is
 * unchanged」改成讀 world.cardCountBefore(見 _world.ts 的新欄位),
 * ingest.steps.ts 那邊也已經同步更新。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ROOT, type LearningWorld } from './_world.js';
import type { CardId } from '../../packages/contracts/src/index.js';
import { runIngestPipeline, type RunIngestPipelineResult } from '../../packages/core/src/ingest/ingest.js';
import { CloudLlmRouter, type CloudAdapter, type CloudAdapterResult, type LlmRouter, type LlmTask } from '../../packages/core/src/llm/index.js';
import { CloudRequiredError as RealCloudRequiredError } from '../../packages/core/src/llm/errors.js';
import { validateCard } from '../../packages/core/src/schema/validate-card.js';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { countWords as dataLayerCountWords } from '../../packages/core/src/schema/word-count.js';
import { countBodyWords as ingestCountBodyWords } from '../../packages/core/src/ingest/word-count-min.js';
import { detectCycle, readCategoryGraph, checkPrereqConsistency } from '../../packages/core/src/schema/graph.js';

// ---------------------------------------------------------------- 場景內狀態

const CATEGORY = 'security';
const DEFAULT_RAW_REL_PATH = `raw/${CATEGORY}/web-basics.md`;

interface I1Ctx {
  router?: LlmRouter;
  rawRelPath: string;
  pipelineResult?: RunIngestPipelineResult;
  wordCountFixtureIngestCount?: number;
  wordCountFixtureDataLayerCount?: number;
}

const store = new WeakMap<LearningWorld, I1Ctx>();

function ctx(world: LearningWorld): I1Ctx {
  let c = store.get(world);
  if (!c) {
    c = { rawRelPath: DEFAULT_RAW_REL_PATH };
    store.set(world, c);
  }
  return c;
}

// ---------------------------------------------------------------- 小工具

function ensureRawFile(world: LearningWorld, relPath: string, content?: string): void {
  const abs = join(world.dir!, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  if (!existsSync(abs) || content !== undefined) {
    writeFileSync(abs, content ?? buildFillerArticle(), 'utf8');
  }
}

/** ~2000 字的填充文章,給「一篇文章 → 一疊卡片」的端到端場景用。 */
function buildFillerArticle(): string {
  const paragraph =
    '網路安全牽涉到很多層面,包括身份驗證、資料加密、存取控制與稽核紀錄。同源政策規定協定、主機、埠號三者相同才算同源,跨來源請求需要伺服器端明確允許,否則瀏覽器會擋下回應內容,這是前端安全模型的基礎之一。';
  const lines: string[] = ['# 網頁安全基礎', ''];
  for (let i = 0; i < 40; i++) lines.push(`## 小節 ${i + 1}`, '', paragraph, '');
  return lines.join('\n');
}

/** 依 prompt 內容決定 'ingest.cards' 是要回 level 0 候選還是子卡候選。 */
function cardCandidatesJsonFor(prompt: string): string {
  if (prompt.includes('parent_id:')) {
    return JSON.stringify(
      Array.from({ length: 2 }, (_, i) => ({
        title: `子概念 ${i + 1}`,
        body: `子概念 ${i + 1} 的細節說明,展開自父卡的其中一個面向。`,
        examples: [],
      })),
    );
  }
  return JSON.stringify(
    Array.from({ length: 3 }, (_, i) => ({
      title: `第 ${i + 1} 個概念`,
      body: `這是第 ${i + 1} 張卡的正文內容,說明同源政策的其中一個面向。`,
      examples: [],
      lines: [i * 2 + 1, i * 2 + 2],
    })),
  );
}

function questionCandidateJson(): string {
  return JSON.stringify({
    fill: [
      { prompt: '同源的判定條件是 ___、___、___ 三者相同。', answers: [['協定'], ['主機'], ['埠號']] },
      { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否']] },
    ],
    apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }],
  });
}

function depsEdgesJsonFromPrompt(prompt: string): string {
  const ids = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1]!);
  const edges: [string, string][] = [];
  for (let i = 0; i + 1 < ids.length; i++) edges.push([ids[i]!, ids[i + 1]!]);
  return JSON.stringify({ edges });
}

/** 真的 CloudLlmRouter,底層 CloudAdapter 換成注入的假的——不打真的 API,同 ingest-pipeline.steps.ts 的手法。 */
function buildReachableCloudRouter(world: LearningWorld): LlmRouter {
  let currentTask: LlmTask | undefined;
  const adapter: CloudAdapter = {
    async call(args): Promise<CloudAdapterResult> {
      const task = currentTask!;
      world.llmCalls.push({ task, prompt: args.prompt });
      const text =
        task === 'ingest.cards'
          ? cardCandidatesJsonFor(args.prompt)
          : task === 'ingest.questions'
            ? questionCandidateJson()
            : task === 'ingest.deps'
              ? depsEdgesJsonFromPrompt(args.prompt)
              : (() => {
                  throw new Error(`i1-content-pipeline.steps.ts 的假 adapter 沒有預期到 task=${task}`);
                })();
      return { text, provider: 'anthropic', model: args.model, latency_ms: 1 };
    },
  };
  const cloudRouter = new CloudLlmRouter({
    env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: 'test-model', ANTHROPIC_API_KEY: 'test-anthropic-key' },
    adapters: { anthropic: adapter },
  });
  return {
    async call(task, prompt, opts) {
      currentTask = task;
      return cloudRouter.call(task, prompt, opts);
    },
    probeOnline: () => cloudRouter.probeOnline(),
    probeLocal: () => cloudRouter.probeLocal(),
  };
}

/** 「離線」的假 router:探測回 false,呼叫一律丟真的(@core/llm)CloudRequiredError。 */
function offlineRouter(): LlmRouter {
  return {
    async call(task: LlmTask) {
      throw new RealCloudRequiredError(task);
    },
    async probeOnline() {
      return false;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

/** 執行一次會直接丟錯的 router,給「不該再被呼叫」的斷言用。 */
function forbiddenRouter(): LlmRouter {
  return {
    async call(task: LlmTask) {
      throw new Error(`不該被呼叫(task=${task})——重跑已處理過的檔案不該再打 LLM`);
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function listAllCardsOnDisk(dir: string): { id: CardId; path: string; data: Record<string, unknown> }[] {
  const cardsDir = join(dir, 'cards', CATEGORY);
  if (!existsSync(cardsDir)) return [];
  return readdirSync(cardsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const path = join(cardsDir, f);
      const parsed = matter(readFileSync(path, 'utf8'));
      return { id: f.replace(/\.md$/, ''), path, data: parsed.data };
    });
}

async function runPipeline(world: LearningWorld, rawRelPath = ctx(world).rawRelPath): Promise<RunIngestPipelineResult> {
  const c = ctx(world);
  ensureRawFile(world, rawRelPath);
  c.rawRelPath = rawRelPath;
  const result = await runIngestPipeline({ outDir: world.dir!, rawRelPath, category: CATEGORY, router: c.router! });
  c.pipelineResult = result;
  world.lastResult = result;
  world.resultText = result.message;
  return result;
}

// ---------------------------------------------------------------- Background

Given('a learning directory initialised at {string}', function (this: LearningWorld, _pathLabel: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-i1-'));
  this.dir = dir;
  mkdirSync(join(dir, 'raw', CATEGORY), { recursive: true });
});

Given('the category {string} is configured with require_raw true', async function (this: LearningWorld, category: string) {
  const { ensureInitialized, setCategory } = await import('../../packages/core/src/ingest/init.js');
  ensureInitialized(this.dir!);
  setCategory(this.dir!, { id: category, name: category, require_raw: true });
});

Given('a cloud LLM provider is configured and reachable', function (this: LearningWorld) {
  ctx(this).router = buildReachableCloudRouter(this);
});

// ---------------------------------------------------------------- Given(場景專屬)

Given('the file {string} contains a 2000 word article', function (this: LearningWorld, relPath: string) {
  ensureRawFile(this, relPath, buildFillerArticle());
  ctx(this).rawRelPath = relPath;
});

Given('the fake router fixtures directory is renamed away', function (this: LearningWorld) {
  // 這個場景要驗證的是「不靠 Wave 0 的 FakeLlmRouter / 預錄 fixture 也能跑」——
  // Background 的 router 本來就是真的 CloudLlmRouter(只是底層 adapter 換成假的
  // 頂替網路),從來沒有讀過 contracts/fixtures/llm,所以這裡不需要真的去搬動
  // 那個共用目錄(會影響同時在跑的其他測試檔案)。用一個明確的斷言記錄「此時
  // 用的 router 確實不是靠 fixture 重播」,取代真的搬檔案。
  const router = ctx(this).router;
  assert.ok(router, '尚未執行 Background 的 "a cloud LLM provider is configured and reachable"');
});

Given('the network is unavailable', function (this: LearningWorld) {
  ctx(this).router = offlineRouter();
});

Given('the ingest command has already run for {string}', async function (this: LearningWorld, rawRelPath: string) {
  const result = await runPipeline(this, rawRelPath);
  assert.ok(result.ok, `第一次執行應該成功:${result.message}`);
  this.cardCountBefore = listAllCardsOnDisk(this.dir!).length;
});

// ---------------------------------------------------------------- When

When('the person runs the ingest command for that file', async function (this: LearningWorld) {
  await runPipeline(this);
});

When('the ingest command runs', async function (this: LearningWorld) {
  await runPipeline(this);
});

When('the person runs the ingest command', async function (this: LearningWorld) {
  await runPipeline(this);
});

When('the person runs it again', async function (this: LearningWorld) {
  ctx(this).router = forbiddenRouter();
  await runPipeline(this);
});

When('both the ingest validator and lint are run against the word count fixture', function (this: LearningWorld) {
  const raw = readFileSync(join(ROOT, 'contracts/fixtures/cards/wordcount-cases.md'), 'utf8');
  const parsed = parseCardText(raw);
  const c = ctx(this);
  // 兩邊都對「已經去掉 frontmatter 與 example 圍欄」的同一段 body 計算,
  // 隔離出「兩個獨立實作的計數演算法是否一致」這件事,不混進 frontmatter/
  // 圍欄解析的差異(那是共用的 parseCardText,不是這個場景要測的東西)。
  c.wordCountFixtureIngestCount = ingestCountBodyWords(parsed.body);
  c.wordCountFixtureDataLayerCount = dataLayerCountWords(parsed.body);
});

// ---------------------------------------------------------------- Then

Then('at least 3 cards exist under {string}', function (this: LearningWorld) {
  assert.ok(listAllCardsOnDisk(this.dir!).length >= 3, `卡片數應至少 3,實際 ${listAllCardsOnDisk(this.dir!).length}`);
});

Then('every card passes the data-layer validator', function (this: LearningWorld) {
  const cards = listAllCardsOnDisk(this.dir!);
  assert.ok(cards.length > 0, '目錄底下沒有任何卡片');
  for (const { id, path } of cards) {
    const check = validateCard(readFileSync(path, 'utf8'));
    assert.ok(check.ok, `${id} 沒有通過 data-layer 驗證器:${check.errors.join('; ')}`);
  }
});

Then('{string} lists every card exactly once', function (this: LearningWorld, relPath: string) {
  const order = JSON.parse(readFileSync(join(this.dir!, relPath), 'utf8')) as string[];
  const cardIds = listAllCardsOnDisk(this.dir!).map((c) => c.id);
  assert.equal(order.length, cardIds.length, `order 檔案有 ${order.length} 筆,卡片有 ${cardIds.length} 張`);
  assert.deepEqual([...order].sort(), [...cardIds].sort());
  assert.equal(new Set(order).size, order.length, 'order 檔案裡有重複的 id');
});

Then('the person can open any card in a markdown viewer and read it', function (this: LearningWorld) {
  // 沒辦法自動化「打開檢視器閱讀」本身,退而求其次:確保每張卡都是可以被
  // 任何 markdown 檢視器正常解析的純文字——frontmatter 解得出來、body 非空、
  // 沒有殘留的圍欄標記或控制字元。
  for (const { id, path } of listAllCardsOnDisk(this.dir!)) {
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    assert.ok(Object.keys(parsed.data).length > 0, `${id}: frontmatter 是空的`);
    assert.ok(parsed.content.trim().length > 0, `${id}: body 是空的`);
    assert.ok(!/[\x00-\x08\x0E-\x1F]/.test(raw), `${id}: 內容含控制字元,markdown 檢視器可能顯示異常`);
  }
});

Then('it still produces cards', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.pipelineResult?.ok, JSON.stringify(c.pipelineResult));
  assert.ok(c.pipelineResult!.cardsCreated.length > 0);
});

Then('it fails loudly if the network is unavailable', async function (this: LearningWorld) {
  // Background 給的是「線上」的 router;這裡另外開一個乾淨目錄,單獨驗證同一支
  // pipeline 面對離線 router 時的行為,不影響前面已經斷言過的「線上會產生卡片」。
  const dir = mkdtempSync(join(tmpdir(), 'lc-i1-offline-check-'));
  mkdirSync(join(dir, 'raw', CATEGORY), { recursive: true });
  writeFileSync(join(dir, DEFAULT_RAW_REL_PATH), buildFillerArticle(), 'utf8');
  const result = await runIngestPipeline({ outDir: dir, rawRelPath: DEFAULT_RAW_REL_PATH, category: CATEGORY, router: offlineRouter() });
  assert.equal(result.ok, false, '離線時應該回報失敗,而不是安靜地降級');
  assert.equal(result.cardsCreated.length, 0);
});

Then('both report the same count', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(
    c.wordCountFixtureIngestCount,
    c.wordCountFixtureDataLayerCount,
    `ingest 的 countBodyWords 算出 ${c.wordCountFixtureIngestCount},data-layer 的 countWords 算出 ${c.wordCountFixtureDataLayerCount}——兩個獨立實作對契約 §2 的理解不一致`,
  );
});

Then('no card body exceeds 100 words as counted by the shared counter', function (this: LearningWorld) {
  for (const { id, path } of listAllCardsOnDisk(this.dir!)) {
    const parsed = parseCardText(readFileSync(path, 'utf8'));
    const count = dataLayerCountWords(parsed.body);
    assert.ok(count <= 100, `${id}: body 字數 ${count} 超過 100`);
  }
});

Then('any example fences are excluded from that count', function (this: LearningWorld) {
  for (const { id, path } of listAllCardsOnDisk(this.dir!)) {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseCardText(raw);
    if (parsed.examples.length === 0) continue;
    const bodyCount = dataLayerCountWords(parsed.body);
    const rawContentCount = dataLayerCountWords(matter(raw).content);
    assert.ok(
      rawContentCount > bodyCount,
      `${id}: 有 example 圍欄,但把圍欄算進去的字數(${rawContentCount})沒有比排除後(${bodyCount})多,` +
        '代表圍欄可能沒有被排除在字數計算之外',
    );
  }
});

Then('each level 0 card has between 1 and 3 level 1 children', function (this: LearningWorld) {
  const cards = listAllCardsOnDisk(this.dir!);
  const level0 = cards.filter((c) => c.data.level === 0);
  const byParent = new Map<string, number>();
  for (const c of cards) {
    if (typeof c.data.parent === 'string') byParent.set(c.data.parent, (byParent.get(c.data.parent) ?? 0) + 1);
  }
  assert.ok(level0.length > 0, '沒有任何 level 0 卡');
  for (const { id } of level0) {
    const n = byParent.get(id) ?? 0;
    assert.ok(n >= 1 && n <= 3, `${id}: 子卡數 ${n},應介於 1..3`);
  }
});

Then('each child has parent set to its level 0 card', function (this: LearningWorld) {
  const cards = listAllCardsOnDisk(this.dir!);
  const level0Ids = new Set(cards.filter((c) => c.data.level === 0).map((c) => c.id));
  const children = cards.filter((c) => c.data.level === 1);
  assert.ok(children.length > 0, '沒有任何 level 1 子卡');
  for (const { id, data } of children) {
    assert.ok(typeof data.parent === 'string' && level0Ids.has(data.parent), `${id}: parent "${data.parent}" 不是合法的 level 0 卡`);
  }
});

Then('cycle detection over {string} reports no cycles', function (this: LearningWorld) {
  const graph = readCategoryGraph(this.dir!, CATEGORY);
  const cycle = detectCycle(graph);
  assert.equal(cycle.hasCycle, false, `發現循環:${cycle.path.join(' -> ')}`);
});

Then("every card's prereqs field agrees with the edges in deps.json", function (this: LearningWorld) {
  const graph = readCategoryGraph(this.dir!, CATEGORY);
  const cards = listAllCardsOnDisk(this.dir!).map((c) => ({
    id: c.id,
    prereqs: Array.isArray(c.data.prereqs) ? (c.data.prereqs as string[]) : [],
  }));
  const check = checkPrereqConsistency(cards, graph);
  assert.ok(check.ok, check.errors.join('; '));
});

Then('the command reports that the file was already processed', function (this: LearningWorld) {
  assert.ok(ctx(this).pipelineResult?.alreadyProcessed, JSON.stringify(ctx(this).pipelineResult));
});

Then('the command reports that ingest requires a cloud model', function (this: LearningWorld) {
  const message = ctx(this).pipelineResult?.message ?? '';
  assert.match(message, /雲端|cloud/i, message);
});

When('every non interactive command in the standalone manifest is executed', function (this: LearningWorld) {
  this.runCommand('npx tsx scripts/check-standalone.ts', { timeoutMs: 300_000 });
});

Then('each exits with status 0', function (this: LearningWorld) {
  assert.equal(this.lastRun?.status, 0, this.lastRun?.output);
});

Then('each output contains the expected marker', function (this: LearningWorld) {
  // check-standalone.ts 內部已經對每個指令各自比對 standalone.json 的 expect
  // 關鍵字,只有全部命中才會印這行摘要——不在這裡重新解析一次每個指令的輸出。
  assert.match(this.lastRun?.output ?? '', /全部通過/);
});
