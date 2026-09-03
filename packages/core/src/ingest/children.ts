/**
 * 介面契約(phase-2,給下一輪開發 agent):以下每個 export 只有簽章,函式體
 * 全部 throw new Error('not implemented')。行為規格見同目錄 children.test.ts
 * 與 features/02-ingest-pipeline/phase-2.feature 的 Scenario 4。
 *
 * 產生 level 1 子卡(契約 §2)。呼叫 LlmTask 'ingest.cards'——契約 §7 的路由表
 * 沒有另開一個 task 給子卡生成,子卡跟 level 0 卡一樣都是「產生卡片」,只是
 * prompt 模板不同(下一輪開發 agent 補 prompts/ingest/children.md 時再決定要不要
 * 跟 cards.md 共用)。
 *
 * 每張 level 0 卡產生 1..3 張子卡:source==='llm'(沒有 raw 對應,不需要
 * source_ref)、parent 指向自己、level = parent.level + 1、prereqs 先給 []
 * (先備關係是 deps.ts 的 analyzeDependencies() 事後才填,這裡不用猜)。
 *
 * 子卡也要有自己的考題(Scenario 4:「each child has its own question file」)。
 * generateChildrenForCards() 組合呼叫 questions.ts 的 generateQuestionsForCards()
 * 幫全部子卡產生並寫入考題,直接重用它既有的「單張失敗不影響其他張」邏輯,
 * 不重新發明一套失敗收集機制。
 *
 * id 配發重用 ids.ts 的 nextCardIds()(phase-1 已經測過的邏輯)。實作上
 * generateChildrenForCards() 必須在處理完一個 parent 之後立刻把子卡寫進磁碟,
 * 才能讓下一個 parent 呼叫 nextCardIds() 時看到前一個 parent 已經用掉的編號——
 * 兩個 parent 的子卡不能撞號。
 *
 * ---- 型別 ----
 * interface ChildCandidate { title: string; body: string; examples: string[] }  // 模型回應,一張卡一筆
 * interface GenerateChildrenOptions { outDir: string; today?: string }          // today 覆寫「今天」,同 runIngest
 * interface GenerateChildrenResult {
 *   children: Card[];                                    // 所有 parent 產生的子卡,攤平成一個陣列
 *   questionFailures: GenerateQuestionsFailure[];         // 來自 questions.ts 的失敗收集,只轉發不重算
 * }
 *
 * ---- 函式 ----
 * generateChildren(parent: Card, router: LlmRouter, opts: GenerateChildrenOptions): Promise<Card[]>
 *   呼叫 router.call('ingest.cards', prompt),解析回應成 1..3 個 ChildCandidate,
 *   讀 opts.outDir 下 parent 分類已有的卡片配發新 id,組成完整 Card。回應筆數
 *   不是 1..3 就丟錯;不做字數重試(那是 level 0 卡才有的規則,子卡沒有)。
 *   只回傳,不寫檔——寫檔是 generateChildrenForCards() 的事,才能保證上面說的
 *   「立刻寫檔避免撞號」順序。
 * generateChildrenForCards(parents: Card[], router: LlmRouter, opts: GenerateChildrenOptions):
 *   Promise<GenerateChildrenResult>
 *   對每個 parent 依序呼叫 generateChildren()、把回傳的子卡寫進
 *   opts.outDir/cards/<category>/,全部 parent 處理完後,呼叫
 *   generateQuestionsForCards(opts.outDir, 攤平後的子卡, router) 幫子卡產生考題。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { Card, CardFrontmatter } from '@contracts/index.js';
import type { LlmRouter } from '@core/llm/index.js';
import { nextCardIds } from './ids.js';
import { generateQuestionsForCards, type GenerateQuestionsFailure } from './questions.js';
import { loadPromptTemplate } from './prompts.js';

// Stryker disable next-line all: 模組載入時執行一次的靜態初始化,coverageAnalysis: perTest 下不歸屬任何測試(coveredBy 恆為空),
// 錯字會讓 readFileSync 在 import 當下就丟 ENOENT、整個測試檔案載入失敗,等同被所有測試殺死,只是 Stryker 的 per-test 模型算不出來。
const CHILDREN_TEMPLATE = loadPromptTemplate('children');
const MIN_CHILDREN = 1;
const MAX_CHILDREN = 3;

/** 模型對 'ingest.cards' 的回應形狀(子卡版):一張卡一筆,沒有 lines(不是切自 raw)。 */
export interface ChildCandidate {
  title: string;
  body: string;
  examples: string[];
}

export interface GenerateChildrenOptions {
  /** learning 根目錄(絕對路徑)。 */
  outDir: string;
  /** 覆寫「今天」,格式 YYYY-MM-DD。預設用目前系統日期,同 runIngest。 */
  today?: string;
}

export interface GenerateChildrenResult {
  children: Card[];
  questionFailures: GenerateQuestionsFailure[];
}

function buildChildrenPrompt(parent: Card): string {
  return [
    CHILDREN_TEMPLATE,
    '---',
    `parent_id: ${parent.frontmatter.id}`,
    `parent_title: ${parent.frontmatter.title}`,
    '---',
    parent.body,
  ].join('\n');
}

function parseChildCandidates(text: string): ChildCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`ingest.cards(子卡)回應不是合法 JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('ingest.cards(子卡)回應必須是陣列');
  if (parsed.length < MIN_CHILDREN || parsed.length > MAX_CHILDREN) {
    throw new Error(`ingest.cards(子卡)回應筆數必須介於 ${MIN_CHILDREN}..${MAX_CHILDREN},得到 ${parsed.length}`);
  }

  return parsed.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    if (typeof r.title !== 'string' || typeof r.body !== 'string' || !Array.isArray(r.examples)) {
      throw new Error(`ingest.cards(子卡)回應第 ${i} 筆格式不正確: ${JSON.stringify(raw)}`);
    }
    return { title: r.title, body: r.body, examples: r.examples as string[] };
  });
}

function writeCardFile(cardsDir: string, card: Card): void {
  mkdirSync(cardsDir, { recursive: true });
  const yamlFm = yamlStringify(card.frontmatter).trimEnd();
  const exampleBlocks = card.examples.map((e) => '```example\n' + e.trim() + '\n```').join('\n\n');
  const content = `---\n${yamlFm}\n---\n\n${card.body.trim()}\n${exampleBlocks ? '\n' + exampleBlocks + '\n' : ''}`;
  writeFileSync(join(cardsDir, `${card.frontmatter.id}.md`), content, 'utf8');
}

export async function generateChildren(
  parent: Card,
  router: LlmRouter,
  opts: GenerateChildrenOptions,
): Promise<Card[]> {
  const result = await router.call('ingest.cards', buildChildrenPrompt(parent));
  const candidates = parseChildCandidates(result.text);

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const category = parent.frontmatter.category;
  const cardsDir = join(opts.outDir, 'cards', category);
  const ids = nextCardIds(cardsDir, category, candidates.length);

  return ids.map((id, i) => {
    const candidate = candidates[i]!;
    const frontmatter: CardFrontmatter = {
      id,
      category,
      title: candidate.title,
      level: parent.frontmatter.level + 1,
      source: 'llm',
      created: today,
      parent: parent.frontmatter.id,
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
    };
    return { frontmatter, body: candidate.body, examples: candidate.examples };
  });
}

export async function generateChildrenForCards(
  parents: Card[],
  router: LlmRouter,
  opts: GenerateChildrenOptions,
): Promise<GenerateChildrenResult> {
  const children: Card[] = [];

  for (const parent of parents) {
    const parentChildren = await generateChildren(parent, router, opts);
    const cardsDir = join(opts.outDir, 'cards', parent.frontmatter.category);
    for (const child of parentChildren) {
      writeCardFile(cardsDir, child);
    }
    children.push(...parentChildren);
  }

  const { failures } = await generateQuestionsForCards(opts.outDir, children, router);

  return { children, questionFailures: failures };
}
