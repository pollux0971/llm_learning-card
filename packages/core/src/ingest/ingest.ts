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
import { CloudRequiredError } from './fake-llm.js';
import type { Card } from '@contracts/index.js';
import { validateCard } from '@core/schema/validate-card.js';
import { generateQuestionsForCards, type GenerateQuestionsFailure } from './questions.js';
import { generateChildrenForCards } from './children.js';
import { analyzeDependencies } from './deps.js';

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
    if (err instanceof CloudRequiredError) {
      return fail('ingest 需要雲端模型,目前無法使用雲端,不會降級到本機模型', 1);
    }
    throw err;
  }

  const cardsDir = join(opts.outDir, 'cards', category);
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
// I1 整合缺口:runIngestPipeline() —— 介面契約(這輪只設計 + 寫測試,下一輪開發
// agent 實作)。函式體先 throw new Error('not implemented')。行為規格見同目錄
// pipeline.test.ts 與 docs/integration/i1-content-pipeline.feature。
//
// 背景:runIngest()(上面,原封不動)只做 raw → level 0 卡片,這是 phase-1 的
// 範圍。02-ingest-pipeline/phase-2 已經做完 generateQuestionsForCards()、
// generateChildrenForCards()、analyzeDependencies() 三個函式(questions.ts /
// children.ts / deps.ts,全部有測試、100% mutation score),但從來沒有人在
// runIngest() 裡呼叫它們——這就是 I1 整合驗收發現的缺口。runIngestPipeline()
// 是把四段串起來的新入口,runIngest() 本身不改(避免動到已經測過、
// standalone.json 的 --fake 路徑還在用的邏輯)。
//
// ---- 流程 ----
// 1. const level0 = await runIngest(opts)。
//    - !level0.ok → 直接回傳(不繼續呼叫任何 LLM task);複製 level0 的欄位,
//      phase-2 相關欄位給空值(見下面 emptyPipelineResult)。
//    - level0.alreadyProcessed → 同樣直接回傳,不重跑 phase-2 三步——
//      這是「Re-running ingest changes nothing」的字面意思:重跑不能再呼叫一次
//      LLM(ingest.test.ts 已經有一個案例斷言「再跑一次同一個檔案,呼叫次數是
//      0」,phase-1 那個案例只測到 runIngest() 本身;runIngestPipeline() 要保
//      同一個不變量,往下傳。
// 2. 把 level0.cardsCreated 從磁碟讀回來,組成 Card[](contracts 型別,不是
//    這個檔案原本用的 ./types.js 本地型別)。用 @core/schema 的 validateCard()
//    讀,不要自己重新解析 frontmatter——這正是 feature 說的「ingest 現在用
//    data-layer 真的驗證器」,失敗(理論上不該發生,剛寫的卡驗證不過代表
//    generate-cards.ts 或這裡的寫檔邏輯有 bug)直接丟出去,不要吞掉。
// 3. const questions = await generateQuestionsForCards(outDir, level0Cards, router)。
//    單卡失敗已經在 questions.ts 內部處理(failures 陣列),這裡只轉發。
// 4. 子卡:用 try/catch 包 generateChildrenForCards(level0Cards, router, {outDir, today})——
//    注意 children.ts 的 generateChildrenForCards 本身「沒有」對每個 parent 做
//    失敗隔離(跟 questions.ts 不同,一個 parent 生成失敗會直接讓整個呼叫
//    throw)。這裡的 try/catch 是 pipeline 層級的安全網:失敗時記一筆 warning
//    log 事件,children 當空陣列繼續走完 deps 那步,不要讓一張卡的子卡生成
//    失敗拖垮已經寫好的 level 0 卡與它們的考題(呼應 i1 feature「Generation
//    failure for one card does not lose the others」的精神,即使 phase-2.feature
//    原本那個場景測的是 questions.ts 內部的隔離,這裡是把同一個精神套用到
//    pipeline 這一層新出現的失敗點)。
// 5. deps:同樣 try/catch 包 analyzeDependencies(category, [...level0Cards, ...children], router, outDir)。
//    失敗時 depsOrder 給空陣列、cycleRemoved 給 null,記 warning log,不要讓
//    deps 分析失敗抹掉前面已經寫好的卡片與考題。
// 6. 組 RunIngestPipelineResult 回傳(見下面型別)。
//
// ---- 已知的既有 bug,不在這輪修,寫測試把它攤出來給下一輪 ----
// - CloudRequiredError 撞名:fake-llm.ts 匯出的 CloudRequiredError(這個檔案上面
//   `import { CloudRequiredError } from './fake-llm.js'` 那個)跟 03-llm-router
//   真的路由邏輯丟的 @core/llm/errors.js 的 CloudRequiredError 是兩個不同的
//   class,`instanceof` 互相認不出對方。runIngest() 現有的 catch 只認 fake-llm
//   版本——用真的 LlmRouterImpl 離線時,routing.ts 丟的是 @core/llm 版本,不會
//   被這裡的 catch 接住,會被當成未預期例外整個往外丟。runIngestPipeline()
//   (以及理想上 runIngest() 自己)的 catch 判斷要改成看 `(err as
//   { code?: string }).code === 'CLOUD_REQUIRED'`,不要用 instanceof——這樣
//   兩個 class 都認得。這輪的 pipeline.test.ts 用真的 @core/llm CloudRequiredError
//   驗證這個路徑,紅燈是預期的。
// - FakeLlmRouter 目前只有 'ingest.cards' 的預錄回應(contracts/fixtures/llm/
//   沒有 ingest.questions / ingest.deps 的 fixture),所以 scripts/ingest.ts 的
//   `--fake` 路徑刻意只呼叫 runIngest()(level 0),不呼叫
//   runIngestPipeline()——要接上就得先補 fixture,不是這輪的範圍。
// ============================================================================

export interface RunIngestPipelineResult extends RunIngestResult {
  /** level 0 卡的考題產生失敗清單(card id + 錯誤訊息),來自 questions.ts,只轉發。 */
  questionFailures: GenerateQuestionsFailure[];
  /** 產生出來的 level 1 子卡 id,依 parent 處理順序攤平。 */
  childrenCreated: CardId[];
  /** 子卡的考題產生失敗清單。 */
  childQuestionFailures: GenerateQuestionsFailure[];
  /** analyzeDependencies() 算出的分類排序;deps 步驟整個失敗時給 []。 */
  depsOrder: CardId[];
  /** 二次挑戰仍循環而被丟棄的邊;沒有循環或 deps 步驟整個失敗時給 null。 */
  cycleRemoved: [CardId, CardId] | null;
}

/** !level0.ok 或 level0.alreadyProcessed 時,補上 phase-2 欄位的空值,原樣回傳。 */
function emptyPipelineResult(level0: RunIngestResult): RunIngestPipelineResult {
  return {
    ...level0,
    questionFailures: [],
    childrenCreated: [],
    childQuestionFailures: [],
    depsOrder: [],
    cycleRemoved: null,
  };
}

/** 把剛寫好的卡片從磁碟讀回來,用 data-layer 真的驗證器組成 Card[]。 */
function loadWrittenCards(outDir: string, category: string, ids: CardId[]): Card[] {
  return ids.map((id) => {
    const path = join(outDir, 'cards', category, `${id}.md`);
    const check = validateCard(readFileSync(path, 'utf8'));
    if (!check.ok || !check.card) {
      throw new Error(`剛寫入的卡片 ${id} 沒有通過 data-layer 驗證器:${check.errors.join('; ')}`);
    }
    return check.card;
  });
}

export async function runIngestPipeline(opts: RunIngestOptions): Promise<RunIngestPipelineResult> {
  // 型別備忘,避免下一輪忘記用到:emptyPipelineResult / loadWrittenCards 已經備好。
  void emptyPipelineResult;
  void loadWrittenCards;
  void generateQuestionsForCards;
  void generateChildrenForCards;
  void analyzeDependencies;
  throw new Error('not implemented');
}
