import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, QuestionFile } from '@contracts/index.js';
import type { LlmResult, LlmRouter, LlmTask } from '@core/llm/index.js';
import { validateQuestionFile } from '@core/schema/validate-question.js';
import { generateQuestions, generateQuestionsForCards, writeQuestionFile } from './questions.js';
import { loadPromptTemplate } from './prompts.js';

// ---------------------------------------------------------------- 共用 fixture

/** phase-2.feature Background:「a learning directory containing five level zero cards」 */
function makeCard(id: string, overrides: Partial<Card['frontmatter']> = {}): Card {
  return {
    frontmatter: {
      id,
      category: 'security',
      title: `測試卡 ${id}`,
      level: 0,
      source: 'raw',
      created: '2026-09-01',
      source_ref: `raw/security/web-basics.md#L1-L10`,
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
      ...overrides,
    },
    body: '這是一張用來測試考題產生的卡片內容,講的是同源政策的基本概念與判定條件。',
    examples: [],
  };
}

const FIVE_CARDS: Card[] = [
  makeCard('sec-0001'),
  makeCard('sec-0002'),
  makeCard('sec-0003'),
  makeCard('sec-0004'),
  makeCard('sec-0005'),
];

/** 一份格式正確、通得過驗證器的考題候選(模型回應,不含 card id)。 */
function goodCandidateJson(): string {
  return JSON.stringify({
    fill: [
      {
        prompt: '同源的判定條件是 ___、___、___ 三者相同。',
        answers: [
          ['協定', 'protocol', 'scheme'],
          ['主機', 'host', 'domain'],
          ['埠號', 'port'],
        ],
      },
      {
        prompt: 'https://a.com 和 http://a.com 是否同源?___',
        answers: [['否', '不同源', 'no']],
      },
    ],
    apply: [
      {
        prompt: '你的前端在 https://app.example.com,要呼叫 https://api.example.com。會遇到什麼問題?',
        rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許', '沒有事實錯誤'],
      },
    ],
  });
}

/** 呼叫次數導向的假 router:第 callIndex 次呼叫時執行 script[callIndex]。 */
function makeScriptedRouter(script: Array<(task: LlmTask, prompt: string) => string>): {
  router: LlmRouter;
  calls: { task: string; prompt: string }[];
} {
  const calls: { task: string; prompt: string }[] = [];
  const router: LlmRouter = {
    async call(task, prompt): Promise<LlmResult> {
      const index = calls.length;
      calls.push({ task, prompt });
      const handler = script[index];
      if (!handler) throw new Error(`script 沒有第 ${index} 次呼叫的回應`);
      return { text: handler(task, prompt), provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls };
}

/** 固定回同一份合法考題的 router,不管呼叫幾次、傳什麼 prompt。 */
function makeAlwaysGoodRouter(): { router: LlmRouter; calls: { task: string; prompt: string }[] } {
  const calls: { task: string; prompt: string }[] = [];
  const router: LlmRouter = {
    async call(task, prompt): Promise<LlmResult> {
      calls.push({ task, prompt });
      return { text: goodCandidateJson(), provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls };
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeOutDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'lc-questions-'));
  return dir;
}

// ============================================================== generateQuestions

describe('generateQuestions', () => {
  // Scenario: Every level zero card gets a question file
  it('calls the ingest.questions task and returns a QuestionFile carrying the card id', async () => {
    const { router, calls } = makeAlwaysGoodRouter();
    const card = makeCard('sec-0001');

    const result = await generateQuestions(card, router);

    expect(result.card).toBe('sec-0001');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe('ingest.questions');
  });

  // Scenario: Every level zero card gets a question file — "passes the validator"
  it('returns a QuestionFile that passes validateQuestionFile', async () => {
    const { router } = makeAlwaysGoodRouter();
    const card = makeCard('sec-0002');

    const result = await generateQuestions(card, router);

    expect(validateQuestionFile(result)).toEqual({ ok: true, errors: [] });
  });

  // Scenario: Fill questions come in pairs or triples
  it('produces between 2 and 3 fill questions', async () => {
    const { router } = makeAlwaysGoodRouter();
    const result = await generateQuestions(makeCard('sec-0003'), router);

    expect(result.fill.length).toBeGreaterThanOrEqual(2);
    expect(result.fill.length).toBeLessThanOrEqual(3);
  });

  // Scenario: Fill questions come in pairs or triples — "at least one accepted synonym where one exists"
  it('keeps every recorded synonym for a blank that has more than one accepted answer', async () => {
    const { router } = makeAlwaysGoodRouter();
    const result = await generateQuestions(makeCard('sec-0004'), router);

    // 上面 goodCandidateJson() 的第一題第一個空格錄了三個同義詞,驗證它們原樣保留,
    // 不會被 generateQuestions 過濾掉只剩一個。
    expect(result.fill[0]!.answers[0]).toEqual(expect.arrayContaining(['協定', 'protocol', 'scheme']));
  });

  // Scenario: Rubric criteria can each be answered yes or no
  it('produces 1 or 2 apply questions with a rubric of 2 to 4 single-line statements', async () => {
    const { router } = makeAlwaysGoodRouter();
    const result = await generateQuestions(makeCard('sec-0005'), router);

    expect(result.apply.length).toBeGreaterThanOrEqual(1);
    expect(result.apply.length).toBeLessThanOrEqual(2);
    for (const apply of result.apply) {
      expect(apply.rubric.length).toBeGreaterThanOrEqual(2);
      expect(apply.rubric.length).toBeLessThanOrEqual(4);
      for (const line of apply.rubric) {
        expect(line.includes('\n')).toBe(false);
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('throws without writing anything when the model response is not valid JSON', async () => {
    const { router } = makeScriptedRouter([() => 'not json at all']);

    await expect(generateQuestions(makeCard('sec-0001'), router)).rejects.toThrow('不是合法 JSON');
  });

  it('throws with the validator errors when the model response fails validateQuestionFile (e.g. only 1 fill question)', async () => {
    const { router } = makeScriptedRouter([
      () =>
        JSON.stringify({
          fill: [{ prompt: '只有一個空格 ___', answers: [['答案']] }],
          apply: [{ prompt: '應用題', rubric: ['條件一', '條件二'] }],
        }),
    ]);

    await expect(generateQuestions(makeCard('sec-0001'), router)).rejects.toThrow('未通過 validateQuestionFile');
  });

  // buildQuestionsPrompt 沒有另外匯出,只能透過送給 router 的 prompt 內容間接驗證
  it('sends a prompt built from the template, card id, title and body, separated by --- markers', async () => {
    const { router, calls } = makeAlwaysGoodRouter();
    const card = makeCard('sec-0001');

    await generateQuestions(card, router);

    const prompt = calls[0]!.prompt;
    const lines = prompt.split('\n');
    // 兩個 '---' 分隔線都要在:模板後一個、title 後一個(緊接 card.body)
    expect(lines.filter((l) => l === '---')).toHaveLength(2);
    expect(prompt).toContain('\n---\ncard: sec-0001\n');
    expect(prompt).toContain(`title: ${card.frontmatter.title}\n---\n`);
    expect(prompt.endsWith(card.body)).toBe(true);
    expect(prompt.startsWith(loadPromptTemplate('questions'))).toBe(true);
  });

  it('joins multiple validator errors with "; " in the thrown message', async () => {
    const { router } = makeScriptedRouter([
      () =>
        JSON.stringify({
          fill: [{ prompt: '只有一個空格 ___', answers: [['答案']] }], // fill 數量不足(需要 2-3)
          apply: [], // apply 數量不足(需要 1-2)
        }),
    ]);

    const rejection = generateQuestions(makeCard('sec-0001'), router);
    await expect(rejection).rejects.toThrow(/; /);
  });
});

// ============================================================== writeQuestionFile

describe('writeQuestionFile', () => {
  it('writes to questions/<card>.yaml as parseable YAML matching the QuestionFile', () => {
    const outDir = makeOutDir();
    const file: QuestionFile = {
      card: 'sec-0001',
      fill: [{ prompt: '___ 是什麼?', answers: [['答案']] }],
      apply: [{ prompt: '應用題', rubric: ['條件一', '條件二'] }],
    };

    writeQuestionFile(outDir, file);

    const path = join(outDir, 'questions', 'sec-0001.yaml');
    expect(existsSync(path)).toBe(true);
    expect(yamlParse(readFileSync(path, 'utf8'))).toEqual(file);
  });

  it('creates the questions/ directory when it does not exist yet', () => {
    const outDir = makeOutDir();
    expect(existsSync(join(outDir, 'questions'))).toBe(false);

    writeQuestionFile(outDir, { card: 'sec-0001', fill: [{ prompt: '___', answers: [['x']] }], apply: [{ prompt: 'p', rubric: ['a', 'b'] }] });

    expect(existsSync(join(outDir, 'questions'))).toBe(true);
  });
});

// ============================================================== generateQuestionsForCards

describe('generateQuestionsForCards', () => {
  // Scenario: Every level zero card gets a question file (batch form)
  it('writes one question file per card, each carrying the matching card id', async () => {
    const outDir = makeOutDir();
    mkdirSync(join(outDir, 'questions'), { recursive: true });
    const { router } = makeAlwaysGoodRouter();

    const result = await generateQuestionsForCards(outDir, FIVE_CARDS, router);

    expect(result.written).toEqual(FIVE_CARDS.map((c) => c.frontmatter.id));
    expect(result.failures).toEqual([]);
    for (const card of FIVE_CARDS) {
      const path = join(outDir, 'questions', `${card.frontmatter.id}.yaml`);
      expect(existsSync(path)).toBe(true);
      const parsed = yamlParse(readFileSync(path, 'utf8')) as QuestionFile;
      expect(parsed.card).toBe(card.frontmatter.id);
      expect(validateQuestionFile(parsed).ok).toBe(true);
    }
  });

  // Scenario: Generation failure for one card does not lose the others
  it('records a failure for the third card by id and still writes the other four', async () => {
    const outDir = makeOutDir();
    mkdirSync(join(outDir, 'questions'), { recursive: true });
    const { router } = makeScriptedRouter([
      () => goodCandidateJson(),
      () => goodCandidateJson(),
      () => {
        throw new Error('model unavailable for this card');
      },
      () => goodCandidateJson(),
      () => goodCandidateJson(),
    ]);

    const result = await generateQuestionsForCards(outDir, FIVE_CARDS, router);

    expect(result.failures).toEqual([{ card: 'sec-0003', error: expect.any(String) }]);
    expect(result.written).toEqual(['sec-0001', 'sec-0002', 'sec-0004', 'sec-0005']);
    for (const id of ['sec-0001', 'sec-0002', 'sec-0004', 'sec-0005']) {
      expect(existsSync(join(outDir, 'questions', `${id}.yaml`))).toBe(true);
    }
    expect(existsSync(join(outDir, 'questions', 'sec-0003.yaml'))).toBe(false);
  });
});
