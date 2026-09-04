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
 * **循環處理**(cycle-local-repair,取代原本的 Scenario 6):第一次呼叫模型的
 * 回應有循環 → 用「這條路徑循環了」的描述再呼叫模型一次(附上 detectCycle() 回傳
 * 的 path)。模型呼叫次數就此打住,最多兩次——第二次之後不管有沒有循環都不再
 * 呼叫模型。
 *
 * 如果第二次還是循環,不能只丟一條邊就直接寫檔:真的跑 29 張卡的文章時撞到模型
 * 回應有兩個獨立循環,只丟一條邊完全沒解決,deps.json 寫出一個帶循環的圖,order
 * 檔卻因為 topologicalSort() 丟錯而沒寫——磁碟上留下自相矛盾的狀態(deps.json
 * 有環,但契約 §8 的語意上該是 DAG)。改成本地迴圈(不再呼叫模型):
 * detectCycle → 用 path 算出 back edge([path[path.length-2], path[path.length-1]])
 * → 從 edges 濾掉 → 再 detectCycle,重複直到無環或丟邊次數達上限(用
 * cards.length 當上限,避免無窮迴圈)。每丟一條邊都各自記一筆 'cycle_removed'
 * 事件到 log.jsonl(見 contracts/types.md §10 EventType,'cycle_removed' 已經是
 * 硬約定允許的事件型別)。丟邊必須確定性:同樣輸入永遠丟同一條——只要不改變
 * nodes/edges 的走訪順序,detectCycle() 的 DFS 本身已經保證這件事。
 *
 * 達上限仍然有循環 → graph/deps.json 跟 order 檔都不寫(維持契約 §8「要嘛都寫、
 * 要嘛都不寫」的不變量),改記一筆 'warning'(格式比照 ingest.ts 既有的
 * warning log,message 要包含殘留的循環路徑),**並且移除該分類上一次留下的過期
 * 圖資料**(removeCategoryGraph():deps.json 的該 key + order 檔,粒度是分類,
 * 不是整個檔)——不然舊檔會靜默過期,見 ADR-038。見 removeCyclesLocally() 與
 * AnalyzeDependenciesResult 的說明。
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
 *   edgesRemoved: [CardId, CardId][];               // 本地迴圈依丟棄順序記錄的邊;無循環時 []
 *   cycleUnresolved: CardId[] | null;               // 丟邊達上限仍有循環時的殘留路徑;否則 null
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
 *      detectCycle;還是循環就呼叫 removeCyclesLocally(graph, cards.length)
 *      (本地迴圈,不再呼叫模型)——無循環或在上限內清乾淨就繼續第 6 步;達上限
 *      仍有循環就記一筆 'warning'(含殘留路徑),直接回傳(不寫 deps.json、不寫
 *      order 檔、cardsUpdated 給 []、order 給 []、cycleUnresolved 設成殘留路徑)
 *   6. writeCategoryGraph(outDir, category, graph)
 *   7. 把 graph 蘊含的 prereqs 寫回每張卡片的 frontmatter(跟目前檔案內容不一致
 *      的才需要真的重寫磁碟),回傳被改寫的 card id 到 cardsUpdated
 *   8. computeAndSaveCategoryOrder(outDir, category)(01 的函式,內部會自己重跑
 *      validateGraphEdges/detectCycle/topologicalSort 並寫 order 檔),把回傳值
 *      放進 order
 * removeCyclesLocally(graph: Graph, maxDrops: number):
 *   { graph: Graph; edgesRemoved: [CardId, CardId][]; unresolved: CardId[] | null }
 *   純函式,不做 I/O。detectCycle → 濾掉 back edge → 再 detectCycle,重複到無環
 *   或丟邊次數達 maxDrops。呼叫端(analyzeDependencies())負責把 edgesRemoved
 *   逐一 log 成 'cycle_removed' 事件——這裡只算,不寫檔。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  /** 本地迴圈依丟棄順序記錄的邊;沒有循環或第二次挑戰就過時為 []。 */
  edgesRemoved: [CardId, CardId][];
  /**
   * 丟邊次數達上限仍有循環時,殘留的循環路徑(detectCycle 的 path,頭尾同一張
   * 卡);否則 null。不為 null 時,deps.json 與 order 檔都不寫,cardsUpdated 與
   * order 給空陣列——見 removeCyclesLocally() 與 analyzeDependencies() 的說明。
   */
  cycleUnresolved: CardId[] | null;
}

export interface RemoveCyclesLocallyResult {
  graph: Graph;
  edgesRemoved: [CardId, CardId][];
  unresolved: CardId[] | null;
}

/**
 * 本地迴圈版的循環修復(cycle-local-repair):detectCycle → 依 path 算出 back edge
 * ([path[path.length-2], path[path.length-1]])、從 edges 濾掉 → 再 detectCycle,
 * 重複直到無環或丟邊次數達 maxDrops。純函式,不做 I/O。
 *
 * 取代原本「第二次仍有循環就丟一條邊、不管圖還有沒有殘留循環就直接寫檔」的行為
 * (真的跑 29 張卡的文章時撞到:模型回應有兩個獨立循環,只丟一條邊完全沒解決,
 * deps.json 寫出一個帶循環的圖,order 檔卻因 topologicalSort() 丟錯而沒寫——
 * 磁碟上留下自相矛盾的狀態)。
 *
 * 丟邊是確定性的:這裡不排序、不用 Set/Map 的迭代順序決定丟哪條,只沿用
 * detectCycle() 的 DFS(它照 nodes/edges 的原始順序建鄰接表)找到的第一個循環,
 * 而 filter() 保留其餘邊的相對順序,所以同一組輸入永遠丟出同一串邊、順序也一樣。
 *
 * 回傳:
 *   - 無循環或在 maxDrops 內清乾淨:edgesRemoved 記下依丟棄順序的每一條邊,
 *     unresolved 是 null。
 *   - 丟到 maxDrops 次還有循環:unresolved 是最後一次 detectCycle() 回傳的 path
 *     (呼叫端要用它組出警告訊息);graph 是丟到第 maxDrops 條邊之後的狀態
 *     (呼叫端在這個情況下不該把它寫進 deps.json——見 AnalyzeDependenciesResult)。
 *
 * 呼叫端(analyzeDependencies() 的第二次挑戰之後)負責把 edgesRemoved 的每一條邊
 * 各自 log 一筆 'cycle_removed' 事件——這裡只算,不寫檔。
 */
export function removeCyclesLocally(graph: Graph, maxDrops: number): RemoveCyclesLocallyResult {
  const nodes = graph.nodes;
  let edges = graph.edges;
  const edgesRemoved: [CardId, CardId][] = [];

  for (;;) {
    const cycle = detectCycle({ nodes, edges });
    if (!cycle.hasCycle) return { graph: { nodes, edges }, edgesRemoved, unresolved: null };
    // 已經丟滿上限還有環:不再丟,把殘留的路徑交給呼叫端組警告訊息。
    if (edgesRemoved.length >= maxDrops) return { graph: { nodes, edges }, edgesRemoved, unresolved: cycle.path };

    const path = cycle.path;
    const offending: [CardId, CardId] = [path[path.length - 2]!, path[path.length - 1]!];
    edges = edges.filter(([from, to]) => !(from === offending[0] && to === offending[1]));
    edgesRemoved.push(offending);
  }
}

/**
 * 依卡片數量算 'ingest.deps' 這次呼叫的動態 maxTokens,取代 token-limits.ts 裡固定的
 * 2048(卡片一多,固定值會把回應截斷,依賴圖分析整段被跳過)。
 *
 * 估算依據:模型回應是 `{ edges: [CardId, CardId][] }`,每條邊序列化成 JSON
 * 大約 15–25 tokens(兩個 card id 字串 + 陣列語法);cards.length 張卡通常會產生
 * 跟卡片數量同量級的邊數(不會是平方級——每張卡平均只跟少數幾張卡有先備關係)。
 *   - 下限 2048:保留給小分類原本就夠用的空間,也是 token-limits.ts 的舊預設值。
 *   - 每卡 256 tokens:覆蓋「每條邊 15–25 tokens」估計的數倍安全邊界,含 JSON 縮排、
 *     多條邊、以及模型可能比預期多列一些邊的餘裕。
 *   - 上限 16384:避免卡片數量沒有上限時,單次呼叫的預算跟著無限長大。
 */
export function computeDepsMaxTokens(cardCount: number): number {
  return Math.min(16384, Math.max(2048, cardCount * 256));
}

/**
 * 移除一個分類的**過期**圖資料。
 *
 * 為什麼需要這個:`analyzeDependencies()` 丟邊達上限仍有循環時會 early return、
 * 兩個檔都不寫——但那只保證「**這一次**不寫」。上一次成功的 run 如果已經寫過
 * `graph/deps.json` 與 `graph/order-<category>.json`,舊檔還留在磁碟上,讀的人
 * 拿到的是**過期的圖卻看不出來**(09-lint 目前沒有「卡片不在 order 裡」這條
 * 檢查,所以「留著+標記」等於沒人會發現)。圖是衍生資料、可以從卡片重生,所以
 * 選擇直接移除,讓「沒有圖」變成一個看得見的明確狀態。見 ADR-038。
 *
 * 粒度是**分類**,不是整個檔(契約 §8:`deps.json` 的型別是
 * `Record<CategoryId, Graph>`,一個檔裝所有分類):
 *   1. 讀進整個 `deps.json`,只刪掉 `category` 這個 key,整檔**原子重寫**
 *      (`atomicWriteJson`:寫 `.tmp` → fsync → rename,比照契約 §11b)。
 *      其他分類的 entry 一個都不能動。
 *   2. 刪掉 `graph/order-<category>.json`。
 *   3. 刪到 `deps.json` 變成空物件 `{}` 時,**檔案留著**(`{}` 是
 *      `Record<CategoryId, Graph>` 的合法值,而且「檔在、key 不在」跟「檔不在」
 *      對消費者是同一個答案:這個分類沒有圖)。理由見 ADR-038。
 *
 * 全部邊界情況都不該丟錯,因為呼叫端已經在處理另一個錯誤(殘留循環),清理失敗
 * 不該把那筆 warning 蓋掉:
 *   - `deps.json` 不存在 → 什麼都不用做(也不要為此建出一個空檔)。
 *   - `deps.json` 存在但沒有 `category` 這個 key → 完全不重寫,其他 key 連位元組
 *     都不動(少一次寫入,也少一個「重寫途中斷電」的機會)。
 *   - `graph/order-<category>.json` 不存在 → `rmSync` 的 force 選項直接吸收掉。
 *
 * 行為規格見同目錄 deps.test.ts 的 describe('removeCategoryGraph') 與
 * features/02-ingest-pipeline/phase-2.feature 的
 * 「Exhausting the drop limit removes the category's stale graph data」。
 */
export function removeCategoryGraph(outDir: string, category: CategoryId): void {
  const graphDir = join(outDir, 'graph');
  const depsPath = join(graphDir, 'deps.json');

  if (existsSync(depsPath)) {
    const existing = JSON.parse(readFileSync(depsPath, 'utf8')) as Record<string, Graph>;
    // 沒有這個 key 就不重寫:讓「沒東西可刪」真的是一次 no-op。
    if (Object.hasOwn(existing, category)) {
      const { [category]: _removed, ...rest } = existing;
      atomicWriteJson(depsPath, rest);
    }
  }

  // force: true 讓「order 檔本來就不在」不丟 ENOENT——一類一檔,直接刪。
  rmSync(join(graphDir, `order-${category}.json`), { force: true });
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
  maxTokens: number,
  cyclePath?: CardId[],
): Promise<[CardId, CardId][]> {
  const result = await router.call('ingest.deps', buildDepsPrompt(category, cards, cyclePath), { maxTokens });
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
  const maxTokens = computeDepsMaxTokens(cards.length);

  const firstEdges = await fetchEdges(router, category, cards, maxTokens);
  let edges = mergeEdges(firstEdges, parentEdges);
  let graph: Graph = { nodes, edges };
  const cycle = detectCycle(graph);

  let edgesRemoved: [CardId, CardId][] = [];
  const logPath = join(outDir, 'state/log.jsonl');

  if (cycle.hasCycle) {
    // 模型呼叫就此打住,最多兩次——第二次之後不管有沒有循環都改用本地迴圈修。
    const retryEdges = await fetchEdges(router, category, cards, maxTokens, cycle.path);
    edges = mergeEdges(retryEdges, parentEdges);

    const repaired = removeCyclesLocally({ nodes, edges }, cards.length);
    graph = repaired.graph;
    edgesRemoved = repaired.edgesRemoved;
    for (const edge of edgesRemoved) {
      appendLogEvent(logPath, { ts: new Date().toISOString(), type: 'cycle_removed', category, edge });
    }

    if (repaired.unresolved) {
      // 契約 §8 的語意上 deps.json 該是 DAG,order 檔又是 topologicalSort() 的產物:
      // 兩個都不寫,好過留下「有環的 deps.json + 沒有 order」的自相矛盾狀態。
      //
      // 「不寫」只保證這一次不寫;上一次成功的 run 留在磁碟上的舊 deps.json entry 與
      // 舊 order 檔會變成**看不出來的過期資料**。ADR-038 決定直接移除該分類的圖,
      // 讓「沒有圖」是一個明確狀態。順序:先移除,再記 warning(warning 是這次
      // 事件的紀錄,清理是磁碟狀態的收斂,兩者都要發生)。
      removeCategoryGraph(outDir, category);
      appendLogEvent(logPath, {
        ts: new Date().toISOString(),
        type: 'warning',
        file: 'graph/deps.json',
        message: `依賴圖丟了 ${edgesRemoved.length} 條邊(上限 ${cards.length})仍有循環,deps.json 與 order 檔都不寫:${repaired.unresolved.join(' -> ')}`,
      });
      return { graph, order: [], cardsUpdated: [], edgesRemoved, cycleUnresolved: repaired.unresolved };
    }
  }

  writeCategoryGraph(outDir, category, graph);
  const cardsUpdated = writeUpdatedPrereqs(outDir, cards, graph);
  const order = computeAndSaveCategoryOrder(outDir, category);

  return { graph, order, cardsUpdated, edgesRemoved, cycleUnresolved: null };
}
