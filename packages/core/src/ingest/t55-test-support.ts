/**
 * T55(02 phase-3 場景 2:沒有 raw 時從主題生成)測試共用的工具。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T55-ingest-topic-generation.md。沿用 t53-test-support.ts(`runIngestScan` 從 ingest 的 barrel 載)。
 *
 * 釘住的結果欄位(工單沒給名字,但測試得有一個;加在 T53 的結果形狀上):
 *   - `topicGenerated: string[]`:這一次主題生成寫出的 level 0 卡 id(依寫入順序)
 *   - `topicAlready: string[]`:同一個分類、正規化後同一個主題已經生成過 → 那幾張卡的 id;沒有重複時沒有或是空陣列
 *   - `refused: 'topic_invalid'`(正規化後空的、或超過 200 個 code point)、`'topic_failed'`(0 張、或全部暫緩)
 * 記主題:`state/ingested.json` 的鍵 `topic:<分類>:<正規化後主題的 sha256>`,值 { sha256(同鍵裡的那個)、cardIds(level 0)、processedAt }。
 * 正規化:trim、Unicode NFC、連續空白(`\s+`)併成一個空白。
 *
 * 假 router(`topicRouter`)照 task 與 prompt 的樣子回應:
 *   - ingest.cards:prompt 有 `parent_id:` → 子卡;有 `previous body:` → regenerate;否則就是主題生成(回 `cards`,可以多個回合)
 *   - ingest.questions → 合法的考題;ingest.deps → 把卡串成一條鏈
 * 數呼叫(calls)與探測(probes)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

export interface TopicCard {
  title: string;
  body: string;
  examples?: string[];
}

export interface TopicRouterOptions {
  /** 主題生成那一次(第一次 ingest.cards、沒有 parent_id、沒有 previous body)回的卡;預設三張短卡 */
  cards?: TopicCard[];
  /** regenerate 依序回的 body;用完就一直回最後一個;沒給就回一段短的 */
  regenerateBodies?: string[];
  /** 每張父卡的子卡數(預設 1) */
  childCount?: number;
  /** true = 離線:probeOnline 回 false、call 丟錯 */
  offline?: boolean;
  /** true = 每張卡帶 lines(給「拿 raw 管線當對照」的測試用;raw 的 ingest.cards 回應要有 lines) */
  withLines?: boolean;
}

export interface TopicRouter {
  router: LlmRouter;
  calls: { task: LlmTask; prompt: string }[];
  probes: () => number;
  /** 主題生成那幾次呼叫(不含 regenerate、子卡、考題、依賴圖)的 prompt */
  topicPrompts: () => string[];
  regeneratePrompts: () => string[];
}

export const SHORT_BODY = '這是一段很短的說明文字,遠遠不到一百字。';
export const LONG_BODY = '長'.repeat(101); // 101 個 CJK 字 = 101 字,超過 100

export function defaultTopicCards(n = 3): TopicCard[] {
  return Array.from({ length: n }, (_, i) => ({ title: `主題卡 ${i + 1}`, body: `${SHORT_BODY}(第 ${i + 1} 張)`, examples: [] }));
}

function result(text: string): LlmResult {
  return { text, provider: 'fake', model: 'scripted', latency_ms: 0, provisional: false };
}

export function topicRouter(opts: TopicRouterOptions = {}): TopicRouter {
  const calls: { task: LlmTask; prompt: string }[] = [];
  const cards = opts.cards ?? defaultTopicCards();
  const regen = opts.regenerateBodies ?? [SHORT_BODY];
  let regenIndex = 0;
  let probeCount = 0;
  const childCount = opts.childCount ?? 1;
  const topicPrompts: string[] = [];
  const regeneratePrompts: string[] = [];

  const router: LlmRouter = {
    async call(task: LlmTask, prompt: string): Promise<LlmResult> {
      calls.push({ task, prompt });
      if (opts.offline) throw new Error('離線:不該呼叫 LLM');
      if (task === 'ingest.cards') {
        if (prompt.includes('parent_id:')) {
          return result(JSON.stringify(Array.from({ length: childCount }, (_, i) => ({ title: `子概念 ${i + 1}`, body: `${SHORT_BODY}(子卡 ${i + 1})`, examples: [] }))));
        }
        if (prompt.includes('previous body:')) {
          regeneratePrompts.push(prompt);
          const body = regen[Math.min(regenIndex, regen.length - 1)]!;
          regenIndex += 1;
          return result(JSON.stringify([{ body }]));
        }
        topicPrompts.push(prompt);
        return result(JSON.stringify(opts.withLines ? cards.map((c, i) => ({ ...c, lines: [i * 2 + 1, i * 2 + 2] })) : cards));
      }
      if (task === 'ingest.questions') {
        return result(
          JSON.stringify({
            fill: [
              { prompt: '這張卡的重點是 ___。', answers: [['重點']] },
              { prompt: '另一個重點是 ___。', answers: [['另一個']] },
            ],
            apply: [{ prompt: '請說明這張卡的概念。', rubric: ['有講到定義', '有舉出例子'] }],
          }),
        );
      }
      if (task === 'ingest.deps') {
        const ids = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1]!);
        const edges: [string, string][] = [];
        for (let i = 0; i + 1 < ids.length; i += 1) edges.push([ids[i]!, ids[i + 1]!]);
        return result(JSON.stringify({ edges }));
      }
      throw new Error(`topicRouter 沒有預期到 task=${task}`);
    },
    async probeOnline(): Promise<boolean> {
      probeCount += 1;
      return !opts.offline;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls, probes: () => probeCount, topicPrompts: () => topicPrompts, regeneratePrompts: () => regeneratePrompts };
}

/** 工單的正規化:trim、NFC、連續空白併成一個空白 */
export function normalizeTopic(topic: string): string {
  return topic.trim().normalize('NFC').replace(/\s+/g, ' ');
}

export const topicKey = (category: string, normalized: string): string => `topic:${category}:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
export const topicSha = (normalized: string): string => createHash('sha256').update(normalized, 'utf8').digest('hex');

/** cards/<分類>/ 底下的卡 id(排序) */
export function cardIdsIn(dir: string, category: string): string[] {
  const d = join(dir, 'cards', category);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md') && !f.endsWith('.short.md')).map((f) => f.replace(/\.md$/, '')).sort() : [];
}

/** state/ 底下所有檔(相對路徑,排序) */
export function stateFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (readdirSyncSafe(full)) walk(full, r);
      else out.push(r);
    }
  };
  walk(join(dir, 'state'), '');
  return out;
}

function readdirSyncSafe(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

export function readIngested(dir: string): Record<string, { sha256: string; cardIds: string[]; processedAt: string }> {
  const p = join(dir, 'state/ingested.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, { sha256: string; cardIds: string[]; processedAt: string }>) : {};
}
