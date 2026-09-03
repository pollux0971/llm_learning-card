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
  it('fails and names the missing card when the target end does not exist', () => {
    const g = graph(SECURITY_NODES, [['sec-0001', 'sec-9999']]);

    const result = validateGraphEdges(g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-9999'))).toBe(true);
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
  it('throws when the graph contains a cycle', () => {
    const g = graph(SECURITY_NODES, [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ]);

    expect(() => topologicalSort(g)).toThrow();
  });

  it('throws when the graph contains a self edge', () => {
    expect(() => topologicalSort(graph(['sec-0001'], [['sec-0001', 'sec-0001']]))).toThrow();
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
  it('reports the disagreement for the card whose prereqs field does not match the graph', () => {
    const g = graph(SECURITY_NODES, [['sec-0002', 'sec-0003']]);
    const cards = [{ id: 'sec-0003' as CardId, prereqs: ['sec-0001'] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-0003'))).toBe(true);
  });

  // 邊界:圖裡有邊但 frontmatter 完全沒列 prereqs,也算不一致
  it('reports a mismatch when the graph has an edge the frontmatter omits entirely', () => {
    const g = graph(SECURITY_NODES, [['sec-0002', 'sec-0003']]);
    const cards = [{ id: 'sec-0003' as CardId, prereqs: [] as CardId[] }];

    const result = checkPrereqConsistency(cards, g);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sec-0003'))).toBe(true);
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
});
