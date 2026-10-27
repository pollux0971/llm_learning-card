/**
 * 05-grading phase-3:縮短版生成(T65)。
 *
 * 最多三次 `router.call('reteach.short', prompt)`。回應要是 JSON 物件,
 * `body` 與 `example` 都是 trim 後不空的字串(多的鍵忽略)。寫之前用
 * renderCardFile 組檔、parseCardText 讀回:examples 剛好 1 個,而且那個
 * example 跟模型給的 example trim 之後一樣;字數用 countWords 量讀回的 body。
 * 夠短(≤ shortLimit)就停。都太長就留最短的並記 reteach_short_overlong。
 * 三次都格式壞回 failed、記 reteach_short_bad_response,不寫檔、不進佇列。
 * 第 2 或第 3 次 NO_MODEL:已有格式好的結果就從那些裡面挑,attempts 記實際呼叫次數;
 * 一個都沒有就回 no-model。其他錯誤原樣丟出。
 * 寫完檔之後,留下的那一次是 provisional 才 enqueue 一次(不用 recordProvisional)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '@contracts/index.js';
import { renderCardFile } from '@core/ingest/card-file.js';
import { NoModelError } from '@core/llm/errors.js';
import { ProvisionalQueue, provisionalQueuePath } from '@core/llm/provisional-queue.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';
import { parseCardText } from '@core/schema/parse-card.js';
import { countWords } from '@core/schema/word-count.js';
import type { LogAppender } from './grade-apply.js';
import type { LlmResult, LlmRouter } from './types.js';

const MAX_ATTEMPTS = 3;
const PROMPT_PATH = join(import.meta.dirname, '../../prompts/grading/reteach-short.md');

export type GenerateShortResult =
  | { kind: 'written'; path: string; provisional: boolean; attempts: number }
  | { kind: 'failed'; attempts: 3 }
  | { kind: 'no-model' };

export interface GenerateShortArgs {
  learningDir: string;
  card: Card;
  router: LlmRouter;
  shortLimit: number;
  queue?: ProvisionalQueue;
  log: LogAppender;
}

interface GoodAttempt {
  prompt: string;
  text: string;
  provisional: boolean;
  words: number;
  rendered: string;
}

interface Judged {
  good?: GoodAttempt;
  /** 有做來回檢查才有:讀回 body 的字數。格式在那之前就壞了則沒有。 */
  readBackWords?: number;
}

function buildPrompt(template: string, card: Card, shortLimit: number, previousWords: number | undefined): string {
  const lines = [template.trimEnd(), '', `上限: ${shortLimit}`, '', card.body, ...card.examples];
  const base = lines.join('\n');
  if (previousWords === undefined) return base;
  return `${base.trimEnd()}\n上一次 ${previousWords} 字,上限 ${shortLimit}`;
}

function parseModelJson(text: string): { body: string; example: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.body !== 'string' || typeof obj.example !== 'string') return null;
  if (obj.body.trim() === '' || obj.example.trim() === '') return null;
  return { body: obj.body, example: obj.example };
}

function judge(text: string, provisional: boolean, prompt: string, card: Card): Judged {
  const parsed = parseModelJson(text);
  if (parsed === null) return {};
  const frontmatter = { ...card.frontmatter, provisional };
  const rendered = renderCardFile({ frontmatter, body: parsed.body, examples: [parsed.example] });
  const read = parseCardText(rendered);
  const readBackWords = countWords(read.body);
  if (read.examples.length !== 1 || read.examples[0] !== parsed.example.trim()) {
    return { readBackWords };
  }
  return {
    readBackWords,
    good: { prompt, text, provisional, words: readBackWords, rendered },
  };
}

function pickShortest(goods: readonly GoodAttempt[]): GoodAttempt {
  let best = goods[0]!;
  for (const g of goods) {
    if (g.words < best.words) best = g;
  }
  return best;
}

function shortFilePath(learningDir: string, card: Card): string {
  return join(learningDir, 'cards', card.frontmatter.category, `${card.frontmatter.id}.short.md`);
}

function warn(log: LogAppender, reason: string, extra: Record<string, unknown> = {}): void {
  log({ ts: new Date().toISOString(), type: 'warning', task: 'reteach.short', reason, ...extra });
}

export async function generateShort(args: GenerateShortArgs): Promise<GenerateShortResult> {
  const { learningDir, card, router, shortLimit, log } = args;
  const template = readFileSync(PROMPT_PATH, 'utf8');
  const goods: GoodAttempt[] = [];
  let attempts = 0;
  let previousWords: number | undefined;
  let noModel = false;

  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    const prompt = buildPrompt(template, card, shortLimit, previousWords);
    let result: LlmResult;
    try {
      result = await router.call('reteach.short', prompt);
    } catch (err) {
      if (!(err instanceof NoModelError)) throw err;
      attempts = n;
      noModel = true;
      break;
    }
    attempts = n;
    const judged = judge(result.text, result.provisional, prompt, card);
    previousWords = judged.readBackWords;
    if (judged.good === undefined) continue;
    goods.push(judged.good);
    if (judged.good.words <= shortLimit) break;
  }

  if (goods.length === 0) {
    if (noModel) return { kind: 'no-model' };
    warn(log, 'reteach_short_bad_response');
    return { kind: 'failed', attempts: 3 };
  }

  const fit = goods.find((g) => g.words <= shortLimit);
  const kept = fit ?? pickShortest(goods);
  if (kept.words > shortLimit) {
    warn(log, 'reteach_short_overlong', { words: goods.map((g) => g.words) });
  }

  const path = shortFilePath(learningDir, card);
  writeFileAtomic(path, kept.rendered);
  if (kept.provisional) {
    const queue = args.queue ?? new ProvisionalQueue({ path: provisionalQueuePath(learningDir), log });
    await queue.enqueue({
      task: 'reteach.short',
      card: card.frontmatter.id,
      prompt: kept.prompt,
      localText: kept.text,
    });
  }
  return { kind: 'written', path, provisional: kept.provisional, attempts };
}
