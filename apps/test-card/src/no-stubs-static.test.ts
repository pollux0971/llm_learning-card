/**
 * T24 驗收 1、2、3 的靜態檢查:Wave 0 的重複移除了、TestSession 不自己判斷、畫面不用 innerHTML、接法對。
 * 紅測試作者寫;開發 worker 不改。只讀檔案文字,不 import 被量的模組。
 *
 * 範圍是 `apps/test-card/src` 底下**不是測試**的檔(`*.test.ts` 自己會提到這些字串,不算)。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..');
const SRC = join(APP, 'src');
const ROOT = join(APP, '../..');

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

const productFiles = (): string[] => walk(SRC).filter((f) => !/\.test\.ts$/.test(f));
const text = (rel: string): string => readFileSync(join(APP, rel), 'utf8');
const rel = (f: string): string => relative(ROOT, f);

describe('驗收 1:Wave 0 的重複已移除', () => {
  it('apps/test-card/src/stubs/ 整個資料夾不存在(連 .gitkeep 與測試檔都沒有)', () => {
    const left = walk(join(SRC, 'stubs')).map(rel);
    expect(left, `還留著:${left.join(', ')}`).toEqual([]);
    expect(existsSync(join(SRC, 'stubs'))).toBe(false);
  });

  it('src 底下沒有任何(非測試)檔 import stubs/、yaml、date-fns', () => {
    const bad: string[] = [];
    for (const f of productFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        if (!/^\s*(import|export)\b|\bimport\s*\(|\brequire\s*\(/.test(line)) continue;
        if (/stubs\//.test(line) || /['"]yaml['"]/.test(line) || /['"]date-fns(\/[^'"]*)?['"]/.test(line)) bad.push(`${rel(f)}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('沒有任何(非測試)檔 import StubScheduler / StubGrader / MemoryFs / loader', () => {
    const bad: string[] = [];
    for (const f of productFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const name of ['StubScheduler', 'StubGrader', 'MemoryFs', 'loadReviews', 'loadQuestions', 'loadDailyCap', 'selectDue', 'buildFsSeed']) {
        if (new RegExp(`\\b${name}\\b`).test(src)) bad.push(`${rel(f)} 提到 ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('沒有任何(非測試)檔提到 state/reviews.json 或 questions/', () => {
    const bad: string[] = [];
    for (const f of productFiles()) {
      const src = readFileSync(f, 'utf8');
      if (src.includes('reviews.json')) bad.push(`${rel(f)} 提到 reviews.json`);
      if (src.includes('questions/')) bad.push(`${rel(f)} 提到 questions/`);
    }
    expect(bad).toEqual([]);
  });

  it('types.ts 只留畫面型別:不手抄 DueItem / Review / GradeResult / QuestionFile / 排程簽章', () => {
    const src = text('src/types.ts');
    for (const name of ['DueItem', 'GradeResult', 'QuestionFile', 'SelectResult', 'SchedulerAdvanceFn', 'SchedulerOutcome', 'ReviewEntry', 'FillQuestion', 'ApplyQuestion']) {
      expect(src, `types.ts 不該有 ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(src).not.toMatch(/\b(interface|type)\s+Review\b/);
  });
});

describe('驗收 2:TestSession 不自己算、不自己批改、不讀 reviews.json、不寫檔', () => {
  const session = (): string => text('src/session.ts');

  it('依賴是 ReviewClient(桌面殼的 review-client)與 LearningFs 的 read', () => {
    const src = session();
    expect(src).toMatch(/review-client/);
    expect(src).toMatch(/ReviewClient/);
    expect(src).toMatch(/Pick<\s*LearningFs\s*,\s*'read'\s*>/);
  });

  it('不碰 node:、不寫任何檔、不 fetch', () => {
    const src = session();
    expect(src).not.toMatch(/from\s+['"]node:/);
    expect(src).not.toMatch(/\b(writeFile|writeFileSync|appendFile|mkdir|rename|unlink)\b/);
    expect(src).not.toMatch(/\.write\s*\(/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('沒有排程或批改的識別字', () => {
    const src = session();
    for (const name of ['selectSession', 'selectDue', 'advance', 'gradeFill', 'gradeApply', 'computeOverdueRatio', 'loadReviews', 'saveReviews', 'nextDue', 'next_due']) {
      expect(src, `session.ts 不該有 ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('只用 client 的 start / next / submit / summary(不叫 status,那是 T23 之後的事)', () => {
    const src = session();
    for (const m of ['start', 'next', 'submit', 'summary']) expect(src).toMatch(new RegExp(`client\\.${m}\\s*\\(`));
  });
});

describe('縮短版純文字(驗收 2、靜態)', () => {
  it('App.svelte 沒有 {@html;session.ts、App.svelte 沒有 innerHTML', () => {
    const app = text('src/App.svelte');
    expect(app).not.toContain('{@html');
    expect(app).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(text('src/session.ts')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\{@html/);
    expect(text('src/main.ts')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});

describe('驗收 3:桌面版與單獨執行的接法', () => {
  it('main.ts / App.svelte:isTauri() 分流;Tauri 內用 createReviewClient() 與 createLearningFs()', () => {
    const wired = text('src/main.ts') + text('src/App.svelte');
    expect(wired).toMatch(/\bisTauri\b/);
    expect(wired).toMatch(/\bcreateReviewClient\b/);
    expect(wired).toMatch(/\bcreateLearningFs\b/);
  });

  it('單獨執行:handler 用 fetch POST 到 /__review;fs.read 一律丟錯', () => {
    const wired = text('src/main.ts') + text('src/App.svelte');
    expect(wired).toContain('/__review');
    expect(wired).toMatch(/method:\s*['"]POST['"]/);
    expect(wired).toMatch(/\bhandler\b/);
    expect(wired).toMatch(/read\s*[:(][^]*?throw/);
  });

  it('App.svelte:測試模式一行用 --hud-fail 的字色、錯誤畫面有「重新開始」', () => {
    const app = text('src/App.svelte');
    expect(app).toContain('--hud-fail');
    expect(app).toContain('重新開始');
    expect(app).toContain('testModeNotice');
  });

  it('vite.config.ts 有 @core alias(指到 packages/core/src),沒有它 build 解析不到 protocol.js', () => {
    const cfg = text('vite.config.ts');
    expect(cfg).toMatch(/['"]@core['"]/);
    expect(cfg).toMatch(/packages\/core\/src/);
    expect(cfg).toMatch(/alias/);
  });

  it('vite.config.ts 掛了 dev/standalone 的 plugin', () => {
    expect(text('vite.config.ts')).toMatch(/dev\/standalone/);
  });

  it('scripts/boundaries.allow.json 有 06-test-card → 10-desktop-shell,理由寫 ADR-075', () => {
    const allow = JSON.parse(readFileSync(join(ROOT, 'scripts/boundaries.allow.json'), 'utf8')) as unknown;
    const entries = (Array.isArray(allow) ? allow : ((allow as { allow?: unknown[] }).allow ?? [])) as { from?: string; to?: string; reason?: string }[];
    const hit = entries.find((e) => e.from === '06-test-card' && e.to === '10-desktop-shell');
    expect(hit, '缺 06-test-card → 10-desktop-shell').toBeDefined();
    expect(hit!.reason ?? '').toContain('ADR-075');
  });

  it('package.json 的描述不再說「用 stubs 的假後端」', () => {
    const pkg = JSON.parse(text('package.json')) as { description?: string };
    expect(pkg.description ?? '').not.toMatch(/stubs|MemoryFs/);
  });
});
