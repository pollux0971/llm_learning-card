/**
 * T52 紅測試:契約 §2 的字數與圍欄規則只留一份實作,所有讀這條規則的實作都跑同一份向量檔。
 * T57(契約 1.5.0、ADR-081)改寫:example 圍欄以教學卡畫面的區塊解析(markdown-it 15.0.1)為準;向量檔多了怪寫法、波浪號、清單與引用、
 * 只有 CR 的換行、資訊字串逐字等列;「畫面」那一列改走真的路(card.ts parseCard → bodyMarkdown → renderMarkdown);指紋掃描的登記檔改成
 * card-markdown.ts(比 'example')與 word-count.ts(Script)。
 * 工單:docs/tickets/T52-word-count-single-source-vectors.md、T57-example-fence-follows-screen.md。ADR-060 第 3 點、ADR-081。測試 agent 寫;開發 worker 不改。
 *
 * 這個檔四件事:
 *   1. 向量檔 `contracts/fixtures/word-count-vectors.json` 的結構檢查(全 ASCII、欄位、basis 合法、strippedBody 選填、covers 涵蓋 §2 每個類別、
 *      U+F900 那一列真的是 U+F900、fixture 檔存在、01 phase-1 gherkin 表的九列都在、列數釘死)。
 *   2. 登記表:每一份讀 §2 規則的實作各跑向量檔的**每一列**(字數與 example 內容或個數),並斷言跑過的列數 = 向量檔列數。
 *   3. 指紋掃描:只認「讀」§2 規則的寫法,擋第五份。命中的檔要在登記表或例外表(附理由),否則紅。
 *   4. 周邊護欄:`ui-shared/src/word-count.ts` 已刪(D1)、lint 的 frontmatter 行為不變(Date,不是字串)。
 *
 * 載入方式:所有被測模組都用動態 import 算出來的 file URL(紅測試在 base 上要 tsc 乾淨,而新匯出在 base 上還不存在)。
 * 新匯出:`@core/schema/index.js` 的 `stripExampleFences(text) → { body, examples }` 與 `countBodyWords(text)`(ADR-060 第 3 點的名字)。
 *
 * 範圍:契約 §2 的每一種圍欄寫法都有向量(1.5.0 起);沒列名的字元類別(M*、Cf)除了「其他」的完整寫法外不單獨測。
 * 舊六個向量測試檔的字面向量都收進向量檔(對照表 docs/reviews/T57-old-vectors-map.md,由 t57-example-fence-guards.test.ts 核對)。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const VECTORS_PATH = join(ROOT, 'contracts/fixtures/word-count-vectors.json');
const FIXTURES_DIR = join(ROOT, 'contracts/fixtures');
const GHERKIN_PATH = join(ROOT, 'features/01-data-layer/phase-1.feature');

/** 向量檔的列數。刪一列、或測試少跑,這個數字就對不上。加列時由測試 agent 改這裡。 */
const EXPECTED_ROWS = 170;

const BASES = ['s2-key-table', 's2-vector-table', 's2-definition', 'ruling-b', 'fixture', 'gherkin-p1', 's2-fence-1.5.0'] as const;

/** 契約 §2 定義裡的每一個類別(ADR-060:向量要涵蓋類別,不是只涵蓋例子)。向量檔的 covers 聯集必須包含這些。 */
const REQUIRED_COVERS = [
  // CJK(Script=Han / Hiragana / Katakana / Hangul)
  'cjk-han', 'cjk-han-ext-a', 'cjk-han-ext-b', 'cjk-han-compat', 'cjk-hiragana', 'cjk-katakana',
  'cjk-hangul-syllable', 'cjk-hangul-jamo', 'cjk-hangul-compat', 'cjk-cuts-alnum',
  // 字母數字(L* 非 CJK 與 N*)
  'alnum-latin', 'alnum-non-latin-letter', 'alnum-fullwidth', 'alnum-digit', 'alnum-other-number', 'alnum-common-script-letter',
  // 切斷與其他
  'cut-space', 'cut-ideographic-space', 'cut-hyphen', 'cut-period', 'cut-apostrophe', 'cut-cjk-punct', 'cut-symbol',
  // 空字串與上限邊界
  'empty', 'limit-100', 'limit-101',
  // 圍欄(§2 與顧問 2026-10-25 裁決乙)
  'fence-3', 'fence-4-nested', 'fence-5-nested4', 'fence-multi', 'fence-non-example', 'fence-examples-marker', 'fence-two-backticks',
  'fence-crlf', 'fence-close-eof', 'fence-close-trailing-space', 'fence-close-trailing-tab', 'fence-close-indent',
  'fence-open-trailing-ws', 'fence-close-followed-by-word', 'fence-close-glued',
  // 圍欄(契約 1.5.0、ADR-081:以畫面的區塊解析為準)
  'fence-same-line', 'fence-unclosed', 'fence-close-longer', 'fence-info-trailing-text', 'fence-info-tab', 'fence-close-indent-4',
  'fence-open-indent-4', 'fence-open-indent-3', 'fence-lazy-continuation', 'fence-trim-first', 'fence-open-after-text',
  'fence-tilde', 'fence-tilde-wraps-backticks', 'fence-mixed-marker', 'fence-tilde-info-backtick',
  'fence-list', 'fence-blockquote', 'fence-list-quote', 'fence-container-marker', 'fence-empty-example',
  'fence-tab-indent', 'fence-cr-only', 'fence-info-entity', 'fence-info-case', 'fence-info-ideographic-space', 'fence-body-bytes',
  // fixture 與 gherkin
  'fixture', 'gherkin',
] as const;

interface VectorRow {
  name: string;
  body?: string;
  fixture?: string;
  words: number;
  examples: string[];
  covers: string[];
  basis: string;
  why: string;
  /** 選填:移除 example 圍欄之後、整段 trim 的 body 原文(逐位元組比,CRLF 與容器記號都在) */
  strippedBody?: string;
}
interface VectorDoc {
  description: string;
  rows: VectorRow[];
}

const rawVectors = readFileSync(VECTORS_PATH, 'utf8');
const doc = JSON.parse(rawVectors) as VectorDoc;
const rows = doc.rows;

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
/** 一列要數的 body:body 欄位,或 fixture 檔拿掉 frontmatter 之後的內容 */
function bodyOf(row: VectorRow): string {
  if (row.body !== undefined) return row.body;
  return readFileSync(join(FIXTURES_DIR, row.fixture!), 'utf8').replace(FM_RE, '');
}
/** 給「吃整張卡」的實作:空的 frontmatter + body(跟既有的 word-count 測試一樣) */
const PREFIX = '---\n---\n\n';
const asCard = (body: string): string => `${PREFIX}${body}`;

// ================================================================ 載入

type Mod = Record<string, unknown>;
async function load(rel: string): Promise<Mod> {
  return (await import(pathToFileURL(join(ROOT, rel)).href)) as Mod;
}
function fn<T extends (...a: never[]) => unknown>(mod: Mod, name: string, where: string): T {
  const f = mod[name];
  if (typeof f !== 'function') throw new Error(`${where} 要匯出 ${name}`);
  return f as T;
}

// ================================================================ 1. 向量檔結構

describe('T52 向量檔 contracts/fixtures/word-count-vectors.json:結構', () => {
  it('整個檔只有 ASCII(非 ASCII 字元都是 \\u 跳脫),編輯器的 NFC 動不了它', () => {
    const bad = [...rawVectors].filter((c) => c.charCodeAt(0) > 0x7f);
    expect(bad.length, `非 ASCII 字元 ${bad.length} 個`).toBe(0);
  });

  it(`列數釘死 ${EXPECTED_ROWS};每列有 name(唯一)、words、examples(陣列)、covers、basis(合法)、why;body 與 fixture 二擇一`, () => {
    expect(rows.length).toBe(EXPECTED_ROWS);
    const names = new Set<string>();
    for (const r of rows) {
      expect(typeof r.name === 'string' && r.name.length > 0, `name:${JSON.stringify(r)}`).toBe(true);
      expect(names.has(r.name), `name 重複:${r.name}`).toBe(false);
      names.add(r.name);
      expect(Number.isInteger(r.words) && r.words >= 0, `${r.name} 的 words`).toBe(true);
      expect(Array.isArray(r.examples) && r.examples.every((e) => typeof e === 'string'), `${r.name} 的 examples 要是字串陣列`).toBe(true);
      expect(Array.isArray(r.covers) && r.covers.length > 0, `${r.name} 的 covers`).toBe(true);
      expect((BASES as readonly string[]).includes(r.basis), `${r.name} 的 basis「${r.basis}」不合法`).toBe(true);
      expect(typeof r.why === 'string' && r.why.length > 0, `${r.name} 要有 why`).toBe(true);
      expect((r.body === undefined) !== (r.fixture === undefined), `${r.name}:body 與 fixture 二擇一`).toBe(true);
      expect((r.examples as string[]).every((e) => e === e.trim()), `${r.name} 的 examples 要 trim 過`).toBe(true);
    }
  });

  it('covers 的聯集涵蓋 §2 定義裡的每一個類別,而且沒有不認識的類別', () => {
    const union = new Set(rows.flatMap((r) => r.covers));
    const missing = REQUIRED_COVERS.filter((c) => !union.has(c));
    expect(missing, `向量檔沒涵蓋這些類別:${missing.join(', ')}`).toEqual([]);
    const known = new Set<string>(REQUIRED_COVERS);
    const unknown = [...union].filter((c) => !known.has(c));
    expect(unknown, `向量檔有不認識的 covers:${unknown.join(', ')}`).toEqual([]);
  });

  it('契約 1.5.0 的關鍵列都在、數字是顧問要的那幾個(清單留 1. 是 3、裸引用是 0、實體不解 8、Example 7、U+3000 切開 2、空例子框、CRLF)', () => {
    const T = '`'.repeat(3);
    const C = '\u5167\u5bb9 \u5167\u5bb9';
    const F = '\u524d';
    const B = '\u5f8c';
    const find = (body: string): VectorRow | undefined => rows.find((r) => r.body === body);
    const want: [string, string, number, string[]][] = [
      ['清單 1. 留下', `${F}\n\n1. ${T}example\n   ${C}\n   ${T}\n\n${B}`, 3, [C]],
      ['裸引用', `> ${T}example\n> ${C}\n> ${T}`, 0, [C]],
      ['HTML 實體不解', `${F}\n\n${T}&#101;xample\n${C}\n${T}\n\n${B}`, 8, []],
      ['Example 大寫', `${F}\n\n${T}Example\n${C}\n${T}\n\n${B}`, 7, []],
      ['U+3000 切開', `${F}\n\n${T}example\u3000x\n${C}\n${T}\n\n${B}`, 2, [C]],
      ['清單續行沒縮排:空例子框', `${F}\n\n- ${T}example\n${C}\n${T}\n\n${B}`, 6, ['']],
      ['引用只有開始行有 >:空例子框', `${F}\n\n> ${T}example\n${C}\n${T}\n\n${B}`, 6, ['']],
      ['沒關到卡片結尾', `${F}\n\n${T}example\n${C}\n\n${B}`, 1, [`${C}\n\n${B}`]],
      ['只有 CR 的換行', `${F}\r\r${T}example\r${C}\r${T}\r\r${B}`, 2, [C]],
      ['body 第一行縮排 4 要先 trim', `    ${T}example\n${C}\n${T}\n\n${B}`, 1, [C]],
    ];
    for (const [what, body, words, examples] of want) {
      const hit = find(body);
      expect(hit, `向量檔缺這一列:${what}`).toBeDefined();
      expect(hit?.words, `${what} 的字數`).toBe(words);
      expect(hit?.examples, `${what} 的 examples`).toEqual(examples);
      expect(hit?.basis).toBe('s2-fence-1.5.0');
    }
    expect(rows.filter((r) => r.basis === 's2-fence-1.5.0').length, '1.5.0 的列數').toBe(31);
  });

  it('strippedBody(選填)至少 8 列有:其中有 CRLF 原樣保留的一列、清單留下 "1. " 的一列;型別是字串', () => {
    const withStripped = rows.filter((r) => r.strippedBody !== undefined);
    expect(withStripped.length).toBeGreaterThanOrEqual(8);
    for (const r of withStripped) {
      expect(typeof r.strippedBody, r.name).toBe('string');
      expect(r.strippedBody, `${r.name} 的 strippedBody 要 trim 過`).toBe(r.strippedBody!.trim());
    }
    expect(withStripped.some((r) => r.strippedBody!.includes('\r\n') && r.strippedBody!.includes('\u524d')), '有一列 CRLF 原樣留著').toBe(true);
    expect(withStripped.some((r) => r.strippedBody!.includes('1. \n')), '有一列留下 "1. " 自成一行').toBe(true);
  });

  it('相容區的列真的是 U+F900(不是被 NFC 換成 U+8C48),Hangul Jamo 與 Hangul 相容字母、擴充 A、擴充 B 也都是原碼位', () => {
    const body = (name: string): string => rows.find((r) => r.name === name)?.body ?? '';
    expect([...body('vec: han compat')].map((c) => c.codePointAt(0))).toEqual([0xf900, 0xf900]);
    expect([...body('vec: hangul jamo')].map((c) => c.codePointAt(0))).toEqual([0x1100, 0x1100]);
    expect([...body('vec: hangul compat letters')].map((c) => c.codePointAt(0))).toEqual([0x3131, 0x3131]);
    expect([...body('vec: han ext A')].map((c) => c.codePointAt(0))).toEqual([0x3400, 0x3400]);
    expect([...body('vec: han ext B')].map((c) => c.codePointAt(0))).toEqual([0x20000, 0x20000]);
    expect([...body('alnum: prolonged sound mark pair')].map((c) => c.codePointAt(0))).toEqual([0x30fc, 0x30fc]);
    expect(rawVectors).toContain('\\uf900\\uf900');
    expect(rawVectors).not.toContain('\\u8c48');
  });

  it('fixture 列指到的檔都存在,字數是 §2 / README 釘的 23 與 27', () => {
    const fixtures = rows.filter((r) => r.fixture !== undefined);
    expect(fixtures.map((r) => r.fixture).sort()).toEqual(['cards/valid-example-with-nested-content.md', 'cards/wordcount-cases.md']);
    for (const r of fixtures) expect(existsSync(join(FIXTURES_DIR, r.fixture!)), r.fixture).toBe(true);
    expect(rows.find((r) => r.fixture === 'cards/wordcount-cases.md')?.words).toBe(23);
    const nested = rows.find((r) => r.fixture === 'cards/valid-example-with-nested-content.md');
    expect(nested?.words).toBe(27);
    expect(nested?.examples.length).toBe(1);
  });

  it('01 phase-1 gherkin「Word counting follows the contract」那張表的九列,每一列都在向量檔裡、數字相同', () => {
    const feat = readFileSync(GHERKIN_PATH, 'utf8').split('\n');
    const start = feat.findIndex((l) => l.includes('Scenario Outline: Word counting follows the contract'));
    expect(start, '找得到那個場景').toBeGreaterThanOrEqual(0);
    const exAt = feat.findIndex((l, i) => i > start && l.trim() === 'Examples:');
    const table: [string, number][] = [];
    for (let i = exAt + 2; i < feat.length && feat[i]!.trim().startsWith('|'); i += 1) {
      const cells = feat[i]!.trim().slice(1, -1).split('|').map((c) => c.trim());
      table.push([cells[0]!, Number(cells[1])]);
    }
    expect(table.length, 'gherkin 表的列數').toBe(9);
    const g = rows.filter((r) => r.basis === 'gherkin-p1');
    expect(g.length).toBe(9);
    for (const [content, count] of table) {
      const hit = g.find((r) => r.body === content);
      expect(hit, `向量檔缺 gherkin 的列:${JSON.stringify(content)}`).toBeDefined();
      expect(hit?.words, `gherkin 列 ${JSON.stringify(content)} 的字數`).toBe(count);
    }
  });

  it('向量檔的 README 清單有登記這個檔', () => {
    expect(readFileSync(join(FIXTURES_DIR, 'README.md'), 'utf8')).toContain('word-count-vectors.json');
  });
});

// ================================================================ 2. 登記表:每一份實作跑每一列

interface Impl {
  /** 登記表上的名字(守門:少一份就紅) */
  name: string;
  /** 這份實作比什麼('body' = trim 過,而且有 strippedBody 的列要逐位元組一樣) */
  checks: ('words' | 'examples' | 'exampleCount' | 'body')[];
  /** 傳 body 文字,回傳它算出的東西。拿不到的欄位不要填。 */
  run(body: string): Promise<{ words?: number; examples?: string[]; exampleCount?: number; body?: string }>;
}

const REGISTRY: Impl[] = [
  {
    name: '@core/schema validateCard(字數與 example 個數)',
    checks: ['words', 'exampleCount'],
    async run(body) {
      const m = await load('packages/core/src/schema/index.ts');
      const r = fn<(raw: string) => { bodyWordCount: number; examplesCount: number }>(m, 'validateCard', '@core/schema')(asCard(body));
      return { words: r.bodyWordCount, exampleCount: r.examplesCount };
    },
  },
  {
    name: '@core/schema parseCardText + countWords(body 與 examples)',
    checks: ['words', 'examples', 'body'],
    async run(body) {
      const m = await load('packages/core/src/schema/index.ts');
      const p = fn<(raw: string) => { body: string; examples: string[] }>(m, 'parseCardText', '@core/schema')(asCard(body));
      const words = fn<(t: string) => number>(m, 'countWords', '@core/schema')(p.body);
      return { words, examples: p.examples, body: p.body };
    },
  },
  {
    name: '@core/schema stripExampleFences(新,ADR-060 第 3 點)',
    checks: ['examples', 'body', 'words'],
    async run(body) {
      const m = await load('packages/core/src/schema/index.ts');
      const r = fn<(t: string) => { body: string; examples: string[] }>(m, 'stripExampleFences', '@core/schema/index.js')(body);
      const words = fn<(t: string) => number>(m, 'countWords', '@core/schema')(r.body);
      return { words, examples: r.examples, body: r.body };
    },
  },
  {
    name: '@core/schema countBodyWords(新,ADR-060 第 3 點)',
    checks: ['words'],
    async run(body) {
      const m = await load('packages/core/src/schema/index.ts');
      return { words: fn<(t: string) => number>(m, 'countBodyWords', '@core/schema/index.js')(body) };
    },
  },
  {
    name: '09-lint countBodyWords',
    checks: ['words'],
    async run(body) {
      const m = await load('packages/core/src/lint/index.ts');
      return { words: fn<(t: string) => number>(m, 'countBodyWords', '@core/lint')(body) };
    },
  },
  {
    name: '09-lint parseCard(examples)',
    checks: ['examples', 'body'],
    async run(body) {
      const m = await load('packages/core/src/lint/index.ts');
      const p = fn<(raw: string) => { body: string; examples: string[] }>(m, 'parseCard', '@core/lint')(asCard(body));
      return { examples: p.examples, body: p.body };
    },
  },
  {
    name: '09-lint 回報字數的那條路(parseCard → checkBodyLimit 的 body_over_limit)',
    checks: ['words'],
    async run(body) {
      const m = await load('packages/core/src/lint/index.ts');
      // checkBodyLimit 只在超過 100 字時回報字數。前面墊 101 個字,讀回報的數字再減 101。
      // 墊在前面之後,body 第一行的縮排不再是整段的開頭,所以先 trimStart(「解析前先 trim」由其他路徑管:向量檔「body first line indented four」那一列)。
      const PAD = 101;
      const parsed = fn<(raw: string) => unknown>(m, 'parseCard', '@core/lint')(asCard(`${'\u540c'.repeat(PAD)}\n\n${body.trimStart()}`));
      const problems = fn<(s: unknown) => { type: string; detail: string }[]>(m, 'checkBodyLimit', '@core/lint')({
        cards: [{ id: 'x', category: 'c', path: 'cards/c/x.md', parsed }],
      });
      expect(problems.length, 'checkBodyLimit 在 101 字以上一定要回報').toBe(1);
      const hit = /字數 (\d+)/.exec(problems[0]!.detail);
      expect(hit, problems[0]!.detail).not.toBeNull();
      return { words: Number(hit![1]) - PAD };
    },
  },
  {
    name: '12-prompt-quality countBodyWords',
    checks: ['words'],
    async run(body) {
      const m = await load('packages/core/src/prompt-quality/index.ts');
      return { words: fn<(t: string) => number>(m, 'countBodyWords', '@core/prompt-quality')(body) };
    },
  },
  {
    name: '02-ingest enforceWordLimit(第一次嘗試的字數)',
    checks: ['words'],
    async run(body) {
      const m = await load('packages/core/src/ingest/generate-cards.ts');
      // 字數沒超過上限時 call 不會被叫;超過時回一筆合法的短卡,只為了讓它收尾。看的是 attempts[0]。
      const r = await fn<
        (
          call: (task: string, prompt: string) => Promise<{ text: string }>,
          task: string,
          category: string,
          label: string,
          input: { title: string; body: string; examples: string[] },
        ) => Promise<{ attempts: { wordCount: number }[] }>
      >(m, 'enforceWordLimit', 'ingest/generate-cards')(
        async () => ({ text: JSON.stringify([{ body: 'ok' }]) }),
        'ingest.cards',
        'security',
        'test',
        { title: 't', body, examples: [] },
      );
      return { words: r.attempts[0]!.wordCount };
    },
  },
  {
    name: '07 畫面 parseCard → bodyMarkdown → renderMarkdown(最外層 lc-example 容器個數)',
    checks: ['exampleCount'],
    async run(body) {
      // 真的走畫面的路(App.svelte 的 parsed()):teach-card 的 parseCard 先 trim、拿 bodyMarkdown,再交給 ui-shared 的 renderMarkdown。
      // 不在這裡自己判斷「是不是 example」。
      const m = await load('packages/ui-shared/src/example-fence.ts');
      const c = await load('apps/teach-card/src/lib/card.ts');
      const parsed = fn<(raw: string) => { bodyMarkdown: string }>(c, 'parseCard', 'teach-card/lib/card')(`---\nid: x\n---\n${body}`);
      const html = fn<(src: string) => string>(m, 'renderMarkdown', 'ui-shared/example-fence')(parsed.bodyMarkdown);
      const cls = m['EXAMPLE_CLASS'];
      if (typeof cls !== 'string') throw new Error('ui-shared/example-fence 要匯出 EXAMPLE_CLASS');
      // example 裡面的 example 會被遞迴渲染成巢狀的 <details>,只數最外層(= 卡片自己的 example 圍欄個數)。
      let depth = 0;
      let n = 0;
      for (const tag of html.matchAll(/<details\b[^>]*>|<\/details>/g)) {
        if (tag[0] === '</details>') depth -= 1;
        else {
          if (depth === 0 && new RegExp(`class="${cls}"`).test(tag[0])) n += 1;
          depth += 1;
        }
      }
      return { exampleCount: n };
    },
  },
];

describe('T52 登記表:每一份讀 §2 規則的實作都跑向量檔的每一列', () => {
  it('登記表的名單不能少(少登記一份 = 少一份被擋)', () => {
    expect(REGISTRY.map((i) => i.name)).toEqual([
      '@core/schema validateCard(字數與 example 個數)',
      '@core/schema parseCardText + countWords(body 與 examples)',
      '@core/schema stripExampleFences(新,ADR-060 第 3 點)',
      '@core/schema countBodyWords(新,ADR-060 第 3 點)',
      '09-lint countBodyWords',
      '09-lint parseCard(examples)',
      '09-lint 回報字數的那條路(parseCard → checkBodyLimit 的 body_over_limit)',
      '12-prompt-quality countBodyWords',
      '02-ingest enforceWordLimit(第一次嘗試的字數)',
      '07 畫面 parseCard → bodyMarkdown → renderMarkdown(最外層 lc-example 容器個數)',
    ]);
  });

  for (const impl of REGISTRY) {
    it(`${impl.name}:向量檔每一列都對(${impl.checks.join('、')})`, async () => {
      const wrong: string[] = [];
      let ran = 0;
      for (const row of rows) {
        const body = bodyOf(row);
        const got = await impl.run(body);
        ran += 1;
        if (impl.checks.includes('words') && got.words !== row.words) wrong.push(`「${row.name}」字數 ${String(got.words)},該是 ${row.words}`);
        if (impl.checks.includes('examples') && JSON.stringify(got.examples) !== JSON.stringify(row.examples)) {
          wrong.push(`「${row.name}」examples ${JSON.stringify(got.examples)},該是 ${JSON.stringify(row.examples)}`);
        }
        if (impl.checks.includes('exampleCount')) {
          const n = got.exampleCount ?? got.examples?.length;
          if (n !== row.examples.length) wrong.push(`「${row.name}」example 個數 ${String(n)},該是 ${row.examples.length}`);
        }
        if (impl.checks.includes('body') && got.body !== undefined) {
          if (got.body !== got.body.trim()) wrong.push(`「${row.name}」body 沒 trim`);
          if (row.strippedBody !== undefined && got.body !== row.strippedBody) {
            wrong.push(`「${row.name}」body ${JSON.stringify(got.body)},該是 ${JSON.stringify(row.strippedBody)}`);
          }
        }
      }
      expect(ran, '這份實作跑過的列數要等於向量檔列數(不准少跑)').toBe(rows.length);
      expect(ran).toBe(EXPECTED_ROWS);
      expect(wrong, `${impl.name} 算錯 ${wrong.length} 列:\n${wrong.join('\n')}`).toEqual([]);
    });
  }

  it('stripExampleFences 與 countBodyWords 彼此一致:countBodyWords(t) = countWords(stripExampleFences(t).body),每一列都是', async () => {
    const m = await load('packages/core/src/schema/index.ts');
    const strip = fn<(t: string) => { body: string; examples: string[] }>(m, 'stripExampleFences', '@core/schema/index.js');
    const count = fn<(t: string) => number>(m, 'countBodyWords', '@core/schema/index.js');
    const countWords = fn<(t: string) => number>(m, 'countWords', '@core/schema/index.js');
    const parse = fn<(raw: string) => { body: string; examples: string[] }>(m, 'parseCardText', '@core/schema/index.js');
    let ran = 0;
    for (const row of rows) {
      const body = bodyOf(row);
      const s = strip(body);
      expect(count(body), row.name).toBe(countWords(s.body));
      // 同一條路:跟 parseCardText 比 body 與 examples(body 有 trim、examples 有 trim 與順序)
      const p = parse(asCard(body));
      expect(s.body, `${row.name} 的 body`).toBe(p.body);
      expect(s.examples, `${row.name} 的 examples`).toEqual(p.examples);
      ran += 1;
    }
    expect(ran).toBe(EXPECTED_ROWS);
  });
});

// ================================================================ 周邊護欄

describe('T52 周邊護欄', () => {
  it('lint 的 frontmatter 行為不變:沒加引號的 created 還是 gray-matter 給的 Date(不是字串);01 的 parseCardText 才轉字串', async () => {
    const lintMod = await load('packages/core/src/lint/index.ts');
    const schemaMod = await load('packages/core/src/schema/index.ts');
    const raw = '---\nid: sec-0001\ncategory: security\ntitle: t\nlevel: 0\nsource: llm\ncreated: 2026-09-01\n---\n\nbody\n';
    const lintFm = fn<(r: string) => { frontmatter: { created: unknown } }>(lintMod, 'parseCard', '@core/lint')(raw).frontmatter;
    expect(lintFm.created).toBeInstanceOf(Date);
    const schemaFm = fn<(r: string) => { frontmatter: { created: unknown } }>(schemaMod, 'parseCardText', '@core/schema')(raw).frontmatter;
    expect(schemaFm.created).toBe('2026-09-01');
  });

  it('教學卡 stub 的每張卡 body 都在 100 字以內(從 apps/teach-card/src/stubs/fixture-data.test.ts 搬來:那條原本用 ui-shared 的 wordCount,D1 = A 把它刪了;這裡走 validateCard 用的那條路)', async () => {
    const stubs = await load('apps/teach-card/src/stubs/fixture-data.ts');
    const schema = await load('packages/core/src/schema/index.ts');
    const order = stubs['ORDER'] as string[];
    const fs = fn<() => { read(p: string): Promise<string> }>(stubs, 'createFixtureFs', 'teach-card stubs')();
    const cardPath = fn<(id: string) => string>(stubs, 'cardPath', 'teach-card stubs');
    const parseCardText = fn<(raw: string) => { body: string }>(schema, 'parseCardText', '@core/schema');
    const countWords = fn<(t: string) => number>(schema, 'countWords', '@core/schema');
    expect(order.length, 'stub 有卡').toBeGreaterThan(0);
    for (const id of order) {
      const n = countWords(parseCardText(await fs.read(cardPath(id))).body);
      expect(n, `${id} 的 body 字數`).toBeLessThanOrEqual(100);
    }
  });

  it('ui-shared 的 wordCount 已刪(D1 = A):檔案不在、index.ts 不再 export', () => {
    expect(existsSync(join(ROOT, 'packages/ui-shared/src/word-count.ts')), 'packages/ui-shared/src/word-count.ts 要刪掉').toBe(false);
    expect(readFileSync(join(ROOT, 'packages/ui-shared/src/index.ts'), 'utf8')).not.toMatch(/word-count/);
  });
});

// ================================================================ 3. 指紋掃描

/**
 * 只認「讀」§2 規則的寫法(顧問 2026-10-27):
 *   script:   \p{Script=Han} / \p{sc=Han} 這類(Han、Hiragana、Katakana、Hangul;Rust 的 \p{Han} 也算)
 *   codepoint:CJK 碼位範圍的起訖(0x4e00、\u4e00、U+4E00 這類,或正則裡以 CJK 字元當範圍端點的 [一-龥])
 *   fence-regex:regex 字面值 / new RegExp(...) 的引數裡,同時有反引號的量詞(`{3,} 或連續三個反引號)與 example
 *   example-literal(T57,顧問 2026-10-27):字串字面值 'example' 當比較的一邊(===、!==、==、!=、switch 的 case),
 *                   或當 startsWith、includes、indexOf、match、test 的引數。T57 起只有 packages/contracts/src/card-markdown.ts 可以有。
 * 不算:純字串拼接(寫卡片)、斷言或 fixture 裡的字串、註解。
 */
export interface Hit {
  kind: 'script' | 'codepoint' | 'fence-regex' | 'example-literal';
  line: number;
  text: string;
}

const CJK_STARTS_END = ['4e00', '9fff', '3400', '4dbf', '20000', '2a6df', '3040', '309f', '30a0', '30ff', 'ac00', 'd7a3', 'f900', 'faff', '1100', '11ff', '3130', '318f'];
const CP_NUMERIC = new Set(CJK_STARTS_END.map((h) => parseInt(h, 16)));
const SCRIPT_RE = /\\{1,2}p\{\s*(?:Script|sc|Script_Extensions|scx)\s*=\s*(?:Han|Hani|Hiragana|Hira|Katakana|Kana|Hangul|Hang)\s*\}/i;
const RUST_SCRIPT_RE = /\\p\{\s*(?:Han|Hiragana|Katakana|Hangul)\s*\}/;
const ESC_CP_RE = new RegExp(`\\\\u\\{?(?:${CJK_STARTS_END.join('|')})\\}?`, 'i');
const UPLUS_RE = new RegExp(`U\\+(?:${CJK_STARTS_END.join('|')})\\b`, 'i');
const CJK_CHARS = '\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\u1100-\u11ff\u3130-\u318f';
const LITERAL_RANGE_RE = new RegExp(`[${CJK_CHARS}]-[${CJK_CHARS}]`);

/** \x60 \u0060 \u{60} 換回反引號,才看得出量詞 */
const unescapeTicks = (s: string): string => s.replace(/\\x60|\\u0060|\\u\{0*60\}/gi, '`');
/** 字串字面值(或沒有代換的樣板字串),內容恰好是 example */
const isExampleString = (n: ts.Node): boolean =>
  (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === 'example';
const COMPARE_OPS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const EXAMPLE_ARG_METHODS = new Set(['startsWith', 'includes', 'indexOf', 'match', 'test']);
const hasTickQuantifier = (s: string): boolean => /`{3,}|`\{\s*\d/.test(s);
const fenceRegexText = (s: string): boolean => {
  const u = unescapeTicks(s);
  return hasTickQuantifier(u) && /example/.test(u);
};

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** TypeScript / JavaScript:用語法樹,所以註解與一般字串不會被當成讀規則的寫法 */
export function scanScript(text: string, fileName = 'x.ts'): Hit[] {
  const kind = /\.(?:m|c)?js$/.test(fileName) ? ts.ScriptKind.JS : /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, kind);
  const hits: Hit[] = [];
  const push = (k: Hit['kind'], node: ts.Node): void => {
    hits.push({ kind: k, line: lineOf(sf, node), text: node.getText(sf).slice(0, 80) });
  };
  /** 一段 regex 來源文字(字面值本身,或 RegExp 引數裡所有字串片段接起來) */
  const checkPattern = (src: string, node: ts.Node): void => {
    if (SCRIPT_RE.test(src)) push('script', node);
    if (ESC_CP_RE.test(src) || LITERAL_RANGE_RE.test(src)) push('codepoint', node);
    if (fenceRegexText(src)) push('fence-regex', node);
  };
  const stringParts = (node: ts.Node): string => {
    const out: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.getText(sf));
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.getText(sf));
      ts.forEachChild(n, walk);
    };
    walk(node);
    return out.join('');
  };
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      checkPattern(node.getText(sf), node);
    } else if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
      const first = node.arguments?.[0];
      if (first) checkPattern(stringParts(first), node);
    } else if (ts.isBinaryExpression(node) && COMPARE_OPS.has(node.operatorToken.kind) && (isExampleString(node.left) || isExampleString(node.right))) {
      push('example-literal', node);
    } else if (ts.isCaseClause(node) && isExampleString(node.expression)) {
      push('example-literal', node);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      EXAMPLE_ARG_METHODS.has(node.expression.name.text) &&
      node.arguments.some(isExampleString)
    ) {
      push('example-literal', node);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // 一般字串裡的 Script 屬性寫法(pattern 先放進變數再 new RegExp)與 U+4E00 碼位字樣
      const raw = node.getText(sf);
      if (SCRIPT_RE.test(raw)) push('script', node);
      if (UPLUS_RE.test(raw)) push('codepoint', node);
    } else if (ts.isNumericLiteral(node)) {
      const t = node.getText(sf).replace(/_/g, '');
      if (/^0x/i.test(t) && CP_NUMERIC.has(parseInt(t, 16))) push('codepoint', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** 其他語言(Rust、svelte):沒有語法樹,先拿掉註解再用文字找。只認 regex crate 的 \p{Han} 類、碼位、反引號量詞 + example */
export function scanText(text: string): Hit[] {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  const hits: Hit[] = [];
  stripped.split('\n').forEach((line, i) => {
    const u = unescapeTicks(line);
    if (SCRIPT_RE.test(line) || RUST_SCRIPT_RE.test(line)) hits.push({ kind: 'script', line: i + 1, text: line.trim().slice(0, 80) });
    if (ESC_CP_RE.test(line) || UPLUS_RE.test(line) || LITERAL_RANGE_RE.test(line) || /\b0x(?:4e00|9fff|3400|4dbf|20000|3040|30a0|ac00|d7a3|f900|1100|3130)\b/i.test(line)) {
      hits.push({ kind: 'codepoint', line: i + 1, text: line.trim().slice(0, 80) });
    }
    if (/`\{\s*\d/.test(u) && /example/.test(u)) hits.push({ kind: 'fence-regex', line: i + 1, text: line.trim().slice(0, 80) });
    if (/(?:===|!==|==|!=)\s*['"]example['"]|['"]example['"]\s*(?:===|!==|==|!=)|\bcase\s+['"]example['"]|\.(?:startsWith|includes|indexOf|match|test)\(\s*['"]example['"]\s*\)/.test(line)) {
      hits.push({ kind: 'example-literal', line: i + 1, text: line.trim().slice(0, 80) });
    }
  });
  return hits;
}

const SCAN_DIRS = ['packages', 'apps', 'scripts', 'features/steps', 'features/support'];
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '.svelte-kit', '.git', 'coverage']);
const SCRIPT_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEXT_EXT = /\.(?:svelte|rs)$/;
const isTestFile = (rel: string): boolean =>
  /\.test\.(?:ts|tsx|mts|js|mjs)$/.test(rel) || /test-support\.ts$/.test(rel) || /(?:^|\/)tests?\//.test(rel) || /(?:^|\/)tests\.rs$/.test(rel);

function walk(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else if (SCRIPT_EXT.test(name) || TEXT_EXT.test(name)) out.push(relative(root, full).split('\\').join('/'));
  }
}

export function scanFile(root: string, rel: string): Hit[] {
  const text = readFileSync(join(root, rel), 'utf8');
  return SCRIPT_EXT.test(rel) ? scanScript(text, rel) : scanText(text);
}

/**
 * 登記的實作:只有這兩個檔可以讀 §2 規則。T57 起:example 的判斷在 contracts 的 card-markdown.ts(比字串 'example'),
 * CJK 與字母數字在 core 的 word-count.ts(Script)。core 的 example-fence.ts 與畫面的 example-fence.ts 一個指紋都不准有。
 */
const REGISTERED_HOMES = ['packages/contracts/src/card-markdown.ts', 'packages/core/src/schema/word-count.ts'];

/**
 * 例外表:命中指紋、但不是在「讀」§2 規則的檔。每條附理由。
 * 在 main 888288d 上實際掃出來的(見 commit 說明);掃出來沒有別的就是空的。
 */
const EXCEPTIONS: Record<string, string> = {};

export function violations(root: string, homes: string[] = REGISTERED_HOMES, exceptions: Record<string, string> = EXCEPTIONS): { file: string; hits: Hit[] }[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(root, d), root, files);
  const out: { file: string; hits: Hit[] }[] = [];
  for (const rel of files) {
    if (isTestFile(rel) || homes.includes(rel) || rel in exceptions) continue;
    const hits = scanFile(root, rel);
    if (hits.length > 0) out.push({ file: rel, hits });
  }
  return out;
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function tmpTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-t52-scan-'));
  tmpDirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text, 'utf8');
  }
  return root;
}
const T3 = '`'.repeat(3);

describe('T52 指紋掃描:真的 repo——沒登記的檔不能讀 §2 規則', () => {
  it('掃到的檔數合理(掃描器沒壞成什麼都掃不到)', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(ROOT, d), ROOT, files);
    const source = files.filter((f) => !isTestFile(f));
    expect(source.length, `非測試原始碼檔數 ${source.length}`).toBeGreaterThan(200);
    expect(source.some((f) => f.endsWith('.rs')), '有掃到 Rust').toBe(true);
    expect(source.some((f) => f.startsWith('features/steps/')), '有掃到 features/steps').toBe(true);
  });

  it('登記的實作檔都在,而且掃得到它們(掃描器認得出真的在讀規則的檔)', () => {
    for (const rel of REGISTERED_HOMES) {
      expect(existsSync(join(ROOT, rel)), `${rel} 要存在`).toBe(true);
      expect(scanFile(ROOT, rel).length, `${rel} 應該被指紋掃到(它就是讀規則的那份)`).toBeGreaterThan(0);
    }
    const kinds = new Set(REGISTERED_HOMES.flatMap((rel) => scanFile(ROOT, rel).map((h) => h.kind)));
    expect([...kinds].sort()).toEqual(['example-literal', 'script']);
  });

  it('沒登記、也不在例外表的檔,一個讀 §2 規則的指紋都沒有', () => {
    const bad = violations(ROOT);
    const msg = bad.map((v) => `${v.file}:${v.hits.map((h) => `${h.line} ${h.kind}`).join(',')}`).join('\n');
    expect(bad.map((v) => v.file), `這些檔留著自己的 §2 規則(圍欄 regex 或 CJK 判斷):\n${msg}`).toEqual([]);
  });

  it('例外表的每一條都附理由,而且指到的檔真的存在、真的有被掃到(沒有過期的例外)', () => {
    for (const [rel, why] of Object.entries(EXCEPTIONS)) {
      expect(why.length, `${rel} 的例外要附理由`).toBeGreaterThan(10);
      expect(existsSync(join(ROOT, rel)), `${rel} 不存在,例外過期了`).toBe(true);
      expect(scanFile(ROOT, rel).length, `${rel} 沒有指紋,不需要例外`).toBeGreaterThan(0);
    }
  });

  it('掃描器自己的護欄:寫卡片的字串拼接、斷言用的字串、註解,一個都不能被抓(列名的幾處)', () => {
    const must = [
      'features/steps/review-cli-phase3.steps.ts',
      'features/steps/teach-card-phase4.steps.ts',
      'scripts/check-doc-links.ts',
      'packages/core/src/ingest/ingest.ts',
      'packages/core/src/ingest/children.ts',
      'packages/core/src/ingest/deps.ts',
      'packages/core/src/schema/example-fence.ts',
      'packages/ui-shared/src/example-fence.ts',
    ];
    for (const rel of must) {
      expect(existsSync(join(ROOT, rel)), `${rel} 要存在(護欄的對象)`).toBe(true);
      expect(scanFile(ROOT, rel), `${rel} 不是在讀規則,不能被指紋抓到`).toEqual([]);
    }
  });
});

describe('T52 指紋掃描:掃描器本身(合成的檔)', () => {
  const PLACE = 'packages/core/src/somewhere/copy.ts';
  const run = (rel: string, text: string, homes = REGISTERED_HOMES, ex: Record<string, string> = {}): string[] =>
    violations(tmpTree({ [rel]: text }), homes, ex).map((v) => v.file);

  it('沒登記的檔加 \\p{Script=Han} → 紅(各種寫法)', () => {
    for (const src of [
      'export const R = /\\p{Script=Han}/u;',
      'export const R = /\\p{sc=Hiragana}/u;',
      "export const R = new RegExp('\\\\p{Script=Katakana}', 'u');",
      "const P = '\\\\p{Script=Hangul}'; export const R = new RegExp(P, 'u');",
      'export const R = /[\\p{Script=Han}\\p{Script=Hiragana}]/u;',
    ]) expect(run(PLACE, src), src).toEqual([PLACE]);
  });

  it('沒登記的檔加含反引號量詞與 example 的 regex 字面值 → 紅(各種寫法)', () => {
    for (const src of [
      'export const R = /(`{3,})example[ \\t]*\\n/g;',
      `export const R = /${T3}example\\n([\\s\\S]*?)${T3}/g;`,
      "export const R = new RegExp('(`{3,})example\\\\n');",
      "export const R = new RegExp('(' + '`{3,}' + ')example');",
      'export const R = new RegExp(`(\\`{3})example`);',
      "export const R = RegExp('(\\\\x60{3,})example');",
    ]) expect(run(PLACE, src), src).toEqual([PLACE]);
  });

  it('沒登記的檔加 CJK 碼位範圍 → 紅(0x4e00、\\u4e00 範圍、U+4E00、以 CJK 字元當端點的範圍)', () => {
    for (const src of [
      'export const f = (cp: number) => cp >= 0x4e00 && cp <= 0x9fff;',
      'export const R = /[\\u4e00-\\u9fff]/;',
      "export const R = new RegExp('[\\\\u3400-\\\\u4dbf]');",
      "// no\nexport const note = 'range starts at U+4E00';",
      'export const R = /[\u4e00-\u9fff]/;',
    ]) expect(run(PLACE, src), src).toEqual([PLACE]);
  });

  it('沒登記的檔拿字串 example 去比 → 紅(各種寫法;core 與畫面也一樣)', () => {
    for (const src of [
      "export const f = (info: string) => info.trim() === 'example';",
      "export const f = (info: string) => info !== 'example';",
      'export const f = (info: string) => info == "example";',
      "export const f = (info: string) => 'example' === info;",
      'export const f = (info: string) => info != `example`;',
      "export function f(info: string) { switch (info) { case 'example': return 1; default: return 0; } }",
      "export const f = (info: string) => info.startsWith('example');",
      "export const f = (info: string) => info.includes('example');",
      "export const f = (info: string) => info.indexOf('example') === 0;",
      "export const f = (info: string) => info.match('example');",
      "export const f = (re: RegExp) => re.test('example');",
    ]) {
      expect(run(PLACE, src), src).toEqual([PLACE]);
      expect(run('packages/core/src/schema/example-fence.ts', src), `core ${src}`).toEqual(['packages/core/src/schema/example-fence.ts']);
      expect(run('packages/ui-shared/src/example-fence.ts', src), `畫面 ${src}`).toEqual(['packages/ui-shared/src/example-fence.ts']);
    }
  });

  it('沒登記的檔仍然不能有圍欄 regex(登記的檔裡也不再有,所以任何命中都紅)', () => {
    const src = 'export const F = /(`{3,})example/g;';
    expect(run('packages/core/src/schema/example-fence.ts', src)).toEqual(['packages/core/src/schema/example-fence.ts']);
    expect(run('packages/ui-shared/src/example-fence.ts', src)).toEqual(['packages/ui-shared/src/example-fence.ts']);
  });

  it('同樣的內容放在登記的檔、或例外表的檔 → 不紅', () => {
    const src = "export const R = /\\p{Script=Han}/u; export const F = /(`{3,})example/g; export const E = (i: string) => i === 'example';";
    expect(run(REGISTERED_HOMES[0]!, src)).toEqual([]);
    expect(run(PLACE, src, REGISTERED_HOMES, { [PLACE]: '測試用的例外,理由寫在這裡' })).toEqual([]);
  });

  it('不是「讀」的寫法都不紅:註解、寫卡片的字串拼接、斷言用的字串、沒有 example 的反引號 regex、沒有反引號量詞的 example regex', () => {
    for (const src of [
      `// 圍欄是 ${T3}example 與 \\p{Script=Han},這裡只是註解\nexport const x = 1;`,
      `/* ${T3}example\n  0x4e00 */\nexport const x = 1;`,
      `export const card = ['${T3}example', 'x', '${T3}'].join('\\n');`,
      'export const card = `' + '\\`\\`\\`example\\n${body}\\n\\`\\`\\`' + '`;',
      `expect(out).not.toContain('${T3}example');`,
      "export const re = /(`{3,})js/g;",
      'export const re = /^example$/;',
      "export const a = ['example', 'examples'];",
      "export const o = { kind: 'example' };",
      "export const f = (info: string) => info === 'examples';",
      "export const f = (info: string) => info.startsWith('example-x');",
      "export const f = (info: string) => info === `example${info}`;",
      "export const f = (x: string) => `${x}` + 'example';",
      "// info === 'example' 只是註解\nexport const x = 1;",
      "export const s = 'plain text with 4e00 but no marker';",
      'export const n = 0x41;',
    ]) expect(run(PLACE, src), src).toEqual([]);
  });

  it('測試檔不掃(*.test.ts、test-support、tests/ 目錄)', () => {
    const src = 'export const R = /\\p{Script=Han}/u;';
    for (const rel of ['packages/core/src/x/a.test.ts', 'packages/core/src/x/test-support.ts', 'packages/core/src/x/tests/a.ts']) expect(run(rel, src), rel).toEqual([]);
  });

  it('Rust 與 svelte 也掃:regex crate 的 \\p{Han}、碼位、反引號量詞 + example', () => {
    expect(run('apps/desktop/src-tauri/src/cnt.rs', 'let re = Regex::new(r"\\p{Han}").unwrap();')).toEqual(['apps/desktop/src-tauri/src/cnt.rs']);
    expect(run('apps/desktop/src-tauri/src/cnt.rs', 'let re = Regex::new(r"(`{3,})example").unwrap();')).toEqual(['apps/desktop/src-tauri/src/cnt.rs']);
    expect(run('apps/desktop/src-tauri/src/cnt.rs', 'let ok = c >= 0x4E00 && c <= 0x9FFF;')).toEqual(['apps/desktop/src-tauri/src/cnt.rs']);
    expect(run('apps/desktop/src-tauri/src/cnt.rs', 'let ok = info == "example";')).toEqual(['apps/desktop/src-tauri/src/cnt.rs']);
    expect(run('apps/desktop/src/App.svelte', "<script>const ok = info === 'example';</script>")).toEqual(['apps/desktop/src/App.svelte']);
    expect(run('apps/desktop/src-tauri/src/cnt.rs', '// \\p{Han} 只是註解\nlet card = "```example\\n";')).toEqual([]);
  });
});
