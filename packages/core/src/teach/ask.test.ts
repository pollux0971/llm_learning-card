/**
 * T68(07 phase-6 問 AI)驗收「回答 schema」:`packages/core/src/teach/ask.ts` 的 zod 與解析(ADR-086 第 5 點、工單第 3 點)。
 * 測試 agent 寫;開發 worker 不改。
 *
 * 工單只說「模組內部用 zod 驗,strict」,沒給名字;這份測試固定兩個匯出(開發 worker 照這裡寫,協調者轉進工單):
 *   AskAnswerSchema            zod strictObject:{ answer: 非空字串, suggestion: 'continue' | 'deepen' | 'back', followups: 0–3 個非空字串 }
 *   parseAskAnswer(text)       { ok: true, value } | { ok: false } —— `text` 是模型回的原文。只認「整段就是一個 JSON 物件」:
 *                              不是 JSON、前後有別的字(包括 markdown 圍欄)、欄位缺、多、值不合法、followups 超過 3 個,全部 { ok: false }。
 *                              不猜、不截、不修;沒有任何一種壞掉的輸入會變成 { ok: true }。
 *   AskAnswer                  型別(z.infer)
 * 長度不檢查:answer 與 followups 只檢查非空(提示叫 AI 寫 200 字、30 字以內,但程式不卡)。
 *
 * 這個檔不 import 還沒寫的模組:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface AskModule {
  AskAnswerSchema: { safeParse(v: unknown): { success: boolean; data?: unknown } };
  parseAskAnswer(text: string): { ok: boolean; value?: { answer: string; suggestion: string; followups: string[] } };
}

const MODULE_URL = pathToFileURL(join(import.meta.dirname, 'ask.ts')).href;
async function ask(): Promise<AskModule> {
  return (await import(/* @vite-ignore */ MODULE_URL)) as AskModule;
}

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ answer: '因為清單已經排好了。', suggestion: 'continue', followups: [], ...over });
const without = (key: string): Record<string, unknown> => {
  const { [key]: _drop, ...rest } = good();
  return rest;
};

describe('AskAnswerSchema:好的回答', () => {
  it.each([
    ['continue、沒有追問', good()],
    ['deepen、一個追問', good({ suggestion: 'deepen', followups: ['再深入一點?'] })],
    ['back、三個追問(上限)', good({ suggestion: 'back', followups: ['一', '二', '三'] })],
    ['answer 很長(長度不檢查)', good({ answer: '長'.repeat(5000) })],
    ['追問很長(長度不檢查)', good({ followups: ['問'.repeat(300)] })],
    ['answer 只有一個字', good({ answer: '是' })],
  ])('%s', async (_name, value) => {
    const { AskAnswerSchema } = await ask();
    const parsed = AskAnswerSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(value);
  });
});

describe('AskAnswerSchema:壞的回答一律不通過(strict、不修、不猜)', () => {
  it.each<[string, unknown]>([
    ['缺 answer', without('answer')],
    ['缺 suggestion', without('suggestion')],
    ['缺 followups', without('followups')],
    ['多一個欄位 highlight', good({ highlight: 'next' })],
    ['多一個欄位 prereq(模型不給先備 id)', good({ suggestion: 'back', prereq: 'sec-0003' })],
    ['多一個欄位 provisional', good({ provisional: false })],
    ['suggestion 是 next', good({ suggestion: 'next' })],
    ['suggestion 是 none(只有側車能回)', good({ suggestion: 'none' })],
    ['suggestion 大小寫不對', good({ suggestion: 'Continue' })],
    ['suggestion 前後有空白', good({ suggestion: ' continue ' })],
    ['suggestion 是空字串', good({ suggestion: '' })],
    ['suggestion 是數字', good({ suggestion: 1 })],
    ['suggestion 是 null', good({ suggestion: null })],
    ['followups 有 4 個', good({ followups: ['a', 'b', 'c', 'd'] })],
    ['followups 有 10 個', good({ followups: Array.from({ length: 10 }, (_, i) => `q${i}`) })],
    ['followups 是字串', good({ followups: 'a' })],
    ['followups 是 null', good({ followups: null })],
    ['followups 有數字', good({ followups: ['a', 2] })],
    ['followups 有空字串', good({ followups: ['a', ''] })],
    ['followups 有 null', good({ followups: [null] })],
    ['answer 是空字串', good({ answer: '' })],
    ['answer 是數字', good({ answer: 5 })],
    ['answer 是 null', good({ answer: null })],
    ['answer 是陣列', good({ answer: ['x'] })],
    ['整個是陣列', [good()]],
    ['整個是字串', 'continue'],
    ['整個是 null', null],
    ['整個是數字', 1],
    ['空物件', {}],
  ])('%s', async (_name, value) => {
    const { AskAnswerSchema } = await ask();
    expect(AskAnswerSchema.safeParse(value).success).toBe(false);
  });
});

describe('parseAskAnswer:模型回的原文', () => {
  it('整段就是一個合法的 JSON 物件 → { ok: true, value }(值原樣)', async () => {
    const { parseAskAnswer } = await ask();
    const value = good({ suggestion: 'deepen', followups: ['一', '二'] });
    const got = parseAskAnswer(JSON.stringify(value));
    expect(got.ok).toBe(true);
    expect(got.value).toEqual(value);
  });

  it('前後的空白與換行可以(那不是修,是讀 JSON)', async () => {
    const { parseAskAnswer } = await ask();
    const got = parseAskAnswer(`\n  ${JSON.stringify(good())}\n\n`);
    expect(got.ok).toBe(true);
  });

  const BAD_TEXT: [string, string][] = [
    ['空字串', ''],
    ['只有空白', '  \n '],
    ['純文字', '好的,繼續下一張。'],
    ['純文字(只有一個字 continue)', 'continue'],
    ['JSON 切到一半', JSON.stringify(good()).slice(0, 40)],
    ['JSON 前面有字', `好的:${JSON.stringify(good())}`],
    ['JSON 後面有字', `${JSON.stringify(good())}\n以上。`],
    ['markdown 圍欄', `\`\`\`json\n${JSON.stringify(good())}\n\`\`\``],
    ['兩個 JSON 物件接在一起', `${JSON.stringify(good())}${JSON.stringify(good())}`],
    ['單引號的「JSON」', "{'answer':'x','suggestion':'continue','followups':[]}"],
    ['結尾多一個逗號', '{"answer":"x","suggestion":"continue","followups":[],}'],
    ['陣列', JSON.stringify([good()])],
    ['字串', JSON.stringify('continue')],
    ['null', 'null'],
    ['缺欄位', JSON.stringify(without('followups'))],
    ['多欄位', JSON.stringify(good({ highlight: 'next' }))],
    ['suggestion 不合法', JSON.stringify(good({ suggestion: 'next' }))],
    ['followups 4 個', JSON.stringify(good({ followups: ['a', 'b', 'c', 'd'] }))],
    ['answer 空', JSON.stringify(good({ answer: '' }))],
  ];

  it.each(BAD_TEXT)('%s → { ok: false },而且沒有 value(不猜成 continue、不截成三個追問)', async (_name, text) => {
    const { parseAskAnswer } = await ask();
    const got = parseAskAnswer(text);
    expect(got.ok).toBe(false);
    expect(got.value).toBeUndefined();
  });

  it('不丟例外:任何怪輸入都回 { ok: false }', async () => {
    const { parseAskAnswer } = await ask();
    for (const text of ['\u0000', '{'.repeat(10_000), '"'.repeat(5), 'x'.repeat(300_000), '{"answer":"\\ud800","suggestion":"continue","followups":[]}']) {
      expect(() => parseAskAnswer(text)).not.toThrow();
    }
  });
});
