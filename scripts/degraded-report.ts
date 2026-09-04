/**
 * 退化路徑見證器的彙總(ADR-044)。**報告模式,不執法**:退出碼永遠是 0,
 * 除非彙總本身壞掉(掃到 0 個測試、找不到輸入)。
 *
 * 用法:
 *   npx tsx scripts/degraded-report.ts                 # 跑一次 vitest(全部)再彙總
 *   npx tsx scripts/degraded-report.ts -- <vitest 參數>  # 例:-- packages/core/src/llm/router-gateway.test.ts
 *   npx tsx scripts/degraded-report.ts --in <dir>      # 不跑 vitest,彙總既有的 <dir>/*.jsonl
 *   npx tsx scripts/degraded-report.ts --out <path.md> # 報告落點,預設 reports/degraded/<sha>.md
 *
 * 流程:設 `DEGRADED_WITNESS_DIR=reports/degraded/.raw/<時戳>/` 跑 vitest
 * (`scripts/degraded-witness.setup.ts` 會在那裡一個 worker 寫一個 JSONL),再讀回來彙總。
 * 報告旁邊同時寫一份 `<sha>.json`,只有數字,給之後「未標記數只准降」比對用。
 *
 * <sha> 是 `git rev-parse --short HEAD`;工作樹髒的時候後綴 `-dirty`,免得一份量到一半的
 * 報告被當成某個 commit 的正式基準。
 *
 * 報告裡「檔案:行」不是寫死的:訊號目錄(packages/contracts/src/witness.ts)只有名字,
 * 這支腳本 grep 原始碼裡的 `witness('…')` / `witnessed('…'` 反查實際位置,所以行號不會漂。
 * 目錄裡有、程式裡沒有的訊號會被標成「⚠ 沒有呼叫點」——那是目錄漂掉了,不是很乾淨。
 *
 * 跟 boundaries 一樣,測試檔的擁有者從 scripts/boundaries.owners.json 查;
 * 「測試的擁有者 ≠ 訊號的擁有者」那張表是這份報告最值得看的地方——那就是
 * 「測試自以為在測 A,卻走了 B 的退化分支」。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ROOT as REPO_ROOT } from './_root.js';
import {
  DEGRADED_SIGNALS,
  OUTSIDE_ANY_TEST,
  isDegradedSignal,
  type DegradedKind,
  type DegradedSignal,
  type WitnessRecord,
} from '../packages/contracts/src/witness.js';

// ────────────────────────────────────────────────────────────── 掃描過但沒計數的分支
/**
 * grep `catch` / `??` / `fallback` / `provisional` / `default` 掃到、讀過、**判定不計數**的
 * 分支,連同理由。放在這裡而不是只放報告裡,是為了讓下一次掃描的人知道哪些已經看過;
 * `snippet` 用來在原始碼裡定位(找不到就標「已搬走」),行號一樣不寫死。
 */
export interface NotInstrumented {
  file: string;
  snippet: string;
  reason: string;
}

export const NOT_INSTRUMENTED: readonly NotInstrumented[] = [
  // 模板檔(v1.3.4,`sync-gates.sh` 升版,不手改)——要計數得先進模板 1.4.0
  { file: 'scripts/_root.ts', snippet: 'return process.cwd();', reason: '模板檔不手改:找不到 git root 就當 cwd,值得計數,回流模板 1.4.0 時一起做' },
  { file: 'scripts/check-doc-links.ts', snippet: 'return {};', reason: '模板檔不手改:skip 設定讀不到就當空設定' },
  { file: 'scripts/check-doc-links.ts', snippet: 'return withoutAnchor;', reason: '模板檔不手改:錨點解析失敗就當沒錨點' },
  { file: 'scripts/check-gherkin-dup.ts', snippet: 'return { valid: [], invalid: [] };', reason: '模板檔不手改:.feature 讀不到就當空清單' },
  { file: 'scripts/check-phase-coverage.ts', snippet: 'return undefined;', reason: '模板檔不手改:FEATURE.md 讀不到就當沒有 phase 表' },
  // 我們自己的 scripts,但分支的方向是保守的,不是「看起來正常」
  { file: 'scripts/mutate.ts', snippet: "return errnoCode(err) !== 'ESRCH';", reason: '鎖的持有者查不到時當「還活著」——方向是保守(不搶鎖),不是退化' },
  // 設定預設值:沒有失敗,只是沒設
  { file: 'packages/core/src/llm/adapters/gateway.ts', snippet: 'baseUrl: env.GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL', reason: '純設定預設值,沒有失敗發生' },
  { file: 'packages/core/src/llm/adapters/gateway.ts', snippet: 'model: env.LLM_LOCAL_MODEL ?? DEFAULT_LOCAL_MODEL', reason: '純設定預設值,沒有失敗發生' },
  { file: 'packages/core/src/llm/adapters/gateway.ts', snippet: 'function resolveTtlMs', reason: '回應沒帶過期時間就用 50 分鐘——不改變路徑,只影響多久重換 token' },
  { file: 'packages/core/src/llm/adapters/gateway.ts', snippet: 'async function readJson', reason: 'parse 不動回 undefined,但每個呼叫端都檢查了:token() 丟錯、probe() 走 bad-body 訊號,不會靜默' },
  { file: 'packages/core/src/llm/spend.ts', snippet: "if (raw === undefined || raw.trim() === '') return fallback;", reason: '沒設環境變數用預設值是設定,不是失敗;有設但不合法那一行才計數(llm.spend.env-invalid-default)' },
  { file: 'packages/core/src/llm/router.ts', snippet: 'if (!path) return () => {};', reason: '沒給 logPath 就不寫 log:不改變執行路徑,只是少了副作用。測試斷言 log 內容的話會自己紅' },
  { file: 'packages/core/src/llm/router-impl.ts', snippet: 'this.onlineProbeTtlMs = opts.onlineProbeTtlMs ?? 60_000;', reason: '純設定預設值' },
  // 失敗有被明確回報,不是「看起來正常」
  { file: 'packages/core/src/ingest/ingest.ts', snippet: "return fail('ingest 需要雲端模型", reason: 'CloudRequiredError 轉成明確的失敗結果與非 0 退出碼,不是靜默' },
  { file: 'packages/core/src/ingest/deps.ts', snippet: 'throw new GraphFileCorruptError(', reason: '損壞的圖檔往外丟(ADR-041),不是靜默' },
  { file: 'packages/core/src/ingest/questions.ts', snippet: 'fill: (candidate.fill ?? []) as FillQuestion[],', reason: '缺 fill/apply 補空陣列之後緊接著 validateQuestionFile(),數量不對會丟錯,不會靜默' },
  { file: 'packages/core/src/grading/grade-apply.ts', snippet: 'return null;', reason: 'parseApplyVerdict 回 null 是給呼叫端判斷用的訊號;呼叫端的兩個分支各自計數(grading.apply.*)' },
  { file: 'packages/core/src/prompt-quality/structural-checks.ts', snippet: "return [{ kind: 'invalid-json'", reason: 'parse 不動變成一條 issue 回報出去,是明確的失敗紀錄' },
  // 清理用的 catch:吞的是清理自己的錯,不產生任何值(ADR-040)
  { file: 'packages/core/src/ingest/state.ts', snippet: 'rmSync(tmp, { force: true });', reason: '清理暫存檔失敗不遮蔽原本的錯誤(ADR-040),不產生值' },
  { file: 'packages/core/src/schema/atomic-write.ts', snippet: 'unlinkSync(tmp);', reason: '同上,清理用' },
  { file: 'packages/core/src/lint/atomic-write.ts', snippet: 'ops.unlinkSync(tmp);', reason: '同上,清理用' },
  // 形狀補齊:索引越界或缺欄位補空值,不是失敗處理
  { file: 'packages/core/src/grading/grade-fill.ts', snippet: "rawAnswers[i] ?? ''", reason: '作答數少於空格數時補空字串,下一層會判「沒有作答」,是形狀補齊' },
  { file: 'packages/core/src/ingest/generate-cards.ts', snippet: 'examples: regenerated.examples ?? current.examples', reason: 'regenerate 回應沒帶 examples 就沿用舊的——形狀補齊;regenerate 本身有計數(ingest.cards.regenerate-retry)' },
  { file: 'packages/core/src/ingest/init.ts', snippet: 'as CategoryConfig[] | null) ?? []', reason: '空的 categories.yaml parse 成 null 補空陣列,形狀補齊' },
  { file: 'packages/core/src/lint/scan.ts', snippet: "card: data.card ?? ''", reason: '考題檔缺 card 欄位補空字串,後面的 lint 檢查會回報' },
  { file: 'packages/core/src/scheduler/select.ts', snippet: "ctx.startDate ?? '2026-01-01'", reason: '模擬工具的起始日預設值,不是產品路徑' },
  // Wave 0 stub(apps/test-card 沒有 @contracts 的 import 路徑,而且會被正式版取代)
  { file: 'apps/test-card/src/stubs/scheduler.ts', snippet: 'INTERVAL_DAYS[review.stage] ?? 1', reason: 'Wave 0 stub:未知 stage 當 1 天。值得計數,但 apps/ 沒接 @contracts alias,等正式 scheduler 接上再看' },
  { file: 'apps/test-card/src/stubs/scheduler.ts', snippet: "TYPES_BY_STAGE[review.stage] ?? ['apply']", reason: '同上' },
  { file: 'apps/test-card/src/stubs/loader.ts', snippet: 'settings.daily_cap ?? 10', reason: 'Wave 0 stub 的設定預設值' },
  { file: 'apps/test-card/src/session.ts', snippet: "due.types[due.types.length - 1] ?? 'fill'", reason: '索引越界補值,形狀補齊' },
  // 反例:cache-miss 時**丟錯**,不退化——留著當對照
  { file: 'packages/core/src/grading/fake-llm.ts', snippet: 'throw new Error(`FakeLlmRouter: 沒有錄製', reason: '反例:fixture 找不到就丟錯,不退化' },
  { file: 'packages/core/src/ingest/fake-llm.ts', snippet: 'throw new CloudRequiredError(task);', reason: '反例:離線時丟 CLOUD_REQUIRED,不退化' },
  { file: 'features/support/_router-guard.ts', snippet: 'throw new Error(', reason: '反例:Background 該留下 router 卻沒有時丟錯,而不是就地生一個——這支檔案就是為了擋「安靜地變綠」而存在的' },
];

// ────────────────────────────────────────────────────────────── 參數
interface Args {
  inDir?: string;
  out?: string;
  vitestArgs: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { vitestArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--in' || a === '--out') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} 後面要接一個路徑`);
      if (a === '--in') args.inDir = value;
      else args.out = value;
    }
    else if (a === '--') {
      args.vitestArgs = argv.slice(i + 1);
      break;
    } else throw new Error(`不認得的參數:${a}(見檔頭用法)`);
  }
  return args;
}

// ────────────────────────────────────────────────────────────── 原始碼反查
function* walkTs(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'target' || name === 'fixtures') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walkTs(full);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) yield full;
  }
}

const SOURCE_DIRS = ['packages', 'apps', 'scripts', 'features/support'];
/**
 * 呼叫點不只 `witness('x')` 一種寫法:router-gateway.ts 是查表(`FALLBACK_SIGNAL[reason]`),
 * 訊號名出現在表裡而不是呼叫式裡。所以比對的是「原始碼裡任何一個引號包住的目錄訊號名」,
 * 呼叫式與查表都抓得到;目錄裡沒有的名字另外用 `witness('…')` 的形狀抓,型別檢查本來就
 * 不會放行,列出來只是保險。
 */
const WITNESS_CALL = /\bwitness(?:ed)?\(\s*'([^']+)'/g;
const CATALOG_LITERAL = new RegExp(`'(${Object.keys(DEGRADED_SIGNALS).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})'`, 'g');

export interface CallSite {
  file: string;
  line: number;
}

/** 訊號 → 程式裡的呼叫點。跳過訊號目錄本身與 setup / 這支腳本。 */
export function findCallSites(root: string): { sites: Map<string, CallSite[]>; unknown: Array<CallSite & { signal: string }> } {
  const sites = new Map<string, CallSite[]>();
  const unknown: Array<CallSite & { signal: string }> = [];
  const skip = new Set(['packages/contracts/src/witness.ts', 'scripts/degraded-report.ts', 'scripts/degraded-witness.setup.ts']);
  for (const dir of SOURCE_DIRS) {
    for (const full of walkTs(join(root, dir))) {
      const rel = toPosix(relative(root, full));
      if (skip.has(rel)) continue;
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((text, i) => {
        const site = { file: rel, line: i + 1 };
        for (const m of text.matchAll(CATALOG_LITERAL)) {
          const signal = m[1]!;
          if (!isDegradedSignal(signal)) continue;
          const list = sites.get(signal) ?? [];
          list.push(site);
          sites.set(signal, list);
        }
        for (const m of text.matchAll(WITNESS_CALL)) {
          const signal = m[1]!;
          if (!isDegradedSignal(signal)) unknown.push({ ...site, signal });
        }
      });
    }
  }
  return { sites, unknown };
}

function locateSnippet(root: string, item: NotInstrumented): string {
  const full = join(root, item.file);
  if (!existsSync(full)) return `${item.file}:?(檔案不存在)`;
  const lines = readFileSync(full, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(item.snippet));
  return idx === -1 ? `${item.file}:?(片段已搬走:\`${item.snippet}\`)` : `${item.file}:${idx + 1}`;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

// ────────────────────────────────────────────────────────────── 擁有者
type Owners = Array<[string, string]>;

function loadOwners(root: string): Owners {
  const raw = JSON.parse(readFileSync(join(root, 'scripts/boundaries.owners.json'), 'utf8')) as { owners: Owners };
  return raw.owners;
}

function ownerOf(owners: Owners, rel: string): string {
  for (const [prefix, owner] of owners) {
    if (rel === prefix || rel.startsWith(prefix)) return owner;
  }
  return '(unmapped)';
}

// ────────────────────────────────────────────────────────────── 讀 JSONL
export function readRecords(dir: string): WitnessRecord[] {
  const out: WitnessRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      out.push(JSON.parse(line) as WitnessRecord);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────── 彙總
export interface TestRow {
  file: string;
  test: string;
  signals: Map<DegradedSignal, number>;
}

export interface Summary {
  sha: string;
  generatedAt: string;
  command: string;
  testFiles: number;
  tests: number;
  /** 觸發任一訊號的測試數 = 「未標記且觸發」(opt-in 機制尚不存在,所以兩者相等) */
  testsTriggeringAny: number;
  testsTriggeringSwallow: number;
  testsTriggeringDefaultPath: number;
  /** 目前恆為 0:沒有 opt-in 機制 */
  testsOptedIn: number;
  crossOwnerTests: number;
  signalsInCatalog: number;
  signalsWithCallSites: number;
  signalsTriggered: number;
  outsideRows: number;
}

export function aggregate(records: WitnessRecord[]): { rows: TestRow[]; outside: TestRow[] } {
  const byKey = new Map<string, TestRow>();
  const outside: TestRow[] = [];
  for (const r of records) {
    const signals = new Map<DegradedSignal, number>();
    for (const [s, n] of Object.entries(r.signals)) {
      if (isDegradedSignal(s) && typeof n === 'number') signals.set(s, n);
    }
    if (r.test === OUTSIDE_ANY_TEST) {
      outside.push({ file: r.file, test: r.test, signals });
      continue;
    }
    const key = `${r.file}::${r.test}`;
    const row = byKey.get(key);
    if (row === undefined) byKey.set(key, { file: r.file, test: r.test, signals });
    else for (const [s, n] of signals) row.signals.set(s, (row.signals.get(s) ?? 0) + n);
  }
  const rows = [...byKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.test.localeCompare(b.test));
  return { rows, outside };
}

function kindOf(signal: DegradedSignal): DegradedKind {
  return DEGRADED_SIGNALS[signal].kind;
}

function hasKind(row: TestRow, kind: DegradedKind): boolean {
  for (const s of row.signals.keys()) if (kindOf(s) === kind) return true;
  return false;
}

// ────────────────────────────────────────────────────────────── 報告
function md(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export function renderReport(opts: {
  root: string;
  sha: string;
  command: string;
  rows: TestRow[];
  outside: TestRow[];
  sites: Map<string, CallSite[]>;
  unknown: Array<CallSite & { signal: string }>;
}): { markdown: string; summary: Summary } {
  const { root, sha, command, rows, outside, sites, unknown } = opts;
  const owners = loadOwners(root);
  const allSignals = Object.keys(DEGRADED_SIGNALS) as DegradedSignal[];

  // 訊號 → 觸發它的測試
  const testsBySignal = new Map<DegradedSignal, TestRow[]>();
  for (const row of rows) for (const s of row.signals.keys()) testsBySignal.set(s, [...(testsBySignal.get(s) ?? []), row]);

  const triggering = rows.filter((r) => r.signals.size > 0);
  const cross = triggering.flatMap((row) => {
    const testOwner = ownerOf(owners, row.file);
    const foreign = [...row.signals.keys()].filter((s) => DEGRADED_SIGNALS[s].owner !== testOwner);
    return foreign.length === 0 ? [] : [{ row, testOwner, foreign }];
  });

  const files = new Set(rows.map((r) => r.file));
  const summary: Summary = {
    sha,
    generatedAt: new Date().toISOString(),
    command,
    testFiles: files.size,
    tests: rows.length,
    testsTriggeringAny: triggering.length,
    testsTriggeringSwallow: rows.filter((r) => hasKind(r, 'swallow')).length,
    testsTriggeringDefaultPath: rows.filter((r) => hasKind(r, 'default-path')).length,
    testsOptedIn: 0,
    crossOwnerTests: cross.length,
    signalsInCatalog: allSignals.length,
    signalsWithCallSites: allSignals.filter((s) => (sites.get(s) ?? []).length > 0).length,
    signalsTriggered: testsBySignal.size,
    outsideRows: outside.length,
  };

  const L: string[] = [];
  L.push(`# 退化路徑報告 · ${sha}`);
  L.push('');
  L.push(`報告模式,不執法(ADR-044)。這份報告回答一個問題:**哪些測試在跑的時候走進了「失敗了卻回一個看起來正常的值」的分支?** 走進去不代表錯——很多測試就是在測那條分支——但沒有任何一個測試有明說它要走(opt-in 機制尚不存在),所以下面的數字全部是「未標記」。這是基準;之後的指標是**未標記數只准降**。`);
  L.push('');
  L.push('| 欄位 | 值 |');
  L.push('|---|---|');
  L.push(`| 量測的 commit | \`${sha}\` |`);
  L.push(`| 產生時間 | ${summary.generatedAt} |`);
  L.push(`| 指令 | \`${md(command)}\` |`);
  L.push(`| 測試檔 / 測試 | ${summary.testFiles} / ${summary.tests} |`);
  L.push(`| 訊號目錄 / 有呼叫點 / 被觸發 | ${summary.signalsInCatalog} / ${summary.signalsWithCallSites} / ${summary.signalsTriggered} |`);
  L.push('');
  L.push('## 1. 基準數字');
  L.push('');
  L.push('| 指標 | 數字 | 說明 |');
  L.push('|---|---|---|');
  L.push(`| **觸發了退化分支但沒有明示 opt-in 的測試數** | **${summary.testsTriggeringAny} / ${summary.tests}** | 這是基準。opt-in 機制尚不存在,所以 = 所有觸發的測試 |`);
  L.push(`| 其中觸發 \`swallow\`(失敗 → 正常值)的 | ${summary.testsTriggeringSwallow} | 「測試綠但走錯路」最典型的來源 |`);
  L.push(`| 其中觸發 \`default-path\`(沒給 → 自選一條路)的 | ${summary.testsTriggeringDefaultPath} | 不知情地測了 stub / 預設路徑 |`);
  L.push(`| 有 opt-in 標記的測試數 | ${summary.testsOptedIn} | 機制尚不存在 |`);
  L.push(`| **跨擁有者觸發**(測試的資料夾 ≠ 訊號的資料夾) | **${summary.crossOwnerTests}** | 最值得看:測試自以為在測 A,卻走了 B 的退化分支(§4) |`);
  L.push(`| 測試之外觸發的紀錄(beforeAll / 檔案頂層 / afterAll) | ${summary.outsideRows} | 歸不到單一測試,列在 §6 |`);
  L.push('');

  // §2 訊號目錄
  L.push('## 2. 訊號目錄(每處一行:檔案:行 — 訊號名)');
  L.push('');
  L.push('位置是從原始碼 grep `witness(\'…\')` 反查的,不是寫死的。「觸發測試數」是有幾個測試至少觸發一次;「次數」是總共觸發幾次。');
  L.push('');
  L.push('| 位置 | 訊號 | 種類 | 擁有者 | 觸發測試數 | 次數 | 失敗了什麼 → 回了什麼 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of allSignals) {
    const meta = DEGRADED_SIGNALS[s];
    const where = sites.get(s) ?? [];
    const tests = testsBySignal.get(s) ?? [];
    const count = tests.reduce((acc, r) => acc + (r.signals.get(s) ?? 0), 0);
    const loc = where.length === 0 ? '⚠ 沒有呼叫點(目錄漂了)' : where.map((w) => `\`${w.file}:${w.line}\``).join('<br>');
    L.push(`| ${loc} | \`${s}\` | ${meta.kind} | ${meta.owner} | ${tests.length} | ${count} | ${md(meta.summary)} |`);
  }
  if (unknown.length > 0) {
    L.push('');
    L.push('⚠ 程式裡有、目錄裡沒有的訊號(不該過得了 typecheck,列出來以防萬一):');
    for (const u of unknown) L.push(`- \`${u.file}:${u.line}\` — \`${u.signal}\``);
  }
  L.push('');

  // §3 測試 → 訊號
  L.push('## 3. 測試 → 它觸發的退化分支');
  L.push('');
  L.push(`只列有觸發的測試(${triggering.length} 個);沒觸發的 ${rows.length - triggering.length} 個不列。依測試檔分組,括號是「觸發 / 該檔測試數」。`);
  L.push('');
  const byFile = new Map<string, TestRow[]>();
  for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  for (const [file, fileRows] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hit = fileRows.filter((r) => r.signals.size > 0);
    if (hit.length === 0) continue;
    L.push(`### \`${file}\` (${hit.length} / ${fileRows.length}) · 擁有者 ${ownerOf(owners, file)}`);
    L.push('');
    for (const r of hit) {
      const sig = [...r.signals.entries()].map(([s, n]) => (n === 1 ? `\`${s}\`` : `\`${s}\` ×${n}`)).join(', ');
      L.push(`- ${md(r.test)} → ${sig}`);
    }
    L.push('');
  }

  // §4 跨擁有者
  L.push('## 4. 跨擁有者觸發');
  L.push('');
  L.push('測試檔的擁有者(boundaries.owners.json)跟它觸發的訊號的擁有者不同。這些測試走進了**別的模組**的退化分支——它的斷言通常不是為那條分支寫的。');
  L.push('');
  if (cross.length === 0) L.push('(沒有)');
  else {
    L.push('| 測試檔 | 測試 | 測試擁有者 | 走進了誰的退化分支 |');
    L.push('|---|---|---|---|');
    for (const c of cross) {
      const foreign = c.foreign.map((s) => `\`${s}\` (${DEGRADED_SIGNALS[s].owner})`).join('<br>');
      L.push(`| \`${c.row.file}\` | ${md(c.row.test)} | ${c.testOwner} | ${foreign} |`);
    }
  }
  L.push('');

  // §5 訊號 → 測試檔
  L.push('## 5. 訊號 → 哪些測試檔碰到它');
  L.push('');
  L.push('反向索引:改某個退化分支之前,先看哪些測試檔會受影響。');
  L.push('');
  for (const s of allSignals) {
    const tests = testsBySignal.get(s) ?? [];
    if (tests.length === 0) continue;
    const perFile = new Map<string, number>();
    for (const t of tests) perFile.set(t.file, (perFile.get(t.file) ?? 0) + 1);
    L.push(`- \`${s}\`:${[...perFile.entries()].map(([f, n]) => `\`${f}\` (${n})`).join(', ')}`);
  }
  const silent = allSignals.filter((s) => (testsBySignal.get(s) ?? []).length === 0 && (sites.get(s) ?? []).length > 0);
  if (silent.length > 0) {
    L.push('');
    L.push(`**有呼叫點但沒有任何測試觸發**(${silent.length} 個)——這些退化分支沒有測試走過,也就是沒有測試在保護它們:`);
    for (const s of silent) L.push(`- \`${s}\``);
  }
  L.push('');

  // §6 測試之外
  L.push('## 6. 測試之外觸發的');
  L.push('');
  if (outside.length === 0) L.push('(沒有)');
  else {
    for (const o of outside) {
      const sig = [...o.signals.entries()].map(([s, n]) => `\`${s}\` ×${n}`).join(', ');
      L.push(`- \`${o.file}\` — ${sig}`);
    }
  }
  L.push('');

  // §7 掃過但沒計數
  L.push('## 7. 掃描過但沒計數的分支');
  L.push('');
  L.push('grep `catch` / `??` / `fallback` / `provisional` / `default` 掃到、讀過、判定不計數的,連同理由。列出來是為了讓掃描可以被審:覺得哪一條該計數,改 `scripts/degraded-report.ts` 的 `NOT_INSTRUMENTED` 與訊號目錄。');
  L.push('');
  L.push('| 位置 | 理由 |');
  L.push('|---|---|');
  for (const item of NOT_INSTRUMENTED) L.push(`| \`${locateSnippet(root, item)}\` | ${md(item.reason)} |`);
  L.push('');

  // §8 重跑
  L.push('## 8. 怎麼重跑');
  L.push('');
  L.push('```bash');
  L.push('npx tsx scripts/degraded-report.ts                      # 全部測試');
  L.push('npx tsx scripts/degraded-report.ts -- <某個 .test.ts>     # 只跑一個檔(反向驗證用)');
  L.push('npx tsx scripts/degraded-report.ts --in <raw 目錄>       # 只彙總,不跑');
  L.push('```');
  L.push('');
  L.push('觀測點:`packages/contracts/src/witness.ts`(訊號目錄 + `witness()`)。hook:`scripts/degraded-witness.setup.ts`(只在設了 `DEGRADED_WITNESS_DIR` 時做事)。這份報告不改任何測試、不加任何標記;數字旁邊的 `.json` 是給下一次比「有沒有降」用的。');
  L.push('');

  return { markdown: L.join('\n'), summary };
}

// ────────────────────────────────────────────────────────────── main
function gitSha(root: string): string {
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
  return dirty ? `${sha}-dirty` : sha;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = REPO_ROOT;
  const sha = gitSha(root);

  let inDir = args.inDir;
  let command: string;
  if (inDir === undefined) {
    inDir = join(root, 'reports/degraded/.raw', timestamp());
    mkdirSync(inDir, { recursive: true });
    const vitestArgs = ['vitest', 'run', ...args.vitestArgs];
    command = `DEGRADED_WITNESS_DIR=${relative(root, inDir)} npx ${vitestArgs.join(' ')}`;
    console.log(`▶ ${command}`);
    const r = spawnSync('npx', vitestArgs, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DEGRADED_WITNESS_DIR: inDir },
    });
    // vitest 紅了也照樣彙總:報告模式不執法,紅綠是 vitest 自己的事。但要講出來。
    if (r.status !== 0) console.log(`⚠ vitest 退出碼 ${r.status ?? 'null'},報告照樣產生,紅燈請看上面 vitest 的輸出`);
  } else {
    command = `(--in ${relative(root, inDir)})`;
  }

  if (!existsSync(inDir)) throw new Error(`找不到輸入目錄:${inDir}`);
  const records = readRecords(inDir);
  if (records.length === 0) {
    throw new Error(
      `這不是很乾淨,是掃描器壞了:${inDir} 裡沒有任何紀錄。vitest.config.ts 的 setupFiles 有掛 scripts/degraded-witness.setup.ts 嗎?`,
    );
  }

  const { rows, outside } = aggregate(records);
  const { sites, unknown } = findCallSites(root);
  const { markdown, summary } = renderReport({ root, sha, command, rows, outside, sites, unknown });

  const out = args.out ?? join(root, 'reports/degraded', `${sha}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown, 'utf8');
  writeFileSync(out.replace(/\.md$/, '.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`\n退化路徑報告:${relative(root, out)}`);
  console.log(`  測試 ${summary.tests}(${summary.testFiles} 檔)`);
  console.log(`  觸發退化分支且未標記:${summary.testsTriggeringAny}(swallow ${summary.testsTriggeringSwallow},default-path ${summary.testsTriggeringDefaultPath})`);
  console.log(`  跨擁有者:${summary.crossOwnerTests};訊號 目錄/呼叫點/觸發:${summary.signalsInCatalog}/${summary.signalsWithCallSites}/${summary.signalsTriggered}`);
}

const isEntry = process.argv[1] !== undefined && /degraded-report\.(ts|js)$/.test(process.argv[1]);
if (isEntry) main();
