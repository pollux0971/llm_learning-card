/** 呼叫 LlmRouter 產生卡片候選,對超過字數上限的卡片重試,最多 3 次嘗試。 */
import type { LlmRouter } from './types.js';
import { countBodyWords, BODY_WORD_LIMIT } from './word-count-min.js';
import { loadPromptTemplate } from './prompts.js';

const CARDS_TEMPLATE = loadPromptTemplate('cards');
const REGENERATE_TEMPLATE = loadPromptTemplate('regenerate');
const MAX_ATTEMPTS = 3;

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
}

export interface GenerateCardsOptions {
  /** 原始檔在 prompt 裡的標示,通常是檔名(例如 "web-basics.md")。 */
  relLabel: string;
  category: string;
  content: string;
}

export async function generateCards(
  router: LlmRouter,
  opts: GenerateCardsOptions,
): Promise<GenerateCardsResult> {
  const initial = await callAndParse(router, buildBatchPrompt(opts));

  const accepted: CardCandidate[] = [];
  const parked: ParkedCandidate[] = [];
  let regenerateEvents = 0;

  for (const candidate of initial) {
    let current = candidate;
    const attempts: RegenerateAttempt[] = [{ attempt: 1, wordCount: countBodyWords(current.body), body: current.body }];

    let attemptNum = 1;
    while (countBodyWords(current.body) > BODY_WORD_LIMIT && attemptNum < MAX_ATTEMPTS) {
      attemptNum += 1;
      const [regenerated] = await callAndParse(router, buildRegeneratePrompt(opts, current));
      if (!regenerated) throw new Error('regenerate 回應沒有回傳卡片');
      current = { ...current, body: regenerated.body, examples: regenerated.examples ?? current.examples };
      attempts.push({ attempt: attemptNum, wordCount: countBodyWords(current.body), body: current.body });
    }

    if (countBodyWords(current.body) <= BODY_WORD_LIMIT) {
      accepted.push(current);
      if (attemptNum > 1) regenerateEvents += 1;
    } else {
      parked.push({ title: current.title, lines: current.lines, attempts });
    }
  }

  return { accepted, parked, regenerateEvents };
}

async function callAndParse(router: LlmRouter, prompt: string): Promise<CardCandidate[]> {
  const result = await router.call('ingest.cards', prompt);
  return parseCardCandidates(result.text);
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

function buildBatchPrompt(opts: GenerateCardsOptions): string {
  return [CARDS_TEMPLATE, '---', `category: ${opts.category}`, `source: ${opts.relLabel}`, '---', opts.content].join(
    '\n',
  );
}

function buildRegeneratePrompt(opts: GenerateCardsOptions, previous: CardCandidate): string {
  return [
    REGENERATE_TEMPLATE,
    '---',
    `category: ${opts.category}`,
    `source: ${opts.relLabel}`,
    `title: ${previous.title}`,
    `limit: ${BODY_WORD_LIMIT}`,
    `previous body: ${previous.body}`,
  ].join('\n');
}
