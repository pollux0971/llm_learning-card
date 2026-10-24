/**
 * T48 靜態測試 i(App.svelte 不留選不到任何元素的樣式;T46 `@manual` 的 O5)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T48-teach-card-fold-rerender-fix.md 第 4 條與「驗收條件 1」的靜態測試 i。
 *
 * 用 `svelte/compiler` 真的編譯 `App.svelte`(不比原始碼字串),編譯警告裡不准有 `css_unused_selector`。
 * 基底(main 3a1913b)上是紅的:`.lc-missing` 是 scoped 樣式,「找不到圖片」的 span 是執行時用 document.createElement 建的,選不到。
 * 「找不到圖片」字樣的字級不大於例子裡的字,在 t48-fold-rerender-render.test.ts(真渲染)量。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, 'App.svelte');

describe('T48 i:App.svelte 的編譯警告', () => {
  const result = compile(readFileSync(APP, 'utf8'), { filename: APP, generate: 'client' });
  const lineOf = (w: { start?: { line: number } }): string => (w.start ? `第 ${w.start.line} 行` : '位置不明');

  it('沒有 css_unused_selector(不留選不到任何元素的樣式)', () => {
    const unused = result.warnings.filter((w) => w.code === 'css_unused_selector');
    expect(unused.map((w) => `${lineOf(w)}:${w.message}`), 'App.svelte 的 <style> 有選不到任何元素的規則(例如 scoped 的 .lc-missing;改成 :global(.lc-missing) 或刪掉)').toEqual([]);
  });

  it('編譯有跑出結果(前提:真的編到了,不是空過)', () => {
    expect(result.js.code.length, '編出來的 js').toBeGreaterThan(1000);
    expect(result.css?.code ?? '', '編出來的 css').toContain('.markers');
  });
});
