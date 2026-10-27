/**
 * T65 紅測試(靜態守門):`packages/core/src/grading/` 的非測試檔,從 ingest/ 只准 import `card-file.js`。
 * 工單:docs/tickets/T65-grading-phase3-short-and-queue.md「紅測試」的 import 守門。測試 agent 寫;開發 worker 不改。
 *
 * 為什麼:05 → 02 的例外(scripts/boundaries.allow.json,ADR-084)只開給 card-file.ts 的 renderCardFile
 * (ADR-082 唯一寫卡函式,純函式、只 import yaml)。boundaries 檢查只看「資料夾對資料夾」,
 * 一旦例外開了,prompts.js、errors.js 這些 ingest 內部檔它也不會擋——這支測試補那個洞。
 * prompt 範本 reteach-short.md 要用自己的路徑讀(`join(import.meta.dirname, '../../prompts/grading/…')`),不借 ingest/prompts.ts。
 *
 * 用語法樹抓 import 宣告、`export … from`、動態 import('…')、`import x = require('…')`、`import type`;
 * 只要路徑裡有 `ingest` 這一段(`../ingest/x.js`、`@core/ingest/x.js`、`../ingest`、`../ingest/index.js`),
 * 檔名就一定要是 `card-file.js`(或 `.ts`)。型別 import 也不放行。
 * 今天(base)grading/ 沒有任何 ingest import,所以真檔那一條本來就綠;壞樣本那幾條證明它抓得到。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const GRADING = 'packages/core/src/grading';
const isTestFile = (rel: string): boolean => /\.test\.(?:ts|tsx|mts)$/.test(rel) || /test-support\.ts$/.test(rel);

/** 回傳這段程式碼 import 了哪些「ingest 底下但不是 card-file」的路徑 */
export function badIngestImports(text: string, rel = 'x.ts'): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specs: string[] = [];
  const add = (e: ts.Expression | undefined): void => {
    if (e !== undefined && ts.isStringLiteralLike(e)) specs.push(e.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0]);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal as ts.Expression);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs.filter((s) => {
    const parts = s.split('/');
    const at = parts.indexOf('ingest');
    if (at === -1) return false;
    const rest = parts.slice(at + 1);
    return !(rest.length === 1 && /^card-file(?:\.js|\.ts)?$/.test(rest[0]!));
  });
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(?:ts|tsx|mts)$/.test(name)) out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(join(ROOT, GRADING));
  return out.filter((f) => !isTestFile(f));
}

describe('T65 靜態守門:grading/ 對 ingest/ 只准 import card-file.js', () => {
  it('掃到的檔數合理(grade-apply.ts、grade-fill.ts、index.ts 都在)', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of ['grade-apply.ts', 'grade-fill.ts', 'index.ts']) expect(files).toContain(`${GRADING}/${f}`);
  });

  it('grading/ 的非測試檔:除了 card-file.js,沒有 import 任何 ingest/ 底下的東西', () => {
    const bad: string[] = [];
    for (const rel of sourceFiles()) {
      const hits = badIngestImports(readFileSync(join(ROOT, rel), 'utf8'), rel);
      if (hits.length > 0) bad.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(bad, '05-grading 只准從 ingest/ 拿 card-file.js 的 renderCardFile(ADR-084);prompt 範本用自己的路徑讀:\n' + bad.join('\n')).toEqual([]);
  });

  it('壞樣本:prompts.js、errors.js、types.js、index.js、整個資料夾、別名路徑、export from、動態 import、型別 import、require → 都抓得到', () => {
    const bad: Record<string, string> = {
      prompts: "import { loadPrompt } from '../ingest/prompts.js';",
      errors: "import { ModelResponseFormatError } from '../ingest/errors.js';",
      types: "import type { Card } from '../ingest/types.js';",
      index: "import { x } from '../ingest/index.js';",
      資料夾: "import { x } from '../ingest';",
      別名: "import { x } from '@core/ingest/prompts.js';",
      別名加斜線: "import { x } from '@core/ingest/';",
      exportFrom: "export { x } from '../ingest/errors.js';",
      exportStar: "export * from '../ingest/prompts.js';",
      動態: "const m = await import('../ingest/prompts.js');",
      副作用: "import '../ingest/prompts.js';",
      require: "const m = require('../ingest/errors.js');",
      型別節點: "type T = import('../ingest/types.js').Card;",
      card檔名只是前綴: "import { x } from '../ingest/card-file-extra.js';",
      card檔在更深一層: "import { x } from '../ingest/sub/card-file.js';",
    };
    for (const [name, src] of Object.entries(bad)) expect(badIngestImports(src), name).not.toEqual([]);
  });

  it('好樣本:card-file.js(相對、別名、有無副檔名)、別的資料夾、名字裡只是有 ingest 字樣的字串 → 放行', () => {
    const good = [
      "import { renderCardFile } from '../ingest/card-file.js';",
      "import { renderCardFile } from '@core/ingest/card-file.js';",
      "import { renderCardFile } from '../ingest/card-file';",
      "import { renderCardFile } from '../ingest/card-file.ts';",
      "import { parseCardText } from '../schema/parse-card.js';",
      "import { ProvisionalQueue } from '../llm/provisional-queue.js';",
      "const s = '../ingest/prompts.js'; void s;",
      "// import { x } from '../ingest/prompts.js';",
      "import { x } from '../reingest/thing.js';",
    ];
    for (const src of good) expect(badIngestImports(src), src).toEqual([]);
  });

  it('grading/ 目錄存在(守門沒有掃空氣)', () => {
    expect(existsSync(join(ROOT, GRADING))).toBe(true);
  });
});
