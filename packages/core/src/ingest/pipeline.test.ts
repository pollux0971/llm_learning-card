/**
 * runIngestPipeline() 的整合測試(見 ingest.ts 裡它上面的大段設計註解)。
 * 涵蓋 docs/integration/i1-content-pipeline.feature 的 pipeline 層級場景:
 *   1. 產生卡片後接著產生考題、子卡、依賴圖(整條管線串起來)
 *   2. 離線時整個 ingest 拒絕而不是降級(不寫任何卡片)
 *   3. 重跑 ingest 對同一個檔案不重複處理,也不再呼叫 LLM
 *   4. 單卡生成失敗不影響其他卡
 *   5. 子卡整批生成失敗、依賴圖整批分析失敗:各自吞掉錯誤、記警告,不拖垮已完成的步驟
 *   6. 省略 category/today 時的預設值推導
 *
 * 不打真的 API——router 一律是這裡注入的假 router,行為對齊
 * features/steps/ingest-pipeline.steps.ts 的 buildResponseText() 寫法。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { runIngestPipeline } from './ingest.js';
import { ensureInitialized } from './init.js';
import { readLogEvents } from './state.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';
import { CloudRequiredError as RealCloudRequiredError } from '../llm/errors.js';

const CATEGORY = 'security';
const RAW_REL_PATH = `raw/${CATEGORY}/web-basics.md`;

// ---------------------------------------------------------------- 小工具

function levelZeroCandidatesJson(count: number): string {
  const cards = Array.from({ length: count }, (_, i) => ({
    title: `第 ${i + 1} 個概念`,
    body: `這是第 ${i + 1} 張卡的正文內容,描述同源政策的其中一個面向。`,
    examples: [],
    lines: [i * 2 + 1, i * 2 + 2],
  }));
  return JSON.stringify(cards);
}

function childCandidatesJson(count: number): string {
  const children = Array.from({ length: count }, (_, i) => ({
    title: `子概念 ${i + 1}`,
    body: `子概念 ${i + 1} 的細節說明,展開自父卡的其中一個面向。`,
    examples: [],
  }));
  return JSON.stringify(children);
}

function questionCandidateJson(): string {
  return JSON.stringify({
    fill: [
      { prompt: '同源的判定條件是 ___、___、___ 三者相同。', answers: [['協定'], ['主機'], ['埠號']] },
      { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否']] },
    ],
    apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }],
  });
}

function depsEdgesJsonFromPrompt(prompt: string): string {
  const ids = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1]!);
  const edges: [string, string][] = [];
  for (let i = 0; i + 1 < ids.length; i++) edges.push([ids[i]!, ids[i + 1]!]);
  return JSON.stringify({ edges });
}

interface ScriptedRouterOptions {
  levelZeroCount?: number;
  childCountPerParent?: number;
  /** 這些 card id 的 'ingest.questions' 呼叫會丟錯,模擬單卡生成失敗。 */
  questionsFailForCardIds?: string[];
  /** 讓 'ingest.cards' 的子卡回應筆數不合法(0 筆),模擬整批子卡生成失敗。 */
  childrenBatchFails?: boolean;
  /** 讓 'ingest.deps' 回應缺少 edges 陣列,模擬整批依賴圖分析失敗。 */
  depsBatchFails?: boolean;
  onlineOverride?: boolean;
  /** call() 被呼叫時記錄下來,用於斷言呼叫次數 / 從未被呼叫。 */
  onCall?: (task: LlmTask, prompt: string) => void;
}

function scriptedRouter(opts: ScriptedRouterOptions = {}): LlmRouter {
  const levelZeroCount = opts.levelZeroCount ?? 3;
  const childCountPerParent = opts.childCountPerParent ?? 2;
  const failIds = new Set(opts.questionsFailForCardIds ?? []);

  return {
    async call(task: LlmTask, prompt: string): Promise<LlmResult> {
      opts.onCall?.(task, prompt);

      if (task === 'ingest.cards') {
        if (prompt.includes('parent_id:')) {
          const text = opts.childrenBatchFails ? childCandidatesJson(0) : childCandidatesJson(childCountPerParent);
          return { text, provider: 'fake', model: 'scripted', latency_ms: 0, provisional: false };
        }
        return {
          text: levelZeroCandidatesJson(levelZeroCount),
          provider: 'fake',
          model: 'scripted',
          latency_ms: 0,
          provisional: false,
        };
      }
      if (task === 'ingest.questions') {
        const m = /card:\s*(\S+)/.exec(prompt);
        const cardId = m?.[1];
        if (cardId && failIds.has(cardId)) {
          throw new Error(`模擬 ${cardId} 的考題生成失敗`);
        }
        return { text: questionCandidateJson(), provider: 'fake', model: 'scripted', latency_ms: 0, provisional: false };
      }
      if (task === 'ingest.deps') {
        const text = opts.depsBatchFails ? JSON.stringify({ notEdges: [] }) : depsEdgesJsonFromPrompt(prompt);
        return { text, provider: 'fake', model: 'scripted', latency_ms: 0, provisional: false };
      }
      throw new Error(`scriptedRouter 沒有預期到 task=${task}`);
    },
    async probeOnline() {
      return opts.onlineOverride ?? true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function offlineRouter(): LlmRouter {
  return {
    async call(task: LlmTask) {
      // 真的 03-llm-router 離線時丟的是 @core/llm/errors.js 的 CloudRequiredError,
      // 跟 fake-llm.ts 的同名 class 不是同一個 —— 這裡刻意用真的那個,把
      // instanceof 撞名的 bug 攤出來(見 ingest.ts 的設計註解)。
      throw new RealCloudRequiredError(task);
    },
    async probeOnline() {
      return false;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-pipeline-'));
  ensureInitialized(dir);
  mkdirSync(join(dir, 'raw', CATEGORY), { recursive: true });
  writeFileSync(join(dir, RAW_REL_PATH), '一些原始內容\n'.repeat(20), 'utf8');
  return dir;
}

function listCardIds(dir: string): string[] {
  const cardsDir = join(dir, 'cards', CATEGORY);
  if (!existsSync(cardsDir)) return [];
  return readdirSync(cardsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

describe('runIngestPipeline', () => {
  let dir: string;

  beforeEach(() => {
    dir = setup();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('串起整條管線:level 0 卡 → 考題 → 子卡 → 子卡考題 → 依賴圖', async () => {
    const router = scriptedRouter({ levelZeroCount: 3, childCountPerParent: 2 });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: RAW_REL_PATH, category: CATEGORY, router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(3);
    expect(result.questionFailures).toEqual([]);
    expect(result.childrenCreated).toHaveLength(3 * 2);
    expect(result.childQuestionFailures).toEqual([]);
    expect(result.edgesRemoved).toEqual([]);
    expect(result.cycleUnresolved).toBeNull();

    const allIds = listCardIds(dir);
    expect(allIds).toHaveLength(3 + 3 * 2);

    // 每張卡(level 0 + 子卡)都要有自己的考題檔。
    for (const id of allIds) {
      expect(existsSync(join(dir, 'questions', `${id}.yaml`)), `缺少 ${id} 的考題檔`).toBe(true);
    }

    // 依賴排序涵蓋每一張卡,且圖檔真的寫到 graph/deps.json 的 security 分類。
    expect(result.depsOrder.sort()).toEqual(allIds.sort());
    const depsJson = JSON.parse(readFileSync(join(dir, 'graph', 'deps.json'), 'utf8'));
    expect(depsJson.security.nodes.sort()).toEqual(allIds.sort());

    const orderFile = JSON.parse(readFileSync(join(dir, 'graph', 'order-security.json'), 'utf8'));
    expect([...orderFile].sort()).toEqual(allIds.sort());

    // 每個 level 1 子卡都以父卡當先備。
    for (const id of allIds) {
      const fm = yamlParse(readFileSync(join(dir, 'cards', CATEGORY, `${id}.md`), 'utf8').split('---')[1]!);
      if (fm.level === 1) {
        expect(fm.prereqs).toContain(fm.parent);
      }
    }
  });

  it('離線時整個 ingest 拒絕,不寫任何卡片(真的 @core/llm CloudRequiredError,不是 fake-llm 的那個)', async () => {
    const router = offlineRouter();
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: RAW_REL_PATH, category: CATEGORY, router });

    expect(result.ok).toBe(false);
    expect(result.cardsCreated).toHaveLength(0);
    expect(result.childrenCreated).toHaveLength(0);
    expect(result.message).toMatch(/雲端|cloud/i);
    expect(listCardIds(dir)).toHaveLength(0);
    expect(existsSync(join(dir, 'questions'))).toBe(true);
    expect(readdirSync(join(dir, 'questions'))).toHaveLength(0);
    // 完全沒進 phase-2 三步,emptyPipelineResult() 給的空值原樣回傳。
    expect(result.questionFailures).toEqual([]);
    expect(result.childQuestionFailures).toEqual([]);
    expect(result.depsOrder).toEqual([]);
    expect(result.edgesRemoved).toEqual([]);
    expect(result.cycleUnresolved).toBeNull();
  });

  it('重跑同一個檔案:card 數不變,也不再呼叫 LLM(含 phase-2 三步)', async () => {
    const first = await runIngestPipeline({
      outDir: dir,
      rawRelPath: RAW_REL_PATH,
      category: CATEGORY,
      router: scriptedRouter({ levelZeroCount: 3, childCountPerParent: 1 }),
    });
    expect(first.ok).toBe(true);
    const countAfterFirst = listCardIds(dir).length;

    let calls = 0;
    const second = await runIngestPipeline({
      outDir: dir,
      rawRelPath: RAW_REL_PATH,
      category: CATEGORY,
      router: scriptedRouter({ onCall: () => (calls += 1) }),
    });

    expect(second.alreadyProcessed).toBe(true);
    expect(listCardIds(dir)).toHaveLength(countAfterFirst);
    expect(calls).toBe(0);
    // 走 emptyPipelineResult() 那條路,phase-2 欄位是空值,不是重算出來的。
    expect(second.questionFailures).toEqual([]);
    expect(second.childrenCreated).toEqual([]);
    expect(second.childQuestionFailures).toEqual([]);
    expect(second.depsOrder).toEqual([]);
    expect(second.edgesRemoved).toEqual([]);
    expect(second.cycleUnresolved).toBeNull();
  });

  it('單卡生成失敗不影響其他卡:一張 level 0 卡的考題生成失敗,其餘照常完成', async () => {
    // 先跑一次拿到真正的 card id(id 配發規則不是這份測試的職責),
    // 再針對第一張卡重跑整個流程並讓它的考題生成失敗。
    const probe = await runIngestPipeline({
      outDir: dir,
      rawRelPath: RAW_REL_PATH,
      category: CATEGORY,
      router: scriptedRouter({ levelZeroCount: 3 }),
    });
    expect(probe.ok).toBe(true);
    const failingCardId = probe.cardsCreated[0]!;
    rmSync(dir, { recursive: true, force: true });
    dir = setup();

    const router = scriptedRouter({ levelZeroCount: 3, childCountPerParent: 1, questionsFailForCardIds: [failingCardId] });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: RAW_REL_PATH, category: CATEGORY, router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(3);
    expect(result.questionFailures).toHaveLength(1);
    expect(result.questionFailures[0]!.card).toBe(failingCardId);

    // 失敗的那張卡沒有考題檔,其他兩張都有。
    expect(existsSync(join(dir, 'questions', `${failingCardId}.yaml`))).toBe(false);
    const otherIds = result.cardsCreated.filter((id) => id !== failingCardId);
    for (const id of otherIds) {
      expect(existsSync(join(dir, 'questions', `${id}.yaml`))).toBe(true);
    }

    // 子卡與依賴圖仍然照常產生 —— 一張卡的考題失敗不拖垮後面的步驟。
    expect(result.childrenCreated.length).toBeGreaterThan(0);
    expect(result.depsOrder.length).toBeGreaterThan(0);
  });

  it('整批子卡生成失敗:記警告後略過,level 0 卡與考題仍照常完成,依賴圖只涵蓋 level 0 卡', async () => {
    const router = scriptedRouter({ levelZeroCount: 3, childrenBatchFails: true });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: RAW_REL_PATH, category: CATEGORY, router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(3);
    expect(result.questionFailures).toEqual([]);
    expect(result.childrenCreated).toEqual([]);
    expect(result.childQuestionFailures).toEqual([]);
    // deps 步驟拿到的是「level0 + children」,children 是空陣列時應該只跑 level0。
    expect(result.depsOrder.sort()).toEqual([...result.cardsCreated].sort());

    const events = readLogEvents(join(dir, 'state/log.jsonl'));
    const warning = events.find((e) => e.type === 'warning' && typeof e.message === 'string' && (e.message as string).includes('子卡產生失敗'));
    expect(warning, JSON.stringify(events)).toBeTruthy();
  });

  it('整批依賴圖分析失敗:記警告後略過,level 0 卡、考題、子卡仍照常完成,depsOrder 與 cycleRemoved 給空值', async () => {
    const router = scriptedRouter({ levelZeroCount: 2, childCountPerParent: 1, depsBatchFails: true });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: RAW_REL_PATH, category: CATEGORY, router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(2);
    expect(result.childrenCreated).toHaveLength(2);
    expect(result.depsOrder).toEqual([]);
    expect(result.edgesRemoved).toEqual([]);
    expect(result.cycleUnresolved).toBeNull();

    const events = readLogEvents(join(dir, 'state/log.jsonl'));
    const warning = events.find((e) => e.type === 'warning' && typeof e.message === 'string' && (e.message as string).includes('依賴圖分析失敗'));
    expect(warning, JSON.stringify(events)).toBeTruthy();
  });

  it('省略 category/today:從 rawRelPath 推導分類,today 用系統日期,行為與明確傳入時一致', async () => {
    const router = scriptedRouter({ levelZeroCount: 2, childCountPerParent: 1 });
    // 不傳 category / today —— runIngestPipeline() 內部得自己用 inferCategory() 與
    // new Date() 重新推導一次,不能只靠 runIngest() 內部算過的值。
    const result = await runIngestPipeline({ outDir: dir, rawRelPath: RAW_REL_PATH, router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(2);
    expect(result.childrenCreated).toHaveLength(2);
    expect(result.depsOrder.sort()).toEqual([...result.cardsCreated, ...result.childrenCreated].sort());

    const todayStr = new Date().toISOString().slice(0, 10);
    for (const id of result.childrenCreated) {
      const fm = yamlParse(readFileSync(join(dir, 'cards', CATEGORY, `${id}.md`), 'utf8').split('---')[1]!);
      expect(fm.category).toBe(CATEGORY);
      expect(fm.created).toBe(todayStr);
    }
  });

  it('省略 category,rawRelPath 推導出的分類跟預設值 "security" 不同:runIngestPipeline() 自己用同一個分類跑完 phase-2 三步,不是退回預設', async () => {
    const otherCategory = 'other-cat';
    const rawRelPath = `raw/${otherCategory}/other.md`;
    mkdirSync(join(dir, 'raw', otherCategory), { recursive: true });
    writeFileSync(join(dir, rawRelPath), '一些原始內容\n'.repeat(20), 'utf8');

    const router = scriptedRouter({ levelZeroCount: 2, childCountPerParent: 1 });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath, router });

    expect(result.ok).toBe(true);
    expect(result.cardsCreated).toHaveLength(2);
    expect(result.childrenCreated).toHaveLength(2);
    // 子卡與依賴圖真的用 other-cat 分類跑完,不是靜靜退回 'security'。
    for (const id of [...result.cardsCreated, ...result.childrenCreated]) {
      expect(existsSync(join(dir, 'cards', otherCategory, `${id}.md`)), `${id} 應該在 cards/${otherCategory}/`).toBe(true);
    }
    const depsJson = JSON.parse(readFileSync(join(dir, 'graph', 'deps.json'), 'utf8'));
    expect(depsJson[otherCategory]).toBeDefined();
    expect(existsSync(join(dir, 'graph', `order-${otherCategory}.json`))).toBe(true);
  });

  it('省略 category,rawRelPath 不是 3 段式(inferCategory() 判斷不出來):runIngestPipeline() 內部也退回預設 security,跟 runIngest() 一致', async () => {
    const rawRelPath = 'raw/flat.md';
    writeFileSync(join(dir, rawRelPath), '一些原始內容\n'.repeat(20), 'utf8');

    const router = scriptedRouter({ levelZeroCount: 2, childCountPerParent: 1 });
    const result = await runIngestPipeline({ outDir: dir, rawRelPath, router });

    expect(result.ok).toBe(true);
    for (const id of [...result.cardsCreated, ...result.childrenCreated]) {
      expect(existsSync(join(dir, 'cards', CATEGORY, `${id}.md`)), `${id} 應該在 cards/${CATEGORY}/(預設分類)`).toBe(true);
    }
    const depsJson = JSON.parse(readFileSync(join(dir, 'graph', 'deps.json'), 'utf8'));
    expect(depsJson[CATEGORY]).toBeDefined();
  });
});
