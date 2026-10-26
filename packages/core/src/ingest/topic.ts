/**
 * 沒有 raw 時從主題生成 level 0 卡(T55,02 phase-3 場景 2)。
 *
 * 主題先正規化(trim、Unicode NFC、連續空白併成一個)再驗長度。
 * 長度以 Unicode code point 計,1–200 才生成;空的或超過 200 拒絕,不探測、不呼叫 LLM。
 * 記在既有的 state/ingested.json,鍵 `topic:<分類>:<sha256(正規化主題)>`,不准另開 state 檔。
 * 掃描要略過 `topic:` 開頭的鍵(isTopicKey),否則會被當成 raw 路徑不見。
 * 寫完照 raw 管線跑後半:考題、子卡、依賴圖。levelZeroOnly 只寫 level 0。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '@contracts/index.js';
import type { LlmRouter as CoreLlmRouter } from '@core/llm/index.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';
import { validateCard } from '@core/schema/validate-card.js';
import { generateChildrenForCards, renderCardFile } from './children.js';
import { analyzeDependencies } from './deps.js';
import { GraphFileCorruptError } from './errors.js';
import { enforceWordLimit, type RegenerateAttempt } from './generate-cards.js';
import { nextCardIds } from './ids.js';
import { loadPromptTemplate } from './prompts.js';
import { generateQuestionsForCards, type GenerateQuestionsFailure } from './questions.js';
import { appendLogEvent, atomicWriteJson, readJsonOr } from './state.js';
import type { CardId, LlmRouter } from './types.js';

const TOPIC_TEMPLATE = loadPromptTemplate('topic');
const TOPIC_CARD_CAP = 5;
const TOPIC_MAX_CODE_POINTS = 200;
const CLOUD_MESSAGE = 'ingest requires a cloud model,目前偵測不到可用的雲端模型,不會降級到本機模型。';

interface TopicDraft {
  title: string;
  body: string;
  examples: string[];
}

interface ParkedTopic {
  title: string;
  attempts: RegenerateAttempt[];
}

interface IngestedEntry {
  sha256: string;
  cardIds: CardId[];
  processedAt: string;
}

export interface TopicGenerationInput {
  outDir: string;
  router: LlmRouter;
  category: string;
  topic: string;
  today?: string;
  levelZeroOnly?: boolean;
}

export interface TopicGenerationResult {
  refused?: 'topic_invalid' | 'topic_failed';
  cloudBlocked?: boolean;
  topicGenerated: string[];
  topicAlready: string[];
  message: string;
}

/** 工單的正規化:trim、NFC、連續空白併成一個空白。送進 prompt 與算 sha 都用這個。 */
export function normalizeTopic(topic: string): string {
  return topic.trim().normalize('NFC').replace(/\s+/g, ' ');
}

/** ingested.json 裡主題鍵的前綴。掃描、stale、source_missing 都要跳過。 */
export function isTopicKey(key: string): boolean {
  return key.startsWith('topic:');
}

function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function topicStateKey(category: string, normalized: string): string {
  return `topic:${category}:${sha256Of(normalized)}`;
}

function emptyTopic(message: string, extra: Partial<TopicGenerationResult> = {}): TopicGenerationResult {
  return { topicGenerated: [], topicAlready: [], message, ...extra };
}

function buildTopicPrompt(category: string, normalized: string): string {
  return [TOPIC_TEMPLATE, '---', `category: ${category}`, `topic: ${normalized}`, '---', normalized].join('\n');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 主題回應沒有 lines。不要走 parseCardCandidates(那個要求 lines)。 */
function parseTopicCards(text: string): TopicDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`主題生成回應不是合法 JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('主題生成回應必須是陣列');

  return parsed.map((raw, i) => {
    if (!isPlainObject(raw) || typeof raw.title !== 'string' || typeof raw.body !== 'string') {
      throw new Error(`主題生成回應第 ${i} 筆格式不正確: ${JSON.stringify(raw)}`);
    }
    const examples = Array.isArray(raw.examples) ? raw.examples.filter((item): item is string => typeof item === 'string') : [];
    return { title: raw.title, body: raw.body, examples };
  });
}

function logPathOf(outDir: string): string {
  return join(outDir, 'state/log.jsonl');
}

function logWarning(outDir: string, message: string, extra: Record<string, unknown> = {}): void {
  appendLogEvent(logPathOf(outDir), {
    ts: new Date().toISOString(),
    type: 'warning',
    message,
    ...extra,
  });
}

function writeParked(outDir: string, category: string, parked: ParkedTopic[]): void {
  if (parked.length === 0) return;
  const path = join(outDir, 'state/needs-review.json');
  const existing = readJsonOr<unknown[]>(path, []);
  const entries = parked.map((item) => ({
    category,
    title: item.title,
    source: `topic:${category}`,
    reason: 'body_over_limit',
    attempts: item.attempts,
    recordedAt: new Date().toISOString(),
  }));
  atomicWriteJson(path, [...existing, ...entries]);
  logWarning(outDir, `${parked.length} 張卡因字數超過上限被暫緩,見 needs-review.json`);
}

function writeTopicCards(outDir: string, category: string, today: string, accepted: TopicDraft[]): CardId[] {
  const cardsDir = join(outDir, 'cards', category);
  mkdirSync(cardsDir, { recursive: true });
  const ids = nextCardIds(cardsDir, category, accepted.length);
  ids.forEach((id, i) => {
    const draft = accepted[i]!;
    const card: Card = {
      frontmatter: {
        id,
        category,
        title: draft.title,
        level: 0,
        source: 'llm',
        created: today,
        prereqs: [],
        provisional: false,
        stale: false,
        source_missing: false,
      },
      body: draft.body,
      examples: draft.examples,
    };
    writeFileAtomic(join(cardsDir, `${id}.md`), renderCardFile(card));
  });
  return ids;
}

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

async function runTopicTail(
  outDir: string,
  category: string,
  ids: CardId[],
  router: LlmRouter,
  today: string,
  fileLabel: string,
): Promise<void> {
  const cards = loadWrittenCards(outDir, category, ids);
  const coreRouter = router as unknown as CoreLlmRouter;
  const logPath = logPathOf(outDir);

  const questions = await generateQuestionsForCards(outDir, cards, coreRouter);

  let children: Card[] = [];
  let childQuestionFailures: GenerateQuestionsFailure[] = [];
  try {
    const result = await generateChildrenForCards(cards, coreRouter, { outDir, today });
    children = result.children;
    childQuestionFailures = result.questionFailures;
  } catch (err) {
    appendLogEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      file: fileLabel,
      message: `子卡產生失敗,已略過:${(err as Error).message}`,
    });
  }

  for (const failure of [...questions.failures, ...childQuestionFailures]) {
    appendLogEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      file: fileLabel,
      message: `考題產生失敗:${failure.card} — ${failure.error}`,
    });
  }

  try {
    await analyzeDependencies(category, [...cards, ...children], coreRouter, outDir);
  } catch (err) {
    if (err instanceof GraphFileCorruptError) throw err;
    appendLogEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      file: fileLabel,
      message: `依賴圖分析失敗,已略過:${(err as Error).message}`,
    });
  }
}

async function probeOnline(router: LlmRouter): Promise<boolean> {
  try {
    return await router.probeOnline();
  } catch {
    return false;
  }
}

export async function generateFromTopic(opts: TopicGenerationInput): Promise<TopicGenerationResult> {
  const normalized = normalizeTopic(opts.topic);
  const length = codePointLength(normalized);
  if (length === 0 || length > TOPIC_MAX_CODE_POINTS) {
    return emptyTopic('主題無效:正規化後是空的,或超過 200 個字元', { refused: 'topic_invalid' });
  }

  const key = topicStateKey(opts.category, normalized);
  const statePath = join(opts.outDir, 'state/ingested.json');
  const state = readJsonOr<Record<string, IngestedEntry>>(statePath, {});
  const existing = state[key];
  if (existing) {
    const ids = existing.cardIds;
    return emptyTopic(`這個主題已經生成過\n${ids.join('\n')}`, { topicAlready: ids });
  }

  const online = await probeOnline(opts.router);
  if (!online) {
    return emptyTopic(CLOUD_MESSAGE, { cloudBlocked: true });
  }

  const result = await opts.router.call('ingest.cards', buildTopicPrompt(opts.category, normalized));
  const drafts = parseTopicCards(result.text);
  const kept = drafts.length > TOPIC_CARD_CAP ? drafts.slice(0, TOPIC_CARD_CAP) : drafts;

  const accepted: TopicDraft[] = [];
  const parked: ParkedTopic[] = [];
  const warnings: string[] = [];
  let regenerateEvents = 0;
  for (const draft of kept) {
    const limited = await enforceWordLimit(
      (task, prompt) => opts.router.call(task, prompt),
      'ingest.cards',
      opts.category,
      'topic',
      draft,
    );
    warnings.push(...limited.warnings);
    if (limited.accepted) {
      accepted.push({ title: limited.title, body: limited.body, examples: limited.examples });
      if (limited.attempts.length > 1) regenerateEvents += 1;
    } else {
      parked.push({ title: limited.title, attempts: limited.attempts });
    }
  }

  if (drafts.length > TOPIC_CARD_CAP) {
    logWarning(opts.outDir, `主題回應 ${drafts.length} 張,只留前 ${TOPIC_CARD_CAP} 張`);
  }
  for (const message of warnings) logWarning(opts.outDir, message, { file: key });
  writeParked(opts.outDir, opts.category, parked);

  if (accepted.length === 0) {
    return emptyTopic('主題生成失敗:沒有可用的卡片', { refused: 'topic_failed' });
  }

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ids = writeTopicCards(opts.outDir, opts.category, today, accepted);
  state[key] = { sha256: sha256Of(normalized), cardIds: ids, processedAt: new Date().toISOString() };
  atomicWriteJson(statePath, state);

  const logPath = logPathOf(opts.outDir);
  appendLogEvent(logPath, {
    ts: new Date().toISOString(),
    type: 'ingested',
    file: key,
    cards_created: ids.length,
  });
  for (let i = 0; i < regenerateEvents; i += 1) {
    appendLogEvent(logPath, { ts: new Date().toISOString(), type: 'regenerate', file: key });
  }

  if (!opts.levelZeroOnly) {
    await runTopicTail(opts.outDir, opts.category, ids, opts.router, today, key);
  }

  return emptyTopic(`從主題建立了 ${ids.length} 張卡`, { topicGenerated: ids });
}
