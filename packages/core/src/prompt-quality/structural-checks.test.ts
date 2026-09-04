import { describe, it, expect } from 'vitest';
import { checkStructural, runStructuralChecks, QUALITY_NOTE } from './structural-checks.js';

describe('checkStructural', () => {
  it('a card body exceeds the word limit', () => {
    const output = JSON.stringify([{ title: '測試卡', body: '同'.repeat(101), examples: [] }]);
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('body-too-long');
  });

  it('the response is not valid JSON', () => {
    const issues = checkStructural('這不是 JSON {');
    expect(issues).toEqual([{ kind: 'invalid-json', detail: expect.any(String) }]);
  });

  it('a rubric has fewer than two criteria', () => {
    const output = JSON.stringify({ prompt: '說明同源政策', rubric: ['只有一條'] });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('rubric-too-few');
  });

  it('a rubric has more than four criteria', () => {
    const output = JSON.stringify({ prompt: '說明同源政策', rubric: ['a', 'b', 'c', 'd', 'e'] });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('rubric-too-many');
  });

  it('grade.apply 的 criteria 陣列套用同一條 2..4 規則', () => {
    const output = JSON.stringify({ criteria: [true], feedback: '太短' });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('rubric-too-few');
  });

  it('the blank count does not match the answers', () => {
    const output = JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定']] });
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('blank-answer-mismatch');
  });

  it('a required field is missing', () => {
    const output = JSON.stringify([{ body: '沒有標題的卡片內容' }]);
    const issues = checkStructural(output);
    expect(issues.map((i) => i.kind)).toContain('missing-field');
  });

  it('structurally perfect but says something wrong → 沒有問題', () => {
    const output = JSON.stringify([{ title: '同源政策', body: '瀏覽器規定同源才能互相存取,這句話是錯的但格式完全正確。', examples: [] }]);
    expect(checkStructural(output)).toEqual([]);
  });
});

/**
 * 審核補測(12-prompt-quality/phase-2 驗收)。
 *
 * 這個檔案原本的測試每一條都只斷言「issues 的 kind 之中**含有**某一種」,
 * 而且從來沒有踩過任何一個邊界值。變異測試的結果是:phase-1 這半個檔案有 39 個
 * 存活變異——`>` 換成 `>=`、`||` 換成 `&&`、整段 detail 訊息清空、
 * 連遞迴那一行拿掉,都沒有任何測試會紅。
 *
 * 下面補的是那些「拿掉之後沒人發現」的部分:每一條規則的**邊界**、每一個
 * 沒被走過的分支、detail 的實際文字,以及「格式正確時不誤報」。
 */
describe('checkStructural:邊界與訊息(審核補測)', () => {
  const card = (body: string, title = '測試卡'): string => JSON.stringify([{ title, body, examples: [] }]);

  it('body 剛好 100 字不算超過(上限是 > 不是 >=)', () => {
    expect(checkStructural(card('同'.repeat(100)))).toEqual([]);
    expect(checkStructural(card('同'.repeat(101)))).toEqual([
      { kind: 'body-too-long', detail: 'body 字數 101 超過上限 100' },
    ]);
  });

  it('缺 title 的 detail 說得出缺的是什麼', () => {
    expect(checkStructural(JSON.stringify([{ body: '沒有標題的卡片內容' }]))).toEqual([
      { kind: 'missing-field', detail: 'card 缺少 title' },
    ]);
  });

  it('title 是空字串或不是字串,一樣算缺', () => {
    expect(checkStructural(card('正文', ''))).toEqual([{ kind: 'missing-field', detail: 'card 缺少 title' }]);
    expect(checkStructural(JSON.stringify([{ title: 123, body: '正文' }]))).toEqual([
      { kind: 'missing-field', detail: 'card 缺少 title' },
    ]);
  });

  it('apply 題目缺 prompt 會被抓到(這個分支原本沒有測試走過)', () => {
    expect(checkStructural(JSON.stringify({ rubric: ['甲', '乙'] }))).toEqual([
      { kind: 'missing-field', detail: 'apply 題目缺少 prompt' },
    ]);
    expect(checkStructural(JSON.stringify({ prompt: 123, rubric: ['甲', '乙'] }))).toEqual([
      { kind: 'missing-field', detail: 'apply 題目缺少 prompt' },
    ]);
  });

  it('rubric 剛好 2 條與剛好 4 條都合法(2..4 的兩個邊界)', () => {
    expect(checkStructural(JSON.stringify({ prompt: '題目', rubric: ['甲', '乙'] }))).toEqual([]);
    expect(checkStructural(JSON.stringify({ prompt: '題目', rubric: ['甲', '乙', '丙', '丁'] }))).toEqual([]);
  });

  it('rubric 太少 / 太多的 detail 帶得出實際條數', () => {
    expect(checkStructural(JSON.stringify({ prompt: '題目', rubric: ['只有一條'] }))).toEqual([
      { kind: 'rubric-too-few', detail: 'rubric 只有 1 條,至少要 2 條' },
    ]);
    expect(checkStructural(JSON.stringify({ prompt: '題目', rubric: ['a', 'b', 'c', 'd', 'e'] }))).toEqual([
      { kind: 'rubric-too-many', detail: 'rubric 有 5 條,最多 4 條' },
    ]);
  });

  it('criteria 剛好 2 與剛好 4 合法,超過 4 會被抓到(這個分支原本沒有測試走過)', () => {
    expect(checkStructural(JSON.stringify({ criteria: [true, false], feedback: 'ok' }))).toEqual([]);
    expect(checkStructural(JSON.stringify({ criteria: [1, 2, 3, 4], feedback: 'ok' }))).toEqual([]);
    expect(checkStructural(JSON.stringify({ criteria: [1, 2, 3, 4, 5], feedback: 'ok' }))).toEqual([
      { kind: 'rubric-too-many', detail: 'criteria 有 5 項,rubric 最多 4 條' },
    ]);
    expect(checkStructural(JSON.stringify({ criteria: [true], feedback: 'ok' }))).toEqual([
      { kind: 'rubric-too-few', detail: 'criteria 只有 1 項,rubric 至少要 2 條' },
    ]);
  });

  it('fill:空格數與 answers 組數相符時不誤報', () => {
    expect(checkStructural(JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定'], ['主機']] }))).toEqual([]);
  });

  it('fill:一個 ___ 都沒有時算 0 個,跟 answers 的組數照樣比', () => {
    expect(checkStructural(JSON.stringify({ prompt: '完全沒有空格', answers: [['協定']] }))).toEqual([
      { kind: 'blank-answer-mismatch', detail: 'prompt 有 0 個 ___,但 answers 有 1 組' },
    ]);
    expect(checkStructural(JSON.stringify({ prompt: '完全沒有空格', answers: [] }))).toEqual([]);
  });

  it('fill:數量不符的 detail 帶得出兩邊的數字', () => {
    expect(checkStructural(JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定']] }))).toEqual([
      { kind: 'blank-answer-mismatch', detail: 'prompt 有 2 個 ___,但 answers 有 1 組' },
    ]);
  });

  it('fill:有一組 answers 是空陣列會被抓到', () => {
    expect(checkStructural(JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定'], []] }))).toEqual([
      { kind: 'missing-field', detail: '有一組 answers 是空的' },
    ]);
  });

  it('fill:有一組 answers 根本不是陣列也會被抓到', () => {
    expect(checkStructural(JSON.stringify({ prompt: '___ 與 ___ 必須相同', answers: [['協定'], '主機'] }))).toEqual([
      { kind: 'missing-field', detail: '有一組 answers 是空的' },
    ]);
  });

  it('遞迴掃整棵樹:藏在物件深處的卡一樣被檢查', () => {
    const nested = JSON.stringify({ result: { batch: { cards: [{ title: '深處的卡', body: '同'.repeat(101) }] } } });
    expect(checkStructural(nested)).toEqual([{ kind: 'body-too-long', detail: 'body 字數 101 超過上限 100' }]);
  });

  it('遞迴掃整棵樹:陣列裡的每一項都被檢查,不是只看第一項', () => {
    const many = JSON.stringify([
      { title: '甲', body: '短的' },
      { title: '乙', body: '同'.repeat(101) },
      { body: '缺標題' },
    ]);
    expect(checkStructural(many).map((i) => i.kind).sort()).toEqual(['body-too-long', 'missing-field']);
  });
});

describe('runStructuralChecks', () => {
  it('永遠附上「品質要人評分」的提醒,即使沒有問題', () => {
    const output = JSON.stringify([{ title: '同源政策', body: '格式正確的內容。', examples: [] }]);
    const result = runStructuralChecks(output);
    expect(result.issues).toEqual([]);
    expect(result.note).toBe(QUALITY_NOTE);
    expect(result.note.length).toBeGreaterThan(0);
  });
});
