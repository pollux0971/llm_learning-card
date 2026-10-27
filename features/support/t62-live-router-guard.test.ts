/**
 * T62 紅測試(靜態守門):會真呼叫模型的 router 只能從 createLiveGatewayRouter 來(帳本經驗證、有當日上限)。
 * 工單:docs/tickets/T62-ingest-cli-verified-ledger.md「紅測試」的靜態守門。測試 agent 寫;開發 worker 不改。
 *
 * 用語法樹找 `new LlmRouterImpl(` 與 `new CloudLlmRouter(`(含 `new ns.LlmRouterImpl(`),掃 scripts/、packages/、apps/ 的非測試檔。只准出現在:
 *   - packages/core/src/llm/router-gateway.ts、packages/core/src/llm/router-impl.ts(組合:閘道包 router-impl,router-impl 包 cloud router);
 *   (golden-run.ts 原本有 G1 例外,T63 讓 live golden 改走 createLiveGatewayRouter 後已拿掉。)
 * 另外 scripts/ingest.ts 不准再 import LlmRouterImpl。今天紅在 scripts/ingest.ts 的兩處(--file 與掃描)。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const SCAN_DIRS = ['scripts', 'packages', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '.svelte-kit', '.git', 'coverage']);
const SCRIPT_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
/** 照 word-count-vectors.test.ts 的 isTestFile */
const isTestFile = (rel: string): boolean =>
  /\.test\.(?:ts|tsx|mts|js|mjs)$/.test(rel) || /test-support\.ts$/.test(rel) || /(?:^|\/)tests?\//.test(rel) || /(?:^|\/)tests\.rs$/.test(rel);

/** 允許的地方。每條附理由。 */
const ALLOWED: Record<string, string> = {
  'packages/core/src/llm/router-gateway.ts': '組合:GatewayLlmRouter 把 LlmRouterImpl 當底層依賴(createLiveGatewayRouter 從這裡出來)',
  'packages/core/src/llm/router-impl.ts': '組合:LlmRouterImpl 把 CloudLlmRouter 當底層',
};

const BANNED = new Set(['LlmRouterImpl', 'CloudLlmRouter']);

/** 回傳 `new <被禁的類別>(` 所在的行(空陣列 = 乾淨) */
export function bannedNews(text: string, rel = 'x.ts'): number[] {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const lines: number[] = [];
  const nameOf = (e: ts.Expression): string | undefined => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    if (ts.isParenthesizedExpression(e)) return nameOf(e.expression);
    if (ts.isAsExpression(e) || ts.isNonNullExpression(e)) return nameOf(e.expression);
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const name = nameOf(node.expression);
      if (name !== undefined && BANNED.has(name)) lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

/** 回傳從 LlmRouterImpl 來的 import(任何來源) */
export function importsOf(text: string, names: string[]): string[] {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    for (const el of st.importClause.namedBindings.elements) if (names.includes((el.propertyName ?? el.name).text)) hits.push((el.propertyName ?? el.name).text);
  }
  return hits;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCRIPT_EXT.test(name)) out.push(relative(ROOT, full).split('\\').join('/'));
  }
}

function sourceFiles(): string[] {
  const all: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), all);
  return all.filter((f) => !isTestFile(f));
}

describe('T62 靜態守門:真呼叫的 router 只從 createLiveGatewayRouter 來', () => {
  it('掃到的檔數合理,而且有掃到 scripts/ingest.ts 與 router-gateway.ts', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain('scripts/ingest.ts');
    expect(files).toContain('packages/core/src/llm/router-gateway.ts');
  });

  it('scripts/、packages/、apps/ 的非測試檔:除了登記的地方,沒有 new LlmRouterImpl( 或 new CloudLlmRouter(', () => {
    const bad: string[] = [];
    for (const rel of sourceFiles()) {
      if (rel in ALLOWED) continue;
      const lines = bannedNews(readFileSync(join(ROOT, rel), 'utf8'), rel);
      if (lines.length > 0) bad.push(`${rel}:${lines.join(',')}`);
    }
    expect(bad, '真呼叫要走 createLiveGatewayRouter({ ledger: <驗證過的帳本> })(契約 §12):\n' + bad.join('\n')).toEqual([]);
  });

  it('允許表每一條附理由、檔真的存在、而且真的還有命中(沒有過期的例外)', () => {
    for (const [rel, why] of Object.entries(ALLOWED)) {
      expect(why.length, `${rel} 要附理由`).toBeGreaterThan(10);
      expect(existsSync(join(ROOT, rel)), `${rel} 不存在,例外過期了`).toBe(true);
      expect(bannedNews(readFileSync(join(ROOT, rel), 'utf8'), rel).length, `${rel} 已經沒有 new LlmRouterImpl/CloudLlmRouter,不需要例外`).toBeGreaterThan(0);
    }
  });

  it('scripts/ingest.ts 不再 import LlmRouterImpl(也不 import CloudLlmRouter)', () => {
    expect(importsOf(readFileSync(join(ROOT, 'scripts/ingest.ts'), 'utf8'), ['LlmRouterImpl', 'CloudLlmRouter'])).toEqual([]);
  });

  it('壞樣本:直接 new、別名(命名空間)、括號、as 轉型、函式裡面、CloudLlmRouter → 都抓得到', () => {
    const bad: Record<string, string> = {
      直接: 'const r = new LlmRouterImpl({});',
      cloud: 'const r = new CloudLlmRouter({});',
      命名空間: "import * as llm from './x'; const r = new llm.LlmRouterImpl({});",
      括號: 'const r = new (LlmRouterImpl)({});',
      as轉型: 'const r = new (LlmRouterImpl as any)({});',
      函式裡: 'function f() { return () => new LlmRouterImpl({ settings }); }',
      多行: 'const a = 1;\nconst r = new LlmRouterImpl(\n  { logPath },\n);',
    };
    for (const [name, src] of Object.entries(bad)) expect(bannedNews(src), name).not.toEqual([]);
  });

  it('好樣本:型別標註、註解、字串、createLiveGatewayRouter、extends、只是名字 → 抓不到', () => {
    const good = [
      'let r: LlmRouterImpl | undefined;',
      '// new LlmRouterImpl({}) 不要這樣',
      "const s = 'new LlmRouterImpl({})';",
      'const r = createLiveGatewayRouter({ ledger });',
      'const r = new GatewayLlmRouter({ ledger });',
      'const T = LlmRouterImpl; void T;',
      "import type { LlmRouterImpl } from './router-impl.js';",
    ];
    for (const src of good) expect(bannedNews(src), src).toEqual([]);
  });

  it('importsOf:抓得到具名 import、別名 import', () => {
    expect(importsOf("import { LlmRouterImpl } from 'a';", ['LlmRouterImpl'])).toEqual(['LlmRouterImpl']);
    expect(importsOf("import { LlmRouterImpl as X, createLiveGatewayRouter } from 'a';", ['LlmRouterImpl'])).toEqual(['LlmRouterImpl']);
    expect(importsOf("import { createLiveGatewayRouter } from 'a';", ['LlmRouterImpl'])).toEqual([]);
  });
});
