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
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEGRADED_SIGNALS, type DegradedSignal } from '../packages/contracts/src/witness.js';
import {
  DEFAULT_INTENDED_PATH,
  aggregate,
  checkIntended,
  compareBaseline,
  describeEntryProblem,
  describeRegistryProblem,
  isStale,
  loadIntended,
  parseArgs,
  UsageError,
  type IntendedEntry,
  type IntendedRegistry,
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

describe('子行程:退出碼與訊息', () => {
  let scratch = '';
  const FILE = 'packages/core/src/llm/router-gateway.test.ts';
  const TEST = 'Suite > 刻意走分支的測試';
  const OTHER = 'Suite > 不小心走分支的測試';

  function jsonl(dir: string, records: Array<{ file: string; test: string; signals: Record<string, number> }>): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '1.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
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
