/**
 * T58 紅測試(c)(d):寫卡片的守門。工單:docs/tickets/T58-card-writer-fence-length.md 第 4 節。測試 agent 寫;開發 worker 不改。
 *
 *   (c) card-file.ts 的 import 守門(語法樹):值 import 只能是 'yaml';其他 import 只能是型別 import;
 *       沒有 require、沒有動態 import()、沒有 import x = require()、沒有 export … from(值)。
 *       今天這個檔不存在,所以紅。
 *   (d) 字面守門:packages/ 與 apps/ 底下的非測試檔(不掃 scripts/),語法樹裡的字串字面值與樣板字串片段
 *       (含 + 拼起來的字面值),不准有「三個以上反引號接 example」。今天紅 3 個(ingest.ts、children.ts、deps.ts)。
 *       好樣本:註解、用 repeat 產生反引號串再接 example。
 * 每個守門都有「合成的壞樣本 / 好樣本」測試:證明守門真的抓得到、也沒有亂抓。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const CARD_FILE = 'packages/core/src/ingest/card-file.ts';

// ------------------------------------------------------------------ (c) import 守門

function sourceOf(text: string): ts.SourceFile {
  return ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** import 守門:回傳違規的描述(空陣列 = 乾淨)。 */
export function importProblems(text: string): string[] {
  const sf = sourceOf(text);
  const problems: string[] = [];
  const typeOnly = (c: ts.ImportClause | undefined): boolean => {
    if (!c) return false;
    if (c.isTypeOnly) return true;
    if (c.name) return false;
    const nb = c.namedBindings;
    return !!nb && ts.isNamedImports(nb) && nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const mod = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '?';
      if (!typeOnly(node.importClause) && mod !== 'yaml') problems.push(`值 import '${mod}'(只准 yaml 與型別 import)`);
    } else if (ts.isImportEqualsDeclaration(node)) {
      problems.push('import x = require(…) / import x = y');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      problems.push(`export … from '${ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '?'}'`);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push('動態 import()');
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') problems.push('require()');
    } else if (ts.isImportTypeNode(node)) {
      // import('x').T 是型別,允許
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

describe('T58(c) card-file.ts 的 import 守門', () => {
  it('card-file.ts 存在,而且值 import 只有 yaml、其他 import 都是型別 import、沒有 require 與動態 import', () => {
    expect(existsSync(join(ROOT, CARD_FILE)), `${CARD_FILE} 要存在(ADR-082:只留一個寫卡片的函式)`).toBe(true);
    expect(importProblems(readFileSync(join(ROOT, CARD_FILE), 'utf8'))).toEqual([]);
  });

  it('壞樣本:node:fs 的值 import、把 Card 改成值 import、require、動態 import、import = require、side-effect import、export from → 都抓得到', () => {
    const bad: Record<string, string> = {
      fs: "import { writeFileSync } from 'node:fs';\nexport const a = 1;",
      'fs 預設': "import fs from 'node:fs';",
      'Card 值 import': "import { Card } from '@contracts/index.js';",
      'Card 預設': "import Card from '@contracts/index.js';",
      require: "const fs = require('node:fs');",
      '動態 import': "export async function f() { return import('./children.js'); }",
      'import = require': "import fs = require('node:fs');",
      'side-effect': "import './children.js';",
      'export from': "export { renderCardFile } from './children.js';",
      '同資料夾的值 import': "import { x } from './children.js';",
    };
    for (const [name, src] of Object.entries(bad)) expect(importProblems(src), name).not.toEqual([]);
  });

  it('好樣本:yaml 的值 import、import type、import { type X }、註解裡寫 require 與 import → 抓不到', () => {
    const good = [
      "import { stringify as yamlStringify } from 'yaml';\nexport const a = 1;",
      "import type { Card } from '@contracts/index.js';",
      "import { type Card } from '@contracts/index.js';",
      "import { stringify } from 'yaml';\nimport type { Card } from '@contracts/index.js';\n// 不要 require('node:fs')、也不要 import('x')\n/* import fs from 'node:fs' */\nexport const s = \"require('x')\";",
      "export type { Card } from '@contracts/index.js';",
    ];
    for (const src of good) expect(importProblems(src), src).toEqual([]);
  });
});

// ------------------------------------------------------------------ (d) 字面守門

const SCAN_DIRS = ['packages', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '.svelte-kit', '.git', 'coverage']);
const SCRIPT_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
/** 照 word-count-vectors.test.ts 的 isTestFile */
const isTestFile = (rel: string): boolean =>
  /\.test\.(?:ts|tsx|mts|js|mjs)$/.test(rel) || /test-support\.ts$/.test(rel) || /(?:^|\/)tests?\//.test(rel) || /(?:^|\/)tests\.rs$/.test(rel);

function walk(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else if (SCRIPT_EXT.test(name)) out.push(relative(root, full).split('\\').join('/'));
  }
}

const FENCE_LITERAL = /`{3,}example/;

/** 字面值折疊:字串字面值、無替換樣板、字串 + 字串、括號;樣板的替換處放一個 U+0000(不讓前後接起來)。折不出來回 undefined。 */
function fold(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return fold(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = fold(node.left);
    const r = fold(node.right);
    return l !== undefined && r !== undefined ? l + r : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) s += '\u0000' + span.literal.text;
    return s;
  }
  return undefined;
}

/** 字面守門:回傳含「三個以上反引號接 example」的字面值所在行(空陣列 = 乾淨)。 */
export function literalHits(text: string, rel = 'x.ts'): number[] {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    let s: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node) || ts.isParenthesizedExpression(node)) s = fold(node);
    if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isTemplateHead(node)) s = node.text;
    if (s !== undefined && FENCE_LITERAL.test(s)) lines.add(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...lines].sort((a, b) => a - b);
}

describe('T58(d) 字面守門:packages/ 與 apps/ 的非測試檔,不准自己拼「三個以上反引號接 example」', () => {
  it('掃到的檔數合理(掃描器沒壞成什麼都掃不到)', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(ROOT, d), ROOT, files);
    const source = files.filter((f) => !isTestFile(f));
    expect(source.length, `非測試原始碼檔數 ${source.length}`).toBeGreaterThan(100);
    expect(source).toContain('packages/core/src/ingest/ingest.ts');
    expect(source.some((f) => f.startsWith('scripts/')), '不掃 scripts/').toBe(false);
  });

  it('真的 repo:一個字串字面值或樣板字串含「三個以上反引號接 example」都沒有', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(ROOT, d), ROOT, files);
    const bad: string[] = [];
    for (const rel of files) {
      if (isTestFile(rel)) continue;
      const lines = literalHits(readFileSync(join(ROOT, rel), 'utf8'), rel);
      if (lines.length > 0) bad.push(`${rel}:${lines.join(',')}`);
    }
    expect(bad, '這些檔留著自己的圍欄寫法(圍欄長度要走 packages/core/src/ingest/card-file.ts):\n' + bad.join('\n')).toEqual([]);
  });

  it('壞樣本:字串、樣板字串、有替換的樣板、+ 拼接、括號、四個與五個反引號 → 抓得到', () => {
    const B = '`';
    const T = B.repeat(3);
    const ESC = '\\`'.repeat(3); // 樣板字串裡跳脫過的三個反引號
    const bad: Record<string, string> = {
      單引號: "const a = '" + T + "example\\n';",
      雙引號: 'const a = "' + T + 'example";',
      樣板: 'const a = ' + B + ESC + 'example\\n' + B + ';',
      有替換的樣板: 'const a = ' + B + ESC + 'example\\n${x}\\n' + ESC + B + ';',
      替換之後的片段: 'const a = ' + B + '${x}\\n' + ESC + 'example' + B + ';',
      拼接: "const a = '" + B.repeat(2) + "' + '" + B + "example';",
      拼接加括號: "const a = ('" + T + "' + ('example'));",
      四個: "const a = '" + B.repeat(4) + "example';",
      五個: "const a = '" + B.repeat(5) + "example\\n';",
    };
    for (const [name, src] of Object.entries(bad)) expect(literalHits(src), name).not.toEqual([]);
  });

  it('好樣本:註解、用 repeat 產生反引號串再接 example、單獨的 example、一兩個反引號、反引號與 example 之間有別的字 → 抓不到', () => {
    const good = [
      `// ${'`'.repeat(3)}example 是圍欄\nconst a = 1;`,
      `/* ${'`'.repeat(3)}example */\nconst a = 1;`,
      "const fence = '`'.repeat(n);\nconst open = fence + 'example\\n';",
      "const open = `${'`'.repeat(n)}example\\n`;",
      "const a = 'example';",
      `const a = '${'`'.repeat(2)}example';`,
      `const a = '${'`'.repeat(3)} example';`,
      `const a = '${'`'.repeat(3)}js';`,
    ];
    for (const src of good) expect(literalHits(src), src).toEqual([]);
  });
});
