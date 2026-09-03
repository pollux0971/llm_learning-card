/**
 * 依賴圖(契約 §8):讀取、驗證、循環偵測、拓樸排序、寫出每個分類的順序檔。
 * 行為規格見同目錄 graph.test.ts 與 features/01-data-layer/phase-3.feature 的 10 個
 * scenario。產生圖本身是 ingest 的事,這裡只管圖的形狀與排序演算法。
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

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CardIdSchema, CategoryIdSchema, type CardId, type CategoryId } from '@contracts/index.js';
import { writeFileAtomic } from './atomic-write.js';

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

// ---------------------------------------------------------------- 磁碟格式(§8)

/**
 * deps.json 的形狀,只在讀檔時用來擋掉壞掉的檔案。契約 §8 沒有定義 zod schema
 * (contracts/ 是硬約定,這裡不加),所以模組內自己描述一次,跟 Graph 介面一致。
 */
const GraphSchema = z.object({
  nodes: z.array(CardIdSchema),
  edges: z.array(z.tuple([CardIdSchema, CardIdSchema])),
});

const DepsFileSchema = z.record(CategoryIdSchema, GraphSchema);

const DEPS_FILE = join('graph', 'deps.json');

/** 契約 §8:`graph/order-<category>.json`。category 先過 CategoryIdSchema,擋掉路徑穿越。 */
function orderFilePath(learningDir: string, category: CategoryId): string {
  const parsed = CategoryIdSchema.safeParse(category);
  if (!parsed.success) {
    throw new Error(`無效的分類 id "${category}":${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return join(learningDir, 'graph', `order-${parsed.data}.json`);
}

/** 從 learningDir/graph/deps.json(Record<CategoryId, Graph>)篩出單一分類。 */
export function readCategoryGraph(learningDir: string, category: CategoryId): Graph {
  const path = join(learningDir, DEPS_FILE);
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = DepsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`${path} 不是合法的 Record<CategoryId, Graph>:${detail}`);
  }
  const entry = parsed.data[category];
  if (!entry) {
    throw new Error(`${path} 沒有分類 "${category}" 的依賴圖`);
  }
  // 回傳自己的複本,呼叫端改了不會影響到 parse 結果(跟 review.ts 一樣當作 immutable 資料)。
  return {
    nodes: [...entry.nodes],
    edges: entry.edges.map(([from, to]) => [from, to] as [CardId, CardId]),
  };
}

// ---------------------------------------------------------------- 邊驗證

/** 驗證每條邊的兩端都存在於 graph.nodes;不存在時錯誤要點名缺的那張卡。 */
export function validateGraphEdges(graph: Graph): ValidationResult {
  const known = new Set<CardId>(graph.nodes);
  const errors: string[] = [];
  graph.edges.forEach(([from, to], index) => {
    const label = `edges[${index}] [${from} -> ${to}]`;
    if (!known.has(from)) errors.push(`${label}: 先備卡 ${from} 不在 nodes 裡`);
    if (!known.has(to)) errors.push(`${label}: 後學卡 ${to} 不在 nodes 裡`);
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- 循環偵測

/**
 * 鄰接表:from → [to, ...]。邊裡出現但不在 nodes 的卡也會被收進去,
 * 這樣「邊驗證沒先跑」的情況下循環偵測仍然完整,不會因為漏節點而漏掉循環。
 */
function buildAdjacency(graph: Graph): { order: CardId[]; next: Map<CardId, CardId[]> } {
  const next = new Map<CardId, CardId[]>();
  const order: CardId[] = [];
  const seen = new Set<CardId>();
  const register = (id: CardId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    next.set(id, []);
  };
  for (const id of graph.nodes) register(id);
  for (const [from, to] of graph.edges) {
    register(from);
    register(to);
    next.get(from)!.push(to);
  }
  return { order, next };
}

/** 偵測循環並回報成一條路徑(頭尾同一張卡)。自環(a→a)也算循環。 */
export function detectCycle(graph: Graph): CycleResult {
  const { order, next } = buildAdjacency(graph);
  // 三色 DFS:white 沒碰過、gray 在目前的遞迴堆疊上、black 完成。
  // 碰到 gray 的鄰居就是回邊(back edge),堆疊從那張卡到目前這張卡就是循環。
  const state = new Map<CardId, 'gray' | 'black'>();
  const stack: CardId[] = [];

  const visit = (id: CardId): CardId[] | null => {
    state.set(id, 'gray');
    stack.push(id);
    for (const neighbor of next.get(id) ?? []) {
      const color = state.get(neighbor);
      if (color === 'gray') {
        const start = stack.indexOf(neighbor);
        return [...stack.slice(start), neighbor];
      }
      if (color === undefined) {
        const found = visit(neighbor);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 'black');
    return null;
  };

  for (const id of order) {
    if (state.has(id)) continue;
    const path = visit(id);
    if (path) return { hasCycle: true, path };
  }
  return { hasCycle: false, path: [] };
}

// ---------------------------------------------------------------- 拓樸排序

/**
 * 拓樸排序:先備排前面;沒有順序關係的兩張卡用 graph.nodes 的原始順序當 tie-break。
 *
 * Kahn 演算法,但每一輪從「所有入度為 0 的卡」裡挑 nodes index 最小的那張,
 * 而不是先進先出——這樣才是「明確依照 nodes 原始順序」,不是某種剛好穩定的排序。
 * 有循環(含自環)時排不出全序,丟錯並附上循環路徑;不回傳部分結果。
 */
export function topologicalSort(graph: Graph): CardId[] {
  const edgeCheck = validateGraphEdges(graph);
  if (!edgeCheck.ok) {
    throw new Error(`無法排序:邊的端點不在 nodes 裡\n${edgeCheck.errors.join('\n')}`);
  }
  const cycle = detectCycle(graph);
  if (cycle.hasCycle) {
    throw new Error(`無法排序:依賴圖有循環 ${cycle.path.join(' -> ')}`);
  }

  const index = new Map<CardId, number>();
  graph.nodes.forEach((id, i) => {
    if (!index.has(id)) index.set(id, i);
  });
  const unique: CardId[] = [...index.keys()];

  const inDegree = new Map<CardId, number>(unique.map((id) => [id, 0]));
  const next = new Map<CardId, CardId[]>(unique.map((id) => [id, []]));
  for (const [from, to] of graph.edges) {
    next.get(from)!.push(to);
    inDegree.set(to, inDegree.get(to)! + 1);
  }

  const ready = new Set<CardId>(unique.filter((id) => inDegree.get(id) === 0));
  const result: CardId[] = [];
  while (ready.size > 0) {
    let pick: CardId | undefined;
    for (const id of ready) {
      if (pick === undefined || index.get(id)! < index.get(pick)!) pick = id;
    }
    ready.delete(pick!);
    result.push(pick!);
    for (const to of next.get(pick!)!) {
      const remaining = inDegree.get(to)! - 1;
      inDegree.set(to, remaining);
      if (remaining === 0) ready.add(to);
    }
  }

  if (result.length !== unique.length) {
    // detectCycle 已經先擋過了,理論上到不了;留著當最後一道防線。
    throw new Error(`無法排序:有 ${unique.length - result.length} 張卡排不進順序(依賴圖有循環)`);
  }
  return result;
}

// ---------------------------------------------------------------- 寫入 order 檔

/** 把某分類的拓樸序寫進 graph/order-<category>.json(重用 atomic-write.ts),只動這個分類的檔案。 */
export function writeCategoryOrder(learningDir: string, category: CategoryId, order: CardId[]): void {
  const path = orderFilePath(learningDir, category);
  mkdirSync(join(learningDir, 'graph'), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(order, null, 2)}\n`);
}

/** readCategoryGraph + topologicalSort + writeCategoryOrder 的組合捷徑,回傳寫入的順序。 */
export function computeAndSaveCategoryOrder(learningDir: string, category: CategoryId): CardId[] {
  const graph = readCategoryGraph(learningDir, category);
  const order = topologicalSort(graph);
  writeCategoryOrder(learningDir, category, order);
  return order;
}

// ---------------------------------------------------------------- prereqs 一致性

/** 卡片自己 frontmatter 的 prereqs 欄位要跟圖裡以它為後學的邊一致;不一致要點名是哪張卡。 */
export function checkPrereqConsistency(cards: CardPrereqs[], graph: Graph): ValidationResult {
  // 圖裡「以某張卡為後學」的所有先備,依後學卡分組。比的是集合,順序無關。
  const prereqsInGraph = new Map<CardId, Set<CardId>>();
  for (const [from, to] of graph.edges) {
    let set = prereqsInGraph.get(to);
    if (!set) {
      set = new Set<CardId>();
      prereqsInGraph.set(to, set);
    }
    set.add(from);
  }

  const errors: string[] = [];
  for (const card of cards) {
    const fromGraph = prereqsInGraph.get(card.id) ?? new Set<CardId>();
    const fromFrontmatter = new Set<CardId>(card.prereqs);
    const onlyInFrontmatter = [...fromFrontmatter].filter((id) => !fromGraph.has(id));
    const onlyInGraph = [...fromGraph].filter((id) => !fromFrontmatter.has(id));
    if (onlyInFrontmatter.length === 0 && onlyInGraph.length === 0) continue;

    const parts: string[] = [];
    if (onlyInFrontmatter.length > 0) parts.push(`frontmatter 有但圖裡沒有:${onlyInFrontmatter.join(', ')}`);
    if (onlyInGraph.length > 0) parts.push(`圖裡有但 frontmatter 沒有:${onlyInGraph.join(', ')}`);
    errors.push(`${card.id}: prereqs 與依賴圖不一致(${parts.join(';')})`);
  }
  return { ok: errors.length === 0, errors };
}
