/**
 * 02-ingest-pipeline / phase-2 的步驟定義:考題、level 1 子卡、依賴圖。
 * 業務邏輯在 packages/core/src/ingest/{questions,children,deps}.ts(目前全部
 * throw not implemented,紅燈待下一輪實作)。共用句子見 common.steps.ts,
 * phase-1 的步驟見 ingest.steps.ts,兩者都已 grep 過確認不撞名。
 *
 * 「the real router configured for the cloud」:真的建一個 CloudLlmRouter(03
 * 的實作,不是 fake-llm.ts 的 Wave 0 stub),用注入的假 CloudAdapter 頂替網路
 * 呼叫。CloudAdapter 介面本身拿不到 task(見 CloudAdapterCallArgs),所以用一層
 * 薄薄的 wrapper 在呼叫 cloudRouter.call() 前記下 task,adapter.call() 執行時
 * 讀那個值——這是介面本身的限制,不是造假路由邏輯。每個 phase-2 場景只會用到
 * 三個 task 之一(question/children/deps 生成不會在同一個場景裡混用),所以
 * 「一次只認一種 task」的簡化是安全的。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import matter from 'gray-matter';
import type { LearningWorld } from './_world.js';
import type { Card, CardId, QuestionFile } from '../../packages/contracts/src/index.js';
import {
  CloudLlmRouter,
  OutputTruncatedError,
  type CloudAdapter,
  type CloudAdapterResult,
  type LlmRouter,
  type LlmTask,
} from '../../packages/core/src/llm/index.js';
import { checkPrereqConsistency, detectCycle, type Graph } from '../../packages/core/src/schema/graph.js';
import { validateQuestionFile } from '../../packages/core/src/schema/validate-question.js';
import { generateQuestionsForCards, type GenerateQuestionsRunResult } from '../../packages/core/src/ingest/questions.js';
import { generateChildrenForCards, type GenerateChildrenResult } from '../../packages/core/src/ingest/children.js';
import { analyzeDependencies, type AnalyzeDependenciesResult } from '../../packages/core/src/ingest/deps.js';
import { runIngestPipeline, type RunIngestOptions, type RunIngestPipelineResult } from '../../packages/core/src/ingest/ingest.js';
import { ensureInitialized } from '../../packages/core/src/ingest/init.js';

// ---------------------------------------------------------------- 場景內狀態

const CATEGORY = 'security';
/** Background:「a learning directory containing five level zero cards」 */
const FIVE_CARD_IDS: CardId[] = ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0004', 'sec-0005'];

interface IngestPipelineCtx {
  cards: Card[];
  /** Background 的第二個步驟才會設;之前一律 undefined。 */
  router?: LlmRouter;
  /** 每個 task 目前呼叫到第幾次(1-based),供 adapter 依呼叫次數決定回應。 */
  callCounts: Map<LlmTask, number>;
  /** 依呼叫次數覆寫 'ingest.deps' 的回應(cycle 挑戰場景用)。不給就用預設鏈狀圖。 */
  depsScript?: [CardId, CardId][][];
  /** 'ingest.questions' 對這張卡的每次呼叫都丟錯(Generation failure 場景用)。 */
  questionsFailForCardId?: CardId;
  /** 'ingest.questions' 對這張卡的第一次呼叫丟 OutputTruncatedError,第二次(重試)成功。 */
  questionsTruncateOnceForCardId?: CardId;
  /** 'ingest.questions' 每張卡目前呼叫到第幾次(1-based),供截斷重試場景判斷「第一次」。 */
  questionsCallCountByCard: Map<CardId, number>;
  questionsResult?: GenerateQuestionsRunResult;
  childrenResult?: GenerateChildrenResult;
  depsResult?: AnalyzeDependenciesResult;
  /** 「the run completes」跑完整 runIngestPipeline() 之後的結果。 */
  pipelineResult?: RunIngestPipelineResult;
  languageOrderBefore?: string;
  /** 「the graph file on disk is not valid JSON」寫下去的位元組,Then 用來比對沒被動過。 */
  corruptDepsBytes?: string;
}

const store = new WeakMap<LearningWorld, IngestPipelineCtx>();

function ctx(world: LearningWorld): IngestPipelineCtx {
  let c = store.get(world);
  if (!c) {
    c = { cards: [], callCounts: new Map(), questionsCallCountByCard: new Map() };
    store.set(world, c);
  }
  return c;
}

// ---------------------------------------------------------------- 小工具

function makeCard(id: CardId, overrides: Partial<Card['frontmatter']> = {}): Card {
  return {
    frontmatter: {
      id,
      category: CATEGORY,
      title: `測試卡 ${id}`,
      level: 0,
      source: 'raw',
      created: '2026-09-01',
      source_ref: 'raw/security/web-basics.md#L1-L10',
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
      ...overrides,
    },
    body: '同源政策的基本概念:協定、主機、埠號三者相同才算同源。',
    examples: [],
  };
}

function writeCardFile(cardsDir: string, card: Card): void {
  const yamlFm = yamlStringify(card.frontmatter).trimEnd();
  writeFileSync(join(cardsDir, `${card.frontmatter.id}.md`), `---\n${yamlFm}\n---\n\n${card.body}\n`, 'utf8');
}

function goodQuestionCandidateJson(): string {
  return JSON.stringify({
    fill: [
      { prompt: '同源的判定條件是 ___、___、___ 三者相同。', answers: [['協定', 'protocol'], ['主機', 'host'], ['埠號', 'port']] },
      { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否', '不同源']] },
    ],
    apply: [
      { prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] },
    ],
  });
}

function goodChildCandidatesJson(): string {
  return JSON.stringify([
    { title: '子概念一', body: '子概念一的細節說明,展開自父卡的其中一個面向。', examples: [] },
    { title: '子概念二', body: '子概念二的細節說明,展開自父卡的另一個面向。', examples: [] },
  ]);
}

/** 'ingest.cards' 的 level 0 回應(prompt 沒有 parent_id: 那一行時)。 */
function levelZeroCandidatesJson(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      title: `第 ${i + 1} 個概念`,
      body: `這是第 ${i + 1} 張卡的正文內容,描述同源政策的其中一個面向。`,
      examples: [],
      lines: [i * 2 + 1, i * 2 + 2],
    })),
  );
}

/**
 * 預設的 'ingest.deps' 回應:把 prompt 裡「- <id>: <title>」列出的卡片串成一條鏈,
 * 保證「圖包含每張卡」且無循環。
 *
 * 讀 prompt 而不是讀 ctx.cards:走 runIngestPipeline() 的場景裡,deps 拿到的是
 * level 0 卡「加上」子卡,ctx.cards 只有前者——照 ctx.cards 回答會漏掉子卡,圖就
 * 不含每張卡了。只跑 analyzeDependencies() 的場景兩者結果相同。
 */
function defaultDepsEdgesJson(prompt: string): string {
  const ids = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1] as CardId);
  const edges: [CardId, CardId][] = [];
  for (let i = 0; i + 1 < ids.length; i++) edges.push([ids[i]!, ids[i + 1]!]);
  return JSON.stringify({ edges });
}

/** 依目前 task 與呼叫次數決定回應文字;拋出的錯誤會原樣往外丟給呼叫端。 */
function buildResponseText(task: LlmTask, callIndex: number, prompt: string, c: IngestPipelineCtx): string {
  if (task === 'ingest.questions') {
    const m = /card:\s*(\S+)/.exec(prompt);
    const cardId = m?.[1] as CardId | undefined;
    if (cardId) {
      if (c.questionsFailForCardId === cardId) {
        throw new Error(`模擬 ${cardId} 的考題生成失敗(模型無法解析)`);
      }
      const n = (c.questionsCallCountByCard.get(cardId) ?? 0) + 1;
      c.questionsCallCountByCard.set(cardId, n);
      if (n === 1 && c.questionsTruncateOnceForCardId === cardId) {
        throw new OutputTruncatedError('ingest.questions', 2048, 2048);
      }
    }
    return goodQuestionCandidateJson();
  }
  if (task === 'ingest.cards') {
    // children.ts 的 prompt 帶 parent_id:,generate-cards.ts 的 level 0 prompt 沒有——
    // 兩者共用同一個 LlmTask(契約 §7 路由表),只能靠 prompt 分辨。
    return prompt.includes('parent_id:') ? goodChildCandidatesJson() : levelZeroCandidatesJson(c.cards.length);
  }
  if (task === 'ingest.deps') {
    if (c.depsScript) {
      const edges = c.depsScript[callIndex - 1];
      if (!edges) throw new Error(`depsScript 沒有第 ${callIndex} 次呼叫的回應`);
      return JSON.stringify({ edges });
    }
    return defaultDepsEdgesJson(prompt);
  }
  throw new Error(`ingest-pipeline.steps.ts 的假 adapter 沒有預期到 task=${task}`);
}

function makeAdapter(world: LearningWorld, c: IngestPipelineCtx): { adapter: CloudAdapter; setTask: (t: LlmTask) => void } {
  let currentTask: LlmTask | undefined;
  const adapter: CloudAdapter = {
    async call(args): Promise<CloudAdapterResult> {
      const task = currentTask!;
      const count = (c.callCounts.get(task) ?? 0) + 1;
      c.callCounts.set(task, count);
      world.networkRequests.push(`anthropic:${args.model}`);
      const text = buildResponseText(task, count, args.prompt, c);
      world.llmCalls.push({ task, prompt: args.prompt });
      return { text, provider: 'anthropic', model: args.model, latency_ms: 1 };
    },
  };
  return { adapter, setTask: (t) => (currentTask = t) };
}

function buildRealRouter(world: LearningWorld, c: IngestPipelineCtx): LlmRouter {
  const { adapter, setTask } = makeAdapter(world, c);
  const cloudRouter = new CloudLlmRouter({
    env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: 'test-model', ANTHROPIC_API_KEY: 'test-anthropic-key' },
    adapters: { anthropic: adapter },
  });
  return {
    async call(task, prompt, opts) {
      setTask(task);
      return cloudRouter.call(task, prompt, opts);
    },
    probeOnline: () => cloudRouter.probeOnline(),
    probeLocal: () => cloudRouter.probeLocal(),
  };
}

function readCard(dir: string, id: CardId): { data: Record<string, unknown>; content: string } {
  const parsed = matter(readFileSync(join(dir, 'cards', CATEGORY, `${id}.md`), 'utf8'));
  return { data: parsed.data, content: parsed.content };
}

/**
 * 掃描 dir 底下所有分類的卡片,回傳 { id, data }。跟 ctx(world).cards 不一樣,
 * 這是直接讀磁碟——給那些「不管是哪個場景寫的卡,只要卡真的存在就該通過」的
 * 共用 Then 步驟用,不依賴呼叫端有沒有先跑過這個檔案自己的 Given(docs/integration
 * 的 i1-content-pipeline.feature 會重用這裡幾個 Then 的文字,但走的是不同的
 * Given/When,不會填 ctx(world).cards)。
 */
function listAllCardsOnDisk(dir: string): { id: CardId; data: Record<string, unknown> }[] {
  const cardsRoot = join(dir, 'cards');
  if (!existsSync(cardsRoot)) return [];
  const out: { id: CardId; data: Record<string, unknown> }[] = [];
  for (const category of readdirSync(cardsRoot)) {
    const categoryDir = join(cardsRoot, category);
    for (const name of readdirSync(categoryDir)) {
      if (!name.endsWith('.md')) continue;
      const parsed = matter(readFileSync(join(categoryDir, name), 'utf8'));
      out.push({ id: name.replace(/\.md$/, ''), data: parsed.data });
    }
  }
  return out;
}

function readQuestionFile(dir: string, id: CardId): QuestionFile {
  return yamlParse(readFileSync(join(dir, 'questions', `${id}.yaml`), 'utf8')) as QuestionFile;
}

// ---------------------------------------------------------------- Background

Given('a learning directory containing five level zero cards', function (this: LearningWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-ingest-pipeline-'));
  this.dir = dir;
  const cardsDir = join(dir, 'cards', CATEGORY);
  mkdirSync(cardsDir, { recursive: true });
  mkdirSync(join(dir, 'questions'), { recursive: true });
  mkdirSync(join(dir, 'graph'), { recursive: true });

  const c = ctx(this);
  c.cards = FIVE_CARD_IDS.map((id) => makeCard(id));
  for (const card of c.cards) writeCardFile(cardsDir, card);
});

Given('the real router configured for the cloud', function (this: LearningWorld) {
  const c = ctx(this);
  c.router = buildRealRouter(this, c);
});

// ---------------------------------------------------------------- Given(場景專屬)

Given('the model returns edges containing a cycle on the first attempt', function (this: LearningWorld) {
  const c = ctx(this);
  const ids = c.cards.map((card) => card.frontmatter.id);
  const cyclicEdges: [CardId, CardId][] = [
    [ids[0]!, ids[1]!],
    [ids[1]!, ids[2]!],
    [ids[2]!, ids[0]!],
  ];
  // 兩次都回循環的邊,對應「if the second attempt still cycles」這個分支。
  // 下面兩個場景專屬的 Given 會覆寫 depsScript[1](重試回應),depsScript[0]
  // (第一次的循環,單純用來觸發挑戰)維持不變。
  c.depsScript = [cyclicEdges, cyclicEdges];
});

Given('the second attempt still returns two independent cycles that share no card or edge', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.depsScript, '要先跑過 "the model returns edges containing a cycle on the first attempt"');
  const ids = c.cards.map((card) => card.frontmatter.id);
  // sec-0001..0003 的三卡循環(跟第一次攻擊用的一樣)+ sec-0004/sec-0005 的
  // 兩卡循環——兩者不共用任何節點或邊。
  const cycleA: [CardId, CardId][] = [
    [ids[0]!, ids[1]!],
    [ids[1]!, ids[2]!],
    [ids[2]!, ids[0]!],
  ];
  const cycleB: [CardId, CardId][] = [
    [ids[3]!, ids[4]!],
    [ids[4]!, ids[3]!],
  ];
  c.depsScript![1] = [...cycleA, ...cycleB];
});

Given(
  'the second attempt keeps forming a new cycle after each edge is dropped, up to the card count limit',
  function (this: LearningWorld) {
    const c = ctx(this);
    assert.ok(c.depsScript, '要先跑過 "the model returns edges containing a cycle on the first attempt"');
    const ids = c.cards.map((card) => card.frontmatter.id);
    // 5 個自環(各自佔一次丟邊)+ 一個把全部 5 張卡串起來的循環:自環排在每張卡
    // 鄰接表的最前面,本地迴圈會先把 5 個自環各丟一次,丟滿 cards.length(=5)
    // 的上限時,五卡循環本身完全沒被碰到,依然是殘留的循環。
    const selfLoops: [CardId, CardId][] = ids.map((id) => [id, id]);
    const bigCycle: [CardId, CardId][] = ids.map((id, i) => [id, ids[(i + 1) % ids.length]!]);
    c.depsScript![1] = [...selfLoops, ...bigCycle];
  },
);

Given('an order file already exists for another category', function (this: LearningWorld) {
  const languageGraph: Graph = { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] };
  writeFileSync(join(this.dir!, 'graph', 'deps.json'), JSON.stringify({ language: languageGraph }, null, 2));
  const orderPath = join(this.dir!, 'graph', 'order-language.json');
  writeFileSync(orderPath, JSON.stringify(['lan-0001', 'lan-0002'], null, 2) + '\n');
  ctx(this).languageOrderBefore = readFileSync(orderPath, 'utf8');
});

/**
 * deps-stale-graph-removal(ADR-038):模擬「上一次成功的 run 已經寫過 security 的
 * 圖」。這個 Given 一定要跟前一個(another category)一起用,新場景才有「兩個分類
 * 同時在 deps.json 裡」的形狀——粒度是分類、不是整個檔,靠的就是這個對照組。
 */
Given('a previous successful run already wrote the graph and the order file for security', function (this: LearningWorld) {
  const c = ctx(this);
  const depsPath = join(this.dir!, 'graph', 'deps.json');
  const existing = existsSync(depsPath) ? (JSON.parse(readFileSync(depsPath, 'utf8')) as Record<string, Graph>) : {};
  const ids = c.cards.map((card) => card.frontmatter.id);
  const staleGraph: Graph = { nodes: ids, edges: ids.slice(0, -1).map((id, i) => [id, ids[i + 1]!]) };
  writeFileSync(depsPath, JSON.stringify({ ...existing, [CATEGORY]: staleGraph }, null, 2));
  writeFileSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`), JSON.stringify(ids, null, 2) + '\n');
});

/**
 * ADR-041:deps.json 存在但不是合法 JSON。跟 ADR-038 那三個邊界(檔不存在、沒有該
 * 分類的 key、order 檔不存在)不同——那三個的磁碟狀態本來就是對的,這個是真的壞掉
 * 的檔,要有自己的名字,而且不能被程式自作主張覆寫掉。
 */
Given('the graph file on disk is not valid JSON', function (this: LearningWorld) {
  const bytes = '{"security":{"nodes":["sec-0001"],"edges":[["sec-0001"';
  writeFileSync(join(this.dir!, 'graph', 'deps.json'), bytes, 'utf8');
  ctx(this).corruptDepsBytes = bytes;
});

Given('question generation fails for the third card on both attempts', function (this: LearningWorld) {
  const c = ctx(this);
  c.questionsFailForCardId = c.cards[2]!.frontmatter.id;
});

Given('question generation for the third card is truncated once and succeeds on retry', function (this: LearningWorld) {
  const c = ctx(this);
  c.questionsTruncateOnceForCardId = c.cards[2]!.frontmatter.id;
});

// ---------------------------------------------------------------- When

When('question generation runs', async function (this: LearningWorld) {
  const c = ctx(this);
  c.questionsResult = await generateQuestionsForCards(this.dir!, c.cards, c.router!);
});

/**
 * 「the run completes」是完整的一次 ingest,不是只有考題那一步:考題失敗的 warning
 * 依 questions.ts 的介面契約是 runIngestPipeline() 的責任(generateQuestionsForCards()
 * 只把失敗收進 failures,不寫 log),所以這個 When 一定要跑到 pipeline 這一層,
 * 否則「a warning naming the third card」永遠驗不到真東西。
 *
 * runIngestPipeline() 是從 raw 檔開始跑的,自己會生 level 0 卡,所以這裡另開一個
 * 乾淨的 learning 目錄(Background 手寫的那五張卡只用來讓 Given 算出「第三張卡」
 * 的 id);新目錄裡 level 0 的編號一樣從 sec-0001 開始,兩邊對得上——下面的
 * assert 把這個耦合寫死,對不上就當場紅,不會靜悄悄跑成別的東西。
 */
When('the run completes', async function (this: LearningWorld) {
  const c = ctx(this);
  const dir = mkdtempSync(join(tmpdir(), 'lc-ingest-pipeline-run-'));
  ensureInitialized(dir);
  const rawRelPath = `raw/${CATEGORY}/web-basics.md`;
  mkdirSync(join(dir, 'raw', CATEGORY), { recursive: true });
  writeFileSync(join(dir, rawRelPath), '一些原始內容\n'.repeat(20), 'utf8');

  rmSync(this.dir!, { recursive: true, force: true });
  this.dir = dir;

  c.pipelineResult = await runIngestPipeline({
    outDir: dir,
    rawRelPath,
    category: CATEGORY,
    today: this.today,
    // runIngestPipeline() 的 router 型別是 ingest/types.ts 的 Wave 0 版(provider 多一個
    // 'fake' literal),c.router 是 @core/llm 的版本;call/probeOnline/probeLocal 的簽章
    // 結構相同,只有那個 literal union 寬窄不同,對執行沒有影響。
    router: c.router as unknown as RunIngestOptions['router'],
  });

  assert.deepEqual(
    c.pipelineResult.cardsCreated,
    c.cards.map((card) => card.frontmatter.id),
    'pipeline 產生的 level 0 卡片編號要跟 Background 的五張對得上,場景專屬的 Given 才指得到「第三張卡」',
  );
});

When('child generation runs', async function (this: LearningWorld) {
  const c = ctx(this);
  c.childrenResult = await generateChildrenForCards(c.cards, c.router!, { outDir: this.dir!, today: this.today });
});

When('dependency analysis runs', async function (this: LearningWorld) {
  const c = ctx(this);
  c.depsResult = await analyzeDependencies(CATEGORY, c.cards, c.router!, this.dir!);
});

When('dependency analysis runs and fails', async function (this: LearningWorld) {
  const c = ctx(this);
  try {
    c.depsResult = await analyzeDependencies(CATEGORY, c.cards, c.router!, this.dir!);
  } catch (err) {
    this.lastError = err as Error;
  }
});

When('new cards are ingested for security', async function (this: LearningWorld) {
  const c = ctx(this);
  c.depsResult = await analyzeDependencies(CATEGORY, c.cards, c.router!, this.dir!);
});

// ---------------------------------------------------------------- Then(考題)

Then('every card has a question file with the same id', function (this: LearningWorld) {
  const cards = listAllCardsOnDisk(this.dir!);
  assert.ok(cards.length > 0, '目錄底下沒有任何卡片');
  for (const { id } of cards) {
    assert.ok(existsSync(join(this.dir!, 'questions', `${id}.yaml`)), `缺少 ${id} 的考題檔`);
    assert.equal(readQuestionFile(this.dir!, id).card, id);
  }
});

Then('every question file passes the validator', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    const file = readQuestionFile(this.dir!, card.frontmatter.id);
    assert.deepEqual(validateQuestionFile(file), { ok: true, errors: [] });
  }
});

Then('each question file has between 2 and 3 fill questions', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    const n = readQuestionFile(this.dir!, card.frontmatter.id).fill.length;
    assert.ok(n >= 2 && n <= 3, `${card.frontmatter.id}: fill 題數 ${n}`);
  }
});

Then('each blank has at least one accepted synonym where one exists', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    const file = readQuestionFile(this.dir!, card.frontmatter.id);
    for (const fill of file.fill) {
      for (const group of fill.answers) assert.ok(group.length >= 1, `${card.frontmatter.id}: 有空的答案組`);
    }
  }
});

Then('each question file has 1 or 2 apply questions', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    const n = readQuestionFile(this.dir!, card.frontmatter.id).apply.length;
    assert.ok(n >= 1 && n <= 2, `${card.frontmatter.id}: apply 題數 ${n}`);
  }
});

Then('each rubric line is a single checkable statement', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    const file = readQuestionFile(this.dir!, card.frontmatter.id);
    for (const apply of file.apply) {
      for (const line of apply.rubric) {
        assert.ok(!line.includes('\n'), `${card.frontmatter.id}: rubric 有多行 "${line}"`);
        assert.ok(line.trim().length > 0, `${card.frontmatter.id}: rubric 有空行`);
      }
    }
  }
});

Then('each rubric has between 2 and 4 lines', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    const file = readQuestionFile(this.dir!, card.frontmatter.id);
    for (const apply of file.apply) {
      assert.ok(apply.rubric.length >= 2 && apply.rubric.length <= 4, `${card.frontmatter.id}: rubric ${apply.rubric.length} 條`);
    }
  }
});

// ---------------------------------------------------------------- Then(子卡)

Then('each level zero card has between 1 and 3 level one children', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.childrenResult, '尚未執行 child generation runs');
  const byParent = new Map<CardId, number>();
  for (const child of c.childrenResult!.children) {
    const parent = child.frontmatter.parent!;
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1);
  }
  for (const card of c.cards) {
    const n = byParent.get(card.frontmatter.id) ?? 0;
    assert.ok(n >= 1 && n <= 3, `${card.frontmatter.id}: 子卡數 ${n}`);
  }
});

Then('each child names its parent', function (this: LearningWorld) {
  const c = ctx(this);
  const parentIds = new Set(c.cards.map((card) => card.frontmatter.id));
  for (const child of c.childrenResult!.children) {
    assert.ok(child.frontmatter.parent && parentIds.has(child.frontmatter.parent), `${child.frontmatter.id} 沒有指向合法的 parent`);
  }
});

Then('each child has source llm', function (this: LearningWorld) {
  const c = ctx(this);
  for (const child of c.childrenResult!.children) {
    assert.equal(child.frontmatter.source, 'llm', child.frontmatter.id);
  }
});

Then('each child has its own question file', function (this: LearningWorld) {
  // 「子卡」用磁碟上的 parent 欄位判斷,不靠 ctx(this).childrenResult——這個
  // Then 的文字被 docs/integration/i1-content-pipeline.feature 重用,那邊走的是
  // 完整 pipeline(runIngestPipeline),不會經過這個檔案自己的 When 填 childrenResult。
  const children = listAllCardsOnDisk(this.dir!).filter((c) => c.data.parent);
  assert.ok(children.length > 0, '目錄底下沒有任何子卡(parent 欄位不存在)');
  for (const { id } of children) {
    assert.ok(existsSync(join(this.dir!, 'questions', `${id}.yaml`)), `缺少子卡 ${id} 的考題檔`);
    assert.equal(readQuestionFile(this.dir!, id).card, id);
  }
});

// ---------------------------------------------------------------- Then(依賴圖)

Then('the graph contains every card in the category', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.depsResult, '尚未執行 dependency analysis runs');
  assert.deepEqual(new Set(c.depsResult!.graph.nodes), new Set(c.cards.map((card) => card.frontmatter.id)));
});

Then("each card's prereqs field agrees with the edges", function (this: LearningWorld) {
  const c = ctx(this);
  const onDisk = c.cards.map((card) => {
    const { data } = readCard(this.dir!, card.frontmatter.id);
    return { id: card.frontmatter.id, prereqs: (data.prereqs as CardId[] | undefined) ?? [] };
  });
  const result = checkPrereqConsistency(onDisk, c.depsResult!.graph);
  assert.deepEqual(result, { ok: true, errors: [] });
});

Then('every level one card lists its parent as a prerequisite', function (this: LearningWorld) {
  const c = ctx(this);
  const edgeSet = new Set(c.depsResult!.graph.edges.map(([from, to]) => `${from}->${to}`));
  for (const card of c.cards) {
    if (card.frontmatter.level !== 1 || !card.frontmatter.parent) continue;
    assert.ok(edgeSet.has(`${card.frontmatter.parent}->${card.frontmatter.id}`), `${card.frontmatter.id} 沒有把 parent 列為先備`);
  }
});

Then('the model is called again with the cycle described', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.callCounts.get('ingest.deps'), 2, 'ingest.deps 應該被呼叫兩次');
});

Then('if the second attempt still cycles, edges are dropped one at a time until the graph is acyclic', function (this: LearningWorld) {
  const c = ctx(this);
  assert.ok(c.depsResult!.edgesRemoved.length > 0, '應該至少有一條邊被丟棄');
  assert.equal(detectCycle(c.depsResult!.graph).hasCycle, false, '本地迴圈丟完邊之後的圖不該還有循環');
});

Then('each dropped edge is logged as a cycle removed event', function (this: LearningWorld) {
  const c = ctx(this);
  const events = readFileSync(join(this.dir!, 'state/log.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const removedEvents = events.filter((e) => e.type === 'cycle_removed');
  assert.equal(removedEvents.length, c.depsResult!.edgesRemoved.length, JSON.stringify(events));
});

Then('the graph file and the order file are written together or not at all', function (this: LearningWorld) {
  const depsExists = existsSync(join(this.dir!, 'graph', 'deps.json'));
  const orderExists = existsSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`));
  assert.equal(depsExists, orderExists, `deps.json 存在=${depsExists},order 存在=${orderExists},兩者應該一致`);
});

Then('both offending edges are dropped', function (this: LearningWorld) {
  const c = ctx(this);
  assert.equal(c.depsResult!.edgesRemoved.length, 2, JSON.stringify(c.depsResult!.edgesRemoved));
  assert.equal(detectCycle(c.depsResult!.graph).hasCycle, false, '兩條邊都丟掉之後的圖不該還有循環');
});

Then('the order file exists and lists each card exactly once', function (this: LearningWorld) {
  const c = ctx(this);
  const orderPath = join(this.dir!, 'graph', `order-${CATEGORY}.json`);
  assert.ok(existsSync(orderPath));
  const order = JSON.parse(readFileSync(orderPath, 'utf8')) as CardId[];
  assert.deepEqual([...order].sort(), c.cards.map((card) => card.frontmatter.id).sort());
});

Then('the graph file and the order file are not written', function (this: LearningWorld) {
  assert.equal(existsSync(join(this.dir!, 'graph', 'deps.json')), false, 'deps.json 不該被寫出');
  assert.equal(existsSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`)), false, 'order 檔不該被寫出');
});

Then('the security entry and the security order file are gone', function (this: LearningWorld) {
  // 過期的圖不能靜默留在磁碟上:deps.json 裡這個分類的 key 要消失、order 檔要不見。
  // 注意 deps.json 這個**檔案本身**還在(它裝著別的分類),所以不能拿存不存在檔案來驗。
  const deps = JSON.parse(readFileSync(join(this.dir!, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
  assert.equal(Object.hasOwn(deps, CATEGORY), false, `deps.json 還留著過期的 ${CATEGORY} entry`);
  assert.equal(existsSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`)), false, '過期的 order 檔還在');
});

Then("the other category's entry and order file are untouched", function (this: LearningWorld) {
  const c = ctx(this);
  const deps = JSON.parse(readFileSync(join(this.dir!, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
  assert.deepEqual(deps.language, { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] });
  assert.equal(readFileSync(join(this.dir!, 'graph', 'order-language.json'), 'utf8'), c.languageOrderBefore);
});

Then('a warning naming the remaining cycle is logged', function (this: LearningWorld) {
  const c = ctx(this);
  const events = readFileSync(join(this.dir!, 'state/log.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const firstId = c.cards[0]!.frontmatter.id;
  assert.ok(
    events.some((e) => e.type === 'warning' && typeof e.message === 'string' && (e.message as string).includes(firstId)),
    JSON.stringify(events),
  );
});

Then('the failure names the corrupt graph file', function (this: LearningWorld) {
  const err = this.lastError;
  assert.ok(err, 'dependency analysis 沒有失敗');
  // 「有自己的名字」就是這一句:呼叫端能靠型別分辨「圖檔壞了」與「模型回應壞了」。
  assert.equal(err.name, 'GraphFileCorruptError', `丟出來的是 ${err.name}: ${err.message}`);
  assert.ok(err.message.includes(join(this.dir!, 'graph', 'deps.json')), err.message);
});

Then('the corrupt graph file is left on disk byte for byte', function (this: LearningWorld) {
  const c = ctx(this);
  // 損壞的內容是現場,留給人看:程式沒有理由相信自己猜得出使用者本來有哪些分類。
  assert.equal(readFileSync(join(this.dir!, 'graph', 'deps.json'), 'utf8'), c.corruptDepsBytes);
});

Then('exactly one warning is logged, naming the corrupt graph file as the reason', function (this: LearningWorld) {
  const events = readFileSync(join(this.dir!, 'state/log.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const warnings = events.filter((e) => e.type === 'warning');
  // 恰好一筆:圖檔都讀不出來的時候,「殘留了哪一條循環」那筆在語意上到不了,
  // 兩筆都記等於讓讀 log 的人自己猜哪一筆才是真正的原因。
  assert.equal(warnings.length, 1, JSON.stringify(warnings));
  assert.equal(warnings[0]!.reason, 'graph file corrupt', JSON.stringify(warnings[0]));
  assert.equal(warnings[0]!.file, 'graph/deps.json', JSON.stringify(warnings[0]));
});

Then('an order file exists for the category', function (this: LearningWorld) {
  assert.ok(existsSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`)));
});

Then('the order satisfies the graph', function (this: LearningWorld) {
  const c = ctx(this);
  const order = JSON.parse(readFileSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`), 'utf8')) as CardId[];
  for (const [from, to] of c.depsResult!.graph.edges) {
    assert.ok(order.indexOf(from) < order.indexOf(to), `${from} 應該排在 ${to} 之前`);
  }
});

Then('only the security order file is rewritten', function (this: LearningWorld) {
  const c = ctx(this);
  const languageOrderPath = join(this.dir!, 'graph', 'order-language.json');
  assert.equal(readFileSync(languageOrderPath, 'utf8'), c.languageOrderBefore, 'language 的 order 檔不該被動到');
  assert.ok(existsSync(join(this.dir!, 'graph', `order-${CATEGORY}.json`)));
  const deps = JSON.parse(readFileSync(join(this.dir!, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
  assert.ok(deps.language, 'deps.json 裡 language 的 entry 不該被拿掉');
  assert.deepEqual(deps.language, { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] });
});

// ---------------------------------------------------------------- Then(失敗隔離)

Then('the other four question files exist', function (this: LearningWorld) {
  const c = ctx(this);
  const failedId = c.cards[2]!.frontmatter.id; // 第三張卡(0-based index 2)
  for (const card of c.cards) {
    if (card.frontmatter.id === failedId) continue;
    assert.ok(existsSync(join(this.dir!, 'questions', `${card.frontmatter.id}.yaml`)), `缺少 ${card.frontmatter.id} 的考題檔`);
  }
});

Then('a warning naming the third card and the reason is in the log', function (this: LearningWorld) {
  const c = ctx(this);
  const failedId = c.cards[2]!.frontmatter.id;
  const logPath = join(this.dir!, 'state/log.jsonl');
  // 這筆 log 是 runIngestPipeline()(packages/core/src/ingest/ingest.ts)的責任,
  // 不是 generateQuestionsForCards() 自己的事(見 questions.ts 的介面契約),所以
  // 上面的 When 跑的是完整 pipeline。
  const events = existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
  const warning = events.find(
    (e) => e.type === 'warning' && typeof e.message === 'string' && (e.message as string).includes(failedId),
  );
  assert.ok(warning, JSON.stringify(events));
  // 「and the reason」:光有 card id 不算,訊息要帶上失敗原因本身。
  const failure = c.pipelineResult!.questionFailures.find((f) => f.card === failedId);
  assert.ok(failure, JSON.stringify(c.pipelineResult!.questionFailures));
  assert.ok(
    (warning!.message as string).includes(failure!.error),
    `warning 沒有帶上失敗原因: ${String(warning!.message)}`,
  );
});

/**
 * 「the command」是真的那支 CLI(scripts/ingest.ts),所以這裡真的把它 spawn 起來,
 * 不是在程序內模擬一次。CLI 沒有注入 router 的縫(它自己 `new LlmRouterImpl(...)`),
 * 而參數解析、複製 raw、印出清單、退出碼正是這一句要驗的東西,不能繞過去——所以
 * 改在最外層的網路邊界造假:`--import features/steps/_fake-cloud.mjs` 換掉子程序的
 * globalThis.fetch,LlmRouterImpl / CloudLlmRouter / anthropicAdapter / Anthropic SDK
 * 全部跑真的,只是不打真網路(細節見那個檔案的檔頭)。
 *
 * 上面的 When 跑的是程序內的 runIngestPipeline(),拿不到退出碼,所以這一句自己
 * 另外跑一次 CLI(另一個乾淨目錄),故意讓同一張卡失敗。
 */
Then('the command prints the failed card and exits with a non-zero status', function (this: LearningWorld) {
  const c = ctx(this);
  const failedId = c.cards[2]!.frontmatter.id;
  const cliOut = mkdtempSync(join(tmpdir(), 'lc-ingest-cli-'));
  try {
    const run = this.runCommand(
      `npx tsx --import ./features/steps/_fake-cloud.mjs scripts/ingest.ts` +
        ` --file contracts/fixtures/raw/security-basics.md --out "${cliOut}" --category ${CATEGORY}`,
      {
        env: {
          LLM_CLOUD_PROVIDER: 'anthropic',
          LLM_CLOUD_MODEL: 'test-model',
          ANTHROPIC_API_KEY: 'test-anthropic-key',
          FAKE_CLOUD_LEVEL0_COUNT: String(c.cards.length),
          FAKE_CLOUD_QUESTIONS_FAIL_CARD: failedId,
        },
        timeoutMs: 180_000,
      },
    );

    // 先確認這一跑真的走到底(卡片有建出來),否則任何早期崩潰都會是「非 0」而假綠。
    assert.ok(run.output.includes(c.cards[0]!.frontmatter.id), `CLI 沒有印出建立的卡片:\n${run.output}`);
    assert.ok(run.output.includes(failedId), `CLI 沒有印出失敗的卡片 ${failedId}:\n${run.output}`);
    assert.notEqual(run.status, 0, `退出碼應該非 0,實際是 ${run.status}:\n${run.output}`);
    assert.notEqual(run.status, null, `CLI 沒有正常結束(逾時或無法啟動):\n${run.output}`);
    // 失敗的那張卡不該留下考題檔,其餘的要留下——「不失去其他卡」在 CLI 這一路也成立。
    assert.equal(existsSync(join(cliOut, 'questions', `${failedId}.yaml`)), false, `${failedId} 不該有考題檔`);
    for (const card of c.cards) {
      if (card.frontmatter.id === failedId) continue;
      assert.ok(
        existsSync(join(cliOut, 'questions', `${card.frontmatter.id}.yaml`)),
        `CLI 這一路缺少 ${card.frontmatter.id} 的考題檔`,
      );
    }
  } finally {
    rmSync(cliOut, { recursive: true, force: true });
  }
});

Then('all five question files exist', function (this: LearningWorld) {
  const c = ctx(this);
  for (const card of c.cards) {
    assert.ok(existsSync(join(this.dir!, 'questions', `${card.frontmatter.id}.yaml`)), `缺少 ${card.frontmatter.id} 的考題檔`);
  }
});

Then('the log records one truncated call', function (this: LearningWorld) {
  const logPath = join(this.dir!, 'state/log.jsonl');
  const events = existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
  const truncated = events.filter((e) => e.type === 'llm_call' && e.retry_reason === 'output_truncated');
  assert.equal(truncated.length, 1, JSON.stringify(events));
});
