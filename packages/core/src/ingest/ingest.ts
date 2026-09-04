/** 主流程:raw → level 0 卡片。單一 raw 檔的一次 ingest 呼叫。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import type { CardFrontmatter, CardId, LlmRouter } from './types.js';
import { generateCards, type CardCandidate, type ParkedCandidate } from './generate-cards.js';
import { nextCardIds } from './ids.js';
import { ensureInitialized } from './init.js';
import { atomicWriteJson, readJsonOr, appendLogEvent } from './state.js';
import type { Card } from '@contracts/index.js';
import { validateCard } from '@core/schema/validate-card.js';
import { generateQuestionsForCards, type GenerateQuestionsFailure } from './questions.js';
import { generateChildrenForCards } from './children.js';
import { analyzeDependencies } from './deps.js';
import type { LlmRouter as CoreLlmRouter } from '@core/llm/index.js';

export interface RunIngestOptions {
  /** learning 根目錄(絕對路徑)。 */
  outDir: string;
  /** raw 檔相對於 outDir 的路徑,例如 "raw/security/web-basics.md"。 */
  rawRelPath: string;
  category?: string;
  router: LlmRouter;
  /** 覆蓋「今天」,格式 YYYY-MM-DD。預設用目前系統日期。 */
  today?: string;
}

export interface RunIngestResult {
  ok: boolean;
  exitCode: number;
  message: string;
  cardsCreated: CardId[];
  alreadyProcessed: boolean;
  parkedCount: number;
  regenerateEvents: number;
}

interface IngestedState {
  [rawRelPath: string]: { sha256: string; cardIds: CardId[]; processedAt: string };
}

export async function runIngest(opts: RunIngestOptions): Promise<RunIngestResult> {
  ensureInitialized(opts.outDir);
  const category = opts.category ?? inferCategory(opts.rawRelPath) ?? 'security';
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const rawPath = join(opts.outDir, opts.rawRelPath);

  if (!existsSync(rawPath)) {
    return fail(`raw 檔案不存在:${opts.rawRelPath}`, 1);
  }
  const raw = readFileSync(rawPath, 'utf8');
  if (raw.trim().length === 0) {
    return fail('raw 檔案沒有可用內容(空白)', 1);
  }

  const statePath = join(opts.outDir, 'state/ingested.json');
  const state = readJsonOr<IngestedState>(statePath, {});
  const existing = state[opts.rawRelPath];
  if (existing) {
    return {
      ok: true,
      exitCode: 0,
      alreadyProcessed: true,
      parkedCount: 0,
      regenerateEvents: 0,
      cardsCreated: existing.cardIds,
      message: `${opts.rawRelPath} 已經處理過,略過(已產生 ${existing.cardIds.length} 張卡)`,
    };
  }

  const basename = opts.rawRelPath.split('/').pop()!;
  const t0 = Date.now();

  let generated: { accepted: CardCandidate[]; parked: ParkedCandidate[]; regenerateEvents: number };
  try {
    generated = await generateCards(opts.router, { relLabel: basename, category, content: raw });
  } catch (err) {
    if (isCloudRequiredError(err)) {
      return fail('ingest 需要雲端模型,目前無法使用雲端,不會降級到本機模型', 1);
    }
    throw err;
  }

  const cardsDir = join(opts.outDir, 'cards', category);
  // Stryker disable next-line all: recursive:true 只在 category 本身含路徑分隔符時才有差異
  // (契約的 category id 是單一識別字,不會發生)——ensureInitialized() 保證 outDir/cards 已存在,
  // 拿掉 recursive 或改 false 在目前骨架下行為不變,測不出差異不代表邏輯錯。
  mkdirSync(cardsDir, { recursive: true });
  const totalLines = raw.split('\n').length;

  const ids = nextCardIds(cardsDir, category, generated.accepted.length);
  const cardsCreated: CardId[] = [];
  ids.forEach((id, i) => {
    const candidate = generated.accepted[i]!;
    const [start, end] = clampLines(candidate.lines, totalLines);
    const frontmatter: CardFrontmatter = {
      id,
      category,
      title: candidate.title,
      level: 0,
      source: 'raw',
      source_ref: `raw/${category}/${basename}#L${start}-L${end}`,
      created: today,
      prereqs: [],
    };
    writeCardFile(cardsDir, id, frontmatter, candidate.body, candidate.examples);
    cardsCreated.push(id);
  });

  if (generated.parked.length > 0) {
    const needsReviewPath = join(opts.outDir, 'state/needs-review.json');
    const existingParked = readJsonOr<unknown[]>(needsReviewPath, []);
    const entries = generated.parked.map((p) => ({
      category,
      title: p.title,
      source: opts.rawRelPath,
      lines: p.lines,
      reason: 'body_over_limit',
      attempts: p.attempts,
      recordedAt: new Date().toISOString(),
    }));
    atomicWriteJson(needsReviewPath, [...existingParked, ...entries]);
    appendLogEvent(join(opts.outDir, 'state/log.jsonl'), {
      ts: new Date().toISOString(),
      type: 'warning',
      file: opts.rawRelPath,
      message: `${generated.parked.length} 張卡因字數超過上限被暫緩,見 needs-review.json`,
    });
  }

  state[opts.rawRelPath] = { sha256: sha256Of(raw), cardIds: cardsCreated, processedAt: new Date().toISOString() };
  atomicWriteJson(statePath, state);

  const durationMs = Date.now() - t0;
  appendLogEvent(join(opts.outDir, 'state/log.jsonl'), {
    ts: new Date().toISOString(),
    type: 'ingested',
    file: opts.rawRelPath,
    cards_created: cardsCreated.length,
    duration_ms: durationMs,
  });

  for (let i = 0; i < generated.regenerateEvents; i++) {
    appendLogEvent(join(opts.outDir, 'state/log.jsonl'), {
      ts: new Date().toISOString(),
      type: 'regenerate',
      file: opts.rawRelPath,
    });
  }

  return {
    ok: true,
    exitCode: 0,
    alreadyProcessed: false,
    cardsCreated,
    parkedCount: generated.parked.length,
    regenerateEvents: generated.regenerateEvents,
    message: `建立了 ${cardsCreated.length} 張卡`,
  };
}

/**
 * fake-llm.ts 與 @core/llm/errors.js 過去各自定義一個 CloudRequiredError class,
 * instanceof 互相認不出對方(兩邊已經統一成同一個 class,見 fake-llm.ts)。改成
 * 看契約 §7 路由表共用的 code 值,不管未來還有沒有第三個地方冒出新的 class。
 */
function isCloudRequiredError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'CLOUD_REQUIRED';
}

function fail(message: string, exitCode: number): RunIngestResult {
  return {
    ok: false,
    exitCode,
    message,
    cardsCreated: [],
    alreadyProcessed: false,
    parkedCount: 0,
    regenerateEvents: 0,
  };
}

function inferCategory(rawRelPath: string): string | undefined {
  const parts = rawRelPath.split('/');
  return parts.length === 3 && parts[0] === 'raw' ? parts[1] : undefined;
}

function clampLines([start, end]: [number, number], totalLines: number): [number, number] {
  const s = Math.max(1, Math.min(start, totalLines));
  const e = Math.max(s, Math.min(end, totalLines));
  return [s, e];
}

function writeCardFile(cardsDir: string, id: CardId, fm: CardFrontmatter, body: string, examples: string[]): void {
  const yamlFm = stringify(fm).trimEnd();
  const exampleBlocks = examples.map((e) => '```example\n' + e.trim() + '\n```').join('\n\n');
  const content = `---\n${yamlFm}\n---\n\n${body.trim()}\n${exampleBlocks ? '\n' + exampleBlocks + '\n' : ''}`;
  writeFileSync(join(cardsDir, `${id}.md`), content, 'utf8');
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ============================================================================
// runIngestPipeline():把 phase-1 的 runIngest()(raw → level 0 卡)接上
// phase-2 的三步(questions.ts / children.ts / deps.ts)。runIngest() 本身不改
// (--fake 路徑還在用它,FakeLlmRouter 目前沒有 questions/deps 的 fixture)。
// 行為規格見 pipeline.test.ts 與 docs/integration/i1-content-pipeline.feature。
//
// FakeLlmRouter 目前只有 'ingest.cards' 的預錄回應(contracts/fixtures/llm/
// 沒有 ingest.questions / ingest.deps 的 fixture),所以 scripts/ingest.ts 的
// `--fake` 路徑刻意只呼叫 runIngest()(level 0),不呼叫 runIngestPipeline()——
// 要接上就得先補 fixture,不是這輪的範圍。
// ============================================================================

/**
 * 繼承 RunIngestResult,但 `message` 的語意更寬:成功時算的是 level 0 卡 **加上子卡**
 * 的總數,不是 runIngest() 那個只算 level 0 的數字。失敗與「已經處理過」的訊息原樣轉發。
 */
export interface RunIngestPipelineResult extends RunIngestResult {
  /** level 0 卡的考題產生失敗清單(card id + 錯誤訊息),來自 questions.ts,只轉發。 */
  questionFailures: GenerateQuestionsFailure[];
  /** 產生出來的 level 1 子卡 id,依 parent 處理順序攤平。 */
  childrenCreated: CardId[];
  /** 子卡的考題產生失敗清單。 */
  childQuestionFailures: GenerateQuestionsFailure[];
  /** analyzeDependencies() 算出的分類排序;deps 步驟整個失敗時給 []。 */
  depsOrder: CardId[];
  /** 本地迴圈依丟棄順序記錄的邊;沒有循環或 deps 步驟整個失敗時給 []。 */
  edgesRemoved: [CardId, CardId][];
  /** 丟邊次數達上限仍有循環時的殘留路徑;否則(含 deps 步驟整個失敗時)給 null。 */
  cycleUnresolved: CardId[] | null;
  /**
   * questionFailures 或 childQuestionFailures 任一非空時為 true——不管是 level 0
   * 卡還是子卡,只要有一筆考題產生失敗,I1 的 e2e 場景「every card has a question
   * file with the same id」就不算過。不覆寫 exitCode/ok(卡片本身確實建立成功,
   * 只是部分考題失敗),CLI(scripts/ingest.ts)依這個欄位另外決定退出碼——目前
   * CLI 還沒接上,見 scripts/ingest.ts 的 TODO。
   */
  hasQuestionFailures: boolean;
}

/** !level0.ok 或 level0.alreadyProcessed 時,補上 phase-2 欄位的空值,原樣回傳。 */
function emptyPipelineResult(level0: RunIngestResult): RunIngestPipelineResult {
  return {
    ...level0,
    questionFailures: [],
    childrenCreated: [],
    childQuestionFailures: [],
    depsOrder: [],
    edgesRemoved: [],
    cycleUnresolved: null,
    hasQuestionFailures: false,
  };
}

/** 把剛寫好的卡片從磁碟讀回來,用 data-layer 真的驗證器組成 Card[]。 */
function loadWrittenCards(outDir: string, category: string, ids: CardId[]): Card[] {
  return ids.map((id) => {
    const path = join(outDir, 'cards', category, `${id}.md`);
    const check = validateCard(readFileSync(path, 'utf8'));
    if (!check.ok || !check.card) {
      // Stryker disable next-line all: 內部不變量守門(剛用 writeCardFile() 寫出的卡片理論上一定通過
      // 同一份 validateCard())。要測到得故意在寫入後、讀回前弄壞磁碟上的檔案,價值低於複雜度;
      // if 條件本身(check.ok/check.card)有被別的測試涵蓋,這裡只豁免訊息字串的 mutant。
      throw new Error(`剛寫入的卡片 ${id} 沒有通過 data-layer 驗證器:${check.errors.join('; ')}`);
    }
    return check.card;
  });
}

export async function runIngestPipeline(opts: RunIngestOptions): Promise<RunIngestPipelineResult> {
  const level0 = await runIngest(opts);
  if (!level0.ok || level0.alreadyProcessed) {
    return emptyPipelineResult(level0);
  }

  const category = opts.category ?? inferCategory(opts.rawRelPath) ?? 'security';
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const logPath = join(opts.outDir, 'state/log.jsonl');

  const level0Cards = loadWrittenCards(opts.outDir, category, level0.cardsCreated);

  // questions.ts / children.ts / deps.ts 用 @core/llm 的 LlmRouter(見 questions.ts 的
  // 型別選擇說明);opts.router 的型別是 Wave 0 的 ./types.js LlmRouter,provider 多一個
  // 'fake' literal(FakeLlmRouter 與測試用的 scripted router 都會回這個值)——兩邊
  // call()/probeOnline()/probeLocal() 的方法簽章結構相同,差異只在這個 literal union
  // 更寬,對執行沒有影響,窄化成 phase-2 三個函式期待的型別。
  const router = opts.router as unknown as CoreLlmRouter;

  const questions = await generateQuestionsForCards(opts.outDir, level0Cards, router);

  let children: Card[] = [];
  let childQuestionFailures: GenerateQuestionsFailure[] = [];
  try {
    const result = await generateChildrenForCards(level0Cards, router, { outDir: opts.outDir, today });
    children = result.children;
    childQuestionFailures = result.questionFailures;
  } catch (err) {
    appendLogEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      file: opts.rawRelPath,
      message: `子卡產生失敗,已略過:${(err as Error).message}`,
    });
  }

  // 兩批考題失敗(level 0 與子卡)各自記一筆 warning。只收在記憶體裡的話,I1 的
  // e2e 場景「every card has a question file with the same id」形同虛設——磁碟上
  // 少了考題檔,log 卻一片安靜。沒有失敗就一筆都不寫。
  for (const failure of [...questions.failures, ...childQuestionFailures]) {
    appendLogEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      file: opts.rawRelPath,
      message: `考題產生失敗:${failure.card} — ${failure.error}`,
    });
  }

  let depsOrder: CardId[] = [];
  let edgesRemoved: [CardId, CardId][] = [];
  let cycleUnresolved: CardId[] | null = null;
  try {
    const result = await analyzeDependencies(category, [...level0Cards, ...children], router, opts.outDir);
    depsOrder = result.order;
    edgesRemoved = result.edgesRemoved;
    cycleUnresolved = result.cycleUnresolved;
  } catch (err) {
    // TODO(ADR-041):`GraphFileCorruptError` 不可以走這條「已略過」的路。
    // graph/deps.json 讀不出來是磁碟完整性問題,不是「這次圖沒算成功」——吞掉它
    // 會讓 CLI 以 0 退出、而且多記一筆跟真正原因無關的 warning(違反「恰好一筆」)。
    // 要 re-throw,讓 scripts/ingest.ts 的 main().catch 以非 0 退出碼結束。
    appendLogEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      file: opts.rawRelPath,
      message: `依賴圖分析失敗,已略過:${(err as Error).message}`,
    });
  }

  // level0.message 是 runIngest() 寫的,只算 level 0 卡——那是 runIngest() 自己的
  // 正確語意(它就只做 level 0),但對這條管線來說是半個數字:子卡也是這次真的
  // 建立出來的卡。覆寫成 level 0 + 子卡的總數,「這次建了幾張卡」才只有一個答案。
  // 不覆寫失敗與「已經處理過」的路徑——那兩條走 emptyPipelineResult() 提前回傳,
  // 訊息本來就對。(REVIEW.md §7.6 第 1 點)
  const childrenCreated = children.map((c) => c.frontmatter.id);

  return {
    ...level0,
    message: `建立了 ${level0.cardsCreated.length + childrenCreated.length} 張卡`,
    questionFailures: questions.failures,
    childrenCreated,
    childQuestionFailures,
    depsOrder,
    edgesRemoved,
    cycleUnresolved,
    hasQuestionFailures: questions.failures.length > 0 || childQuestionFailures.length > 0,
  };
}
