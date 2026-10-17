/**
 * 06 phase-3 觀感修正(工單 T32)考試卡 header 在真 Chrome 裡的版面:「已答 / 總數」與「逾期 N」同一行,HP 條照舊自己一行、全寬。
 * 測試 agent 寫;開發 worker 不改。開法同 card-render-phase3.test.ts(`openCard('test-card')`,360 × 480)。
 *
 * 量的是相對位置(絕對 y 由 `@manual` 在 tauri 產物上量):
 *   1. 兩段字上緣 y 相差 ≤ 1;
 *   2. 「逾期 N」在右邊,兩段之間 8–24 px,兩段都在 header 矩形裡;
 *   3. HP 條上緣在兩段較低的下緣下面 0.2rem(±1),寬度 = header 寬(±1),左緣對齊(±1)。
 * 第 3 組在基底上本來就綠:它擋的是「只寫 display:flex + gap,HP 條被擠成兩條邊框寬」(T15 的 HP 條渲染測試這時是空過)。
 * 「只改 <style>」不寫成永久測試,由驗收者看 diff。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HEADER_GAP_MAX_PX, HEADER_GAP_MIN_PX, HEADER_HP_ROW_GAP_REM, HEADER_LAYOUT_TOLERANCE_PX,
} from './card-design-values-test-support.js';
import { answerOneItem, openCard } from './card-render-test-support.js';
import type { GalleryPage } from './render-test-support.js';

interface Box { left: number; right: number; top: number; bottom: number; width: number }
interface HeaderBoxes { header: Box; first: Box; overdue: Box; hp: Box; rootFontPx: number; firstText: string; overdueText: string }

/** 在頁面裡用字找兩段(葉子元素,跟 card-render-phase3 同一套找法),量各自的矩形 */
const MEASURE = `(() => {
  const header = document.querySelector('header.progress');
  if (!header) return { error: '找不到 header.progress' };
  const els = [...header.querySelectorAll('*')];
  const leaf = (re) => els.find((e) => e.children.length === 0 && re.test(e.textContent.trim()));
  const first = leaf(/^\\d+ \\/ \\d+/);
  const overdue = leaf(/^逾期/);
  const hp = header.querySelector('[data-hud="hp-bar"]');
  if (!first) return { error: '找不到「已答 / 總數」那一段' };
  if (!overdue) return { error: '找不到「逾期 N」那一段' };
  if (!hp) return { error: '找不到 HP 條' };
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
  return {
    header: box(header), first: box(first), overdue: box(overdue), hp: box(hp),
    rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    firstText: first.textContent.trim(), overdueText: overdue.textContent.trim(),
  };
})()`;

async function measure(page: GalleryPage): Promise<HeaderBoxes> {
  const m = await page.evaluate<HeaderBoxes | { error: string }>(MEASURE);
  if ('error' in m) throw new Error(m.error);
  return m;
}

const fmt = (n: number) => n.toFixed(1);

describe('考試卡 header 的版面(真 Chrome,T32)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openCard('test-card'); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => { if (!page) throw new Error('考試卡沒有開起來'); return page; };

  it('驗收 1:「已答 / 總數」與「逾期 N」在同一行(上緣 y 相差 ≤ 1)', async () => {
    await p().reset();
    const m = await measure(p());
    const diff = Math.abs(m.overdue.top - m.first.top);
    expect(diff, `兩段上緣 y:「${m.firstText}」${fmt(m.first.top)}、「${m.overdueText}」${fmt(m.overdue.top)},差 ${fmt(diff)}`).toBeLessThanOrEqual(HEADER_LAYOUT_TOLERANCE_PX);
  }, 90_000);

  it('驗收 1:「逾期 N」在右邊,跟「已答 / 總數」之間隔 8–24 px', async () => {
    await p().reset();
    const m = await measure(p());
    const gap = m.overdue.left - m.first.right;
    expect(gap, `「逾期 N」左緣 ${fmt(m.overdue.left)} 減「已答 / 總數」右緣 ${fmt(m.first.right)} = ${fmt(gap)}`).toBeGreaterThanOrEqual(HEADER_GAP_MIN_PX);
    expect(gap, `兩段隔 ${fmt(gap)} px,逾期數被推得太遠(上限 ${HEADER_GAP_MAX_PX})`).toBeLessThanOrEqual(HEADER_GAP_MAX_PX);
  }, 90_000);

  it('驗收 1:兩段字都在 header 的矩形裡(不溢出)', async () => {
    await p().reset();
    const m = await measure(p());
    const t = HEADER_LAYOUT_TOLERANCE_PX;
    for (const [name, b] of [['已答 / 總數', m.first], ['逾期 N', m.overdue]] as const) {
      expect(b.left, `${name} 左緣 ${fmt(b.left)} 在 header 左緣 ${fmt(m.header.left)} 之外`).toBeGreaterThanOrEqual(m.header.left - t);
      expect(b.right, `${name} 右緣 ${fmt(b.right)} 在 header 右緣 ${fmt(m.header.right)} 之外`).toBeLessThanOrEqual(m.header.right + t);
      expect(b.top, `${name} 上緣 ${fmt(b.top)} 在 header 上緣 ${fmt(m.header.top)} 之外`).toBeGreaterThanOrEqual(m.header.top - t);
      expect(b.bottom, `${name} 下緣 ${fmt(b.bottom)} 在 header 下緣 ${fmt(m.header.bottom)} 之外`).toBeLessThanOrEqual(m.header.bottom + t);
    }
  }, 90_000);

  it('驗收 2:HP 條在兩段字下面 0.2rem(T24 的間距,「送出」回到 T24 位置的前提)', async () => {
    await p().reset();
    const m = await measure(p());
    const lowest = Math.max(m.first.bottom, m.overdue.bottom);
    const want = HEADER_HP_ROW_GAP_REM * m.rootFontPx;
    const got = m.hp.top - lowest;
    expect(Math.abs(got - want), `HP 條上緣 ${fmt(m.hp.top)} 減兩段較低的下緣 ${fmt(lowest)} = ${fmt(got)},要 ${fmt(want)}(${HEADER_HP_ROW_GAP_REM}rem,±${HEADER_LAYOUT_TOLERANCE_PX})`).toBeLessThanOrEqual(HEADER_LAYOUT_TOLERANCE_PX);
  }, 90_000);

  it('驗收 2:HP 條寬度 = header 寬度,左緣對齊(擋「只寫 flex + gap,HP 條被擠成兩條邊框」)', async () => {
    await p().reset();
    const m = await measure(p());
    const t = HEADER_LAYOUT_TOLERANCE_PX;
    expect(Math.abs(m.hp.width - m.header.width), `HP 條寬 ${fmt(m.hp.width)},header 寬 ${fmt(m.header.width)}`).toBeLessThanOrEqual(t);
    expect(Math.abs(m.hp.left - m.header.left), `HP 條左緣 ${fmt(m.hp.left)},header 左緣 ${fmt(m.header.left)}`).toBeLessThanOrEqual(t);
  }, 90_000);

  it('答一題之後版面不變(進度的字變了,兩段仍同一行、HP 條仍自己一行全寬)', async () => {
    await p().reset();
    await answerOneItem(p());
    const m = await measure(p());
    const t = HEADER_LAYOUT_TOLERANCE_PX;
    expect(m.firstText).toMatch(/^1 \/ 3/);
    expect(Math.abs(m.overdue.top - m.first.top), '兩段不在同一行').toBeLessThanOrEqual(t);
    const gap = m.overdue.left - m.first.right;
    expect(gap).toBeGreaterThanOrEqual(HEADER_GAP_MIN_PX);
    expect(gap).toBeLessThanOrEqual(HEADER_GAP_MAX_PX);
    const want = HEADER_HP_ROW_GAP_REM * m.rootFontPx;
    expect(Math.abs(m.hp.top - Math.max(m.first.bottom, m.overdue.bottom) - want), 'HP 條離字的間距不是 0.2rem').toBeLessThanOrEqual(t);
    expect(Math.abs(m.hp.width - m.header.width), 'HP 條不是全寬').toBeLessThanOrEqual(t);
  }, 120_000);
});
