/**
 * T58 紅測試(b):三條寫卡片的路都走 card-file.ts 的 renderCardFile(ADR-082)。
 * 工單:docs/tickets/T58-card-writer-fence-length.md 第 4 節 (b)。測試 agent 寫;開發 worker 不改。
 *
 * example 用表上第 4 列(內層有一段程式碼圍欄),寫完的檔用 validateCard 讀回:
 * examples 剛好是那一個、body 裡一個反引號都沒有(沒有字掉進 body)。
 *   - ingest:runIngest(假 router);
 *   - 子卡:generateChildrenForCards;
 *   - deps 改寫:analyzeDependencies(prereqs 有變、卡被重寫),再加「讀回再寫一次不變」。
 * 另外:children.ts 轉出去的 renderCardFile 就是 card-file.ts 那一個(topic.ts、deepen.ts 從 children.js import)。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardId } from '@contracts/index.js';
import type { LlmResult, LlmRouter } from '@core/llm/index.js';
import { validateCard } from '@core/schema/validate-card.js';
import { analyzeDependencies } from './deps.js';
import { generateChildrenForCards, renderCardFile as childrenRenderCardFile } from './children.js';
import { runIngest } from './ingest.js';
import { ensureInitialized } from './init.js';

const T = '`'.repeat(3);
const EXAMPLE = `${T}js\nx\n${T}`;

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function routerOf(task: string, text: string): LlmRouter {
  return {
    async call(t): Promise<LlmResult> {
      if (t === task) return { text, provider: 'anthropic', model: 'test-model', latency_ms: 0, provisional: false };
      if (t === 'ingest.questions') {
        const q = JSON.stringify({ questions: [] });
        return { text: q, provider: 'anthropic', model: 'test-model', latency_ms: 0, provisional: false };
      }
      throw new Error(`未預期的 task: ${t}`);
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function expectReadBack(file: string): void {
  const v = validateCard(file);
  expect(v.errors, '寫出來的卡要能通過 validateCard').toEqual([]);
  expect(v.card?.examples, '讀回的 examples 剛好是那一個').toEqual([EXAMPLE]);
  expect(v.card?.body ?? '', 'body 裡一個反引號都不能有(沒有字掉進 body)').not.toContain('`');
}

function makeCard(id: string, overrides: Partial<Card['frontmatter']> = {}, extra: Partial<Card> = {}): Card {
  return {
    frontmatter: {
      id: id as CardId,
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
    ...extra,
  };
}

describe('T58(b) 接線:三條寫卡片的路', () => {
  it('ingest:runIngest 寫出的第 0 層卡,example 含程式碼圍欄時讀回正確', async () => {
    const dir = tmp('lc-t58-ingest-');
    ensureInitialized(dir);
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    writeFileSync(join(dir, 'raw/security/x.md'), '一些原始內容\n'.repeat(10), 'utf8');
    const router = routerOf('ingest.cards', JSON.stringify([{ title: '帶程式碼的卡', body: '正文內容。', examples: [EXAMPLE], lines: [1, 2] }]));

    const result = await runIngest({ outDir: dir, rawRelPath: 'raw/security/x.md', category: 'security', router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(1);
    expectReadBack(readFileSync(join(dir, `cards/security/${result.cardsCreated[0]}.md`), 'utf8'));
  });

  it('子卡:generateChildrenForCards 寫出的子卡,example 含程式碼圍欄時讀回正確', async () => {
    const dir = tmp('lc-t58-children-');
    mkdirSync(join(dir, 'cards', 'security'), { recursive: true });
    mkdirSync(join(dir, 'questions'), { recursive: true });
    const parent = makeCard('sec-0001');
    writeFileSync(join(dir, 'cards/security/sec-0001.md'), ['---', 'id: sec-0001', 'category: security', 'title: 既有卡', 'level: 0', 'source: raw', 'created: 2026-09-01', '---', '', '既有內容'].join('\n'), 'utf8');
    const router = routerOf('ingest.cards', JSON.stringify([{ title: '子概念', body: '子概念的細節說明。', examples: [EXAMPLE] }]));

    const result = await generateChildrenForCards([parent], router, { outDir: dir });

    expect(result.children).toHaveLength(1);
    expectReadBack(readFileSync(join(dir, 'cards/security', `${result.children[0]!.frontmatter.id}.md`), 'utf8'));
  });

  it('deps 改寫:analyzeDependencies 重寫 prereqs 有變的卡,example 含程式碼圍欄時讀回正確;讀回的卡再被改寫一次,內容不變', async () => {
    const dir = tmp('lc-t58-deps-');
    mkdirSync(join(dir, 'graph'), { recursive: true });
    const depsRouter = (edges: [string, string][]): LlmRouter => routerOf('ingest.deps', JSON.stringify({ edges }));
    const cards: Card[] = [makeCard('sec-0001'), makeCard('sec-0002', {}, { body: '有先備關係的內容。', examples: [EXAMPLE] }), makeCard('sec-0003')];

    await analyzeDependencies('security', cards, depsRouter([['sec-0001', 'sec-0002']]), dir);
    const first = readFileSync(join(dir, 'cards/security/sec-0002.md'), 'utf8');
    expectReadBack(first);

    // 第二輪:用讀回的卡(ingest → validateCard → deps 的路),多一條邊讓它再被改寫一次
    const readBack = validateCard(first).card!;
    await analyzeDependencies('security', [cards[0]!, readBack, cards[2]!], depsRouter([['sec-0001', 'sec-0002'], ['sec-0003', 'sec-0002']]), dir);
    const second = readFileSync(join(dir, 'cards/security/sec-0002.md'), 'utf8');
    expectReadBack(second);
    expect(validateCard(second).card?.frontmatter.prereqs).toEqual(['sec-0001', 'sec-0003']);
    expect(validateCard(second).card?.body).toBe(readBack.body);
  });

  it('children.ts 轉出去的 renderCardFile 就是 card-file.ts 那一個(topic.ts、deepen.ts 從 children.js import,不留另一份)', async () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'card-file.ts');
    expect(existsSync(file), 'card-file.ts 要存在').toBe(true);
    const mod = (await import(pathToFileURL(file).href)) as { renderCardFile?: unknown };
    expect(typeof mod.renderCardFile).toBe('function');
    expect(childrenRenderCardFile).toBe(mod.renderCardFile);
  });
});
