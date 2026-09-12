/**
 * 零輸入守門的名冊與 probe builders。
 *
 * 這是守門的設定，不是斷言：新增入口時只需修改這個非 *.test.ts 檔；
 * zero-input-guard.test.ts 匯入本檔並負責完整性、棘輪與執行斷言。
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const MINIMAL = join(REPO_ROOT, 'contracts/fixtures/learning-minimal');
const FIXTURES = join(REPO_ROOT, 'contracts/fixtures');

function withoutNodeOptions(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _dropped, ...rest } = env;
  return rest;
}

// ───────────────────────────────────────────────────────────────── 型別

export type Kind = 'empty' | 'missing' | 'malformed' | 'wrong-type';
export const KINDS: readonly Kind[] = ['empty', 'missing', 'malformed', 'wrong-type'];

export interface Invocation {
  /** 傳給入口的參數(入口路徑由清單的 key 決定)。 */
  args: string[];
  /** 預設 REPO_ROOT。守門腳本的 ROOT 是從 cwd 的 git 頂層解析的,cwd 換到暫存目錄就等於「對一個空 repo 跑」。 */
  cwd?: string;
  env?: Record<string, string>;
  /** 輸出裡必須出現的字串(通常是缺掉的那條路徑)。 */
  mention?: string;
}

export type Builder = (scratch: string) => Invocation;

interface ProbeBase {
  name: string;
  build: Builder;
  /** 要跟哪幾個基線比「不可以長一樣」。預設只比 healthy。 */
  against?: readonly string[];
  /**
   * 正當的 exit 0 要**印基數**(掃了 N 張、到期 0 張),條件同 review 的三邊界(ADR-045):
   * 跟 `against` 那個基線比的時候,**兩邊都要印得出基數、而且不同**。空 vault(N=0)跟安靜日
   * (N>0、到期 0)長一樣就是洞——那是「空的跟健康的長一樣」最容易混的形狀。
   */
  cardinality?: { against: string; re: RegExp };
}

/** 空 / 缺 可以是正當的 exit 0,但要寫理由。 */
interface BenignProbe extends ProbeBase {
  kind: 'empty' | 'missing';
  legitZero?: string;
}

/** 壞輸入沒有正當的 exit 0,型別上就不給填。 */
interface HostileProbe extends ProbeBase {
  kind: 'malformed' | 'wrong-type';
}

type Probe = BenignProbe | HostileProbe;

export interface Command {
  /** 顯示用,例如 `validate-review`。同一個檔案多個子命令就多個 Command。 */
  label: string;
  /**
   * 基線。`healthy` 必填(退出碼必須是 0、不可以有裸錯誤);可以再加別的,例如
   * `quiet`(健康但今天沒事做)——那是「空的跟健康的長一樣」最容易混的那一個。
   * 沒有離線的健康路徑(llm.ts 每一條健康路徑都打網路)就填 `null` 並寫理由。
   */
  baselines: Record<string, Builder>;
  /** baselines 是空的時候要寫理由。 */
  noBaseline?: string;
  probes: Probe[];
  /** 某一種輸入形狀對這個命令沒有意義時,寫理由略過。 */
  omit?: Partial<Record<Kind, string>>;
}

interface EntryCommand {
  kind: 'entry';
  commands: Command[];
}

interface HelperEntry {
  kind: 'helper';
  reason: string;
}

interface LibraryEntry {
  kind: 'library';
  via: string;
  reason: string;
}

const EXCLUDED_KIND = 'excluded' as const;

/**
 * 刻意排除仍須自帶證明:它不是「沒被測」,而是「測在別的地方,而且指名」。
 * `coveredBy` 由 zero-input-guard.test.ts 斷言為磁碟上的檔案,所以 excluded 不再是逃生口。
 */
interface ExcludedEntry {
  kind: typeof EXCLUDED_KIND;
  scope: string;
  reason: string;
  coveredBy: string;
}

export type Entry = EntryCommand | HelperEntry | LibraryEntry | ExcludedEntry;

// ───────────────────────────────────────────────────────────────── fixture 小工具

function file(scratch: string, rel: string, content: string): string {
  const p = join(scratch, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
  return p;
}

function emptyDir(scratch: string, rel: string): string {
  const p = join(scratch, rel);
  mkdirSync(p, { recursive: true });
  return p;
}

/** 永遠不建立的路徑。 */
function missingPath(scratch: string, rel: string): string {
  return join(scratch, rel);
}

/** learning-minimal 的複本(3 張卡、3 份考題、config 齊全)。 */
function vault(scratch: string, rel = 'vault'): string {
  const d = join(scratch, rel);
  cpSync(MINIMAL, d, { recursive: true });
  return d;
}

/** 把 vault 的 cards/ 清空(目錄結構在、一張卡都沒有)。 */
function vaultWithoutCards(scratch: string): string {
  const d = vault(scratch);
  rmSync(join(d, 'cards'), { recursive: true, force: true });
  mkdirSync(join(d, 'cards/security'), { recursive: true });
  return d;
}

function reviewRecord(nextDue: string | null, stage = 2): Record<string, unknown> {
  return { stage, learned_at: '2026-08-01', next_due: nextDue, fails_in_row: 0, total_fails: 0, stuck: false, history: [] };
}

const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'zig', GIT_AUTHOR_EMAIL: 'zig@test', GIT_COMMITTER_NAME: 'zig', GIT_COMMITTER_EMAIL: 'zig@test' };

/** 一個「它自己的」git repo,已經 commit 過一次。`withChange` 再丟一個沒 commit 的檔案進去。 */
function ownGitRepo(scratch: string, withChange: boolean): string {
  const d = join(scratch, 'repo');
  mkdirSync(d, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: d, stdio: 'ignore', env: { ...process.env, ...GIT_IDENTITY } });
  };
  git('init', '-q');
  file(d, 'config/settings.yaml', 'daily_cap: 10\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  if (withChange) file(d, 'state/reviews.json', '{}\n');
  return d;
}

/** 一個 log.jsonl 事件。ts 用 UTC 正午,任何時區的本地日期都還是同一天。 */
function llmCallLine(day: string, provider = 'openai'): string {
  return JSON.stringify({ ts: `${day}T12:00:00Z`, type: 'llm_call', provider, model: 'gpt', tokens_in: 1000, tokens_out: 1000 });
}

const SPEND_DAY = '2026-09-01';

/**
 * llm-spend 探針的固定環境(測試 fixture,跟 `GIT_IDENTITY` 同型)。
 *
 * 為什麼寫死在這裡、不讀 `process.env`:llm-spend.ts 走 `_env.ts` 載 gitignored 的 `.env`,
 * 三個變數缺一個就 exit 2「LLM_DAILY_CAP_USD 沒有設定」——那是它正確的行為,但拿來當**基線**
 * 就等於基線壞掉,底下 11 條比較連鎖假紅(乾淨簽出沒有 `.env` 時必現,2026-09-05 兩次誤判)。
 * 從 `process.env` 讀只是把「依賴外部環境」換個地方藏。這裡只注入這支需要的三個,
 * 不整包 `...process.env` 蓋過去,乾淨簽出才驗得出來。
 *
 * 決定性:`process.loadEnvFile` **不會**覆蓋已存在的變數(含空字串),所以就算使用者的 `.env`
 * 填了別的值(例如 cap=0),探針看到的仍是這三個。
 */
const SPEND_ENV: Record<string, string> = { LLM_DAILY_CAP_USD: '1', LLM_PRICE_IN_PER_M: '2.5', LLM_PRICE_OUT_PER_M: '10' };

/** 用 --golden --fake 產一份 run,回傳 ingest.cards 那一組的 run 目錄。 */
function goldenRun(scratch: string, rel: string): string {
  const out = join(scratch, rel);
  execFileSync(process.execPath, [TSX_CLI, join(REPO_ROOT, 'scripts/prompt-check.ts'), '--golden', '--fake', '--out', out], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    env: withoutNodeOptions(process.env),
  });
  const setDir = join(out, 'ingest.cards');
  const runs = readdirSync(setDir).sort();
  const last = runs[runs.length - 1];
  if (!last) throw new Error(`golden run 沒有產生任何 run 目錄:${setDir}`);
  return join(setDir, last);
}

/** GATES_CONFIG_DIR 指向一個放了指定設定檔的目錄。 */
function gatesConfigDir(scratch: string, files: Record<string, string>): Record<string, string> {
  const d = emptyDir(scratch, 'gates-config');
  for (const [name, content] of Object.entries(files)) file(d, name, content);
  return { GATES_CONFIG_DIR: d };
}

const REPO_NODE_MODULES = join(REPO_ROOT, 'node_modules');

/** 給 check-dry-run.ts 用的最小可跑真 cucumber 的 consumer:cucumber.json + 一個 phase 檔 +
 *  一個 steps 檔,恰好各自一個定義。跟 check-dry-run.test.ts 同一個手法——node_modules 是
 *  指向本 repo 的符號連結,不然 npx 在 scratch 目錄裡找不到 cucumber-js / tsx。
 *  `noFeatures` 拿掉 phase 檔,留下空的 features/ 給「0 個場景」探針用。 */
function dryRunFixture(scratch: string, rel: string, opts: { noFeatures?: boolean } = {}): string {
  const root = join(scratch, rel);
  mkdirSync(root, { recursive: true });
  symlinkSync(REPO_NODE_MODULES, join(root, 'node_modules'), 'dir');
  file(root, 'cucumber.json', JSON.stringify({ default: { paths: ['features/**/*.feature'], import: ['features/steps/**/*.js'] } }, null, 2));
  file(root, 'scripts/gates.config.json', '{}');
  file(root, 'features/steps/alpha.steps.js', ["const { Given } = require('@cucumber/cucumber');", "Given('the store has {int} items', function () {});", ''].join('\n'));
  if (!opts.noFeatures) {
    file(root, 'features/01-alpha/phase-1.feature', ['@phase-1', 'Feature: alpha', '  Scenario: one', '    Given the store has 3 items', ''].join('\n'));
  }
  return root;
}

/**
 * check-phase-coverage 不帶 --list 就會真的起 cucumber:段一 dry-run 一個資料夾約十秒,
 * 段二會把 done / in-progress 的 phase 真跑一遍(幾分鐘)。`--run-phases` 指一個不存在的
 * key,段二就一個都不跑;探的是設定檔怎麼被讀,不是 cucumber。
 */
const ONE_FOLDER_DRY_RUN = ['--only', '01-data-layer', '--run-phases', 'nope/phase-9'];

const OWNERS_OK = JSON.stringify({ owners: [['scripts/', 'infra']], glue: ['infra'], aliases: [], scanDirs: ['scripts'], contractsOwner: 'contracts' });

/** 一個 DEGRADED_WITNESS_DIR 的樣子(ADR-044):目錄裡一個 worker 的 .jsonl,每一行一筆 WitnessRecord。 */
function witnessDir(scratch: string, jsonl: string): string {
  const d = emptyDir(scratch, 'raw');
  file(d, 'worker-1.jsonl', jsonl);
  return d;
}

const WITNESS_OK = `${JSON.stringify({ file: 'packages/core/src/llm/router.test.ts', test: 'falls back to gateway', signals: { 'llm.fallback.cloud-failed': 1 } })}\n`;

// ───────────────────────────────────────────────────────────────── 清單

export const SCHEMA_CLI = 'packages/core/src/schema/cli.ts';

export const ROSTER: Record<string, Entry> = {
  // ── 共用模組,不是入口 ──
  'scripts/zero-input-roster.ts': { kind: 'helper', reason: '零輸入守門的名冊與 probe build 函式;設定獨立於斷言測試,沒有 CLI 入口。' },
  'scripts/_env.ts': { kind: 'helper', reason: 'side-effect import(ADR-034 的 .env 載入),沒有 main、沒有參數' },
  'scripts/_root.ts': { kind: 'helper', reason: '守門腳本共用的 repo 根與設定檔解析(模板 v1.3.4),只 export 函式' },
  'scripts/degraded-witness.setup.ts': {
    kind: 'helper',
    reason:
      'vitest 的 setupFile(vitest.config.ts 掛的),不是可執行入口、沒有 CLI 介面。' +
      '只在設了 DEGRADED_WITNESS_DIR 時註冊 hook,沒設就一個 hook 都不註冊(ADR-044)',
  },

  // ── ADR-044 退化路徑見證器的彙總 ──
  'scripts/degraded-report.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'degraded-report',
        // 每一次呼叫都帶 --in 與 --out:不帶 --in 是它的預設行為「先跑整套 vitest 再彙總」
        // (幾分鐘,而且它印了 ▶ 那行說明自己要做什麼,不算洞,只是探不起);不帶 --out
        // 會寫進 repo 的 reports/degraded/。探的是 --in 目錄與參數的處理。
        baselines: { healthy: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--out', join(s, 'r.md')] }) },
        probes: [
          { kind: 'empty', name: '--in 是空目錄', build: (s) => ({ args: ['--in', emptyDir(s, 'raw'), '--out', join(s, 'r.md')] }) },
          { kind: 'empty', name: '--in 裡的 .jsonl 是空檔', build: (s) => ({ args: ['--in', witnessDir(s, ''), '--out', join(s, 'r.md')] }) },
          { kind: 'missing', name: '--in 不存在', build: (s) => { const p = missingPath(s, 'raw'); return { args: ['--in', p, '--out', join(s, 'r.md')], mention: p }; } },
          { kind: 'missing', name: '--in 沒給值', build: (s) => ({ args: ['--out', join(s, 'r.md'), '--in'] }) },
          { kind: 'malformed', name: '.jsonl 有一行壞 JSON', build: (s) => ({ args: ['--in', witnessDir(s, '{ "file": \n'), '--out', join(s, 'r.md')] }) },
          { kind: 'malformed', name: '--in 指到一個檔案', build: (s) => ({ args: ['--in', file(s, 'raw.jsonl', WITNESS_OK), '--out', join(s, 'r.md')] }) },
          { kind: 'malformed', name: '不認得的參數', build: (s) => ({ args: ['--bogus', '--out', join(s, 'r.md')] }) },
          { kind: 'wrong-type', name: '每一行都是數字', build: (s) => ({ args: ['--in', witnessDir(s, '5\n6\n'), '--out', join(s, 'r.md')] }) },
          { kind: 'wrong-type', name: '整檔是一個 JSON 陣列', build: (s) => ({ args: ['--in', witnessDir(s, `[${WITNESS_OK.trim()}]\n`), '--out', join(s, 'r.md')] }) },
          { kind: 'wrong-type', name: '紀錄缺 signals 欄位', build: (s) => ({ args: ['--in', witnessDir(s, `${JSON.stringify({ file: 'a.test.ts', test: 't' })}\n`), '--out', join(s, 'r.md')] }) },
          // 「刻意」登記表(--intended,預設 scripts/degraded-intended.json)——同一支入口的第二個輸入。
          { kind: 'missing', name: '--intended 不存在', build: (s) => { const p = missingPath(s, 'intended.json'); return { args: ['--in', witnessDir(s, WITNESS_OK), '--intended', p, '--out', join(s, 'r.md')], mention: p }; } },
          { kind: 'missing', name: '--intended 沒給值', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--out', join(s, 'r.md'), '--intended'] }) },
          { kind: 'empty', name: '--intended 是空檔', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--intended', file(s, 'intended.json', ''), '--out', join(s, 'r.md')] }) },
          { kind: 'malformed', name: '--intended 是壞 JSON', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--intended', file(s, 'intended.json', '{ "entries": [\n'), '--out', join(s, 'r.md')] }) },
          { kind: 'malformed', name: '--intended 指到一個目錄', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--intended', emptyDir(s, 'intended-dir'), '--out', join(s, 'r.md')] }) },
          { kind: 'malformed', name: '--intended 的 reason 是空字串(規則 2)', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--intended', file(s, 'intended.json', JSON.stringify({ unmarkedBaseline: 0, entries: [{ file: 'a.test.ts', test: 't', signal: 'llm.fallback.cloud-failed', reason: '', since: '2026-09-05' }] })), '--out', join(s, 'r.md')] }) },
          { kind: 'malformed', name: '--full 沒有 --in', build: (s) => ({ args: ['--full', '--out', join(s, 'r.md')] }) },
          { kind: 'wrong-type', name: '--intended 的 entries 不是陣列', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--intended', file(s, 'intended.json', JSON.stringify({ unmarkedBaseline: 0, entries: {} })), '--out', join(s, 'r.md')] }) },
          { kind: 'wrong-type', name: '--intended 整檔是一個陣列', build: (s) => ({ args: ['--in', witnessDir(s, WITNESS_OK), '--intended', file(s, 'intended.json', '[]'), '--out', join(s, 'r.md')] }) },
        ],
      },
    ],
  },

  // ── 邏輯本體在 core、入口在 scripts ──
  'packages/core/src/prompt-quality/cli.ts': {
    kind: 'library',
    via: 'scripts/prompt-check.ts',
    reason: 'export main(argv) 給 scripts/prompt-check.ts 呼叫,直接執行什麼都不做',
  },

  // ── 跨 worktree 鎖的兩個入口 ──
  'scripts/mutate.ts': {
    kind: EXCLUDED_KIND,
    scope: 'cross-worktree lock',
    reason:
      '真正不適用:runMutate 在解析任何 Stryker 參數前就取得跨 worktree 鎖，且有效/錯誤設定都會交給 Stryker 啟動；外部 CLI probe 不能同時便宜、隔離且不干擾別人的 mutate。' +
      'argv 轉換、鎖、finally/signal 釋放都在 scripts/mutate.test.ts 以注入 runStryker 與假鎖完整測。',
    coveredBy: 'scripts/mutate.test.ts',
  },
  'scripts/run-tests.ts': {
    kind: EXCLUDED_KIND,
    scope: 'CLI 參數錯誤',
    reason:
      '只排除 CLI 參數錯誤這一類:這支是全套 vitest 的純轉發(跟 Stryker 共用 .stryker.lock 排隊),' +
      '錯誤輸出屬於 vitest CLI；外部 zero-input probe 會變成在測 vitest 的 CLI。' +
      '參數轉換(vitestArgs / isPartialRun)與鎖的行為在 scripts/run-tests.test.ts 用注入的假 runVitest 測。' +
      // 2026-09-12:roster-location 那張試著把它改成 entry(用 `-- --help` 繞開「會真的起全套」),
      // 四條探針全紅,而紅的內容全是 **vitest 自己的** 輸出:`--help` 的 usage、CACError 的
      // stack、rolldown 的 UNRESOLVED_ENTRY。要讓它們變綠,run-tests.ts 得攔截並改寫 vitest 的
      // stderr —— 那會把真正的測試輸出一起蓋掉,代價遠大於收益。
      // **那次嘗試不是白費:它把「為什麼排除」從『會遞迴』推進到『這支是純轉發,探它的 CLI 等於
      // 探 vitest 的 CLI』** —— 後者才是不能收進來的真正理由,前者只是表象。
      '這一條被實測過一次(見上),不是沒試過就寫排除。',
    coveredBy: 'scripts/run-tests.test.ts',
  },

  // ── 守門腳本(模板 v1.3.4,勿手改;這裡的紅燈走模板升版,不直接改檔) ──
  'scripts/check-all.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-all',
        // 不對本 repo 跑(chain 含全套 test,幾分鐘):--root 指到一個只有一條 `node -e 0` 鏈的假 consumer。
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, 'package.json', JSON.stringify({ name: 'c', private: true, scripts: { ok: 'node -e 0' } }));
            file(root, 'scripts/gates.config.json', JSON.stringify({ chain: ['ok'] }));
            return { args: ['--root', root] };
          },
        },
        probes: [
          { kind: 'empty', name: 'chain 是空陣列', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'package.json', '{ "scripts": {} }'); file(root, 'scripts/gates.config.json', '{ "chain": [] }'); return { args: ['--root', root] }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'package.json', '{ "scripts": {} }'); file(root, 'scripts/gates.config.json', '{ "chain": ['); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: 'chain 是字串', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'package.json', '{ "scripts": {} }'); file(root, 'scripts/gates.config.json', '{ "chain": "test" }'); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-adr-numbers.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-adr-numbers',
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, 'docs/adr.md', '# ADR-001\n');
            file(root, 'scripts/adr-numbers.scope.json', JSON.stringify({ include: ['docs/*.md'] }));
            return { args: ['--root', root] };
          },
        },
        probes: [
          { kind: 'empty', name: 'include 是空陣列', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/adr-numbers.scope.json', JSON.stringify({ include: [] })); return { args: ['--root', root] }; } },
          { kind: 'missing', name: 'adr-numbers.scope.json 不存在', build: (s) => { const root = emptyDir(s, 'consumer'); const p = join(root, 'scripts/adr-numbers.scope.json'); return { args: ['--root', root], mention: p }; } },
          { kind: 'malformed', name: 'adr-numbers.scope.json 是壞 JSON', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/adr-numbers.scope.json', '{ "include": '); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: 'include 是字串', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/adr-numbers.scope.json', JSON.stringify({ include: 'docs/*.md' })); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-deliberately-absent.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-deliberately-absent',
        baselines: {
          healthy: (s) => {
            const root = ownGitRepo(s, false);
            file(root, 'scripts/deliberately-absent.json', JSON.stringify({ absent: [{ path: '.intentionally-absent', reason: '這個檔案必須不存在', adr: 'ADR-001' }] }));
            return { args: ['--root', root] };
          },
        },
        probes: [
          { kind: 'empty', name: 'absent 是空陣列', build: (s) => { const root = ownGitRepo(s, false); file(root, 'scripts/deliberately-absent.json', JSON.stringify({ absent: [] })); return { args: ['--root', root] }; } },
          { kind: 'missing', name: 'deliberately-absent.json 不存在', build: (s) => { const root = ownGitRepo(s, false); const p = join(root, 'scripts/deliberately-absent.json'); return { args: ['--root', root], mention: p }; } },
          { kind: 'malformed', name: 'deliberately-absent.json 是壞 JSON', build: (s) => { const root = ownGitRepo(s, false); file(root, 'scripts/deliberately-absent.json', '{ "absent": '); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: 'absent 是物件', build: (s) => { const root = ownGitRepo(s, false); file(root, 'scripts/deliberately-absent.json', JSON.stringify({ absent: {} })); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: '第一筆缺少 reason', build: (s) => { const root = ownGitRepo(s, false); file(root, 'scripts/deliberately-absent.json', JSON.stringify({ absent: [{ path: '.intentionally-absent', adr: 'ADR-001' }] })); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: '第一筆缺少 adr', build: (s) => { const root = ownGitRepo(s, false); file(root, 'scripts/deliberately-absent.json', JSON.stringify({ absent: [{ path: '.intentionally-absent', reason: '這個檔案必須不存在' }] })); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-boundaries.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-boundaries',
        baselines: { healthy: () => ({ args: [] }) },
        probes: [
          { kind: 'empty', name: '--root 是空目錄', build: (s) => ({ args: ['--root', emptyDir(s, 'empty')] }) },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'owners.json 是壞 JSON', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'boundaries.owners.json': '{ "owners": [' }) }) },
          { kind: 'wrong-type', name: 'owners.json 是陣列', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'boundaries.owners.json': '[]' }) }) },
          { kind: 'wrong-type', name: 'allow.json 是物件', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'boundaries.owners.json': OWNERS_OK, 'boundaries.allow.json': '{}' }) }) },
        ],
      },
    ],
  },
  'scripts/check-doc-links.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-doc-links',
        baselines: { healthy: () => ({ args: [] }) },
        probes: [
          { kind: 'empty', name: '--root 是空目錄', build: (s) => ({ args: ['--root', emptyDir(s, 'empty')] }) },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '{ "docLinks": ' }) }) },
          { kind: 'wrong-type', name: 'gates.config.json 是陣列', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '[]' }) }) },
        ],
      },
    ],
  },
  'scripts/check-doc-rot.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-doc-rot',
        // 對本 repo 跑會掃五百多個檔,而且 CLAUDE.md 有一處命中(report 模式 exit 0 但輸出含 ✗):
        // 健康基線改成一個乾淨的假 consumer,黑名單一條、文件一份沒命中。
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, 'scripts/doc-rot.blacklist.json', JSON.stringify([{ pattern: 'forbidden-token', reason: 'r', since: '2026-09-05', incident: 'P-0' }]));
            file(root, 'docs/a.md', '# clean\n');
            return { args: ['--root', root] };
          },
        },
        probes: [
          { kind: 'empty', name: '黑名單是空陣列', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/doc-rot.blacklist.json', '[]'); file(root, 'docs/a.md', '# a\n'); return { args: ['--root', root] }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'doc-rot.blacklist.json 是壞 JSON', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/doc-rot.blacklist.json', '[{ "pattern": '); file(root, 'docs/a.md', '# a\n'); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: 'doc-rot.blacklist.json 是物件', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/doc-rot.blacklist.json', '{}'); file(root, 'docs/a.md', '# a\n'); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-gherkin-dup.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-gherkin-dup',
        baselines: { healthy: () => ({ args: [] }) },
        probes: [
          { kind: 'empty', name: 'features/ 存在但沒有 .feature', build: (s) => { emptyDir(s, 'features'); return { args: [], cwd: s }; } },
          { kind: 'missing', name: '沒有 features/ 目錄', build: (s) => ({ args: [], cwd: emptyDir(s, 'norepo') }) },
          { kind: 'malformed', name: '.feature 是垃圾文字', build: (s) => { file(s, 'features/01-x/phase-1.feature', 'not gherkin at all\n{{{\n'); return { args: [], cwd: s }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '{ "gherkinDup": ' }) }) },
          { kind: 'wrong-type', name: 'gates.config.json 是陣列', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '[]' }) }) },
        ],
      },
    ],
  },
  'scripts/check-env-keys.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-env-keys',
        // 健康基線:.env.example 跟 .env 的鍵集合一致(1 個鍵)。
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, '.env.example', 'FOO=\n');
            file(root, '.env', 'FOO=x\n');
            return { args: ['--root', root] };
          },
        },
        probes: [
          // .env 不存在是工單 2026-09-12 明講的合法狀態(乾淨簽出/CI)——不是洞,是設計。
          { kind: 'missing', name: '.env 不存在(乾淨簽出/CI,合法跳過)', legitZero: '工單 2026-09-12:.env 是版控外的東西,乾淨簽出本來就沒有;訊息與退出碼跟其餘缺檔情況不同,見腳本檔頭', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, '.env.example', 'FOO=\n'); return { args: ['--root', root] }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'missing', name: '.env.example 不存在', build: (s) => { const root = emptyDir(s, 'consumer'); return { args: ['--root', root], mention: join(root, '.env.example') }; } },
          { kind: 'empty', name: '.env.example 是空檔(0 個鍵)', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, '.env.example', ''); file(root, '.env', ''); return { args: ['--root', root] }; } },
          { kind: 'malformed', name: '.env.example 是目錄不是檔案', build: (s) => { const root = emptyDir(s, 'consumer'); emptyDir(root, '.env.example'); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: '.env 是目錄不是檔案', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, '.env.example', 'FOO=\n'); emptyDir(root, '.env'); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-json-duplicate-keys.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-json-duplicate-keys',
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, 'scripts/json-duplicate-keys.scope.json', JSON.stringify({ include: ['scripts/*.json'] }));
            return { args: ['--root', root] };
          },
        },
        probes: [
          { kind: 'empty', name: 'include 是空陣列', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/json-duplicate-keys.scope.json', JSON.stringify({ include: [] })); return { args: ['--root', root] }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'json-duplicate-keys.scope.json 是壞 JSON', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/json-duplicate-keys.scope.json', '{ "include": '); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: 'include 是字串', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/json-duplicate-keys.scope.json', JSON.stringify({ include: 'scripts/*.json' })); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-known-defects.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-known-defects',
        // 對本 repo 跑是 0 目標例外(exit 1,見該檔檔頭 (c)),不是健康路徑。健康基線:一筆登記 + 用
        // KNOWN_DEFECTS_ENUMERATE_CMD 餵一個 cucumber --format json 形狀的列舉,兩邊剛好對上。
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, 'scripts/known-defects.json', JSON.stringify([{ feature: 'features/01-x/phase-1.feature', scenario: 'It is known', reason: 'r', fix_in: '未定', since: '2026-09-05', hard_rule: false }]));
            const listing = file(root, 'listing.json', JSON.stringify([{ uri: 'features/01-x/phase-1.feature', elements: [{ name: 'It is known', type: 'scenario', tags: [{ name: '@known-defect' }] }] }]));
            return { args: ['--root', root], env: { KNOWN_DEFECTS_ENUMERATE_CMD: `cat ${listing}` } };
          },
        },
        probes: [
          { kind: 'empty', name: '登記表只有 _doc、也沒有場景掛 tag(0 目標)', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/known-defects.json', '[{ "_doc": "x" }]'); const listing = file(root, 'listing.json', '[]'); return { args: ['--root', root], env: { KNOWN_DEFECTS_ENUMERATE_CMD: `cat ${listing}` } }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'known-defects.json 是壞 JSON', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/known-defects.json', '[{ "feature": '); const listing = file(root, 'listing.json', '[]'); return { args: ['--root', root], env: { KNOWN_DEFECTS_ENUMERATE_CMD: `cat ${listing}` } }; } },
          { kind: 'wrong-type', name: 'known-defects.json 是物件', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'scripts/known-defects.json', '{}'); const listing = file(root, 'listing.json', '[]'); return { args: ['--root', root], env: { KNOWN_DEFECTS_ENUMERATE_CMD: `cat ${listing}` } }; } },
        ],
      },
    ],
  },
  'scripts/check-ledger-pollution.ts': {
    kind: EXCLUDED_KIND,
    scope: 'cli',
    reason:
      // 這是**類別判斷**,不是「這輪還沒做」——跟 mutate.ts / run-tests.ts 同一類,
      // 但各自的類別理由不同,見下。
      '它的 main() 無條件跑一次完整 vitest(它要比的就是「跑之前 vs 跑之後」的帳本行數),' +
      '在 vitest 裡再起一個 vitest 是遞迴,所以沒有便宜的黑盒探測路徑。' +
      '⚠️ 這句的射程只到「CLI 這一層」:它的判定邏輯 runLedgerGuard 與 countLedgerLines ' +
      '是純函式、runTests 可注入,四種零輸入情況(帳本不存在 → UNKNOWN、測試後不存在、' +
      '行數改變、測試自己紅)都在 scripts/check-ledger-pollution.test.ts 裡以注入方式測到,' +
      '包含故意追加一行讓它紅的陽性對照。',
    coveredBy: 'scripts/check-ledger-pollution.test.ts',
  },
  'scripts/check-template-freshness.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-template-freshness',
        baselines: {
          healthy: (s) => {
            const upstream = emptyDir(s, 'template');
            file(upstream, 'VERSION', '1.6.8\n');
            return { args: [], env: { TEMPLATE_DIR: upstream } };
          },
        },
        probes: [
          { kind: 'empty', name: '$TEMPLATE_DIR/VERSION 是空檔', build: (s) => { const upstream = emptyDir(s, 'template'); file(upstream, 'VERSION', ''); return { args: [], env: { TEMPLATE_DIR: upstream } }; } },
          { kind: 'missing', name: '沒有 $TEMPLATE_DIR', legitZero: 'CI 沒有模板路徑時只能回報無法判斷;這不是同版也不是錯誤,見 ADR-055。', build: () => ({ args: [], env: { TEMPLATE_DIR: '' } }) },
          { kind: 'malformed', name: 'VERSION 不是三段版本', build: (s) => { const upstream = emptyDir(s, 'template'); file(upstream, 'VERSION', 'release-next\n'); return { args: [], env: { TEMPLATE_DIR: upstream } }; } },
          { kind: 'wrong-type', name: '$TEMPLATE_DIR 指到檔案', build: (s) => ({ args: [], env: { TEMPLATE_DIR: file(s, 'template', 'not a directory\n') } }) },
        ],
      },
    ],
  },
  'scripts/check-next-gates.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-next-gates',
        baselines: { healthy: () => ({ args: [] }) },
        probes: [
          { kind: 'empty', name: 'features/ 存在但沒有 NEXT.md', build: (s) => { const root = emptyDir(s, 'consumer'); emptyDir(root, 'features/01-x'); return { args: ['--root', root] }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '{ "nextGates": ' }) }) },
          { kind: 'wrong-type', name: 'gates.config.json 是陣列', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '[]' }) }) },
        ],
      },
    ],
  },
  'scripts/check-phase-coverage.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-phase-coverage',
        baselines: { healthy: () => ({ args: ['--list'] }) },
        probes: [
          { kind: 'empty', name: 'features/ 存在但沒有 phase 檔', build: (s) => { emptyDir(s, 'features'); return { args: ['--list'], cwd: s }; } },
          { kind: 'missing', name: '--cwd 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: [...ONE_FOLDER_DRY_RUN, '--cwd', p], mention: p }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => ({ args: ONE_FOLDER_DRY_RUN, env: gatesConfigDir(s, { 'gates.config.json': '{ "cucumberCwd": ' }) }) },
          { kind: 'wrong-type', name: 'cucumberCwd 是數字', build: (s) => ({ args: ONE_FOLDER_DRY_RUN, env: gatesConfigDir(s, { 'gates.config.json': '{ "cucumberCwd": 5 }' }) }) },
        ],
      },
    ],
  },
  'scripts/check-phase-status.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-phase-status',
        // 對本 repo 跑會對 done / in-progress 的 phase 真起 cucumber(分鐘級):健康基線改成一個只有一列 `todo`
        // 的假 consumer(todo 不需要真跑),探的是 FEATURE.md 與設定檔怎麼被讀,不是 cucumber。
        baselines: {
          healthy: (s) => {
            const root = emptyDir(s, 'consumer');
            file(root, 'features/01-x/FEATURE.md', '| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n| 1 | a | Wave 0 | todo | |\n');
            return { args: ['--root', root] };
          },
        },
        probes: [
          { kind: 'empty', name: 'features/ 存在但沒有 FEATURE.md', build: (s) => { const root = emptyDir(s, 'consumer'); emptyDir(root, 'features/01-x'); return { args: ['--root', root] }; } },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'features/01-x/FEATURE.md', '| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n| 1 | a | Wave 0 | todo | |\n'); file(root, 'scripts/gates.config.json', '{ "phaseStatus": '); return { args: ['--root', root] }; } },
          { kind: 'wrong-type', name: 'phaseStatus.mode 是數字', build: (s) => { const root = emptyDir(s, 'consumer'); file(root, 'features/01-x/FEATURE.md', '| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n| 1 | a | Wave 0 | todo | |\n'); file(root, 'scripts/gates.config.json', '{ "phaseStatus": { "mode": 5 } }'); return { args: ['--root', root] }; } },
        ],
      },
    ],
  },
  'scripts/check-standalone.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-standalone',
        baselines: {
          healthy: (s) => ({
            args: ['--list', '--manifest', file(s, 'standalone.json', JSON.stringify({ a: { cmd: 'node -e 1', interactive: false, expect: '1' }, b: { cmd: 'node -e 2', interactive: false } }))],
          }),
        },
        probes: [
          { kind: 'empty', name: 'manifest 是 {}', build: (s) => ({ args: ['--list', '--manifest', file(s, 'standalone.json', '{}')] }) },
          { kind: 'empty', name: 'manifest 是空檔', build: (s) => ({ args: ['--list', '--manifest', file(s, 'standalone.json', '')] }) },
          { kind: 'missing', name: 'manifest 不存在', build: (s) => { const p = missingPath(s, 'standalone.json'); return { args: ['--list', '--manifest', p], mention: p }; } },
          { kind: 'malformed', name: 'manifest 是壞 JSON', build: (s) => ({ args: ['--list', '--manifest', file(s, 'standalone.json', '{ "a": ')] }) },
          { kind: 'wrong-type', name: 'manifest 是陣列', build: (s) => ({ args: ['--list', '--manifest', file(s, 'standalone.json', '[]')] }) },
          { kind: 'wrong-type', name: '條目是數字', build: (s) => ({ args: ['--list', '--manifest', file(s, 'standalone.json', '{ "a": 5 }')] }) },
        ],
      },
    ],
  },
  'scripts/check-step-dup.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-step-dup',
        baselines: { healthy: () => ({ args: [] }) },
        omit: { 'wrong-type': '不讀任何設定或狀態檔,唯一的輸入是 .steps.ts 原始碼' },
        probes: [
          { kind: 'empty', name: 'features/steps/ 存在但沒有 .steps.ts', build: (s) => { emptyDir(s, 'features/steps'); return { args: [], cwd: s }; } },
          { kind: 'missing', name: '沒有 features/steps/', build: (s) => ({ args: [], cwd: emptyDir(s, 'norepo') }) },
          { kind: 'malformed', name: '.steps.ts 是垃圾文字', build: (s) => { file(s, 'features/steps/x.steps.ts', 'this is not typescript ((\n'); return { args: [], cwd: s }; } },
        ],
      },
    ],
  },
  'scripts/check-module-cast.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-module-cast',
        baselines: { healthy: () => ({ args: [] }) },
        probes: [
          { kind: 'empty', name: 'features/steps/ 存在但沒有 .ts 檔', build: (s) => { emptyDir(s, 'features/steps'); return { args: [], cwd: s }; } },
          { kind: 'missing', name: '沒有 features/steps/', build: (s) => ({ args: [], cwd: emptyDir(s, 'norepo') }) },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '{ "moduleCast": ' }) }) },
          { kind: 'wrong-type', name: 'moduleCast.scanDirs 是字串', build: (s) => ({ args: [], env: gatesConfigDir(s, { 'gates.config.json': '{ "moduleCast": { "scanDirs": "x" } }' }) }) },
        ],
      },
    ],
  },
  'scripts/check-dry-run.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'check-dry-run',
        // 跟 check-dry-run.test.ts 同一個手法:真的跑 cucumber,fixture 的 node_modules 是
        // 指向本 repo node_modules 的符號連結——這支守門的全部價值就是「cucumber dry-run 對
        // ambiguous/undefined 的退出碼是 0」這個實測事實,用假輸出測就是在測自己的想像。
        baselines: { healthy: (s) => ({ args: ['--root', dryRunFixture(s, 'consumer')] }) },
        probes: [
          { kind: 'empty', name: 'features/ 存在但沒有 .feature', build: (s) => ({ args: ['--root', dryRunFixture(s, 'consumer', { noFeatures: true })] }) },
          { kind: 'missing', name: '--root 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--root', p], mention: p }; } },
          { kind: 'malformed', name: 'gates.config.json 是壞 JSON', build: (s) => ({ args: ['--root', emptyDir(s, 'consumer')], env: gatesConfigDir(s, { 'gates.config.json': '{ "dryRun": ' }) }) },
          { kind: 'wrong-type', name: 'dryRun.tags 是數字', build: (s) => ({ args: ['--root', emptyDir(s, 'consumer')], env: gatesConfigDir(s, { 'gates.config.json': '{ "dryRun": { "tags": 5 } }' }) }) },
        ],
      },
    ],
  },

  // ── 功能入口 ──
  'scripts/due.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'due',
        baselines: {
          healthy: () => ({ args: ['--state', join(FIXTURES, 'reviews/mid-cycle.json'), '--today', '2026-09-10'] }),
          quiet: () => ({ args: ['--state', join(FIXTURES, 'reviews/mid-cycle.json'), '--today', '2026-01-01'] }),
        },
        probes: [
          {
            kind: 'empty',
            name: 'reviews.json 是 {}',
            build: (s) => ({ args: ['--state', file(s, 'reviews.json', '{}'), '--today', '2026-09-10'] }),
            legitZero: '跟 review.ts 的邊界 2 同一個判斷:{} = 還沒開始複習,是正常狀態。但要說出「0 筆紀錄」,跟「有紀錄、今天沒到期」分得出來',
            against: ['healthy', 'quiet'],
            // 空 vault(0 筆)跟安靜日(6 筆、今天 0 張到期)都要印「N 張」,而且不同。
            cardinality: { against: 'quiet', re: /\d+ 張/ },
          },
          { kind: 'empty', name: 'reviews.json 是空檔', build: (s) => ({ args: ['--state', file(s, 'reviews.json', ''), '--today', '2026-09-10'] }) },
          { kind: 'missing', name: '--state 不存在', build: (s) => { const p = missingPath(s, 'reviews.json'); return { args: ['--state', p, '--today', '2026-09-10'], mention: p }; } },
          { kind: 'malformed', name: 'reviews.json 是壞 JSON', build: (s) => ({ args: ['--state', file(s, 'reviews.json', '{ "sec-0001": '), '--today', '2026-09-10'] }) },
          { kind: 'wrong-type', name: 'reviews.json 是陣列', build: (s) => ({ args: ['--state', file(s, 'reviews.json', '[]'), '--today', '2026-09-10'] }), against: ['healthy', 'quiet'] },
          { kind: 'wrong-type', name: 'reviews.json 是字串', build: (s) => ({ args: ['--state', file(s, 'reviews.json', '"hello"'), '--today', '2026-09-10'] }) },
          { kind: 'wrong-type', name: 'review 的 stage 是字串', build: (s) => ({ args: ['--state', file(s, 'reviews.json', JSON.stringify({ 'sec-0001': { ...reviewRecord('2026-09-01'), stage: 'two' } })), '--today', '2026-09-10'] }) },
        ],
      },
    ],
  },
  'scripts/grade.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'grade --fill',
        baselines: { healthy: () => ({ args: ['--fill', '--q', join(MINIMAL, 'questions/sec-0001.yaml'), '--index', '1', '--answer', '否'] }) },
        probes: [
          { kind: 'empty', name: '--q 是空 yaml', build: (s) => ({ args: ['--fill', '--q', file(s, 'q.yaml', ''), '--index', '1', '--answer', '否'] }) },
          { kind: 'empty', name: '--q 是 {}', build: (s) => ({ args: ['--fill', '--q', file(s, 'q.yaml', '{}'), '--index', '1', '--answer', '否'] }) },
          { kind: 'missing', name: '--q 不存在', build: (s) => { const p = missingPath(s, 'q.yaml'); return { args: ['--fill', '--q', p, '--index', '1', '--answer', '否'], mention: p }; } },
          { kind: 'malformed', name: '--q 是壞 yaml', build: (s) => ({ args: ['--fill', '--q', file(s, 'q.yaml', 'fill: [\n  - prompt: "a\n'), '--index', '0', '--answer', '否'] }) },
          { kind: 'wrong-type', name: 'fill 是字串', build: (s) => ({ args: ['--fill', '--q', file(s, 'q.yaml', 'fill: hello\n'), '--index', '1', '--answer', '否'] }) },
          { kind: 'wrong-type', name: 'fill 的元素是數字', build: (s) => ({ args: ['--fill', '--q', file(s, 'q.yaml', 'fill:\n  - 5\n  - 6\n'), '--index', '1', '--answer', '否'] }) },
        ],
      },
    ],
  },
  'scripts/ingest.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'ingest --fake',
        baselines: { healthy: (s) => ({ args: ['--fake', '--file', join(FIXTURES, 'raw/security-basics.md'), '--out', join(s, 'out')] }) },
        probes: [
          { kind: 'empty', name: '--file 是空檔', build: (s) => ({ args: ['--fake', '--file', file(s, 'raw.md', '   \n'), '--out', join(s, 'out')] }) },
          { kind: 'missing', name: '--file 不存在', build: (s) => { const p = missingPath(s, 'raw.md'); return { args: ['--fake', '--file', p, '--out', join(s, 'out')], mention: p }; } },
          { kind: 'malformed', name: 'state/ingested.json 是壞 JSON', build: (s) => { file(s, 'out/state/ingested.json', '{ "raw/'); return { args: ['--fake', '--file', join(FIXTURES, 'raw/security-basics.md'), '--out', join(s, 'out')] }; } },
          { kind: 'wrong-type', name: 'state/ingested.json 是陣列', build: (s) => { file(s, 'out/state/ingested.json', '[]'); return { args: ['--fake', '--file', join(FIXTURES, 'raw/security-basics.md'), '--out', join(s, 'out')] }; } },
          { kind: 'wrong-type', name: 'config/categories.yaml 是數字', build: (s) => { file(s, 'out/config/categories.yaml', '5\n'); return { args: ['--fake', '--file', join(FIXTURES, 'raw/security-basics.md'), '--out', join(s, 'out')] }; } },
        ],
      },
    ],
  },
  'scripts/lint.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'lint',
        baselines: { healthy: (s) => ({ args: ['--dir', vault(s)] }) },
        probes: [
          { kind: 'empty', name: '--dir 是空目錄', build: (s) => ({ args: ['--dir', emptyDir(s, 'empty')] }) },
          { kind: 'empty', name: 'cards/ 沒有卡', build: (s) => ({ args: ['--dir', vaultWithoutCards(s)] }) },
          { kind: 'missing', name: '--dir 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--dir', p], mention: p }; } },
          { kind: 'malformed', name: 'graph/deps.json 是壞 JSON', build: (s) => { const d = vault(s); file(d, 'graph/deps.json', '{ "security": '); return { args: ['--dir', d] }; } },
          { kind: 'wrong-type', name: 'graph/deps.json 是陣列', build: (s) => { const d = vault(s); file(d, 'graph/deps.json', '[]'); return { args: ['--dir', d] }; } },
          { kind: 'wrong-type', name: 'state/reviews.json 是陣列', build: (s) => { const d = vault(s); file(d, 'state/reviews.json', '[]'); return { args: ['--dir', d] }; } },
        ],
      },
    ],
  },
  'scripts/llm-spend.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'llm-spend',
        // 每一次 spawn 都帶 SPEND_ENV(見該常數的註解):基線與探針都不靠 .env 或 shell。
        baselines: {
          healthy: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `${llmCallLine(SPEND_DAY)}\n${llmCallLine(SPEND_DAY)}\n`)], env: SPEND_ENV }),
          quiet: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `${llmCallLine('2026-08-01')}\n`)], env: SPEND_ENV }),
        },
        probes: [
          {
            kind: 'empty',
            name: 'log.jsonl 是空檔',
            build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', '')], env: SPEND_ENV }),
            legitZero: '剛 init 的 vault 就是空的 log,還沒花過錢是事實。訊息帶「0 次呼叫」,跟有花費的那天分得出來',
          },
          {
            kind: 'missing',
            name: '--log 不存在',
            build: (s) => { const p = missingPath(s, 'log.jsonl'); return { args: ['--day', SPEND_DAY, '--log', p], env: SPEND_ENV, mention: p }; },
          },
          {
            // 缺的不是檔案是環境變數:log 健康、cap 是**空字串**(不是 unset)。
            // 為什麼是空字串:探針的 env 疊在 process.env 上,真的把 key 拿掉(`undefined`)在有 `.env`
            // 的機器上會被 `_env.ts` 的 loadEnvFile 補回一個值 → exit 0 → 探針紅;loadEnvFile 不會蓋掉
            // 已存在的變數(含空字串),所以空字串是唯一不受 `.env` 影響、又必定 exit 2 的形狀。
            // 代價:這條踩的是 strictNumberEnv 的「是空的」分支,不是「沒有設定」分支——審核輪破壞驗證
            // 過:把「沒有設定」改回 0 這條仍綠,把「是空的」改回 0 這條才紅。真正 unset 的分支由
            // scripts/llm-spend.test.ts 的「LLM_DAILY_CAP_USD 沒設」守(純函式,env 用參數傳,不碰 .env)。
            // 要 exit 2 而且點名是哪個變數——就是乾淨簽出時基線壞掉的那條訊息,現在當探針守著。
            kind: 'missing',
            name: 'LLM_DAILY_CAP_USD 是空字串(unset 由 llm-spend.test.ts 守)',
            build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `${llmCallLine(SPEND_DAY)}\n`)], env: { ...SPEND_ENV, LLM_DAILY_CAP_USD: '' }, mention: 'LLM_DAILY_CAP_USD' }),
          },
          { kind: 'malformed', name: 'log.jsonl 每一行都是壞 JSON', build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', '{ "ts": \n{{{\n')], env: SPEND_ENV }), against: ['healthy', 'quiet'] },
          { kind: 'wrong-type', name: 'log.jsonl 每一行都是數字', build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', '5\n6\n')], env: SPEND_ENV }), against: ['healthy', 'quiet'] },
          { kind: 'wrong-type', name: 'log.jsonl 是一個 JSON 陣列', build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `[${llmCallLine(SPEND_DAY)}]\n`)], env: SPEND_ENV }), against: ['healthy', 'quiet'] },
        ],
      },
    ],
  },
  'scripts/llm.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'llm',
        baselines: {},
        noBaseline: '每一條健康路徑(--probe、--task … --prompt …)都打網路;這裡只探參數層,不比基線',
        omit: { malformed: '任何帶合法 task 的呼叫都會真的打網路,沒有離線的壞輸入可探' },
        probes: [
          { kind: 'empty', name: '--task 與 --prompt 都是空字串', build: () => ({ args: ['--task', '', '--prompt', ''] }) },
          { kind: 'missing', name: '沒有 --prompt', build: () => ({ args: ['--task', 'deepen'] }) },
          { kind: 'missing', name: '完全沒有參數', build: () => ({ args: [] }) },
          { kind: 'wrong-type', name: '--task 不在契約裡', build: () => ({ args: ['--task', 'bogus', '--prompt', 'x'] }) },
        ],
      },
    ],
  },
  'scripts/prompt-check.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'prompt-check --golden',
        baselines: { healthy: (s) => ({ args: ['--golden', '--fake', '--out', join(s, 'out')] }) },
        omit: { empty: 'golden 的輸入是程式裡的登記表,不是檔案;沒有「空輸入」這回事' },
        probes: [
          { kind: 'missing', name: '--out 沒給值', build: () => ({ args: ['--golden', '--fake', '--out'] }) },
          { kind: 'malformed', name: '--out 指到一個檔案', build: (s) => ({ args: ['--golden', '--fake', '--out', file(s, 'out', 'i am a file')] }) },
          { kind: 'wrong-type', name: '--set 不存在的 golden set', build: (s) => ({ args: ['--golden', '--fake', '--set', 'no-such-set', '--out', join(s, 'out')] }) },
        ],
      },
      {
        label: 'prompt-check --diff',
        baselines: { healthy: (s) => ({ args: ['--diff', goldenRun(s, 'a'), goldenRun(s, 'b')] }) },
        probes: [
          { kind: 'empty', name: '兩個 run 目錄都是空的', build: (s) => ({ args: ['--diff', emptyDir(s, 'a'), emptyDir(s, 'b')] }) },
          { kind: 'missing', name: 'run 目錄不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--diff', goldenRun(s, 'a'), p], mention: p }; } },
          { kind: 'malformed', name: 'meta.json 是壞 JSON', build: (s) => { const b = emptyDir(s, 'b'); file(b, 'meta.json', '{ "set": '); return { args: ['--diff', goldenRun(s, 'a'), b] }; } },
          { kind: 'wrong-type', name: 'meta.json 是陣列', build: (s) => { const b = emptyDir(s, 'b'); file(b, 'meta.json', '[]'); return { args: ['--diff', goldenRun(s, 'a'), b] }; } },
        ],
      },
    ],
  },
  'scripts/review.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'review --dry-run',
        baselines: {
          healthy: (s) => { const d = vault(s); file(d, 'state/reviews.json', JSON.stringify({ 'sec-0001': reviewRecord('2026-09-01'), 'sec-0002': reviewRecord('2026-09-04') })); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; },
          quiet: (s) => { const d = vault(s); file(d, 'state/reviews.json', JSON.stringify({ 'sec-0001': reviewRecord('2026-12-01'), 'sec-0002': reviewRecord('2026-12-02'), 'sec-0003': reviewRecord('2026-12-03') })); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; },
        },
        probes: [
          { kind: 'empty', name: '--dir 是空目錄', build: (s) => ({ args: ['--dir', emptyDir(s, 'empty'), '--today', '2026-09-04', '--dry-run'] }) },
          { kind: 'empty', name: 'cards/ 沒有卡', build: (s) => ({ args: ['--dir', vaultWithoutCards(s), '--today', '2026-09-04', '--dry-run'] }) },
          {
            kind: 'empty',
            name: 'reviews.json 是 {}',
            build: (s) => { const d = vault(s); file(d, 'state/reviews.json', '{}'); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; },
            legitZero: 'review.test.ts 的邊界 2:{} 跟「檔案不存在」都是「還沒開始複習」,正常。訊息帶「3 張卡、0 張到期、3 張未排程」,跟安靜日分得出來',
            against: ['healthy', 'quiet'],
          },
          { kind: 'missing', name: '--dir 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--dir', p, '--today', '2026-09-04', '--dry-run'], mention: p }; } },
          { kind: 'missing', name: 'config/settings.yaml 不存在', build: (s) => { const d = vault(s); const p = join(d, 'config/settings.yaml'); rmSync(p); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'], mention: p }; } },
          { kind: 'malformed', name: 'reviews.json 是壞 JSON', build: (s) => { const d = vault(s); file(d, 'state/reviews.json', '{ "sec-0001": '); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; } },
          { kind: 'malformed', name: 'reviews.json 是空檔', build: (s) => { const d = vault(s); file(d, 'state/reviews.json', ''); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; } },
          { kind: 'wrong-type', name: 'reviews.json 是陣列', build: (s) => { const d = vault(s); file(d, 'state/reviews.json', '[]'); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; }, against: ['healthy', 'quiet'] },
          { kind: 'wrong-type', name: 'review 是數字', build: (s) => { const d = vault(s); file(d, 'state/reviews.json', '{ "sec-0001": 5 }'); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; } },
          { kind: 'wrong-type', name: 'settings.yaml 是陣列', build: (s) => { const d = vault(s); file(d, 'config/settings.yaml', '[]\n'); return { args: ['--dir', d, '--today', '2026-09-04', '--dry-run'] }; } },
        ],
      },
    ],
  },
  'scripts/snapshot.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'snapshot',
        baselines: { healthy: (s) => ({ args: ['--dir', ownGitRepo(s, true)], env: GIT_IDENTITY }) },
        probes: [
          {
            kind: 'empty',
            name: '是 repo 但沒有變更',
            build: (s) => ({ args: ['--dir', ownGitRepo(s, false)], env: GIT_IDENTITY }),
            legitZero: '正當的 exit 0 的範本:「沒有變更,不建立 snapshot。」說清楚了發生什麼事,而且跟「已建立」不同',
          },
          { kind: 'empty', name: '--dir 是空目錄(不是 repo)', build: (s) => ({ args: ['--dir', emptyDir(s, 'empty')], env: GIT_IDENTITY }) },
          { kind: 'missing', name: '--dir 不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['--dir', p], env: GIT_IDENTITY, mention: p }; } },
          { kind: 'malformed', name: '--dir 指到一個檔案', build: (s) => ({ args: ['--dir', file(s, 'a-file', 'x')], env: GIT_IDENTITY }) },
          { kind: 'wrong-type', name: '.git 是一個垃圾檔', build: (s) => { const d = emptyDir(s, 'fake'); file(d, '.git', 'not a git dir'); return { args: ['--dir', d], env: GIT_IDENTITY }; } },
        ],
      },
    ],
  },
  'scripts/weekly.ts': {
    kind: 'entry',
    commands: [
      {
        label: 'weekly',
        baselines: { healthy: () => ({ args: ['--state', join(FIXTURES, 'weekly/mid-week.json'), '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'] }) },
        probes: [
          { kind: 'empty', name: 'weekly.json 是 {}', build: (s) => ({ args: ['--state', file(s, 'weekly.json', '{}'), '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'] }) },
          { kind: 'empty', name: 'weekly.json 是空檔', build: (s) => ({ args: ['--state', file(s, 'weekly.json', ''), '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'] }) },
          { kind: 'missing', name: '--state 不存在', build: (s) => { const p = missingPath(s, 'weekly.json'); return { args: ['--state', p, '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'], mention: p }; } },
          { kind: 'malformed', name: 'weekly.json 是壞 JSON', build: (s) => ({ args: ['--state', file(s, 'weekly.json', '{ "week": '), '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'] }) },
          { kind: 'wrong-type', name: 'weekly.json 是陣列', build: (s) => ({ args: ['--state', file(s, 'weekly.json', '[]'), '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'] }) },
          { kind: 'wrong-type', name: 'target 是字串、counted 是數字', build: (s) => ({ args: ['--state', file(s, 'weekly.json', JSON.stringify({ week: '2026-W37', target: 'seven', learned: 1, passed_d1: 1, counted: 3 })), '--event', 'pass-d1', '--card', 'sec-0009', '--today', '2026-09-10'] }) },
        ],
      },
    ],
  },

  // ── 01-data-layer 的 CLI,八個子命令 ──
  [SCHEMA_CLI]: {
    kind: 'entry',
    commands: [
      {
        label: 'validate',
        baselines: { healthy: () => ({ args: ['validate', join(FIXTURES, 'cards/valid-basic.md')] }) },
        probes: [
          { kind: 'empty', name: '空檔', build: (s) => ({ args: ['validate', file(s, 'card.md', '')] }) },
          { kind: 'missing', name: '檔案不存在', build: (s) => { const p = missingPath(s, 'card.md'); return { args: ['validate', p], mention: p }; } },
          { kind: 'malformed', name: 'frontmatter 是壞 yaml', build: (s) => ({ args: ['validate', file(s, 'card.md', '---\nid: [\n---\nbody\n')] }) },
          { kind: 'wrong-type', name: 'id 是數字、level 是字串', build: (s) => ({ args: ['validate', file(s, 'card.md', '---\nid: 5\ncategory: security\ntitle: t\nlevel: high\nsource: llm\ncreated: 2026-01-01\n---\nbody\n')] }) },
        ],
      },
      {
        label: 'init',
        baselines: { healthy: (s) => ({ args: ['init', join(s, 'new-vault')], env: GIT_IDENTITY }) },
        omit: {
          empty: '空目錄(或不存在的目錄)就是 init 的正常輸入,跟 healthy 是同一件事',
          'wrong-type': 'init 只建缺的檔案、不讀任何檔案的內容;讀的那一邊是 validate-settings / validate-category',
        },
        probes: [
          { kind: 'missing', name: '沒有給目錄', build: () => ({ args: ['init'] }) },
          { kind: 'malformed', name: '目錄位置是一個檔案', build: (s) => ({ args: ['init', file(s, 'a-file', 'x')], env: GIT_IDENTITY }) },
        ],
      },
      {
        label: 'validate-question',
        baselines: { healthy: () => ({ args: ['validate-question', join(MINIMAL, 'questions/sec-0001.yaml')] }) },
        probes: [
          { kind: 'empty', name: '空 yaml', build: (s) => ({ args: ['validate-question', file(s, 'q.yaml', '')] }) },
          { kind: 'empty', name: '{}', build: (s) => ({ args: ['validate-question', file(s, 'q.yaml', '{}')] }) },
          { kind: 'missing', name: '檔案不存在', build: (s) => { const p = missingPath(s, 'q.yaml'); return { args: ['validate-question', p], mention: p }; } },
          { kind: 'malformed', name: '壞 yaml', build: (s) => ({ args: ['validate-question', file(s, 'q.yaml', 'fill: [\n  - prompt: "a\n')] }) },
          { kind: 'wrong-type', name: '頂層是陣列', build: (s) => ({ args: ['validate-question', file(s, 'q.yaml', '- 1\n- 2\n')] }) },
        ],
      },
      {
        label: 'validate-review',
        baselines: { healthy: () => ({ args: ['validate-review', join(FIXTURES, 'reviews/mid-cycle.json')] }) },
        probes: [
          {
            kind: 'empty',
            name: '{}',
            build: (s) => ({ args: ['validate-review', file(s, 'reviews.json', '{}')] }),
            legitZero: '{} 是合法的 reviews.json(還沒開始複習,review.test.ts 邊界 2)。但「OK」必須帶筆數,0 筆跟 6 筆不可以印一樣的字',
          },
          { kind: 'empty', name: '空檔', build: (s) => ({ args: ['validate-review', file(s, 'reviews.json', '')] }) },
          { kind: 'missing', name: '檔案不存在', build: (s) => { const p = missingPath(s, 'reviews.json'); return { args: ['validate-review', p], mention: p }; } },
          { kind: 'malformed', name: '壞 JSON', build: (s) => ({ args: ['validate-review', file(s, 'reviews.json', '{ "sec-0001": ')] }) },
          { kind: 'wrong-type', name: '頂層是陣列', build: (s) => ({ args: ['validate-review', file(s, 'reviews.json', '[]')] }) },
          { kind: 'wrong-type', name: '頂層是字串', build: (s) => ({ args: ['validate-review', file(s, 'reviews.json', '"hello"')] }) },
          { kind: 'wrong-type', name: 'review 是數字', build: (s) => ({ args: ['validate-review', file(s, 'reviews.json', '{ "sec-0001": 5 }')] }) },
        ],
      },
      {
        label: 'validate-log',
        baselines: { healthy: () => ({ args: ['validate-log', join(MINIMAL, 'state/log.jsonl')] }) },
        probes: [
          {
            kind: 'empty',
            name: '空檔',
            build: (s) => ({ args: ['validate-log', file(s, 'log.jsonl', '')] }),
            legitZero: '剛 init 的 vault 的 log.jsonl 就是空的,合法。但「OK」必須帶行數,0 行跟 N 行不可以印一樣的字',
          },
          { kind: 'missing', name: '檔案不存在', build: (s) => { const p = missingPath(s, 'log.jsonl'); return { args: ['validate-log', p], mention: p }; } },
          { kind: 'malformed', name: '有一行壞 JSON', build: (s) => ({ args: ['validate-log', file(s, 'log.jsonl', '{ "ts": \n')] }) },
          { kind: 'wrong-type', name: '每一行都是數字', build: (s) => ({ args: ['validate-log', file(s, 'log.jsonl', '5\n6\n')] }) },
        ],
      },
      {
        label: 'validate-category',
        baselines: { healthy: () => ({ args: ['validate-category', join(MINIMAL, 'config/categories.yaml')] }) },
        probes: [
          { kind: 'empty', name: '空 yaml', build: (s) => ({ args: ['validate-category', file(s, 'categories.yaml', '')] }) },
          {
            kind: 'empty',
            name: '[]',
            build: (s) => ({ args: ['validate-category', file(s, 'categories.yaml', '[]\n')] }),
            legitZero: 'ensureInitialized 寫出來的 categories.yaml 就是 [],schema 上合法。但「OK」必須帶筆數,0 個類別跟 1 個不可以印一樣的字',
          },
          { kind: 'missing', name: '檔案不存在', build: (s) => { const p = missingPath(s, 'categories.yaml'); return { args: ['validate-category', p], mention: p }; } },
          { kind: 'malformed', name: '壞 yaml', build: (s) => ({ args: ['validate-category', file(s, 'categories.yaml', '- id: [\n')] }) },
          { kind: 'wrong-type', name: '頂層是物件', build: (s) => ({ args: ['validate-category', file(s, 'categories.yaml', 'id: security\n')] }) },
          { kind: 'wrong-type', name: '頂層是字串', build: (s) => ({ args: ['validate-category', file(s, 'categories.yaml', 'hello\n')] }) },
          { kind: 'wrong-type', name: '元素是數字', build: (s) => ({ args: ['validate-category', file(s, 'categories.yaml', '- 5\n')] }) },
        ],
      },
      {
        label: 'validate-settings',
        baselines: { healthy: () => ({ args: ['validate-settings', join(MINIMAL, 'config/settings.yaml')] }) },
        probes: [
          { kind: 'empty', name: '空 yaml', build: (s) => ({ args: ['validate-settings', file(s, 'settings.yaml', '')] }) },
          { kind: 'empty', name: '{}', build: (s) => ({ args: ['validate-settings', file(s, 'settings.yaml', '{}')] }) },
          { kind: 'missing', name: '檔案不存在', build: (s) => { const p = missingPath(s, 'settings.yaml'); return { args: ['validate-settings', p], mention: p }; } },
          { kind: 'malformed', name: '壞 yaml', build: (s) => ({ args: ['validate-settings', file(s, 'settings.yaml', 'daily_cap: [\n')] }) },
          { kind: 'wrong-type', name: '頂層是陣列', build: (s) => ({ args: ['validate-settings', file(s, 'settings.yaml', '- 1\n')] }) },
          { kind: 'wrong-type', name: 'daily_cap 是字串', build: (s) => ({ args: ['validate-settings', file(s, 'settings.yaml', 'daily_cap: ten\nweekly_target: 7\nshort_body_limit: 50\nllm:\n  cloud_provider: anthropic\n  cloud_model: x\n  local_model: y\n')] }) },
        ],
      },
      {
        label: 'check-questions',
        baselines: { healthy: (s) => ({ args: ['check-questions', vault(s)] }) },
        omit: { 'wrong-type': '只看檔名對不對得上,不讀任何檔案的內容' },
        probes: [
          { kind: 'empty', name: '空目錄', build: (s) => ({ args: ['check-questions', emptyDir(s, 'empty')] }) },
          { kind: 'empty', name: 'cards/ 沒有卡', build: (s) => ({ args: ['check-questions', vaultWithoutCards(s)] }) },
          { kind: 'missing', name: '目錄不存在', build: (s) => { const p = missingPath(s, 'nope'); return { args: ['check-questions', p], mention: p }; } },
          { kind: 'malformed', name: 'cards/ 是一個檔案', build: (s) => { const d = emptyDir(s, 'v'); file(d, 'cards', 'i am a file'); return { args: ['check-questions', d] }; } },
        ],
      },
    ],
  },
};
