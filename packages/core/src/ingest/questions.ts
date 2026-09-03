/**
 * 介面契約(phase-2,給下一輪開發 agent):以下每個 export 只有簽章,函式體
 * 全部 throw new Error('not implemented')。行為規格見同目錄 questions.test.ts
 * 與 features/02-ingest-pipeline/phase-2.feature 的 Scenario 1、2、3、9——細節
 * 以測試為準,這裡的註解只點出邊界。
 *
 * 產生一張卡片的考題(契約 §3)。呼叫 LlmTask 'ingest.questions'(硬約定 §7,
 * cloud-only)。格式驗證直接用 01-data-layer 的 validateQuestionFile()——
 * fill 2..3 題、apply 1..2 題、rubric 2..4 條、blanks 數對上 answers 組數,
 * 全部已經是 QuestionFileSchema 的 superRefine 規則,這裡不重新發明。
 *
 * 批次跑一個分類時,單張卡的失敗(LLM 回應解析失敗、格式驗證不過)不影響其他
 * 卡——generateQuestionsForCards() 把每張卡的錯誤收進 failures(附 card id),
 * 繼續處理下一張,不中斷整個 run(Scenario 9:「Generation failure for one card
 * does not lose the others」)。
 *
 * 型別選擇:這裡直接用 @contracts/index.js 的 Card / QuestionFile 等——那是
 * 01-data-layer 已經做完的真型別,不是 ingest/types.ts 的 Wave 0 stub(那份留給
 * fake-llm.ts / word-count-min.ts,換不換是下一輪對「Wave 0 的重複」表的決定,
 * 跟這裡的新模組無關,新模組沒有理由背這筆技術債)。
 *
 * ---- 型別 ----
 * interface QuestionCandidate { fill: FillQuestion[]; apply: ApplyQuestion[] }  // 模型回應,不含 card id
 * interface GenerateQuestionsFailure { card: CardId; error: string }
 * interface GenerateQuestionsRunResult { written: CardId[]; failures: GenerateQuestionsFailure[] }
 *
 * ---- 函式 ----
 * generateQuestions(card: Card, router: LlmRouter): Promise<QuestionFile>
 *   呼叫 router.call('ingest.questions', prompt),把回應文字解析成 QuestionCandidate,
 *   接上 card.frontmatter.id 組成完整 QuestionFile,用 validateQuestionFile() 驗過;
 *   JSON 解析失敗或驗證不過都直接丟錯(不重試——這裡的錯誤代表 prompt/parse 本身
 *   有問題,重試也不會變好,跟 generate-cards.ts 的字數超限重試是不同性質的失敗)。
 * writeQuestionFile(outDir: string, file: QuestionFile): void
 *   寫到 outDir/questions/<file.card>.yaml,格式同 contracts/fixtures/learning-minimal
 *   既有的 questions/*.yaml(純 writeFileSync,不需要 §11b 的原子寫入——那條硬約定
 *   只管 state/,questions/ 是可重新生成的內容,跟 phase-1 的 cards/ 寫法一致)。
 * generateQuestionsForCards(outDir: string, cards: Card[], router: LlmRouter):
 *   Promise<GenerateQuestionsRunResult>
 *   對每張卡依序呼叫 generateQuestions() 並寫檔;單張失敗記進 failures(附 card id),
 *   其餘卡片繼續處理。written 只列出實際寫檔成功的 card id,長度加上
 *   failures.length 應等於 cards.length。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { ApplyQuestion, Card, CardId, FillQuestion, QuestionFile } from '@contracts/index.js';
import type { LlmRouter } from '@core/llm/index.js';
import { validateQuestionFile } from '@core/schema/validate-question.js';
import { loadPromptTemplate } from './prompts.js';

// Stryker disable next-line all: 模組載入時執行一次的靜態初始化,coverageAnalysis: perTest 下不歸屬任何測試(coveredBy 恆為空),
// 錯字會讓 readFileSync 在 import 當下就丟 ENOENT、整個測試檔案載入失敗,等同被所有測試殺死,只是 Stryker 的 per-test 模型算不出來。
const QUESTIONS_TEMPLATE = loadPromptTemplate('questions');

/** 模型對 'ingest.questions' 的回應形狀,不含 card id(呼叫端已經知道)。 */
export interface QuestionCandidate {
  fill: FillQuestion[];
  apply: ApplyQuestion[];
}

export interface GenerateQuestionsFailure {
  card: CardId;
  error: string;
}

export interface GenerateQuestionsRunResult {
  written: CardId[];
  failures: GenerateQuestionsFailure[];
}

function buildQuestionsPrompt(card: Card): string {
  return [QUESTIONS_TEMPLATE, '---', `card: ${card.frontmatter.id}`, `title: ${card.frontmatter.title}`, '---', card.body].join(
    '\n',
  );
}

export async function generateQuestions(card: Card, router: LlmRouter): Promise<QuestionFile> {
  const result = await router.call('ingest.questions', buildQuestionsPrompt(card));

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (err) {
    throw new Error(`ingest.questions 回應不是合法 JSON: ${(err as Error).message}`);
  }

  const candidate = parsed as Partial<QuestionCandidate>;
  const file: QuestionFile = {
    card: card.frontmatter.id,
    fill: (candidate.fill ?? []) as FillQuestion[],
    apply: (candidate.apply ?? []) as ApplyQuestion[],
  };

  const check = validateQuestionFile(file);
  if (!check.ok) {
    throw new Error(`ingest.questions 回應未通過 validateQuestionFile:${check.errors.join('; ')}`);
  }
  return file;
}

export function writeQuestionFile(outDir: string, file: QuestionFile): void {
  const dir = join(outDir, 'questions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${file.card}.yaml`), yamlStringify(file), 'utf8');
}

export async function generateQuestionsForCards(
  outDir: string,
  cards: Card[],
  router: LlmRouter,
): Promise<GenerateQuestionsRunResult> {
  const written: CardId[] = [];
  const failures: GenerateQuestionsFailure[] = [];

  for (const card of cards) {
    try {
      const file = await generateQuestions(card, router);
      writeQuestionFile(outDir, file);
      written.push(card.frontmatter.id);
    } catch (err) {
      failures.push({ card: card.frontmatter.id, error: (err as Error).message });
    }
  }

  return { written, failures };
}
