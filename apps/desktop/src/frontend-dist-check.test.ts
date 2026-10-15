/**
 * T2c-1 驗收 F18 的靜態檢查器本身(test-support/frontend-dist.ts)。測試 agent 寫的。
 * 真的建置與檢查在 cucumber「The real front ends are loaded」;這裡用暫存資料夾的 fixture 證明檢查器抓得到錯。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkFrontendDist, referencedAssets } from './test-support/frontend-dist.js';

/** T2b 的 apps/desktop/src-tauri/frontend/teach.html,原樣。 */
const T2B_TEACH_HTML = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>教學卡</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/teach-card/src/main.ts"></script>
  </body>
</html>
`;

const dirs: string[] = [];
function dist(): string {
  const d = mkdtempSync(join(tmpdir(), 'lc-dist-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('checkFrontendDist', () => {
  it('fails on the T2b teach.html and names the .ts file', () => {
    const d = dist();
    writeFileSync(join(d, 'teach.html'), T2B_TEACH_HTML);
    const problems = checkFrontendDist(d, ['teach.html']);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('/teach-card/src/main.ts');
    expect(problems.some((p) => p.includes('TypeScript'))).toBe(true);
  });

  it('passes a built page whose script and stylesheet exist', () => {
    const d = dist();
    mkdirSync(join(d, 'teach', 'assets'), { recursive: true });
    writeFileSync(
      join(d, 'teach', 'index.html'),
      '<html><head><link rel="stylesheet" href="./assets/index-1.css"><script type="module" crossorigin src="/teach/assets/index-1.js"></script></head></html>',
    );
    writeFileSync(join(d, 'teach', 'assets', 'index-1.js'), 'console.log(1)');
    writeFileSync(join(d, 'teach', 'assets', 'index-1.css'), 'body{}');
    expect(checkFrontendDist(d, ['teach/index.html'])).toEqual([]);
  });

  it('fails when a referenced script is missing', () => {
    const d = dist();
    writeFileSync(join(d, 'a.html'), '<script src="/assets/gone.js"></script>');
    expect(checkFrontendDist(d, ['a.html']).join('\n')).toContain('gone.js');
  });

  it('fails when the window html itself is missing', () => {
    const d = dist();
    expect(checkFrontendDist(d, ['test.html']).join('\n')).toContain('test.html');
  });

  it('fails on an external URL and on a path that leaves the folder', () => {
    const d = dist();
    writeFileSync(join(d, 'outside.js'), '');
    mkdirSync(join(d, 'inner'));
    writeFileSync(join(d, 'inner', 'a.html'), '<script src="https://cdn.example/x.js"></script><link href="../../etc/passwd">');
    const problems = checkFrontendDist(join(d, 'inner'), ['a.html']).join('\n');
    expect(problems).toContain('https://cdn.example/x.js');
    expect(problems).toContain('../../etc/passwd');
  });

  it('ignores commented-out tags and reads single-quoted and unquoted attributes', () => {
    expect(referencedAssets("<!-- <script src='/x.ts'></script> --><script src='/a.js'></script><link href=/b.css>")).toEqual([
      '/a.js',
      '/b.css',
    ]);
  });
});
