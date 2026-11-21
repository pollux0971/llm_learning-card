/**
 * T66 渲染測試(I4 第 73 行「教學卡顯示 llm 的標示」,顧問裁定 D3 甲):`App.svelte` 真的畫出來,量畫面上的來源標示。測試 agent 寫;只有測試,產品程式沒改。
 * 工單 docs/tickets/T66-i4-integration-steps.md「D3」。
 *
 * 為什麼單獨一支:`App.svelte` 的標示列是模板裡的一行(`source === 'raw' ? '原始' : '生成'`),沒有任何測試量過;
 * I4 的 cucumber 場景只看側車回的內文(frontmatter 是 `source: llm`),標示寫成別的字不會被抓到。這支補上「依那一欄畫出什麼字」。
 *
 * 做法同 apps/teach-card/src/t67-load-render.test.ts:`openApp(apps/teach-card, { viewport, ready, initScript })` = 單獨的 vite dev server +
 * 真的側車(跑在 fixture 的暫存複本上,fixture 的卡 source 都是 raw)+ headless Chrome。initScript 換掉 `window.fetch`(測試那一邊的事):
 * 讀卡片內文的請求(`/__card?path=…`)照常打給 dev server,回來的文字依 sessionStorage 的 `t66` 改 frontmatter:
 *   'raw'(沒設)         原樣(fixture 的卡:source: raw)
 *   'llm'               `source: raw` 改成 `source: llm`,拿掉 `source_ref` 那一行(跟主題生成寫出來的卡一樣)
 *   'llm-provisional'   同上,再加 `provisional: true`(離線生成、待審核)
 * 07 phase-3「the marker is visible in the interface」也只看 frontmatter;「待審核」徽章順便補在這裡(同一支渲染測試,T66 工單低優先小票)。
 *
 * 被量的就是標示列裡的 `.source` 與 `.badge`:元素的字,以及它真的在畫面上(有寬高、在 `.markers` 裡)。
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from '../../packages/ui-shared/src/hud/render-test-support.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const TEACH_DIR = join(import.meta.dirname, '../../apps/teach-card');
const VIEWPORT = { width: 360, height: 480 } as const;

const INIT_SCRIPT = `(() => {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const res = await orig(input, init);
    if (!url.includes('/__card?')) return res;
    let mode = 'raw';
    try { mode = sessionStorage.getItem('t66') || 'raw'; } catch (e) { /* 沒有 sessionStorage 就是 raw */ }
    if (mode === 'raw') return res;
    let text = await res.text();
    text = text.replace(/^source: raw$/m, 'source: llm').replace(/^source_ref: .*\\n/m, '');
    if (mode === 'llm-provisional') text = text.replace(/^created: /m, 'provisional: true\\ncreated: ');
    return new Response(text, { status: res.status, headers: res.headers });
  };
})()`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(page: GalleryPage, predicate: string, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate<boolean>(`Boolean(${predicate})`)) return true;
    await sleep(60);
  }
  return false;
}

interface Marker {
  text: string;
  inMarkers: boolean;
  width: number;
  height: number;
}
const MARKER = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { text: el.textContent.trim(), inMarkers: Boolean(el.closest('.markers')), width: r.width, height: r.height };
})()`;

async function show(page: GalleryPage, mode: 'raw' | 'llm' | 'llm-provisional'): Promise<void> {
  await page.evaluate(`(() => { sessionStorage.setItem('t66', ${JSON.stringify(mode)}); return true; })()`);
  await page.reset();
  const loaded = await waitFor(page, `document.querySelector('.markers .source')`);
  expect(loaded, `卡片要載好、標示列要有來源;畫面文字:${await page.evaluate<string>('document.body.innerText')}`).toBe(true);
}

describe('T66 教學卡標示列的來源標示(I4 第 73 行,D3 甲)', () => {
  let page: GalleryPage;
  beforeAll(async () => {
    page = await openApp(TEACH_DIR, { viewport: VIEWPORT, ready: '.markers', initScript: INIT_SCRIPT });
  });
  afterAll(async () => {
    await page?.close();
  });

  it('source 是 raw 的卡:標示是「原始」', async () => {
    await show(page, 'raw');
    const m = await page.evaluate<Marker | null>(MARKER('.markers .source'));
    expect(m, '標示列要有 .source').not.toBeNull();
    expect(m!.text).toBe('原始');
    expect(m!.inMarkers).toBe(true);
    expect(m!.width, '標示真的有畫出來').toBeGreaterThan(0);
    expect(m!.height).toBeGreaterThan(0);
  });

  it('source 是 llm 的卡(沒有 source_ref,跟主題生成寫出來的一樣):標示是「生成」,不是「原始」', async () => {
    await show(page, 'llm');
    const m = await page.evaluate<Marker | null>(MARKER('.markers .source'));
    expect(m, '標示列要有 .source').not.toBeNull();
    expect(m!.text).toBe('生成');
    expect(m!.inMarkers).toBe(true);
    expect(m!.width).toBeGreaterThan(0);
    expect(m!.height).toBeGreaterThan(0);
    expect(await page.evaluate<string>(`document.querySelector('.markers').innerText`)).not.toContain('原始');
  });

  it('沒有 provisional 的卡不顯示「待審核」;provisional 的 llm 卡顯示「生成」與「待審核」徽章(07 phase-3 那條只量 frontmatter)', async () => {
    await show(page, 'llm');
    expect(await page.evaluate<Marker | null>(MARKER('.markers .badge')), '不是待審核就沒有徽章').toBeNull();
    await show(page, 'llm-provisional');
    const source = await page.evaluate<Marker | null>(MARKER('.markers .source'));
    const badge = await page.evaluate<Marker | null>(MARKER('.markers .badge'));
    expect(source?.text).toBe('生成');
    expect(badge, '待審核的卡標示列要有 .badge').not.toBeNull();
    expect(badge!.text).toBe('待審核');
    expect(badge!.inMarkers).toBe(true);
    expect(badge!.width).toBeGreaterThan(0);
  });
});
