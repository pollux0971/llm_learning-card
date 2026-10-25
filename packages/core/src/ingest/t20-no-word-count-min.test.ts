/**
 * T20 靜態測試:`word-count-min.ts`(Wave 0 的字數複本)不再有任何人用,檔案本身也不在了。
 * 工單:docs/tickets/T20-unify-example-fence-regex.md「2026-10-25 顧問審後更新」第 2 點。測試 agent 寫;開發 worker 不改。
 *
 * 掃 `packages/`、`scripts/`、`features/` 底下所有 .ts/.js/.mjs/.cjs/.svelte 檔(跳過 node_modules、target、dist):
 *   - 沒有任何 import / export ... from / require / 動態 import 的來源路徑含 `word-count-min`(靜態與動態都算,含測試檔與步驟定義檔);
 *   - `packages/core/src/ingest/word-count-min.ts` 與 `word-count-min.test.ts` 都不存在;
 *   - `ingest` 的 barrel(index.ts)真的載入後,沒有再匯出舊複本才有的 `countBodyWords`、`countWords`、`stripExampleFences`、`BODY_WORD_LIMIT`。
 * 取捨:只看「來源路徑」(import 的字串),不看註解裡提到檔名(註解由 worker 改寫,不是這條要抓的)。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../../..');
const SELF = join(import.meta.dirname, 't20-no-word-count-min.test.ts');
const SCAN_DIRS = ['packages', 'scripts', 'features'];
const EXTS = ['.ts', '.js', '.mjs', '.cjs', '.svelte'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/** 這一行是 import / export-from / require / 動態 import,而且來源路徑字串含 word-count-min */
const IMPORT_OF_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|importActual|importMock|doMock)\s*\(\s*)(['"`])[^'"`\n]*word-count-min[^'"`\n]*\1/;

describe('T20:word-count-min 的複本已經移除', () => {
  it('前提:掃得到檔,而且這份測試自己不算', () => {
    const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
    expect(files.length, '前提:packages/、scripts/、features/ 要掃到不少檔').toBeGreaterThan(100);
    // 示範字串不寫成連續的 import('…') / from '…' 字面(boundaries 掃描器會把它當成真的 import),拆成串接後再丟給正則
    const NAME = 'word-count' + '-min';
    const dynamic = 'const m = await import(' + `'../x/${NAME}.js'` + ');';
    expect(IMPORT_OF_RE.test(`import { x } from './${NAME}.js';`), '前提:正則抓得到 import').toBe(true);
    expect(IMPORT_OF_RE.test(`export * from './${NAME}.js';`), '前提:正則抓得到 export from').toBe(true);
    expect(IMPORT_OF_RE.test(dynamic), '前提:正則抓得到動態 import(拆開寫的字串)').toBe(true);
    expect(IMPORT_OF_RE.test('const m = await import(' + `'../x/other-module.js'` + ');'), '對照:動態 import 別的模組不抓').toBe(false);
    expect(IMPORT_OF_RE.test(`// 不用 ${NAME}.ts 的複本`), '前提:只提到檔名的註解不算').toBe(false);
  });

  it('packages/、scripts/、features/ 沒有任何 import word-count-min(含測試與步驟定義)', () => {
    const bad: string[] = [];
    for (const file of SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))) {
      if (file === SELF) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (IMPORT_OF_RE.test(line)) bad.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(bad, '這些地方還在 import word-count-min').toEqual([]);
  });

  it('word-count-min.ts 與它的舊測試檔都不存在', () => {
    expect(existsSync(join(ROOT, 'packages/core/src/ingest/word-count-min.ts')), 'word-count-min.ts 要刪掉').toBe(false);
    expect(existsSync(join(ROOT, 'packages/core/src/ingest/word-count-min.test.ts')), 'word-count-min.test.ts 要刪掉(邊界案例已搬到 example-fence-word-count.test.ts)').toBe(false);
  });

  it('ingest 的 barrel(index.ts)不再匯出舊複本才有的 countBodyWords、countWords、stripExampleFences、BODY_WORD_LIMIT', async () => {
    const barrel = (await import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'packages/core/src/ingest/index.ts')).href)) as Record<string, unknown>;
    expect(Object.keys(barrel).length, '前提:barrel 載得進來,而且有匯出東西').toBeGreaterThan(5);
    const leftovers = ['countBodyWords', 'countWords', 'stripExampleFences', 'BODY_WORD_LIMIT'].filter((name) => name in barrel);
    expect(leftovers, 'ingest 的 barrel 還在匯出舊複本的名字').toEqual([]);
  });
});
