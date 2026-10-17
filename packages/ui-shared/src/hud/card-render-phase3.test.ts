/**
 * 06 phase-3(工單 T23)考試卡在真 Chrome 裡的檢查:header 的逾期數、按鈕真的重新 start。測試 agent 寫;開發 worker 不改。
 * 開法同 T15(`openCard('test-card')`,dev server + 單獨執行的假後端,360 × 480);找不到 Chrome 就紅(設 LC_CHROME)。
 *
 * 「點鈕真的重新 start」(驗收 5 (a)):頁面裡的 `window.fetch` 換成會記錄 `/__review` 請求的版本,
 * 並能指定「下一個某方法回一個錯誤」。這是測試那一邊的事,產品程式不用為它改。
 *   - 再試一次:答完一題,讓 `next` 回 no-cards → 畫面是「再試一次」→ 點 → 又收到一次 start → 回到題目;
 *   - 重新開始:讓 `next` 回 internal → 畫面是「複習程式停了。」+「重新開始」→ 點 → 又收到一次 start → 回到題目。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_CARD_DIR } from './card-design-values-test-support.js';
import { answerOneItem, openCard, progressText, submitCurrent } from './card-render-test-support.js';
import type { GalleryPage } from './render-test-support.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page: GalleryPage, predicate: string, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate<boolean>(`Boolean(${predicate})`)) return true;
    await sleep(60);
  }
  return false;
}

const BUTTON = (label: string) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;

async function clickButton(page: GalleryPage, label: string): Promise<void> {
  const ok = await page.evaluate<boolean>(`(() => { const b = ${BUTTON(label)}; if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`畫面上找不到字是「${label}」的按鈕;畫面文字:${await page.evaluate<string>('document.body.innerText')}`);
}

const hasButton = (page: GalleryPage, label: string) => page.evaluate<boolean>(`Boolean(${BUTTON(label)})`);

/** 記錄 /__review 的請求;inject[method] 是一串要回的錯誤(用掉就放行) */
const INSTALL_SPY = `(() => {
  const orig = window.fetch.bind(window);
  window.__t23 = { methods: [], inject: {} };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/__review')) return orig(input, init);
    const body = JSON.parse(init.body);
    window.__t23.methods.push(body.method);
    const queue = window.__t23.inject[body.method];
    if (queue && queue.length > 0) {
      const error = queue.shift();
      return new Response(JSON.stringify({ v: 1, id: body.id, ok: false, error }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return orig(input, init);
  };
  return true;
})()`;

const startsSeen = (page: GalleryPage) => page.evaluate<number>(`window.__t23.methods.filter((m) => m === 'start').length`);
const injectError = (page: GalleryPage, method: string, kind: string, message: string) =>
  page.evaluate(`(() => { (window.__t23.inject[${JSON.stringify(method)}] ??= []).push({ kind: ${JSON.stringify(kind)}, message: ${JSON.stringify(message)} }); return true; })()`);

/** 種子檔裡「今天(2026-09-10)之前到期」的張數 = 逾期 ≥ 1 的張數(從檔案算,不寫死) */
function seedOverdue(): number {
  const seed = JSON.parse(readFileSync(join(TEST_CARD_DIR, 'dev/reviews.seed.json'), 'utf8')) as Record<string, { next_due: string }>;
  return Object.values(seed).filter((r) => r.next_due < '2026-09-10').length;
}

describe('考試卡 header 的逾期數(真 Chrome,驗收 1)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openCard('test-card'); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => { if (!page) throw new Error('考試卡沒有開起來'); return page; };

  it('header 先是「已答 / 總數」再是「逾期 N」:剛載入是「0 / 3 逾期 N」,N 是種子裡逾期 ≥ 1 天的張數', async () => {
    await p().reset();
    const text = await progressText(p());
    expect(text).toMatch(/^0 \/ 3 逾期 \d+/);
    expect(Number(/逾期 (\d+)/.exec(text)![1])).toBe(seedOverdue());
  }, 60_000);

  it('答一題之後:「1 / 3」,逾期數不變(一天之內固定)', async () => {
    await p().reset();
    const before = Number(/逾期 (\d+)/.exec(await progressText(p()))![1]);
    await answerOneItem(p());
    const text = await progressText(p());
    expect(text).toMatch(/^1 \/ 3 逾期 \d+/);
    expect(Number(/逾期 (\d+)/.exec(text)![1])).toBe(before);
  }, 90_000);

  it('逾期數是 0 也顯示「逾期 0」(種子今天到期,沒有逾期)', async () => {
    await p().reset();
    if (seedOverdue() !== 0) return;
    expect(await progressText(p())).toContain('逾期 0');
  }, 60_000);

  it('逾期數用一般字色:跟「已答 / 總數」同色,而且不是 --hud-fail', async () => {
    await p().reset();
    const colors = await p().evaluate<{ first: string; overdue: string; fail: string } | null>(`(() => {
      const header = document.querySelector('header.progress');
      if (!header) return null;
      const els = [...header.querySelectorAll('*')];
      const overdue = els.find((e) => e.children.length === 0 && /^逾期/.test(e.textContent.trim()));
      const first = els.find((e) => e.children.length === 0 && /^\\d+ \\/ \\d+/.test(e.textContent.trim()));
      if (!overdue || !first) return null;
      const probe = document.createElement('span');
      probe.style.color = 'var(--hud-fail)';
      document.body.appendChild(probe);
      const fail = getComputedStyle(probe).color;
      probe.remove();
      return { first: getComputedStyle(first).color, overdue: getComputedStyle(overdue).color, fail };
    })()`);
    expect(colors, '找不到 header 裡「逾期 N」與「已答 / 總數」兩個元素').not.toBeNull();
    expect(colors!.overdue).toBe(colors!.first);
    expect(colors!.overdue).not.toBe(colors!.fail);
  }, 60_000);

  it('沒有 stuck 的卡:題幹上面沒有「連續答錯 3 次以上」', async () => {
    await p().reset();
    expect(await p().evaluate<string>('document.body.innerText')).not.toContain('這張卡已經連續答錯 3 次以上。');
  }, 60_000);
});

describe('按鈕真的重新 start(真 Chrome,驗收 5 (a))', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openCard('test-card'); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => { if (!page) throw new Error('考試卡沒有開起來'); return page; };

  it('「再試一次」:no-cards 的錯誤畫面點「再試一次」→ 又收到一次 start → 回到題目;沒有「重新開始」', async () => {
    await p().reset();
    await p().evaluate(INSTALL_SPY);
    await submitCurrent(p());
    await injectError(p(), 'next', 'no-cards', '卡片目錄裡沒有任何卡片。');
    await clickButton(p(), '下一題');
    expect(await waitFor(p(), BUTTON('再試一次')), `錯誤畫面沒出現;畫面文字:${await p().evaluate<string>('document.body.innerText')}`).toBe(true);
    expect(await hasButton(p(), '重新開始')).toBe(false);
    expect(await p().evaluate<string>('document.body.innerText')).toContain('改好之後按「再試一次」。');
    expect(await startsSeen(p())).toBe(0);
    await clickButton(p(), '再試一次');
    expect(await waitFor(p(), `document.querySelector('.prompt')`), '點了「再試一次」之後 8 秒內沒有回到題目').toBe(true);
    expect(await startsSeen(p())).toBe(1);
    expect(await hasButton(p(), '再試一次')).toBe(false);
  }, 90_000);

  it('「重新開始」:internal 的錯誤畫面(複習程式停了)點「重新開始」→ 又收到一次 start → 回到題目;沒有「再試一次」', async () => {
    await p().reset();
    await p().evaluate(INSTALL_SPY);
    await submitCurrent(p());
    await injectError(p(), 'next', 'internal', '內部發生問題,請稍後再試。');
    await clickButton(p(), '下一題');
    expect(await waitFor(p(), BUTTON('重新開始')), `錯誤畫面沒出現;畫面文字:${await p().evaluate<string>('document.body.innerText')}`).toBe(true);
    expect(await hasButton(p(), '再試一次')).toBe(false);
    expect(await p().evaluate<string>('document.body.innerText')).toContain('複習程式停了。');
    expect(await startsSeen(p())).toBe(0);
    await clickButton(p(), '重新開始');
    expect(await waitFor(p(), `document.querySelector('.prompt')`), '點了「重新開始」之後 8 秒內沒有回到題目').toBe(true);
    expect(await startsSeen(p())).toBe(1);
    expect(await hasButton(p(), '重新開始')).toBe(false);
  }, 90_000);

  it('連點兩次錯誤 → 兩次都有重新 start(按鈕不是只能用一次)', async () => {
    await p().reset();
    await p().evaluate(INSTALL_SPY);
    await submitCurrent(p());
    await injectError(p(), 'next', 'no-cards', 'x');
    await clickButton(p(), '下一題');
    expect(await waitFor(p(), BUTTON('再試一次'))).toBe(true);
    // 第一次再試一次:start 又回 no-cards → 還是錯誤畫面
    await injectError(p(), 'start', 'no-cards', 'x');
    await clickButton(p(), '再試一次');
    await sleep(300);
    expect(await waitFor(p(), BUTTON('再試一次'))).toBe(true);
    expect(await startsSeen(p())).toBe(1);
    await clickButton(p(), '再試一次');
    expect(await waitFor(p(), `document.querySelector('.prompt')`)).toBe(true);
    expect(await startsSeen(p())).toBe(2);
  }, 90_000);
});
