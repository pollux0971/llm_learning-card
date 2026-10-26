/**
 * T55 補測:主題生成「前半失敗」的處理,與驗收(acceptance-T55.md)點出的覆蓋缺口。測試 agent 寫;開發 worker 不改。
 * 顧問裁(經協調者):基底 t55-impl-accept-tests ceb22e2。全部假 router,真呼叫 0、不碰金鑰、不碰真的 learning/。
 *
 * 分組(紅 = 對 ceb22e2 的現有實作會紅,要 worker 第二輪修;綠 = 補覆蓋率或守門,現有實作已綠):
 *   F 壞回應與一般錯誤 → refused 'topic_failed' + 一句說明(含錯誤訊息第一行、不印堆疊):紅
 *   R 重生呼叫(含「第 2 次重生才丟錯」)丟錯 → 同 F:紅
 *   C 雲端錯(CloudRequiredError 或 code 為 CLOUD_REQUIRED 的錯)→ 跟離線同一條(cloudBlocked + 同一句訊息):紅
 *   Z 失敗時不寫任何東西(整個輸出目錄位元組不變):紅(和 F、R、C 同一批案例,另加「先成功一次、再失敗」)
 *   P 只包第一段:GraphFileCorruptError、fs 錯誤、data-layer 驗證失敗照丟(T31 先例,bug 照丟不吞):綠(守門,防 worker 整個函式包 catch)
 *   X CLI:一般錯誤印一句、不印堆疊,退出碼 1:紅
 *   K 補覆蓋率:探測丟例外當離線;後半(子卡、考題、依賴圖)失敗只記 warning、level 0 卡留著;regenerate 事件數;ingested 事件的 cards_created;
 *     新卡旗標;today 沒給用當天:綠
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import matter from 'gray-matter';
import { describe, expect, it, vi } from 'vitest';
import { CloudRequiredError } from '@core/llm/errors.js';
import { GraphFileCorruptError } from './errors.js';
import { REPO_ROOT, loadScan, makeLearning, readCard, readLog, treeHash } from './t53-test-support.js';
import { LONG_BODY, SHORT_BODY, cardIdsIn, readIngested, topicKey, topicRouter, type TopicCard, type TopicRouter } from './t55-test-support.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

vi.mock('@core/schema/validate-card.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/validate-card.js')>();
  return { ...real, validateCard: vi.fn(real.validateCard) };
});
const validateModule = await import('@core/schema/validate-card.js');

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CAT = 'peach';
const TOPIC = '光合作用的基本過程';
const TODAY = '2026-09-10';
const peach = () => makeLearning([{ id: CAT, name: '桃子', require_raw: false }]);
const reply = (text: string): LlmResult => ({ text, provider: 'fake', model: 'scripted', latency_ms: 0, provisional: false });
const level0 = (dir: string): string[] => cardIdsIn(dir, CAT).filter((id) => matter(readCard(dir, CAT, id)).data['level'] === 0);

/** 包一層 router:hook 回 LlmResult 就用它、回 undefined 就交給底下的 router、hook 自己可以丟錯 */
function wrapped(base: TopicRouter, hook: (task: LlmTask, prompt: string, n: number) => LlmResult | undefined): { router: LlmRouter; calls: { task: LlmTask; prompt: string }[] } {
  const calls: { task: LlmTask; prompt: string }[] = [];
  let n = 0;
  const router: LlmRouter = {
    async call(task: LlmTask, prompt: string): Promise<LlmResult> {
      n += 1;
      calls.push({ task, prompt });
      return hook(task, prompt, n) ?? base.router.call(task, prompt);
    },
    probeOnline: () => base.router.probeOnline(),
    probeLocal: () => base.router.probeLocal(),
  };
  return { router, calls };
}
const isRegenerate = (task: LlmTask, prompt: string): boolean => task === 'ingest.cards' && prompt.includes('previous body:');
const isChildren = (task: LlmTask, prompt: string): boolean => task === 'ingest.cards' && prompt.includes('parent_id:');

/** 沒有任何東西被寫、位元組全不變 */
async function expectUntouched(dir: string, before: string): Promise<void> {
  expect(treeHash(dir), '失敗時輸出目錄的位元組要完全不變(cards/、ingested.json、needs-review、log 都不能多東西)').toBe(before);
  expect(readLog(dir).filter((e) => e['type'] === 'ingested')).toEqual([]);
}

function expectOneLine(message: string, firstLine: string): void {
  expect(message).toContain(firstLine);
  expect(message, '只要一句說明,不印堆疊').not.toMatch(/\n\s+at /);
}

describe('T55 F. 壞回應與一般錯誤 → topic_failed(紅:現在例外一路往外丟)', () => {
  const BAD: [string, string][] = [
    ['不是 JSON', 'not json at all'],
    ['不是陣列(物件)', '{"title":"a","body":"b"}'],
    ['不是陣列(字串)', '"一段字"'],
    ['null', 'null'],
    ['元素缺 body', '[{"title":"只有標題"}]'],
    ['元素缺 title', '[{"body":"只有內容"}]'],
    ['元素不是物件', '[42]'],
    ['title 不是字串', '[{"title":1,"body":"內容"}]'],
    ['body 不是字串', '[{"title":"好","body":["陣列"]}]'],
    ['前面都好、第二筆壞掉(整批都不收)', '[{"title":"好卡","body":"一段很短的內容。"},{"title":"壞卡"}]'],
  ];
  for (const [name, text] of BAD) {
    it(`回應${name}:refused topic_failed、一句說明、不寫任何東西、只叫一次 LLM`, async () => {
      const scan = await loadScan();
      const dir = peach();
      const before = treeHash(dir);
      const calls: LlmTask[] = [];
      const base = topicRouter();
      const { router } = wrapped(base, (task) => {
        calls.push(task);
        return task === 'ingest.cards' ? reply(text) : undefined;
      });
      const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
      expect(r.refused).toBe('topic_failed');
      expect(r.topicGenerated ?? []).toEqual([]);
      expect(r.cloudBlocked).toBeUndefined();
      expect(r.message.trim().length).toBeGreaterThan(0);
      expect(r.message, '只要一句說明,不印堆疊').not.toMatch(/\n\s+at /);
      expect(calls, '壞回應之後不再叫 LLM').toEqual(['ingest.cards']);
      await expectUntouched(dir, before);
    });
  }

  it('router.call 丟一般錯誤:refused topic_failed,說明含錯誤訊息第一行、不含堆疊;不寫任何東西', async () => {
    const scan = await loadScan();
    const dir = peach();
    const before = treeHash(dir);
    const err = new Error('連線被重設了\n    at fakeFrame (/tmp/x.js:1:1)\n    at other (/tmp/y.js:2:2)');
    const { router } = wrapped(topicRouter(), () => {
      throw err;
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.refused).toBe('topic_failed');
    expect(r.cloudBlocked).toBeUndefined();
    expectOneLine(r.message, '連線被重設了');
    expect(r.message).not.toContain('fakeFrame');
    await expectUntouched(dir, before);
  });

  it('先成功生成過一個主題、再遇到失敗:第二個主題失敗後整個目錄與失敗前位元組相同', async () => {
    const scan = await loadScan();
    const dir = peach();
    const first = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: TOPIC, today: TODAY });
    expect(first.topicGenerated?.length).toBe(3);
    const before = treeHash(dir);
    const { router } = wrapped(topicRouter(), () => {
      throw new Error('第二個主題的呼叫失敗');
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: '另一個完全不同的主題', today: TODAY });
    expect(r.refused).toBe('topic_failed');
    expect(treeHash(dir)).toBe(before);
    expect(Object.keys(readIngested(dir))).toEqual([topicKey(CAT, TOPIC)]);
  });
});

describe('T55 R. 重生呼叫丟錯 → topic_failed(紅;含「第 2 次重生才丟錯」)', () => {
  const LONG_CARDS: TopicCard[] = [
    { title: '短卡', body: SHORT_BODY, examples: [] },
    { title: '長卡', body: LONG_BODY, examples: [] },
  ];

  it('第 1 次重生呼叫就丟錯:topic_failed,說明含錯誤第一行,不寫任何東西(連前面那張短卡也不寫)', async () => {
    const scan = await loadScan();
    const dir = peach();
    const before = treeHash(dir);
    const { router, calls } = wrapped(topicRouter({ cards: LONG_CARDS }), (task, prompt) => {
      if (isRegenerate(task, prompt)) throw new Error('重生第一次就斷線\n    at x (y.js:1:1)');
      return undefined;
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.refused).toBe('topic_failed');
    expectOneLine(r.message, '重生第一次就斷線');
    expect(calls.filter((c) => isRegenerate(c.task, c.prompt)).length).toBe(1);
    await expectUntouched(dir, before);
  });

  it('第 2 次重生呼叫才丟錯(第 1 次回的還是太長):topic_failed,不寫任何東西', async () => {
    const scan = await loadScan();
    const dir = peach();
    const before = treeHash(dir);
    let regenerations = 0;
    const { router, calls } = wrapped(topicRouter({ cards: LONG_CARDS, regenerateBodies: [LONG_BODY] }), (task, prompt) => {
      if (isRegenerate(task, prompt)) {
        regenerations += 1;
        if (regenerations === 2) throw new Error('重生第二次才斷線');
      }
      return undefined;
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(regenerations, '前提:真的叫到第 2 次重生').toBe(2);
    expect(r.refused).toBe('topic_failed');
    expectOneLine(r.message, '重生第二次才斷線');
    expect(calls.some((c) => c.task === 'ingest.questions'), '前半失敗就不跑後半').toBe(false);
    await expectUntouched(dir, before);
  });

  it('重生回的不是合法 JSON:topic_failed,不寫任何東西', async () => {
    const scan = await loadScan();
    const dir = peach();
    const before = treeHash(dir);
    const { router } = wrapped(topicRouter({ cards: LONG_CARDS }), (task, prompt) => (isRegenerate(task, prompt) ? reply('重生回了一段不是 JSON 的話') : undefined));
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.refused).toBe('topic_failed');
    expect(r.message).not.toMatch(/\n\s+at /);
    await expectUntouched(dir, before);
  });
});

describe('T55 C. 雲端錯 → 跟離線同一條(紅:現在例外一路往外丟)', () => {
  const cloudErrors: [string, () => Error][] = [
    ['CloudRequiredError', () => new CloudRequiredError('ingest.cards')],
    ['code 是 CLOUD_REQUIRED 的錯(跟 raw 管線 ingest.ts 一樣看 code,不看 class)', () => Object.assign(new Error('另一個 class 的雲端錯'), { code: 'CLOUD_REQUIRED' })],
  ];
  async function offlineReference(): Promise<{ message: string; cloudBlocked: boolean | undefined; refused: string | undefined }> {
    const scan = await loadScan();
    const dir = peach();
    const r = await scan({ outDir: dir, router: topicRouter({ offline: true }).router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.cloudBlocked, '前提:離線那條本來就是 cloudBlocked').toBe(true);
    return { message: r.message, cloudBlocked: r.cloudBlocked, refused: r.refused };
  }

  for (const [name, make] of cloudErrors) {
    it(`第一次 router.call 丟 ${name}:cloudBlocked、訊息與離線相同、沒有 refused、不寫任何東西`, async () => {
      const scan = await loadScan();
      const ref = await offlineReference();
      const dir = peach();
      const before = treeHash(dir);
      const { router } = wrapped(topicRouter(), () => {
        throw make();
      });
      const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
      expect(r.cloudBlocked).toBe(true);
      expect(r.refused, '雲端錯不是 topic_failed').toBeUndefined();
      expect(r.message).toBe(ref.message);
      expect(r.topicGenerated ?? []).toEqual([]);
      await expectUntouched(dir, before);
    });

    it(`重生呼叫丟 ${name}:一樣 cloudBlocked、訊息與離線相同、不寫任何東西`, async () => {
      const scan = await loadScan();
      const ref = await offlineReference();
      const dir = peach();
      const before = treeHash(dir);
      const { router } = wrapped(topicRouter({ cards: [{ title: '長卡', body: LONG_BODY, examples: [] }] }), (task, prompt) => {
        if (isRegenerate(task, prompt)) throw make();
        return undefined;
      });
      const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
      expect(r.cloudBlocked).toBe(true);
      expect(r.refused).toBeUndefined();
      expect(r.message).toBe(ref.message);
      await expectUntouched(dir, before);
    });
  }
});

describe('T55 P. 只包第一段:bug 照丟、不吞(綠;防止整個函式包 catch)', () => {
  it('依賴圖檔壞掉(graph/deps.json 不是 JSON、又有清不掉的環)→ GraphFileCorruptError 往外丟,壞檔位元組不動', async () => {
    const scan = await loadScan();
    const dir = peach();
    mkdirSync(join(dir, 'graph'), { recursive: true });
    const corrupt = '{這不是 JSON';
    writeFileSync(join(dir, 'graph/deps.json'), corrupt, 'utf8');
    // 壞檔只有在「殘留環」要清掉舊圖時才會被讀:讓依賴圖回一個丟再多邊也清不掉的環(每一對卡互指)。
    const { router } = wrapped(topicRouter(), (task, prompt) => {
      if (task !== 'ingest.deps') return undefined;
      const ids = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1]!);
      const edges = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b]));
      return reply(JSON.stringify({ edges }));
    });
    await expect(scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY })).rejects.toBeInstanceOf(GraphFileCorruptError);
    expect(readFileSync(join(dir, 'graph/deps.json'), 'utf8')).toBe(corrupt);
    expect(level0(dir).length, '丟錯之前 level 0 卡已經寫好、不回滾').toBe(3);
  });

  it('寫卡時 fs 錯誤(cards/<分類> 是一個檔案)→ 照丟,不變成 topic_failed', async () => {
    const scan = await loadScan();
    const dir = peach();
    mkdirSync(join(dir, 'cards'), { recursive: true });
    writeFileSync(join(dir, 'cards', CAT), '我是檔案不是資料夾', 'utf8');
    await expect(scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: TOPIC, today: TODAY })).rejects.toThrow();
    expect(existsSync(join(dir, 'state/ingested.json')), '卡沒寫成就不記主題').toBe(false);
  });

  it('剛寫入的卡沒通過 data-layer 驗證 → 照丟,不變成 topic_failed', async () => {
    const scan = await loadScan();
    const dir = peach();
    vi.mocked(validateModule.validateCard).mockReturnValueOnce({ ok: false, errors: ['假的驗證失敗'] } as ReturnType<typeof validateModule.validateCard>);
    await expect(scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: TOPIC, today: TODAY })).rejects.toThrow(/假的驗證失敗/);
  });
});

describe('T55 X. CLI:一般錯誤印一句、不印堆疊(紅)', () => {
  it('--fake 沒有預錄回應(= router.call 丟一般錯誤):退出碼 1、印出錯誤第一行、沒有堆疊、輸出目錄不變', () => {
    const dir = peach();
    const before = treeHash(dir);
    const { NODE_OPTIONS: _ignored, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'scripts/ingest.ts'), '--fake', '--out', dir, '--category', CAT, '--topic', TOPIC], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
      timeout: 120_000,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(r.status, out).toBe(1);
    expect(out).toContain('FakeLlmRouter: 沒有預錄回應符合 task=ingest.cards');
    expect(out, '不印堆疊').not.toMatch(/\n\s+at /);
    expect(treeHash(dir)).toBe(before);
  });
});

describe('T55 K. 補覆蓋率(綠)', () => {
  it('探測丟例外 → 當離線:cloudBlocked、LLM 呼叫 0、不寫任何東西', async () => {
    const scan = await loadScan();
    const dir = peach();
    const before = treeHash(dir);
    const base = topicRouter();
    const calls: LlmTask[] = [];
    const router: LlmRouter = {
      async call(task: LlmTask, prompt: string): Promise<LlmResult> {
        calls.push(task);
        return base.router.call(task, prompt);
      },
      async probeOnline(): Promise<boolean> {
        throw new Error('探測自己壞掉了');
      },
      probeLocal: () => base.router.probeLocal(),
    };
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.cloudBlocked).toBe(true);
    expect(r.refused).toBeUndefined();
    expect(calls, '探測壞了就當離線,不叫 LLM').toEqual([]);
    await expectUntouched(dir, before);
  });

  it('子卡產生失敗:不中斷,記一筆 warning(file 是主題鍵、含錯誤訊息),level 0 卡與記錄都留著', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router } = wrapped(topicRouter(), (task, prompt) => {
      if (isChildren(task, prompt)) throw new Error('子卡呼叫壞了');
      return undefined;
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.refused).toBeUndefined();
    expect(r.topicGenerated?.length).toBe(3);
    expect(level0(dir).sort()).toEqual([...r.topicGenerated!].sort());
    expect(readIngested(dir)[topicKey(CAT, TOPIC)]?.cardIds).toEqual(r.topicGenerated);
    const warnings = readLog(dir).filter((e) => e['type'] === 'warning' && String(e['message']).includes('子卡呼叫壞了'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]!['file']).toBe(topicKey(CAT, TOPIC));
  });

  it('考題產生失敗:每張卡各記一筆 warning(file 是主題鍵、含卡 id 與錯誤訊息),卡留著、不中斷', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router } = wrapped(topicRouter({ childCount: 0 }), (task) => {
      if (task === 'ingest.questions') throw new Error('考題呼叫壞了');
      return undefined;
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.refused).toBeUndefined();
    expect(r.topicGenerated?.length).toBe(3);
    const warnings = readLog(dir).filter((e) => e['type'] === 'warning' && String(e['message']).includes('考題呼叫壞了'));
    for (const id of r.topicGenerated!) {
      const mine = warnings.filter((e) => String(e['message']).includes(id));
      expect(mine.length, `卡 ${id} 的考題失敗要記一筆`).toBe(1);
      expect(mine[0]!['file']).toBe(topicKey(CAT, TOPIC));
    }
    expect(level0(dir).length).toBe(3);
  });

  it('依賴圖分析失敗(一般錯誤):不中斷,記一筆 warning(file 是主題鍵、含錯誤訊息),卡留著', async () => {
    const scan = await loadScan();
    const dir = peach();
    const { router } = wrapped(topicRouter(), (task) => {
      if (task === 'ingest.deps') throw new Error('依賴圖呼叫壞了');
      return undefined;
    });
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY });
    expect(r.refused).toBeUndefined();
    expect(r.topicGenerated?.length).toBe(3);
    const warnings = readLog(dir).filter((e) => e['type'] === 'warning' && String(e['message']).includes('依賴圖呼叫壞了'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]!['file']).toBe(topicKey(CAT, TOPIC));
    expect(level0(dir).length).toBe(3);
  });

  it('重生事件數 = 有重生且收下的卡數;ingested 事件的 cards_created = 寫出的卡數(暫緩的不算)', async () => {
    const scan = await loadScan();
    const dir = peach();
    const cards: TopicCard[] = [
      { title: '可修一', body: LONG_BODY, examples: [] },
      { title: '可修二', body: LONG_BODY, examples: [] },
      { title: '壞卡', body: LONG_BODY, examples: [] },
      { title: '短卡', body: SHORT_BODY, examples: [] },
    ];
    const { router } = wrapped(topicRouter({ cards, childCount: 0 }), (task, prompt) => (isRegenerate(task, prompt) && prompt.includes('title: 壞卡') ? reply(JSON.stringify([{ body: LONG_BODY }])) : undefined));
    const r = await scan({ outDir: dir, router, category: CAT, topic: TOPIC, today: TODAY, levelZeroOnly: true });
    expect(r.topicGenerated?.length, '可修一、可修二、短卡 = 3 張;壞卡暫緩').toBe(3);
    const key = topicKey(CAT, TOPIC);
    const log = readLog(dir);
    expect(log.filter((e) => e['type'] === 'regenerate').map((e) => e['file'])).toEqual([key, key]);
    const ingested = log.filter((e) => e['type'] === 'ingested');
    expect(ingested.length).toBe(1);
    expect(ingested[0]!['file']).toBe(key);
    expect(ingested[0]!['cards_created']).toBe(3);
    const parked = JSON.parse(readFileSync(join(dir, 'state/needs-review.json'), 'utf8')) as { title: string; source: string; reason: string }[];
    expect(parked.map((p) => p.title)).toEqual(['壞卡']);
  });

  it('沒有卡被重生時,沒有 regenerate 事件', async () => {
    const scan = await loadScan();
    const dir = peach();
    await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: TOPIC, today: TODAY, levelZeroOnly: true });
    expect(readLog(dir).filter((e) => e['type'] === 'regenerate')).toEqual([]);
  });

  it('新卡的旗標:provisional、stale、source_missing 都是 false', async () => {
    const scan = await loadScan();
    const dir = peach();
    const r = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: TOPIC, today: TODAY, levelZeroOnly: true });
    expect(r.topicGenerated?.length).toBe(3);
    for (const id of r.topicGenerated!) {
      const fm = matter(readCard(dir, CAT, id)).data as Record<string, unknown>;
      for (const flag of ['provisional', 'stale', 'source_missing']) {
        expect(fm[flag] ?? false, `${id} 的 ${flag}`).toBe(false);
      }
    }
  });

  it('today 沒給:created 是當天日期(YYYY-MM-DD,不是完整時間戳)', async () => {
    const scan = await loadScan();
    const dir = peach();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-03-04T12:00:00Z'));
      const r = await scan({ outDir: dir, router: topicRouter().router, category: CAT, topic: TOPIC, levelZeroOnly: true });
      expect(r.topicGenerated?.length).toBe(3);
      for (const id of r.topicGenerated!) {
        const created = matter(readCard(dir, CAT, id)).data['created'];
        expect(created instanceof Date ? created.toISOString().slice(0, 10) : String(created)).toBe('2026-03-04');
        expect(readCard(dir, CAT, id)).toMatch(/created: ['"]?2026-03-04['"]?\s*\n/);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
