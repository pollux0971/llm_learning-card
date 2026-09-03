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
  // Stryker disable next-line all: 初始值塞進假的第一格不影響行為。stack 只被 push/pop/
  // indexOf/slice 操作,indexOf 找的永遠是真實 CardId(來自 next 的鄰接表,不會是這個假字
  // 串),假格子不會被 indexOf 命中,也不會被當成 map key 查 next/state,所以永遠是無害的
  // 惰性資料,對 hasCycle/path 的計算結果沒有任何影響。
  const stack: CardId[] = [];

  const visit = (id: CardId): CardId[] | null => {
    state.set(id, 'gray');
    stack.push(id);
    // next.get(id) 一定有值:id 只會來自 order(buildAdjacency 的 register 一定先設過
    // next.set(id, []))或別的節點的鄰接表(同樣一定先 register 過),沒有第三種來源。
    for (const neighbor of next.get(id)!) {
      const color = state.get(neighbor);
      if (color === 'gray') {
        const start = stack.indexOf(neighbor);
        return [...stack.slice(start), neighbor];
      }
      // Stryker disable next-line all: 這裡改成 if(true)(對已經 black 的鄰居也重新
      // visit 一次)不會改變 hasCycle/path。任何「黑色」節點在變黑的當下,代表它當時
      // 整條可達的子樹都已經走完且沒找到回邊——這個結論不會隨時間改變,因為圖的結構是
      // 靜態的。之後若有其他還在堆疊上(gray)的祖先才連到它,重新 visit 只是把同一批
      // 早就走過的邊再走一次:如果這棵子樹真的連得回某個目前是 gray 的祖先,那條回邊
      // 在它「第一次」被走訪時就一定會被發現並讓整個演算法立刻回傳(found 會一路
      // bubble 到最外層),根本走不到這個重複造訪的分支;反過來說,走得到這裡代表當時
      // 沒找到回邊,子樹確定無環,重新走一遍結論不會變。
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
    // Stryker disable next-line all: 改成 if(false)(對已經走過的節點也重新呼叫
    // visit)不影響結果。走到這一輪代表前面所有 visit() 呼叫都已經正常退回(stack
    // 清空、沒有任何節點是 gray),所以這裡重新 visit 一個已經是 black 的 id,等於
    // 在一個完全乾淨、沒有任何祖先在場的狀態下,把它那棵早就走過、確定無環的子樹
    // 再走一次——不可能生出新的回邊,回傳值必定還是 null,跟直接 continue 略過的
    // 效果一致。
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
  // Stryker disable next-line all: 初始鄰接表塞一個假格子不影響排序結果。假格子只會在
  // 下面的迴圈被當成某張卡的「後學」處理:inDegree 沒有這個假 id 的項目,`+1`/`-1` 都
  // 只會產生 NaN,`=== 0` 對 NaN 永遠是 false,所以它永遠不會被排進 ready、不會進
  // result,對 unique.length 張真卡的排序結果沒有任何影響。
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
      // Stryker disable next-line all: `<` 改成 `<=` 不影響挑到的結果。index 是
      // graph.nodes 每張「不同」卡片第一次出現位置的對應表(上面 209-212 行用
      // !index.has(id) 保證一個 id 只設一次),所以不同 id 的 index 值必定不同,
      // ready 又是 Set(內容不重複),同一輪迴圈裡拿來比較的 id 跟 pick 永遠是兩張
      // 不同的卡——`index.get(id)! === index.get(pick)!` 這個 `<=` 多出來的相等分支,
      // 對「不同 id」來說永遠不可能成立,所以 `<` 跟 `<=` 選出來的 pick 一定一樣。
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

  // 這裡不留「排不出全序」的防線:上面已經跑過 validateGraphEdges(邊的兩端都在
  // nodes 裡,所以 edges 只會連到 unique 裡的卡)跟 detectCycle(整張圖沒有循環)。
  // 兩者都成立時,以 unique 為節點集合、edges 為邊集合的子圖必為 DAG,Kahn 演算法
  // 數學上保證能排出全部 unique.length 張卡——排不出全序等價於「有循環但 detectCycle
  // 沒抓到」,那是 detectCycle 本身的 bug,不是這裡該防的東西,所以刪掉這條摸不到的分支。
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
