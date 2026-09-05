/**
 * 退化路徑見證器的彙總(ADR-044)。**報告模式**:哪些測試走了退化分支只報告、不執法。
 * 退出碼非 0 只有五種情況:彙總本身壞掉(掃到 0 個測試、找不到輸入)、**登記表過期**、
 * **未標記數超過基準**(這兩條是技術顧問對「152 → 161」的裁定,見下),以及量尺自己腐爛的兩種
 * (ADR-047,見「量尺自己不准腐爛」):**訊號目錄漂移**、**宣稱全套但沒跑完**。
 *
 * 用法:
 *   npx tsx scripts/degraded-report.ts                 # 跑一次 vitest(全部)再彙總
 *   npx tsx scripts/degraded-report.ts -- <vitest 參數>  # 例:-- packages/core/src/llm/router-gateway.test.ts
 *   npx tsx scripts/degraded-report.ts --in <dir>      # 不跑 vitest,彙總既有的 <dir>/*.jsonl
 *   npx tsx scripts/degraded-report.ts --out <path.md> # 報告落點,預設 reports/degraded/<sha>.md
 *   npx tsx scripts/degraded-report.ts --intended <p>  # 登記表,預設 scripts/degraded-intended.json
 *   npx tsx scripts/degraded-report.ts --in <dir> --full # <dir> 是整套跑出來的:比基準、沒跑到的登記算過期
 *
 * 流程:設 `DEGRADED_WITNESS_DIR=reports/degraded/.raw/<時戳>/` 跑 vitest
 * (`scripts/degraded-witness.setup.ts` 會在那裡一個 worker 寫一個 JSONL),再讀回來彙總。
 * 自己起 vitest 時**加**(不是換)`--reporter=json --outputFile=<raw>/vitest.json`,並把退出碼記到
 * `<raw>/vitest-exit.json`:這兩個是 ran_all 的證據(見下)。
 * 報告旁邊同時寫一份 `<sha>.json`,只有數字,給之後「未標記數只准降」比對用。
 *
 * **量尺自己不准腐爛(ADR-047)**。ADR-044 說「哪些測試走了退化分支」只報告不執法;這裡執法的是
 * 量尺本身,兩條:
 *
 *   甲 · **訊號目錄與程式碼的呼叫點必須一一對上。** 「未標記 152」完全建立在目錄是完整的:目錄少一條
 *        = 少一批可能未標記的測試,漂移會往「更好」的方向動。兩個方向都 FAIL:程式碼有、目錄沒有 →
 *        「訊號未登記」;目錄有、程式碼沒有 → 「訊號無呼叫點」。目錄不容忍暫時的空:刪分支的人就是該
 *        改目錄的人,同一個 commit(跟零輸入守門鎖 2、登記過期同形)。
 *   乙 · **「宣稱全套、實際沒跑完」也要擋。** 沒帶 vitest 參數 / `--in … --full` 是**宣稱**;
 *        `ran / collected` 是**驗證**。ran_all 三個條件全滿足才為真:退出碼 ∈ {0, 1}、`vitest.json`
 *        存在可解析且數字一致、見證器的 test-end 紀錄數 === numTotalTests − pending − todo。
 *        基準只在 scope=full **而且** ran_all 量出來為真時才比;不然印「讀不到(全套未跑完:…)」,
 *        **而且不印任何降基準的提示**——提示比 FAIL 危險:FAIL 擋住你,提示誘導你去改基準。
 *        (--in 一份沒有這兩個證據檔的舊目錄 + --full → 讀不到;沒有 --full 就沒有宣稱,不擋。)
 *
 * **「刻意」登記表(`scripts/degraded-intended.json`)**:有些測試存在的目的就是要走某條
 * 退化分支(ADR-044 補的那 9 個就是)。它們登記在表裡,報告把它們從「未標記」扣掉,
 * 變成第四桶「刻意」。這張表不動任何測試碼,也不是 opt-in 標記機制——標記的語意還沒定,
 * 定了之後整張表一次性遷移。四條規則:
 *
 *   1. **每一條都要對應一個真實存在、而且實際觸發該 signal 的測試。** 測試不見了、改名了、
 *      被 skip 了、不再走那條分支了 → FAIL「登記過期」。跟零輸入守門的鎖 2 同形:
 *      登記表不准腐爛。只跑部分測試(`-- <vitest 參數>` 或 `--in`)時,沒跑到的檔案不判
 *      (標「這次沒跑到」),但檔案在磁碟上不存在仍然算過期。
 *   2. **`reason` 必填**,空字串、只有空白都算沒填。
 *   3. **「未標記」基準(`unmarkedBaseline`)只准降,不准升。** 全套跑完未標記數 > 基準 → FAIL;
 *      < 基準 → 提示可以把基準改小。上調基準沒有機械理由擋得住下一次,所以不開這個例。
 *   4. **「刻意」桶不設上限**,但每一次新增都要在 commit 說明裡交代那個測試為什麼是刻意的。
 *      判準:**這個測試存在的目的就是要走那條退化分支**才算;不是為了讓數字好看。
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
/**
 * 預期中的失敗:參數、輸入目錄或 JSONL 的內容有問題。入口只印一句人話(`✗ degraded-report:…`)
 * 加退出碼 1,不噴 stack——stack 是給程式自己的 bug 用的(零輸入守門,ADR-045 鎖 1)。
 */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const USAGE = '用法:npx tsx scripts/degraded-report.ts [--in <dir>] [--out <path.md>] [--intended <path.json>] [--full] [-- <vitest 參數>](詳見檔頭)';

interface Args {
  inDir?: string;
  out?: string;
  intended?: string;
  /** --in 的資料是整套跑出來的:比基準、沒跑到的登記算過期。 */
  full: boolean;
  vitestArgs: string[];
}

/**
 * 這支腳本自己的四個選項(`--in` `--out` `--intended` `--full`)**在 `--` 前後都認**:vitest 沒有這四個
 * 名字,所以不會搶;`--` 之後其餘的東西原封不動交給 vitest。`--` 之前不認得的參數是錯誤。
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = { full: false, vitestArgs: [] };
  let afterDash = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--in' || a === '--out' || a === '--intended') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${a} 後面要接一個路徑,現在沒有。\n${USAGE}`);
      i++;
      if (a === '--in') args.inDir = value;
      else if (a === '--out') args.out = value;
      else args.intended = value;
    } else if (a === '--full') {
      args.full = true;
    } else if (a === '--' && !afterDash) {
      afterDash = true;
    } else if (afterDash) {
      args.vitestArgs.push(a);
    } else throw new UsageError(`不認得的參數:${a}\n${USAGE}`);
  }
  if (args.full && args.inDir === undefined) throw new UsageError(`--full 只跟 --in 一起用(自己跑 vitest 時沒帶參數就是整套)。\n${USAGE}`);
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

/**
 * 甲(ADR-047):目錄與呼叫點一一對上,漂了是 FAIL 不是 ⚠。回傳每一條問題一句話;空陣列就是對上了。
 * 「未登記」的在前(每一處各一行,要修的是每一處),「無呼叫點」的按目錄順序在後。
 * 呼叫點清單是空陣列跟沒有 key 一樣算沒有呼叫點。
 */
export function catalogDriftProblems(found: { sites: Map<string, CallSite[]>; unknown: Array<CallSite & { signal: string }> }): string[] {
  const problems: string[] = [];
  for (const u of found.unknown) problems.push(`訊號未登記:${u.signal} @ ${u.file}:${u.line}`);
  for (const s of Object.keys(DEGRADED_SIGNALS)) {
    if ((found.sites.get(s) ?? []).length === 0) problems.push(`訊號無呼叫點:${s},若該退化分支已刪除,請在同一個 commit 從目錄移除`);
  }
  return problems;
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
/**
 * 一行 JSONL 要長成 WitnessRecord 的樣子才收。回傳值是「哪裡不對」的一句話,對了就 null。
 * 不用 zod:契約那邊的 witness.ts 沒有 schema,這裡的形狀只有三個欄位,手寫比多一個相依便宜。
 */
export function describeRecordProblem(value: unknown): string | null {
  if (Array.isArray(value)) return '是陣列,不是物件(一行一筆 {file, test, signals},不是整檔一個陣列)';
  if (typeof value !== 'object' || value === null) return `是 ${value === null ? 'null' : typeof value},不是物件`;
  const r = value as Record<string, unknown>;
  if (typeof r.file !== 'string') return '缺 file 欄位,或 file 不是字串';
  if (typeof r.test !== 'string') return '缺 test 欄位,或 test 不是字串';
  if (typeof r.signals !== 'object' || r.signals === null || Array.isArray(r.signals)) return '缺 signals 欄位,或 signals 不是物件';
  return null;
}

/** 讀 `<dir>/*.jsonl`。壞的一行丟 UsageError,訊息帶「檔案:行」跟怎麼壞的;整個 dir 讀完才回。 */
export function readRecords(dir: string): WitnessRecord[] {
  const out: WitnessRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const full = join(dir, name);
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (line.trim() === '') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new UsageError(`${full}:${i + 1} 不是合法的 JSON(${err instanceof Error ? err.message : String(err)})。每一行要是一筆 {file, test, signals}`);
      }
      const problem = describeRecordProblem(parsed);
      if (problem !== null) throw new UsageError(`${full}:${i + 1} 的紀錄${problem}`);
      out.push(parsed as WitnessRecord);
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────── 「刻意」登記表
export const DEFAULT_INTENDED_PATH = 'scripts/degraded-intended.json';

export interface IntendedEntry {
  /** 測試檔,repo 相對路徑(跟 JSONL 的 file 同一種寫法)。 */
  file: string;
  /** 完整測試名「describe > describe > it」,跟 vitest 報表與 JSONL 的 test 一樣。 */
  test: string;
  /** 它刻意要走的那條退化分支。 */
  signal: DegradedSignal;
  /** 為什麼這個測試存在的目的就是要走那條分支。必填(規則 2)。 */
  reason: string;
  /** 登記日期 YYYY-MM-DD。 */
  since: string;
}

export interface IntendedRegistry {
  /** 「未標記」的基準,只准降(規則 3)。 */
  unmarkedBaseline: number;
  entries: IntendedEntry[];
}

const SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 一條登記哪裡不對。對了就 null。跟 describeRecordProblem 同一種寫法:不用 zod,
 * 五個欄位手寫比多一個相依便宜,而且訊息可以直接講人話。
 */
export function describeEntryProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '不是物件';
  const e = value as Record<string, unknown>;
  if (typeof e.file !== 'string' || e.file.trim() === '') return '缺 file,或 file 不是非空字串';
  if (typeof e.test !== 'string' || e.test.trim() === '') return '缺 test,或 test 不是非空字串';
  if (typeof e.signal !== 'string') return '缺 signal,或 signal 不是字串';
  if (!isDegradedSignal(e.signal)) return `signal「${e.signal}」不在訊號目錄(packages/contracts/src/witness.ts)裡`;
  if (typeof e.reason !== 'string') return '缺 reason(規則 2:reason 必填)';
  if (e.reason.trim() === '') return 'reason 是空的(規則 2:空字串、只有空白都算沒填)';
  if (typeof e.since !== 'string' || !SINCE_RE.test(e.since)) return 'since 要是 YYYY-MM-DD';
  return null;
}

/** 整張表哪裡不對。對了就 null。 */
export function describeRegistryProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '最外層要是物件 { unmarkedBaseline, entries }';
  const r = value as Record<string, unknown>;
  if (typeof r.unmarkedBaseline !== 'number' || !Number.isInteger(r.unmarkedBaseline) || r.unmarkedBaseline < 0) return 'unmarkedBaseline 要是非負整數';
  if (!Array.isArray(r.entries)) return 'entries 要是陣列';
  const seen = new Set<string>();
  for (let i = 0; i < r.entries.length; i++) {
    const problem = describeEntryProblem(r.entries[i]);
    if (problem !== null) return `entries[${i}] ${problem}`;
    const e = r.entries[i] as IntendedEntry;
    const key = `${e.file}::${e.test}::${e.signal}`;
    if (seen.has(key)) return `entries[${i}] 重複了(同一個檔案、同一個測試、同一個訊號登記兩次)`;
    seen.add(key);
  }
  return null;
}

/** 讀登記表。檔案不存在、不是 JSON、形狀不對都是 UsageError(一句人話 + 退出碼 1)。 */
export function loadIntended(path: string): IntendedRegistry {
  if (!existsSync(path)) throw new UsageError(`找不到登記表:${path}(預設是 ${DEFAULT_INTENDED_PATH};要指到別處用 --intended)`);
  if (statSync(path).isDirectory()) throw new UsageError(`--intended 要指到一個 JSON 檔,這是一個目錄:${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new UsageError(`登記表 ${path} 不是合法的 JSON(${err instanceof Error ? err.message : String(err)})`);
  }
  const problem = describeRegistryProblem(parsed);
  if (problem !== null) throw new UsageError(`登記表 ${path} 的${problem}`);
  return parsed as IntendedRegistry;
}

/**
 * 這次的紀錄涵蓋多少:`full` 是沒帶任何 vitest 參數跑的整套,登記的檔案沒出現就是過期;
 * `partial` 是只跑一部分(`-- <vitest 參數>`)或 `--in` 既有目錄(不知道當初怎麼跑的),
 * 沒出現但磁碟上還在的檔案標「這次沒跑到」,不判。
 */
export type RunScope = 'full' | 'partial';

export type IntendedStatus =
  | { kind: 'ok'; count: number }
  | { kind: 'not-run' }
  | { kind: 'file-missing' }
  | { kind: 'test-missing' }
  | { kind: 'signal-not-triggered'; triggered: DegradedSignal[] };

export interface IntendedCheck {
  entry: IntendedEntry;
  status: IntendedStatus;
}

export function isStale(status: IntendedStatus): boolean {
  return status.kind === 'file-missing' || status.kind === 'test-missing' || status.kind === 'signal-not-triggered';
}

/**
 * 規則 1:登記表每一條對回實際的紀錄。`fileExists` 注入是為了測試不用真的擺檔案。
 * `rows` 是 aggregate() 之後的(同一個測試的多筆已合併)。
 */
export function checkIntended(
  entries: readonly IntendedEntry[],
  rows: readonly TestRow[],
  scope: RunScope,
  fileExists: (rel: string) => boolean,
): IntendedCheck[] {
  const rowsByFile = new Map<string, TestRow[]>();
  for (const r of rows) rowsByFile.set(r.file, [...(rowsByFile.get(r.file) ?? []), r]);
  return entries.map((entry) => {
    const inFile = rowsByFile.get(entry.file);
    if (inFile === undefined) {
      if (scope === 'partial' && fileExists(entry.file)) return { entry, status: { kind: 'not-run' } };
      return { entry, status: { kind: fileExists(entry.file) ? 'test-missing' : 'file-missing' } };
    }
    const row = inFile.find((r) => r.test === entry.test);
    if (row === undefined) return { entry, status: { kind: 'test-missing' } };
    const count = row.signals.get(entry.signal);
    if (count === undefined || count <= 0) return { entry, status: { kind: 'signal-not-triggered', triggered: [...row.signals.keys()] } };
    return { entry, status: { kind: 'ok', count } };
  });
}

/** 一句人話,給報告與終端機用。 */
export function describeStatus(status: IntendedStatus): string {
  switch (status.kind) {
    case 'ok':
      return `✓ 觸發 ${status.count} 次`;
    case 'not-run':
      return '– 這次沒跑到(檔案還在,不判)';
    case 'file-missing':
      return '✗ 登記過期:測試檔已不存在';
    case 'test-missing':
      return '✗ 登記過期:找不到這個測試(改名、刪掉或被 skip)';
    case 'signal-not-triggered':
      return `✗ 登記過期:測試還在,但不再走那條分支(這次觸發的:${status.triggered.length === 0 ? '無' : status.triggered.join(', ')})`;
  }
}

/**
 * 規則 3:「未標記」對基準。回傳 null 是沒事;字串是 FAIL 的理由。
 * `hint` 是「可以降了」的提示,不是失敗。只在 full 才比:部分跑的數字沒意義。
 */
export function compareBaseline(unmarked: number, baseline: number, scope: RunScope): { fail: string | null; hint: string | null } {
  // 這個閘門同時擋**兩件事**,拆開任何一半都會壞:
  //   1. 小跑不比基準(明顯的那半)。
  //   2. 小跑**不印任何「可以把基準降到 N」的建議**(不明顯、但更危險的那半)。
  // 為什麼 (2) 比 (1) 危險:FAIL 會擋住你,**提示會誘導你去改基準**。
  // 而小跑量到的「未標記」天生偏低——極端情況跑一個檔就是 0,而 0 比什麼都低,
  // 在「只准降」這個方向性檢查下是完美合格的。
  // 「當量尺的『好』方向剛好是『資料變少』的方向,資料遺失與進步不可區分。」
  // (來源:nightmare-assault 2026-09-05 的實例——他們的指標被小跑覆寫成 0;
  //  「提示比 FAIL 危險」這個區分是本專案協調者加的,已回饋給他們寫進規格。)
  if (scope !== 'full') return { fail: null, hint: null };
  if (unmarked > baseline) {
    return {
      fail: `未標記 ${unmarked} 超過基準 ${baseline}(多 ${unmarked - baseline})。基準只准降:多出來的測試如果存在的目的就是走那條退化分支,登記進 ${DEFAULT_INTENDED_PATH} 並在 commit 說明交代;不是的話就是新的退化路徑被走到了,去看報告 §3。不要上調基準。`,
      hint: null,
    };
  }
  if (unmarked < baseline) return { fail: null, hint: `未標記 ${unmarked} 低於基準 ${baseline}:可以把 ${DEFAULT_INTENDED_PATH} 的 unmarkedBaseline 降到 ${unmarked}` };
  return { fail: null, hint: null };
}

// ────────────────────────────────────────────────────────────── 乙:ran_all 是量出來的
/** vitest `--reporter=json --outputFile` 寫在 raw 目錄裡的檔名。 */
export const VITEST_JSON = 'vitest.json';
/** 這支腳本自己起 vitest 時記下的退出碼:`{ status, signal }`。 */
export const VITEST_EXIT_JSON = 'vitest-exit.json';

export interface RunCompleteness {
  /** 三個條件全滿足。 */
  ranAll: boolean;
  /** 沒跑完的理由,一句人話,開頭固定是「退出碼 X,收到 N/M」;跑完了是 null。 */
  reason: string | null;
  /** vitest 的退出碼:number;null 是被訊號終止;undefined 是沒有 vitest-exit.json(不是這支腳本跑出來的目錄)。 */
  status: number | null | undefined;
  /** 見證器的 test-end 紀錄數(aggregate 之前、不含 outside)。 */
  ran: number;
  /** vitest 說要跑的:numTotalTests − numPendingTests − numTodoTests;讀不到 vitest.json 就是 null。 */
  collected: number | null;
}

interface VitestJsonCounts {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  success: boolean;
}

/** vitest.json 的形狀哪裡不對。對了就 null。只看 ran_all 用得到的六個欄位。 */
function describeVitestJsonProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '最外層不是物件';
  const v = value as Record<string, unknown>;
  if (typeof v.success !== 'boolean') return '缺 success 欄位(不是 vitest --reporter=json 的形狀)';
  for (const key of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'] as const) {
    if (typeof v[key] !== 'number' || !Number.isInteger(v[key])) return `缺 ${key},或不是整數`;
  }
  return null;
}

/** 「退出碼 X,收到 N/M」——stdout 那句「讀不到(全套未跑完:…)」括號裡的就是這個。 */
export function describeIncomplete(c: Pick<RunCompleteness, 'status' | 'ran' | 'collected'>): string {
  return `退出碼 ${c.status === undefined ? '?' : String(c.status)},收到 ${c.ran}/${c.collected ?? '?'}`;
}

/**
 * 乙:ran_all 三個條件,全部 AND。`ran` 是見證器紀錄數(不含 outside),由呼叫端從 JSONL 數出來。
 *   1. `vitest-exit.json` 在、退出碼 ∈ {0, 1}(1 只是有測試紅,套件跑完了;137 / null 是被 kill)。
 *   2. `vitest.json` 在、是合法 JSON、有 success、numTotalTests === passed + failed + pending + todo。
 *   3. ran === numTotalTests − pending − todo(等號,不是 ≥:多了是見證器重複寫,一樣不算)。
 * 不丟錯:讀不到就是讀不到,理由寫進 reason,由呼叫端決定要不要 FAIL(宣稱全套才 FAIL)。
 */
export function assessRunCompleteness(dir: string, ran: number): RunCompleteness {
  const details: string[] = [];
  let status: number | null | undefined;
  const exitPath = join(dir, VITEST_EXIT_JSON);
  if (!existsSync(exitPath)) {
    status = undefined;
    details.push(`找不到 ${VITEST_EXIT_JSON}(這份目錄不是這支腳本跑出來的,不知道 vitest 怎麼結束的)`);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(exitPath, 'utf8'));
    } catch (err) {
      parsed = undefined;
      details.push(`${VITEST_EXIT_JSON} 不是合法的 JSON(${err instanceof Error ? err.message : String(err)})`);
    }
    const raw = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).status : undefined;
    if (raw === null) {
      status = null;
      details.push(`退出碼 null:vitest 被訊號終止${typeof (parsed as Record<string, unknown>).signal === 'string' ? `(${String((parsed as Record<string, unknown>).signal)})` : ''}`);
    } else if (typeof raw === 'number') {
      status = raw;
      if (raw !== 0 && raw !== 1) details.push(`退出碼 ${raw} 不是 0 或 1:vitest 沒有正常結束(137 是被 kill)`);
    } else {
      status = undefined;
      if (parsed !== undefined) details.push(`${VITEST_EXIT_JSON} 缺 status 欄位`);
    }
  }

  let collected: number | null = null;
  const jsonPath = join(dir, VITEST_JSON);
  if (!existsSync(jsonPath)) {
    details.push(`找不到 ${VITEST_JSON}(vitest 沒寫完就死了,或這份目錄不是這支腳本跑出來的)`);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch (err) {
      parsed = undefined;
      details.push(`${VITEST_JSON} 不是合法的 JSON(寫到一半?${err instanceof Error ? err.message : String(err)})`);
    }
    if (parsed !== undefined) {
      const problem = describeVitestJsonProblem(parsed);
      if (problem !== null) details.push(`${VITEST_JSON} ${problem}`);
      else {
        const counts = parsed as VitestJsonCounts;
        const sum = counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + counts.numTodoTests;
        if (counts.numTotalTests !== sum) {
          details.push(`${VITEST_JSON} 數字不一致:numTotalTests ${counts.numTotalTests} ≠ passed + failed + pending + todo = ${sum}`);
        } else collected = counts.numTotalTests - counts.numPendingTests - counts.numTodoTests;
      }
    }
  }

  if (collected !== null && ran !== collected) {
    details.push(ran < collected ? `見證器紀錄 ${ran} 列少於 vitest 要跑的 ${collected}(半路死掉?)` : `見證器紀錄 ${ran} 列多於 vitest 要跑的 ${collected}(見證器重複寫?)`);
  }

  const ok = (status === 0 || status === 1) && collected !== null && ran === collected && details.length === 0;
  const head = describeIncomplete({ status, ran, collected });
  return { ranAll: ok, reason: ok ? null : `${head};${details.join(';')}`, status, ran, collected };
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
  /** 觸發任一訊號的測試數(刻意 + 未標記) */
  testsTriggeringAny: number;
  testsTriggeringSwallow: number;
  testsTriggeringDefaultPath: number;
  /** 第四桶:登記在 scripts/degraded-intended.json、而且登記還沒過期的測試數 */
  testsIntended: number;
  /** 觸發任一 − 刻意。這才是「只准降」比的數字 */
  testsUnmarked: number;
  /** 登記表裡的基準;比對只在 scope=full 時有意義 */
  unmarkedBaseline: number;
  /** 登記過期的條數(規則 1) */
  intendedStale: number;
  /** 這次沒跑到、不判的條數(只在 partial 會非 0) */
  intendedNotRun: number;
  scope: RunScope;
  /** 乙:量出來的「全套跑完」,不是 cmdline 說的。基準只在 scope=full 且 ranAll 時才比。 */
  ranAll: boolean;
  /** ranAll 為假的理由(「退出碼 X,收到 N/M;…」);為真是 null。 */
  ranAllReason: string | null;
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
  intended: IntendedRegistry;
  checks: IntendedCheck[];
  scope: RunScope;
  completeness: RunCompleteness;
}): { markdown: string; summary: Summary } {
  const { root, sha, command, rows, outside, sites, unknown, intended, checks, scope, completeness } = opts;
  const owners = loadOwners(root);
  // 乙:宣稱全套(scope=full)但量出來沒跑完 → 「未標記」那一列不能說可以降、等於、超過——它就是讀不到。
  const unreadable = scope === 'full' && !completeness.ranAll ? `讀不到(全套未跑完:${describeIncomplete(completeness)})` : null;
  const allSignals = Object.keys(DEGRADED_SIGNALS) as DegradedSignal[];

  // 訊號 → 觸發它的測試
  const testsBySignal = new Map<DegradedSignal, TestRow[]>();
  for (const row of rows) for (const s of row.signals.keys()) testsBySignal.set(s, [...(testsBySignal.get(s) ?? []), row]);

  const triggering = rows.filter((r) => r.signals.size > 0);
  // 刻意:登記還沒過期的那些(同一個測試登記兩個訊號也只算一個測試)
  const intendedKeys = new Set(checks.filter((c) => c.status.kind === 'ok').map((c) => `${c.entry.file}::${c.entry.test}`));
  const isIntended = (r: TestRow): boolean => intendedKeys.has(`${r.file}::${r.test}`);
  const unmarked = triggering.filter((r) => !isIntended(r));
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
    testsIntended: intendedKeys.size,
    testsUnmarked: unmarked.length,
    unmarkedBaseline: intended.unmarkedBaseline,
    intendedStale: checks.filter((c) => isStale(c.status)).length,
    intendedNotRun: checks.filter((c) => c.status.kind === 'not-run').length,
    scope,
    ranAll: completeness.ranAll,
    ranAllReason: completeness.reason,
    crossOwnerTests: cross.length,
    signalsInCatalog: allSignals.length,
    signalsWithCallSites: allSignals.filter((s) => (sites.get(s) ?? []).length > 0).length,
    signalsTriggered: testsBySignal.size,
    outsideRows: outside.length,
  };

  const L: string[] = [];
  L.push(`# 退化路徑報告 · ${sha}`);
  L.push('');
  L.push(`報告模式(ADR-044)。這份報告回答一個問題:**哪些測試在跑的時候走進了「失敗了卻回一個看起來正常的值」的分支?** 走進去不代表錯——很多測試就是在測那條分支。存在的目的就是要走那條分支的測試登記在 \`${DEFAULT_INTENDED_PATH}\`(第四桶「刻意」,§3a),其餘的是「未標記」。指標是**未標記數只准降**(基準 ${intended.unmarkedBaseline});登記表**不准過期**(每一條都要對應一個仍在觸發那個訊號的測試)。`);
  L.push('');
  L.push('| 欄位 | 值 |');
  L.push('|---|---|');
  L.push(`| 量測的 commit | \`${sha}\` |`);
  L.push(`| 產生時間 | ${summary.generatedAt} |`);
  L.push(`| 指令 | \`${md(command)}\` |`);
  L.push(`| 範圍 | ${scope === 'full' ? (unreadable === null ? '全套(基準比對有效)' : `全套(宣稱),但 ran_all 量出來是假:${unreadable};不比基準`) : '部分(只跑了一部分或 --in 既有目錄;不比基準,沒跑到的登記不判)'} |`);
  L.push(`| ran_all(量出來的:退出碼 ∈ {0,1}、\`${VITEST_JSON}\` 一致、紀錄數 = 要跑的數) | ${completeness.ranAll ? `是(${describeIncomplete(completeness)})` : `否:${md(completeness.reason ?? '')}`} |`);
  L.push(`| 測試檔 / 測試(只算實際執行的;skipped / todo / runtime ctx.skip() 不寫列,不進分母) | ${summary.testFiles} / ${summary.tests} |`);
  L.push(`| 訊號目錄 / 有呼叫點 / 被觸發 | ${summary.signalsInCatalog} / ${summary.signalsWithCallSites} / ${summary.signalsTriggered} |`);
  L.push('');
  L.push('## 1. 基準數字(四桶)');
  L.push('');
  L.push('| 指標 | 數字 | 說明 |');
  L.push('|---|---|---|');
  L.push(`| 觸發了退化分支的測試數 | ${summary.testsTriggeringAny} / ${summary.tests} | = 刻意 + 未標記 |`);
  L.push(`| 其中觸發 \`swallow\`(失敗 → 正常值)的 | ${summary.testsTriggeringSwallow} | 「測試綠但走錯路」最典型的來源 |`);
  L.push(`| 其中觸發 \`default-path\`(沒給 → 自選一條路)的 | ${summary.testsTriggeringDefaultPath} | 不知情地測了 stub / 預設路徑 |`);
  L.push(`| **刻意**:登記為故意走退化分支的測試 | **${summary.testsIntended}** | 登記表 ${intended.entries.length} 條(過期 ${summary.intendedStale}${summary.intendedNotRun > 0 ? `,這次沒跑到 ${summary.intendedNotRun}` : ''}),§3a |`);
  const baselineNote =
    scope !== 'full'
      ? '(部分跑,不比)'
      : unreadable !== null
        ? ` — **${unreadable},不比**;要比基準請重跑整套`
        : summary.testsUnmarked > summary.unmarkedBaseline
          ? ' — **超過基準,FAIL**'
          : summary.testsUnmarked < summary.unmarkedBaseline
            ? ' — 低於基準,可以降'
            : ' — 等於基準';
  L.push(`| **未標記**:觸發了、但沒登記為刻意的 | **${summary.testsUnmarked}** | 基準 **${summary.unmarkedBaseline}**,只准降${baselineNote} |`);
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
  L.push(`只列有觸發的測試(${triggering.length} 個);沒觸發的 ${rows.length - triggering.length} 個不列。依測試檔分組,括號是「觸發 / 該檔測試數」。開頭標 **[刻意]** 的是登記表裡的(§3a),不算未標記。`);
  L.push('');
  const byFile = new Map<string, TestRow[]>();
  for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  for (const [file, fileRows] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hit = fileRows.filter((r) => r.signals.size > 0);
    if (hit.length === 0) continue;
    const intendedHere = hit.filter(isIntended).length;
    L.push(`### \`${file}\` (${hit.length} / ${fileRows.length}${intendedHere > 0 ? `,其中刻意 ${intendedHere}` : ''}) · 擁有者 ${ownerOf(owners, file)}`);
    L.push('');
    for (const r of hit) {
      const sig = [...r.signals.entries()].map(([s, n]) => (n === 1 ? `\`${s}\`` : `\`${s}\` ×${n}`)).join(', ');
      L.push(`- ${isIntended(r) ? '**[刻意]** ' : ''}${md(r.test)} → ${sig}`);
    }
    L.push('');
  }

  // §3a 刻意登記表
  L.push('## 3a. 刻意登記表');
  L.push('');
  L.push(`\`${DEFAULT_INTENDED_PATH}\`,${intended.entries.length} 條。每一條都要對應一個仍然存在、而且仍然觸發那個訊號的測試;✗ 的是**登記過期**,整支腳本會以退出碼 1 結束——修法是把測試改回去,或把那條登記拿掉(在 commit 說明講為什麼)。不是用來讓數字好看的:只有「這個測試存在的目的就是要走那條分支」才登記。`);
  L.push('');
  if (checks.length === 0) L.push('(沒有)');
  else {
    L.push('| 狀態 | 測試檔 | 測試 | 訊號 | 理由 | 登記日 |');
    L.push('|---|---|---|---|---|---|');
    for (const c of checks) {
      L.push(`| ${md(describeStatus(c.status))} | \`${c.entry.file}\` | ${md(c.entry.test)} | \`${c.entry.signal}\` | ${md(c.entry.reason)} | ${c.entry.since} |`);
    }
  }
  L.push('');

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
  L.push('npx tsx scripts/degraded-report.ts --intended <path>     # 換一張登記表(測試用)');
  L.push('```');
  L.push('');
  L.push(`觀測點:\`packages/contracts/src/witness.ts\`(訊號目錄 + \`witness()\`)。hook:\`scripts/degraded-witness.setup.ts\`(只在設了 \`DEGRADED_WITNESS_DIR\` 時做事)。登記表:\`${DEFAULT_INTENDED_PATH}\`(§3a)。這份報告不改任何測試、不加任何標記;數字旁邊的 \`.json\` 是給下一次比「有沒有降」用的。`);
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

/** 登記過期或未標記超過基準:報告已經寫好了,只是要以退出碼 1 結束。訊息是給人看的。 */
export class LockError extends Error {
  override readonly name = 'LockError';
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = REPO_ROOT;
  const sha = gitSha(root);
  // 登記表先讀:壞了就不用花幾分鐘跑 vitest。
  const intendedPath = args.intended ?? join(root, DEFAULT_INTENDED_PATH);
  const intended = loadIntended(intendedPath);

  let inDir = args.inDir;
  let command: string;
  // 沒帶 vitest 參數自己跑的是整套;--in 的資料不知道當初怎麼跑的,要 --full 才當整套。
  const scope: RunScope = (inDir === undefined && args.vitestArgs.length === 0) || (inDir !== undefined && args.full) ? 'full' : 'partial';
  if (inDir === undefined) {
    inDir = join(root, 'reports/degraded/.raw', timestamp());
    mkdirSync(inDir, { recursive: true });
    // 乙的證據:json reporter 是**加**不是換(default 的輸出還要給人看),寫進 raw 目錄跟 JSONL 放一起。
    const vitestArgs = ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${toPosix(relative(root, join(inDir, VITEST_JSON)))}`, ...args.vitestArgs];
    command = `DEGRADED_WITNESS_DIR=${relative(root, inDir)} npx ${vitestArgs.join(' ')}`;
    console.log(`▶ ${command}`);
    const r = spawnSync('npx', vitestArgs, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DEGRADED_WITNESS_DIR: inDir },
    });
    writeFileSync(join(inDir, VITEST_EXIT_JSON), `${JSON.stringify({ status: r.status, signal: r.signal })}\n`, 'utf8');
    // vitest 紅了也照樣彙總:報告模式不執法,紅綠是 vitest 自己的事。但要講出來。
    if (r.status !== 0) console.log(`⚠ vitest 退出碼 ${r.status ?? 'null'},報告照樣產生,紅燈請看上面 vitest 的輸出`);
  } else {
    command = `(--in ${relative(root, inDir)})`;
  }

  if (!existsSync(inDir)) throw new UsageError(`找不到輸入目錄:${inDir}`);
  if (!statSync(inDir).isDirectory()) throw new UsageError(`--in 要指到一個目錄,這是一個檔案:${inDir}`);
  const records = readRecords(inDir);
  if (records.length === 0) {
    const jsonlFiles = readdirSync(inDir).filter((n) => n.endsWith('.jsonl')).length;
    throw new UsageError(
      args.inDir === undefined
        ? `這不是很乾淨,是掃描器壞了:vitest 跑完了,${inDir} 裡卻沒有任何紀錄(.jsonl 檔 ${jsonlFiles} 個)。vitest.config.ts 的 setupFiles 有掛 scripts/degraded-witness.setup.ts 嗎?`
        : `${inDir} 裡沒有任何紀錄(.jsonl 檔 ${jsonlFiles} 個,有效的行 0 行)。--in 要指到 DEGRADED_WITNESS_DIR 那個目錄,通常在 reports/degraded/.raw/<時戳>/`,
    );
  }

  const { rows, outside } = aggregate(records);
  // 乙:ran 是 JSONL 的 test-end 列數(aggregate 之前;同名多筆各算一列,因為 vitest 那邊也是各算一個)。
  const completeness = assessRunCompleteness(inDir, records.filter((r) => r.test !== OUTSIDE_ANY_TEST).length);
  const found = findCallSites(root);
  const { sites, unknown } = found;
  const checks = checkIntended(intended.entries, rows, scope, (rel) => existsSync(join(root, rel)));
  const { markdown, summary } = renderReport({ root, sha, command, rows, outside, sites, unknown, intended, checks, scope, completeness });

  const out = args.out ?? join(root, 'reports/degraded', `${sha}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown, 'utf8');
  writeFileSync(out.replace(/\.md$/, '.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  // 乙:宣稱全套(scope=full)但 ran_all 量出來是假 → 基準讀不到,當部分跑比(也就是不比、不提示)。
  const unreadable = scope === 'full' && !completeness.ranAll ? `讀不到(全套未跑完:${describeIncomplete(completeness)})` : null;
  console.log(`\n退化路徑報告:${relative(root, out)}${scope === 'partial' ? '(部分跑:不比基準,沒跑到的登記不判)' : ''}`);
  console.log(`  測試 ${summary.tests}(${summary.testFiles} 檔);ran_all:${completeness.ranAll ? `真(${describeIncomplete(completeness)})` : `假(${completeness.reason ?? ''})`}`);
  console.log(`  觸發退化分支:${summary.testsTriggeringAny}(swallow ${summary.testsTriggeringSwallow},default-path ${summary.testsTriggeringDefaultPath})`);
  console.log(`  刻意(登記表 ${intended.entries.length} 條):${summary.testsIntended};未標記:${summary.testsUnmarked};基準:${unreadable ?? summary.unmarkedBaseline}`);
  console.log(`  跨擁有者:${summary.crossOwnerTests};訊號 目錄/呼叫點/觸發:${summary.signalsInCatalog}/${summary.signalsWithCallSites}/${summary.signalsTriggered}`);

  // 四道閘都是報告寫完才判,報告要留著看。順序:量尺自己(甲、乙)在前,量出來的數字(規則 1、規則 3)在後。
  const problems: string[] = [];
  // 甲:目錄與呼叫點一一對上。
  const drift = catalogDriftProblems(found);
  if (drift.length > 0) {
    problems.push(`訊號目錄漂移 ${drift.length} 條(packages/contracts/src/witness.ts 與程式碼的呼叫點對不上;ADR-047):`);
    for (const p of drift) problems.push(`  - ${p}`);
  }
  // 乙:宣稱全套但沒跑完。沒有 --full 的 --in、`-- <參數>` 的小跑沒有宣稱,不擋。
  if (unreadable !== null) {
    problems.push(`宣稱全套但沒跑完:${completeness.reason ?? describeIncomplete(completeness)}。基準${unreadable},不比、也不印降基準的提示;要比基準請重跑整套(npx tsx scripts/degraded-report.ts)`);
  }
  // 規則 1:登記表不准腐爛。
  const stale = checks.filter((c) => isStale(c.status));
  if (stale.length > 0) {
    problems.push(`登記過期 ${stale.length} 條(${relative(root, intendedPath)}):`);
    for (const c of stale) problems.push(`  - ${c.entry.file} :: ${c.entry.test} :: ${c.entry.signal}\n    ${describeStatus(c.status)}`);
  }
  // 規則 3:未標記只准降。只在「宣稱全套 且 量出來跑完了」才比;讀不到就當部分跑,連提示都不印。
  const baseline = compareBaseline(summary.testsUnmarked, intended.unmarkedBaseline, unreadable === null ? scope : 'partial');
  if (baseline.fail !== null) problems.push(baseline.fail);
  if (baseline.hint !== null) console.log(`  ℹ ${baseline.hint}`);
  if (problems.length > 0) throw new LockError(problems.join('\n'));
}

const isEntry = process.argv[1] !== undefined && /degraded-report\.(ts|js)$/.test(process.argv[1]);
if (isEntry) {
  try {
    main();
  } catch (err) {
    // 預期中的失敗印一句人話就好;其他的(程式自己的 bug)照常往外丟,stack 是要看的。
    if (!(err instanceof UsageError) && !(err instanceof LockError)) throw err;
    console.error(`✗ degraded-report:${err.message}`);
    process.exitCode = 1;
  }
}
