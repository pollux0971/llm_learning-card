import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parse as yamlParse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@contracts/index.js';
import type { LlmResult, LlmRouter } from '@core/llm/index.js';
import { validateQuestionFile } from '@core/schema/validate-question.js';
import { generateChildren, generateChildrenForCards, type ChildCandidate } from './children.js';
import { loadPromptTemplate } from './prompts.js';

// ---------------------------------------------------------------- 共用 fixture

function makeParentCard(id: string): Card {
  return {
    frontmatter: {
      id,
      category: 'security',
      title: `父卡 ${id}`,
      level: 0,
      source: 'raw',
      created: '2026-09-01',
      source_ref: 'raw/security/web-basics.md#L1-L10',
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
    },
    body: '同源政策的基本概念,防止惡意網站讀取其他站台的資料。',
    examples: [],
  };
}

function childCandidate(title: string): ChildCandidate {
  return { title, body: `${title} 的細節說明,展開自父卡的其中一個子概念。`, examples: [] };
}

/** 依 task 分派回應的假 router;'ingest.cards' 與 'ingest.questions' 各自維護自己的呼叫佇列。 */
function makeRouter(opts: {
  cardsResponses: ChildCandidate[][];
  questionsResponse?: () => string;
}): { router: LlmRouter; cardsCalls: string[]; questionsCalls: string[] } {
  const cardsCalls: string[] = [];
  const questionsCalls: string[] = [];
  let cardsIndex = 0;
  const router: LlmRouter = {
    async call(task, prompt): Promise<LlmResult> {
      if (task === 'ingest.cards') {
        cardsCalls.push(prompt);
        const candidates = opts.cardsResponses[cardsIndex];
        cardsIndex += 1;
        if (!candidates) throw new Error(`沒有第 ${cardsIndex} 次 ingest.cards 呼叫的回應`);
        return { text: JSON.stringify(candidates), provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
      }
      if (task === 'ingest.questions') {
        questionsCalls.push(prompt);
        const text = opts.questionsResponse
          ? opts.questionsResponse()
          : JSON.stringify({
              fill: [
                { prompt: '___ 是什麼?', answers: [['答案']] },
                { prompt: '___ 呢?', answers: [['另一個答案']] },
              ],
              apply: [{ prompt: '應用題', rubric: ['條件一', '條件二'] }],
            });
        return { text, provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
      }
      throw new Error(`未預期的 task: ${task}`);
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, cardsCalls, questionsCalls };
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** 依 ids.ts 的配發規則(前綴取分類前三個字母)先放好 sec-0001..sec-000n,模擬既有卡片。 */
function makeOutDirWithExistingCards(count: number): string {
  dir = mkdtempSync(join(tmpdir(), 'lc-children-'));
  const cardsDir = join(dir, 'cards', 'security');
  mkdirSync(cardsDir, { recursive: true });
  mkdirSync(join(dir, 'questions'), { recursive: true });
  for (let i = 1; i <= count; i++) {
    const id = `sec-${String(i).padStart(4, '0')}`;
    writeFileSync(
      join(cardsDir, `${id}.md`),
      ['---', `id: ${id}`, 'category: security', 'title: 既有卡', 'level: 0', 'source: raw', 'created: 2026-09-01', '---', '', '既有內容'].join('\n'),
      'utf8',
    );
  }
  return dir;
}

// ============================================================== generateChildren

describe('generateChildren', () => {
  it('returns between 1 and 3 children, each naming the parent, with source llm and empty prereqs/flags', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router } = makeRouter({ cardsResponses: [[childCandidate('子概念一'), childCandidate('子概念二')]] });

    const children = await generateChildren(makeParentCard('sec-0001'), router, { outDir });

    expect(children.length).toBeGreaterThanOrEqual(1);
    expect(children.length).toBeLessThanOrEqual(3);
    for (const child of children) {
      expect(child.frontmatter.parent).toBe('sec-0001');
      expect(child.frontmatter.source).toBe('llm');
      expect(child.frontmatter.level).toBe(1);
      expect(child.frontmatter.category).toBe('security');
      // prereqs 先給空陣列——先備關係是 deps.ts 事後才填,子卡產生當下不用猜
      expect(child.frontmatter.prereqs).toEqual([]);
      expect(child.frontmatter.provisional).toBe(false);
      expect(child.frontmatter.stale).toBe(false);
      expect(child.frontmatter.source_missing).toBe(false);
    }
  });

  it('sends a prompt built from the template, parent id, parent title and parent body', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router, cardsCalls } = makeRouter({ cardsResponses: [[childCandidate('子概念一')]] });
    const parent = makeParentCard('sec-0001');

    await generateChildren(parent, router, { outDir });

    const prompt = cardsCalls[0]!;
    const lines = prompt.split('\n');
    // 兩個 '---' 分隔線都要在:模板後一個、parent_title 後一個(緊接 parent.body)
    expect(lines.filter((l) => l === '---')).toHaveLength(2);
    expect(prompt).toContain(`\n---\nparent_id: ${parent.frontmatter.id}\n`);
    expect(prompt).toContain(`parent_title: ${parent.frontmatter.title}\n---\n`);
    expect(prompt.endsWith(parent.body)).toBe(true);
    expect(prompt.startsWith(loadPromptTemplate('children'))).toBe(true);
  });

  it('accepts exactly one child (lower boundary)', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router } = makeRouter({ cardsResponses: [[childCandidate('子概念一')]] });

    const children = await generateChildren(makeParentCard('sec-0001'), router, { outDir });

    expect(children).toHaveLength(1);
  });

  it('accepts exactly three children (upper boundary)', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router } = makeRouter({
      cardsResponses: [[childCandidate('a'), childCandidate('b'), childCandidate('c')]],
    });

    const children = await generateChildren(makeParentCard('sec-0001'), router, { outDir });

    expect(children).toHaveLength(3);
  });

  it('assigns ids continuing from the existing cards in that category', async () => {
    const outDir = makeOutDirWithExistingCards(5);
    const { router } = makeRouter({ cardsResponses: [[childCandidate('子概念一'), childCandidate('子概念二')]] });

    const children = await generateChildren(makeParentCard('sec-0001'), router, { outDir });

    expect(children.map((c) => c.frontmatter.id)).toEqual(['sec-0006', 'sec-0007']);
  });

  it('uses today\'s real date for created when opts.today is not given', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router } = makeRouter({ cardsResponses: [[childCandidate('子概念一')]] });

    const children = await generateChildren(makeParentCard('sec-0001'), router, { outDir });

    const today = new Date().toISOString().slice(0, 10);
    expect(children[0]!.frontmatter.created).toBe(today);
  });

  it('throws when the model response is not valid JSON', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const router: LlmRouter = {
      async call(): Promise<LlmResult> {
        return { text: 'not json at all', provider: 'anthropic', model: 'test-model', latency_ms: 1, provisional: false };
      },
      async probeOnline() {
        return true;
      },
      async probeLocal() {
        return { available: false, models: [] };
      },
    };

    await expect(generateChildren(makeParentCard('sec-0001'), router, { outDir })).rejects.toThrow('不是合法 JSON');
  });

  it('throws when the model response is valid JSON but not an array', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const router: LlmRouter = {
      async call(): Promise<LlmResult> {
        return {
          text: JSON.stringify({ title: '子概念一', body: '內容', examples: [] }),
          provider: 'anthropic',
          model: 'test-model',
          latency_ms: 1,
          provisional: false,
        };
      },
      async probeOnline() {
        return true;
      },
      async probeLocal() {
        return { available: false, models: [] };
      },
    };

    await expect(generateChildren(makeParentCard('sec-0001'), router, { outDir })).rejects.toThrow('回應必須是陣列');
  });

  it('throws naming the offending index when one candidate is missing a required field', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const router: LlmRouter = {
      async call(): Promise<LlmResult> {
        return {
          text: JSON.stringify([{ title: '子概念一', examples: [] }]), // 缺 body
          provider: 'anthropic',
          model: 'test-model',
          latency_ms: 1,
          provisional: false,
        };
      },
      async probeOnline() {
        return true;
      },
      async probeLocal() {
        return { available: false, models: [] };
      },
    };

    await expect(generateChildren(makeParentCard('sec-0001'), router, { outDir })).rejects.toThrow('第 0 筆格式不正確');
  });

  it('throws with a message naming the response count when the model returns zero children', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router } = makeRouter({ cardsResponses: [[]] });

    await expect(generateChildren(makeParentCard('sec-0001'), router, { outDir })).rejects.toThrow('筆數必須介於');
  });

  it('throws when the model returns more than three children', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const { router } = makeRouter({
      cardsResponses: [[childCandidate('a'), childCandidate('b'), childCandidate('c'), childCandidate('d')]],
    });

    await expect(generateChildren(makeParentCard('sec-0001'), router, { outDir })).rejects.toThrow('筆數必須介於');
  });
});

// ============================================================== generateChildrenForCards

describe('generateChildrenForCards', () => {
  // Scenario: Each card gets between one and three children
  it('writes each child under cards/<category>/ and gives it its own question file', async () => {
    const outDir = makeOutDirWithExistingCards(5);
    const { router } = makeRouter({
      cardsResponses: [[childCandidate('子概念一'), childCandidate('子概念二')], [childCandidate('子概念三')]],
    });

    const result = await generateChildrenForCards([makeParentCard('sec-0001'), makeParentCard('sec-0002')], router, { outDir });

    expect(result.children).toHaveLength(3);
    expect(result.questionFailures).toEqual([]);

    for (const child of result.children) {
      const cardPath = join(outDir, 'cards', 'security', `${child.frontmatter.id}.md`);
      expect(existsSync(cardPath)).toBe(true);
      const parsed = matter(readFileSync(cardPath, 'utf8'));
      expect(parsed.data.parent).toBe(child.frontmatter.parent);
      expect(parsed.data.source).toBe('llm');

      const questionPath = join(outDir, 'questions', `${child.frontmatter.id}.yaml`);
      expect(existsSync(questionPath)).toBe(true);
      expect(validateQuestionFile(yamlParse(readFileSync(questionPath, 'utf8'))).ok).toBe(true);
    }
  });

  it('writes the card body trimmed, frontmatter above it, and each example fenced with ```example on its own block', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const candidate: ChildCandidate = {
      title: '子概念一',
      body: '  縮排過的內容,前後都有空白。  ',
      examples: ['  範例一  ', '範例二'],
    };
    const { router } = makeRouter({ cardsResponses: [[candidate]] });

    const result = await generateChildrenForCards([makeParentCard('sec-0001')], router, { outDir });

    const cardPath = join(outDir, 'cards', 'security', `${result.children[0]!.frontmatter.id}.md`);
    const raw = readFileSync(cardPath, 'utf8');
    const parsed = matter(raw);
    expect(parsed.content.trim().startsWith('縮排過的內容,前後都有空白。')).toBe(true);
    expect(raw).toContain('```example\n範例一\n```\n\n```example\n範例二\n```');
    // yamlStringify(...).trimEnd() 之後緊接關閉的 '---',中間不該留一行空白
    expect(raw).not.toMatch(/\n\n---\n\n縮排/);
    expect(raw).toMatch(/\n---\n\n縮排/);
    // body 後面隔一個空行才接上例句區塊(前後各補一個 '\n')
    expect(raw).toContain('縮排過的內容,前後都有空白。\n\n```example\n範例一\n```\n\n```example\n範例二\n```\n');
    expect(raw.endsWith('```example\n範例二\n```\n')).toBe(true);
  });

  it('writes no trailing example block when the child has no examples', async () => {
    const outDir = makeOutDirWithExistingCards(1);
    const candidate: ChildCandidate = { title: '子概念一', body: '沒有範例的內容。', examples: [] };
    const { router } = makeRouter({ cardsResponses: [[candidate]] });

    const result = await generateChildrenForCards([makeParentCard('sec-0001')], router, { outDir });

    const cardPath = join(outDir, 'cards', 'security', `${result.children[0]!.frontmatter.id}.md`);
    const raw = readFileSync(cardPath, 'utf8');
    expect(raw).not.toContain('```example');
    expect(raw.endsWith('沒有範例的內容。\n')).toBe(true);
  });

  // 撞號防呆:兩個 parent 各自的子卡不能拿到重複 id——實作必須在處理完一個 parent
  // 之後立刻把子卡寫進磁碟,下一個 parent 呼叫 nextCardIds() 才看得到。
  it('does not assign the same id to children of different parents', async () => {
    const outDir = makeOutDirWithExistingCards(5);
    const { router } = makeRouter({
      cardsResponses: [[childCandidate('子概念一')], [childCandidate('子概念二')]],
    });

    const result = await generateChildrenForCards([makeParentCard('sec-0001'), makeParentCard('sec-0002')], router, { outDir });

    const ids = result.children.map((c) => c.frontmatter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records a per-child question failure without discarding the child card itself', async () => {
    const outDir = makeOutDirWithExistingCards(5);
    let questionsCallCount = 0;
    const { router } = makeRouter({
      cardsResponses: [[childCandidate('子概念一'), childCandidate('子概念二')]],
      questionsResponse: () => {
        questionsCallCount += 1;
        if (questionsCallCount === 2) throw new Error('model unavailable for this child');
        return JSON.stringify({
          fill: [
            { prompt: '___ 是什麼?', answers: [['答案']] },
            { prompt: '___ 呢?', answers: [['另一個答案']] },
          ],
          apply: [{ prompt: '應用題', rubric: ['條件一', '條件二'] }],
        });
      },
    });

    const result = await generateChildrenForCards([makeParentCard('sec-0001')], router, { outDir });

    expect(result.children).toHaveLength(2);
    expect(result.questionFailures).toHaveLength(1);
    expect(existsSync(join(outDir, 'cards', 'security', `${result.children[1]!.frontmatter.id}.md`))).toBe(true);
  });
});
