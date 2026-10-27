/**
 * T65:縮短版回應 `{ body, example }` 在 golden 的機器檢查裡不該被報「card 缺少 title」。測試 agent 寫;開發 worker 不改。
 *
 * 起因:structural-checks.ts 的 checkCardShape 對任何有 `body` 字串的物件都要求 `title`。reteach.short 的回應照工單是
 * `{ body, example }`(沒有 title),所以每個 golden 輸出都會帶一筆 missing-field 警告,把基準弄髒。
 * 這只是警告(cli.ts 只印 ⚠、不影響退出碼),不擋 golden 的退出碼 0;但警告天天有等於沒有警告。
 * 修法由顧問/協調者決定(要動 structural-checks.ts,不在 T65 工單的 touches 裡);要是決定不修,刪掉這個檔即可,不影響別的測試。
 *
 * 判準(顧問裁定 2026-10-27,甲 + 一條):
 *   (1) 物件有 body 字串、**同時** typeof example === 'string' → 是縮短版形狀,不要求 title;
 *   (2) 縮短版形狀的 body 上限是 50(契約 §2 settings.short_body_limit 預設),超過記 body-too-long、detail 寫上限 50;
 *   (3) 一般卡(要 title、上限 100)一個字都不變。
 */
import { describe, expect, it } from 'vitest';
import { checkStructural } from './structural-checks.js';

describe('T65 structural:縮短版回應的形狀', () => {
  it('{ body, example }(body 在上限內):沒有任何問題', () => {
    expect(checkStructural(JSON.stringify({ body: '短短的內文', example: '一個例子' }))).toEqual([]);
  });

  it('{ body, example } 的 body 超過 100 字:照樣報 body-too-long(而且只有這一筆)', () => {
    const issues = checkStructural(JSON.stringify({ body: '字'.repeat(101), example: '例' }));
    expect(issues.map((i) => i.kind)).toEqual(['body-too-long']);
  });

  it('縮短版形狀的 body 上限是 50:正好 50 字沒有問題', () => {
    expect(checkStructural(JSON.stringify({ body: '字'.repeat(50), example: '例' }))).toEqual([]);
  });

  it('縮短版形狀的 body 51 字:記 body-too-long,detail 寫上限 50(不是 100)', () => {
    const issues = checkStructural(JSON.stringify({ body: '字'.repeat(51), example: '例' }));
    expect(issues.map((i) => i.kind)).toEqual(['body-too-long']);
    expect(issues[0]!.detail).toContain('51');
    expect(issues[0]!.detail).toContain('50');
    expect(issues[0]!.detail).not.toContain('100');
  });

  it('包在陣列裡的縮短版形狀也一樣(遞迴掃描):51 字記 body-too-long', () => {
    const issues = checkStructural(JSON.stringify([{ body: '字'.repeat(51), example: '例' }]));
    expect(issues.map((i) => i.kind)).toEqual(['body-too-long']);
  });

  it('一般卡的上限仍是 100:51 字沒有問題、100 字沒有問題、101 字記 body-too-long 且 detail 寫上限 100(防退步)', () => {
    const card = (n: number) => JSON.stringify([{ title: '標題', body: '字'.repeat(n), examples: [] }]);
    expect(checkStructural(card(51))).toEqual([]);
    expect(checkStructural(card(100))).toEqual([]);
    const issues = checkStructural(card(101));
    expect(issues.map((i) => i.kind)).toEqual(['body-too-long']);
    expect(issues[0]!.detail).toContain('100');
  });

  it('教學卡(有 body、沒有 example 字串)沒有 title:照舊報 missing-field(沒放寬)', () => {
    const issues = checkStructural(JSON.stringify([{ body: '內文', examples: [] }]));
    expect(issues.map((i) => i.kind)).toEqual(['missing-field']);
  });

  it('一般卡缺 title 照舊記 missing-field,即使它有不是字串的 example 欄位(typeof 判斷,不是「有這個鍵」)(防退步)', () => {
    expect(checkStructural(JSON.stringify([{ body: '內文', example: 5 }])).map((i) => i.kind)).toEqual(['missing-field']);
    expect(checkStructural(JSON.stringify([{ body: '內文', example: ['例'] }])).map((i) => i.kind)).toEqual(['missing-field']);
  });

  it('教學卡有 title、有 examples 陣列:沒有問題(沒被新規則弄壞)', () => {
    expect(checkStructural(JSON.stringify([{ title: '標題', body: '內文', examples: ['例'] }]))).toEqual([]);
  });
});
