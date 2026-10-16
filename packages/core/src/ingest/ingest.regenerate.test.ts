/**
 * T19 端到端:runIngest(假 router,暫存目錄)遇到 regenerate 回應是基準形狀 `[{title, body}]` 時,
 * 卡檔照樣寫出、source_ref 由原卡的 lines 算;重寫完仍超長就 park、不寫卡檔、記一筆 warning。
 * 工單:docs/tickets/T19-regenerate-without-lines.md(要求 2、3、4,端到端那一列)。
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCard } from '@core/schema/validate-card.js';
import { runIngest } from './ingest.js';
import { ensureInitialized } from './init.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

function scriptedRouter(responses: string[]): LlmRouter & { calls: LlmTask[] } {
  const calls: LlmTask[] = [];
  return {
    calls,
    async call(task: LlmTask): Promise<LlmResult> {
      const text = responses[calls.length];
      calls.push(task);
      if (text === undefined) throw new Error(`scriptedRouter: 第 ${calls.length} 次呼叫沒有預設回應`);
      return { text, provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

const RAW = 'raw/security/x.md';
const ORIGINAL_BODY = '超'.repeat(150);
const ORIGINAL = { title: '原本的標題', body: ORIGINAL_BODY, examples: ['原本的例子'], lines: [3, 4] };
const SHORT = '重寫後的精簡正文,字數在上限以內。';
/** 契約 §2:99 個漢字 + same-origin(連字號切斷算 2)= 101 字。 */
const BODY_101 = '同'.repeat(99) + 'same-origin';
/** 98 個漢字 + same-origin = 100 字。 */
const BODY_100 = '同'.repeat(98) + 'same-origin';

const batch = JSON.stringify([ORIGINAL]);
const baseShape = (body: string, extra: Record<string, unknown> = {}) => JSON.stringify([{ title: '模型改過的標題', body, ...extra }]);

describe('T19 端到端:runIngest 與基準形狀的 regenerate 回應', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-t19-'));
    ensureInitialized(dir);
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    writeFileSync(join(dir, RAW), '一些原始內容\n'.repeat(10), 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const events = () => {
    const path = join(dir, 'state/log.jsonl');
    if (!existsSync(path)) return [] as Record<string, unknown>[];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  };
  const cardFiles = () => {
    const d = join(dir, 'cards/security');
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')) : [];
  };

  it('卡檔寫出:source_ref 由原卡 lines 算,title 與 examples 沿用原卡,日誌一筆 regenerate', async () => {
    const router = scriptedRouter([batch, baseShape(SHORT)]);
    const result = await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toEqual(['sec-0001']);
    expect(result.regenerateEvents).toBe(1);
    expect(result.parkedCount).toBe(0);
    expect(router.calls).toEqual(['ingest.cards', 'ingest.cards']);

    const check = validateCard(readFileSync(join(dir, 'cards/security/sec-0001.md'), 'utf8'));
    expect(check.errors).toEqual([]);
    expect(check.card!.frontmatter.source_ref).toBe('raw/security/x.md#L3-L4');
    expect(check.card!.frontmatter.title).toBe(ORIGINAL.title);
    expect(check.card!.body).toBe(SHORT);
    expect(check.card!.examples).toEqual(ORIGINAL.examples);

    const regenerate = events().filter((e) => e.type === 'regenerate');
    expect(regenerate).toHaveLength(1);
    expect(regenerate[0]).toMatchObject({ file: RAW });
    expect(events().filter((e) => e.type === 'warning')).toEqual([]);
    expect(existsSync(join(dir, 'state/needs-review.json'))).toBe(false);
  });

  it('回應帶別的 lines 也不影響 source_ref', async () => {
    const router = scriptedRouter([batch, baseShape(SHORT, { lines: [7, 9] })]);
    await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });
    const check = validateCard(readFileSync(join(dir, 'cards/security/sec-0001.md'), 'utf8'));
    expect(check.card!.frontmatter.source_ref).toBe('raw/security/x.md#L3-L4');
  });

  it('重寫後剛好 100 字(§2)→ 通過,卡檔寫出', async () => {
    const router = scriptedRouter([batch, baseShape(BODY_101), baseShape(BODY_100)]);
    const result = await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });
    expect(result.cardsCreated).toEqual(['sec-0001']);
    expect(result.regenerateEvents).toBe(1);
    expect(result.parkedCount).toBe(0);
    const check = validateCard(readFileSync(join(dir, 'cards/security/sec-0001.md'), 'utf8'));
    expect(check.ok).toBe(true);
    expect(check.bodyWordCount).toBe(100);
  });

  it('三次仍超長(101 字)→ 不寫卡檔、needs-review.json 追加一筆、log 剛好一筆 warning、regenerateEvents 0', async () => {
    const earlier = { category: 'security', title: '之前就在的', reason: 'body_over_limit' };
    writeFileSync(join(dir, 'state/needs-review.json'), JSON.stringify([earlier]), 'utf8');
    const router = scriptedRouter([batch, baseShape(BODY_101, { lines: [9, 9] }), baseShape(BODY_101)]);

    const result = await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toEqual([]);
    expect(result.parkedCount).toBe(1);
    expect(result.regenerateEvents).toBe(0);
    expect(router.calls).toHaveLength(3);
    expect(cardFiles()).toEqual([]);

    const review = JSON.parse(readFileSync(join(dir, 'state/needs-review.json'), 'utf8')) as Record<string, unknown>[];
    expect(review).toHaveLength(2);
    expect(review[0]).toEqual(earlier);
    expect(review[1]).toMatchObject({
      category: 'security',
      title: ORIGINAL.title,
      source: RAW,
      lines: [3, 4],
      reason: 'body_over_limit',
      attempts: [
        { attempt: 1, wordCount: 150, body: ORIGINAL_BODY },
        { attempt: 2, wordCount: 101, body: BODY_101 },
        { attempt: 3, wordCount: 101, body: BODY_101 },
      ],
    });

    const warnings = events().filter((e) => e.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ file: RAW });
    expect(String(warnings[0]!.message)).toContain('needs-review.json');
    expect(events().filter((e) => e.type === 'regenerate')).toEqual([]);
  });

  // 要求 2(顧問 Q2):regenerate 回了不只一筆 → 取第一筆,log.jsonl 多一行 warning;只有一筆時不多這一行。
  // 用完整形狀(含 examples、lines),讓基底上紅的原因只剩「沒有記 warning」。
  const full = (body: string) => ({ title: '模型改過的標題', body, examples: ['新例'], lines: [7, 9] });
  const TEXT_2 = 'regenerate 回了 2 筆,只用第一筆';

  it('regenerate 回了 2 筆 → 卡檔用第一筆,log.jsonl 剛好一行 warning「regenerate 回了 2 筆,只用第一筆」', async () => {
    const router = scriptedRouter([batch, JSON.stringify([full(SHORT), full('第二筆的正文。')])]);
    const result = await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });

    expect(result.cardsCreated).toEqual(['sec-0001']);
    const check = validateCard(readFileSync(join(dir, 'cards/security/sec-0001.md'), 'utf8'));
    expect(check.card!.body).toBe(SHORT);
    expect(check.card!.frontmatter.source_ref).toBe('raw/security/x.md#L3-L4');

    const warnings = events().filter((e) => e.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'warning', file: RAW });
    expect(String(warnings[0]!.message)).toContain(TEXT_2);
    expect(typeof warnings[0]!.ts).toBe('string');
  });

  it('第二筆不是物件也不丟錯,照樣記那一行 warning', async () => {
    const router = scriptedRouter([batch, JSON.stringify([full(SHORT), 42])]);
    const result = await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });
    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toEqual(['sec-0001']);
    const warnings = events().filter((e) => e.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]!.message)).toContain(TEXT_2);
  });

  it('防退步:regenerate 只回一筆 → log.jsonl 不多 warning 那一行(只有 ingested 與 regenerate)', async () => {
    const router = scriptedRouter([batch, JSON.stringify([full(SHORT)])]);
    await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });
    expect(events().map((e) => e.type)).toEqual(['ingested', 'regenerate']);
  });

  it('防退步:批次回應多筆照舊每筆一張卡,log.jsonl 沒有 warning', async () => {
    const router = scriptedRouter([
      JSON.stringify([
        { title: '卡一', body: '第一張卡的正文。', examples: [], lines: [1, 2] },
        { title: '卡二', body: '第二張卡的正文。', examples: ['例'], lines: [3, 4] },
        { title: '卡三', body: '第三張卡的正文。', examples: [], lines: [5, 6] },
      ]),
    ]);
    const result = await runIngest({ outDir: dir, rawRelPath: RAW, category: 'security', router, today: '2026-10-16' });
    expect(result.cardsCreated).toEqual(['sec-0001', 'sec-0002', 'sec-0003']);
    expect(router.calls).toHaveLength(1);
    expect(events().map((e) => e.type)).toEqual(['ingested']);
  });
});
