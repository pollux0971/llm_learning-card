/**
 * 介面契約(phase-2,給下一輪開發 agent):以下每個 export 只有簽章,函式體
 * 全部 throw new Error('not implemented')。行為規格見同目錄 deps.test.ts 與
 * features/02-ingest-pipeline/phase-2.feature 的 Scenario 5、6、7、8。
 *
 * 分析一個分類的先備關係(契約 §8)並寫出 deps.json 與該分類的 order 檔。呼叫
 * LlmTask 'ingest.deps'(硬約定 §7,cloud-only)。
 *
 * **不重新發明圖演算法**:邊驗證、循環偵測、拓樸排序、order 檔寫入全部直接用
 * 01-data-layer 的 graph.ts(validateGraphEdges / detectCycle / topologicalSort
 * 由 computeAndSaveCategoryOrder 內部呼叫,這裡不用再呼叫一次)。這個模組只負責
 * ①組出 Graph、②處理「模型回應有循環」的重試/丟邊、③把 Graph 併回 deps.json、
 * ④把卡片 frontmatter.prereqs 寫回跟 graph 一致。
 *
 * **循環處理**(Scenario 6):第一次呼叫模型的回應有循環 →
 * 用「這條路徑循環了」的描述再呼叫模型一次(附上 detectCycle() 回傳的 path) →
 * 如果第二次還是循環,丟掉造成循環的那條邊(path 最後一段:
 * [path[path.length-2], path[path.length-1]]),記一筆 'cycle_removed' 事件到
 * log.jsonl(見 contracts/types.md §10 EventType,'cycle_removed' 已經是硬約定
 * 允許的事件型別)。只挑戰一次——第二次之後不管有沒有循環都不再呼叫模型。
 *
 * **每張 level 1 卡的 parent 一定是它的先備**(Scenario 5:「every level one
 * card lists its parent as a prerequisite」):不管模型回應有沒有包含這條邊,
 * analyzeDependencies() 都要把每張有 parent 欄位的卡片的 [parent, id] 邊併進
 * graph,這是這個函式該保證的不變量,不是靠 prompt 拜託模型記得。
 *
 * **只重排受影響的 category**(Scenario 8):deps.json 用 writeCategoryGraph()
 * 只覆寫呼叫者指定的那個 category 的 entry;order 檔用 01 的
 * computeAndSaveCategoryOrder(outDir, category),它本來就只寫
 * graph/order-<category>.json,不用額外邏輯偵測「哪些分類受影響」——呼叫模式
 * 本身(一次只傳一個 category 的 cards)就保證了這件事。
 *
 * ---- 型別 ----
 * interface DepsEdgeResponse { edges: [CardId, CardId][] }               // 模型回應
 * interface AnalyzeDependenciesResult {
 *   graph: Graph;
 *   order: CardId[];
 *   cardsUpdated: CardId[];                        // frontmatter.prereqs 被改寫的卡片
 *   cycleRemoved: [CardId, CardId] | null;          // 二次挑戰仍循環而被丟棄的邊
 * }
 *
 * ---- 函式 ----
 * writeCategoryGraph(outDir: string, category: CategoryId, graph: Graph): void
 *   把 graph 併進 outDir/graph/deps.json(Record<CategoryId, Graph>),只替換
 *   category 這個 key,其他分類的 entry 原樣保留(檔案不存在就當空物件處理)。
 * analyzeDependencies(category: CategoryId, cards: Card[], router: LlmRouter, outDir: string):
 *   Promise<AnalyzeDependenciesResult>
 *   1. nodes = cards 的 id,依傳入順序
 *   2. 呼叫 router.call('ingest.deps', prompt) 取得第一次的 edges
 *   3. 把每張有 parent 的卡的 [parent, id] 併入 edges(見上面的不變量)
 *   4. detectCycle(graph)(01 的函式);有循環才進第 5 步,否則跳到第 6 步
 *   5. 再呼叫一次 router.call('ingest.deps', 附帶循環路徑的 prompt),重複 3、
 *      detectCycle;還是循環就丟掉 path 最後一段的邊,記 'cycle_removed' 事件,
 *      cycleRemoved 設成那條邊;否則 cycleRemoved 為 null
 *   6. writeCategoryGraph(outDir, category, graph)
 *   7. 把 graph 蘊含的 prereqs 寫回每張卡片的 frontmatter(跟目前檔案內容不一致
 *      的才需要真的重寫磁碟),回傳被改寫的 card id 到 cardsUpdated
 *   8. computeAndSaveCategoryOrder(outDir, category)(01 的函式,內部會自己重跑
 *      validateGraphEdges/detectCycle/topologicalSort 並寫 order 檔),把回傳值
 *      放進 order
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { Card, CardId, CategoryId } from '@contracts/index.js';
import type { LlmRouter } from '@core/llm/index.js';
import { computeAndSaveCategoryOrder, detectCycle, type Graph } from '@core/schema/graph.js';
import { atomicWriteJson, appendLogEvent } from './state.js';
import { loadPromptTemplate } from './prompts.js';

// Stryker disable next-line all: 模組載入時執行一次的靜態初始化,coverageAnalysis: perTest 下不歸屬任何測試(coveredBy 恆為空),
// 錯字會讓 readFileSync 在 import 當下就丟 ENOENT、整個測試檔案載入失敗,等同被所有測試殺死,只是 Stryker 的 per-test 模型算不出來。
const DEPS_TEMPLATE = loadPromptTemplate('deps');

/** 模型對 'ingest.deps' 的回應形狀。 */
export interface DepsEdgeResponse {
  edges: [CardId, CardId][];
}

export interface AnalyzeDependenciesResult {
  graph: Graph;
  order: CardId[];
  cardsUpdated: CardId[];
  cycleRemoved: [CardId, CardId] | null;
}

/**
 * TODO(下一輪開發 agent):依卡片數量算 'ingest.deps' 這次呼叫的動態 maxTokens,
 * 取代 token-limits.ts 裡固定的 2048(真的跑 30 張卡的分類時,固定值會把回應截斷,
 * 依賴圖分析整段被跳過——見 deps-token-scaling 這輪的任務描述)。
 *
 * 估算依據:模型回應是 `{ edges: [CardId, CardId][] }`,每條邊序列化成 JSON
 * 大約 15–25 tokens(兩個 card id 字串 + 陣列語法);cards.length 張卡通常會產生
 * 跟卡片數量同量級的邊數(不會是平方級——每張卡平均只跟少數幾張卡有先備關係)。
 * 建議公式:`Math.min(16384, Math.max(2048, cardCount * 256))`
 *   - 下限 2048:保留給小分類原本就夠用的空間,也是 token-limits.ts 的舊預設值。
 *   - 每卡 256 tokens:覆蓋「每條邊 15–25 tokens」估計的數倍安全邊界,含 JSON 縮排、
 *     多條邊、以及模型可能比預期多列一些邊的餘裕。
 *   - 上限 16384:避免卡片數量沒有上限時,單次呼叫的預算跟著無限長大。
 *
 * 這裡先佔位維持舊行為(恆回傳下限值),函式體真的算動態值留給下一輪開發 agent。
 * analyzeDependencies() 兩次呼叫 router.call('ingest.deps', ...) 都要把這個值
 * 放進 opts.maxTokens——目前還沒接,見本檔案 fetchEdges() 與 analyzeDependencies()。
 */
export function computeDepsMaxTokens(cardCount: number): number {
  // TODO: 換成 Math.min(16384, Math.max(2048, cardCount * 256)) 或依實測調整的等效公式。
  return 2048;
}

export function writeCategoryGraph(outDir: string, category: CategoryId, graph: Graph): void {
  const depsPath = join(outDir, 'graph', 'deps.json');
  const existing = existsSync(depsPath) ? (JSON.parse(readFileSync(depsPath, 'utf8')) as Record<string, Graph>) : {};
  atomicWriteJson(depsPath, { ...existing, [category]: graph });
}

function buildDepsPrompt(category: CategoryId, cards: Card[], cyclePath?: CardId[]): string {
  const cardLines = cards.map((c) => `- ${c.frontmatter.id}: ${c.frontmatter.title}`);
  const lines = [DEPS_TEMPLATE, '---', `category: ${category}`, '', 'cards:', ...cardLines];
  // Stryker disable next-line all: cyclePath 只會是 undefined(第一次呼叫)或 detectCycle 回傳、
  // hasCycle 為 true 時的 path——graph.ts 的不變量保證這種 path「頭尾是同一張卡」,長度必定 >= 2,
  // 不可能是空陣列。length > 0 這個檢查因此永遠是防呆,不會走到 false 分支。
  if (cyclePath && cyclePath.length > 0) {
    lines.push('', `之前的回應形成循環,不能再回同一條路徑: ${cyclePath.join(' -> ')}`);
  }
  return lines.join('\n');
}

async function fetchEdges(
  router: LlmRouter,
  category: CategoryId,
  cards: Card[],
  cyclePath?: CardId[],
): Promise<[CardId, CardId][]> {
  const result = await router.call('ingest.deps', buildDepsPrompt(category, cards, cyclePath));
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (err) {
    throw new Error(`ingest.deps 回應不是合法 JSON: ${(err as Error).message}`);
  }
  const obj = parsed as Partial<DepsEdgeResponse>;
  if (!Array.isArray(obj.edges)) throw new Error('ingest.deps 回應缺少 edges 陣列');
  return obj.edges.map(([from, to]) => [from, to] as [CardId, CardId]);
}

/** 每張有 parent 的卡,它的 [parent, id] 一定要是先備邊(不變量,不靠模型記得)。 */
function parentEdgesOf(cards: Card[]): [CardId, CardId][] {
  const edges: [CardId, CardId][] = [];
  for (const c of cards) {
    const parent = c.frontmatter.parent;
    if (parent) edges.push([parent, c.frontmatter.id]);
  }
  return edges;
}

/** 合併兩組邊,去掉完全相同的重複 [from, to]。 */
function mergeEdges(a: [CardId, CardId][], b: [CardId, CardId][]): [CardId, CardId][] {
  const seen = new Set<string>();
  const merged: [CardId, CardId][] = [];
  for (const [from, to] of [...a, ...b]) {
    const key = `${from} ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push([from, to]);
  }
  return merged;
}

/** 依 graph.edges 算出每張卡「應有」的先備集合,依邊出現順序去重。 */
function prereqsByCardOf(graph: Graph): Map<CardId, CardId[]> {
  const map = new Map<CardId, CardId[]>();
  for (const [from, to] of graph.edges) {
    let list = map.get(to);
    if (!list) {
      list = [];
      map.set(to, list);
    }
    // Stryker disable next-line all: prereqsByCardOf 只被 writeUpdatedPrereqs 用已經跑過 mergeEdges() 的
    // graph.edges 呼叫,mergeEdges 本身已經保證同一個 [from, to] 不會出現兩次——所以同一個 to 底下不可能
    // 收到兩次相同的 from,這裡的 includes 檢查在目前唯一呼叫路徑下永遠是 true,是防呆而非可達分支。
    if (!list.includes(from)) list.push(from);
  }
  return map;
}

function writeCardFile(cardsDir: string, card: Card): void {
  mkdirSync(cardsDir, { recursive: true });
  const yamlFm = yamlStringify(card.frontmatter).trimEnd();
  const exampleBlocks = card.examples.map((e) => '```example\n' + e.trim() + '\n```').join('\n\n');
  const content = `---\n${yamlFm}\n---\n\n${card.body.trim()}\n${exampleBlocks ? '\n' + exampleBlocks + '\n' : ''}`;
  writeFileSync(join(cardsDir, `${card.frontmatter.id}.md`), content, 'utf8');
}

/** 把 graph 蘊含的 prereqs 寫回跟目前不一致的卡片,回傳被改寫的 card id。 */
function writeUpdatedPrereqs(outDir: string, cards: Card[], graph: Graph): CardId[] {
  const prereqsByCard = prereqsByCardOf(graph);
  const updated: CardId[] = [];

  for (const card of cards) {
    const computed = prereqsByCard.get(card.frontmatter.id) ?? [];
    // Stryker disable next-line all: card.frontmatter 的型別是 CardFrontmatterSchema(z.infer 輸出),prereqs
    // 是 .optional().default([]),輸出型別永遠是 CardId[]、不可能是 undefined——這裡的 ?? [] 是防呆,在型別
    // 保證成立的前提下,`&&` 與 `??` 對這個欄位的行為相同(equivalent)。
    const stored = card.frontmatter.prereqs ?? [];
    const same = stored.length === computed.length && stored.every((id) => computed.includes(id));
    if (same) continue;

    updated.push(card.frontmatter.id);
    const cardsDir = join(outDir, 'cards', card.frontmatter.category);
    writeCardFile(cardsDir, { ...card, frontmatter: { ...card.frontmatter, prereqs: computed } });
  }

  return updated;
}

export async function analyzeDependencies(
  category: CategoryId,
  cards: Card[],
  router: LlmRouter,
  outDir: string,
): Promise<AnalyzeDependenciesResult> {
  const nodes = cards.map((c) => c.frontmatter.id);
  const parentEdges = parentEdgesOf(cards);

  const firstEdges = await fetchEdges(router, category, cards);
  let edges = mergeEdges(firstEdges, parentEdges);
  let graph: Graph = { nodes, edges };
  let cycle = detectCycle(graph);

  let cycleRemoved: [CardId, CardId] | null = null;

  if (cycle.hasCycle) {
    const retryEdges = await fetchEdges(router, category, cards, cycle.path);
    edges = mergeEdges(retryEdges, parentEdges);
    graph = { nodes, edges };
    cycle = detectCycle(graph);

    if (cycle.hasCycle) {
      const path = cycle.path;
      const offending: [CardId, CardId] = [path[path.length - 2]!, path[path.length - 1]!];
      edges = edges.filter(([from, to]) => !(from === offending[0] && to === offending[1]));
      graph = { nodes, edges };
      cycleRemoved = offending;
      appendLogEvent(join(outDir, 'state/log.jsonl'), {
        ts: new Date().toISOString(),
        type: 'cycle_removed',
        category,
        edge: offending,
      });
    }
  }

  writeCategoryGraph(outDir, category, graph);
  const cardsUpdated = writeUpdatedPrereqs(outDir, cards, graph);
  const order = computeAndSaveCategoryOrder(outDir, category);

  return { graph, order, cardsUpdated, cycleRemoved };
}
