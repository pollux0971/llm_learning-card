/**
 * T30 驗收 4 的靜態檢查:`App.svelte` 不再把「評分失敗,請再試一次」寫死在畫面上,改顯示 `view.gradingError` 的字;
 * `session.ts` 認得 `credential-unavailable`。紅測試作者寫;開發 worker 不改。只讀檔案文字。
 *
 * 畫面字的來源:批改回 `status: "error"` 時 `gradingError` 是「評分失敗,請再試一次」(在 session.ts),
 * 憑證錯誤時是側車那一句加「改好之後再按「送出」。」——所以 App.svelte 只能印 `view.gradingError`,不能自己寫死一句。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(APP, rel), 'utf8');

describe('App.svelte 的評分錯誤那一行(T30 驗收 4)', () => {
  it('沒有寫死「評分失敗,請再試一次」(那句只在 session.ts 的 GRADING_ERROR)', () => {
    expect(read('src/App.svelte')).not.toContain('評分失敗,請再試一次');
    expect(read('src/session.ts')).toContain('評分失敗,請再試一次');
  });

  it('在 {#if view.gradingError} 裡印 {view.gradingError},用 error 的樣式', () => {
    const src = read('src/App.svelte');
    const m = /\{#if\s+view\.gradingError\s*\}([^]*?)\{\/if\}/.exec(src);
    expect(m, '找不到 {#if view.gradingError}').not.toBeNull();
    expect(m![1]).toMatch(/\{view\.gradingError\}/);
    expect(m![1]).toMatch(/class="error"/);
  });

  it('送出鍵在有 gradingError 時還在(不因為錯誤而隱藏):隱藏條件仍是「有結果而且沒有錯誤」', () => {
    const src = read('src/App.svelte');
    expect((src.match(/\{#if\s+!\(view\.result\s*&&\s*!view\.gradingError\)\}/g) ?? []).length).toBe(2);
  });
});

describe('session.ts 認得 credential-unavailable(T30 驗收 4)', () => {
  it('提到 credential-unavailable;兩處(start 的 showError 與 submit 的 catch)各有分支', () => {
    const src = read('src/session.ts');
    expect((src.match(/credential-unavailable/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('兩句後綴寫在 session.ts:「改好之後按「再試一次」。」(既有)與「改好之後再按「送出」。」', () => {
    const src = read('src/session.ts');
    expect(src).toContain('改好之後按「再試一次」。');
    expect(src).toContain('改好之後再按「送出」。');
  });

  it('金鑰的句子不寫死在 session.ts(用側車給的 message)', () => {
    const src = read('src/session.ts');
    expect(src).not.toContain('批改要用的金鑰');
    expect(src).not.toContain('批改用的金鑰被拒絕');
  });
});
