/**
 * T47 靜態測試 e(教學卡視窗最小寬高、不開 Tauri 的縮放快捷鍵、程式不改 webview 縮放;07-teach-card phase-4 場景 6、8)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T47-teach-card-zoom-layout.md 「驗收條件 1」的靜態測試 e、第 3 節(D4=A)、第 1 節最後一條(顧問 2026-10-24)。
 *
 * 只讀 `apps/desktop/src-tauri/tauri.conf.json`(JSON.parse)與原始碼檔案的文字;不起任何東西。
 *   - 教學卡視窗(label `teach`):`minWidth` 是 360、`minHeight` 是 400(數字);原本的欄位(label、url、寬 360、高 480、resizable、decorations、visible、create)不動。
 *   - 考試卡視窗(label `test`):沒有 `minWidth`、`minHeight`(06 的事,這張不動它);原本的欄位不動。
 *   - 兩個視窗與 app 層都沒有開 `zoomHotkeysEnabled`(沒有這個鍵,或值是 false)。
 *   - `apps/teach-card/src/`(非測試檔)與 `apps/desktop/src/`、`apps/desktop/src-tauri/src/` 的非測試原始碼不呼叫 webview 縮放
 *     (`setZoom`、`set_zoom`、`zoomHotkeysEnabled`、`zoom_hotkeys_enabled`、`with_webview` 的縮放)。
 * 取捨:原始碼掃描只掃字面(工單第 1 條的「不准」就是字面可查的);縮放有沒有真的重排、按鈕有沒有跟著變大,是 t47-zoom-layout-render.test.ts 的事。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const CONF = join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');

interface WindowConf {
  label?: string;
  url?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  decorations?: boolean;
  visible?: boolean;
  create?: boolean;
  [key: string]: unknown;
}
interface Conf {
  app: { windows: WindowConf[]; [key: string]: unknown };
  [key: string]: unknown;
}

const conf = JSON.parse(readFileSync(CONF, 'utf8')) as Conf;
const windowOf = (label: string): WindowConf => {
  const found = conf.app.windows.find((w) => w.label === label);
  if (!found) throw new Error(`tauri.conf.json 沒有 label 為 ${label} 的視窗`);
  return found;
};

function sourceFiles(dir: string, exts: string[], skip: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, exts, skip));
    else if (exts.some((e) => name.endsWith(e)) && !skip(full)) out.push(full);
  }
  return out;
}

const isTestFile = (path: string): boolean => /\.test\.ts$/.test(path) || /test-support\.ts$/.test(path) || /[\\/]tests[\\/]/.test(path) || /[\\/]tests\.rs$/.test(path);

/** 物件(含巢狀)裡每一個叫 zoomHotkeysEnabled 的鍵的值 */
function zoomHotkeyValues(value: unknown, path = '$'): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...zoomHotkeyValues(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'zoomHotkeysEnabled') out.push({ path: `${path}.${k}`, value: v });
      out.push(...zoomHotkeyValues(v, `${path}.${k}`));
    }
  }
  return out;
}

describe('T47 e:視窗最小寬高(D4=A)', () => {
  it('教學卡視窗(label teach)有 minWidth 360 與 minHeight 400,而且是數字', () => {
    const teach = windowOf('teach');
    expect(teach.minWidth, 'teach 視窗的 minWidth 要是 360(= 預設寬度,T45 的 D5 只量 360 寬才一直成立)').toBe(360);
    expect(teach.minHeight, 'teach 視窗的 minHeight 要是 400').toBe(400);
  });

  it('教學卡視窗原本的欄位不動(寬 360、高 480、可縮放、無框、一開始不顯示、不自動建)', () => {
    const teach = windowOf('teach');
    expect(teach.url).toBe('teach/index.html');
    expect(teach.width).toBe(360);
    expect(teach.height).toBe(480);
    expect(teach.resizable).toBe(true);
    expect(teach.decorations).toBe(false);
    expect(teach.visible).toBe(false);
    expect(teach.create).toBe(false);
  });

  it('考試卡視窗(label test)沒有 minWidth、minHeight(06 的事),原本的欄位也不動', () => {
    const test = windowOf('test');
    expect('minWidth' in test, '考試卡視窗不能有 minWidth').toBe(false);
    expect('minHeight' in test, '考試卡視窗不能有 minHeight').toBe(false);
    expect(test.url).toBe('test/index.html');
    expect(test.width).toBe(360);
    expect(test.height).toBe(480);
    expect(test.resizable).toBe(true);
    expect(test.decorations).toBe(false);
    expect(test.visible).toBe(false);
    expect(test.create).toBe(false);
  });

  it('視窗還是兩個(teach、test),沒有多開', () => {
    expect(conf.app.windows.map((w) => w.label).sort()).toEqual(['teach', 'test']);
  });
});

describe('T47 e:不開 Tauri 的縮放快捷鍵、程式不改 webview 縮放(顧問 2026-10-24)', () => {
  it('tauri.conf.json 裡沒有任何 zoomHotkeysEnabled: true(沒有這個鍵或是 false)', () => {
    const values = zoomHotkeyValues(conf);
    expect(values.filter((v) => v.value !== false), `不能開 zoomHotkeysEnabled:${JSON.stringify(values)}`).toEqual([]);
  });

  it('教學卡的非測試原始碼(apps/teach-card/src、dev)沒有呼叫 webview 縮放', () => {
    const files = sourceFiles(join(ROOT, 'apps/teach-card'), ['.ts', '.svelte', '.js', '.mjs'], isTestFile);
    expect(files.length, '前提:有掃到檔').toBeGreaterThan(3);
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/setZoom|set_zoom|zoomHotkeysEnabled|zoom_hotkeys_enabled|webview\.zoom|\.zoom\s*\(/.test(text)) bad.push(relative(ROOT, file));
    }
    expect(bad, '這些檔含 webview 縮放的呼叫').toEqual([]);
  });

  it('桌面殼的非測試原始碼(apps/desktop/src、src-tauri/src)沒有呼叫 webview 縮放、沒有開縮放快捷鍵', () => {
    const files = [
      ...sourceFiles(join(ROOT, 'apps/desktop/src'), ['.ts', '.svelte', '.js'], isTestFile),
      ...sourceFiles(join(ROOT, 'apps/desktop/src-tauri/src'), ['.rs', '.js'], isTestFile),
    ];
    expect(files.length, '前提:有掃到檔').toBeGreaterThan(5);
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/setZoom|set_zoom|zoomHotkeysEnabled|zoom_hotkeys_enabled|zoom_hotkeys/.test(text)) bad.push(relative(ROOT, file));
    }
    expect(bad, '這些檔含 webview 縮放或縮放快捷鍵').toEqual([]);
  });
});
