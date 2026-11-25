/**
 * T68 驗收補測(測試 agent 寫;開發 worker 不改):`teach/ask.ts` 的純函式——提示組裝與回答 schema 的空白規則。
 * 驗收者的 ask 變異 71.19%,ask.ts 只有 53%:提示的內容、輪數裁切、「全空白當空」沒有被釘住(docs/reviews/acceptance-T68-impl.md G1 G6 G7)。
 * 一次斷言一批「提示含這些內容」,不逐個釘標籤字樣;標籤只釘兩處對模型有意義的:`deepest level:`(別叫它深入)與「earlier …」(前面的討論)。
 */
import { describe, expect, it } from 'vitest';
import { ASK_SUGGESTIONS, AskAnswerSchema, MAX_ASK_ROUNDS, buildAskPrompt, parseAskAnswer, recentRounds, type AskCardView, type AskRound } from './ask.js';

const CARD: AskCardView = {
  category: 'security',
  title: 'CARD-TITLE-X',
  level: 2,
  body: 'CARD-BODY-X 內文。',
  examples: ['EXAMPLE-A', 'EXAMPLE-B'],
  unlearnedPrereqTitles: ['PREREQ-ONE', 'PREREQ-TWO'],
  atFloor: false,
};
const rounds = (n: number): AskRound[] => Array.from({ length: n }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
const build = (over: Partial<{ card: AskCardView; history: AskRound[]; question: string }> = {}): string =>
  buildAskPrompt({ template: 'TEMPLATE-LINE\n', card: over.card ?? CARD, history: over.history ?? [], question: over.question ?? 'THE-QUESTION' });

describe('常數', () => {
  it('提示最多 4 輪(含這一輪)、建議三選一(順序不重要但就這三個)', () => {
    expect(MAX_ASK_ROUNDS).toBe(4);
    expect([...ASK_SUGGESTIONS].sort()).toEqual(['back', 'continue', 'deepen']);
  });
});

describe('recentRounds:只留最近 N−1 輪(這一輪算第 N 輪)', () => {
  it.each([
    [0, []],
    [1, ['Q1']],
    [3, ['Q1', 'Q2', 'Q3']],
    [4, ['Q2', 'Q3', 'Q4']],
    [5, ['Q3', 'Q4', 'Q5']],
    [9, ['Q7', 'Q8', 'Q9']],
  ])('前面有 %i 輪 → 留 %j', (n, kept) => {
    expect(recentRounds(rounds(n)).map((r) => r.question)).toEqual(kept);
  });

  it('不改傳進來的陣列、保持順序(舊的在前)', () => {
    const input = rounds(5);
    const snapshot = JSON.stringify(input);
    recentRounds(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('buildAskPrompt:提示含這些內容', () => {
  it('模板、分類、標題、層級、內文、每個 example、每個未學先備標題、這一輪的問題,全部在', () => {
    const prompt = build();
    for (const part of ['TEMPLATE-LINE', 'security', 'CARD-TITLE-X', '2', 'CARD-BODY-X 內文。', 'EXAMPLE-A', 'EXAMPLE-B', 'PREREQ-ONE', 'PREREQ-TWO', 'THE-QUESTION']) expect(prompt, part).toContain(part);
  });

  it('順序:模板在最前、內文在 example 前、example 照給的順序、問題在最後', () => {
    const p = build({ history: rounds(2) });
    const at = (s: string): number => p.indexOf(s);
    expect(at('TEMPLATE-LINE')).toBeLessThan(at('CARD-TITLE-X'));
    expect(at('CARD-TITLE-X')).toBeLessThan(at('CARD-BODY-X'));
    expect(at('CARD-BODY-X')).toBeLessThan(at('EXAMPLE-A'));
    expect(at('EXAMPLE-A')).toBeLessThan(at('EXAMPLE-B'));
    expect(at('EXAMPLE-B')).toBeLessThan(at('Q1'));
    expect(at('Q2')).toBeLessThan(at('THE-QUESTION'));
    expect(p.trimEnd().endsWith('THE-QUESTION')).toBe(true);
  });

  it('沒有 example、沒有未學先備:不寫出空的 example 行,先備那一欄標明沒有', () => {
    const p = build({ card: { ...CARD, examples: [], unlearnedPrereqTitles: [] } });
    expect(p).not.toContain('EXAMPLE');
    expect(p).not.toMatch(/example:\s*$/m);
    expect(p).toMatch(/unlearned prereqs:\s*\(none\)/i);
    expect(p).not.toContain('PREREQ-ONE');
  });

  it('未學先備的標題都在同一行(分號隔開),不是只放第一個', () => {
    expect(build()).toMatch(/PREREQ-ONE;\s*PREREQ-TWO/);
  });

  it('最深一層:deepest level: yes;不是:deepest level: no', () => {
    expect(build({ card: { ...CARD, atFloor: true } })).toMatch(/^deepest level:\s*yes\s*$/im);
    expect(build({ card: { ...CARD, atFloor: false } })).toMatch(/^deepest level:\s*no\s*$/im);
    expect(build({ card: { ...CARD, atFloor: false } })).not.toMatch(/^deepest level:\s*yes\s*$/im);
  });

  it('第一輪(沒有前面的討論):提示沒有「earlier …」區塊,也沒有任何前面的問題與回答', () => {
    const p = build();
    expect(p).not.toMatch(/earlier (question|answer|discussion)/i);
    expect(p).not.toContain('Q1');
  });

  it('有前面的討論:每一輪的問題與回答都在、舊的在新的前面、輪數編號各不相同', () => {
    const p = build({ history: rounds(3) });
    expect(p).toMatch(/earlier discussion/i);
    for (const n of [1, 2, 3]) {
      expect(p).toContain(`Q${n}`);
      expect(p).toContain(`A${n}`);
    }
    expect(p.indexOf('Q1')).toBeLessThan(p.indexOf('A1'));
    expect(p.indexOf('A1')).toBeLessThan(p.indexOf('Q2'));
    expect(p.indexOf('Q3')).toBeLessThan(p.indexOf('A3'));
    const numbered = [...p.matchAll(/earlier question (\d+)/gi)].map((m) => m[1]);
    expect(numbered).toEqual(['1', '2', '3']);
  });

  it('前面有 4 輪以上:只帶最近 3 輪(第 1 輪不在)、問題照樣在最後', () => {
    const p = build({ history: rounds(5) });
    for (const n of [1, 2]) {
      expect(p).not.toContain(`Q${n}`);
      expect(p).not.toContain(`A${n}`);
    }
    for (const n of [3, 4, 5]) expect(p).toContain(`Q${n}`);
    expect(p.trimEnd().endsWith('THE-QUESTION')).toBe(true);
  });

  it('不帶任何卡 id 或檔案路徑(只有傳進來的欄位)', () => {
    expect(build()).not.toMatch(/sec-\d{4}|cards\/|\.md\b/);
  });

  it('模板結尾有沒有換行都一樣(不多不少一行空行)', () => {
    const a = buildAskPrompt({ template: 'T\n', card: CARD, history: [], question: 'Q' });
    const b = buildAskPrompt({ template: 'T', card: CARD, history: [], question: 'Q' });
    expect(a).toBe(b);
  });

  it('結尾有一個換行(檔案慣例)', () => {
    expect(build().endsWith('\n')).toBe(true);
    expect(build().endsWith('\n\n')).toBe(false);
  });
});

describe('回答 schema:只有空白的 answer 與追問是空的(unreadable)', () => {
  const good = { answer: '好的答案', suggestion: 'continue', followups: ['再問'] };
  it.each([
    ['answer 空格', { ...good, answer: '   ' }],
    ['answer 換行', { ...good, answer: '\n' }],
    ['answer tab', { ...good, answer: '\t' }],
    ['追問空格', { ...good, followups: [' '] }],
    ['追問其中一個是換行', { ...good, followups: ['好問題', '\n'] }],
  ])('%s → 不通過', (_name, value) => {
    expect(AskAnswerSchema.safeParse(value).success).toBe(false);
    expect(parseAskAnswer(JSON.stringify(value)).ok).toBe(false);
  });

  it('前後有空白但有字:通過,而且原樣(不 trim)', () => {
    const value = { answer: ' 好 ', suggestion: 'back', followups: [' 再問 '] };
    const parsed = parseAskAnswer(JSON.stringify(value));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(value);
  });

  it('parseAskAnswer 接受前後空白與換行的整段 JSON', () => {
    expect(parseAskAnswer(`\n\n  ${JSON.stringify(good)}  \n`).ok).toBe(true);
  });
});
