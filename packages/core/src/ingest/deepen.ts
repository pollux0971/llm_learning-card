/**
 * 深入這個的生成與寫入(ADR-079,歸 02)。
 * 生成只在記憶體裡做;寫入是呼叫端確認沒被取消之後的一段同步工作。
 * 每一個呼叫都用 task `deepen`。不改 prompts/。
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { Card, CardId, CategoryId, QuestionFile } from '@contracts/index.js';
import { credentialProblem, type CredentialProblem } from '@core/llm/credentials.js';
import { NoModelError, TASK_MAX_TOKENS, type LlmRouter } from '@core/llm/index.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';
import { readCategoryGraph, type Graph } from '@core/schema/graph.js';
import { recordEvent } from '@core/schema/log.js';
import { validateCard } from '@core/schema/validate-card.js';
import { generateChildren, renderCardFile } from './children.js';
import { writeCategoryGraph } from './deps.js';
import { enforceWordLimit } from './generate-cards.js';
import { generateQuestions } from './questions.js';

export class DeepenStopped extends Error {
  constructor() {
    super('deepen stopped');
    this.name = 'DeepenStopped';
  }
}

export interface PreparedCard {
  card: Card;
  questions: QuestionFile;
  provisional: boolean;
}

export type GenerateDeepenResult =
  | { kind: 'cards'; cards: PreparedCard[]; skipped: number }
  | { kind: 'no-model' }
  | { kind: 'failed' }
  | { kind: 'stopped' }
  | { kind: 'credential'; problem: CredentialProblem };

export interface GenerateDeepenArgs {
  parent: Card;
  router: LlmRouter;
  learningDir: string;
  today: string;
  env: NodeJS.ProcessEnv;
  /** 每一個呼叫之前問一次。要停就不再發呼叫。 */
  shouldStop: () => boolean;
}

function stoppingRouter(inner: LlmRouter, shouldStop: () => boolean, onResult: (provisional: boolean) => void): LlmRouter {
  return {
    call: async (task, prompt, opts) => {
      if (shouldStop()) throw new DeepenStopped();
      const result = await inner.call(task, prompt, opts);
      if (result.provisional) onResult(true);
      return result;
    },
    probeOnline: () => inner.probeOnline(),
    probeLocal: () => inner.probeLocal(),
  };
}

function credentialOf(err: unknown, env: NodeJS.ProcessEnv): CredentialProblem | undefined {
  return credentialProblem(err, env);
}

/**
 * 生 1..3 張下一層的卡(含字數重試與考題),不寫檔。
 * 子卡那個呼叫丟 NoModelError → no-model;其餘格式問題 → failed。
 * 單張考題失敗只略過那張。張張都略過 → failed。
 */
export async function generateDeepen(args: GenerateDeepenArgs): Promise<GenerateDeepenResult> {
  const { parent, learningDir, today, env, shouldStop } = args;
  let childrenProvisional = false;
  const childRouter = stoppingRouter(args.router, shouldStop, (provisional) => {
    if (provisional) childrenProvisional = true;
  });
  let drafted: Card[];
  try {
    drafted = await generateChildren(parent, childRouter, {
      outDir: learningDir,
      today,
      task: 'deepen',
    });
  } catch (err) {
    if (err instanceof DeepenStopped) return { kind: 'stopped' };
    if (err instanceof NoModelError) return { kind: 'no-model' };
    const problem = credentialOf(err, env);
    if (problem !== undefined) return { kind: 'credential', problem };
    return { kind: 'failed' };
  }

  const parentId = parent.frontmatter.id;
  const kept: PreparedCard[] = [];
  let skipped = 0;
  for (const draft of drafted) {
    if (shouldStop()) return { kind: 'stopped' };
    let cardProvisional = childrenProvisional;
    const cardRouter = stoppingRouter(args.router, shouldStop, (provisional) => {
      if (provisional) cardProvisional = true;
    });
    let limited: Awaited<ReturnType<typeof enforceWordLimit>>;
    try {
      limited = await enforceWordLimit(
        (task, prompt) => cardRouter.call(task, prompt),
        'deepen',
        parent.frontmatter.category,
        parent.frontmatter.id,
        { title: draft.frontmatter.title, body: draft.body, examples: draft.examples },
      );
    } catch (err) {
      if (err instanceof DeepenStopped) return { kind: 'stopped' };
      const problem = credentialOf(err, env);
      if (problem !== undefined) return { kind: 'credential', problem };
      if (err instanceof NoModelError) {
        skipped += 1;
        continue;
      }
      return { kind: 'failed' };
    }
    if (!limited.accepted) {
      skipped += 1;
      continue;
    }
    const card: Card = {
      ...draft,
      body: limited.body,
      examples: limited.examples,
      frontmatter: {
        ...draft.frontmatter,
        prereqs: [parentId],
        provisional: cardProvisional,
      },
    };
    try {
      const questions = await generateQuestions(card, cardRouter, undefined, {
        task: 'deepen',
        maxTokens: TASK_MAX_TOKENS['ingest.questions'],
      });
      card.frontmatter.provisional = cardProvisional;
      kept.push({ card, questions, provisional: cardProvisional });
    } catch (err) {
      if (err instanceof DeepenStopped) return { kind: 'stopped' };
      const problem = credentialOf(err, env);
      if (problem !== undefined) return { kind: 'credential', problem };
      skipped += 1;
    }
  }
  if (shouldStop()) return { kind: 'stopped' };
  if (kept.length === 0) return { kind: 'failed' };
  return { kind: 'cards', cards: kept, skipped };
}

export type CommitDeepenResult = { ok: true; ids: string[] } | { ok: false; kind: 'collision' };

function cardPath(learningDir: string, category: string, id: string): string {
  return join(learningDir, 'cards', category, `${id}.md`);
}

function questionPath(learningDir: string, id: string): string {
  return join(learningDir, 'questions', `${id}.yaml`);
}

function logPathOf(learningDir: string): string {
  return join(learningDir, 'state', 'log.jsonl');
}

function targetsExist(learningDir: string, category: string, ids: readonly string[]): boolean {
  for (const id of ids) {
    if (existsSync(cardPath(learningDir, category, id))) return true;
    if (existsSync(questionPath(learningDir, id))) return true;
  }
  return false;
}

/**
 * 同步寫入。呼叫端要先確認沒被取消、而且這個工作還是目前的工作。
 * 順序:考題檔 → 卡檔 → 圖 → deepened。中間沒有 await。
 */
export function commitDeepen(args: {
  learningDir: string;
  parentId: string;
  category: string;
  cards: PreparedCard[];
  skipped: number;
}): CommitDeepenResult {
  const { learningDir, parentId, category, cards, skipped } = args;
  const ids = cards.map((item) => item.card.frontmatter.id);
  if (targetsExist(learningDir, category, ids)) return { ok: false, kind: 'collision' };

  const texts = cards.map((item) => renderCardFile(item.card));
  for (const text of texts) {
    if (!validateCard(text).ok) return { ok: false, kind: 'collision' };
  }

  mkdirSync(join(learningDir, 'questions'), { recursive: true });
  mkdirSync(join(learningDir, 'cards', category), { recursive: true });
  for (const item of cards) {
    const file = item.questions;
    writeFileAtomic(questionPath(learningDir, file.card), yamlStringify({ card: file.card, fill: file.fill, apply: file.apply }));
  }
  for (let i = 0; i < cards.length; i += 1) {
    const item = cards[i]!;
    writeFileAtomic(cardPath(learningDir, category, item.card.frontmatter.id), texts[i]!);
  }

  updateGraph(learningDir, category, parentId, ids);
  const logPath = logPathOf(learningDir);
  mkdirSync(dirname(logPath), { recursive: true });
  const provisional = cards.some((item) => item.provisional);
  recordEvent(logPath, {
    ts: new Date().toISOString(),
    type: 'deepened',
    card: parentId as CardId,
    children: ids,
    provisional,
    skipped,
  });
  if (skipped > 0) {
    recordEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      card: parentId as CardId,
      message: `深入 ${parentId} 時略過了 ${skipped} 張。`,
      skipped,
    });
  }
  return { ok: true, ids };
}

function updateGraph(learningDir: string, category: string, parentId: string, ids: readonly string[]): void {
  const logPath = logPathOf(learningDir);
  let graph: Graph;
  try {
    graph = readCategoryGraph(learningDir, category as CategoryId);
  } catch {
    mkdirSync(dirname(logPath), { recursive: true });
    recordEvent(logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      card: parentId as CardId,
      message: `分類 ${category} 的依賴圖讀不到,沒有更新圖。建議重跑 ingest。`,
    });
    return;
  }
  const nodes = [...graph.nodes];
  const edges = graph.edges.map(([from, to]) => [from, to] as [CardId, CardId]);
  for (const id of ids) {
    const cardId = id as CardId;
    if (!nodes.includes(cardId)) nodes.push(cardId);
    edges.push([parentId as CardId, cardId]);
  }
  writeCategoryGraph(learningDir, category as CategoryId, { nodes, edges });
}
