/**
 * T23(06 phase-3)驗收 1、2、3 的靜態檢查:`App.svelte` 的 header 順序與字色、stuck 一行、reteach「繼續」的位置、
 * 小結怎麼畫出來;`session.ts` 讀 summary 的結果、沒有靜默預設。紅測試作者寫;開發 worker 不改。只讀檔案文字。
 *
 * reteach 畫面在瀏覽器裡出不了(單獨執行的 fs 一律丟錯 → 「複習程式停了」),所以「繼續」在第一屏的實測由驗收 9 的 @manual
 * 在 tauri 產物上量;這裡只釘順序:說明那一行 → 「繼續」→ 內文(`pre.reteach`)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(APP, rel), 'utf8');
const app = (): string => read('src/App.svelte');

/** 取 `<header class="progress">…</header>` 的內容 */
function progressHeader(): string {
  const src = app();
  const m = /<header\s+class="progress"[^>]*>([^]*?)<\/header>/.exec(src);
  if (!m) throw new Error('App.svelte 找不到 <header class="progress">');
  return m[1]!;
}

/** 取 style 區塊裡某個 class 的規則內文(可能多條) */
function cssRulesFor(cls: string): string {
  const style = /<style[^>]*>([^]*?)<\/style>/.exec(app())?.[1] ?? '';
  const out: string[] = [];
  const re = new RegExp(`(^|[\\s,}])\\.${cls}\\b[^{]*\\{([^}]*)\\}`, 'g');
  for (const m of style.matchAll(re)) out.push(m[2] ?? '');
  return out.join('\n');
}

describe('header 的逾期數(驗收 1)', () => {
  it('順序是:已答 / 總數 → 逾期 N → HP 條', () => {
    const h = progressHeader();
    const answered = h.indexOf('{view.answeredCount} / {view.totalCount}');
    const overdue = h.search(/逾期\s*\{view\.overdueCount\}/);
    const bar = h.indexOf('<HpBar');
    expect(answered, '「已答 / 總數」那一段的字一個都不能改(T15 的渲染測試讀 header 的第一個數字)').toBeGreaterThanOrEqual(0);
    expect(overdue, '要有「逾期 {view.overdueCount}」').toBeGreaterThanOrEqual(0);
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(answered).toBeLessThan(overdue);
    expect(overdue).toBeLessThan(bar);
  });

  it('逾期數的元素不用 --hud-fail、不掛 fail 的 class(逾期不是錯誤,一般字色)', () => {
    const h = progressHeader();
    const el = /<(span|p|div)([^>]*)>\s*逾期\s*\{view\.overdueCount\}/.exec(h);
    expect(el, '逾期數要在自己的元素裡').not.toBeNull();
    const attrs = el![2] ?? '';
    expect(attrs).not.toMatch(/fail|error|warn/i);
    const cls = /class="([^"]*)"/.exec(attrs)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    for (const c of cls) expect(cssRulesFor(c), `.${c} 的規則不該用 --hud-fail`).not.toContain('--hud-fail');
    expect(h).not.toMatch(/逾期[^<]*var\(--hud-fail\)/);
  });

  it('逾期數用的是 start 的 overdue(view.overdueCount),不是目前這張卡的 overdueDays', () => {
    const h = progressHeader();
    expect(h).not.toMatch(/overdueDays/);
    expect(h).toContain('view.overdueCount');
  });
});

describe('stuck 標記(驗收 3)', () => {
  const LINE = '這張卡已經連續答錯 3 次以上。';

  it('有這一行字,在 {#if view.current.stuck} 裡', () => {
    const src = app();
    expect(src).toContain(LINE);
    expect(src).toMatch(/\{#if\s+view\.current(\?)?\.stuck\s*\}\s*<[^>]*>\s*這張卡已經連續答錯 3 次以上。/);
  });

  it('在題幹上面:這一行出現在第一個 class="prompt" 之前', () => {
    const src = app();
    expect(src.indexOf(LINE)).toBeGreaterThan(-1);
    expect(src.indexOf(LINE)).toBeLessThan(src.indexOf('class="prompt"'));
  });

  it('用 --hud-fail 的字色(跟 reteach 的說明同一個樣式)', () => {
    const src = app();
    const el = /<(p|span|div)([^>]*)>\s*這張卡已經連續答錯 3 次以上。/.exec(src);
    expect(el).not.toBeNull();
    const cls = /class="([^"]*)"/.exec(el![2] ?? '')?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    expect(cls.length, 'stuck 那一行要有 class').toBeGreaterThan(0);
    expect(cls.some((c) => cssRulesFor(c).includes('--hud-fail')), `class ${cls.join(' ')} 的規則要用 var(--hud-fail)`).toBe(true);
  });
});

describe('reteach 的「繼續」在內文上方(驗收 3,O5)', () => {
  function reteachBlock(): string {
    const src = app();
    const from = src.search(/\{:else if\s+view\.state\s*===\s*'reteach'/);
    expect(from, 'App.svelte 找不到 reteach 區塊').toBeGreaterThanOrEqual(0);
    const rest = src.slice(from + 5);
    const next = rest.search(/\{:else if\s+view\.state\b/);
    return src.slice(from, from + 5 + (next < 0 ? rest.length : next));
  }

  it('順序:說明那一行(view.reteach.notice)→「繼續」→ <pre class="reteach">', () => {
    const b = reteachBlock();
    const notice = b.indexOf('view.reteach.notice');
    const cont = b.search(/<HudButton[^>]*>\s*繼續\s*<\/HudButton>/);
    const pre = b.indexOf('<pre class="reteach"');
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(cont, 'reteach 區塊裡要有「繼續」的 HudButton').toBeGreaterThanOrEqual(0);
    expect(pre).toBeGreaterThanOrEqual(0);
    expect(notice).toBeLessThan(cont);
    expect(cont).toBeLessThan(pre);
  });

  it('「繼續」仍然接到 next', () => {
    expect(reteachBlock()).toMatch(/<HudButton[^>]*onclick=\{next\}[^>]*>\s*繼續/);
  });

  it('整份檔案只有一個「繼續」(沒有留著下面那顆)', () => {
    expect((app().match(/>\s*繼續\s*</g) ?? []).length).toBe(1);
  });
});

describe('小結怎麼畫出來(驗收 2)', () => {
  it('done 狀態印 view.message 加 view.summaryLines 的每一句,沒有 {@html', () => {
    const src = app();
    expect(src).toMatch(/\{#each\s+view\.summaryLines\b/);
    expect(src).not.toContain('{@html');
  });

  it("小結的句子只在 done 分支裡畫(整段拿掉會紅;T23 驗收 A4):view.summaryLines 外面包著的 {#if}/{:else if} 條件是 view.state === 'done'", () => {
    const src = app();
    expect(src).toContain('view.summaryLines');
    const at = src.indexOf('view.summaryLines');
    // 逐個標籤走一遍,維持巢狀堆疊;只看 at 之前打開、還沒關的 if 分支
    const stack: { cond: string }[] = [];
    for (const m of src.slice(0, at).matchAll(/\{(#if|:else if|:else|\/if)\b\s*([^}]*)\}/g)) {
      const tag = m[1]!;
      if (tag === '#if') stack.push({ cond: (m[2] ?? '').trim() });
      else if (tag === ':else if') stack[stack.length - 1] = { cond: (m[2] ?? '').trim() };
      else if (tag === ':else') stack[stack.length - 1] = { cond: 'else' };
      else stack.pop();
    }
    const conds = stack.map((x) => x.cond);
    expect(conds.some((c) => /^view\.state\s*===\s*'done'$/.test(c)), `外面的條件:${JSON.stringify(conds)}`).toBe(true);
  });

  it('session.ts 讀 summary 的結果(readSummary),不是丟掉', () => {
    const src = read('src/session.ts');
    expect(src).toMatch(/\breadSummary\b/);
    expect(src).toMatch(/client\.summary\s*\(/);
    for (const field of ['passed', 'returned', 'retryLater', 'tomorrow', 'capped', 'shown', 'overflow', 'snapshot']) {
      expect(src, `session.ts 沒提到 summary 的 ${field}`).toContain(field);
    }
  });

  it('文字固定在 session.ts(畫面只印 view 給的句子,不自己組)', () => {
    const src = read('src/session.ts');
    for (const piece of ['通過', '退回', '評分失敗,下次再考', '明天預估', '已到每天上限', '順延']) expect(src).toContain(piece);
    const a = app();
    for (const piece of ['通過', '明天預估', '已到每天上限']) expect(a, `App.svelte 不該自己組「${piece}」`).not.toContain(piece);
  });
});

describe('沒有靜默預設(驗收 8)', () => {
  it('session.ts 沒有 `?? 0`、`?? ""`、`|| 0` 這種補預設值的寫法', () => {
    const src = read('src/session.ts');
    expect(src).not.toMatch(/\?\?\s*0\b/);
    expect(src).not.toMatch(/\?\?\s*(''|"")/);
    expect(src).not.toMatch(/\|\|\s*0\b/);
  });

  it('showRetry 與 showStopped / showError 之間沒有留重複的 clearCard 與 submitting = false(只留一份)', () => {
    const src = read('src/session.ts');
    // finally 那一份
    expect((src.match(/this\.submitting\s*=\s*false/g) ?? []).length).toBe(1);
    // showRetry 裡不再自己 clearCard
    const m = /private showRetry\([^)]*\)[^{]*\{([^}]*)\}/.exec(src);
    expect(m, '找不到 showRetry').not.toBeNull();
    expect(m![1]).not.toContain('clearCard');
    expect(m![1]).not.toContain('submitting');
  });
});
