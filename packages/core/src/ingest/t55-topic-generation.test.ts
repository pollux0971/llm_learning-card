/**
 * T55 單元測試:沒有 raw 時從主題生成(02 phase-3 場景 2)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T55-ingest-topic-generation.md「要的結果」「紅測試」與顧問的裁決(D1 完整後半、D2 記在 ingested.json、加 1–3)。
 * 全部用假 router(數呼叫、數探測),真呼叫 0、不碰金鑰、不碰真的 learning/。
 *
 * 分組:
 *   G 生成:level 0、source llm、沒有 source_ref、今天、prereqs [];第一次 ingest.cards 的 prompt 帶「正規化後的主題」;完整後半(考題、子卡、依賴圖);levelZeroOnly 只跑 level 0
 *   B 上下限:0 張失敗;1、5 張;6 張只留前 5 張並記一筆 warning
 *   W 字數:body 超過 100 字走既有的重試(regenerate)與暫緩(needs-review.json);全部暫緩 = 失敗
 *   R 重跑:同一個分類、正規化後同一個主題略過(LLM 0、卡 id 列出);只差空白 / NFC 算同一個;不同主題各自生成
 *   S 掃描不碰主題卡:先主題後掃描,主題卡位元組不變、沒被標 source_missing / stale、ingested.json 的 topic: 鍵還在
 *   N 正規化與長度:空的、201 個 code point 拒絕(LLM 0、目錄不變);200 個過;以 code point 計不是 UTF-16 長度
 *   T 狀態:記在 ingested.json、不另開 state/ 底下的新檔、事件類型 ⊆ §10、寫入走 writeFileAtomic
 *   O 離線:要生成卻探測失敗 → 被擋、LLM 0、不寫卡、不記主題
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it, vi } from 'vitest';
import { countingRouter, ingestOne, loadScan, makeLearning, rawText, readCard, readLog, treeHash, writeRaw } from './t53-test-support.js';
import {
  LONG_BODY, cardIdsIn, defaultTopicCards, normalizeTopic, readIngested, stateFiles, topicKey, topicRouter, topicSha,
} from './t55-test-support.js';

vi.mock('@core/schema/atomic-write.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/atomic-write.js')>();
  return { ...real, writeFileAtomic: vi.fn(real.writeFileAtomic), appendLineAtomic: vi.fn(real.appendLineAtomic) };
});
const atomic = await import('@core/schema/atomic-write.js');

const TODAY = '2026-09-10';
const CAT = 'peach';
const peach = () => makeLearning([{ id: CAT, name: '桃子', require_raw: false }]);
const level0 = (dir: string): string[] =>
  cardIdsIn(dir, CAT).filter((id) => matter(readCard(dir, CAT, id)).data['level'] === 0);

describe('T55 G. 生成', () => {
  it('完整管線:3 張 level 0 卡,source llm、沒有 source_ref、created 今天、prereqs 空、分類對;每張都有考題檔;有子卡;沒有 raw 被處理', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router, calls, topicPrompts } = topicRouter();
    const topic = '光合作用的基本過程';
    const r = await scan({ outDir: dir, router, category: CAT, topic, today: TODAY });
    expect(r.refused).toBeUndefined();
    expect(r.processed, '沒有 raw 檔被處理').toEqual([]);
    expect(r.topicGenerated?.length).toBe(3);
    expect(level0(dir)).toEqual([...r.topicGenerated!].sort());
    for (const id of r.topicGenerated!) {
      const text = readCard(dir, CAT, id);
      const fm = matter(text).data as Record<string, unknown>;
      expect(fm['level']).toBe(0);
      expect(fm['source']).toBe('llm');
      expect(fm['category']).toBe(CAT);
      expect('source_ref' in fm, '主題卡沒有 source_ref').toBe(false);
      expect(text).not.toMatch(/source_ref/);
      expect(String(fm['created'] instanceof Date ? (fm['created'] as Date).toISOString().slice(0, 10) : fm['created'])).toBe(TODAY);
      expect(fm['prereqs'] ?? []).toEqual(expect.any(Array));
      const q = readFileSync(join(dir, 'questions', `${id}.yaml`), 'utf8');
      expect(q.length, `卡 ${id} 要有考題檔`).toBeGreaterThan(0);
    }
    expect(cardIdsIn(dir, CAT).length, '完整後半:有子卡(level ≥ 1)').toBeGreaterThan(3);
    expect(topicPrompts().length, '主題生成只呼叫一次').toBe(1);
    expect(topicPrompts()[0]!, 'prompt 帶主題').toContain(topic);
    expect(calls.some((c) => c.task === 'ingest.questions')).toBe(true);
    expect(calls.some((c) => c.task === 'ingest.deps')).toBe(true);
  });

  it('送進 prompt 的是正規化後的主題(trim、NFC、連續空白併成一個)', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router, topicPrompts } = topicRouter();
    const raw = '  Café   au\t\nlait  ';
    await scan({ outDir: dir, router, category: CAT, topic: raw, today: TODAY, levelZeroOnly: true });
    const prompt = topicPrompts()[0]!;
    expect(prompt).toContain(normalizeTopic(raw));
    expect(normalizeTopic(raw)).toBe('Café au lait');
    expect(prompt).not.toContain('Café');
    expect(prompt).not.toContain('au\t');
  });

  it('levelZeroOnly:只呼叫一次 ingest.cards(主題生成),沒有考題、沒有子卡、沒有依賴圖', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router, calls } = topicRouter();
    const r = await scan({ outDir: dir, router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true });
    expect(r.topicGenerated?.length).toBe(3);
    expect(calls.map((c) => c.task)).toEqual(['ingest.cards']);
    expect(cardIdsIn(dir, CAT)).toEqual([...r.topicGenerated!].sort());
  });

  it('卡的內容是模型回的 title 與 body(examples 照寫)', async () => {
    const scan = await loadScan();
    const dir = peach();
    const cards = [{ title: '概念甲', body: '甲的說明文字很短。', examples: ['例子一'] }];
    const { router } = topicRouter({ cards });
    const r = await scan({ outDir: dir, router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    const text = readCard(dir, CAT, r.topicGenerated![0]!);
    const parsed = matter(text);
    expect(parsed.data['title']).toBe('概念甲');
    expect(parsed.content).toContain('甲的說明文字很短。');
    expect(text).toContain('例子一');
  });
});

describe('T55 B. 張數上下限 1–5', () => {
  it('回 0 張:失敗(topic_failed)、不寫卡、不記主題、ingested.json 不動', async () => {
    const scan = await loadScan();
    const dir = peach();
    const before = treeHash(join(dir, 'cards'));
    const r = await scan({ outDir: dir, router: topicRouter({ cards: [] }).router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    expect(r.refused).toBe('topic_failed');
    expect(r.topicGenerated ?? []).toEqual([]);
    expect(treeHash(join(dir, 'cards'))).toBe(before);
    expect(Object.keys(readIngested(dir)).filter((k) => k.startsWith('topic:'))).toEqual([]);
  });

  for (const n of [1, 5]) {
    it(`回 ${n} 張:全部寫進去`, async () => {
      const scan = await loadScan();
      const dir = peach();
      const r = await scan({ outDir: dir, router: topicRouter({ cards: defaultTopicCards(n) }).router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
      expect(r.refused).toBeUndefined();
      expect(r.topicGenerated?.length).toBe(n);
      expect(level0(dir).length).toBe(n);
    });
  }

  it('回 6 張:只留前 5 張(第 6 張的 title 沒進任何卡),並記一筆 warning', async () => {
    const scan = await loadScan();
    const dir = peach();
    const cards = defaultTopicCards(6);
    const warnsBefore = readLog(dir).filter((e) => e['type'] === 'warning').length;
    const r = await scan({ outDir: dir, router: topicRouter({ cards }).router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    expect(r.topicGenerated?.length).toBe(5);
    const titles = level0(dir).map((id) => String(matter(readCard(dir, CAT, id)).data['title']));
    expect(titles.sort()).toEqual(cards.slice(0, 5).map((c) => c.title).sort());
    expect(titles).not.toContain(cards[5]!.title);
    const warns = readLog(dir).filter((e) => e['type'] === 'warning');
    expect(warns.length, '超過 5 張記一筆 warning').toBe(warnsBefore + 1);
    expect(String(warns[warns.length - 1]!['message'])).toMatch(/6/);
  });

  it('剛好 5 張不記 warning', async () => {
    const scan = await loadScan();
    const dir = peach();
    await scan({ outDir: dir, router: topicRouter({ cards: defaultTopicCards(5) }).router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    expect(readLog(dir).filter((e) => e['type'] === 'warning')).toEqual([]);
  });
});

describe('T55 W. body 超過 100 字:既有的重試與暫緩', () => {
  it('第一張太長、regenerate 回短的:重試一次、寫的是短的那版,regenerate 的 prompt 有 previous body', async () => {
    const scan = await loadScan();
    const dir = peach();
    const cards = [{ title: '太長的', body: LONG_BODY, examples: [] }, ...defaultTopicCards(2)];
    const { router, regeneratePrompts } = topicRouter({ cards, regenerateBodies: ['重寫之後很短。'] });
    const r = await scan({ outDir: dir, router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    expect(r.topicGenerated?.length).toBe(3);
    expect(regeneratePrompts().length).toBe(1);
    expect(regeneratePrompts()[0]!).toContain('previous body:');
    const bodies = level0(dir).map((id) => matter(readCard(dir, CAT, id)).content);
    expect(bodies.some((b) => b.includes('重寫之後很短。'))).toBe(true);
    expect(bodies.some((b) => b.includes(LONG_BODY))).toBe(false);
  });

  it('一張重試三次都太長:暫緩(寫 needs-review.json)、不寫那張卡,其他兩張照寫', async () => {
    const scan = await loadScan();
    const dir = peach();
    const cards = [{ title: '太長的', body: LONG_BODY, examples: [] }, ...defaultTopicCards(2)];
    const r = await scan({ outDir: dir, router: topicRouter({ cards, regenerateBodies: [LONG_BODY] }).router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    expect(r.refused).toBeUndefined();
    expect(r.topicGenerated?.length).toBe(2);
    const parked = JSON.parse(readFileSync(join(dir, 'state/needs-review.json'), 'utf8')) as { category: string; title: string }[];
    expect(parked.map((p) => p.title)).toEqual(['太長的']);
    expect(parked[0]!.category).toBe(CAT);
    for (const id of level0(dir)) expect(readCard(dir, CAT, id)).not.toContain(LONG_BODY);
  });

  it('全部都太長、全部暫緩:失敗(topic_failed)、不寫卡、不記主題', async () => {
    const scan = await loadScan();
    const dir = peach();
    const cards = [{ title: '長一', body: LONG_BODY, examples: [] }, { title: '長二', body: LONG_BODY, examples: [] }];
    const r = await scan({ outDir: dir, router: topicRouter({ cards, regenerateBodies: [LONG_BODY] }).router, category: CAT, topic: '某主題', today: TODAY, levelZeroOnly: true });
    expect(r.refused).toBe('topic_failed');
    expect(cardIdsIn(dir, CAT)).toEqual([]);
    expect(Object.keys(readIngested(dir)).filter((k) => k.startsWith('topic:'))).toEqual([]);
  });
});

describe('T55 R. 同一個主題不重複生成', () => {
  it('同一個分類、同一個主題再跑:LLM 0、探測 0、不寫新卡、topicAlready 列出那幾張卡、ingested.json 位元組不變', async () => {
    const scan = await loadScan();
    const dir = peach();
    const first = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true });
    const ids = first.topicGenerated!;
    const stateBefore = readFileSync(join(dir, 'state/ingested.json'), 'utf8');
    const cardsBefore = treeHash(join(dir, 'cards'));
    const { router, calls, probes } = topicRouter();
    const again = await scan({ outDir: dir, router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true });
    expect(again.refused).toBeUndefined();
    expect([...(again.topicAlready ?? [])].sort()).toEqual([...ids].sort());
    expect(again.topicGenerated ?? []).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(probes(), '不用生成就不探測').toBe(0);
    expect(treeHash(join(dir, 'cards'))).toBe(cardsBefore);
    expect(readFileSync(join(dir, 'state/ingested.json'), 'utf8')).toBe(stateBefore);
    for (const id of ids) expect(again.message).toContain(id);
  });

  it('只差空白或 NFC 的兩個主題算同一個', async () => {
    const scan = await loadScan();
    const dir = peach();
    const first = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: 'Café au lait', today: TODAY, levelZeroOnly: true });
    for (const variant of ['  Café au lait ', 'Café\tau   lait', '\nCafé au lait\n'.replace(' ', ' ')]) {
      const { router, calls } = topicRouter();
      const again = await scan({ outDir: dir, router, category: CAT, topic: variant, today: TODAY, levelZeroOnly: true });
      expect([...(again.topicAlready ?? [])].sort(), JSON.stringify(variant)).toEqual([...first.topicGenerated!].sort());
      expect(calls).toHaveLength(0);
    }
    expect(Object.keys(readIngested(dir)).filter((k) => k.startsWith('topic:')).length, '只有一個 topic 鍵').toBe(1);
  });

  it('不同主題各自生成(卡 id 接續、各一個 topic 鍵);同一個主題換分類也各自生成', async () => {
    const scan = await loadScan();
    const dir = makeLearning([
      { id: CAT, name: '桃子', require_raw: false },
      { id: 'pear', name: '梨子', require_raw: false },
    ]);
    const a = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: '主題甲', today: TODAY, levelZeroOnly: true });
    const b = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: '主題乙', today: TODAY, levelZeroOnly: true });
    const c = await scan({ outDir: dir, router: topicRouter().router, category: 'pear', topic: '主題甲', today: TODAY, levelZeroOnly: true });
    expect(a.topicGenerated?.length).toBe(3);
    expect(b.topicGenerated?.length).toBe(3);
    expect(c.topicGenerated?.length).toBe(3);
    expect(new Set([...a.topicGenerated!, ...b.topicGenerated!]).size, '同分類兩個主題的 id 不重複').toBe(6);
    const keys = Object.keys(readIngested(dir)).filter((k) => k.startsWith('topic:')).sort();
    expect(keys).toEqual([topicKey(CAT, '主題甲'), topicKey(CAT, '主題乙'), topicKey('pear', '主題甲')].sort());
  });
});

describe('T55 S. 先主題、後掃描:掃描不碰主題卡', () => {
  it('主題卡位元組不變、沒被標 source_missing / stale、topic: 鍵還在、掃描沒叫 LLM', async () => {
    const scan = await loadScan();
    const dir = peach();
    const first = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true });
    const ids = first.topicGenerated!;
    const before = ids.map((id) => readCard(dir, CAT, id));
    const stateBefore = readFileSync(join(dir, 'state/ingested.json'), 'utf8');
    for (const args of [{ category: CAT }, {}]) {
      const { router, calls } = topicRouter();
      const r = await scan({ outDir: dir, router, today: TODAY, levelZeroOnly: true, ...args });
      expect(r.missingSourceCards, JSON.stringify(args)).toEqual([]);
      expect(r.staleCards).toEqual([]);
      expect(r.unreadableFlags).toEqual([]);
      expect(calls).toHaveLength(0);
      ids.forEach((id, i) => expect(readCard(dir, CAT, id)).toBe(before[i]));
      expect(readFileSync(join(dir, 'state/ingested.json'), 'utf8')).toBe(stateBefore);
    }
    expect(Object.keys(readIngested(dir)).some((k) => k === topicKey(CAT, '光合作用'))).toBe(true);
  });

  it('同一個分類裡 raw 與主題並存(先有主題卡、後來才放 raw):改 raw 只標 raw 的卡;主題卡位元組不變', async () => {
    const scan = await loadScan();
    const dir = peach();
    const topicIds = (await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true })).topicGenerated!;
    writeRaw(dir, CAT, 't55-raw.md', rawText('v1'));
    const rawIds = await ingestOne(dir, CAT, 't55-raw.md', ['原一', '原二']);
    const topicBytes = topicIds.map((id) => readCard(dir, CAT, id));
    writeFileSync(join(dir, 'raw', CAT, 't55-raw.md'), rawText('v2'), 'utf8');
    const edited = await scan({ outDir: dir, router: topicRouter().router, category: CAT, today: TODAY, levelZeroOnly: true });
    expect([...edited.staleCards].sort()).toEqual([...rawIds].sort());
    expect(edited.missingSourceCards).toEqual([]);
    topicIds.forEach((id, i) => expect(readCard(dir, CAT, id)).toBe(topicBytes[i]));
  });
});

describe('T55 N. 主題正規化後的長度', () => {
  for (const [name, topic] of [['空字串', ''], ['只有空白', ' \t\n  '], ['201 個字', '字'.repeat(201)], ['201 個 code point 的表情', '😀'.repeat(201)]] as const) {
    it(`${name}:拒絕(topic_invalid)、LLM 呼叫 0、探測 0、輸出目錄前後相同`, async () => {
      const scan = await loadScan();
      const dir = peach();
      const before = treeHash(dir);
      const { router, calls, probes } = topicRouter();
      const r = await scan({ outDir: dir, router, category: CAT, topic, today: TODAY, levelZeroOnly: true });
      expect(r.refused).toBe('topic_invalid');
      expect(calls).toHaveLength(0);
      expect(probes()).toBe(0);
      expect(treeHash(dir)).toBe(before);
    });
  }

  for (const [name, topic] of [['200 個字', '字'.repeat(200)], ['200 個 code point 的表情(UTF-16 長度 400)', '😀'.repeat(200)]] as const) {
    it(`${name}:通過、照常生成`, async () => {
      const scan = await loadScan();
      const dir = peach();
      const r = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic, today: TODAY, levelZeroOnly: true });
      expect(r.refused).toBeUndefined();
      expect(r.topicGenerated?.length).toBe(3);
    });
  }

  it('長度是正規化「之後」量的:前後有很多空白、中間連續空白,併起來剛好 200 就過', async () => {
    const scan = await loadScan();
    const dir = peach();
    const topic = `   ${'字'.repeat(100)}      ${'字'.repeat(99)}   `; // 正規化後 100 + 1 + 99 = 200
    const r = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic, today: TODAY, levelZeroOnly: true });
    expect(r.refused).toBeUndefined();
    const over = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: `${'字'.repeat(100)} ${'字'.repeat(100)}`, today: TODAY, levelZeroOnly: true });
    expect(over.refused, '100 + 空白 + 100 = 201').toBe('topic_invalid');
  });
});

describe('T55 T. 記在 ingested.json、不開新檔、事件類型、原子寫入', () => {
  it('鍵是 topic:<分類>:<sha256(正規化主題)>,值 { sha256 = 鍵裡的 sha、cardIds = level 0 的 id、processedAt };raw 的鍵形狀不變', async () => {
    const scan = await loadScan();
    const dir = peach();
    const topic = '  光合作用   的基本過程 ';
    const r = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic, today: TODAY });
    const key = topicKey(CAT, normalizeTopic(topic));
    const entry = readIngested(dir)[key];
    expect(entry, `ingested.json 要有 ${key}`).toBeDefined();
    expect(entry!.sha256).toBe(topicSha(normalizeTopic(topic)));
    expect(entry!.cardIds).toEqual(r.topicGenerated);
    expect(Number.isNaN(Date.parse(entry!.processedAt))).toBe(false);
    expect(Object.keys(readIngested(dir))).toEqual([key]);
  });

  it('state/ 底下沒有新檔:跟 raw 走同一條管線產生的檔名集合一樣(沒有 topics.json 之類)', async () => {
    const scan = await loadScan();
    const dirTopic = peach();
    await scan({ outDir: dirTopic, router: topicRouter().router, category: CAT, topic: '光合作用', today: TODAY });
    const dirRaw = peach();
    writeRaw(dirRaw, CAT, 't55-raw.md', rawText('raw'));
    await scan({ outDir: dirRaw, router: topicRouter({ withLines: true }).router, category: CAT, today: TODAY });
    const topicFiles = stateFiles(dirTopic);
    expect(topicFiles.filter((f) => /topic/i.test(f)), '不准另開 topic 開頭的 state 檔').toEqual([]);
    const allowed = new Set(stateFiles(dirRaw));
    for (const f of topicFiles) expect(allowed.has(f), `state/${f} 是主題生成才有的新檔`).toBe(true);
  });

  it('事件記錄只用契約 §10 的類型;ingested.json 與卡檔經過 writeFileAtomic、事件經過 appendLineAtomic', async () => {
    const scan = await loadScan();
    const dir = peach();
    vi.mocked(atomic.writeFileAtomic).mockClear();
    vi.mocked(atomic.appendLineAtomic).mockClear();
    await scan({ outDir: dir, router: topicRouter({ cards: defaultTopicCards(6) }).router, category: CAT, topic: '光合作用', today: TODAY });
    const EVENT_TYPES = ['learned', 'reviewed', 'ingested', 'linted', 'llm_call', 'deepened', 'reteach_queued', 'reteach_viewed', 'week_rolled', 'regenerate', 'cycle_removed', 'provisional_resolved', 'warning'];
    for (const e of readLog(dir)) expect(EVENT_TYPES).toContain(e['type']);
    const written = vi.mocked(atomic.writeFileAtomic).mock.calls.map((c) => String(c[0]));
    expect(written.some((p) => p.endsWith('state/ingested.json')), 'ingested.json 走 writeFileAtomic').toBe(true);
    expect(vi.mocked(atomic.appendLineAtomic).mock.calls.length).toBeGreaterThan(0);
  });
});

describe('T55 O. 離線', () => {
  it('要生成卻探測失敗:cloudBlocked、LLM 0、不寫卡、不記主題、ingested.json 不動', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router, calls, probes } = topicRouter({ offline: true });
    const r = await scan({ outDir: dir, router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true });
    expect(r.cloudBlocked).toBe(true);
    expect(r.refused).toBeUndefined();
    expect(probes()).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(0);
    expect(cardIdsIn(dir, CAT)).toEqual([]);
    expect(Object.keys(readIngested(dir))).toEqual([]);
  });
});

describe('T55 對照:有 raw 時仍然 raw 優先(T53 不退步)', () => {
  it('分類有 raw、又給主題:照 raw 跑,沒有主題生成(topicGenerated 空)', async () => {
    const scan = await loadScan();
    const dir = peach();
    writeRaw(dir, CAT, 't55-raw.md', rawText('raw'));
    const { router, calls } = countingRouter({ 't55-raw.md': ['原一', '原二'] });
    const r = await scan({ outDir: dir, router, category: CAT, topic: '光合作用', today: TODAY, levelZeroOnly: true });
    expect(r.topicIgnored).toBe(true);
    expect(r.topicGenerated ?? []).toEqual([]);
    expect(calls.length).toBe(1);
    expect(calls[0]!.prompt).toContain('t55-raw.md');
    expect(Object.keys(readIngested(dir)).filter((k) => k.startsWith('topic:'))).toEqual([]);
  });
});
