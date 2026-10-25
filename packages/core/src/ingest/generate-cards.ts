/** 呼叫 LlmRouter 產生卡片候選,對超過字數上限的卡片重試,最多 3 次嘗試。 */
import type { LlmRouter } from './types.js';
import { loadPromptTemplate } from './prompts.js';
import { CARD_BODY_WORD_LIMIT } from '@contracts/index.js';
import { witness } from '@contracts/witness.js';
import { countWords, parseCardText } from '@core/schema/index.js';

const CARDS_TEMPLATE = loadPromptTemplate('cards');
const REGENERATE_TEMPLATE = loadPromptTemplate('regenerate');
const MAX_ATTEMPTS = 3;

/**
 * 與 `validateCard` 同一條路的卡檔前綴(顧問 Q3)。空 front matter 之後空一行再接 body,
 * 跟 `ingest.ts` 的 `writeCardFile` 同形,讓以 `---` 開頭的 body 不會被 gray-matter 吃掉。
 */
const CARD_FILE_PREFIX = '---\n---\n\n';

export interface CardCandidate {
  title: string;
  body: string;
  examples: string[];
  lines: [number, number];
}

export interface RegenerateAttempt {
  attempt: number;
  wordCount: number;
  body: string;
}

export interface ParkedCandidate {
  title: string;
  lines: [number, number];
  attempts: RegenerateAttempt[];
}

export interface GenerateCardsResult {
  accepted: CardCandidate[];
  parked: ParkedCandidate[];
  regenerateEvents: number;
  /** 恆存在。regenerate 回多筆時各推一則;沒有就是 []。 */
  warnings: string[];
}

export interface GenerateCardsOptions {
  /** 原始檔在 prompt 裡的標示,通常是檔名(例如 "web-basics.md")。 */
  relLabel: string;
  category: string;
  content: string;
}

/** regenerate 專用解析的結果。`examples` 省略表示保留目前候選,不要賦成 undefined。 */
interface RegeneratedCard {
  body: string;
  examples?: string[];
  /** 回應陣列的實際筆數。大於 1 時只採用第一筆,後面不驗證。 */
  count: number;
}

export type WordLimitTask = 'ingest.cards' | 'deepen';

export interface WordLimitInput {
  title: string;
  body: string;
  examples: string[];
}

export interface WordLimitResult {
  title: string;
  body: string;
  examples: string[];
  accepted: boolean;
  attempts: RegenerateAttempt[];
  warnings: string[];
}

/**
 * 字數超過上限就用 regenerate 模板重寫,最多 3 次嘗試(初稿 + 2 次重寫)。
 * ingest 與深入共用。task 由呼叫端決定:ingest 用 `ingest.cards`,深入用 `deepen`。
 */
export async function enforceWordLimit(
  call: (task: WordLimitTask, prompt: string) => Promise<{ text: string }>,
  task: WordLimitTask,
  category: string,
  sourceLabel: string,
  input: WordLimitInput,
): Promise<WordLimitResult> {
  let current: WordLimitInput = { title: input.title, body: input.body, examples: [...input.examples] };
  const attempts: RegenerateAttempt[] = [{ attempt: 1, wordCount: countBodyWords(current.body), body: current.body }];
  const warnings: string[] = [];
  let attemptNum = 1;
  while (countBodyWords(current.body) > CARD_BODY_WORD_LIMIT && attemptNum < MAX_ATTEMPTS) {
    attemptNum += 1;
    if (task === 'ingest.cards') witness('ingest.cards.regenerate-retry');
    const regenerated = await callAndParseRegenerated(call, task, buildRegeneratePrompt(category, sourceLabel, current));
    if (regenerated.count > 1) {
      warnings.push(`regenerate 回了 ${regenerated.count} 筆,只用第一筆(${current.title})`);
    }
    current = applyRegenerated(current, regenerated);
    attempts.push({ attempt: attemptNum, wordCount: countBodyWords(current.body), body: current.body });
  }
  return {
    title: current.title,
    body: current.body,
    examples: current.examples,
    accepted: countBodyWords(current.body) <= CARD_BODY_WORD_LIMIT,
    attempts,
    warnings,
  };
}

export async function generateCards(
  router: LlmRouter,
  opts: GenerateCardsOptions,
): Promise<GenerateCardsResult> {
  const initial = await callAndParse(router, buildBatchPrompt(opts));

  const accepted: CardCandidate[] = [];
  const parked: ParkedCandidate[] = [];
  const warnings: string[] = [];
  let regenerateEvents = 0;

  for (const candidate of initial) {
    const limited = await enforceWordLimit(
      (task, prompt) => router.call(task, prompt),
      'ingest.cards',
      opts.category,
      opts.relLabel,
      candidate,
    );
    warnings.push(...limited.warnings);
    if (limited.accepted) {
      accepted.push({ ...candidate, body: limited.body, examples: limited.examples });
      if (limited.attempts.length > 1) regenerateEvents += 1;
    } else {
      parked.push({ title: candidate.title, lines: candidate.lines, attempts: limited.attempts });
    }
  }

  return { accepted, parked, regenerateEvents, warnings };
}

/**
 * 字數唯一函式:跟寫檔前後把關的 `validateCard` 走同一條路
 * (`countWords(parseCardText(前綴 + body).body)`)。上限是 @contracts 的 CARD_BODY_WORD_LIMIT。
 */
function countBodyWords(body: string): number {
  return countWords(parseCardText(CARD_FILE_PREFIX + body.trim() + '\n').body);
}

/** 只換 body;examples 有採用才換。title 留在目前候選上。 */
function applyRegenerated(current: WordLimitInput, regenerated: RegeneratedCard): WordLimitInput {
  if (regenerated.examples === undefined) {
    return { ...current, body: regenerated.body };
  }
  return { ...current, body: regenerated.body, examples: regenerated.examples };
}

async function callAndParse(router: LlmRouter, prompt: string): Promise<CardCandidate[]> {
  const result = await router.call('ingest.cards', prompt);
  return parseCardCandidates(result.text);
}

async function callAndParseRegenerated(
  call: (task: WordLimitTask, prompt: string) => Promise<{ text: string }>,
  task: WordLimitTask,
  prompt: string,
): Promise<RegeneratedCard> {
  const result = await call(task, prompt);
  return parseRegenerated(result.text);
}

function parseCardCandidates(text: string): CardCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`ingest.cards 回應不是合法 JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('ingest.cards 回應必須是陣列');

  return parsed.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    const lines = r.lines as unknown[] | undefined;
    if (
      typeof r.title !== 'string' ||
      typeof r.body !== 'string' ||
      !Array.isArray(r.examples) ||
      !Array.isArray(lines) ||
      lines.length !== 2
    ) {
      throw new Error(`ingest.cards 回應第 ${i} 筆格式不正確: ${JSON.stringify(raw)}`);
    }
    return {
      title: r.title,
      body: r.body,
      examples: r.examples as string[],
      lines: [Number(lines[0]), Number(lines[1])] as [number, number],
    };
  });
}

/**
 * regenerate 專用解析。批次回應仍走 `parseCardCandidates`(檢查一個字都不放寬)。
 * title、lines、以及其他未知欄位一律忽略;多於一筆只看第一筆。
 */
function parseRegenerated(text: string): RegeneratedCard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`regenerate 回應不是合法 JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('regenerate 回應必須是陣列');
  if (parsed.length === 0) throw new Error('regenerate 回應沒有回傳卡片');

  const raw = parsed[0];
  if (!isPlainObject(raw) || typeof raw.body !== 'string') {
    throw new Error(`regenerate 回應第 0 筆格式不正確: ${JSON.stringify(raw)}`);
  }

  const card: RegeneratedCard = { body: raw.body, count: parsed.length };
  const examples = adoptableExamples(raw.examples);
  if (examples !== undefined) card.examples = examples;
  return card;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 缺少、[]、或格式不對(非陣列、含非字串、含去空白後的空字串)→ undefined,呼叫端保留目前候選。
 * 只有非空、且每一項去頭尾空白後仍非空的字串陣列才整批替換(不半採用、不丟錯)。
 */
function adoptableExamples(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') return undefined;
    items.push(item);
  }
  return items;
}

function buildBatchPrompt(opts: GenerateCardsOptions): string {
  return [CARDS_TEMPLATE, '---', `category: ${opts.category}`, `source: ${opts.relLabel}`, '---', opts.content].join(
    '\n',
  );
}

function buildRegeneratePrompt(category: string, sourceLabel: string, previous: { title: string; body: string }): string {
  return [
    REGENERATE_TEMPLATE,
    '---',
    `category: ${category}`,
    `source: ${sourceLabel}`,
    `title: ${previous.title}`,
    `limit: ${CARD_BODY_WORD_LIMIT}`,
    `previous body: ${previous.body}`,
  ].join('\n');
}
