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

import type { Card, CardId, CategoryId } from '@contracts/index.js';
import type { LlmRouter } from '@core/llm/index.js';
import type { Graph } from '@core/schema/graph.js';

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

export function writeCategoryGraph(_outDir: string, _category: CategoryId, _graph: Graph): void {
  throw new Error('not implemented');
}

export async function analyzeDependencies(
  _category: CategoryId,
  _cards: Card[],
  _router: LlmRouter,
  _outDir: string,
): Promise<AnalyzeDependenciesResult> {
  throw new Error('not implemented');
}
