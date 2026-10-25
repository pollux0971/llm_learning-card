/**
 * T56(HUD 的縮放把手與標題列,改在 mousedown 開始拖拉、只認左鍵;T54 的修正)渲染測試 a–e。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T56-hud-drag-on-mousedown.md 「驗收條件 1」與顧問加的兩點。
 *
 * 真的在 Chrome 畫出展示頁(`openApp(gallery, { initScript })`),打開「無框」開關後有標題列與八個縮放把手。
 * 看得到「開始了沒」:`initScript` 在頁面腳本之前放 `globalThis.isTauri = true`(`@tauri-apps/api/core` 的 `isTauri()` 認的)與一個假的
 * `window.__TAURI_INTERNALS__`(`metadata.currentWindow.label` 與 `invoke`),`invoke` 把命令名與參數記進 `window.__t56.calls`。
 * 頁面走真的 `createWindowControls()` → `@tauri-apps/api/window` → `invoke('plugin:window|start_dragging' | 'start_resize_dragging' | 'minimize' | 'close', ...)`,
 * 所以量到的就是真的接線。不比對原始碼字串(SKILL §4g 第 29 條)。
 *
 * 真滑鼠:同一個 Chrome 的第二條 CDP(`Input.dispatchMouseEvent`,可以選左 / 右 / 中鍵),真的會先送 pointerdown 再送 mousedown。
 *   a 左鍵:八個把手各按放一次、標題列文字一次 → 各叫一次對應的開始(縮放帶對的方向 value = data-hud-edge)。
 *   b 右鍵、中鍵:同樣九個位置 → 一次都不叫(真的按鍵 + 合成的非左鍵 mousedown 各一輪)。
 *   c 按鈕:按縮小、關閉鈕 → 不叫 start_dragging;按鈕自己的動作各一次(minimize、close)。
 *   d 連續兩次拖拉的第二次:第一次真的左鍵;第二次在同一個位置**只發 mousedown、不發 pointerdown**(頁面裡 dispatchEvent 左鍵的 MouseEvent)→ 第二次也要開始。
 *     另外**只發 pointerdown、不發 mousedown** → 不開始(釘住開始的是 mousedown)。九個位置各一條。
 *   e 不重複:一次真的左鍵按放 → 剛好一次;在頁面裡照正常順序送合成的 pointerdown 接著 mousedown → 也剛好一次(顧問加)。
 *
 * 在基底(T54 合併後的 main,onpointerdown):b、d 紅(任何鍵都開始;只有 mousedown 時不開始、只有 pointerdown 時會開始);a、c、e 本來就綠(護欄)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openApp, type GalleryPage } from './render-test-support.js';
import { HUD_DIR } from './test-support.js';

// 每條都在同一個 Chrome 裡重新載入頁面;逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const EDGES = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const;
type Target = { kind: 'edge'; edge: (typeof EDGES)[number] } | { kind: 'title' };
const TARGETS: Target[] = [...EDGES.map((edge) => ({ kind: 'edge', edge }) as const), { kind: 'title' }];
const nameOf = (t: Target): string => (t.kind === 'edge' ? `把手 ${t.edge}` : '標題列文字');
const selectorOf = (t: Target): string => (t.kind === 'edge' ? `[data-hud="resize-handle"][data-hud-edge="${t.edge}"]` : '[data-hud="title"]');

const START_DRAG = 'plugin:window|start_dragging';
const START_RESIZE = 'plugin:window|start_resize_dragging';

const INIT_SCRIPT = `(() => {
  globalThis.isTauri = true;
  const st = (window.__t56 = { calls: [] });
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    invoke: async (cmd, args) => { st.calls.push({ cmd, args: args ?? null }); return null; },
    transformCallback: () => 0,
    convertFileSrc: (p) => p,
  };
})();`;

interface Call { cmd: string; args: Record<string, unknown> | null }

/** 同一個 Chrome 的第二條 CDP,送真的滑鼠(可選鍵) */
class Pointer {
  private seq = 0;
  private readonly pending = new Map<number, (m: { error?: { message: string } }) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: { message: string } };
      if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      }
    };
  }

  static async attach(pageUrl: string): Promise<Pointer> {
    for (const name of readdirSync(tmpdir()).filter((n) => n.startsWith('hud-render-chrome-'))) {
      const portFile = join(tmpdir(), name, 'DevToolsActivePort');
      if (!existsSync(portFile)) continue;
      const port = readFileSync(portFile, 'utf8').split('\n')[0]?.trim();
      if (!port) continue;
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
        const target = list.find((t) => t.type === 'page' && t.url.startsWith(pageUrl));
        if (!target) continue;
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('連不上 DevTools'));
        });
        const p = new Pointer(ws);
        await p.send('Page.bringToFront');
        return p;
      } catch {
        /* 別人的(已經結束的)Chrome,換下一個 */
      }
    }
    throw new Error(`找不到開著 ${pageUrl} 的 Chrome(hud-render-chrome-*/DevToolsActivePort)`);
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<void> {
    this.seq += 1;
    const id = this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve()));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 移過去、按下、放開(同一個點) */
  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    const mask = { left: 1, right: 2, middle: 4 }[button];
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: mask, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
  }

  close(): void {
    this.ws.close();
  }
}

let page: GalleryPage | undefined;
let pointer: Pointer | undefined;
const pg = (): GalleryPage => {
  if (!page) throw new Error('展示頁沒有開起來');
  return page;
};
const ptr = (): Pointer => {
  if (!pointer) throw new Error('滑鼠沒有接上');
  return pointer;
};

beforeAll(async () => {
  page = await openApp(join(HUD_DIR, 'gallery'), { initScript: INIT_SCRIPT });
  pointer = await Pointer.attach(page.url);
});
afterAll(async () => {
  pointer?.close();
  await page?.close();
});

/** 一條測試的開頭:整頁重新載入、打開「無框」開關(標題列與八個把手才會畫出來)、清掉記錄 */
async function prepare(): Promise<void> {
  await pg().reset();
  const ok = await pg().evaluate<boolean>(`(() => {
    const box = document.querySelector('.switches input[type="checkbox"]');
    if (!box) return false;
    if (!box.checked) box.click();
    return true;
  })()`);
  expect(ok, '前提:展示頁有「無框」開關').toBe(true);
  for (let i = 0; i < 60; i += 1) {
    const ready = await pg().evaluate<boolean>(`document.querySelectorAll('[data-hud="resize-handle"]').length === 8 && Boolean(document.querySelector('[data-hud="titlebar"]'))`);
    if (ready) break;
    await sleep(50);
  }
  const state = await pg().evaluate<{ handles: number; titlebar: boolean; tauri: boolean; buttons: number }>(`({
    handles: document.querySelectorAll('[data-hud="resize-handle"]').length,
    titlebar: Boolean(document.querySelector('[data-hud="titlebar"]')),
    tauri: globalThis.isTauri === true,
    buttons: document.querySelectorAll('[data-hud="minimize"], [data-hud="close"]').length,
  })`);
  expect(state, '前提:八個把手、標題列、假的 Tauri 都在,縮小與關閉鈕畫出來了(controls.available)').toEqual({ handles: 8, titlebar: true, tauri: true, buttons: 2 });
  await pg().evaluate('(window.__t56.calls.length = 0, true)');
}

const calls = (): Promise<Call[]> => pg().evaluate<Call[]>('window.__t56.calls.slice()');
const dragCalls = async (): Promise<Call[]> => (await calls()).filter((c) => c.cmd === START_DRAG || c.cmd === START_RESIZE);

/** 等記錄到 n 筆開始(最多 2 秒);n = 0 時等一小段,確認真的沒有叫(動態載入視窗模組要一點時間) */
async function settle(expected: number): Promise<Call[]> {
  const until = Date.now() + (expected === 0 ? 500 : 2000);
  let got = await dragCalls();
  while (Date.now() < until && (expected === 0 || got.length < expected)) {
    await sleep(40);
    got = await dragCalls();
  }
  if (expected > 0) await sleep(250); // 多等一下,抓「多叫了一次」
  return dragCalls();
}

/** 這個位置的中心點(頁面座標 = 視窗座標),並確認那一點上面的元素真的是它(或它裡面的字) */
async function centre(t: Target): Promise<{ x: number; y: number }> {
  const r = await pg().evaluate<{ x: number; y: number; hit: boolean } | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(selectorOf(t))});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: Boolean(top && (top === el || el.contains(top))) };
  })()`);
  if (!r) throw new Error(`找不到 ${nameOf(t)}(${selectorOf(t)})`);
  expect(r.hit, `前提:${nameOf(t)} 的中心點上面是它自己`).toBe(true);
  return { x: r.x, y: r.y };
}

/** 在頁面裡對這個位置送合成事件 */
async function dispatch(t: Target, events: ('pointerdown' | 'mousedown')[], button = 0): Promise<void> {
  await pg().evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selectorOf(t))});
    for (const type of ${JSON.stringify(events)}) {
      const init = { bubbles: true, cancelable: true, composed: true, button: ${button}, buttons: ${button === 0 ? 1 : 1 << button}, clientX: el.getBoundingClientRect().left + 3, clientY: el.getBoundingClientRect().top + 3 };
      el.dispatchEvent(type === 'pointerdown' ? new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(type, init));
    }
    return true;
  })()`);
}

const expectedCall = (t: Target): { cmd: string; value?: string } => (t.kind === 'edge' ? { cmd: START_RESIZE, value: t.edge } : { cmd: START_DRAG });
function describeCalls(got: Call[]): string {
  return JSON.stringify(got.map((c) => [c.cmd.replace('plugin:window|', ''), c.args?.['value'] ?? null]));
}
function expectStarted(got: Call[], t: Target, times: number, why: string): void {
  const want = expectedCall(t);
  expect(got.length, `${why}:${nameOf(t)} 要開始 ${times} 次(實際 ${got.length}:${describeCalls(got)})`).toBe(times);
  for (const c of got) {
    expect(c.cmd, `${why}:${nameOf(t)} 叫的命令`).toBe(want.cmd);
    expect(c.args?.['label'], `${why}:${nameOf(t)} 帶視窗標籤`).toBe('main');
    if (want.value !== undefined) expect(c.args?.['value'], `${why}:${nameOf(t)} 縮放方向`).toBe(want.value);
  }
}

describe('T56 a. 左鍵按下放開:開始一次,縮放帶對的方向', () => {
  for (const t of TARGETS) {
    it(`a. 真的左鍵按在${nameOf(t)} → ${t.kind === 'edge' ? `start_resize_dragging(${t.edge})` : 'start_dragging'} 一次`, async () => {
      await prepare();
      const { x, y } = await centre(t);
      await ptr().click(x, y, 'left');
      expectStarted(await settle(1), t, 1, '左鍵');
    });
  }
});

describe('T56 b. 右鍵、中鍵不開始', () => {
  for (const button of ['right', 'middle'] as const) {
    it(`b. 真的${button === 'right' ? '右' : '中'}鍵按在九個位置 → 一次都不叫`, async () => {
      await prepare();
      for (const t of TARGETS) {
        const { x, y } = await centre(t);
        await ptr().click(x, y, button);
      }
      const got = await settle(0);
      expect(got, `${button} 鍵不該開始拖拉(實際叫了 ${got.length} 次:${describeCalls(got)})`).toEqual([]);
    });
  }

  it('b. 合成的 mousedown(button 1 中鍵、button 2 右鍵)在九個位置 → 一次都不叫', async () => {
    await prepare();
    for (const t of TARGETS) {
      await dispatch(t, ['mousedown'], 1);
      await dispatch(t, ['mousedown'], 2);
    }
    const got = await settle(0);
    expect(got, `非左鍵的 mousedown 不該開始拖拉(實際叫了 ${got.length} 次:${describeCalls(got)})`).toEqual([]);
  });
});

describe('T56 c. 標題列上的縮小、關閉鈕不開始移動', () => {
  for (const [name, selector, cmd] of [['縮小', '[data-hud="minimize"]', 'plugin:window|minimize'], ['關閉', '[data-hud="close"]', 'plugin:window|close']] as const) {
    it(`c. 真的左鍵按${name}鈕 → 不叫 start_dragging;按鈕自己的動作(${cmd.replace('plugin:window|', '')})剛好一次`, async () => {
      await prepare();
      const p = await pg().evaluate<{ x: number; y: number; hit: boolean }>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const b = el.getBoundingClientRect();
        const x = b.left + b.width / 2, y = b.top + b.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, hit: Boolean(top && (top === el || el.contains(top))) };
      })()`);
      expect(p.hit, `前提:${name}鈕的中心點上面是它自己`).toBe(true);
      await ptr().click(p.x, p.y, 'left');
      await sleep(600);
      const all = await calls();
      expect(all.filter((c) => c.cmd === START_DRAG || c.cmd === START_RESIZE), `按${name}鈕不該開始拖拉(實際:${describeCalls(all)})`).toEqual([]);
      expect(all.filter((c) => c.cmd === cmd).length, `${name}鈕自己的動作要剛好一次(全部記錄:${JSON.stringify(all.map((c) => c.cmd))})`).toBe(1);
    });
  }

  it('c. 合成的 mousedown 落在縮小、關閉鈕上(冒泡到標題列)→ 不叫 start_dragging', async () => {
    await prepare();
    await pg().evaluate(`(() => {
      for (const sel of ['[data-hud="minimize"]', '[data-hud="close"]']) {
        const el = document.querySelector(sel);
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1 }));
      }
      return true;
    })()`);
    const got = await settle(0);
    expect(got, `按鈕上的 mousedown 不該開始移動(實際:${describeCalls(got)})`).toEqual([]);
  });
});

describe('T56 d. 連續兩次拖拉的第二次(桌面接手之後只有 mousedown、沒有 pointerdown)', () => {
  for (const t of TARGETS) {
    it(`d. ${nameOf(t)}:第一次真的左鍵;第二次只發 mousedown → 也開始(共 2 次)`, async () => {
      await prepare();
      const { x, y } = await centre(t);
      await ptr().click(x, y, 'left');
      expectStarted(await settle(1), t, 1, '第一次(真的左鍵)');
      await dispatch(t, ['mousedown']);
      expectStarted(await settle(2), t, 2, '第二次(只有 mousedown)');
    });

    it(`d. ${nameOf(t)}:只發 pointerdown、不發 mousedown → 不開始(開始的是 mousedown)`, async () => {
      await prepare();
      await dispatch(t, ['pointerdown']);
      const got = await settle(0);
      expect(got, `只有 pointerdown 不該開始(實際叫了 ${got.length} 次:${describeCalls(got)})`).toEqual([]);
    });
  }
});

describe('T56 e. 一次左鍵按下,剛好開始一次', () => {
  for (const t of TARGETS) {
    it(`e. ${nameOf(t)}:一次真的左鍵按放(Chrome 先送 pointerdown 再送 mousedown)→ 剛好一次`, async () => {
      await prepare();
      const { x, y } = await centre(t);
      await ptr().click(x, y, 'left');
      expectStarted(await settle(1), t, 1, '真的左鍵');
    });

    it(`e. ${nameOf(t)}:合成事件照正常順序 pointerdown 接著 mousedown → 剛好一次`, async () => {
      await prepare();
      await dispatch(t, ['pointerdown', 'mousedown']);
      expectStarted(await settle(1), t, 1, '合成的 pointerdown + mousedown');
    });
  }
});

// T56 補測 f(顧問裁 A,2026-10-25):不加 preventDefault。T54 量過它沒用,而且擋掉 mousedown 的預設動作還會改到焦點。
// 送可取消(cancelable)的左鍵 mousedown,把手與標題列都要:事件最後 defaultPrevented 必須是假。
// 基底(onpointerdown)上本來就綠(沒人呼叫 preventDefault),是護欄;實作加了 preventDefault 就紅。
describe('T56 f. 不加 preventDefault(左鍵 mousedown 的預設動作留著)', () => {
  for (const t of TARGETS) {
    it(`f. ${nameOf(t)}:可取消的左鍵 mousedown(合成)→ defaultPrevented 為假(dispatchEvent 回 true)`, async () => {
      await prepare();
      const got = await pg().evaluate<{ notCanceled: boolean; defaultPrevented: boolean; cancelable: boolean }>(`(() => {
        const el = document.querySelector(${JSON.stringify(selectorOf(t))});
        const b = el.getBoundingClientRect();
        const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, clientX: b.left + 3, clientY: b.top + 3 });
        const notCanceled = el.dispatchEvent(ev);
        return { notCanceled, defaultPrevented: ev.defaultPrevented, cancelable: ev.cancelable };
      })()`);
      expect(got.cancelable, '前提:事件是可取消的').toBe(true);
      expect(got.defaultPrevented, `${nameOf(t)} 的 mousedown 被 preventDefault 了`).toBe(false);
      expect(got.notCanceled).toBe(true);
    });
  }

  it('f. 真的左鍵按在九個位置:冒泡到 document 時 mousedown 的 defaultPrevented 都是假', async () => {
    await prepare();
    await pg().evaluate(`(() => { window.__t56f = []; document.addEventListener('mousedown', (e) => window.__t56f.push({ prevented: e.defaultPrevented, button: e.button, target: e.target.closest('[data-hud]')?.getAttribute('data-hud') ?? '' }), false); return true; })()`);
    for (const t of TARGETS) {
      const { x, y } = await centre(t);
      await ptr().click(x, y, 'left');
    }
    await sleep(300);
    const seen = await pg().evaluate<{ prevented: boolean; button: number; target: string }[]>('window.__t56f.slice()');
    expect(seen.length, `前提:九次真的按下都收到 mousedown(實際 ${seen.length})`).toBe(TARGETS.length);
    expect(seen.filter((s) => s.prevented), `這些 mousedown 被 preventDefault 了:${JSON.stringify(seen)}`).toEqual([]);
  });
});
