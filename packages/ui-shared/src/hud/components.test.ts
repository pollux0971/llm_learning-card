/**
 * 14-hud-skin / phase-1:元件的伺服器端 render(用 vite 的 ssrLoadModule 在 node 裡載入 .svelte,不需要 DOM)。
 * 測試 agent 擁有。DOM 掛鉤與 props 見 test-support.ts 檔頭。
 * 因為是伺服器端 render:「在不在 Tauri」「有沒有 frameless」都必須在 render 當下由 props 決定,
 * 不能等 onMount(onMount 在伺服器端不會跑)。預設值:frameless 不給 = 讀頁面根元素的 class,沒有 document 時當作 false。
 */
import {
  closeViteServer, countHook, createRawSnippetOrThrow, makeWindowSpy, renderSvelte, importHud,
  type WindowControls, type ControlsDeps,
} from './test-support.js';

afterAll(async () => { await closeViteServer(); });

async function controls(tauri: boolean): Promise<WindowControls> {
  const m = (await importHud('window-controls')) as { createWindowControls(d?: ControlsDeps): WindowControls };
  return m.createWindowControls(makeWindowSpy(tauri).deps);
}
async function panel(extra: Record<string, unknown>): Promise<string> {
  return renderSvelte('HudPanel', { title: 'Card title', children: await createRawSnippetOrThrow('<p data-test="body">hello</p>'), ...extra });
}

describe('HudPanel:沒有 hud-frameless 就不畫標題列', () => {
  it.each([false, true])('frameless=false、tauri=%s → 沒有標題列、沒有縮放把手,內容照常出現', async (tauri) => {
    const html = await panel({ frameless: false, controls: await controls(tauri) });
    expect(html).toMatch(/data-hud=["']panel["']/);
    expect(html).toContain('data-test="body"');
    expect(countHook(html, 'titlebar')).toBe(0);
    expect(countHook(html, 'resize-handle')).toBe(0);
    expect(countHook(html, 'minimize')).toBe(0);
    expect(countHook(html, 'close')).toBe(0);
  });

  it('沒給 frameless、也沒有 document(node)→ 當作沒有 class,不畫標題列', async () => {
    const html = await panel({});
    expect(countHook(html, 'titlebar')).toBe(0);
    expect(countHook(html, 'resize-handle')).toBe(0);
  });
});

describe('HudPanel:有 hud-frameless', () => {
  it('不在桌面程式裡 → 標題列顯示視窗標題,沒有縮小與關閉鈕,不丟錯、不 console.error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const html = await panel({ frameless: true, controls: await controls(false) });
      expect(countHook(html, 'titlebar')).toBe(1);
      expect(html).toMatch(/data-hud=["']title["'][^>]*>[^<]*Card title/);
      expect(countHook(html, 'minimize')).toBe(0);
      expect(countHook(html, 'close')).toBe(0);
      expect(err).not.toHaveBeenCalled();
    } finally { err.mockRestore(); }
  });

  it('在桌面程式裡 → 標題列有且只有一個縮小鈕與一個關閉鈕', async () => {
    const html = await panel({ frameless: true, controls: await controls(true) });
    expect(countHook(html, 'titlebar')).toBe(1);
    expect(countHook(html, 'minimize')).toBe(1);
    expect(countHook(html, 'close')).toBe(1);
  });

  it('縮放把手:四邊四角各一個,共 8 個', async () => {
    const html = await panel({ frameless: true, controls: await controls(true) });
    expect(countHook(html, 'resize-handle')).toBe(8);
    const edges = [...html.matchAll(/data-hud-edge=["']([A-Za-z]+)["']/g)].map((m) => m[1]).sort();
    expect(edges).toEqual(['East', 'North', 'NorthEast', 'NorthWest', 'South', 'SouthEast', 'SouthWest', 'West']);
  });

  it('標題是文字不是 HTML:標題裡的角括號被跳脫', async () => {
    const html = await panel({ frameless: true, title: '<b>x</b>', controls: await controls(false) });
    expect(html).not.toContain('<b>x');
    expect(html).toContain('&lt;b');
  });
});

describe('HudPanel:solid', () => {
  it('solid=true 時根元素帶 hud-solid 標記(class 或 data-hud-solid),solid=false 時沒有', async () => {
    const on = await panel({ solid: true, frameless: false });
    const off = await panel({ solid: false, frameless: false });
    const mark = /hud-solid|data-hud-solid/;
    expect(on).toMatch(mark);
    expect(off).not.toMatch(mark);
  });
});

describe('HudButton', () => {
  it('是 <button type="button">,顯示 children;disabled 時有 disabled', async () => {
    const children = await createRawSnippetOrThrow('Next');
    const html = await renderSvelte('HudButton', { children });
    expect(html).toMatch(/<button\b[^>]*data-hud=["']button["']/);
    expect(html).toMatch(/<button\b[^>]*type=["']button["']/);
    expect(html).toContain('Next');
    expect(html).not.toMatch(/<button\b[^>]*\sdisabled\b/);
    const off = await renderSvelte('HudButton', { children, disabled: true });
    expect(off).toMatch(/<button\b[^>]*\sdisabled\b/);
  });
});
