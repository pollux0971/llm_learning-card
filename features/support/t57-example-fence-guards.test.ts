/**
 * T57 紅測試:契約 §2 的 example 圍欄以教學卡畫面的區塊解析為準(1.5.0、ADR-081)。守門與護欄那一半;向量與指紋掃描在 word-count-vectors.test.ts。
 * 工單:docs/tickets/T57-example-fence-follows-screen.md。測試 agent 寫;開發 worker 不改。
 *
 * 這個檔:
 *   1. card-markdown.ts:零 import(語法樹:import、import x = require、export … from、import()、require()、import 型別);只有兩個 export;
 *      選項凍結、剛好 { html: false, linkify: true };isExampleFence 逐字(不分大小寫、不解 HTML 實體、只用空白切)。
 *   2. 畫面的執行時護欄:createMarkdownRenderer() 跟全新 new MarkdownIt(CARD_MARKDOWN_OPTIONS) 比 block 的每一條鏈(`''` 加兩邊所有 alt 名字的聯集)、
 *      core 的鏈、options 深度相等(函式身分與順序)。再加 8 層引用的行為列(maxNesting 會讓它變 0 個)。
 *   3. 畫面的靜態守門:ui-shared/example-fence.ts 的語法樹裡不准 block / core 的成員存取、不准呼叫 set / configure、不准寫入 options
 *      (renderMarkdown 帶選項時走 installAssetImages,執行時護欄只檢查 createMarkdownRenderer,蓋不到那條路)。
 *   4. core 白名單:schema/example-fence.ts 裡 markdown-it 實例的成員存取只有 parse,token 的成員存取只有 type、info、map、content
 *      (用 TypeScript 的型別檢查器判斷接收者的型別,所以改個變數名、透過別名、解構都躲不掉)。
 *   5. 接線:core 與畫面都從 @contracts/card-markdown.js import CARD_MARKDOWN_OPTIONS 與 isExampleFence,new MarkdownIt 的引數就是 CARD_MARKDOWN_OPTIONS,
 *      不再有自己的 fenceLang、不自己寫 html / linkify 選項;兩個 app 的 vite.config.ts 有 '@contracts' 別名。
 *   6. 釘版:markdown-it 剛好 15.0.1(package.json、node_modules、package-lock,而且 lockfile 裡只有一份)。
 *   7. 舊向量測試檔對照表(docs/reviews/T57-old-vectors-map.md)核對:每條「刪」的替身都指到向量檔裡存在的列;「留」有原因。
 *
 * 載入方式:被測模組用動態 import 算出來的 file URL(紅測試在 base 上要 tsc 乾淨,而新檔在 base 上還不存在)。
 * 每個守門都有「合成的壞樣本」測試:證明守門真的抓得到,不是永遠綠。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MdI } from 'markdown-it';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

type Mod = Record<string, unknown>;
async function load(rel: string): Promise<Mod> {
  return (await import(pathToFileURL(join(ROOT, rel)).href)) as Mod;
}

const CARD_MARKDOWN = 'packages/contracts/src/card-markdown.ts';
const CORE_FENCE = 'packages/core/src/schema/example-fence.ts';
const UI_FENCE = 'packages/ui-shared/src/example-fence.ts';

const sourceOf = (text: string, name = 'x.ts'): ts.SourceFile => ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
function walkTree(sf: ts.SourceFile, visit: (n: ts.Node) => void): void {
  const go = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, go);
  };
  go(sf);
}
const lineOf = (sf: ts.SourceFile, n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

// ================================================================ 1. card-markdown.ts

/** 零 import:語法樹找 import、import x = require、export … from、import()、require()、import('x') 型別 */
export function importLikes(text: string): string[] {
  const sf = sourceOf(text);
  const out: string[] = [];
  walkTree(sf, (n) => {
    if (ts.isImportDeclaration(n)) out.push(`${lineOf(sf, n)} import`);
    else if (ts.isImportEqualsDeclaration(n)) out.push(`${lineOf(sf, n)} import =`);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) out.push(`${lineOf(sf, n)} export from`);
    else if (ts.isImportTypeNode(n)) out.push(`${lineOf(sf, n)} import type()`);
    else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      out.push(`${lineOf(sf, n)} ${n.expression.getText(sf)}()`);
    }
  });
  return out;
}

/** 語法樹裡 export 出去的名字 */
export function exportedNames(text: string): string[] {
  const sf = sourceOf(text);
  const out: string[] = [];
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    const exported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (ts.isVariableStatement(st) && exported) for (const d of st.declarationList.declarations) out.push(d.name.getText(sf));
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && exported) {
      out.push(st.name?.text ?? 'default');
    } else if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) out.push(st.getText(sf).slice(0, 40));
  }
  return out.sort();
}

describe('T57 card-markdown.ts:零 import、兩個 export、選項凍結、判斷逐字', () => {
  it('檔案存在', () => {
    expect(existsSync(join(ROOT, CARD_MARKDOWN)), `${CARD_MARKDOWN} 要存在`).toBe(true);
  });

  it('零 import:import、import x = require、export … from、動態 import()、require()、import 型別都是 0 個', () => {
    expect(importLikes(read(CARD_MARKDOWN))).toEqual([]);
  });

  it('零 import 守門抓得到壞樣本(合成)', () => {
    for (const src of [
      "import { z } from 'zod';\nexport const a = 1;",
      "import type { T } from './x.js';\nexport const a = 1;",
      "import x = require('x');\nexport const a = 1;",
      "export { y } from './y.js';",
      "export * from './y.js';",
      "export const a = await import('./z.js');",
      "export const a = require('./z.js');",
      "export type A = import('./z.js').T;",
    ]) expect(importLikes(src), src).not.toEqual([]);
    expect(importLikes("export const a = 1;\n// import x from 'y'\nexport const s = \"import('x')\";")).toEqual([]);
  });

  it('語法樹的 export 剛好 CARD_MARKDOWN_OPTIONS 與 isExampleFence;執行時的模組鍵也一樣', async () => {
    expect(exportedNames(read(CARD_MARKDOWN))).toEqual(['CARD_MARKDOWN_OPTIONS', 'isExampleFence']);
    expect(Object.keys(await load(CARD_MARKDOWN)).sort()).toEqual(['CARD_MARKDOWN_OPTIONS', 'isExampleFence']);
  });

  it('CARD_MARKDOWN_OPTIONS 是凍結的、剛好 { html: false, linkify: true },markdown-it 吃得下', async () => {
    const m = await load(CARD_MARKDOWN);
    const opts = m['CARD_MARKDOWN_OPTIONS'] as Record<string, unknown>;
    expect(Object.isFrozen(opts)).toBe(true);
    expect(opts).toEqual({ html: false, linkify: true });
    expect(Object.keys(opts).sort()).toEqual(['html', 'linkify']);
    expect(() => new MarkdownIt(opts)).not.toThrow();
    expect(new MarkdownIt(opts).options.html).toBe(false);
    expect(new MarkdownIt(opts).options.linkify).toBe(true);
  });

  it('isExampleFence(info):trim 後用 /\\s+/ 切,第一段逐字等於 example', async () => {
    const m = await load(CARD_MARKDOWN);
    const is = m['isExampleFence'] as (info: string) => boolean;
    expect(typeof is).toBe('function');
    const yes = ['example', 'example js', ' example', 'example ', '  example  js  ', 'example\tx', '\texample', 'example　x', 'example x', 'example\nx', 'example   標題'];
    const no = ['', ' ', 'Example', 'EXAMPLE', 'eXample', '&#101;xample', '&#x65;xample', '&amp;example', 'examples', 'example-x', 'xexample', 'ex ample', 'js', 'js example', 'example`', '\\example', 'exámple'];
    for (const i of yes) expect(is(i), JSON.stringify(i)).toBe(true);
    for (const i of no) expect(is(i), JSON.stringify(i)).toBe(false);
  });
});

// ================================================================ 2. 畫面的執行時護欄

interface RulerLike {
  getRules(chain: string): unknown[];
  __rules__: { alt: string[] }[];
}
type Md = MdI & { block: { ruler: RulerLike }; core: { ruler: RulerLike } };

/** 兩個實例的 block 每一條鏈(`''` 加兩邊所有 alt 名字的聯集)、core 的 `''` 鏈、options 深度相等。回傳不一樣的地方 */
export function chainProblems(a: MdI, b: MdI): string[] {
  const A = a as Md;
  const B = b as Md;
  const problems: string[] = [];
  const chains = new Set<string>(['']);
  for (const md of [A, B]) for (const r of md.block.ruler.__rules__) for (const alt of r.alt) chains.add(alt);
  const same = (x: unknown[], y: unknown[]): boolean => x.length === y.length && x.every((f, i) => f === y[i]);
  for (const chain of [...chains].sort()) {
    const x = A.block.ruler.getRules(chain);
    const y = B.block.ruler.getRules(chain);
    if (!same(x, y)) problems.push(`block 鏈「${chain}」:${x.length} 條對 ${y.length} 條,或函式身分/順序不同`);
  }
  if (!same(A.core.ruler.getRules(''), B.core.ruler.getRules(''))) problems.push('core 鏈:函式身分/順序不同');
  try {
    expect(A.options).toEqual(B.options);
  } catch {
    problems.push(`options 不相等:${JSON.stringify(A.options)} 對 ${JSON.stringify(B.options)}`);
  }
  return problems;
}

describe('T57 畫面的執行時護欄:createMarkdownRenderer() 跟全新 new MarkdownIt(CARD_MARKDOWN_OPTIONS) 一樣', () => {
  it('block 每一條鏈、core 鏈、options 都一樣', async () => {
    const ui = await load(UI_FENCE);
    const cm = await load(CARD_MARKDOWN);
    const screen = (ui['createMarkdownRenderer'] as () => MdI)();
    const fresh = new MarkdownIt(cm['CARD_MARKDOWN_OPTIONS'] as Record<string, unknown>);
    expect(chainProblems(screen, fresh)).toEqual([]);
    // 護欄自己要看得到東西:鏈有規則、聯集裡有四個 alt 名字
    const rules = (fresh as Md).block.ruler.__rules__;
    expect(rules.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rules.flatMap((r) => r.alt))).toEqual(new Set(['paragraph', 'reference', 'blockquote', 'list']));
    expect((fresh as Md).core.ruler.getRules('').length).toBeGreaterThanOrEqual(8);
  });

  it('護欄抓得到壞樣本(合成):ruler.at 沒帶 alt、md.set({ maxNesting })、直接改 options、停掉一條規則、換掉 core 規則', () => {
    const make = (): MdI => new MarkdownIt({ html: false, linkify: true });
    expect(chainProblems(make(), make())).toEqual([]);

    const noAlt = make();
    const fence = (noAlt as Md).block.ruler.__rules__.find((r) => (r as unknown as { name: string }).name === 'fence') as unknown as { fn: never };
    (noAlt.block.ruler as unknown as { at(n: string, f: unknown): void }).at('fence', fence.fn);
    const p1 = chainProblems(noAlt, make());
    expect(p1.some((x) => x.includes('paragraph')), `ruler.at 沒帶 alt:'' 鏈身分一樣,但 paragraph 鏈少了 fence。實際 ${JSON.stringify(p1)}`).toBe(true);

    const setNest = make();
    setNest.set({ maxNesting: 5 });
    expect(chainProblems(setNest, make()).some((x) => x.startsWith('options')), 'md.set({ maxNesting: 5 })').toBe(true);

    const writeOpt = make();
    writeOpt.options.maxNesting = 1;
    expect(chainProblems(writeOpt, make()).some((x) => x.startsWith('options')), 'md.options.maxNesting = 1').toBe(true);

    const off = make();
    off.block.ruler.disable('code');
    expect(chainProblems(off, make()).some((x) => x.startsWith('block 鏈')), 'disable').toBe(true);

    const core = make();
    core.core.ruler.disable('normalize');
    expect(chainProblems(core, make()).some((x) => x.startsWith('core')), 'core disable').toBe(true);
  });

  it('行為列:包在 8 層引用裡的 example 圍欄,畫面與 core 都當成 1 個(maxNesting 動過就會變 0)', async () => {
    const T = '```';
    const body = ['前', '', ...[`${T}example`, '內容', T].map((l) => `${'> '.repeat(8)}${l}`), '', '後'].join('\n');
    const ui = await load(UI_FENCE);
    const html = (ui['renderMarkdown'] as (s: string) => string)(body);
    expect([...html.matchAll(/class="lc-example"/g)].length, '畫面').toBe(1);
    const core = await load('packages/core/src/schema/index.ts');
    const r = (core['stripExampleFences'] as (t: string) => { examples: string[] })(body);
    expect(r.examples, 'core').toEqual(['內容']);
  });
});

// ================================================================ 3. 畫面的靜態守門

const ASSIGN_MIN = ts.SyntaxKind.FirstAssignment;
const ASSIGN_MAX = ts.SyntaxKind.LastAssignment;
const memberName = (n: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression))) return n.argumentExpression.text;
  return undefined;
};
/** 這個運算式的接收者鏈裡有沒有碰到 `.options` */
function mentionsOptions(e: ts.Node): boolean {
  let cur: ts.Node = e;
  for (;;) {
    if (memberName(cur) === 'options') return true;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isCallExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    return false;
  }
}

/** 畫面 example-fence.ts 不准:block / core 的成員存取(含解構)、呼叫 set / configure、寫入 options */
export function screenViolations(text: string): string[] {
  const sf = sourceOf(text);
  const out: string[] = [];
  walkTree(sf, (n) => {
    const name = memberName(n);
    if (name === 'block' || name === 'core') out.push(`${lineOf(sf, n)} 成員存取 ${name}`);
    if (ts.isBindingElement(n)) {
      const pn = n.propertyName ?? n.name;
      if (ts.isIdentifier(pn) && (pn.text === 'block' || pn.text === 'core')) out.push(`${lineOf(sf, n)} 解構 ${pn.text}`);
    }
    if (ts.isCallExpression(n)) {
      const callee = memberName(n.expression);
      if (callee === 'set' || callee === 'configure') out.push(`${lineOf(sf, n)} 呼叫 ${callee}`);
      if (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Object') {
        if (['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf', 'freeze'].includes(n.expression.name.text) && n.arguments[0] && mentionsOptions(n.arguments[0])) {
          out.push(`${lineOf(sf, n)} Object.${n.expression.name.text}(…options…)`);
        }
      }
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ASSIGN_MIN && n.operatorToken.kind <= ASSIGN_MAX && mentionsOptions(n.left)) out.push(`${lineOf(sf, n)} 寫入 options`);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && mentionsOptions(n.operand)) {
      out.push(`${lineOf(sf, n)} 寫入 options`);
    }
    if (ts.isDeleteExpression(n) && mentionsOptions(n.expression)) out.push(`${lineOf(sf, n)} 刪 options`);
  });
  return out;
}

describe('T57 畫面的靜態守門:ui-shared/example-fence.ts 不碰 block / core、不呼叫 set / configure、不寫 options', () => {
  it('真的檔:一個都沒有', () => {
    expect(screenViolations(read(UI_FENCE))).toEqual([]);
  });

  it('守門抓得到壞樣本(合成):加在 createMarkdownRenderer 或 installAssetImages 都一樣', () => {
    for (const line of [
      "md.block.ruler.at('fence', f);",
      "md.core.ruler.disable('normalize');",
      "md['block'].ruler.disable('code');",
      'const { block } = md;',
      'const { core: c } = md;',
      'md.set({ maxNesting: 5 });',
      "md.configure('zero');",
      'md.options.maxNesting = 1;',
      "md.options['maxNesting'] = 1;",
      'md.options = { html: true };',
      'md.options.maxNesting += 1;',
      'Object.assign(md.options, { maxNesting: 5 });',
      "Object.defineProperty(md.options, 'html', { value: true });",
      'delete md.options.linkify;',
      'md.options.maxNesting++;',
    ]) {
      expect(screenViolations(`function createMarkdownRenderer() { const md = make(); ${line} return md; }`), `createMarkdownRenderer:${line}`).not.toEqual([]);
      expect(screenViolations(`function installAssetImages(md: M) { ${line} }`), `installAssetImages:${line}`).not.toEqual([]);
    }
  });

  it('現在這個檔用到的寫法不能被誤抓(inline、renderer.rules、use、normalizeLink、helpers、options 參數)', () => {
    const ok = `
      function installAssetImages(md: M, options: O) {
        const n = md.normalizeLink.bind(md);
        md.normalizeLink = (u: string) => n(u);
        md.helpers.parseLinkLabel = (a, b, c) => orig(a, b, c);
        md.inline.parse = (s, m, e, o) => orig(s, m, e, o);
        md.inline.ruler.at('image', fn);
        md.renderer.rules.image = (t, i, o, e, s) => s.renderToken(t, i, o);
        const x = options.cardDir;
        md.use(plugin);
        return md.render(s, env);
      }
      const m = new Map(); m.get('a');`;
    expect(screenViolations(ok)).toEqual([]);
  });
});

// ================================================================ 4. core 白名單(型別檢查器)

const TOKEN_ALLOWED = new Set(['type', 'info', 'map', 'content']);
const MD_ALLOWED = new Set(['parse']);

/** 把一組虛擬檔(路徑 → 內容)丟進同一個 program,回傳每一檔的違規。路徑解析、paths 別名都照 tsconfig.json。 */
export function whitelistProblems(files: Record<string, string>): Record<string, string[]> {
  const cfg = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false, composite: false };
  const host = ts.createCompilerHost(options, true);
  const virt = new Map(Object.entries(files).map(([rel, text]) => [join(ROOT, rel), text]));
  const origExists = host.fileExists.bind(host);
  const origRead = host.readFile.bind(host);
  const origGet = host.getSourceFile.bind(host);
  host.fileExists = (f) => virt.has(f) || origExists(f);
  host.readFile = (f) => virt.get(f) ?? origRead(f);
  host.getSourceFile = (f, lang, onError, shouldCreate) => (virt.has(f) ? ts.createSourceFile(f, virt.get(f)!, lang, true) : origGet(f, lang, onError, shouldCreate));
  const program = ts.createProgram([...virt.keys()], options, host);
  const checker = program.getTypeChecker();
  const result: Record<string, string[]> = {};
  for (const rel of Object.keys(files)) {
    const sf = program.getSourceFile(join(ROOT, rel))!;
    const out: string[] = [];
    const kindOf = (n: ts.Node): 'md' | 'token' | 'any' | 'other' => {
      const t = checker.getTypeAtLocation(n);
      if (t.flags & ts.TypeFlags.Any) return 'any';
      const s = checker.typeToString(t);
      if (s === 'MarkdownIt') return 'md';
      if (s === 'Token') return 'token';
      return 'other';
    };
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        const k = kindOf(n.expression);
        const name = memberName(n);
        const where = `${lineOf(sf, n)} ${n.getText(sf).slice(0, 50)}`;
        const p = n.parent;
        const written =
          (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind >= ASSIGN_MIN && p.operatorToken.kind <= ASSIGN_MAX) ||
          ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) ||
          ts.isDeleteExpression(p);
        if (k === 'token' && written) out.push(`${where}:token 只准讀,不准寫`);
        if (k === 'any') out.push(`${where}:接收者型別是 any,無法證明沒有越界`);
        else if (k === 'md' && !(name !== undefined && MD_ALLOWED.has(name))) out.push(`${where}:markdown-it 實例只准 .parse`);
        else if (k === 'token' && !(name !== undefined && TOKEN_ALLOWED.has(name))) out.push(`${where}:token 只准讀 type、info、map、content`);
      } else if (ts.isObjectBindingPattern(n)) {
        const holder = n.parent;
        const target = ts.isVariableDeclaration(holder) && holder.initializer ? holder.initializer : ts.isParameter(holder) ? holder : undefined;
        const k = target ? kindOf(target) : 'other';
        if (k === 'md' || k === 'token') {
          const allowed = k === 'md' ? MD_ALLOWED : TOKEN_ALLOWED;
          for (const el of n.elements) {
            const pn = el.propertyName ?? el.name;
            if (!ts.isIdentifier(pn) || !allowed.has(pn.text)) out.push(`${lineOf(sf, el)} 解構 ${el.getText(sf)}:不在白名單`);
          }
        } else if (k === 'any') out.push(`${lineOf(sf, n)} 解構 any`);
      } else if (ts.isIdentifier(n) && kindOf(n) === 'md') {
        // 實例當值傳出去(函式引數、賦值右邊、回傳):出了這個檔就管不到它
        const p = n.parent;
        const isReceiver = (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n;
        const isDecl = ts.isVariableDeclaration(p) && p.name === n;
        const isNewCtor = ts.isNewExpression(p) && p.expression === n;
        const isImport = ts.isImportClause(p) || ts.isImportSpecifier(p);
        if (!isReceiver && !isDecl && !isNewCtor && !isImport) out.push(`${lineOf(sf, n)} ${n.text} 被當成值用(傳出去或賦值)`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    result[rel] = out;
  }
  return result;
}

const SYN_HEAD = "import MarkdownIt from 'markdown-it';\nimport { CARD_MARKDOWN_OPTIONS, isExampleFence } from '@contracts/card-markdown.js';\nconst md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);\n";
const synth = (pre: string, inLoop: string): string =>
  `${SYN_HEAD}${pre}\nexport function f(text: string): number {\n  const tokens = md.parse(text, {});\n  for (const t of tokens) {\n    if (t.type === 'fence' && isExampleFence(t.info) && t.map) { void t.content; void t.map[0]; ${inLoop} }\n  }\n  return tokens.length;\n}\n`;

const GOOD = synth('', '');
const BAD: [string, string][] = [
  ['md.use', synth("md.use((m: MarkdownIt) => void m);", '')],
  ['md.render', synth('void md.render("x");', '')],
  ['md.block.ruler.at(沒帶 alt)', synth("md.block.ruler.at('fence', () => true);", '')],
  ['md.core', synth("md.core.ruler.disable('normalize');", '')],
  ['md.inline', synth("md.inline.ruler.disable('emphasis');", '')],
  ['md.options.maxNesting = 1', synth('md.options.maxNesting = 1;', '')],
  ['md.set', synth('md.set({ maxNesting: 5 });', '')],
  ["md['block']", synth("void md['block'];", '')],
  ['md[變數]', synth("const k = 'block' as string; void md[k as 'block'];", '')],
  ['(md as any).block', synth('void (md as any).block;', '')],
  ['別名 const m2 = md; m2.use', synth('const m2 = md; m2.use((m: MarkdownIt) => void m);', '')],
  ['解構 { block } = md', synth('const { block } = md; void block;', '')],
  ['md 傳出去', synth('function leak(m: MarkdownIt): void { void m; }\nleak(md);', '')],
  ['token.attrs', synth('', 'void t.attrs;')],
  ['token.children', synth('', 'void t.children;')],
  ['token.markup', synth('', 'void t.markup;')],
  ['token.level', synth('', 'void t.level;')],
  ['token.meta', synth('', 'void t.meta;')],
  ['token.attrGet', synth('', "void t.attrGet('x');")],
  ["token['markup']", synth('', "void t['markup'];")],
  ['token 解構 { markup }', synth('', 'const { markup } = t; void markup;')],
  ['token 別名 const u = t; u.tag', synth('', 'const u = t; void u.tag;')],
  ['token 改值 t.content = ""', synth('', "t.content = '';")],
];

describe('T57 core 白名單:schema/example-fence.ts 的 markdown-it 實例只准 .parse,token 只准讀 type、info、map、content', () => {
  const synthFiles: Record<string, string> = { 'packages/core/src/schema/__t57_good.ts': GOOD };
  BAD.forEach(([, text], i) => {
    synthFiles[`packages/core/src/schema/__t57_bad${i}.ts`] = text;
  });
  const files: Record<string, string> = { ...synthFiles };
  if (existsSync(join(ROOT, CORE_FENCE))) files[CORE_FENCE] = read(CORE_FENCE);
  let results: Record<string, string[]> | undefined;
  const run = (): Record<string, string[]> => (results ??= whitelistProblems(files));

  it('真的檔:一個越界都沒有(只用 md.parse、token 只讀 type/info/map/content)', () => {
    expect(existsSync(join(ROOT, CORE_FENCE)), `${CORE_FENCE} 要存在`).toBe(true);
    expect(run()[CORE_FENCE]).toEqual([]);
  });

  it('白名單守門抓得到壞樣本(合成,走型別檢查器):每一種越界都紅,守規矩的樣本不紅', () => {
    expect(run()['packages/core/src/schema/__t57_good.ts'], '守規矩的樣本不能被誤抓').toEqual([]);
    BAD.forEach(([what], i) => {
      const got = run()[`packages/core/src/schema/__t57_bad${i}.ts`];
      expect(got, `${what} 要被抓到`).not.toEqual([]);
    });
  });
});

// ================================================================ 5. 接線

/** core 與畫面:都從 @contracts/card-markdown.js 拿 CARD_MARKDOWN_OPTIONS 與 isExampleFence,不留自己的一份 */
export function wiringProblems(text: string): string[] {
  const sf = sourceOf(text);
  const out: string[] = [];
  let mdName: string | undefined;
  const imported = new Set<string>();
  const newArgs: string[] = [];
  let usesIsExampleFence = false;
  walkTree(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      if (spec === 'markdown-it' && n.importClause?.name) mdName = n.importClause.name.text;
      if (/^@contracts\/card-markdown(\.js)?$/.test(spec)) {
        const nb = n.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) imported.add((e.propertyName ?? e.name).text);
      }
    }
    if (ts.isIdentifier(n) && n.text === 'fenceLang') out.push(`${lineOf(sf, n)} 還有自己的 fenceLang`);
    if (ts.isPropertyAssignment(n) && (n.name.getText(sf) === 'html' || n.name.getText(sf) === 'linkify')) out.push(`${lineOf(sf, n)} 自己寫了一份選項(${n.name.getText(sf)})`);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'isExampleFence') usesIsExampleFence = true;
    if (ts.isNewExpression(n) && mdName !== undefined && ts.isIdentifier(n.expression) && n.expression.text === mdName) {
      newArgs.push(n.arguments?.length === 1 ? n.arguments[0]!.getText(sf) : `(${n.arguments?.length ?? 0} 個引數)`);
    }
  });
  if (!imported.has('CARD_MARKDOWN_OPTIONS')) out.push("沒有從 '@contracts/card-markdown.js' import CARD_MARKDOWN_OPTIONS");
  if (!imported.has('isExampleFence')) out.push("沒有從 '@contracts/card-markdown.js' import isExampleFence");
  if (!usesIsExampleFence) out.push('沒有呼叫 isExampleFence');
  if (newArgs.length !== 1) out.push(`new MarkdownIt 要剛好一個,實際 ${newArgs.length} 個`);
  for (const a of newArgs) if (a !== 'CARD_MARKDOWN_OPTIONS') out.push(`new MarkdownIt 的引數是 ${a},要是 CARD_MARKDOWN_OPTIONS`);
  return out;
}

describe('T57 接線:core 與畫面用同一份選項與判斷', () => {
  it('core 的 example-fence.ts', () => {
    expect(wiringProblems(read(CORE_FENCE))).toEqual([]);
  });
  it('畫面的 example-fence.ts', () => {
    expect(wiringProblems(read(UI_FENCE))).toEqual([]);
  });
  it('接線守門抓得到壞樣本(合成)', () => {
    const head = "import MarkdownIt from 'markdown-it';\nimport { CARD_MARKDOWN_OPTIONS, isExampleFence } from '@contracts/card-markdown.js';\n";
    const good = `${head}const md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);\nexport const f = (i: string) => isExampleFence(i);\n`;
    expect(wiringProblems(good)).toEqual([]);
    const bad: [string, string][] = [
      ['自己寫一份選項', `${head}const md = new MarkdownIt({ html: false, linkify: true });\nexport const f = (i: string) => isExampleFence(i);\n`],
      ['引數是別的變數', `${head}const O = { html: false };\nconst md = new MarkdownIt(O);\nexport const f = (i: string) => isExampleFence(i);\n`],
      ['沒有引數', `${head}const md = new MarkdownIt();\nexport const f = (i: string) => isExampleFence(i);\n`],
      ['兩個實例', `${good}const m2 = new MarkdownIt(CARD_MARKDOWN_OPTIONS);\n`],
      ['沒 import isExampleFence', "import MarkdownIt from 'markdown-it';\nimport { CARD_MARKDOWN_OPTIONS } from '@contracts/card-markdown.js';\nconst md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);\nexport const f = (i: string) => i === 'x';\n"],
      ['沒 import CARD_MARKDOWN_OPTIONS', "import MarkdownIt from 'markdown-it';\nimport { isExampleFence } from '@contracts/card-markdown.js';\nconst md = new MarkdownIt({});\nexport const f = (i: string) => isExampleFence(i);\n"],
      ['從別的路徑 import', "import MarkdownIt from 'markdown-it';\nimport { CARD_MARKDOWN_OPTIONS, isExampleFence } from '../../contracts/src/index.js';\nconst md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);\nexport const f = (i: string) => isExampleFence(i);\n"],
      ['還有自己的 fenceLang', `${good}function fenceLang(info: string): string { return info.trim().split(/\\s+/)[0] ?? ''; }\n`],
      ['有 isExampleFence 但沒呼叫', `${head}const md = new MarkdownIt(CARD_MARKDOWN_OPTIONS);\nexport const g = isExampleFence;\n`],
    ];
    for (const [what, src] of bad) expect(wiringProblems(src), what).not.toEqual([]);
  });

  it('兩個 app 的 vite.config.ts 都有 @contracts 別名(畫面 import @contracts/card-markdown.js,Vite 要解析得到)', () => {
    for (const app of ['teach-card', 'test-card']) {
      expect(read(`apps/${app}/vite.config.ts`), `apps/${app}/vite.config.ts`).toMatch(/['"]@contracts['"]\s*:/);
    }
  });
});

// ================================================================ 6. 釘版

describe('T57 釘版:markdown-it 剛好 15.0.1', () => {
  it('根 package.json 的 dependencies["markdown-it"] 是 15.0.1(不是範圍)', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['markdown-it']).toBe('15.0.1');
  });
  it('node_modules/markdown-it 的 version 是 15.0.1', () => {
    expect((JSON.parse(read('node_modules/markdown-it/package.json')) as { version: string }).version).toBe('15.0.1');
  });
  it('package-lock.json:根套件宣告 15.0.1、node_modules/markdown-it 是 15.0.1、而且 lockfile 裡只有一份', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
    expect(lock.packages['']?.dependencies?.['markdown-it'], '根套件的依賴宣告').toBe('15.0.1');
    expect(lock.packages['node_modules/markdown-it']?.version).toBe('15.0.1');
    const copies = Object.keys(lock.packages).filter((k) => k === 'node_modules/markdown-it' || k.endsWith('/node_modules/markdown-it'));
    expect(copies, 'lockfile 裡 markdown-it 只能有一份').toEqual(['node_modules/markdown-it']);
  });
});

// ================================================================ 7. 舊向量測試檔對照表

const MAP_PATH = 'docs/reviews/T57-old-vectors-map.md';
const OLD_FILES = {
  deleted: ['schema/word-count.test.ts', 'schema/validate-card.fence-whitespace.test.ts', 'prompt-quality/word-count.test.ts'],
  kept: ['schema/validate-card.contract-vectors.test.ts', 'ingest/example-fence-word-count.test.ts', 'lint/validator-min.test.ts'],
};

/** 對照表核對:每一條「刪」都指到存在的向量列;每一條「留」有原因;六個檔每個都有一節 */
export function mapProblems(md: string, rowNames: Set<string>, files: string[]): string[] {
  const out: string[] = [];
  const lines = md.split('\n');
  for (const f of files) if (!lines.some((l) => l.startsWith('## ') && l.includes(`/${f}`))) out.push(`對照表沒有「${f}」那一節`);
  let deletes = 0;
  for (const line of lines) {
    if (!line.startsWith('| ') || line.startsWith('| 條目 | 處置 |') || line.startsWith('|---')) continue;
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    const verdict = cells[2] ?? '';
    if (verdict.startsWith('刪')) {
      deletes += 1;
      const m = /替身是向量列 `([^`]+)`/.exec(verdict);
      if (!m) out.push(`「刪」沒寫替身:${line.slice(0, 60)}`);
      else if (!rowNames.has(m[1]!)) out.push(`替身指到不存在的向量列「${m[1]}」:${line.slice(0, 60)}`);
    } else if (verdict.startsWith('留')) {
      const reason = verdict.replace(/^留\s*(→|->)?\s*/, '');
      if (reason.length < 8) out.push(`「留」沒寫原因:${line.slice(0, 60)}`);
    } else out.push(`處置不是「刪」也不是「留」:${line.slice(0, 60)}`);
  }
  if (deletes < 120) out.push(`「刪」只有 ${deletes} 條,太少(舊六個檔的字面向量至少 120 條)`);
  return out;
}

describe('T57 六個舊向量測試檔收斂:對照表核對', () => {
  const rowNames = (): Set<string> => new Set((JSON.parse(read('contracts/fixtures/word-count-vectors.json')) as { rows: { name: string }[] }).rows.map((r) => r.name));
  const all = [...OLD_FILES.deleted, ...OLD_FILES.kept];

  it('對照表存在,每一條「刪」的替身都在向量檔、每一條「留」有原因、六個檔都有一節', () => {
    expect(existsSync(join(ROOT, MAP_PATH)), `${MAP_PATH} 要存在`).toBe(true);
    expect(mapProblems(read(MAP_PATH), rowNames(), all)).toEqual([]);
  });

  it('核對抓得到壞對照表(合成):替身不存在、沒寫替身、「留」沒原因、少一節、處置亂寫', () => {
    const names = new Set(['a', 'b']);
    const header = (f: string): string => `## packages/core/src/${f}\n\n| 條目 | 處置 |\n|---|---|\n`;
    const rows = (n: number, cell: string): string => Array.from({ length: n }, (_, i) => `| 舊測試 ${i} | ${cell} |\n`).join('');
    const ok = header('x.test.ts') + rows(120, '刪 → 替身是向量列 `a`');
    expect(mapProblems(ok, names, ['x.test.ts'])).toEqual([]);
    expect(mapProblems(ok + '| z | 刪 → 替身是向量列 `nope` |\n', names, ['x.test.ts']).some((p) => p.includes('不存在')), '替身不存在').toBe(true);
    expect(mapProblems(ok + '| z | 刪 |\n', names, ['x.test.ts']).some((p) => p.includes('沒寫替身')), '沒寫替身').toBe(true);
    expect(mapProblems(ok + '| z | 留 |\n', names, ['x.test.ts']).some((p) => p.includes('沒寫原因')), '留沒原因').toBe(true);
    expect(mapProblems(ok + '| z | 留 → 不是向量,是 frontmatter 的拆解行為 |\n', names, ['x.test.ts'])).toEqual([]);
    expect(mapProblems(ok, names, ['x.test.ts', 'y.test.ts']).some((p) => p.includes('y.test.ts')), '少一節').toBe(true);
    expect(mapProblems(ok + '| z | 隨便 |\n', names, ['x.test.ts']).some((p) => p.includes('處置不是')), '處置亂寫').toBe(true);
    expect(mapProblems(header('x.test.ts') + rows(5, '刪 → 替身是向量列 `a`'), names, ['x.test.ts']).some((p) => p.includes('太少')), '條數太少').toBe(true);
  });

  it('整個刪的三個檔真的不在了,留下的三個檔還在', () => {
    for (const f of OLD_FILES.deleted) expect(existsSync(join(ROOT, 'packages/core/src', f)), `${f} 要刪掉`).toBe(false);
    for (const f of OLD_FILES.kept) expect(existsSync(join(ROOT, 'packages/core/src', f)), `${f} 要留著`).toBe(true);
  });

  it('留下的三個檔裡不再有字面向量:沒有 it.each 的字數表、沒有 countWords/countBodyWords 的字面比較', () => {
    for (const f of OLD_FILES.kept) {
      const text = read(`packages/core/src/${f}`);
      expect(text, `${f}:不該再有 countWords(...) 的字面比較`).not.toMatch(/(?:countWords|countBodyWords)\(\s*['"`][^'"`]*['"`]\s*\)\)\.toBe\(/);
      expect(text, `${f}:不該再有 bodyWordCount).toBe(<數字>)`).not.toMatch(/bodyWordCount\)?\.toBe\(\d+\)/);
    }
  });
});
