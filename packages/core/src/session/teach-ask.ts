/**
 * 教學卡「問 AI」的背景工作、問答紀錄與結果(ADR-086,T68,歸 11)。照 teach-deepen.ts 的做法:
 * `ask()` 只在背景開始、馬上回;`poll()` 拿結果。側車同一時間只有一個請求(Rust 端 try_lock),
 * 所以雲端要等的那幾秒不能卡在 `ask()` 裡。
 *
 * 規則:
 * - 問的永遠是側車目前那張卡(teach.askContext),參數只有問題文字。
 * - 一次一個 ask;deepen 跑著時不能問(由 handler 傳 deepenRunning)。
 * - 換卡(handler 在每個換卡動作呼叫 invalidate)就丟掉還在跑的 ask、前幾輪問答與沒拿走的結果;晚到的回答由這裡丟掉。
 * - 呼叫前先查每日上限(`LLM_DAILY_CAP_USD`,0 = 沒有上限);到上限不呼叫。
 * - 看不懂的回答整個當失敗(不猜、不亮),失敗的那一輪不進討論。
 * - 不寫任何檔:問答只在記憶體。router 自己記 llm_call。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardId } from '@contracts/index.js';
import type { LlmRouter as GradingRouter } from '@core/grading/index.js';
import type { LlmRouter } from '@core/llm/index.js';
import { ExplicitLedger } from '@core/llm/ledger.js';
import { isBudgetExhausted, readDailyCapUsd, readDailySpend, readSpendPrices } from '@core/llm/spend.js';
import { buildAskPrompt, parseAskAnswer, type AskAnswer, type AskRound } from '../teach/ask.js';
import type { AskContext, createTeachRuntime } from './teach.js';

type TeachRuntime = ReturnType<typeof createTeachRuntime>;

const PROMPT_PATH = join(import.meta.dirname, '../../prompts/teach/ask.md');

export type AskErrorKind = 'unreadable' | 'no-model' | 'budget' | 'failed';

export const ASK_ERROR_MESSAGES: Record<AskErrorKind, string> = {
  unreadable: '這次的回答看不懂,可以再問一次。',
  'no-model': '現在連不上雲端,也沒有可用的本機模型,沒辦法回答。可以先繼續讀。',
  budget: '今天問 AI 的額度已經用完了,明天再問。可以先繼續讀。',
  failed: '這次沒有問成功,可以再問一次。',
};

const UNKNOWN_SPEND_MESSAGE = '今天的花費算不出來(帳本有問題),先不問 AI。可以先繼續讀。';

export type AskHighlight = 'next' | 'deepen' | { prereq: CardId } | null;

export type AskResult =
  | { answer: string; provisional: boolean; suggestion: AskAnswer['suggestion']; highlight: AskHighlight; followups: string[] }
  | { error: AskErrorKind; message: string };

export type AskStart = { ok: true } | { ok: false; kind: 'bad-request' };
export type AskPoll = { state: 'idle' } | { state: 'asking' } | { state: 'done'; ask: AskResult };

export interface AskControllerDeps {
  learningDir: string;
  today(): string;
  env: NodeJS.ProcessEnv;
  teach: TeachRuntime;
  /** deepen 跑著時為 true:這時不能問。 */
  deepenRunning(): boolean;
  /** 重讀 .env(內容變了就丟掉舊 router)然後拿 router。 */
  acquireRouter(): Promise<GradingRouter>;
}

export interface AskController {
  /** 在背景開始問。回 ok 之後用 poll 拿結果;不能問(沒有卡、已有一個在跑、deepen 在跑)回 bad-request。 */
  ask(question: string): AskStart;
  poll(): AskPoll;
  running(): boolean;
  /** 丟掉還在跑的 ask 與沒拿走的結果,保留前幾輪問答(deepen 開始時用;卡有沒有換等下次問時比對)。 */
  abandon(): void;
  /** 換卡:丟掉一切(在跑的、結果、前幾輪問答)。 */
  invalidate(): void;
  shutdown(): void;
}

interface Job {
  cancelled: boolean;
}

function errorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
}

function highlightFor(suggestion: AskAnswer['suggestion'], ctx: AskContext): AskHighlight {
  if (suggestion === 'continue') return 'next';
  if (suggestion === 'deepen') return ctx.atFloor ? null : 'deepen';
  const first = ctx.prereqs[0];
  return first === undefined ? null : { prereq: first.id as CardId };
}

function failure(kind: AskErrorKind, message = ASK_ERROR_MESSAGES[kind]): AskResult {
  return { error: kind, message };
}

export function createAskController(deps: AskControllerDeps): AskController {
  let job: Job | undefined;
  let result: AskResult | undefined;
  let history: AskRound[] = [];
  let historyCard: string | undefined;

  function drop(): void {
    if (job) job.cancelled = true;
    job = undefined;
    result = undefined;
  }

  /** 呼叫前查今天的花費。回 undefined = 可以呼叫。 */
  function budgetBlock(): AskResult | undefined {
    try {
      const logPath = join(deps.learningDir, 'state', 'log.jsonl');
      const ledger = ExplicitLedger.unverified(logPath, '側車只讀今日花費,不寫;學習目錄由側車啟動時的指標檔驗證過');
      const spent = readDailySpend(ledger, deps.today(), readSpendPrices(deps.env));
      return isBudgetExhausted(spent.usd, readDailyCapUsd(deps.env)) ? failure('budget') : undefined;
    } catch {
      return failure('budget', UNKNOWN_SPEND_MESSAGE);
    }
  }

  async function run(mine: Job, ctx: AskContext, question: string, prior: AskRound[]): Promise<void> {
    const finish = (outcome: AskResult): void => {
      if (job === mine && !mine.cancelled) result = outcome;
    };
    try {
      const router = (await deps.acquireRouter()) as unknown as LlmRouter;
      if (mine.cancelled) return;
      const template = readFileSync(PROMPT_PATH, 'utf8');
      const prompt = buildAskPrompt({
        template,
        card: {
          category: ctx.card.frontmatter.category,
          title: ctx.card.frontmatter.title,
          level: ctx.card.frontmatter.level,
          body: ctx.card.body,
          examples: ctx.card.examples,
          unlearnedPrereqTitles: ctx.prereqs.map((p) => p.title),
          atFloor: ctx.atFloor,
        },
        history: prior,
        question,
      });
      const response = await router.call('teach.ask', prompt);
      if (mine.cancelled) return;
      const parsed = parseAskAnswer(response.text);
      if (!parsed.ok) {
        finish(failure('unreadable'));
        return;
      }
      history = [...prior, { question, answer: parsed.value.answer }];
      historyCard = ctx.card.frontmatter.id;
      finish({
        answer: parsed.value.answer,
        provisional: response.provisional === true,
        suggestion: parsed.value.suggestion,
        highlight: highlightFor(parsed.value.suggestion, ctx),
        followups: parsed.value.followups,
      });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'NO_MODEL') finish(failure('no-model'));
      else if (code === 'BUDGET_EXCEEDED') finish(failure('budget'));
      else finish(failure('failed'));
    } finally {
      if (job === mine) job = undefined;
    }
  }

  return {
    running: () => job !== undefined,

    ask(question: string): AskStart {
      if (job !== undefined || deps.deepenRunning()) return { ok: false, kind: 'bad-request' };
      const ctx = deps.teach.askContext();
      if (ctx === undefined) return { ok: false, kind: 'bad-request' };
      result = undefined;
      if (historyCard !== ctx.card.frontmatter.id) {
        history = [];
        historyCard = ctx.card.frontmatter.id;
      }
      const blocked = budgetBlock();
      if (blocked !== undefined) {
        result = blocked;
        return { ok: true };
      }
      const mine: Job = { cancelled: false };
      job = mine;
      void run(mine, ctx, question, history);
      return { ok: true };
    },

    poll(): AskPoll {
      if (job !== undefined) return { state: 'asking' };
      if (result !== undefined) return { state: 'done', ask: result };
      return { state: 'idle' };
    },

    abandon(): void {
      drop();
    },

    invalidate(): void {
      drop();
      history = [];
      historyCard = undefined;
    },

    shutdown(): void {
      drop();
      history = [];
      historyCard = undefined;
    },
  };
}
