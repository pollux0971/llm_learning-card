/**
 * 「刻意」登記表(scripts/degraded-intended.json)的四條規則,逐條都有測試。
 * 規則本身寫在 scripts/degraded-report.ts 檔頭。
 *
 *   規則 1 · 每一條都要對應一個真實存在、而且實際觸發該 signal 的測試,不觸發就 FAIL「登記過期」。
 *            反向驗證兩種形狀都要:(a) 名字對不上;(b) 名字對得上但不再走那條分支。
 *            只做 (a) 只證明「名字對得上」,(b) 才證明「真的還在觸發」。
 *   規則 2 · reason 必填,空字串、只有空白都算沒填。
 *   規則 3 · 「未標記」基準只准降,不准升(檔內 UNMARKED_CEILING)。
 *   規則 4 · 「刻意」桶不設上限(commit 說明那半邊機器管不到,這裡只證明沒有上限)。
 *
 * 分三層:純函式(checkIntended / describeRegistryProblem / compareBaseline)、真實登記表的
 * 靜態檢查(檔案在、it 名字在原始碼裡——不用起 vitest 就能抓到改名)、以及起一個 tsx 子行程
 * 走完整條路(退出碼與訊息才是使用者看到的東西)。「實際觸發」那一半靠子行程餵捏造的 JSONL;
 * 對真實測試的反向驗證(把登記的測試 skip 掉 → 紅)是人跑 `-- <那個 .test.ts>` 做的,
 * 記在 commit 說明,不在這裡(要起整套 vitest)。
 *
 * 檔尾兩組是**量尺自己有沒有腐爛**(ADR-047;跟 ADR-044「報告模式,不執法」是同一個東西的兩層:
 * 那條管「哪些測試走了退化分支」只報告,這裡執法的是量尺本身):
 *
 *   甲 · 訊號目錄與程式碼的呼叫點必須一一對上。「從未執行 0」與「未標記 152」完全建立在目錄是
 *        完整的:目錄少一條 = 少一批可能未標記的測試,漂移會往「更好」的方向動。兩個方向都 FAIL:
 *        程式碼有、目錄沒有 → 「訊號未登記」;目錄有、程式碼沒有 → 「訊號無呼叫點」。
 *        目錄不容忍暫時的空:刪分支的人就是該改目錄的人,同一個 commit(跟棘輪鎖 2、登記過期同形)。
 *   乙 · 「宣稱全套、實際沒跑完」也要擋。cmdline 是**宣稱**,`ran / collected` 是**驗證**;
 *        基準只在 scope=full **而且** ran_all 量出來為真時才比。ran_all 三個條件全滿足:
 *        退出碼 ∈ {0, 1}、vitest.json 存在可解析且數字一致、witness 的 test-end 紀錄數 ===
 *        numTotalTests − pending − todo。不滿足就印「讀不到(全套未跑完:退出碼 X,收到 N/M)」,
 *        **而且不印任何降基準的提示**——提示比 FAIL 危險,FAIL 擋住你,提示誘導你去改基準。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEGRADED_SIGNALS, OUTSIDE_ANY_TEST, type DegradedSignal } from '../packages/contracts/src/witness.js';
import {
  DEFAULT_INTENDED_PATH,
  VITEST_EXIT_JSON,
  VITEST_JSON,
  aggregate,
  assessRunCompleteness,
  catalogDriftProblems,
  checkIntended,
  compareBaseline,
  describeEntryProblem,
  describeRegistryProblem,
  findCallSites,
  isStale,
  loadIntended,
  parseArgs,
  UsageError,
  type CallSite,
  type IntendedEntry,
  type IntendedRegistry,
  type Summary,
  type TestRow,
} from './degraded-report.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const SCRIPT = join(REPO_ROOT, 'scripts/degraded-report.ts');

/**
 * 規則 3 的數字。要**降**就改這裡跟登記表的 unmarkedBaseline;**不准升**——上調一次就是先例,
 * 下一次「這批也是刻意的」就沒有機械理由擋。基準 152 出自 reports/degraded/959b039.md(ADR-044)。
 */
const UNMARKED_CEILING = 152;

/**
 * 乙的兩個證據檔名。腳本 export 同名常數(VITEST_JSON / VITEST_EXIT_JSON),下面有一條測試釘住兩邊一樣;
 * 這裡不直接用 import 的那兩個,是為了讓既有的子行程測試在乙還沒實作時仍然綠——它們只是多了兩個檔。
 */
const VITEST_JSON_FILE = 'vitest.json';
const VITEST_EXIT_FILE = 'vitest-exit.json';

const SIG_A: DegradedSignal = 'llm.gateway-router.spend-no-log-zero';
const SIG_B: DegradedSignal = 'prompt-quality.fake.attempt-fallback-first';
const SIG_C: DegradedSignal = 'llm.router-impl.local-prober-default';

function entry(over: Partial<IntendedEntry> = {}): IntendedEntry {
  return {
    file: 'packages/core/src/llm/router-gateway.test.ts',
    test: 'GatewayLlmRouter > 沒 log 當 0',
    signal: SIG_A,
    reason: '這個測試存在的目的就是走那條分支',
    since: '2026-09-05',
    ...over,
  };
}

function row(file: string, test: string, signals: Partial<Record<DegradedSignal, number>>): TestRow {
  return { file, test, signals: new Map(Object.entries(signals) as Array<[DegradedSignal, number]>) };
}

const exists = (): boolean => true;
const gone = (): boolean => false;

// ───────────────────────────────────────────────────────────────── 規則 1:登記表不准腐爛

describe('規則 1 · checkIntended:每一條都要對到一個仍在觸發那個訊號的測試', () => {
  const e = entry();
  const okRows = [row(e.file, e.test, { [SIG_A]: 3, [SIG_C]: 3 })];

  it('對得上而且觸發了 → ok,帶次數', () => {
    const [c] = checkIntended([e], okRows, 'full', exists);
    expect(c!.status).toEqual({ kind: 'ok', count: 3 });
    expect(isStale(c!.status)).toBe(false);
  });

  it('(a) 名字對不上:檔案跑了,但裡面沒有這個測試 → test-missing,算過期', () => {
    const [c] = checkIntended([entry({ test: '改過名字的測試' })], okRows, 'full', exists);
    expect(c!.status).toEqual({ kind: 'test-missing' });
    expect(isStale(c!.status)).toBe(true);
  });

  it('(b) 名字對得上,但不再走那條分支 → signal-not-triggered,算過期,而且說出它這次走了什麼', () => {
    const drifted = [row(e.file, e.test, { [SIG_C]: 3 })];
    const [c] = checkIntended([e], drifted, 'full', exists);
    expect(c!.status).toEqual({ kind: 'signal-not-triggered', triggered: [SIG_C] });
    expect(isStale(c!.status)).toBe(true);
  });

  it('(b′) 名字對得上,什麼訊號都沒觸發 → 一樣過期,triggered 是空的', () => {
    const [c] = checkIntended([e], [row(e.file, e.test, {})], 'full', exists);
    expect(c!.status).toEqual({ kind: 'signal-not-triggered', triggered: [] });
  });

  it('(b″) 次數是 0 不算觸發', () => {
    const [c] = checkIntended([e], [row(e.file, e.test, { [SIG_A]: 0 })], 'full', exists);
    expect(c!.status.kind).toBe('signal-not-triggered');
  });

  it('整套跑:登記的檔案完全沒出現,檔案還在磁碟上 → test-missing(整檔被 skip 也是這條)', () => {
    const [c] = checkIntended([e], [], 'full', exists);
    expect(c!.status).toEqual({ kind: 'test-missing' });
  });

  it('登記的檔案在磁碟上已經不存在 → file-missing,整套或部分都算過期', () => {
    expect(checkIntended([e], [], 'full', gone)[0]!.status).toEqual({ kind: 'file-missing' });
    expect(checkIntended([e], [], 'partial', gone)[0]!.status).toEqual({ kind: 'file-missing' });
  });

  it('部分跑:登記的檔案沒跑到但還在磁碟上 → not-run,不判', () => {
    const [c] = checkIntended([e], [], 'partial', exists);
    expect(c!.status).toEqual({ kind: 'not-run' });
    expect(isStale(c!.status)).toBe(false);
  });

  it('部分跑:檔案跑到了、測試卻不在 → 還是 test-missing(跑到了就要判)', () => {
    const [c] = checkIntended([entry({ test: '不存在' })], okRows, 'partial', exists);
    expect(c!.status).toEqual({ kind: 'test-missing' });
  });

  it('同一個測試登記兩個訊號:各自判', () => {
    const two = [e, entry({ signal: SIG_B })];
    const [a, b] = checkIntended(two, okRows, 'full', exists);
    expect(a!.status.kind).toBe('ok');
    expect(b!.status.kind).toBe('signal-not-triggered');
  });

  it('只比完整名字,不做前綴或模糊比對(改了 describe 也算改名)', () => {
    const [c] = checkIntended([entry({ test: '沒 log 當 0' })], okRows, 'full', exists);
    expect(c!.status).toEqual({ kind: 'test-missing' });
  });
});

// ───────────────────────────────────────────────────────────────── 規則 2:reason 必填

describe('規則 2 · reason 必填', () => {
  it('缺 reason → 說出規則 2', () => {
    const { reason: _drop, ...noReason } = entry();
    expect(describeEntryProblem(noReason)).toMatch(/reason.*規則 2/);
  });

  it.each(['', '   ', '\n\t'])('reason 是 %j(空或只有空白)→ 算沒填', (reason) => {
    expect(describeEntryProblem(entry({ reason }))).toMatch(/reason 是空的/);
  });

  it('reason 有字 → 過', () => {
    expect(describeEntryProblem(entry({ reason: 'x' }))).toBeNull();
  });

  it('整張表:第 N 條的 reason 空 → 訊息指到 entries[N]', () => {
    const reg: IntendedRegistry = { unmarkedBaseline: 0, entries: [entry(), entry({ test: 't2', reason: ' ' })] };
    expect(describeRegistryProblem(reg)).toMatch(/entries\[1\].*reason/);
  });
});

describe('登記表的其他形狀(不是四條規則,但表壞了四條都守不住)', () => {
  it('signal 不在訊號目錄 → 指名那個字串', () => {
    expect(describeEntryProblem(entry({ signal: 'llm.nope' as DegradedSignal }))).toMatch(/llm\.nope.*訊號目錄/);
  });

  it('since 不是 YYYY-MM-DD → 紅', () => {
    expect(describeEntryProblem(entry({ since: '昨天' }))).toMatch(/since/);
    expect(describeEntryProblem(entry({ since: '2026-9-5' }))).toMatch(/since/);
  });

  it('file / test 空字串 → 紅', () => {
    expect(describeEntryProblem(entry({ file: '' }))).toMatch(/file/);
    expect(describeEntryProblem(entry({ test: ' ' }))).toMatch(/test/);
  });

  it('同一個檔案、同一個測試、同一個訊號登記兩次 → 紅;同一個測試登記不同訊號可以', () => {
    expect(describeRegistryProblem({ unmarkedBaseline: 0, entries: [entry(), entry()] })).toMatch(/entries\[1\] 重複/);
    expect(describeRegistryProblem({ unmarkedBaseline: 0, entries: [entry(), entry({ signal: SIG_B })] })).toBeNull();
  });

  it('unmarkedBaseline 要是非負整數;entries 要是陣列;最外層要是物件', () => {
    expect(describeRegistryProblem({ unmarkedBaseline: -1, entries: [] })).toMatch(/unmarkedBaseline/);
    expect(describeRegistryProblem({ unmarkedBaseline: 1.5, entries: [] })).toMatch(/unmarkedBaseline/);
    expect(describeRegistryProblem({ unmarkedBaseline: '152', entries: [] })).toMatch(/unmarkedBaseline/);
    expect(describeRegistryProblem({ unmarkedBaseline: 0, entries: {} })).toMatch(/entries 要是陣列/);
    expect(describeRegistryProblem([])).toMatch(/最外層/);
    expect(describeRegistryProblem(null)).toMatch(/最外層/);
  });

  it('loadIntended:檔案不存在、是目錄、不是 JSON,都是 UsageError 而且指名路徑', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'lc-intended-'));
    try {
      const missing = join(scratch, 'nope.json');
      expect(() => loadIntended(missing)).toThrow(UsageError);
      expect(() => loadIntended(missing)).toThrow(missing);
      expect(() => loadIntended(scratch)).toThrow(/目錄/);
      const bad = join(scratch, 'bad.json');
      writeFileSync(bad, '{ "entries": [', 'utf8');
      expect(() => loadIntended(bad)).toThrow(/不是合法的 JSON/);
      const wrong = join(scratch, 'wrong.json');
      writeFileSync(wrong, JSON.stringify({ unmarkedBaseline: 0, entries: [entry({ reason: '' })] }), 'utf8');
      expect(() => loadIntended(wrong)).toThrow(/entries\[0\] reason/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('parseArgs:--intended 要接路徑;--full 只跟 --in 一起', () => {
    expect(parseArgs(['--intended', 'x.json']).intended).toBe('x.json');
    expect(() => parseArgs(['--intended'])).toThrow(UsageError);
    expect(() => parseArgs(['--intended', '--out'])).toThrow(UsageError);
    expect(parseArgs(['--in', 'd', '--full']).full).toBe(true);
    expect(() => parseArgs(['--full'])).toThrow(/--full 只跟 --in/);
  });
});

// ───────────────────────────────────────────────────────────────── 規則 3:基準只准降

describe('規則 3 · 未標記基準只准降,不准升', () => {
  it('整套跑:未標記 > 基準 → FAIL,訊息說不要上調、去登記或去看 §3', () => {
    const r = compareBaseline(153, 152, 'full');
    expect(r.fail).toMatch(/153 超過基準 152/);
    expect(r.fail).toMatch(/不要上調基準/);
    expect(r.fail).toContain(DEFAULT_INTENDED_PATH);
    expect(r.hint).toBeNull();
  });

  it('整套跑:等於基準 → 沒事、沒提示', () => {
    expect(compareBaseline(152, 152, 'full')).toEqual({ fail: null, hint: null });
  });

  it('整套跑:低於基準 → 不 FAIL,提示可以把基準降到現在的數字', () => {
    const r = compareBaseline(150, 152, 'full');
    expect(r.fail).toBeNull();
    expect(r.hint).toMatch(/降到 150/);
  });

  it('部分跑:數字沒意義,不比', () => {
    expect(compareBaseline(9999, 152, 'partial')).toEqual({ fail: null, hint: null });
  });

  it(`真實登記表的 unmarkedBaseline ≤ ${UNMARKED_CEILING}(要降改兩處;升不過這條)`, () => {
    const reg = loadIntended(join(REPO_ROOT, DEFAULT_INTENDED_PATH));
    expect(reg.unmarkedBaseline).toBeLessThanOrEqual(UNMARKED_CEILING);
  });
});

// ───────────────────────────────────────────────────────────────── 規則 4:刻意桶不設上限

describe('規則 4 · 「刻意」桶不設上限', () => {
  it('一千條合法登記:表過、檢查全 ok、沒有任何上限訊息', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => entry({ test: `t${i}` }));
    const rows = entries.map((e) => row(e.file, e.test, { [SIG_A]: 1 }));
    expect(describeRegistryProblem({ unmarkedBaseline: 0, entries })).toBeNull();
    const checks = checkIntended(entries, rows, 'full', exists);
    expect(checks.every((c) => c.status.kind === 'ok')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────── 真實登記表的靜態檢查

describe('真實的 scripts/degraded-intended.json', () => {
  const reg = loadIntended(join(REPO_ROOT, DEFAULT_INTENDED_PATH));

  it('載得起來、至少一條(空表沒有守的意義,那就把檔案拿掉)', () => {
    expect(reg.entries.length).toBeGreaterThan(0);
  });

  it.each(reg.entries.map((e) => [e.test.slice(-40), e] as const))(
    '…%s:檔案在磁碟上,而且 it 的名字原封不動出現在那支檔案裡(改名不用起 vitest 就抓到)',
    (_tail, e) => {
      const full = join(REPO_ROOT, e.file);
      expect(existsSync(full), `${e.file} 不存在`).toBe(true);
      const src = readFileSync(full, 'utf8');
      // 完整名是「describe > … > it」,最後一段是 it 的字面名字;describe 的名字也要在。
      for (const segment of e.test.split(' > ')) {
        expect(src.includes(segment), `${e.file} 裡找不到「${segment}」——測試改名了?登記表要跟著改`).toBe(true);
      }
    },
  );

  it('每一條的 signal 都在訊號目錄裡(目錄改名時登記表要跟著改)', () => {
    for (const e of reg.entries) expect(Object.keys(DEGRADED_SIGNALS)).toContain(e.signal);
  });
});

// ───────────────────────────────────────────────────────────────── 走完整條路:子行程

/** vitest --reporter=json 的數字欄位(vitest 4 的形狀;testResults 這裡不需要)。 */
interface VitestCounts {
  total: number;
  passed?: number;
  failed?: number;
  pending?: number;
  todo?: number;
}

/**
 * 乙:raw 目錄裡 vitest 自己的證據。`vitest.json` 是 `--reporter=json --outputFile` 寫的,
 * `vitest-exit.json` 是 degraded-report 自己起 vitest 時記下的退出碼(`--in` 既有目錄時
 * 沒有這兩個檔就是「不知道當初怎麼跑的」,宣稱 --full 也讀不到)。
 */
function evidence(dir: string, counts: VitestCounts, status: number | null = 0, over: Record<string, unknown> = {}): void {
  const passed = counts.passed ?? 0;
  const failed = counts.failed ?? 0;
  const pending = counts.pending ?? 0;
  const todo = counts.todo ?? 0;
  const json = {
    numTotalTestSuites: 1,
    numPassedTestSuites: failed === 0 ? 1 : 0,
    numFailedTestSuites: failed === 0 ? 0 : 1,
    numPendingTestSuites: 0,
    numTotalTests: counts.total,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: todo,
    startTime: 1_788_586_449_275,
    success: failed === 0,
    testResults: [],
    ...over,
  };
  writeFileSync(join(dir, VITEST_JSON_FILE), JSON.stringify(json), 'utf8');
  writeFileSync(join(dir, VITEST_EXIT_FILE), JSON.stringify({ status, signal: status === null ? 'SIGKILL' : null }), 'utf8');
}

describe('子行程:退出碼與訊息', () => {
  let scratch = '';
  const FILE = 'packages/core/src/llm/router-gateway.test.ts';
  const TEST = 'Suite > 刻意走分支的測試';
  const OTHER = 'Suite > 不小心走分支的測試';

  /**
   * 寫一份 raw 目錄:JSONL 加上 vitest 自己的證據(乙)。預設證據跟紀錄一致——每筆 test-end 一個
   * passed、退出碼 0,也就是「跑完了」的形狀,所以既有的 --full 測試在乙上線後仍然是「跑完了」。
   * 要製造「沒跑完」用下面的 evidence() 蓋掉。
   */
  function jsonl(dir: string, records: Array<{ file: string; test: string; signals: Record<string, number> }>): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '1.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    const n = records.filter((r) => r.test !== OUTSIDE_ANY_TEST).length;
    evidence(dir, { total: n, passed: n });
    return dir;
  }

  function registry(path: string, reg: IntendedRegistry): string {
    writeFileSync(path, JSON.stringify(reg, null, 2), 'utf8');
    return path;
  }

  function run(args: string[]): { status: number | null; stdout: string; stderr: string; md: string } {
    const out = join(scratch, `r-${Math.random().toString(36).slice(2)}.md`);
    const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT, ...args, '--out', out], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, md: existsSync(out) ? readFileSync(out, 'utf8') : '' };
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'lc-degraded-'));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('登記對得上又觸發 → 退出碼 0;報告四桶:觸發 2、刻意 1、未標記 1;§3 標 [刻意]', () => {
    const inDir = jsonl(join(scratch, 'ok'), [
      { file: FILE, test: TEST, signals: { [SIG_A]: 2 } },
      { file: FILE, test: OTHER, signals: { [SIG_C]: 1 } },
      { file: FILE, test: 'Suite > 乾淨的', signals: {} },
    ]);
    const reg = registry(join(scratch, 'ok.json'), { unmarkedBaseline: 1, entries: [entry({ file: FILE, test: TEST })] });
    const r = run(['--in', inDir, '--full', '--intended', reg]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/觸發退化分支:2/);
    expect(r.stdout).toMatch(/刻意\(登記表 1 條\):1;未標記:1;基準:1/);
    expect(r.md).toMatch(/\*\*刻意\*\*.*\| \*\*1\*\* \|/);
    expect(r.md).toMatch(/\*\*未標記\*\*.*\| \*\*1\*\* \|.*等於基準/);
    expect(r.md).toContain(`- **[刻意]** ${TEST}`);
    expect(r.md).toContain(`- ${OTHER}`);
    expect(r.md).toMatch(/## 3a\. 刻意登記表/);
    expect(r.md).toMatch(/✓ 觸發 2 次/);
    const json = JSON.parse(readFileSync(join(scratch, 'ok.json'), 'utf8')) as IntendedRegistry;
    expect(json.entries).toHaveLength(1); // 腳本不改登記表
  });

  it('(a) 登記的名字對不上 → 退出碼 1,stderr 說「登記過期」「找不到這個測試」,報告照樣寫', () => {
    const inDir = jsonl(join(scratch, 'a'), [{ file: FILE, test: TEST, signals: { [SIG_A]: 2 } }]);
    const reg = registry(join(scratch, 'a.json'), { unmarkedBaseline: 1, entries: [entry({ file: FILE, test: '不存在的名字' })] });
    const r = run(['--in', inDir, '--full', '--intended', reg]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/✗ degraded-report:登記過期 1 條/);
    expect(r.stderr).toMatch(/找不到這個測試/);
    expect(r.stderr).toContain('不存在的名字');
    expect(r.md).toMatch(/✗ 登記過期:找不到這個測試/);
  });

  it('(b) 登記的測試還在,但不再走那條分支 → 退出碼 1,stderr 說「不再走那條分支」並列出它這次走了什麼', () => {
    const inDir = jsonl(join(scratch, 'b'), [{ file: FILE, test: TEST, signals: { [SIG_C]: 1 } }]);
    const reg = registry(join(scratch, 'b.json'), { unmarkedBaseline: 1, entries: [entry({ file: FILE, test: TEST })] });
    const r = run(['--in', inDir, '--full', '--intended', reg]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/登記過期 1 條/);
    expect(r.stderr).toMatch(new RegExp(`不再走那條分支.*${SIG_C.replace(/\./g, '\\.')}`));
  });

  it('(b) 的另一形:登記的測試被 skip 了(整檔沒有它的紀錄)→ 整套跑時退出碼 1', () => {
    const inDir = jsonl(join(scratch, 'skip'), [{ file: FILE, test: OTHER, signals: { [SIG_C]: 1 } }]);
    const reg = registry(join(scratch, 'skip.json'), { unmarkedBaseline: 1, entries: [entry({ file: FILE, test: TEST })] });
    const r = run(['--in', inDir, '--full', '--intended', reg]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/找不到這個測試/);
  });

  it('部分跑(沒有 --full):登記的檔案沒跑到 → 不判、退出碼 0、報告標「這次沒跑到」', () => {
    const inDir = jsonl(join(scratch, 'partial'), [{ file: 'packages/core/src/x.test.ts', test: 'x', signals: { [SIG_C]: 1 } }]);
    const reg = registry(join(scratch, 'partial.json'), { unmarkedBaseline: 0, entries: [entry({ file: FILE, test: TEST })] });
    const r = run(['--in', inDir, '--intended', reg]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.md).toMatch(/這次沒跑到/);
    expect(r.stdout).toMatch(/部分跑/);
  });

  it('規則 3 走到底:整套、未標記 2 > 基準 1 → 退出碼 1,訊息說不要上調', () => {
    const inDir = jsonl(join(scratch, 'over'), [
      { file: FILE, test: TEST, signals: { [SIG_A]: 1 } },
      { file: FILE, test: OTHER, signals: { [SIG_C]: 1 } },
    ]);
    const reg = registry(join(scratch, 'over.json'), { unmarkedBaseline: 1, entries: [] });
    const r = run(['--in', inDir, '--full', '--intended', reg]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/未標記 2 超過基準 1/);
    expect(r.stderr).toMatch(/不要上調基準/);
    expect(r.md).toMatch(/超過基準,FAIL/);
  });

  it('規則 3:低於基準 → 退出碼 0 加一行「可以降到」', () => {
    const inDir = jsonl(join(scratch, 'under'), [{ file: FILE, test: OTHER, signals: { [SIG_C]: 1 } }]);
    const reg = registry(join(scratch, 'under.json'), { unmarkedBaseline: 5, entries: [] });
    const r = run(['--in', inDir, '--full', '--intended', reg]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/可以把 .* 降到 1/);
  });

  it('規則 2 走到底:登記表 reason 空 → 還沒讀紀錄就以退出碼 1 結束,一句人話', () => {
    const inDir = jsonl(join(scratch, 'r2'), [{ file: FILE, test: TEST, signals: { [SIG_A]: 1 } }]);
    const reg = registry(join(scratch, 'r2.json'), { unmarkedBaseline: 1, entries: [entry({ file: FILE, test: TEST, reason: '' })] });
    const r = run(['--in', inDir, '--intended', reg]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/✗ degraded-report:登記表 .*entries\[0\] reason 是空的/);
    expect(r.stderr).not.toMatch(/^\s+at /m);
    expect(r.md).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────── aggregate 沒被改壞

describe('aggregate 仍然把同一個測試的多筆合併(登記表比對靠的是合併後的 rows)', () => {
  it('兩筆同名紀錄 → 一列,次數相加', () => {
    const { rows } = aggregate([
      { file: 'f', test: 't', signals: { [SIG_A]: 1 } },
      { file: 'f', test: 't', signals: { [SIG_A]: 2 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signals.get(SIG_A)).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────── 量尺 · 甲:訊號目錄漂了要紅

const NO_CALL_SITE = (s: string): string => `訊號無呼叫點:${s},若該退化分支已刪除,請在同一個 commit 從目錄移除`;
const UNREGISTERED = (s: string, file: string, line: number): string => `訊號未登記:${s} @ ${file}:${line}`;

describe('量尺 · 甲 · catalogDriftProblems:目錄與呼叫點必須一一對上,漂了是 FAIL 不是 ⚠', () => {
  const site = (file: string, line: number): CallSite => ({ file, line });
  /** 目錄裡每一條訊號都恰好一個呼叫點:乾淨的形狀。 */
  function cleanSites(): Map<string, CallSite[]> {
    return new Map(Object.keys(DEGRADED_SIGNALS).map((s, i) => [s, [site('packages/core/src/x.ts', i + 1)]]));
  }

  it('乾淨:每條訊號都有呼叫點、沒有未登記的 → 沒有問題', () => {
    expect(catalogDriftProblems({ sites: cleanSites(), unknown: [] })).toEqual([]);
  });

  it('程式碼有、目錄裡沒有(unknown)→ FAIL「訊號未登記:<名> @ <file:line>」;沒有正當理由,一定是打錯字或忘了登記', () => {
    const problems = catalogDriftProblems({ sites: cleanSites(), unknown: [{ ...site('packages/core/src/llm/router.ts', 42), signal: 'llm.typo.nope' }] });
    expect(problems).toEqual([UNREGISTERED('llm.typo.nope', 'packages/core/src/llm/router.ts', 42)]);
  });

  it('目錄有、程式碼找不到呼叫點 → FAIL「訊號無呼叫點:<名>,若該退化分支已刪除,請在同一個 commit 從目錄移除」', () => {
    const sites = cleanSites();
    sites.delete(SIG_B);
    expect(catalogDriftProblems({ sites, unknown: [] })).toEqual([NO_CALL_SITE(SIG_B)]);
  });

  it('呼叫點清單是空陣列跟沒有 key 一樣算沒有呼叫點', () => {
    const sites = cleanSites();
    sites.set(SIG_A, []);
    expect(catalogDriftProblems({ sites, unknown: [] })).toEqual([NO_CALL_SITE(SIG_A)]);
  });

  it('兩個方向同時漂 → 兩條都列,未登記的在前;每一條無呼叫點的訊號各一行', () => {
    const sites = cleanSites();
    sites.delete(SIG_C);
    sites.delete(SIG_A);
    const problems = catalogDriftProblems({ sites, unknown: [{ ...site('scripts/x.ts', 7), signal: 'x.y' }] });
    expect(problems).toEqual([UNREGISTERED('x.y', 'scripts/x.ts', 7), NO_CALL_SITE(SIG_A), NO_CALL_SITE(SIG_C)]);
  });

  it('同一個未登記的名字出現兩處 → 兩行,各帶自己的檔案:行(要修的是每一處)', () => {
    const problems = catalogDriftProblems({
      sites: cleanSites(),
      unknown: [
        { ...site('packages/a.ts', 1), signal: 'x.y' },
        { ...site('packages/b.ts', 9), signal: 'x.y' },
      ],
    });
    expect(problems).toEqual([UNREGISTERED('x.y', 'packages/a.ts', 1), UNREGISTERED('x.y', 'packages/b.ts', 9)]);
  });

  it("findCallSites 掃一個只有 witness('假名') 的臨時 root → unknown 帶檔案:行;catalogDriftProblems 把它變成 FAIL", () => {
    const root = mkdtempSync(join(tmpdir(), 'lc-drift-'));
    try {
      mkdirSync(join(root, 'packages/x/src'), { recursive: true });
      writeFileSync(join(root, 'packages/x/src/a.ts'), "import { witness } from '@contracts/witness.js';\n\nexport function f(): void {\n  witness('假名');\n}\n", 'utf8');
      const found = findCallSites(root);
      expect(found.unknown).toEqual([{ file: 'packages/x/src/a.ts', line: 4, signal: '假名' }]);
      const problems = catalogDriftProblems(found);
      expect(problems[0]).toBe(UNREGISTERED('假名', 'packages/x/src/a.ts', 4));
      // 那個 root 裡沒有任何目錄訊號的呼叫點,所以目錄的每一條都會被列成無呼叫點
      expect(problems).toHaveLength(1 + Object.keys(DEGRADED_SIGNALS).length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('現況:真實 repo 的目錄與呼叫點一一對上(30/30)。不綠就是發現——回報,不放寬', () => {
    const found = findCallSites(REPO_ROOT);
    expect(found.unknown).toEqual([]);
    expect(catalogDriftProblems(found)).toEqual([]);
    expect(Object.keys(DEGRADED_SIGNALS).every((s) => (found.sites.get(s) ?? []).length > 0)).toBe(true);
  });
});

/**
 * 甲走到底:起子行程,cwd 指到一個**假的 git repo**。`_root.ts` 以 cwd 找 git root,所以
 * findCallSites 掃的是那個假 repo 的 packages/,訊號目錄仍然是真的(腳本相對自己 import)。
 * 這樣不用改真 repo 的 witness.ts 就能讓「目錄有、程式碼沒有」與「程式碼有、目錄沒有」真的發生。
 */
describe('量尺 · 甲 · 子行程:目錄漂了 → 退出碼 1,兩個方向的訊息都在 stderr', () => {
  let scratch = '';
  const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'zig', GIT_AUTHOR_EMAIL: 'zig@test', GIT_COMMITTER_NAME: 'zig', GIT_COMMITTER_EMAIL: 'zig@test' };
  const ALL = Object.keys(DEGRADED_SIGNALS);

  /** 一個假 repo:git init + 一個 commit、空的 owners 表、一份 raw 目錄、一張空登記表,packages/a.ts 內容由呼叫端給。 */
  function fakeRepo(name: string, sourceTs: string): { root: string; args: string[] } {
    const root = join(scratch, name);
    mkdirSync(join(root, 'packages'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/boundaries.owners.json'), JSON.stringify({ owners: [] }), 'utf8');
    writeFileSync(join(root, 'packages/a.ts'), sourceTs, 'utf8');
    for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'x']]) {
      execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, ...GIT_IDENTITY } });
    }
    const raw = join(root, 'raw');
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(raw, '1.jsonl'), `${JSON.stringify({ file: 'packages/a.test.ts', test: 't', signals: {} })}\n`, 'utf8');
    evidence(raw, { total: 1, passed: 1 });
    const reg = join(root, 'intended.json');
    writeFileSync(reg, JSON.stringify({ unmarkedBaseline: 0, entries: [] }), 'utf8');
    return { root, args: ['--in', raw, '--full', '--intended', reg, '--out', join(root, 'r.md')] };
  }

  function run(repo: { root: string; args: string[] }): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT, ...repo.args], { cwd: repo.root, encoding: 'utf8', timeout: 90_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  /** 目錄裡每個訊號名各出現一次(查表形狀:`'name'`),就是「目錄與程式碼對上」。 */
  const literals = (names: readonly string[]): string => `export const T = [\n${names.map((s) => `  '${s}',`).join('\n')}\n];\n`;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'lc-drift-e2e-'));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('對上:每條訊號都在程式碼裡 → 退出碼 0,沒有任何漂移訊息', () => {
    const r = run(fakeRepo('clean', literals(ALL)));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`訊號 目錄/呼叫點/觸發:${ALL.length}/${ALL.length}/0`));
  });

  it('目錄有、程式碼沒有:少一條 → 退出碼 1,stderr「訊號無呼叫點:<名>,…同一個 commit 從目錄移除」,而且指名是哪一條', () => {
    const r = run(fakeRepo('missing-one', literals(ALL.filter((s) => s !== SIG_B))));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/✗ degraded-report:/);
    expect(r.stderr).toContain(NO_CALL_SITE(SIG_B));
    expect(r.stderr).not.toContain(NO_CALL_SITE(SIG_A));
    expect(r.stderr).not.toMatch(/訊號未登記/);
    expect(r.stdout).toMatch(new RegExp(`訊號 目錄/呼叫點/觸發:${ALL.length}/${ALL.length - 1}/0`));
  });

  it("程式碼有、目錄沒有:多一個 witness('假名') → 退出碼 1,stderr「訊號未登記:假名 @ packages/a.ts:<行>」", () => {
    const src = `${literals(ALL)}\nexport function f(): void {\n  witness('假名');\n}\n`;
    const line = src.split('\n').findIndex((l) => l.includes("witness('假名')")) + 1;
    const r = run(fakeRepo('unregistered', src));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(UNREGISTERED('假名', 'packages/a.ts', line));
    expect(r.stderr).not.toMatch(/訊號無呼叫點/);
  });

  it('兩個方向同時漂 → 一次列完,未登記的在前', () => {
    const src = `${literals(ALL.filter((s) => s !== SIG_C))}\nwitnessed('x.y');\n`;
    const r = run(fakeRepo('both', src));
    expect(r.status).toBe(1);
    const a = r.stderr.indexOf('訊號未登記:x.y @ packages/a.ts:');
    const b = r.stderr.indexOf(NO_CALL_SITE(SIG_C));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
  });

  it('漂了報告照樣寫(FAIL 是報告寫完才判,跟登記過期同一個位置),§2 那一列仍標「沒有呼叫點」', () => {
    const repo = fakeRepo('report-still-written', literals(ALL.filter((s) => s !== SIG_B)));
    const r = run(repo);
    expect(r.status).toBe(1);
    const md = readFileSync(join(repo.root, 'r.md'), 'utf8');
    expect(md).toMatch(/沒有呼叫點/);
    expect(md).toContain(`\`${SIG_B}\``);
  });
});

// ───────────────────────────────────────────────────────────────── 量尺 · 乙:宣稱全套、實際沒跑完也要擋

describe('量尺 · 乙 · assessRunCompleteness:ran_all 是量出來的,不是 cmdline 說的', () => {
  let scratch = '';
  let n = 0;
  function dir(): string {
    const d = join(scratch, `d${n++}`);
    mkdirSync(d, { recursive: true });
    return d;
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'lc-ranall-'));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it(`證據檔名是 ${VITEST_JSON_FILE} 與 ${VITEST_EXIT_FILE}:腳本 export 的常數跟這裡的測試用同一個名字`, () => {
    expect(VITEST_JSON).toBe(VITEST_JSON_FILE);
    expect(VITEST_EXIT_JSON).toBe(VITEST_EXIT_FILE);
  });

  it('三個條件全滿足 → ranAll,reason 是 null,collected = numTotalTests − pending − todo,skipped/vitestSkipped 兩邊都是 0', () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0);
    expect(assessRunCompleteness(d, 3)).toEqual({ ranAll: true, reason: null, status: 0, ran: 3, collected: 3, skipped: 0, vitestSkipped: 0 });
  });

  it('退出碼 1(有測試紅,但套件跑完)→ 仍然 ranAll:紅綠是 vitest 的事', () => {
    const d = dir();
    evidence(d, { total: 3, passed: 2, failed: 1 }, 1);
    expect(assessRunCompleteness(d, 3)).toMatchObject({ ranAll: true, reason: null, status: 1 });
  });

  it('todo 不算要跑的:total 5、pending 1(見證器也記 1 筆 skipped)、todo 1、紀錄 3 → ranAll,collected 3', () => {
    // pending 1 若見證器沒對應寫 1 筆 skipped,等式 (2) 就不成立(0 ≠ 1)——那正是新規格要抓的,
    // 所以這裡補上第三個參數 1,模擬「見證器也記了那一筆 skipped」的乾淨情況。
    const d = dir();
    evidence(d, { total: 5, passed: 3, pending: 1, todo: 1 }, 0);
    expect(assessRunCompleteness(d, 3, 1)).toMatchObject({ ranAll: true, collected: 3, ran: 3 });
  });

  it('條件 1 · 退出碼不是 0 或 1(137 = 被 kill)→ 不算,reason 帶退出碼', () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 137);
    const r = assessRunCompleteness(d, 3);
    expect(r.ranAll).toBe(false);
    expect(r.status).toBe(137);
    expect(r.reason).toMatch(/退出碼 137/);
  });

  it('條件 1 · 退出碼是 null(被訊號終止)→ 不算', () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, null);
    const r = assessRunCompleteness(d, 3);
    expect(r.ranAll).toBe(false);
    expect(r.status).toBeNull();
    expect(r.reason).toMatch(/退出碼/);
  });

  it(`條件 1 · 沒有 ${VITEST_EXIT_FILE}(--in 一份不是這支腳本跑出來的目錄)→ 不算,reason 指名那個檔`, () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0);
    rmSync(join(d, VITEST_EXIT_FILE));
    const r = assessRunCompleteness(d, 3);
    expect(r.ranAll).toBe(false);
    expect(r.status).toBeUndefined();
    expect(r.reason).toContain(VITEST_EXIT_FILE);
  });

  it(`條件 2 · 沒有 ${VITEST_JSON_FILE}(vitest 沒寫完就死)→ 不算,collected 是 null,reason 指名那個檔`, () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0);
    rmSync(join(d, VITEST_JSON_FILE));
    const r = assessRunCompleteness(d, 3);
    expect(r.ranAll).toBe(false);
    expect(r.collected).toBeNull();
    expect(r.reason).toContain(VITEST_JSON_FILE);
  });

  it(`條件 2 · ${VITEST_JSON_FILE} 不是合法 JSON(寫到一半)→ 不算`, () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0);
    writeFileSync(join(d, VITEST_JSON_FILE), '{"numTotalTests": 3, "numPa', 'utf8');
    const r = assessRunCompleteness(d, 3);
    expect(r.ranAll).toBe(false);
    expect(r.collected).toBeNull();
    expect(r.reason).toMatch(/不是合法的 JSON/);
  });

  it(`條件 2 · ${VITEST_JSON_FILE} 沒有 success 欄位 → 不算`, () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0, { success: undefined });
    const r = assessRunCompleteness(d, 3);
    expect(r.ranAll).toBe(false);
    expect(r.reason).toMatch(/success/);
  });

  it('條件 2 · 數字不一致:numTotalTests ≠ passed + failed + pending + todo → 不算,reason 把兩邊的數字都講出來', () => {
    const d = dir();
    evidence(d, { total: 5, passed: 3, failed: 1 }, 0);
    const r = assessRunCompleteness(d, 4);
    expect(r.ranAll).toBe(false);
    expect(r.reason).toMatch(/5/);
    expect(r.reason).toMatch(/4/);
  });

  it('條件 3 · 紀錄比 vitest 要跑的少(半路死掉)→ 不算,reason「收到 2/3」', () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0);
    const r = assessRunCompleteness(d, 2);
    expect(r.ranAll).toBe(false);
    expect(r).toMatchObject({ ran: 2, collected: 3 });
    expect(r.reason).toMatch(/收到 2\/3/);
  });

  it('條件 3 · 紀錄比 vitest 要跑的多(見證器重複寫)→ 一樣不算:ran == collected 是等號,不是 ≥', () => {
    const d = dir();
    evidence(d, { total: 3, passed: 3 }, 0);
    const r = assessRunCompleteness(d, 4);
    expect(r.ranAll).toBe(false);
    expect(r.reason).toMatch(/收到 4\/3/);
  });

  it('條件 3 · 0 筆紀錄對 0 個要跑的(全部 skip,見證器也記了 2 筆 skipped)→ 等號成立,但那是 readRecords 那關先擋的事,這裡只管等號', () => {
    // pending 2 沒有對應的 2 筆 skipped 的話,等式 (2) 會不成立——同上一條,補第三個參數。
    const d = dir();
    evidence(d, { total: 2, pending: 2 }, 0);
    expect(assessRunCompleteness(d, 0, 2)).toMatchObject({ ranAll: true, ran: 0, collected: 0 });
  });
});

describe('量尺 · 乙 · 子行程:宣稱 --full 但 ran_all 量出來是假 → 讀不到、不比基準、不印降基準的提示、退出碼 1', () => {
  let scratch = '';
  const FILE = 'packages/core/src/llm/router-gateway.test.ts';
  const REC = (test: string, signals: Record<string, number> = {}): { file: string; test: string; signals: Record<string, number> } => ({ file: FILE, test, signals });

  function rawDir(name: string, records: Array<{ file: string; test: string; signals: Record<string, number> }>): string {
    const d = join(scratch, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, '1.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return d;
  }

  function registry(name: string, unmarkedBaseline: number): string {
    const p = join(scratch, `${name}.json`);
    writeFileSync(p, JSON.stringify({ unmarkedBaseline, entries: [] }), 'utf8');
    return p;
  }

  function run(args: string[]): { status: number | null; stdout: string; stderr: string; md: string; summary: Summary | null } {
    const out = join(scratch, `r-${Math.random().toString(36).slice(2)}.md`);
    const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT, ...args, '--out', out], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 });
    const jsonPath = out.replace(/\.md$/, '.json');
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      md: existsSync(out) ? readFileSync(out, 'utf8') : '',
      summary: existsSync(jsonPath) ? (JSON.parse(readFileSync(jsonPath, 'utf8')) as Summary) : null,
    };
  }

  /** 四筆紀錄、一筆未標記;基準 5,所以「跑完了」的話會印「可以降到 1」——那正是要被擋掉的提示。 */
  const FOUR = [REC('t1', { [SIG_C]: 1 }), REC('t2'), REC('t3'), REC('t4')];
  const HINT = /可以把 .* 降到/;
  const UNREADABLE = /讀不到\(全套未跑完:退出碼 [^,]+,收到 \d+\/(\d+|\?)\)/;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'lc-ranall-e2e-'));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('對照:跑完了(證據一致)→ 比基準,低於基準就印「可以降到 1」,退出碼 0,summary.ranAll = true', () => {
    const d = rawDir('complete', FOUR);
    evidence(d, { total: 4, passed: 4 }, 0);
    const r = run(['--in', d, '--full', '--intended', registry('complete', 5)]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(HINT);
    expect(r.stdout).not.toMatch(UNREADABLE);
    expect(r.summary).toMatchObject({ scope: 'full', ranAll: true });
  });

  it('顧問指定的反向驗證:手動截斷的 raw 目錄(刪掉一半 JSONL 行)+ --full → 讀不到,不比基準,沒有降基準提示,退出碼 1', () => {
    const d = rawDir('truncated', FOUR);
    evidence(d, { total: 4, passed: 4 }, 0);
    // 刪掉一半:vitest 說跑了 4 個,見證器只收到 2 筆
    writeFileSync(join(d, '1.jsonl'), FOUR.slice(0, 2).map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
    const r = run(['--in', d, '--full', '--intended', registry('truncated', 5)]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('讀不到(全套未跑完:退出碼 0,收到 2/4)');
    expect(r.stdout).not.toMatch(HINT);
    expect(r.stderr).toMatch(/✗ degraded-report:.*宣稱全套但沒跑完/);
    expect(r.stderr).toMatch(/收到 2\/4/);
    expect(r.stderr).not.toMatch(/超過基準/);
    expect(r.stderr).not.toMatch(HINT);
    // 報告照樣寫,但「未標記」那一列不能說「可以降」也不能說「等於基準」——它就是讀不到
    expect(r.md).not.toMatch(/可以降|等於基準|超過基準,FAIL/);
    expect(r.md).toMatch(/未跑完|沒跑完/);
    expect(r.summary).toMatchObject({ scope: 'full', ranAll: false, testsUnmarked: 1 });
  });

  it('退出碼 137(vitest 被 kill),數字碰巧一致 → 仍然讀不到:三個條件是 AND', () => {
    const d = rawDir('killed', FOUR);
    evidence(d, { total: 4, passed: 4 }, 137);
    const r = run(['--in', d, '--full', '--intended', registry('killed', 5)]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('讀不到(全套未跑完:退出碼 137,收到 4/4)');
    expect(r.stdout).not.toMatch(HINT);
  });

  it('退出碼 1(有測試紅但套件跑完),數字一致 → ranAll,照常比基準', () => {
    const d = rawDir('red-but-complete', FOUR);
    evidence(d, { total: 4, passed: 3, failed: 1 }, 1);
    const r = run(['--in', d, '--full', '--intended', registry('red-but-complete', 1)]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(UNREADABLE);
    expect(r.md).toMatch(/等於基準/);
  });

  it(`--in 一份沒有 ${VITEST_JSON_FILE} / ${VITEST_EXIT_FILE} 的舊 raw 目錄 + --full → 讀不到(退出碼 ?,收到 4/?),退出碼 1`, () => {
    const d = rawDir('legacy', FOUR);
    const r = run(['--in', d, '--full', '--intended', registry('legacy', 5)]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('讀不到(全套未跑完:退出碼 ?,收到 4/?)');
    expect(r.stdout).not.toMatch(HINT);
    expect(r.stderr).toMatch(/宣稱全套但沒跑完/);
  });

  it('沒有 --full 的 --in(部分跑,沒有宣稱)→ 截斷也不算問題:本來就不比基準、不印提示,退出碼 0', () => {
    const d = rawDir('partial-truncated', FOUR);
    evidence(d, { total: 4, passed: 4 }, 0);
    writeFileSync(join(d, '1.jsonl'), FOUR.slice(0, 2).map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
    const r = run(['--in', d, '--intended', registry('partial-truncated', 5)]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/部分跑/);
    expect(r.stdout).not.toMatch(HINT);
    expect(r.stdout).not.toMatch(/宣稱全套/);
    expect(r.summary).toMatchObject({ scope: 'partial', ranAll: false });
  });

  it('自己起 vitest 時:加 --reporter=json --outputFile(是加不是換,default reporter 還在),raw 目錄留下兩個證據檔,紀錄數 == 要跑的數', () => {
    // 這條(跟同檔其他用 run() 的測試不同)是真的起一個 tsx + vitest 子行程跑一個測試檔,
    // 冷啟動就會超過 vitest 預設的 5000ms 測試逾時,即使單獨跑也一樣(2026-09-05 量過)。
    // spawnSync 本身的 90_000ms 逾時(見 run())沒變,這裡放寬的是外層 it() 的逾時。
    const r = run(['--', 'packages/core/src/weekly/iso-week.test.ts']);
    expect(r.status).toBe(0);
    // 指令列印出來的就是實際 spawn 的參數:default 與 json 兩個 reporter 都在
    const cmd = r.stdout.match(/^▶ (.+)$/m)?.[1] ?? '';
    expect(cmd).toMatch(/--reporter=default/);
    expect(cmd).toMatch(/--reporter=json/);
    expect(cmd).toMatch(new RegExp(`--outputFile=\\S*${VITEST_JSON_FILE.replace('.', '\\.')}`));
    // default reporter 的輸出還在(沒被 json 換掉)
    expect(r.stdout).toMatch(/Test Files\s+1 passed/);
    const rawRel = cmd.match(/DEGRADED_WITNESS_DIR=(\S+)/)?.[1] ?? '';
    const raw = join(REPO_ROOT, rawRel);
    expect(existsSync(join(raw, VITEST_JSON_FILE)), `${raw} 裡沒有 ${VITEST_JSON_FILE}`).toBe(true);
    expect(existsSync(join(raw, VITEST_EXIT_FILE)), `${raw} 裡沒有 ${VITEST_EXIT_FILE}`).toBe(true);
    const json = JSON.parse(readFileSync(join(raw, VITEST_JSON_FILE), 'utf8')) as { numTotalTests: number; numPendingTests: number; numTodoTests: number; success: boolean };
    expect(json.success).toBe(true);
    expect(json.numTotalTests).toBe(5);
    expect(JSON.parse(readFileSync(join(raw, VITEST_EXIT_FILE), 'utf8'))).toMatchObject({ status: 0 });
    const testEnds = readdirSync(raw)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => readFileSync(join(raw, f), 'utf8').split('\n').filter((l) => l.trim() !== ''))
      .filter((l) => (JSON.parse(l) as { test: string }).test !== OUTSIDE_ANY_TEST).length;
    expect(testEnds).toBe(json.numTotalTests - json.numPendingTests - json.numTodoTests);
    // 只跑一個檔是部分跑(沒有宣稱全套),但 ranAll 是量出來的:這次量出來為真
    expect(r.summary).toMatchObject({ scope: 'partial', ranAll: true });
    rmSync(raw, { recursive: true, force: true });
  }, 30_000);
});

/**
 * 乙的等式 (2) 靠見證器「每個 pending 的測試(runtime skip 與靜態 skip)恰好一列,標 skipped」。
 * runtime `ctx.skip()`:vitest 4 照樣跑 afterEach,見證器照樣寫一列、標 skipped,它在 skip 之前
 * 觸發過的訊號記在它自己名下,不沖到 outside(ADR-047 更正:兩種來源的錯法不同,混一桶分不出來)。
 * 靜態 skip(`it.skip` / `skipIf` / `-t` 篩掉的)沒有 afterEach,由 `afterAll` 走一遍 suite tasks 補一列
 * `skipped`、`signals: {}`——這樣見證器的「skipped 列數」才會跟 vitest 的 `numPendingTests` 同一個定義,
 * 等式 (2) 才擋得住「靜態 skip 沒有列可寫,ran_all 假紅」這個洞(2026-09-05 量過:live-run.test.ts:289
 * 的 `it.skipIf` 那個檔案有其他會跑的測試,`afterAll` 正常觸發,補得到)。
 * 這裡用 `--dir` 指到一個臨時目錄跑一個小 probe(setupFiles 仍是 repo 的,136ms),釘住:
 * runtime skip 與靜態 skip 都寫一列 skipped;outside 是 0,不含 skip 前觸發的訊號。
 */
describe('量尺 · 乙 · 見證器:runtime ctx.skip() 與靜態 skip 都寫一列 skipped,outside 不含 skip 前的訊號', () => {
  it('probe:1 passed、1 ctx.skip()(skip 前觸發一個訊號)、1 it.skip、1 todo → passed 一列 ran + 兩列 skipped,outside 0', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'lc-skip-probe-'));
    try {
      const raw = join(scratch, 'raw');
      mkdirSync(join(scratch, 'scripts'), { recursive: true });
      mkdirSync(raw, { recursive: true });
      const witnessTs = join(REPO_ROOT, 'packages/contracts/src/witness.ts');
      writeFileSync(
        join(scratch, 'scripts/probe.test.ts'),
        [
          "import { describe, expect, it } from 'vitest';",
          `import { witness } from '${witnessTs}';`,
          "describe('probe', () => {",
          "  it('passes', () => { expect(1).toBe(1); });",
          "  it('runtime skip after a signal', (ctx) => { witness('llm.fallback.cloud-failed'); ctx.skip(); });",
          "  it.skip('static skip', () => { expect(1).toBe(2); });",
          "  it.todo('todo');",
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const r = spawnSync('npx', ['vitest', 'run', '--dir', scratch, '--reporter=json', `--outputFile=${join(raw, VITEST_JSON_FILE)}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 90_000,
        env: { ...process.env, DEGRADED_WITNESS_DIR: raw },
      });
      const json = JSON.parse(readFileSync(join(raw, VITEST_JSON_FILE), 'utf8')) as { numTotalTests: number; numPendingTests: number; numTodoTests: number; numPassedTests: number };
      expect(json, r.stderr).toMatchObject({ numTotalTests: 4, numPassedTests: 1, numPendingTests: 2, numTodoTests: 1 });
      const rows = readdirSync(raw)
        .filter((f) => f.endsWith('.jsonl'))
        .flatMap((f) => readFileSync(join(raw, f), 'utf8').split('\n').filter((l) => l.trim() !== ''))
        .map((l) => JSON.parse(l) as { file: string; test: string; signals: Record<string, number>; status?: string });
      const named = rows.filter((x) => x.test !== OUTSIDE_ANY_TEST);
      const outside = rows.filter((x) => x.test === OUTSIDE_ANY_TEST);
      const ran = named.filter((x) => x.status !== 'skipped');
      const skipped = named.filter((x) => x.status === 'skipped');
      // 寫列的總數(ran + skipped)= numTotalTests − numTodoTests(todo 不寫列)
      expect(named).toHaveLength(json.numTotalTests - json.numTodoTests);
      expect(ran.map((x) => x.test)).toEqual(['probe > passes']);
      expect(skipped.map((x) => x.test).sort()).toEqual(['probe > runtime skip after a signal', 'probe > static skip']);
      // runtime skip 在 skip 之前觸發的訊號記在它自己名下,不沖到 outside
      const runtimeSkip = skipped.find((x) => x.test === 'probe > runtime skip after a signal');
      expect(runtimeSkip?.signals).toEqual({ 'llm.fallback.cloud-failed': 1 });
      // 靜態 skip 沒有 afterEach 可以觸發任何訊號,補的那一列 signals 是空的
      const staticSkip = skipped.find((x) => x.test === 'probe > static skip');
      expect(staticSkip?.signals).toEqual({});
      // outside 只抓「測試之外觸發的」;這個 probe 沒有 beforeAll/afterAll 層級的訊號,理應是 0
      expect(outside).toHaveLength(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
