import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardId } from '@contracts/index.js';
import type { LlmResult, LlmRouter } from '@core/llm/index.js';
import type { Graph } from '@core/schema/graph.js';
import { readLogEvents } from './state.js';
import {
  analyzeDependencies,
  computeDepsMaxTokens,
  removeCategoryGraph,
  removeCyclesLocally,
  writeCategoryGraph,
} from './deps.js';
import { detectCycle } from '@core/schema/graph.js';
import { loadPromptTemplate } from './prompts.js';

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

type CallOpts = { timeoutMs?: number; maxTokens?: number } | undefined;

/**
 * 依呼叫次數回應 'ingest.deps' 的假 router;script[i] 是第 i 次呼叫(0-based)的 edges。
 * 同時記錄每次呼叫收到的 prompt 與 opts,讓測試可以驗證 analyzeDependencies() 是否
 * 真的把動態算出的 maxTokens 傳進 router.call() 的第三個參數。
 */
function makeDepsRouter(script: [CardId, CardId][][]): { router: LlmRouter; calls: string[]; optsCalls: CallOpts[] } {
  const calls: string[] = [];
  const optsCalls: CallOpts[] = [];
  const router: LlmRouter = {
    async call(task, prompt, opts): Promise<LlmResult> {
      if (task !== 'ingest.deps') throw new Error(`未預期的 task: ${task}`);
      const index = calls.length;
      calls.push(prompt);
      optsCalls.push(opts);
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
  return { router, calls, optsCalls };
}

/** 產生 count 張互不相干的卡,用來測「卡片數量多時 maxTokens 明顯變大」。 */
function makeManyCards(count: number): Card[] {
  return Array.from({ length: count }, (_, i) => makeCard(`sec-${String(i + 1).padStart(4, '0')}` as CardId));
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

// ============================================================== computeDepsMaxTokens
//
// 公式(見 deps.ts 內的說明):Math.min(16384, Math.max(2048, cardCount * 256))。
// 下限 2048 對應 token-limits.ts 原本的固定值;上限 16384 避免卡片數量沒有上限時
// 單次呼叫的預算跟著無限長大;中間用「每卡 256 tokens」蓋過「每條邊 15–25 tokens」
// 的估計,留數倍安全邊界。

describe('computeDepsMaxTokens', () => {
  it('stays at the 2048 floor for a small category (3 cards)', () => {
    // 3 * 256 = 768,遠低於下限,結果必須被拉回 2048,不可以小於它
    expect(computeDepsMaxTokens(3)).toBe(2048);
  });

  it('stays at the 2048 floor for zero cards', () => {
    expect(computeDepsMaxTokens(0)).toBe(2048);
  });

  it('grows noticeably above the floor for a large category (30 cards)', () => {
    const result = computeDepsMaxTokens(30);
    // 30 * 256 = 7680,落在下限與上限之間,不需要再夾一次
    expect(result).toBe(7680);
    expect(result).toBeGreaterThan(2048);
  });

  it('grows further for an even larger category (50 cards) without exceeding the ceiling', () => {
    const result = computeDepsMaxTokens(50);
    // 50 * 256 = 12800,仍然小於上限
    expect(result).toBe(12800);
    expect(result).toBeLessThanOrEqual(16384);
  });

  it('caps at 16384 once the per-card estimate would exceed the ceiling', () => {
    // 1000 * 256 = 256000,遠超上限,必須被夾在 16384
    expect(computeDepsMaxTokens(1000)).toBe(16384);
  });
});

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

  it('reports a card as updated when its stored prereqs have the same length as the graph but different ids', async () => {
    const outDir = makeOutDir();
    // sec-0003 已存了跟自己數量相同(1 個)但內容錯誤的 prereqs——只比長度會漏掉這個情況
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003', { prereqs: ['sec-0002'] })];
    const { router } = makeDepsRouter([[['sec-0001', 'sec-0003']]]);

    const result = await analyzeDependencies('security', cards, router, outDir);

    expect(result.cardsUpdated).toContain('sec-0003');
    const path = join(outDir, 'cards', 'security', 'sec-0003.md');
    const parsed = matter(readFileSync(path, 'utf8'));
    expect(parsed.data.prereqs).toEqual(['sec-0001']);
  });

  // stored 跟 computed 長度相同、還「共用一個」id 的情況:同一長度加上部分重疊,
  // 才分得出「stored 的每一個都要在 computed 裡」(every)和「stored 只要有一個在 computed
  // 裡」(some)這兩種判斷——完全不重疊的情況兩者結果一樣,測不出差異。
  it('reports a card as updated when stored and computed prereqs overlap by one id but are not identical', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [
      makeCard('sec-0001'),
      makeCard('sec-0002'),
      makeCard('sec-0003', { prereqs: ['sec-0001', 'sec-0002'] }),
    ];
    // 圖裡 sec-0003 真正的先備是 sec-0001 跟一張新的 sec-0004,跟舊的 sec-0002 不同,
    // 但兩邊都有 sec-0001,長度也一樣(2 個)
    const fourthCard = makeCard('sec-0004');
    const { router } = makeDepsRouter([
      [
        ['sec-0001', 'sec-0003'],
        ['sec-0004', 'sec-0003'],
      ],
    ]);

    const result = await analyzeDependencies('security', [...cards, fourthCard], router, outDir);

    expect(result.cardsUpdated).toContain('sec-0003');
    const parsed = matter(readFileSync(join(outDir, 'cards', 'security', 'sec-0003.md'), 'utf8'));
    expect(parsed.data.prereqs).toEqual(['sec-0001', 'sec-0004']);
  });

  it('does not report a card as updated when its stored prereqs already match the graph', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002', { prereqs: ['sec-0001'] })];
    const { router } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    const result = await analyzeDependencies('security', cards, router, outDir);

    // sec-0001 沒有任何先備(圖裡沒有指向它的邊,電腦出的 prereqs 應該是空陣列)、
    // sec-0002 的既有 prereqs 已經跟圖一致——兩張卡都不該出現在 cardsUpdated
    expect(result.cardsUpdated).toEqual([]);
    // 沒被判定要更新的卡片,磁碟上不該多出一份重寫的檔案
    expect(existsSync(join(outDir, 'cards', 'security', 'sec-0001.md'))).toBe(false);
    expect(existsSync(join(outDir, 'cards', 'security', 'sec-0002.md'))).toBe(false);
  });

  it('accumulates every distinct source into a card prereqs list and drops a duplicate incoming edge', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];
    // sec-0001 和 sec-0002 都是 sec-0003 的先備;sec-0001->sec-0003 額外重複一次(去重不能只留最後一個 from)
    const { router } = makeDepsRouter([
      [
        ['sec-0001', 'sec-0003'],
        ['sec-0002', 'sec-0003'],
        ['sec-0001', 'sec-0003'],
      ],
    ]);

    const result = await analyzeDependencies('security', cards, router, outDir);

    expect(result.cardsUpdated).toContain('sec-0003');
    const parsed = matter(readFileSync(join(outDir, 'cards', 'security', 'sec-0003.md'), 'utf8'));
    expect(parsed.data.prereqs).toEqual(['sec-0001', 'sec-0002']);
    // mergeEdges 本身要真的去重——不能只靠 prereqsByCardOf 那層再擋一次重複的 from,
    // 否則 mergeEdges 的去重壞了也測不出來(兩層去重互相遮蔽)
    const dupCount = result.graph.edges.filter(([from, to]) => from === 'sec-0001' && to === 'sec-0003').length;
    expect(dupCount).toBe(1);
  });

  it('writes the updated card file under cards/<category>/ with the body trimmed and examples fenced', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [
      makeCard('sec-0001'),
      { ...makeCard('sec-0002'), body: '  有先備關係的內容,前後有空白。  ', examples: ['  範例一  ', '範例二'] },
    ];
    const { router } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    await analyzeDependencies('security', cards, router, outDir);

    const raw = readFileSync(join(outDir, 'cards', 'security', 'sec-0002.md'), 'utf8');
    const parsed = matter(raw);
    expect(parsed.content.trim().startsWith('有先備關係的內容,前後有空白。')).toBe(true);
    expect(raw).toContain('```example\n範例一\n```\n\n```example\n範例二\n```');
    expect(parsed.data.prereqs).toEqual(['sec-0001']);
    // yamlStringify(...).trimEnd() 之後緊接關閉的 '---',中間不該留一行空白
    expect(raw).not.toMatch(/\n\n---\n\n有先備/);
    expect(raw).toMatch(/\n---\n\n有先備/);
    // body 後面隔一個空行才接上例句區塊
    expect(raw).toContain('有先備關係的內容,前後有空白。\n\n```example\n範例一\n```\n\n```example\n範例二\n```\n');
    expect(raw.endsWith('```example\n範例二\n```\n')).toBe(true);
  });

  it('writes no trailing example block for an updated card that has no examples', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [
      makeCard('sec-0001'),
      { ...makeCard('sec-0002'), body: '沒有範例的內容。', examples: [] },
    ];
    const { router } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    await analyzeDependencies('security', cards, router, outDir);

    const raw = readFileSync(join(outDir, 'cards', 'security', 'sec-0002.md'), 'utf8');
    expect(raw).not.toContain('```example');
    expect(raw.endsWith('沒有範例的內容。\n')).toBe(true);
  });

  it('sends a prompt built from the template, category and a line per card', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002')];
    const { router, calls } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    await analyzeDependencies('security', cards, router, outDir);

    const prompt = calls[0]!;
    const lines = prompt.split('\n');
    expect(prompt.startsWith(loadPromptTemplate('deps'))).toBe(true);
    expect(lines).toContain('---');
    expect(lines).toContain('category: security');
    expect(lines).toContain('cards:');
    // 'cards:' 前面隔了一個空行才是卡片清單
    expect(prompt).toContain('\n\ncards:\n');
    for (const card of cards) {
      expect(lines).toContain(`- ${card.frontmatter.id}: ${card.frontmatter.title}`);
    }
    // 模板文件本身會說明「之前的回應形成循環」這個機制,所以不能只查那個子字串;
    // 這裡查的是 buildDepsPrompt 真的附上重試說明時才會出現的固定片語。
    expect(prompt).not.toContain('不能再回同一條路徑');
  });

  // deps-token-scaling:固定 2048 的 token 上限在卡片數量多時會把 'ingest.deps'
  // 的回應截斷,依賴圖分析整段被跳過。analyzeDependencies() 必須改成依卡片數量算
  // 動態的 maxTokens 傳進 router.call() 的 opts,取代 token-limits.ts 的固定表格值
  // (opts.maxTokens 有給就會覆蓋表格,見 router.ts 的 `opts.maxTokens ?? TASK_MAX_TOKENS[task]`)。
  it('passes a maxTokens computed from the card count into router.call opts', async () => {
    const outDir = makeOutDir();
    const cards = makeManyCards(30);
    const edges: [CardId, CardId][] = cards.slice(1).map((c, i) => [cards[i]!.frontmatter.id, c.frontmatter.id]);
    const { router, optsCalls } = makeDepsRouter([edges]);

    await analyzeDependencies('security', cards, router, outDir);

    expect(optsCalls).toHaveLength(1);
    expect(optsCalls[0]?.maxTokens).toBe(computeDepsMaxTokens(30));
    // 30 張卡片的動態值應該遠大於 token-limits.ts 原本寫死的 2048,不然這個測試
    // 測不出「真的依卡片數量算」跟「剛好等於舊常數」的差別。
    expect(optsCalls[0]?.maxTokens).toBeGreaterThan(2048);
  });

  it('passes a maxTokens near the 2048 floor for a small category (3 cards)', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];
    const { router, optsCalls } = makeDepsRouter([[['sec-0001', 'sec-0002']]]);

    await analyzeDependencies('security', cards, router, outDir);

    expect(optsCalls[0]?.maxTokens).toBe(computeDepsMaxTokens(3));
    expect(optsCalls[0]?.maxTokens).toBeGreaterThanOrEqual(2048);
  });

  it('describes the cycle path in the retry prompt, joined with " -> "', async () => {
    const outDir = makeOutDir();
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];
    const cyclicEdges: [CardId, CardId][] = [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
    ];
    const { router, calls } = makeDepsRouter([cyclicEdges, [['sec-0001', 'sec-0002'], ['sec-0002', 'sec-0003']]]);

    await analyzeDependencies('security', cards, router, outDir);

    // 重試提示前面隔了一個空行才接上循環說明
    expect(calls[1]).toContain('\n\n之前的回應形成循環,不能再回同一條路徑:');
    expect(calls[1]).toMatch(/sec-000\d( -> sec-000\d)+/);
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

    it('passes the same computed maxTokens into both the first call and the cycle-retry call', async () => {
      const outDir = makeOutDir();
      const { router, optsCalls } = makeDepsRouter([cyclicEdges, [['sec-0001', 'sec-0002'], ['sec-0002', 'sec-0003']]]);

      await analyzeDependencies('security', cards, router, outDir);

      expect(optsCalls).toHaveLength(2);
      const expected = computeDepsMaxTokens(cards.length);
      expect(optsCalls[0]?.maxTokens).toBe(expected);
      expect(optsCalls[1]?.maxTokens).toBe(expected);
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

      expect(result.edgesRemoved).toHaveLength(1);
      expect(result.graph.edges).not.toContainEqual(result.edgesRemoved[0]);
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

      expect(result.edgesRemoved).toEqual([]);
      const events = logEventsOf(outDir);
      expect(events.some((e) => e.type === 'cycle_removed')).toBe(false);
    });

    // 加一張跟被丟棄的邊只共用一個端點(from 相同、to 不同)的無關邊,證明丟邊判斷是
    // 「from 且 to 都符合」(AND),不是「from 或 to 符合就丟」(OR)——否則這條無關邊
    // 會被一起誤刪。
    it('only drops the exact offending [from, to] pair, keeping edges that share just one endpoint with it', async () => {
      const outDir = makeOutDir();
      const fiveCards: Card[] = [
        makeCard('sec-0001'),
        makeCard('sec-0002'),
        makeCard('sec-0003'),
        makeCard('sec-0004'),
        makeCard('sec-0005'),
      ];
      // sec-0003->sec-0004 共用 offending 的 from(sec-0003),to 不同;
      // sec-0005->sec-0001 共用 offending 的 to(sec-0001),from 不同——兩種各只符合
      // 一半的邊都不該被丟掉,才證明判斷是「from 且 to 都符合」而不是任一符合就丟。
      const edgesWithRedHerrings: [CardId, CardId][] = [...cyclicEdges, ['sec-0003', 'sec-0004'], ['sec-0005', 'sec-0001']];
      const { router } = makeDepsRouter([edgesWithRedHerrings, edgesWithRedHerrings]);

      const result = await analyzeDependencies('security', fiveCards, router, outDir);

      expect(result.edgesRemoved).toEqual([['sec-0003', 'sec-0001']]);
      expect(result.graph.edges).toContainEqual(['sec-0003', 'sec-0004']);
      expect(result.graph.edges).toContainEqual(['sec-0005', 'sec-0001']);
      expect(result.graph.edges).toContainEqual(['sec-0001', 'sec-0002']);
      expect(result.graph.edges).toContainEqual(['sec-0002', 'sec-0003']);
      expect(result.graph.edges).not.toContainEqual(['sec-0003', 'sec-0001']);
    });
  });

  describe('when the model response for ingest.deps is malformed', () => {
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002')];

    function makeBadRouter(text: string): LlmRouter {
      return {
        async call(task): Promise<LlmResult> {
          if (task !== 'ingest.deps') throw new Error(`未預期的 task: ${task}`);
          return { text, provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
        },
        async probeOnline() {
          return true;
        },
        async probeLocal() {
          return { available: false, models: [] };
        },
      };
    }

    it('throws when the response is not valid JSON', async () => {
      const outDir = makeOutDir();
      const router = makeBadRouter('not json at all');

      await expect(analyzeDependencies('security', cards, router, outDir)).rejects.toThrow('不是合法 JSON');
    });

    it('throws when the response has no edges array', async () => {
      const outDir = makeOutDir();
      const router = makeBadRouter(JSON.stringify({ nodes: [] }));

      await expect(analyzeDependencies('security', cards, router, outDir)).rejects.toThrow('缺少 edges 陣列');
    });
  });
});

// ============================================================== removeCyclesLocally
//
// 本地迴圈的循環修復(cycle-local-repair):純函式,不用假 router。
// detectCycle → 濾掉 back edge → 再 detectCycle,重複到無環或丟邊次數達
// maxDrops。見 deps.ts 裡 removeCyclesLocally() 上面的 TODO 註解——函式體現在
// 只佔位丟一次(不管 maxDrops、不管丟完還有沒有殘留循環),所以下面大多數案例
// 目前是紅燈,釘住目標行為給下一輪開發 agent 接上真的迴圈。

describe('removeCyclesLocally', () => {
  it('returns the graph unchanged when there is no cycle', () => {
    const graph: Graph = { nodes: ['sec-0001', 'sec-0002'], edges: [['sec-0001', 'sec-0002']] };

    const result = removeCyclesLocally(graph, 5);

    expect(result.edgesRemoved).toEqual([]);
    expect(result.unresolved).toBeNull();
    expect(result.graph.edges).toEqual(graph.edges);
  });

  // 既有行為(回歸測試):單一循環一次丟邊就過。
  it('resolves a single 3-cycle by dropping exactly one edge', () => {
    const graph: Graph = {
      nodes: ['sec-0001', 'sec-0002', 'sec-0003'],
      edges: [
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0001'],
      ],
    };

    const result = removeCyclesLocally(graph, 3);

    expect(result.edgesRemoved).toEqual([['sec-0003', 'sec-0001']]);
    expect(result.unresolved).toBeNull();
    expect(detectCycle(result.graph).hasCycle).toBe(false);
  });

  // 兩個獨立循環,不共用任何節點或邊。DFS 從 nodes[0](sec-0001)開始,第一次
  // detectCycle 只會走到 sec-0001..0003 那個循環就回傳(還沒走到 sec-0004..0006);
  // 丟掉它的 back edge 之後,第二次 detectCycle 才會抓到 sec-0004..0006 那個。
  it('resolves two independent cycles across two rounds', () => {
    const graph: Graph = {
      nodes: ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0004', 'sec-0005', 'sec-0006'],
      edges: [
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0001'],
        ['sec-0004', 'sec-0005'],
        ['sec-0005', 'sec-0006'],
        ['sec-0006', 'sec-0004'],
      ],
    };

    const result = removeCyclesLocally(graph, 6);

    expect(result.edgesRemoved).toEqual([
      ['sec-0003', 'sec-0001'],
      ['sec-0006', 'sec-0004'],
    ]);
    expect(result.unresolved).toBeNull();
    expect(detectCycle(result.graph).hasCycle).toBe(false);
    expect(result.graph.edges).toHaveLength(4);
  });

  // 上限(maxDrops):3 張卡,3 個各只需要丟一次邊的循環(2 個自環 + 1 個三卡
  // 循環),但 maxDrops 只給 3。自環排在每張卡鄰接表的最前面,所以本地迴圈會先
  // 把 3 個自環各丟一次,丟滿上限時,三卡循環(sec-0001→sec-0002→sec-0003→
  // sec-0001)本身完全沒被碰到,依然殘留。
  it('stops at maxDrops and reports the remaining cycle as unresolved', () => {
    const graph: Graph = {
      nodes: ['sec-0001', 'sec-0002', 'sec-0003'],
      edges: [
        ['sec-0001', 'sec-0001'],
        ['sec-0002', 'sec-0002'],
        ['sec-0003', 'sec-0003'],
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0001'],
      ],
    };

    const result = removeCyclesLocally(graph, 3);

    expect(result.edgesRemoved).toEqual([
      ['sec-0001', 'sec-0001'],
      ['sec-0002', 'sec-0002'],
      ['sec-0003', 'sec-0003'],
    ]);
    expect(result.unresolved).toEqual(['sec-0001', 'sec-0002', 'sec-0003', 'sec-0001']);
    expect(result.graph.edges).toEqual([
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
    ]);
  });

  // 確定性:同一組輸入跑兩次,丟的邊完全一樣、順序也一樣。
  it('is deterministic: the same graph run twice drops the same edges in the same order', () => {
    const graph: Graph = {
      nodes: ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0004', 'sec-0005', 'sec-0006'],
      edges: [
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
        ['sec-0003', 'sec-0001'],
        ['sec-0004', 'sec-0005'],
        ['sec-0005', 'sec-0006'],
        ['sec-0006', 'sec-0004'],
      ],
    };

    const first = removeCyclesLocally(graph, 6);
    const second = removeCyclesLocally(graph, 6);

    expect(second.edgesRemoved).toEqual(first.edgesRemoved);
    // 「兩次一樣」在同一個 process 裡太弱(靠 Set/Map 迭代順序的實作也會兩次一樣)。
    // 真正釘住確定性的是「丟的是哪兩條」:detectCycle() 的 DFS 照 nodes/edges 的
    // 原始順序走,回邊必定是每個環裡最後被走到的那條。
    expect(first.edgesRemoved).toEqual([
      ['sec-0003', 'sec-0001'],
      ['sec-0006', 'sec-0004'],
    ]);
    expect(first.unresolved).toBeNull();
  });
});

// ============================================================== analyzeDependencies:
// local cycle repair loop
//
// 這幾個測試透過假 router 走完整條 analyzeDependencies(),驗證「第二次挑戰仍
// 循環」之後真的接上本地迴圈(目前還沒接,見 deps.ts 的 TODO)。analyzeDependencies()
// 現在的舊行為在這兩個 fixture 底下都會在 computeAndSaveCategoryOrder() 裡
// 丟出「依賴圖有循環」的錯誤(deps.json 已經寫了一半、order 沒寫)——下面的斷言
// 描述的是接上本地迴圈之後「應該」的樣子,目前是紅燈。

describe('analyzeDependencies: local cycle repair loop', () => {
  it('removes both edges when the retry response itself contains two independent cycles, and writes an order listing every card once', async () => {
    const outDir = makeOutDir();
    const sixCards: Card[] = [
      makeCard('sec-0001'),
      makeCard('sec-0002'),
      makeCard('sec-0003'),
      makeCard('sec-0004'),
      makeCard('sec-0005'),
      makeCard('sec-0006'),
    ];
    const firstAttemptCycle: [CardId, CardId][] = [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ];
    const retryTwoIndependentCycles: [CardId, CardId][] = [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
      ['sec-0004', 'sec-0005'],
      ['sec-0005', 'sec-0006'],
      ['sec-0006', 'sec-0004'],
    ];
    const { router } = makeDepsRouter([firstAttemptCycle, retryTwoIndependentCycles]);

    const result = await analyzeDependencies('security', sixCards, router, outDir);

    expect(result.edgesRemoved).toEqual([
      ['sec-0003', 'sec-0001'],
      ['sec-0006', 'sec-0004'],
    ]);
    expect(result.cycleUnresolved).toBeNull();
    const orderPath = join(outDir, 'graph', 'order-security.json');
    expect(existsSync(orderPath)).toBe(true);
    const order = JSON.parse(readFileSync(orderPath, 'utf8')) as CardId[];
    expect([...order].sort()).toEqual(sixCards.map((c) => c.frontmatter.id).sort());
    const events = logEventsOf(outDir);
    expect(events.filter((e) => e.type === 'cycle_removed')).toHaveLength(2);
  });

  it('writes neither deps.json nor the order file when the local loop still cycles at the card-count cap, and logs a warning naming the remaining cycle', async () => {
    const outDir = makeOutDir();
    const threeCards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];
    const firstAttemptCycle: [CardId, CardId][] = [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ];
    // 每丟一條邊就冒出下一個環:3 個自環各佔一次丟邊,丟滿上限(3 張卡)之後,
    // 三卡循環本身還在(見 removeCyclesLocally 的同款 fixture)。
    const chainReactionEdges: [CardId, CardId][] = [
      ['sec-0001', 'sec-0001'],
      ['sec-0002', 'sec-0002'],
      ['sec-0003', 'sec-0003'],
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
    ];
    const { router } = makeDepsRouter([firstAttemptCycle, chainReactionEdges]);

    const result = await analyzeDependencies('security', threeCards, router, outDir);

    expect(result.cycleUnresolved).toEqual(['sec-0001', 'sec-0002', 'sec-0003', 'sec-0001']);
    expect(existsSync(join(outDir, 'graph', 'deps.json'))).toBe(false);
    expect(existsSync(join(outDir, 'graph', 'order-security.json'))).toBe(false);
    // 沒寫檔就沒有 order、也沒有卡片被改寫——回傳值要跟磁碟上的事實一致。
    expect(result.order).toEqual([]);
    expect(result.cardsUpdated).toEqual([]);
    const events = logEventsOf(outDir);
    const warning = events.find(
      (e) => e.type === 'warning' && typeof e.message === 'string' && (e.message as string).includes('sec-0001'),
    );
    expect(warning, JSON.stringify(events)).toBeTruthy();
    // warning 要點名「沒被寫出的是哪個檔」,而且殘留路徑要是人看得懂的
    // 「a -> b -> c -> a」,不是黏成一串。
    expect(warning!.file).toBe('graph/deps.json');
    expect(warning!.message).toContain('sec-0001 -> sec-0002 -> sec-0003 -> sec-0001');
  });

  // deps-stale-graph-removal(ADR-038):上面那個測試的目錄是乾淨的,所以「不寫」
  // 看起來就等於「磁碟上沒有圖」。真實情況是上一次成功的 run **已經寫過檔**——
  // 這時候只是「不寫」的話,舊的 deps.json entry 與舊的 order 檔會留在磁碟上,
  // 讀的人拿到過期的圖卻看不出來。這個測試把 fixture 換成「先有一次成功的 run」,
  // 斷言該分類的過期資料被移除,而**另一個分類完全不受影響**。
  it('removes the stale graph entry and order file left by a previous successful run when the local loop exhausts the drop limit, without touching another category', async () => {
    const outDir = makeOutDir();
    const threeCards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002'), makeCard('sec-0003')];

    // ---- 上一次成功的 run:security 與 language 都有圖,兩個 order 檔都在
    const staleSecurityGraph: Graph = {
      nodes: ['sec-0001', 'sec-0002', 'sec-0003'],
      edges: [
        ['sec-0001', 'sec-0002'],
        ['sec-0002', 'sec-0003'],
      ],
    };
    const languageGraph: Graph = { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] };
    writeFileSync(
      join(outDir, 'graph', 'deps.json'),
      JSON.stringify({ security: staleSecurityGraph, language: languageGraph }, null, 2),
    );
    writeFileSync(join(outDir, 'graph', 'order-security.json'), JSON.stringify(['sec-0001', 'sec-0002', 'sec-0003'], null, 2));
    const languageOrderBefore = JSON.stringify(['lan-0001', 'lan-0002'], null, 2);
    writeFileSync(join(outDir, 'graph', 'order-language.json'), languageOrderBefore);

    // ---- 這一次的 run:丟邊丟滿上限(3 張卡)仍有殘留的三卡循環
    const firstAttemptCycle: [CardId, CardId][] = [
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0001'],
    ];
    const chainReactionEdges: [CardId, CardId][] = [
      ['sec-0001', 'sec-0001'],
      ['sec-0002', 'sec-0002'],
      ['sec-0003', 'sec-0003'],
      ['sec-0001', 'sec-0002'],
      ['sec-0002', 'sec-0003'],
      ['sec-0003', 'sec-0001'],
    ];
    const { router } = makeDepsRouter([firstAttemptCycle, chainReactionEdges]);

    const result = await analyzeDependencies('security', threeCards, router, outDir);

    expect(result.cycleUnresolved).toEqual(['sec-0001', 'sec-0002', 'sec-0003', 'sec-0001']);

    // security 的過期資料要消失:deps.json 的 key 不見、order 檔不見。
    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(Object.hasOwn(deps, 'security')).toBe(false);
    expect(existsSync(join(outDir, 'graph', 'order-security.json'))).toBe(false);

    // 另一個分類完全不受影響——deps.json 是一個檔裝所有分類(契約 §8),
    // 砍掉整個檔會連 language 一起毀掉,那是這條規則最重要的反例。
    expect(deps.language).toEqual(languageGraph);
    expect(existsSync(join(outDir, 'graph', 'order-language.json'))).toBe(true);
    expect(readFileSync(join(outDir, 'graph', 'order-language.json'), 'utf8')).toBe(languageOrderBefore);

    // 原本就該記的那筆 warning 照舊,而且要點名殘留的循環路徑。
    const events = logEventsOf(outDir);
    const warning = events.find((e) => e.type === 'warning');
    expect(warning, JSON.stringify(events)).toBeTruthy();
    expect(warning!.file).toBe('graph/deps.json');
    expect(warning!.message).toContain('sec-0001 -> sec-0002 -> sec-0003 -> sec-0001');
  });
});

// ============================================================== removeCategoryGraph
//
// 「丟邊達上限就兩個檔都不寫」只保證**這一次**不寫。上一次成功的 run 已經寫過
// deps.json 的 entry 與 order 檔的話,舊檔會留在磁碟上變成看不出來的過期資料
// (09-lint 目前沒有「卡片不在 order 裡」這條檢查)。ADR-038 決定移除該分類的
// 圖資料,粒度是**分類**——契約 §8 的 deps.json 是 Record<CategoryId, Graph>,
// 一個檔裝所有分類,砍掉整個檔會連別的分類一起毀掉。
//
// 下面的測試對應 deps.ts 裡 removeCategoryGraph() 的 TODO,現在函式體只 throw
// 'not implemented',所以整組是紅的。

describe('removeCategoryGraph', () => {
  it('drops only the target category from deps.json and deletes its order file, leaving other categories untouched', () => {
    const outDir = makeOutDir();
    const securityGraph: Graph = { nodes: ['sec-0001', 'sec-0002'], edges: [['sec-0001', 'sec-0002']] };
    const languageGraph: Graph = { nodes: ['lan-0001'], edges: [] };
    writeFileSync(join(outDir, 'graph', 'deps.json'), JSON.stringify({ security: securityGraph, language: languageGraph }, null, 2));
    writeFileSync(join(outDir, 'graph', 'order-security.json'), JSON.stringify(['sec-0001', 'sec-0002'], null, 2));
    const languageOrderBefore = JSON.stringify(['lan-0001'], null, 2);
    writeFileSync(join(outDir, 'graph', 'order-language.json'), languageOrderBefore);

    removeCategoryGraph(outDir, 'security');

    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    // 別的分類一個都不能動:這是「粒度是分類」的整個重點。
    expect(deps).toEqual({ language: languageGraph });
    expect(Object.hasOwn(deps, 'security')).toBe(false);
    expect(existsSync(join(outDir, 'graph', 'order-security.json'))).toBe(false);
    expect(existsSync(join(outDir, 'graph', 'order-language.json'))).toBe(true);
    expect(readFileSync(join(outDir, 'graph', 'order-language.json'), 'utf8')).toBe(languageOrderBefore);
  });

  it('rewrites deps.json atomically, leaving no .tmp file behind', () => {
    const outDir = makeOutDir();
    const languageGraph: Graph = { nodes: ['lan-0001'], edges: [] };
    writeFileSync(
      join(outDir, 'graph', 'deps.json'),
      JSON.stringify({ security: { nodes: ['sec-0001'], edges: [] }, language: languageGraph }, null, 2),
    );

    removeCategoryGraph(outDir, 'security');

    // 契約 §11b 的寫法(寫 .tmp → fsync → rename)成功之後不該留下暫存檔。
    expect(existsSync(join(outDir, 'graph', 'deps.json.tmp'))).toBe(false);
    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps).toEqual({ language: languageGraph });
  });

  // ---- 邊界 1:deps.json 本來就不存在

  it('does not throw when deps.json does not exist, and does not create one', () => {
    const outDir = makeOutDir();

    expect(() => removeCategoryGraph(outDir, 'security')).not.toThrow();

    // 沒有圖就是沒有圖,不該為了「刪掉一個不存在的 key」憑空生出一個空檔。
    expect(existsSync(join(outDir, 'graph', 'deps.json'))).toBe(false);
  });

  // ---- 邊界 2:deps.json 存在但沒有這個分類的 key

  it('does not throw when deps.json has no entry for the category, and leaves the other entries byte-identical', () => {
    const outDir = makeOutDir();
    const languageGraph: Graph = { nodes: ['lan-0001', 'lan-0002'], edges: [['lan-0001', 'lan-0002']] };
    writeFileSync(join(outDir, 'graph', 'deps.json'), JSON.stringify({ language: languageGraph }, null, 2));

    expect(() => removeCategoryGraph(outDir, 'security')).not.toThrow();

    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps).toEqual({ language: languageGraph });
  });

  // ---- 邊界 3:移除後 deps.json 變成空物件

  it('keeps deps.json as an empty object when the removed category was the only entry', () => {
    const outDir = makeOutDir();
    writeFileSync(join(outDir, 'graph', 'deps.json'), JSON.stringify({ security: { nodes: ['sec-0001'], edges: [] } }, null, 2));

    removeCategoryGraph(outDir, 'security');

    // ADR-038:{} 是 Record<CategoryId, Graph> 的合法值(契約 §8),而且「檔在、
    // key 不在」跟「檔不在」對消費者是同一個答案,留著空物件少一條程式路徑。
    expect(existsSync(join(outDir, 'graph', 'deps.json'))).toBe(true);
    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps).toEqual({});
  });

  // ---- 邊界 4:order 檔不存在

  it('does not throw when the order file for the category does not exist', () => {
    const outDir = makeOutDir();
    writeFileSync(join(outDir, 'graph', 'deps.json'), JSON.stringify({ security: { nodes: ['sec-0001'], edges: [] } }, null, 2));

    expect(() => removeCategoryGraph(outDir, 'security')).not.toThrow();

    expect(existsSync(join(outDir, 'graph', 'order-security.json'))).toBe(false);
    const deps = JSON.parse(readFileSync(join(outDir, 'graph', 'deps.json'), 'utf8')) as Record<string, Graph>;
    expect(deps).toEqual({});
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
