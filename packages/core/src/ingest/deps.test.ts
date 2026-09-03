import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardId } from '@contracts/index.js';
import type { LlmResult, LlmRouter } from '@core/llm/index.js';
import type { Graph } from '@core/schema/graph.js';
import { readLogEvents } from './state.js';
import { analyzeDependencies, writeCategoryGraph } from './deps.js';

// ---------------------------------------------------------------- 共用 fixture

function makeCard(id: CardId, overrides: Partial<Card['frontmatter']> = {}): Card {
  return {
    frontmatter: {
      id,
      category: 'security',
      title: `卡 ${id}`,
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
    body: '測試用內容,足夠模型判斷先備關係。',
    examples: [],
  };
}

/** 依呼叫次數回應 'ingest.deps' 的假 router;script[i] 是第 i 次呼叫(0-based)的 edges。 */
function makeDepsRouter(script: [CardId, CardId][][]): { router: LlmRouter; calls: string[] } {
  const calls: string[] = [];
  const router: LlmRouter = {
    async call(task, prompt): Promise<LlmResult> {
      if (task !== 'ingest.deps') throw new Error(`未預期的 task: ${task}`);
      const index = calls.length;
      calls.push(prompt);
      const edges = script[index];
      if (!edges) throw new Error(`script 沒有第 ${index} 次呼叫的回應`);
      return { text: JSON.stringify({ edges }), provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls };
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeOutDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'lc-deps-'));
  mkdirSync(join(dir, 'graph'), { recursive: true });
  return dir;
}

function logEventsOf(outDir: string): Record<string, unknown>[] {
  return readLogEvents(join(outDir, 'state/log.jsonl'));
}

// ============================================================== analyzeDependencies

describe('analyzeDependencies', () => {
  // Scenario: Prerequisites are inferred for the category
  it('produces a graph containing every card, with parent edges guaranteed for level one cards', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [
      makeCard('sec-0001'),
      makeCard('sec-0002'),
      makeCard('sec-0003'),
      makeCard('sec-0004'),
      makeCard('sec-0005', { level: 1, source: 'llm', parent: 'sec-0001' }),
    ];
    const { router } = makeDepsRouter([
      [
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0004'],
      ],
    ]);

    const result = await analyzeDependencies('security', cards, router, outDir);

    expect(new Set(result.graph.nodes)).toEqual(new Set(cards.map((c) => c.frontmatter.id)));
    expect(result.graph.edges).toEqual(
      expect.arrayContaining([
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0004'],
        ['sec-0001', 'sec-0005'],
      ]),
    );
  });

  it('reports every card whose stored prereqs disagree with the final graph as updated', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002', { prereqs: [] })];
    const { router } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    const result = await analyzeDependencies('security', cards, router, outDir);

    // sec-0002 的 frontmatter 原本 prereqs: [],跟圖裡的 [sec-0001] 不一致,必須列進 cardsUpdated
    expect(result.cardsUpdated).toContain('sec-0002');
  });

  // Scenario: The order file is produced
  it('writes an order file for the category that is consistent with the graph', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];
    const { router } = makeDepsRouter([
      [
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
      ],
    ]);

    const result = await analyzeDependencies('security', cards, router, outDir);

    const orderPath = join(outDir, 'graph', 'order-security.json');
    expect(existsSync(orderPath)).toBe(true);
    const order = JSON.parse(readFileSync(orderPath, 'utf8')) as CardId[];
    expect(order).toEqual(result.order);
    expect(new Set(order)).toEqual(new Set(['sec-0001', 'sec-0002', 'sec-0003']));
    for (const [from, to] of result.graph.edges) {
      expect(order.indexOf(from)).toBeLessThan(order.indexOf(to));
    }
  });

  // Scenario: Only the affected category is re-sorted
  it('does not touch another category order file or its deps.json entry', async () => {
    const outDir = makeOutDir();
    const languageGraph: Graph = { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] };
    writeFileSync(join(outDir, 'graph', 'deps.json'), JSON.stringify({ language: languageGraph }, null, 2));
    const languageOrderPath = join(outDir, 'graph', 'order-language.json');
    writeFileSync(languageOrderPath, JSON.stringify(['lan-0001', 'lan-0002'], null, 2) + '\n');
    const languageOrderBefore = readFileSync(languageOrderPath, 'utf8');

    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002')];
    const { router } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    await analyzeDependencies('security', cards, router, outDir);

    expect(readFileSync(languageOrderPath, 'utf8')).toBe(languageOrderBefore);
    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps.language).toEqual(languageGraph);
    expect(deps.security).toBeDefined();
  });

  // Scenario: A cycle returned by the model is challenged once
  describe('when the model returns a cycle', () => {
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];
    const cyclicEdges: [CardId, CardId][] = [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
    ];

    it('calls the model a second time with the cycle described', async () => {
      const outDir = makeOutDir();
      const { router, calls } = makeDepsRouter([cyclicEdges, [['sec-0001', 'sec-0002'], ['sec-0002', 'sec-0003']]]);

      await analyzeDependencies('security', cards, router, outDir);

      expect(calls).toHaveLength(2);
    });

    it('does not call the model a second time when the first response has no cycle', async () => {
      const outDir = makeOutDir();
      const { router, calls } = makeDepsRouter([[['sec-0001', 'sec-0002'], ['sec-0002', 'sec-0003']]]);

      await analyzeDependencies('security', cards, router, outDir);

      expect(calls).toHaveLength(1);
    });

    it('drops the offending edge and logs cycle_removed when the second attempt still cycles', async () => {
      const outDir = makeOutDir();
      const { router } = makeDepsRouter([cyclicEdges, cyclicEdges]);

      const result = await analyzeDependencies('security', cards, router, outDir);

      expect(result.cycleRemoved).not.toBeNull();
      expect(result.graph.edges).not.toContainEqual(result.cycleRemoved);
      const events = logEventsOf(outDir);
      expect(events.some((e) => e.type === 'cycle_removed')).toBe(true);
    });

    it('produces a graph with no cycle after dropping the offending edge', async () => {
      const outDir = makeOutDir();
      const { router } = makeDepsRouter([cyclicEdges, cyclicEdges]);

      const result = await analyzeDependencies('security', cards, router, outDir);

      // 拓樸排序得出全序代表最終圖已經無環——沒有排出來就會丟錯,這裡不用另外呼叫
      // detectCycle 重新驗一次(那是 topologicalSort/computeAndSaveCategoryOrder 內部的事)。
      expect(result.order).toHaveLength(3);
    });

    it('reports no removed edge and does not log cycle_removed when the second attempt resolves the cycle', async () => {
      const outDir = makeOutDir();
      const { router } = makeDepsRouter([cyclicEdges, [['sec-0001', 'sec-0002'], ['sec-0002', 'sec-0003']]]);

      const result = await analyzeDependencies('security', cards, router, outDir);

      expect(result.cycleRemoved).toBeNull();
      const events = logEventsOf(outDir);
      expect(events.some((e) => e.type === 'cycle_removed')).toBe(false);
    });
  });
});

// ============================================================== writeCategoryGraph

describe('writeCategoryGraph', () => {
  it('creates graph/deps.json with only the given category when none exists yet', () => {
    const outDir = makeOutDir();
    const graph: Graph = { nodes: ['sec-0001'], edges: [] };

    writeCategoryGraph(outDir, 'security', graph);

    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps).toEqual({ security: graph });
  });

  it('replaces only the target category, leaving other categories untouched', () => {
    const outDir = makeOutDir();
    const languageGraph: Graph = { nodes: ['lan-0001'], edges: [] };
    writeFileSync(join(outDir, 'graph', 'deps.json'), JSON.stringify({ language: languageGraph }, null, 2));
    const securityGraph: Graph = { nodes: ['sec-0001', 'sec-0002'], edges: [['sec-0001', 'sec-0002']] };

    writeCategoryGraph(outDir, 'security', securityGraph);

    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps).toEqual({ language: languageGraph, security: securityGraph });
  });
});
