import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CardId, CategoryId } from '@contracts/index.js';
import {
  checkPrereqConsistency,
  computeAndSaveCategoryOrder,
  detectCycle,
  readCategoryGraph,
  topologicalSort,
  validateGraphEdges,
  writeCategoryOrder,
  type Graph,
} from './graph.js';

// ---------------------------------------------------------------- 共用 fixture

/** phase-3.feature Background:「the category security contains the cards sec-0001 through sec-0004」 */
const SECURITY_NODES: CardId[] = ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0004'];

function graph(nodes: CardId[], edges: [CardId, CardId][]): Graph {
  return { nodes, edges };
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeLearningDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'lc-graph-'));
  mkdirSync(join(dir, 'graph'), { recursive: true });
  return dir;
}

function writeDepsFile(learningDir: string, deps: Record<CategoryId, Graph>): void {
  writeFileSync(join(learningDir, 'graph/deps.json'), JSON.stringify(deps, null, 2));
}

// ============================================================== readCategoryGraph

describe('readCategoryGraph', () => {
  // Scenario: The graph is grouped by category
  it('returns only the nodes and edges for the requested category', () => {
    const learningDir = makeLearningDir();
    writeDepsFile(learningDir, {
      security: graph(SECURITY_NODES, [['sec-0001', 'sec-0002']]),
      language: graph(['lan-0001', 'lan-0002'], [['lan-0001', 'lan-0002']]),
    });

    const result = readCategoryGraph(learningDir, 'security');

    expect(result).toEqual(graph(SECURITY_NODES, [['sec-0001', 'sec-0002']]));
  });

  it('does not leak edges belonging to another category', () => {
    const learningDir = makeLearningDir();
    writeDepsFile(learningDir, {
      security: graph(SECURITY_NODES, []),
      language: graph(['lan-0001', 'lan-0002'], [['lan-0001', 'lan-0002']]),
    });

    const result = readCategoryGraph(learningDir, 'security');

    expect(result.edges).toEqual([]);
  });

  // 邊界:分類存在但沒有邊(給拓樸排序的「the category has no edges」場景鋪墊)
  it('returns an empty edges array for a category with no edges', () => {
    const learningDir = makeLearningDir();
    writeDepsFile(learningDir, { security: graph(SECURITY_NODES, []) });

    const result = readCategoryGraph(learningDir, 'security');

    expect(result.nodes).toEqual(SECURITY_NODES);
    expect(result.edges).toEqual([]);
  });

  // 邊界:deps.json 不合法(node id 不符合 CardId 格式),要丟錯而不是把壞資料傳出去,
  // 而且錯誤訊息要點出是哪個欄位壞掉,不能只是個空白訊息。
  it('throws when deps.json fails schema validation, naming the bad field', () => {
    const learningDir = makeLearningDir();
    writeFileSync(
      join(learningDir, 'graph/deps.json'),
      JSON.stringify({ security: { nodes: ['not-a-valid-card-id'], edges: [] } }),
    );

    expect(() => readCategoryGraph(learningDir, 'security')).toThrow(/security\.nodes\.0/);
  });

  // 邊界:deps.json 同時有兩個獨立的格式錯誤時,兩個 issue 都要列出來,用「; 」分開,
  // 不能只回報第一個或把兩段黏在一起看不出是兩件事。
  it('lists every schema validation issue when deps.json has more than one', () => {
    const learningDir = makeLearningDir();
    writeFileSync(
      join(learningDir, 'graph/deps.json'),
      JSON.stringify({ security: { nodes: ['not-a-valid-card-id'], edges: [['also-bad', 'sec-0001']] } }),
    );

    expect(() => readCategoryGraph(learningDir, 'security')).toThrow(/nodes\.0.*; .*edges\.0/s);
  });

  // 設計決策:deps.json 由 ingest 產生,一個分類沒有 entry 代表呼叫端要求了尚未 ingest
  // 的東西——跟本檔案其他函式(orderFilePath 擋非法分類、上面的格式驗證)一律 fail-fast
  // 的慣例一致,所以選擇丟錯並點名分類,而不是靜默回傳空圖蓋掉這個訊號。
  it('throws and names the category when deps.json has no entry for it', () => {
    const learningDir = makeLearningDir();
    writeDepsFile(learningDir, { language: graph(['lan-0001'], []) });

    expect(() => readCategoryGraph(learningDir, 'security')).toThrow(/security/);
  });
});

// ============================================================== validateGraphEdges

describe('validateGraphEdges', () => {
  it('passes when every edge endpoint exists in nodes', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
    ]);

    const result = validateGraphEdges(g);

    expect(result).toEqual({ ok: true, errors: [] });
  });

  // 邊界:完全沒有邊也算通過
  it('passes an empty graph', () => {
    const result = validateGraphEdges(graph([], []));
    expect(result.ok).toBe(true);
  });

  // Scenario: Both ends of an edge must exist
  // 錯誤訊息也要點名是第幾條邊(edges[N]),不是只講缺了哪張卡,方便對照 deps.json。
  it('fails and names the missing card when the target end does not exist', () => {
    const g = graph(SECURITY_NODES, [['sec-0001', 'sec-9999']]);

    const result = validateGraphEdges(g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-9999'))).toBe(true);
    expect(result.errors.some((e) => e.includes('edges[0]'))).toBe(true);
  });

  it('fails and names the missing card when the source end does not exist', () => {
    const g = graph(SECURITY_NODES, [['sec-8888', 'sec-0001']]);

    const result = validateGraphEdges(g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-8888'))).toBe(true);
  });

  // 邊界:兩端都缺,兩個都要點名,不能只回報第一個就短路
  it('reports every missing card across multiple bad edges, not just the first', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-7777'],
      ['sec-6666', 'sec-0002'],
    ]);

    const result = validateGraphEdges(g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-7777'))).toBe(true);
    expect(result.errors.some((e) => e.includes('sec-6666'))).toBe(true);
  });

  // 邊界:自環兩端都存在,不算「端點缺失」
  it('a self edge whose card exists is not an endpoint failure', () => {
    const g = graph(SECURITY_NODES, [['sec-0001', 'sec-0001']]);

    const result = validateGraphEdges(g);

    expect(result.ok).toBe(true);
  });
});

// ============================================================== detectCycle

describe('detectCycle', () => {
  // 邊界:沒有邊,絕對沒有循環
  it('reports no cycle for a graph with no edges', () => {
    const result = detectCycle(graph(SECURITY_NODES, []));
    expect(result).toEqual({ hasCycle: false, path: [] });
  });

  it('reports no cycle for a simple chain', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
    ]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(false);
    expect(result.path).toEqual([]);
  });

  // Scenario: Cycles are detected and reported as a path
  it('reports a three-card cycle as a path through all three cards', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
    ]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(true);
    expect(result.path.length).toBeGreaterThanOrEqual(4);
    expect(result.path[0]).toEqual(result.path[result.path.length - 1]);
    const middle = new Set(result.path.slice(0, -1));
    expect(middle).toEqual(new Set(['sec-0001', 'sec-0002', 'sec-0003']));
  });

  // Scenario: A self edge is a cycle
  it('reports a self edge as a cycle', () => {
    const g = graph(SECURITY_NODES, [['sec-0001', 'sec-0001']]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(true);
    expect(result.path[0]).toEqual('sec-0001');
    expect(result.path[result.path.length - 1]).toEqual('sec-0001');
  });

  // 邊界:多層循環(不是所有節點都在循環裡),只回報真正在循環上的那幾張
  it('reports only the cards that are actually on the cycle in a larger graph', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0004', 'sec-0001'],
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(true);
    const middle = new Set(result.path.slice(0, -1));
    expect(middle.has('sec-0004')).toBe(false);
    expect(middle).toEqual(new Set(['sec-0001', 'sec-0002']));
  });

  // 邊界:兩個節點互相指向,最短的非自環循環
  it('detects a two-card mutual cycle', () => {
    const g = graph(['sec-0001', 'sec-0002'], [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(true);
  });

  // 邊界:buildAdjacency 的文件註解說「邊裡出現但不在 nodes 的卡也會被收進去」——
  // 確認這條路徑真的有效,不是只是註解說說而已。
  it('detects a cycle formed through cards that only appear in edges, not in nodes', () => {
    // nodes 是空的:兩張卡都只能靠 register(from)/register(to) 這條路徑被收進鄰接表。
    const g = graph([], [
      ['ghost-0001', 'ghost-0002'],
      ['ghost-0002', 'ghost-0001'],
    ]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(true);
  });

  // 邊界:DFS 堆疊上,循環開始「之前」造訪過的祖先卡不能混進回報的路徑裡
  it('excludes ancestors visited before the cycle starts from the reported path', () => {
    const g = graph(['sec-0004', 'sec-0001', 'sec-0002', 'sec-0003'], [
      ['sec-0004', 'sec-0001'],
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ]);

    const result = detectCycle(g);

    expect(result.hasCycle).toBe(true);
    const middle = new Set(result.path.slice(0, -1));
    expect(middle.has('sec-0004')).toBe(false);
    expect(middle).toEqual(new Set(['sec-0001', 'sec-0002']));
  });
});

// ============================================================== topologicalSort

describe('topologicalSort', () => {
  // Scenario: Topological order puts prerequisites first
  it('puts prerequisites before the cards that depend on them', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0003'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0004'],
    ]);

    const order = topologicalSort(g);

    expect(order.indexOf('sec-0001')).toBeLessThan(order.indexOf('sec-0003'));
    expect(order.indexOf('sec-0002')).toBeLessThan(order.indexOf('sec-0003'));
    expect(order.indexOf('sec-0003')).toBeLessThan(order.indexOf('sec-0004'));
    expect(new Set(order)).toEqual(new Set(SECURITY_NODES));
  });

  // Scenario: Cards with no ordering between them fall back to source order
  it('uses the nodes array order as a tie-break when two cards have no edge between them', () => {
    const g = graph(['sec-0002', 'sec-0001'], []);

    const order = topologicalSort(g);

    expect(order).toEqual(['sec-0002', 'sec-0001']);
  });

  it('keeps source order as the tie-break even when other cards do have edges', () => {
    // sec-0001/sec-0002 互不相關,但都是 sec-0003 的先備;
    // nodes 陣列裡 sec-0002 排在 sec-0001 前面,兩者之間應該保留這個順序。
    const g = graph(['sec-0002', 'sec-0001', 'sec-0003'], [
      ['sec-0001', 'sec-0003'],
      ['sec-0002', 'sec-0003'],
    ]);

    const order = topologicalSort(g);

    expect(order.indexOf('sec-0002')).toBeLessThan(order.indexOf('sec-0001'));
  });

  // Scenario: With no edges the order is the source order
  it('matches the source order exactly when there are no edges', () => {
    const order = topologicalSort(graph(SECURITY_NODES, []));
    expect(order).toEqual(SECURITY_NODES);
  });

  // 邊界:單一節點沒有邊
  it('returns the single node for a graph with one node and no edges', () => {
    const order = topologicalSort(graph(['sec-0001'], []));
    expect(order).toEqual(['sec-0001']);
  });

  // 邊界:空圖
  it('returns an empty array for an empty graph', () => {
    const order = topologicalSort(graph([], []));
    expect(order).toEqual([]);
  });

  // 邊界:圖有循環時排不出全序,必須丟錯而不是回傳部分結果
  // 訊息要包含實際循環路徑,不能只是「有循環」這種空泛話——跟排不出全序時的
  // 最後一道防線訊息(不含實際卡片)區分開來。
  it('throws when the graph contains a cycle, naming the cycle path', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ]);

    expect(() => topologicalSort(g)).toThrow(/sec-0001 -> sec-0002 -> sec-0001/);
  });

  it('throws when the graph contains a self edge', () => {
    expect(() => topologicalSort(graph(['sec-0001'], [['sec-0001', 'sec-0001']]))).toThrow();
  });

  // Scenario: Both ends of an edge must exist —topologicalSort 自己也要擋這個,
  // 不能只靠呼叫端先跑 validateGraphEdges。兩條壞邊都要點名,而且要分行列出。
  it('throws and names every missing card when edges reference cards not in nodes', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-9999'],
      ['sec-8888', 'sec-0002'],
    ]);
    expect(() => topologicalSort(g)).toThrow(/sec-9999[\s\S]*\n[\s\S]*sec-8888/);
  });

  // 邊界:被依賴的卡在 nodes 陣列裡的 index 比它的兩張先備卡都低,拓樸排序仍要照
  // 依賴走,不能提早出爐——這條測試專門擋「入度歸零檢查形同虛設,其實只是照 index
  // 順序輸出剛好對」這種巧合通過。
  it('does not emit a card before both its prerequisites are processed, even when its own index is lower', () => {
    const g = graph(['sec-0003', 'sec-0001', 'sec-0002', 'sec-0004'], [
      ['sec-0001', 'sec-0003'],
      ['sec-0002', 'sec-0003'],
    ]);

    const order = topologicalSort(g);

    expect(order.indexOf('sec-0001')).toBeLessThan(order.indexOf('sec-0003'));
    expect(order.indexOf('sec-0002')).toBeLessThan(order.indexOf('sec-0003'));
  });

  // 邊界:一張卡因為依賴解除而「晚點」才變成可選,即使它的 index 比早就可選的另一張
  // 卡低,還是要在變成可選後被馬上選中——不能因為它是晚被加進候選集合的,就被排到後面。
  it('picks the lowest-index ready card even when it becomes ready later than another candidate', () => {
    const g = graph(['sec-0001', 'sec-0002', 'sec-0003'], [['sec-0002', 'sec-0001']]);

    const order = topologicalSort(g);

    expect(order).toEqual(['sec-0002', 'sec-0001', 'sec-0003']);
  });

  // 邊界:nodes 陣列裡同一張卡重複出現時,index 要保留「第一次出現」的位置,
  // 不能被後面的重複項覆蓋掉——否則同一張卡在不同次排序會得到不一致的 tie-break。
  it('keeps the first occurrence as the tie-break index when a card appears twice in nodes', () => {
    const g = graph(['sec-0002', 'sec-0001', 'sec-0002'], []);

    const order = topologicalSort(g);

    expect(order.indexOf('sec-0002')).toBeLessThan(order.indexOf('sec-0001'));
  });
});

// ============================================================== writeCategoryOrder / computeAndSaveCategoryOrder

describe('writeCategoryOrder', () => {
  // Scenario: The order is written per category
  it('writes an ordered array of card ids under the graph directory, each card exactly once', () => {
    const learningDir = makeLearningDir();

    writeCategoryOrder(learningDir, 'security', SECURITY_NODES);

    const written = JSON.parse(readFileSync(join(learningDir, 'graph/order-security.json'), 'utf8'));
    expect(written).toEqual(SECURITY_NODES);
    expect(new Set(written)).toEqual(new Set(SECURITY_NODES));
    expect(written.length).toBe(SECURITY_NODES.length);
  });

  // Scenario: Sorting one category leaves others alone
  it('does not touch another category order file', () => {
    const learningDir = makeLearningDir();
    const languageOrderPath = join(learningDir, 'graph/order-language.json');
    const languageContent = JSON.stringify(['lan-0002', 'lan-0001']);
    writeFileSync(languageOrderPath, languageContent);

    writeCategoryOrder(learningDir, 'security', SECURITY_NODES);

    expect(readFileSync(languageOrderPath, 'utf8')).toEqual(languageContent);
  });

  it('overwrites only the order file for the given category on a second write', () => {
    const learningDir = makeLearningDir();
    writeCategoryOrder(learningDir, 'security', SECURITY_NODES);
    const reversed = [...SECURITY_NODES].reverse();

    writeCategoryOrder(learningDir, 'security', reversed);

    const written = JSON.parse(readFileSync(join(learningDir, 'graph/order-security.json'), 'utf8'));
    expect(written).toEqual(reversed);
  });

  // 邊界:graph/ 目錄本身還不存在時(第一次寫入),writeCategoryOrder 要自己建出來。
  it('creates the graph directory itself when it does not already exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'lc-graph-nodir-'));

    writeCategoryOrder(dir, 'security', SECURITY_NODES);

    const written = JSON.parse(readFileSync(join(dir, 'graph/order-security.json'), 'utf8'));
    expect(written).toEqual(SECURITY_NODES);
  });

  // 邊界:orderFilePath 先過 CategoryIdSchema 擋路徑穿越,這道防線本身要有測試守著,
  // 錯誤訊息也要點名是哪個分類 id 被擋下來。
  it('rejects a category id that contains a path separator', () => {
    const learningDir = makeLearningDir();
    expect(() => writeCategoryOrder(learningDir, '../escape' as CategoryId, [])).toThrow(/escape/);
  });

  // 邊界:空字串同時違反 min(1) 跟 regex 兩條規則,zod 會回報兩個 issue——確認訊息把
  // 兩條都列出來、用「; 」隔開,不是只挑第一個講。
  it('lists every validation issue for an empty category id, separated by a semicolon', () => {
    const learningDir = makeLearningDir();
    expect(() => writeCategoryOrder(learningDir, '' as CategoryId, [])).toThrow(/不可為空.*; .*不可包含空白/);
  });
});

describe('computeAndSaveCategoryOrder', () => {
  it('reads the graph, computes the order and writes it, returning the same order', () => {
    const learningDir = makeLearningDir();
    writeDepsFile(learningDir, {
      security: graph(SECURITY_NODES, [
        ['sec-0001', 'sec-0003'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0004'],
      ]),
    });

    const order = computeAndSaveCategoryOrder(learningDir, 'security');

    const written = JSON.parse(readFileSync(join(learningDir, 'graph/order-security.json'), 'utf8'));
    expect(written).toEqual(order);
    expect(order.indexOf('sec-0003')).toBeLessThan(order.indexOf('sec-0004'));
  });

  it('leaves another category order file untouched when regenerating security', () => {
    const learningDir = makeLearningDir();
    writeDepsFile(learningDir, { security: graph(SECURITY_NODES, []) });
    const languageOrderPath = join(learningDir, 'graph/order-language.json');
    const languageContent = JSON.stringify(['lan-0002', 'lan-0001']);
    writeFileSync(languageOrderPath, languageContent);

    computeAndSaveCategoryOrder(learningDir, 'security');

    expect(readFileSync(languageOrderPath, 'utf8')).toEqual(languageContent);
  });
});

// ============================================================== checkPrereqConsistency

describe('checkPrereqConsistency', () => {
  it('passes when frontmatter prereqs exactly match the graph edges', () => {
    const g = graph(SECURITY_NODES, [['sec-0002', 'sec-0003']]);
    const cards = [{ id: 'sec-0003' as CardId, prereqs: ['sec-0002'] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result).toEqual({ ok: true, errors: [] });
  });

  // 邊界:prereqs 陣列順序不影響比較結果,比的是集合
  it('treats prereqs order as irrelevant when the set matches the graph', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0004'],
      ['sec-0002', 'sec-0004'],
    ]);
    const cards = [{ id: 'sec-0004' as CardId, prereqs: ['sec-0002', 'sec-0001'] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(true);
  });

  // Scenario: A card's prereqs field must agree with the graph
  // 這張卡同時「frontmatter 多列了 sec-0001」跟「圖裡多了 sec-0002」——兩段訊息都要
  // 出現在錯誤裡,不能只回報其中一邊就當作講清楚了。
  it('reports the disagreement for the card whose prereqs field does not match the graph', () => {
    const g = graph(SECURITY_NODES, [['sec-0002', 'sec-0003']]);
    const cards = [{ id: 'sec-0003' as CardId, prereqs: ['sec-0001'] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(false);
    const message = result.errors.find((e) => e.includes('sec-0003'));
    expect(message).toBeDefined();
    expect(message).toContain('sec-0001');
    expect(message).toContain('sec-0002');
  });

  // 邊界:圖裡有邊但 frontmatter 完全沒列 prereqs,也算不一致。frontmatter 這邊沒有
  // 「多出來的」東西,訊息不該出現「frontmatter 有但圖裡沒有」那段。
  it('reports a mismatch when the graph has an edge the frontmatter omits entirely', () => {
    const g = graph(SECURITY_NODES, [['sec-0002', 'sec-0003']]);
    const cards = [{ id: 'sec-0003' as CardId, prereqs: [] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(false);
    const message = result.errors.find((e) => e.includes('sec-0003'));
    expect(message).toBeDefined();
    expect(message).not.toContain('frontmatter 有但圖裡沒有');
    expect(message).toContain('圖裡有但 frontmatter 沒有:sec-0002');
  });

  // 邊界:frontmatter 列了一個圖裡完全沒有對應邊的 prereq(圖裡這張卡沒有任何先備邊)。
  // 圖那邊沒有「多出來的」東西,訊息不該出現「圖裡有但 frontmatter 沒有」那段。
  it('reports a mismatch when frontmatter lists a prereq the graph has no edge for at all', () => {
    const g = graph(SECURITY_NODES, []);
    const cards = [{ id: 'sec-0003' as CardId, prereqs: ['sec-9999'] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(false);
    const message = result.errors.find((e) => e.includes('sec-0003'));
    expect(message).toBeDefined();
    expect(message).toContain('frontmatter 有但圖裡沒有:sec-9999');
    expect(message).not.toContain('圖裡有但 frontmatter 沒有');
  });

  // 邊界:多張卡不一致時全部點名,不能只回報第一個
  it('reports every card with a disagreement, not just the first', () => {
    const g = graph(SECURITY_NODES, [['sec-0002', 'sec-0003']]);
    const cards = [
      { id: 'sec-0003' as CardId, prereqs: ['sec-0001'] as CardId[] },
      { id: 'sec-0004' as CardId, prereqs: ['sec-0999'] as CardId[] },
    ];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-0003'))).toBe(true);
    expect(result.errors.some((e) => e.includes('sec-0004'))).toBe(true);
  });

  // 邊界:沒有任何卡片或邊,通過
  it('passes an empty card list against an empty graph', () => {
    const result = checkPrereqConsistency([], graph([], []));
    expect(result).toEqual({ ok: true, errors: [] });
  });

  // 邊界:frontmatter 跟圖裡「各自多出兩個以上」的卡,訊息要用逗號分隔列出全部,
  // 兩段訊息之間要用分號隔開——只有一個元素的陣列測不出 join 分隔符有沒有用對。
  it('joins multiple extra ids with a comma and separates the two message parts with a semicolon', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0004'],
      ['sec-0002', 'sec-0004'],
    ]);
    const cards = [{ id: 'sec-0004' as CardId, prereqs: ['sec-0003', 'lan-0001'] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.errors).toEqual([
      'sec-0004: prereqs 與依賴圖不一致(frontmatter 有但圖裡沒有:sec-0003, lan-0001;圖裡有但 frontmatter 沒有:sec-0001, sec-0002)',
    ]);
  });
});
