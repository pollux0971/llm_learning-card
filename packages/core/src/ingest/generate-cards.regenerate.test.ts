/**
 * T19:regenerate 的回應不要求 `lines`(工單 docs/tickets/T19-regenerate-without-lines.md)。
 *
 * 全部走生產路徑 `generateCards(router, opts)`:第一次回應(cards.md 批次)給一張超過 100 字的卡,
 * 逼它呼叫 regenerate,再用假 router 決定 regenerate 回什麼。不呼叫真的 LLM。
 *
 * 原卡刻意跟回應長得不一樣(標題、行號、examples 都不同),才看得出「沿用原卡」還是「採用回應」。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCard } from '@core/schema/validate-card.js';
import { generateCards } from './generate-cards.js';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

interface ScriptedRouter extends LlmRouter {
  calls: { task: LlmTask; prompt: string }[];
}

/** 依序回傳 responses;用完還被呼叫就丟錯(多呼叫一次 = 測試要看得到)。 */
function scriptedRouter(responses: string[]): ScriptedRouter {
  const calls: { task: LlmTask; prompt: string }[] = [];
  return {
    calls,
    async call(task: LlmTask, prompt: string): Promise<LlmResult> {
      const text = responses[calls.length];
      calls.push({ task, prompt });
      if (text === undefined) throw new Error(`scriptedRouter: 第 ${calls.length} 次呼叫沒有預設回應`);
      return { text, provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

const OPTS = { relLabel: 'x.md', category: 'security', content: 'raw' };

/**
 * 卡檔文字,照 `ingest.ts` 的 `writeCardFile` 組(front matter、空一行、`body.trim()`、再接 example 圍欄)。
 * 字數的參考答案一律由寫檔前後把關的 `validateCard` 讀這份文字算出來(工單要求 4、顧問 Q3:同一條路)。
 */
function cardFileText(body: string, examples: string[] = []): string {
  const fm = [
    'id: sec-0001',
    'category: security',
    'title: 卡',
    'level: 0',
    'source: raw',
    'source_ref: raw/security/x.md#L3-L4',
    'created: 2026-10-16',
    'prereqs: []',
  ].join('\n');
  const exampleBlocks = examples.map((e) => '```example\n' + e.trim() + '\n```').join('\n\n');
  return `---\n${fm}\n---\n\n${body.trim()}\n${exampleBlocks ? '\n' + exampleBlocks + '\n' : ''}`;
}

/** validateCard 算出的 body 字數。測試資料的預期值都用它核對。 */
const ref = (body: string) => validateCard(cardFileText(body)).bodyWordCount;

/** `GenerateCardsResult.warnings`(工單要求 2:恆存在)。基底上還沒有這個欄位,用 unknown 讀才過得了 tsc。 */
const warningsOf = (result: object) => (result as { warnings?: unknown }).warnings;

const ORIGINAL_BODY = '長'.repeat(120);
const ORIGINAL = { title: '原本的標題', body: ORIGINAL_BODY, examples: ['原例一', '原例二'], lines: [3, 4] };
const SHORT = '重寫後的精簡正文。';
const MODEL_TITLE = '模型改過的標題';

const batchOf = (...cards: Record<string, unknown>[]) => JSON.stringify(cards);
const regen = (fields: unknown) => JSON.stringify([fields]);

/** 批次回應 = 一張超長的原卡;之後依序回 regenerate 的回應。 */
async function runWith(...regenerateResponses: string[]) {
  const router = scriptedRouter([batchOf(ORIGINAL), ...regenerateResponses]);
  const result = await generateCards(router, OPTS);
  return { router, result };
}

describe('T19 前提:測試資料的字數', () => {
  it('原卡 body 超過 100 字、SHORT 在 100 字內(§2 的權威算法)', () => {
    expect(ref(ORIGINAL_BODY)).toBe(120);
    expect(ref(SHORT)).toBeLessThanOrEqual(100);
  });
});

describe('要求 2:regenerate 回應的形狀', () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    ['基準形狀 {title, body}(2026-10-15 真模型)', { title: MODEL_TITLE, body: SHORT }, ORIGINAL.examples],
    ['{title, body, lines}(沒有 examples)', { title: MODEL_TITLE, body: SHORT, lines: [1, 2] }, ORIGINAL.examples],
    ['{title, body, examples}(沒有 lines)', { title: MODEL_TITLE, body: SHORT, examples: ['新例'] }, ['新例']],
    ['完整形狀 {title, body, examples, lines}', { title: MODEL_TITLE, body: SHORT, examples: ['新例'], lines: [1, 2] }, ['新例']],
    ['T12 第 2 輪的形狀 {title, body, examples: []}', { title: MODEL_TITLE, body: SHORT, examples: [] }, ORIGINAL.examples],
    ['只有 body(沒有 title)', { body: SHORT }, ORIGINAL.examples],
    ['title 不是字串', { title: 42, body: SHORT }, ORIGINAL.examples],
  ])('%s → 接受;title、lines 沿用原卡', async (_name, fields, expectedExamples) => {
    const { router, result } = await runWith(regen(fields));
    expect(result.parked).toEqual([]);
    expect(result.regenerateEvents).toBe(1);
    expect(router.calls).toHaveLength(2);
    expect(result.accepted).toEqual([
      { title: ORIGINAL.title, body: SHORT, examples: expectedExamples, lines: [3, 4] },
    ]);
  });

  it('多於一筆:取第一筆', async () => {
    const { result } = await runWith(JSON.stringify([{ title: MODEL_TITLE, body: SHORT }, { title: '第二筆', body: '第二筆的正文。' }]));
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.body).toBe(SHORT);
    expect(result.accepted[0]!.title).toBe(ORIGINAL.title);
  });
});

describe('要求 2(Q2):regenerate 回了不只一筆 → 取第一筆、後面不驗證、記一筆 warning', () => {
  // 這組用完整形狀(含 examples、lines),讓基底上紅的原因只剩「沒有 warnings」。
  const item = (body: string, extra: Record<string, unknown> = {}) => ({ title: MODEL_TITLE, body, examples: ['新例'], lines: [3, 4], ...extra });
  const TEXT_2 = 'regenerate 回了 2 筆,只用第一筆';

  it('只有一筆 → warnings 是 []', async () => {
    const { result } = await runWith(JSON.stringify([item(SHORT)]));
    expect(result.accepted).toHaveLength(1);
    expect(warningsOf(result)).toEqual([]);
  });

  it('沒有呼叫 regenerate → warnings 是 []', async () => {
    const router = scriptedRouter([batchOf({ ...ORIGINAL, body: SHORT })]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(1);
    expect(warningsOf(result)).toEqual([]);
  });

  it('兩筆 → 只用第一筆,一則 warning「regenerate 回了 2 筆,只用第一筆」', async () => {
    const { result } = await runWith(JSON.stringify([item(SHORT), item('第二筆的正文。', { examples: ['第二筆的例子'] })]));
    expect(result.accepted).toEqual([{ title: ORIGINAL.title, body: SHORT, examples: ['新例'], lines: [3, 4] }]);
    const warnings = warningsOf(result) as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(TEXT_2);
  });

  it('三筆 → N 是實際筆數', async () => {
    const { result } = await runWith(JSON.stringify([item(SHORT), item('二。'), item('三。')]));
    const warnings = warningsOf(result) as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('regenerate 回了 3 筆,只用第一筆');
  });

  it.each<[string, unknown]>([
    ['數字', 42],
    ['null', null],
    ['字串', '不是物件'],
    ['body 是數字', { title: MODEL_TITLE, body: 1 }],
    ['空物件', {}],
    ['陣列', [1, 2]],
  ])('第二筆壞掉(%s)也不驗證、不丟錯,照樣記 warning', async (_name, second) => {
    const { result } = await runWith(JSON.stringify([item(SHORT), second]));
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.body).toBe(SHORT);
    const warnings = warningsOf(result) as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(TEXT_2);
  });

  it('第一筆壞掉、第二筆是好的 → 照樣丟錯(只看第一筆),訊息含 regenerate', async () => {
    const router = scriptedRouter([batchOf(ORIGINAL), JSON.stringify([{ title: MODEL_TITLE, body: 123 }, item(SHORT)])]);
    await expect(generateCards(router, OPTS)).rejects.toThrow(/regenerate/);
  });

  it('同一張卡重寫兩次、兩次都回多筆 → 每次各一則,共兩則', async () => {
    const { router, result } = await runWith(
      JSON.stringify([item('二'.repeat(110)), item('不用')]),
      JSON.stringify([item(SHORT), item('不用'), item('不用')]),
    );
    expect(router.calls).toHaveLength(3);
    expect(result.accepted[0]!.body).toBe(SHORT);
    const warnings = warningsOf(result) as string[];
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(TEXT_2);
    expect(warnings[1]).toContain('regenerate 回了 3 筆,只用第一筆');
  });

  it('防退步:批次回應多筆照舊每筆都是一張卡,沒有 warning', async () => {
    const router = scriptedRouter([
      batchOf(
        { title: '卡一', body: '第一張。', examples: [], lines: [1, 2] },
        { title: '卡二', body: '第二張。', examples: ['例'], lines: [3, 4] },
        { title: '卡三', body: '第三張。', examples: [], lines: [5, 6] },
      ),
    ]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(1);
    expect(result.accepted.map((c) => [c.title, c.lines])).toEqual([
      ['卡一', [1, 2]],
      ['卡二', [3, 4]],
      ['卡三', [5, 6]],
    ]);
    expect(warningsOf(result)).toEqual([]);
  });

  it('防退步:批次多筆裡第二筆壞掉 → 照舊丟「第 1 筆格式不正確」(批次每筆都驗證)', async () => {
    const router = scriptedRouter([batchOf({ title: '卡一', body: '第一張。', examples: [], lines: [1, 2] }, { title: '卡二', body: '第二張。' })]);
    await expect(generateCards(router, OPTS)).rejects.toThrow(/ingest\.cards 回應第 1 筆格式不正確/);
  });

  it('防退步:批次兩張超長、各自重寫一次(單筆回應)→ 沒有 warning', async () => {
    const router = scriptedRouter([
      batchOf({ ...ORIGINAL, title: '卡一' }, { ...ORIGINAL, title: '卡二', lines: [5, 6] }),
      JSON.stringify([item(SHORT)]),
      JSON.stringify([item(SHORT)]),
    ]);
    const result = await generateCards(router, OPTS);
    expect(result.accepted.map((c) => c.title)).toEqual(['卡一', '卡二']);
    expect(result.regenerateEvents).toBe(2);
    expect(warningsOf(result)).toEqual([]);
  });
});

describe('要求 2:examples(缺少或 [] 保留原卡;只有非空字串陣列才替換;格式不對整個忽略)', () => {
  // 每一筆都附上合法的 lines,讓這組只看 examples 的規則(lines 的規則在下一組)。
  it.each<[string, unknown]>([
    ['缺少', undefined],
    ['空陣列 []', []],
    ['字串 "abc"', 'abc'],
    ['數字陣列 [1]', [1]],
    ['混合 ["ok", 1](不半採用)', ['ok', 1]],
    ['空字串 [""]', ['']],
    ['只有空白 ["   "]', ['   ']],
    ['混合 ["ok", ""](不半採用)', ['ok', '']],
    ['null', null],
    ['物件 {}', {}],
    ['巢狀 [["a"]]', [['a']]],
  ])('%s → 保留原卡的 examples,不丟錯', async (_name, examples) => {
    const fields: Record<string, unknown> = { title: MODEL_TITLE, body: SHORT, lines: [1, 2] };
    if (examples !== undefined) fields.examples = examples;
    const { result } = await runWith(regen(fields));
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.examples).toEqual(ORIGINAL.examples);
  });

  it.each<[string, string[]]>([
    ['一項 ["新例"]', ['新例']],
    ['兩項 ["新例一", "新例二"]', ['新例一', '新例二']],
  ])('非空字串陣列 %s → 整個替換', async (_name, examples) => {
    const { result } = await runWith(regen({ title: MODEL_TITLE, body: SHORT, examples, lines: [1, 2] }));
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.examples).toEqual(examples);
  });

  it('原卡沒有 examples 時,回應的 [] 不會讓它變成 undefined', async () => {
    const router = scriptedRouter([batchOf({ ...ORIGINAL, examples: [] }), regen({ title: MODEL_TITLE, body: SHORT, examples: [] })]);
    const result = await generateCards(router, OPTS);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.examples).toEqual([]);
  });
});

describe('要求 2(Q1):連續多次重寫,examples 以「目前候選」(上一次有效的)為準', () => {
  const LONG = '二'.repeat(110);
  // 附上合法的 lines,讓這組只看 examples;最後一組用基準形狀(沒有 lines)再走一次。
  const step = (body: string, examples?: unknown) => {
    const fields: Record<string, unknown> = { title: MODEL_TITLE, body, lines: [1, 2] };
    if (examples !== undefined) fields.examples = examples;
    return regen(fields);
  };

  it.each<[string, unknown, unknown, string[]]>([
    ['第 2 次 ["新"]、第 3 次 [] → ["新"](不回退到原卡的)', ['新'], [], ['新']],
    ['第 2 次 ["新"]、第 3 次缺少 → ["新"]', ['新'], undefined, ['新']],
    ['第 2 次 ["新"]、第 3 次 ["ok", 1](格式不對)→ ["新"]', ['新'], ['ok', 1], ['新']],
    ['第 2 次 ["新"]、第 3 次 "abc"(格式不對)→ ["新"]', ['新'], 'abc', ['新']],
    ['第 2 次 []、第 3 次 ["新"] → ["新"]', [], ['新'], ['新']],
    ['第 2 次 ["新一"]、第 3 次 ["新二"] → ["新二"]', ['新一'], ['新二'], ['新二']],
    ['第 2 次 []、第 3 次 [] → 原卡的', [], [], ORIGINAL.examples],
  ])('%s', async (_name, second, third, expected) => {
    const { router, result } = await runWith(step(LONG, second), step(SHORT, third));
    expect(router.calls).toHaveLength(3);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.examples).toEqual(expected);
  });

  it('基準形狀(沒有 lines):第 2 次 {body, examples: ["新"]}、第 3 次 {title, body} → ["新"]', async () => {
    const { result } = await runWith(regen({ body: LONG, examples: ['新'] }), regen({ title: MODEL_TITLE, body: SHORT }));
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.examples).toEqual(['新']);
    expect(result.accepted[0]!.lines).toEqual([3, 4]);
  });
});

describe('要求 2:lines 一律忽略(不驗證、不採用、不丟錯)', () => {
  // 每一筆都附上合法的 examples,讓這組只看 lines。
  it.each<[string, unknown]>([
    ['缺少', undefined],
    ['別的行號 [99, 100]', [99, 100]],
    ['字串 "x"', 'x'],
    ['長度 1 [1]', [1]],
    ['長度 3 [1, 2, 3]', [1, 2, 3]],
    ['NaN 序列化後的 [null, null]', [null, null]],
    ['字串陣列 ["a", "b"]', ['a', 'b']],
    ['物件 {}', {}],
  ])('lines 是 %s → 接受,lines 仍是原卡的', async (_name, lines) => {
    const fields: Record<string, unknown> = { title: MODEL_TITLE, body: SHORT, examples: ['新例'] };
    if (lines !== undefined) fields.lines = lines;
    const { result } = await runWith(regen(fields));
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.lines).toEqual([3, 4]);
    expect(result.accepted[0]!.title).toBe(ORIGINAL.title);
  });
});

describe('要求 2:regenerate 回應壞掉時丟錯,訊息含 regenerate', () => {
  it.each<[string, string]>([
    ['不是合法 JSON', 'not json'],
    ['物件,不是陣列', JSON.stringify({ title: MODEL_TITLE, body: SHORT })],
    ['字串,不是陣列', JSON.stringify('只是字串')],
    ['數字,不是陣列', '123'],
    ['null', 'null'],
  ])('%s', async (_name, text) => {
    const router = scriptedRouter([batchOf(ORIGINAL), text]);
    await expect(generateCards(router, OPTS)).rejects.toThrow(/regenerate/);
    expect(router.calls).toHaveLength(2);
  });

  it('空陣列 → 沿用既有訊息「regenerate 回應沒有回傳卡片」', async () => {
    const router = scriptedRouter([batchOf(ORIGINAL), '[]']);
    await expect(generateCards(router, OPTS)).rejects.toThrow('regenerate 回應沒有回傳卡片');
  });

  it.each<[string, unknown]>([
    ['第一筆是字串', '只是字串'],
    ['第一筆是 null', null],
    ['第一筆是數字', 123],
    ['第一筆是陣列', ['a']],
    ['沒有 body', { title: MODEL_TITLE }],
    ['body 是數字', { title: MODEL_TITLE, body: 123 }],
    ['body 是 null', { title: MODEL_TITLE, body: null }],
    ['body 是陣列', { title: MODEL_TITLE, body: ['a'] }],
    ['body 是物件', { title: MODEL_TITLE, body: { text: SHORT } }],
  ])('%s → 丟錯,訊息含 regenerate 並附上那筆', async (_name, first) => {
    const router = scriptedRouter([batchOf(ORIGINAL), regen(first)]);
    const err = await generateCards(router, OPTS).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/regenerate/);
    expect(message).toContain(JSON.stringify(first));
  });
});

describe('要求 1:批次回應(cards.md)的解析一個字都不放寬', () => {
  const good = { title: '卡', body: SHORT, examples: [], lines: [1, 2] };
  const without = (key: string) => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
  it.each<[string, Record<string, unknown>]>([
    ['基準形狀 {title, body}', { title: '卡', body: SHORT }],
    ['缺 lines', without('lines')],
    ['lines 長度 1', { ...good, lines: [1] }],
    ['lines 長度 3', { ...good, lines: [1, 2, 3] }],
    ['lines 是字串', { ...good, lines: 'x' }],
    ['缺 examples', without('examples')],
    ['examples 是字串', { ...good, examples: 'abc' }],
    ['缺 title', without('title')],
    ['body 是數字', { ...good, body: 123 }],
  ])('%s → 仍丟「格式不正確」,不呼叫 regenerate', async (_name, card) => {
    const router = scriptedRouter([batchOf(card), regen({ title: MODEL_TITLE, body: SHORT })]);
    await expect(generateCards(router, OPTS)).rejects.toThrow(/ingest\.cards 回應第 0 筆格式不正確/);
    expect(router.calls).toHaveLength(1);
  });

  it('超長的卡缺 lines 也照樣丟錯(不能靠 regenerate 的寬鬆解析救回來)', async () => {
    const { lines: _dropped, ...overlongWithoutLines } = ORIGINAL;
    const router = scriptedRouter([batchOf(overlongWithoutLines), regen({ body: SHORT })]);
    await expect(generateCards(router, OPTS)).rejects.toThrow(/ingest\.cards 回應第 0 筆格式不正確/);
    expect(router.calls).toHaveLength(1);
  });
});

describe('要求 3:重試三次的紀錄', () => {
  it('三次仍超長(regenerate 回應是基準形狀)→ parked;lines、title 是原卡的;attempts 3 筆', async () => {
    const second = '二'.repeat(110);
    const third = '三'.repeat(105);
    const { router, result } = await runWith(
      regen({ title: MODEL_TITLE, body: second, lines: [9, 9] }),
      regen({ title: MODEL_TITLE, body: third }),
    );
    expect(router.calls).toHaveLength(3);
    expect(result.accepted).toEqual([]);
    expect(result.regenerateEvents).toBe(0);
    expect(result.parked).toEqual([
      {
        title: ORIGINAL.title,
        lines: [3, 4],
        attempts: [
          { attempt: 1, wordCount: 120, body: ORIGINAL_BODY },
          { attempt: 2, wordCount: 110, body: second },
          { attempt: 3, wordCount: 105, body: third },
        ],
      },
    ]);
  });

  it('第二次仍超長、第三次合格 → 接受第三次的 body,regenerateEvents 是 1', async () => {
    const { router, result } = await runWith(regen({ title: MODEL_TITLE, body: '二'.repeat(110) }), regen({ title: MODEL_TITLE, body: SHORT }));
    expect(router.calls).toHaveLength(3);
    expect(result.parked).toEqual([]);
    expect(result.regenerateEvents).toBe(1);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.body).toBe(SHORT);
    expect(result.accepted[0]!.lines).toEqual([3, 4]);
    expect(result.accepted[0]!.title).toBe(ORIGINAL.title);
  });

  it('regenerate 的 prompt 帶的是原卡的 title(不是上一次回應的)', async () => {
    const { router } = await runWith(regen({ title: MODEL_TITLE, body: '二'.repeat(110) }), regen({ title: '又改了一次', body: SHORT }));
    expect(router.calls).toHaveLength(3);
    for (const call of router.calls.slice(1)) {
      expect(call.prompt).toContain(`title: ${ORIGINAL.title}`);
      expect(call.prompt).not.toContain(MODEL_TITLE);
    }
  });
});

describe('要求 4:字數用契約 §2 判斷(100 通過、101 不通過)', () => {
  // 這組的 regenerate 回應用完整形狀,只看字數規則(形狀的規則在上面)。
  const full = (body: string) => regen({ title: ORIGINAL.title, body, examples: ['新例'], lines: [3, 4] });
  const cases: [string, string, number][] = [
    ['連字號切斷:98 個漢字 + same-origin', '同'.repeat(98) + 'same-origin', 100],
    ['連字號切斷:99 個漢字 + same-origin', '同'.repeat(99) + 'same-origin', 101],
    ['英數連續序列算 1:99 個漢字 + TLS13', '同'.repeat(99) + 'TLS13', 100],
    ['句點切斷:99 個漢字 + 1.3', '同'.repeat(99) + '1.3', 101],
    ['撇號切斷:98 個漢字 + don\'t', '同'.repeat(98) + "don't", 100],
    ['標點算 0:100 個漢字 + 。、!?——', '同'.repeat(100) + '。、!?——', 100],
    ['example 圍欄內不算:100 個漢字 + 圍欄', '同'.repeat(100) + '\n```example\n圍欄裡面有很多很多字都不算\n```', 100],
    ['example 圍欄內不算:101 個漢字 + 圍欄', '同'.repeat(101) + '\n```example\n例\n```', 101],
    ['空白切斷:97 個漢字 + RFC 6265 + 字', '同'.repeat(97) + 'RFC 6265字', 100],
  ];

  const table = cases.map(([name, body, words]) => ({ name, body, words }));

  it.each(table)('測試資料核對:$name = $words 字', ({ body, words }) => {
    expect(ref(body)).toBe(words);
  });

  it.each(table)('regenerate 回應 $name($words 字)', async ({ body, words }) => {
    // 第二次回 body,第三次回 SHORT:body 合格就只呼叫 2 次,不合格就會用到第 3 次。
    const { router, result } = await runWith(full(body), full(SHORT));
    expect(result.regenerateEvents).toBe(1);
    expect(result.accepted).toHaveLength(1);
    if (words <= 100) {
      expect(router.calls).toHaveLength(2);
      expect(result.accepted[0]!.body).toBe(body);
    } else {
      expect(router.calls).toHaveLength(3);
      expect(result.accepted[0]!.body).toBe(SHORT);
    }
  });

  it.each(table)('批次回應本身 $name($words 字):合格就不呼叫 regenerate', async ({ body, words }) => {
    const router = scriptedRouter([batchOf({ ...ORIGINAL, body }), full(SHORT)]);
    const result = await generateCards(router, OPTS);
    expect(router.calls).toHaveLength(words <= 100 ? 1 : 2);
    expect(result.regenerateEvents).toBe(words <= 100 ? 0 : 1);
  });

});

/*
 * 要求 4(顧問 Q3):字數判斷和寫檔前後把關的 validateCard 是同一條路。
 * 參考答案 = validateCard(照 writeCardFile 組的卡檔文字).bodyWordCount;這裡只比「兩邊一樣」,不替契約 §2 定義新的數字。
 *
 * 不測「開閉在同一行的圍欄」(例如 前```example 內容```後):契約 §2 把它列為「尚未定義(不要自行假設)」,
 * 現在 word-count-min.ts 與 parse-card.ts 的圍欄正則對它算出不同數字,只是巧合;要定義是另一次硬約定的修改(T20)。
 * 未閉合的圍欄同理,也不測。
 */
describe('要求 4(Q3):字數判斷與 validateCard 一模一樣', () => {
  const F = '```';
  const full = (body: string) => regen({ title: ORIGINAL.title, body, examples: ['新例'], lines: [3, 4] });
  const cases: [string, string][] = [
    ['CJK 與英數序列', '同'.repeat(95) + "同源政策(same-origin policy)在 TLS 1.3 下不變。don't 算兩個。RFC 6265 也是。"],
    ['連字號切斷', '例'.repeat(90) + 'a-b-c-d-e-f-g-h-i-j-k-l' + '尾巴'],
    ['假名與韓文', 'ひらがなカタカナ한국어' + '漢'.repeat(92) + 'x1y2_z3 4.5.6'],
    ['example 圍欄內不算', '同'.repeat(101) + `\n${F}example\n這裡面的字不算 same-origin\n${F}`],
    ['多個圍欄', '同'.repeat(60) + `\n${F}example\n甲甲甲\n${F}\n` + '同'.repeat(41) + `\n${F}example\n乙乙乙\n${F}\n尾`],
    ['CRLF 圍欄', '同'.repeat(101) + `\r\n${F}example\r\n內容內容\r\n${F}`],
    ['非 example 圍欄照算', '同'.repeat(99) + `\n${F}js\nab\n${F}`],
    ['body 以 --- 開頭(不能被當成 front matter 吃掉)', '---\nfoo: bar\n---\n' + '同'.repeat(99)],
    // 下面兩列是 word-count-min.ts 的圍欄正則(\n 可有可無)和 parse-card.ts 的(\n 必須緊接 example)算法不同的地方,
    // 都不是同一行開閉。這裡只要求和 validateCard 一樣;§2 對它們應該算多少是 T20 的事。
    ['example 後面有空白再換行', '同'.repeat(120) + `\n${F}example \n內容\n${F}`],
    ['example 後面還有字', '同'.repeat(120) + `\n${F}example js\n內容\n${F}`],
  ];

  it.each(cases)('parked 記的字數 = validateCard 的:%s', async (_name, body) => {
    expect(ref(body)).toBeGreaterThan(100);
    const router = scriptedRouter([batchOf({ ...ORIGINAL, body }), full(body), full(body)]);
    const result = await generateCards(router, OPTS);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0]!.attempts.map((a) => a.wordCount)).toEqual([ref(body), ref(body), ref(body)]);
  });

  // 接受 / 暫緩的判斷:100 通過、101 不通過,兩邊判斷一致。每一對只差一個字。
  const boundary: [string, string, number][] = [
    ['--- 開頭 98', '---\nfoo: bar\n---\n' + '同'.repeat(98), 100],
    ['--- 開頭 99', '---\nfoo: bar\n---\n' + '同'.repeat(99), 101],
    ['多個圍欄 50+50', '同'.repeat(50) + `\n${F}example\n很多字很多字\n${F}\n` + '同'.repeat(50) + `\n${F}example\n又是很多字\n${F}`, 100],
    ['多個圍欄 51+50', '同'.repeat(51) + `\n${F}example\n很多字很多字\n${F}\n` + '同'.repeat(50) + `\n${F}example\n又是很多字\n${F}`, 101],
    ['example 後面有空白 97', '同'.repeat(97) + `\n${F}example \n內容\n${F}`, 100],
    ['example 後面有空白 98', '同'.repeat(98) + `\n${F}example \n內容\n${F}`, 101],
    ['example 後面還有字 96', '同'.repeat(96) + `\n${F}example js\n內容\n${F}`, 100],
    ['example 後面還有字 97', '同'.repeat(97) + `\n${F}example js\n內容\n${F}`, 101],
  ];

  it.each(boundary.map(([name, body, words]) => ({ name, body, words })))('測試資料核對:$name → validateCard 算 $words 字', ({ body, words }) => {
    expect(ref(body)).toBe(words);
  });

  it.each(boundary)('批次回應 %s:接受與否跟 validateCard 一致', async (_name, body) => {
    const router = scriptedRouter([batchOf({ ...ORIGINAL, body }), full(SHORT)]);
    const result = await generateCards(router, OPTS);
    const passes = ref(body) <= 100;
    expect(router.calls).toHaveLength(passes ? 1 : 2);
    expect(result.accepted[0]!.body).toBe(passes ? body : SHORT);
  });
});

describe('真實形狀:golden 基準裡真的 regenerate 輸出(含模型回顯的 golden / category / source)', () => {
  const dir = fileURLToPath(new URL('../prompt-quality/golden/ingest.regenerate/2026-10-15/', import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => /^regenerate-.*\.output\.json$/.test(f))
    .sort();

  it('基準有 3 份 regenerate 輸出,而且都沒有 lines、沒有 examples(這就是要配合的現實)', () => {
    expect(files).toHaveLength(3);
    for (const f of files) {
      const entries = JSON.parse((JSON.parse(readFileSync(join(dir, f), 'utf8')) as { text: string }).text) as Record<string, unknown>[];
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(typeof e.title).toBe('string');
        expect(typeof e.body).toBe('string');
        expect(e).not.toHaveProperty('lines');
        expect(e).not.toHaveProperty('examples');
      }
    }
  });

  it.each(files)('%s 的欄位形狀被接受(body 換成合格的,其他欄位原樣)', async (f) => {
    const entries = JSON.parse((JSON.parse(readFileSync(join(dir, f), 'utf8')) as { text: string }).text) as Record<string, unknown>[];
    const reshaped = entries.map((e) => ({ ...e, body: SHORT }));
    expect(Object.keys(reshaped[0]!)).toEqual(Object.keys(entries[0]!));
    const { result } = await runWith(JSON.stringify(reshaped));
    expect(result.parked).toEqual([]);
    expect(result.regenerateEvents).toBe(1);
    expect(result.accepted).toEqual([{ title: ORIGINAL.title, body: SHORT, examples: ORIGINAL.examples, lines: [3, 4] }]);
  });
});
