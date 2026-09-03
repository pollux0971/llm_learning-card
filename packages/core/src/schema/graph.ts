/**
 * 介面契約(phase-3,給下一輪開發 agent):以下每個 export 只有簽章,函式體
 * 全部 throw new Error('not implemented')。行為規格見同目錄 graph.test.ts
 * 與 features/01-data-layer/phase-3.feature 的 10 個 scenario——每個函式的
 * 一行註解只點出邊界,細節以測試為準。
 *
 * ---- 型別 ----
 * interface Graph { nodes: CardId[]; edges: [CardId, CardId][] }        // 契約 §8,[先備, 後學]
 * interface ValidationResult { ok: boolean; errors: string[] }
 * interface CycleResult { hasCycle: boolean; path: CardId[] }           // path 頭尾同一張卡;無循環時 []
 * interface CardPrereqs { id: CardId; prereqs: CardId[] }
 *
 * ---- 函式 ----
 * readCategoryGraph(learningDir: string, category: CategoryId): Graph
 * validateGraphEdges(graph: Graph): ValidationResult
 * detectCycle(graph: Graph): CycleResult
 * topologicalSort(graph: Graph): CardId[]
 * writeCategoryOrder(learningDir: string, category: CategoryId, order: CardId[]): void
 * computeAndSaveCategoryOrder(learningDir: string, category: CategoryId): CardId[]
 * checkPrereqConsistency(cards: CardPrereqs[], graph: Graph): ValidationResult
 */

import type { CardId, CategoryId } from '@contracts/index.js';

/** 契約 §8:一個分類的依賴圖。nodes 依原始素材出現順序;edges 是 [先備, 後學]。 */
export interface Graph {
  nodes: CardId[];
  edges: [CardId, CardId][];
}

/** 跟 review.ts / log.ts 一樣的本地慣例:每個 schema 檔自己定義,不共用一個全域型別。 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 循環偵測的回傳:hasCycle 為 false 時 path 是空陣列;為 true 時 path 頭尾是同一張卡。 */
export interface CycleResult {
  hasCycle: boolean;
  path: CardId[];
}

/** 一致性檢查要用到的卡片最小資訊:自己的 id 與 frontmatter 的 prereqs。 */
export interface CardPrereqs {
  id: CardId;
  prereqs: CardId[];
}

/** 從 learningDir/graph/deps.json(Record<CategoryId, Graph>)篩出單一分類。 */
export function readCategoryGraph(_learningDir: string, _category: CategoryId): Graph {
  throw new Error('not implemented');
}

/** 驗證每條邊的兩端都存在於 graph.nodes;不存在時錯誤要點名缺的那張卡。 */
export function validateGraphEdges(_graph: Graph): ValidationResult {
  throw new Error('not implemented');
}

/** 偵測循環並回報成一條路徑(頭尾同一張卡)。自環(a→a)也算循環。 */
export function detectCycle(_graph: Graph): CycleResult {
  throw new Error('not implemented');
}

/** 拓樸排序:先備排前面;沒有順序關係的兩張卡用 graph.nodes 的原始順序當 tie-break。 */
export function topologicalSort(_graph: Graph): CardId[] {
  throw new Error('not implemented');
}

/** 把某分類的拓樸序寫進 graph/order-<category>.json(重用 atomic-write.ts),只動這個分類的檔案。 */
export function writeCategoryOrder(_learningDir: string, _category: CategoryId, _order: CardId[]): void {
  throw new Error('not implemented');
}

/** readCategoryGraph + topologicalSort + writeCategoryOrder 的組合捷徑,回傳寫入的順序。 */
export function computeAndSaveCategoryOrder(_learningDir: string, _category: CategoryId): CardId[] {
  throw new Error('not implemented');
}

/** 卡片自己 frontmatter 的 prereqs 欄位要跟圖裡以它為後學的邊一致;不一致要點名是哪張卡。 */
export function checkPrereqConsistency(_cards: CardPrereqs[], _graph: Graph): ValidationResult {
  throw new Error('not implemented');
}
