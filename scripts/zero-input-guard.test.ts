/**
 * 零輸入守門(P-44 升類):每一支 CLI 入口對「空 / 缺 / 壞」輸入的行為,一張表管到底。
 *
 * 為什麼升類:同一種洞(空的跟健康的長一樣、缺檔噴 stack、壞 JSON 吐裸 JS 錯誤)
 * 連續三輪都還找得到——第一輪 lint.ts / review.ts,第二輪 check-questions / due.ts /
 * llm-spend.ts / weekly.ts,第三輪 validate-log / validate-review / validate-category /
 * grade.ts / check-standalone。靠人記得去 grep 已經證明不夠,所以寫成常設測試。
 *
 * 規則(每一個入口、每一種輸入形狀都套):
 *
 *   1. **退出碼非 0**。例外只有「正當的空狀態」(`legitZero`),而且要寫理由。
 *      正當的判準是 snapshot.ts「是 repo 但無變更」與 review.ts「有卡但今天 0 張到期」:
 *      **訊息說清楚了發生什麼事、而且跟異常狀態的訊息不同**。壞輸入(malformed / wrong-type)
 *      永遠不可以是正當的 exit 0——型別上就不給填 `legitZero`。
 *   2. **不噴裸 stack trace、不吐裸引擎訊息**(`Cannot read properties…`、`Unexpected end of
 *      JSON input`、`ENOENT: …` 開頭的一行……)。使用者要看到的是「哪個檔案怎麼了」,
 *      不是 V8 的內心話。包了前後文的訊息可以帶引擎細節(weekly.ts 的
 *      「讀不到 --state 指定的檔案:<path>(…)」就是這種),所以判的是**整行以引擎話開頭**。
 *   3. **跟健康輸入的輸出不同**(正規化掉路徑、日期、毫秒之後比)。這是整批的核心:
 *      `{}` 的 reviews.json 印「OK」、三筆的 reviews.json 也印「OK」,就是洞。
 *      正當的 exit 0 一樣要過這條——「沒有變更」跟「commit 了」本來就不該長一樣。
 *   4. **缺輸入時要指名那條路徑**(`mention`),使用者才拿得去 ls。
 *
 * 清單(ROSTER)本身在這個檔案裡,而且**磁碟上每一個 `scripts/*.ts` 與
 * `packages/core/src/**\/cli.ts` 都必須在清單裡**——沒進清單就紅。不是入口的檔案
 * (`_env.ts` 這種 side-effect 模組、被別的入口包起來的 library、真的沒辦法便宜地探的
 * `mutate.ts`)也要列,標上種類跟理由。這條的反向驗證見 describe('清單完整性')。
 *
 * P-50 的形狀(讀 state/ config/ 之後直接 cast,不驗 schema)在這裡的 `wrong-type`
 * 探針裡:合法 JSON 但型別不符(`[]` 當 `{}` 用、`5` 當物件用)→ 不可以捏造出一個
 * 「正常」的結果。那張工單修 `readJson<T>` 的簽章;這裡的探針會自動擋住之後新增的 cast。
 *
 * 測法:一律臨時目錄(CLAUDE.md 硬規則 2:不碰 raw/ 與使用者的 learning/)。所有子行程
 * 在 beforeAll 用小型工作池一起跑完(單獨 spawnSync 一百多次要好幾分鐘),測試本身只讀結果。
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const MINIMAL = join(REPO_ROOT, 'contracts/fixtures/learning-minimal');
const FIXTURES = join(REPO_ROOT, 'contracts/fixtures');
const SCRATCH_PREFIX = 'lc-zig-';

/** 一個子行程的上限。tsx 冷啟動一到三秒,phase-coverage 真跑 cucumber dry-run 要十幾秒。 */
const SPAWN_TIMEOUT_MS = 90_000;
/** 全部跑完的上限(beforeAll)。 */
const SUITE_TIMEOUT_MS = 600_000;
/** 同時開幾個子行程。 */
const POOL_SIZE = 8;

// ───────────────────────────────────────────────────────────────── 型別

type Kind = 'empty' | 'missing' | 'malformed' | 'wrong-type';
const KINDS: readonly Kind[] = ['empty', 'missing', 'malformed', 'wrong-type'];

interface Invocation {
  /** 傳給入口的參數(入口路徑由清單的 key 決定)。 */
  args: string[];
  /** 預設 REPO_ROOT。守門腳本的 ROOT 是從 cwd 的 git 頂層解析的,cwd 換到暫存目錄就等於「對一個空 repo 跑」。 */
  cwd?: string;
  env?: Record<string, string>;
  /** 輸出裡必須出現的字串(通常是缺掉的那條路徑)。 */
  mention?: string;
}

type Builder = (scratch: string) => Invocation;

interface ProbeBase {
  name: string;
  build: Builder;
  /** 要跟哪幾個基線比「不可以長一樣」。預設只比 healthy。 */
  against?: readonly string[];
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

interface Command {
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

type Entry =
  | { kind: 'entry'; commands: Command[] }
  /** side-effect / 共用模組,不是可以執行的入口。 */
  | { kind: 'helper'; reason: string }
  /** 邏輯本體,由另一個入口包起來執行;探針打那個入口。 */
  | { kind: 'library'; via: string; reason: string }
  /** 真的沒辦法便宜地探。理由要說清楚為什麼,以及參數處理在哪裡有測。 */
  | { kind: 'excluded'; reason: string };

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

/**
 * check-phase-coverage 不帶 --list 就會真的起 cucumber:段一 dry-run 一個資料夾約十秒,
 * 段二會把 done / in-progress 的 phase 真跑一遍(幾分鐘)。`--run-phases` 指一個不存在的
 * key,段二就一個都不跑;探的是設定檔怎麼被讀,不是 cucumber。
 */
const ONE_FOLDER_DRY_RUN = ['--only', '01-data-layer', '--run-phases', 'nope/phase-9'];

const OWNERS_OK = JSON.stringify({ owners: [['scripts/', 'infra']], glue: ['infra'], aliases: [], scanDirs: ['scripts'], contractsOwner: 'contracts' });

// ───────────────────────────────────────────────────────────────── 清單

const SCHEMA_CLI = 'packages/core/src/schema/cli.ts';

const ROSTER: Record<string, Entry> = {
  // ── 共用模組,不是入口 ──
  'scripts/_env.ts': { kind: 'helper', reason: 'side-effect import(ADR-034 的 .env 載入),沒有 main、沒有參數' },
  'scripts/_root.ts': { kind: 'helper', reason: '守門腳本共用的 repo 根與設定檔解析(模板 v1.3.4),只 export 函式' },

  // ── 邏輯本體在 core、入口在 scripts ──
  'packages/core/src/prompt-quality/cli.ts': {
    kind: 'library',
    via: 'scripts/prompt-check.ts',
    reason: 'export main(argv) 給 scripts/prompt-check.ts 呼叫,直接執行什麼都不做',
  },

  // ── 真的沒辦法便宜地探 ──
  'scripts/mutate.ts': {
    kind: 'excluded',
    reason:
      'Stryker 的包裝:任何參數都會拿鎖、真的起 Stryker 跑幾分鐘到幾十分鐘,輸入處理是 Stryker 的不是它的。' +
      '參數轉換(strykerArgs)與鎖的行為在 scripts/mutate.test.ts 用注入的假 runStryker 測。',
  },

  // ── 守門腳本(模板 v1.3.4,勿手改;這裡的紅燈走模板升版,不直接改檔) ──
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
        baselines: {
          healthy: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `${llmCallLine(SPEND_DAY)}\n${llmCallLine(SPEND_DAY)}\n`)] }),
          quiet: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `${llmCallLine('2026-08-01')}\n`)] }),
        },
        probes: [
          {
            kind: 'empty',
            name: 'log.jsonl 是空檔',
            build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', '')] }),
            legitZero: '剛 init 的 vault 就是空的 log,還沒花過錢是事實。訊息帶「0 次呼叫」,跟有花費的那天分得出來',
          },
          {
            kind: 'missing',
            name: '--log 不存在',
            build: (s) => { const p = missingPath(s, 'log.jsonl'); return { args: ['--day', SPEND_DAY, '--log', p], mention: p }; },
          },
          { kind: 'malformed', name: 'log.jsonl 每一行都是壞 JSON', build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', '{ "ts": \n{{{\n')] }), against: ['healthy', 'quiet'] },
          { kind: 'wrong-type', name: 'log.jsonl 每一行都是數字', build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', '5\n6\n')] }), against: ['healthy', 'quiet'] },
          { kind: 'wrong-type', name: 'log.jsonl 是一個 JSON 陣列', build: (s) => ({ args: ['--day', SPEND_DAY, '--log', file(s, 'log.jsonl', `[${llmCallLine(SPEND_DAY)}]\n`)] }), against: ['healthy', 'quiet'] },
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

// ───────────────────────────────────────────────────────────────── 磁碟上的入口

/** 這兩條規則就是「哪些檔案必須在清單裡」。改這裡等於改守門範圍,要有理由。 */
export function entryFilesOnDisk(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, 'scripts'))) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    out.push(`scripts/${name}`);
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'cli.ts') out.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(join(root, 'packages/core/src'));
  return out.sort();
}

/** 純函式,給反向驗證用:磁碟上有、清單裡沒有的檔案。 */
export function missingFromRoster(onDisk: readonly string[], rosterKeys: readonly string[]): string[] {
  const listed = new Set(rosterKeys);
  return onDisk.filter((f) => !listed.has(f));
}

// ───────────────────────────────────────────────────────────────── 執行

interface RunResult {
  code: number;
  output: string;
  scratch: string;
  timedOut: boolean;
  /** build 時算出來的「輸出裡必須出現的字串」,執行後不再重建 fixture。 */
  mention?: string;
}

function withoutNodeOptions(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _dropped, ...rest } = env;
  return rest;
}

function runEntry(entryFile: string, inv: Invocation, scratch: string): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [TSX_CLI, join(REPO_ROOT, entryFile), ...inv.args], {
      cwd: inv.cwd ?? REPO_ROOT,
      env: { ...withoutNodeOptions(process.env), ...inv.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stdin.end();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, SPAWN_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ code: -1, output: `${out}\n(spawn error) ${String(err)}`, scratch, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, output: out, scratch, timedOut });
    });
  });
}

async function pool<T>(jobs: readonly (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = new Array<T>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      results[i] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  return results;
}

const scratchDirs: string[] = [];
function newScratch(): string {
  const d = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
  scratchDirs.push(d);
  return d;
}

/** key = `${file}::${label}::${probe|baseline}` */
const results = new Map<string, RunResult>();
const resultKey = (file: string, label: string, name: string): string => `${file}::${label}::${name}`;

function getResult(file: string, label: string, name: string): RunResult {
  const r = results.get(resultKey(file, label, name));
  if (!r) throw new Error(`沒有這一筆的執行結果(beforeAll 沒跑到?):${resultKey(file, label, name)}`);
  if (r.timedOut) throw new Error(`子行程逾時 ${SPAWN_TIMEOUT_MS} ms:${resultKey(file, label, name)}\n${r.output}`);
  return r;
}

const entryCommands = (): { file: string; command: Command }[] =>
  Object.entries(ROSTER).flatMap(([file, entry]) => (entry.kind === 'entry' ? entry.commands.map((command) => ({ file, command })) : []));

beforeAll(async () => {
  const jobs: (() => Promise<void>)[] = [];
  for (const { file: entryFile, command } of entryCommands()) {
    const all: { name: string; build: Builder }[] = [
      ...Object.entries(command.baselines).map(([name, build]) => ({ name: `baseline:${name}`, build })),
      ...command.probes.map((p) => ({ name: `probe:${p.name}`, build: p.build })),
    ];
    for (const { name, build } of all) {
      jobs.push(async () => {
        const scratch = newScratch();
        const inv = build(scratch);
        const r = await runEntry(entryFile, inv, scratch);
        results.set(resultKey(entryFile, command.label, name), inv.mention === undefined ? r : { ...r, mention: inv.mention });
      });
    }
  }
  await pool(jobs, POOL_SIZE);
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  for (const d of scratchDirs) rmSync(d, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────── 判準

/** Node 的 stack frame:`    at foo (/x/y.ts:12:3)` / `    at file:///x/y.ts:12:3`。 */
const STACK_FRAME = /^\s+at\s+(?:\S.*\s\()?(?:file:\/\/|node:|\/)[^\n]*:\d+:\d+\)?\s*$/m;

/**
 * 一行以引擎的話開頭。判「開頭」不判「包含」:weekly.ts 的
 * 「讀不到 --state 指定的檔案:<path>(Unexpected end of JSON input)」有前後文,可以;
 * grade.ts 直接 console.error(err.message) 印出來的
 * 「Cannot read properties of null (reading 'fill')」不行。
 */
const BARE_ENGINE_LINE = new RegExp(
  '^\\s*(?:' +
    [
      '(?:Type|Syntax|Reference|Range|Zod)?Error\\b',
      'Cannot read propert',
      'Cannot convert undefined or null',
      'Unexpected token',
      'Unexpected end of JSON',
      'Unexpected non-whitespace',
      'E[A-Z]{3,}:', // ENOENT: / EISDIR: / ENOTDIR: …
      '\\S.* is not a function',
      '\\S.* is not iterable',
      '\\S.* is not defined',
      '\\[object Object\\]',
      '✖ ', // zod v4 的 prettifyError 開頭
      'undefined$',
      'null$',
      'NaN$',
    ].join('|') +
    ')',
  'm',
);

export function bareEngineSpeak(output: string): string | null {
  const frame = STACK_FRAME.exec(output);
  if (frame) return `stack frame:${frame[0].trim()}`;
  const line = BARE_ENGINE_LINE.exec(output);
  if (line) return `裸引擎訊息:${line[0].trim()}`;
  return null;
}

const SCRATCH_RE = new RegExp(join(tmpdir(), SCRATCH_PREFIX).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^/\\s"\'()]+', 'g');
const ROOT_RE = new RegExp(REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/** 路徑、日期、毫秒都不算差異——差異要出在「說了什麼」。 */
export function normalize(output: string): string {
  return output
    .replace(SCRATCH_RE, '<SCRATCH>')
    .replace(ROOT_RE, '<ROOT>')
    .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g, '<DATE>')
    .replace(/\d{4}-W\d{2}/g, '<WEEK>')
    .replace(/\(\d+ ms\)/g, '(<N> ms)')
    .trim();
}

function describeRun(r: RunResult): string {
  return `exit=${r.code}\n--- output ---\n${r.output.trim() || '(沒有輸出)'}\n--------------`;
}

// ───────────────────────────────────────────────────────────────── 測試

describe('清單完整性:磁碟上每一個入口都要在 ROSTER 裡', () => {
  const onDisk = entryFilesOnDisk(REPO_ROOT);
  const keys = Object.keys(ROSTER);

  it('掃描器本身要掃得到東西(0 個入口就是掃描器壞了,不是很乾淨)', () => {
    expect(onDisk.length).toBeGreaterThan(10);
    expect(onDisk).toContain('scripts/lint.ts');
    expect(onDisk).toContain(SCHEMA_CLI);
  });

  it('新增一個 scripts/*.ts 或 packages/core/src/**/cli.ts 卻沒進清單 → 紅', () => {
    const missing = missingFromRoster(onDisk, keys);
    expect(missing, `這些入口不在 ROSTER 裡,補進去(是入口就加探針;不是入口就標 helper/library/excluded 並寫理由):\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('清單裡的檔案都還在磁碟上(刪了入口就把它從清單拿掉)', () => {
    const gone = keys.filter((k) => !onDisk.includes(k));
    expect(gone, `ROSTER 指到已經不存在的檔案:${gone.join(', ')}`).toEqual([]);
  });

  it('反向驗證(純函式):多一個 scripts/_probe.ts 就會被抓出來', () => {
    // 用合成的清單,不用磁碟上的——這條測的是判斷本身,不受工作樹裡剛好有什麼影響。
    expect(missingFromRoster(['scripts/lint.ts', 'scripts/_probe.ts'], keys)).toEqual(['scripts/_probe.ts']);
    expect(missingFromRoster([SCHEMA_CLI, 'packages/core/src/newthing/cli.ts'], keys)).toEqual(['packages/core/src/newthing/cli.ts']);
    expect(missingFromRoster(['scripts/lint.ts', SCHEMA_CLI], keys)).toEqual([]);
  });

  it('不是入口的檔案要有理由;library 的 via 要指到清單裡的一個入口', () => {
    for (const [file, entry] of Object.entries(ROSTER)) {
      if (entry.kind === 'entry') continue;
      expect(entry.reason.trim().length, `${file} 的理由是空的`).toBeGreaterThan(10);
      if (entry.kind === 'library') {
        const target = ROSTER[entry.via];
        expect(target?.kind, `${file} 的 via 指到 ${entry.via},那不是清單裡的入口`).toBe('entry');
      }
    }
  });

  it('每個命令四種輸入形狀都要有探針,略過的要寫理由;legitZero 要有理由', () => {
    for (const { file, command } of entryCommands()) {
      for (const kind of KINDS) {
        const has = command.probes.some((p) => p.kind === kind);
        const omitted = command.omit?.[kind];
        expect(has || Boolean(omitted), `${file} ${command.label}:沒有 ${kind} 的探針,也沒有在 omit 寫理由`).toBe(true);
        expect(has && Boolean(omitted), `${file} ${command.label}:${kind} 既有探針又寫了 omit,二選一`).toBe(false);
      }
      for (const p of command.probes) {
        if ('legitZero' in p && p.legitZero !== undefined) {
          expect(p.legitZero.trim().length, `${file} ${command.label} ${p.name}:legitZero 的理由太短`).toBeGreaterThan(10);
        }
        for (const b of p.against ?? []) {
          expect(Object.keys(command.baselines), `${file} ${command.label} ${p.name}:against 指到不存在的基線 ${b}`).toContain(b);
        }
      }
      if (Object.keys(command.baselines).length === 0) {
        expect(command.noBaseline?.trim().length ?? 0, `${file} ${command.label}:沒有基線要寫理由`).toBeGreaterThan(10);
      } else {
        expect(command.baselines.healthy, `${file} ${command.label}:基線一定要有 healthy`).toBeDefined();
        expect(command.noBaseline, `${file} ${command.label}:有基線就不該寫 noBaseline`).toBeUndefined();
      }
    }
  });
});

describe('判準本身', () => {
  it('抓得到 stack frame 與裸引擎訊息', () => {
    expect(bareEngineSpeak("SyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n    at file:///x/due.ts:25:22")).toMatch(/stack frame|裸引擎/);
    expect(bareEngineSpeak("Cannot read properties of null (reading 'fill')")).toMatch(/裸引擎/);
    expect(bareEngineSpeak("ENOENT: no such file or directory, open '/x/q.yaml'")).toMatch(/裸引擎/);
    expect(bareEngineSpeak('✖ Invalid input: expected object, received array')).toMatch(/裸引擎/);
  });

  it('包了前後文的訊息不算裸的', () => {
    expect(bareEngineSpeak('讀不到 --state 指定的檔案:/x/w.json(Unexpected end of JSON input)')).toBeNull();
    expect(bareEngineSpeak('✗ lint: --dir 指到的目錄不存在:/x/nope\n不會幫你建出來')).toBeNull();
    expect(bareEngineSpeak('FAIL\n  - fill: expected array, received string')).toBeNull();
  });

  it('正規化後,只差路徑與日期的兩段輸出算相同', () => {
    const a = `report written to ${join(tmpdir(), `${SCRATCH_PREFIX}abc`)}/state/lint-report-2026-09-05.md`;
    const b = `report written to ${join(tmpdir(), `${SCRATCH_PREFIX}xyz`)}/state/lint-report-2026-09-06.md`;
    expect(normalize(a)).toBe(normalize(b));
    expect(normalize('3 張卡')).not.toBe(normalize('0 張卡'));
  });
});

for (const { file, command } of entryCommands()) {
  describe(`${file} · ${command.label}`, () => {
    const baselineNames = Object.keys(command.baselines);

    for (const name of baselineNames) {
      it(`基線 ${name}:exit 0、沒有裸錯誤(基線本身壞了,底下的比較就沒有意義)`, () => {
        const r = getResult(file, command.label, `baseline:${name}`);
        expect(r.code, describeRun(r)).toBe(0);
        expect(bareEngineSpeak(r.output), describeRun(r)).toBeNull();
      });
    }

    for (const probe of command.probes) {
      const legit = 'legitZero' in probe ? probe.legitZero : undefined;
      const title = `[${probe.kind}] ${probe.name}`;
      const get = (): RunResult => getResult(file, command.label, `probe:${probe.name}`);

      if (legit) {
        it(`${title}:正當的 exit 0(${legit})`, () => {
          const r = get();
          expect(r.code, describeRun(r)).toBe(0);
        });
      } else {
        it(`${title}:退出碼非 0`, () => {
          const r = get();
          expect(r.code, describeRun(r)).not.toBe(0);
        });
      }

      it(`${title}:不噴裸 stack trace、不吐裸引擎訊息`, () => {
        const r = get();
        expect(bareEngineSpeak(r.output), describeRun(r)).toBeNull();
      });

      const against = probe.against ?? (baselineNames.length ? ['healthy'] : []);
      for (const baseline of against) {
        it(`${title}:輸出跟基線 ${baseline} 不可以長一樣`, () => {
          const r = get();
          const b = getResult(file, command.label, `baseline:${baseline}`);
          const same = r.code === b.code && normalize(r.output) === normalize(b.output);
          expect(same, `空的跟健康的長一樣。\n[探針] ${describeRun(r)}\n[基線 ${baseline}] ${describeRun(b)}`).toBe(false);
        });
      }

      it(`${title}:指名有問題的那條路徑`, (ctx) => {
        const r = get();
        if (r.mention === undefined) ctx.skip();
        expect(r.output, `輸出裡沒有 ${r.mention}\n${describeRun(r)}`).toContain(r.mention);
      });
    }
  });
}
