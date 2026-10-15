/**
 * 14-hud-skin T14 驗收補測(驗收者寫):兩個前端測試沒釘到的方向。
 *
 * 突變 K10(標籤不撐滿):按鈕一旦比文字寬(例如卡片裡給 min-width / width:100%),標籤兩側露出黑底,框線不是 1 像素。
 *   前端的測試只量展示頁上「剛好等於文字寬」的按鈕,所以拿掉 `flex: 1 1 auto` 沒人知道。
 * 突變 K12(焦點內框 2px → 0.5px):焦點跟 hover 只要差 30 個像素就過,內框細到看不見也過。
 *   實測內框是 2 像素、約 300 個像素的差;下限設 250。
 * 找不到 Chrome 就紅(設 LC_CHROME),不跳過。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { differingPixels, openGallery, px, type GalleryPage } from './render-test-support.js';

describe('T14 驗收補測(headless Chrome)', () => {
  let page: GalleryPage | undefined;
  beforeAll(async () => { page = await openGallery(); }, 60_000);
  afterAll(async () => { await page?.close(); }, 30_000);
  const p = (): GalleryPage => {
    if (!page) throw new Error('展示頁沒有開起來');
    return page;
  };

  it('按鈕比文字寬(min-width 320px)時,左右兩側的框線仍是 1 像素,標籤撐滿', async () => {
    await p().reset();
    await p().evaluate(`(() => {
      for (const b of document.querySelectorAll('[data-hud="button"]')) b.style.minWidth = '320px';
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
    })()`);
    const img = await p().screenshot();
    const count = await p().evaluate<number>(`document.querySelectorAll('[data-hud="button"]').length`);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const r = await p().rect('[data-hud="button"]', i);
      expect(r.width, `第 ${i + 1} 顆按鈕有被撐寬`).toBeGreaterThan(300);
      const y = Math.round(r.y + r.height / 2);
      const dark = (x: number): boolean => {
        const [R, G, B] = px(img, x, y);
        return 0.299 * R + 0.587 * G + 0.114 * B < 100;
      };
      const left = Array.from({ length: 8 }, (_, k) => Math.floor(r.x) - 1 + k).filter(dark).length;
      const right = Array.from({ length: 8 }, (_, k) => Math.ceil(r.x + r.width) - 7 + k).filter(dark).length;
      expect(left, `第 ${i + 1} 顆按鈕左邊緣 8 個像素裡的黑色像素數`).toBeLessThanOrEqual(2);
      expect(right, `第 ${i + 1} 顆按鈕右邊緣 8 個像素裡的黑色像素數`).toBeLessThanOrEqual(2);
    }
  }, 60_000);

  it('焦點內框夠粗:focus-visible 跟 hover 差至少 250 個像素,而且按鈕中線上方有恰好 2 列接近 --hud-solid 的像素', async () => {
    await p().reset();
    const r = await p().rect('[data-hud="button"]', 1);
    const clip = { x: Math.floor(r.x) - 6, y: Math.floor(r.y) - 6, width: Math.ceil(r.width) + 12, height: Math.ceil(r.height) + 12 };
    const shot = async (states: string[]) => {
      await p().forceState('[data-hud="button"]', 1, states);
      return p().screenshot(clip);
    };
    const hover = await shot(['hover']);
    const focus = await shot(['focus', 'focus-visible']);
    await p().forceState('[data-hud="button"]', 1, []);
    expect(differingPixels(focus, hover)).toBeGreaterThanOrEqual(250);
    const solid = await p().evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--hud-solid').trim()`);
    const m = /^#([0-9a-f]{6})$/i.exec(solid);
    expect(m, `--hud-solid 應該是 #rrggbb:${solid}`).not.toBeNull();
    const want = [0, 2, 4].map((k) => parseInt(m![1]!.slice(k, k + 2), 16));
    const cx = Math.round(clip.width / 2);
    let ring = 0;
    for (let y = 6; y < 6 + Math.floor(r.height / 2); y += 1) {
      const c = px(focus, cx, y);
      if (c.every((v, i) => Math.abs(v - want[i]!) <= 6)) ring += 1;
    }
    expect(ring, '按鈕上半部中線這一欄上,接近 --hud-solid 的像素數').toBe(2);
  }, 60_000);
});
