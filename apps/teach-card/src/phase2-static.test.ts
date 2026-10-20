/**
 * T37:桌面版教學卡不再讀編進去的 fixture,而且視窗那一側接對了零件。測試 agent 寫;開發 worker 不改。
 *
 * 1. 真的建一次(`vite build apps/teach-card --base /teach/`,跟 `apps/desktop` 的 `build:frontends` 同一個指令,輸出到暫存目錄):
 *    建出來的檔案裡**沒有** fixture 卡的內容(標題與內文第一行)。單獨執行的 dev 頁面用側車(`dev/standalone.ts`),
 *    不靠把 fixture 編進頁面,所以正式建置裡一個字都不該有。量尺自測:建出來的檔案有「下一個」與 phase-2 的幾個字樣。
 * 2. 視窗邏輯 `teach-session.ts` 跑在 webview:它的 import 圖沒有 node: 模組、沒有 stubs/、沒有 fixture-data。
 * 3. 非測試的原始檔:不碰 reviews.json、不直接寫檔(寫入全在側車,ADR-077 D1)。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isNodeModule, scanImportGraph } from '../../desktop/src/test-support/import-scan.js';

const APP = join(import.meta.dirname, '..');
const SRC = join(APP, 'src');
const ROOT = join(APP, '../..');
const FIXTURE_CARDS = join(ROOT, 'contracts/fixtures/learning-minimal/cards/security');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** fixture 卡的標題與內文第一行(夠長、夠獨特的字串) */
function fixtureMarkers(): string[] {
  const markers: string[] = [];
  for (const name of readdirSync(FIXTURE_CARDS)) {
    const text = readFileSync(join(FIXTURE_CARDS, name), 'utf8');
    const title = /^title: (.+)$/m.exec(text)?.[1]?.trim();
    if (title) markers.push(title);
    const body = text.replace(/^---[\s\S]*?\n---\n/, '').split('\n').find((l) => l.trim().length >= 10);
    if (body) markers.push(body.trim().slice(0, 12));
  }
  return markers;
}

let outDir = '';
let built: { status: number | null; output: string } = { status: null, output: '' };
let bundle = '';

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'lc-t37-build-'));
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', APP, '--base', '/teach/', '--outDir', outDir, '--emptyOutDir'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
  });
  built = { status: r.status, output: `${r.stdout}${r.stderr}` };
  bundle = walk(outDir)
    .filter((f) => /\.(js|css|html)$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}, 120_000);
afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('桌面版的建置(vite build --base /teach/)', () => {
  it('建得起來', () => {
    expect(built.status, built.output.slice(-800)).toBe(0);
    expect(bundle.length).toBeGreaterThan(1000);
  });

  it('量尺自測:建出來的檔案有教學卡自己的字樣(下一個、換類別、先備提示、需要素材)', () => {
    for (const text of ['下一個', '換類別', '先備還沒學', '需要素材']) expect(bundle, `建出來的檔案裡找不到「${text}」`).toContain(text);
  });

  it('建出來的檔案裡沒有 fixture 卡的內容:不是讀編進去的 fixture,而是經側車讀真的 learning 目錄', () => {
    const markers = fixtureMarkers();
    expect(markers.length, '量尺:應該有 6 個標記(三張卡各兩個)').toBeGreaterThanOrEqual(6);
    const leaked = markers.filter((m) => bundle.includes(m));
    expect(leaked, `建出來的檔案裡還有 fixture 的字:${leaked.join('、')}`).toEqual([]);
  });
});

describe('視窗邏輯 teach-session.ts 是 webview 的程式碼', () => {
  const entry = join(SRC, 'teach-session.ts');

  it('檔案存在,import 圖沒有 node: 模組,沒有 stubs/ 與 fixture-data', () => {
    expect(existsSync(entry), 'apps/teach-card/src/teach-session.ts 還沒有').toBe(true);
    const graph = scanImportGraph(entry);
    expect(graph.imports.filter((i) => isNodeModule(i.spec))).toEqual([]);
    expect(graph.imports.filter((i) => i.spec.startsWith('UNRESOLVED:'))).toEqual([]);
    expect(graph.files.filter((f) => /\/stubs\/|fixture-data/.test(f))).toEqual([]);
  });

  it('用的是桌面殼的 ReviewClient 與 LearningFs(不另寫一份)', () => {
    const src = readFileSync(entry, 'utf8');
    expect(src).toMatch(/review-client/);
    expect(src).toMatch(/\bReviewClient\b/);
    expect(src).toMatch(/\bLearningFs\b/);
  });
});

describe('非測試的原始檔:寫入全在側車', () => {
  const productFiles = (): string[] => walk(SRC).filter((f) => !/\.test\.ts$/.test(f) && /\.(ts|svelte)$/.test(f));

  it('不碰 reviews.json、log.jsonl,不呼叫 LearningFs 的 write', () => {
    const bad: string[] = [];
    for (const f of productFiles()) {
      const text = readFileSync(f, 'utf8');
      if (/reviews\.json|log\.jsonl/.test(text)) bad.push(`${relative(ROOT, f)} 提到 reviews.json / log.jsonl`);
      if (/\.write\s*\(/.test(text)) bad.push(`${relative(ROOT, f)} 呼叫了 write(`);
    }
    expect(bad).toEqual([]);
  });

  it('App 用 teach-session(不自己判斷下一張、不自己算剩幾張)', () => {
    const app = readFileSync(join(SRC, 'App.svelte'), 'utf8') + (existsSync(join(SRC, 'main.ts')) ? readFileSync(join(SRC, 'main.ts'), 'utf8') : '');
    expect(app).toMatch(/teach-session/);
    expect(app).toMatch(/createReviewClient/);
  });
});
