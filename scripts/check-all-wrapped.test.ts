/**
 * T3 B3' 鏈輸出 wrapper 的測試(a–e + 登記)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T3-test-timeouts-and-chain-lock.md「B3' 鏈輸出 wrapper」與「驗收條件 B3' a–e」。
 *
 * 釘住的名字(工單把名字留給實作,測試得有一個):
 *   - 檔案:`scripts/check-all-wrapped.ts`(consumer 自己的檔,不帶 SOURCE 標頭);`package.json` 的 `check:all` = `tsx scripts/check-all-wrapped.ts`
 *   - 匯出 `runWrapped({ command: string, args: string[], intervalMs: number }): Promise<number>`:啟動被包指令(stdio inherit)、起跑印一行、每 intervalMs 毫秒印一行取樣、
 *     子行程結束後清掉計時器、印結束行、resolve 退出碼(= 子行程退出碼;被訊號殺掉 = 128 + 訊號編號;起不來 = 非 0)。**不自己 process.exit**,而且 resolve 之後行程要能自己結束。
 *     intervalMs 在這個函式裡不另設下限(測試用 50–100 毫秒)。CLI 不開口換被包指令:CLI = `runWrapped({ command: process.execPath, args: [check-all.ts 路徑, ...process.argv.slice(2)], intervalMs })`。
 *   - 輸出行(全部寫 stderr、一行一筆,逐字前綴 `[chain-env]`):
 *       `[chain-env] start host=<主機名> cores=<數字> workers=<數字|default> load=<1分>/<5分>/<15分> time=<ISO 8601 含時區>`
 *       `[chain-env] end   host=… cores=… workers=… load=… time=…`(`end` 後面一個空白;後面還可以多帶欄位,例如 exit=)
 *       `[chain-env] sample host=… cores=… workers=… load=… time=…`(取樣行;至少要有 load= 與 time=,host/cores/workers 可有可無)
 *     host = os.hostname()、cores = os.availableParallelism()、workers = VITEST_MAX_WORKERS(沒設印 `default`,不猜數字)、load = os.loadavg() 三個數字(`1.23` 形式)。
 *   - CLI 取樣間隔:環境變數 `CHAIN_ENV_SAMPLE_MS`(預設 30000);不是正整數或 < 100 → 在啟動 check-all 前退出碼 2、stderr 點名該變數。
 *
 * 安全:所有 spawn 的 cwd 都是 EMPTY_CWD(空的、非 git 的暫存目錄),見 EMPTY_CWD 的說明;wrapper 啟動 check-all 不得依賴 cwd。
 * 測試方式:
 *   - 匯出函式(a、b 取樣、c、e):用一個暫存的 runner(.mts)匯入 wrapper 並呼叫 runWrapped,當成子行程跑,從外面看它的 stdout/stderr/退出碼/收到訊號;
 *     這樣才能看見「stdio inherit 之後被包指令自己的輸出」與「wrapper 自己的行」是否分流、以及 resolve 後行程會不會卡住。
 *   - CLI(b 的驗證、c 的轉發與逐字、登記):對一個假 consumer(package.json + scripts/gates.config.json)真的跑 wrapper,跟直接跑 check-all.ts 的輸出比。
 *   - d:check-all.ts 整個檔案的 sha256 釘死(模板檔,勿手改),package.json 的 check:all 指到 wrapper。
 *   - 登記:zero-input-roster.ts 要有 `scripts/check-all-wrapped.ts` 的 entry,probe builder 與 check-all 那四個是同一批函式(不是複製);boundaries.owners.json 要登記。
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ROSTER } from './zero-input-roster.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = resolve(import.meta.dirname, '..');
const WRAPPER = join(ROOT, 'scripts/check-all-wrapped.ts');
const CHECK_ALL = join(ROOT, 'scripts/check-all.ts');
const TSX_CLI = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const CHECK_ALL_SHA256 = '3b776a6d4e45515cb06da3f8990e5db3f272050f79d144f531e22de369656c01';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/**
 * 所有會起子行程的測試都用這個 cwd:一個空的、不在任何 git 工作樹裡的暫存目錄。
 * 為什麼:check-all 沒有 --root 時用 cwd 的 git 根,cwd 是 repo 根的話,wrapper 一旦壞到不轉 --root,就會起真的整鏈(全套 vitest、cargo build)。
 * 在這個 cwd 下沒有 --root 的 check-all 只會印「找不到 package.json」、FAIL、退出 1,不起任何一步。
 * 因此 wrapper 啟動 check-all 的方式不能依賴 cwd(例如不能 `--import tsx` 靠 cwd 解析 tsx;要用絕對路徑)。
 */
const EMPTY_CWD = tmp('lc-t3b-cwd-');

function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _n, VITEST_MAX_WORKERS: _w, CHAIN_ENV_SAMPLE_MS: _s, ...rest } = process.env;
  const env: NodeJS.ProcessEnv = { ...rest };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

// ---------------------------------------------------------------- runner:匯入 wrapper、呼叫 runWrapped

const RUNNER_DIR = tmp('lc-t3b-runner-');
const RUNNER = join(RUNNER_DIR, 'runner.mts');
writeFileSync(
  RUNNER,
  [
    `import { runWrapped } from ${JSON.stringify(pathToFileURL(WRAPPER).href)};`,
    `const [command, ...args] = process.argv.slice(2);`,
    `const intervalMs = Number(process.env.RUNNER_INTERVAL_MS ?? '100000');`,
    `const code = await runWrapped({ command: command!, args, intervalMs });`,
    // 不呼叫 process.exit:resolve 之後行程要能自己結束(計時器清掉了),否則 wrapper 會卡住。
    `process.exitCode = code;`,
    ``,
  ].join('\n'),
  'utf8',
);

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}
function runRunner(childArgs: string[], env: Record<string, string | undefined> = {}, timeoutMs = 60_000): Ran {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [TSX_CLI, RUNNER, ...childArgs], { cwd: EMPTY_CWD, encoding: 'utf8', env: cleanEnv(env), timeout: timeoutMs });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT', ms: Date.now() - t0 };
}
const node = (script: string): string[] => [process.execPath, '-e', script];

const FIELDS = String.raw`host=(\S+) cores=(\d+) workers=(\d+|default) load=(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) time=(\S+)`;
const START_RE = new RegExp(String.raw`^\[chain-env\] start ${FIELDS}(?: .*)?$`);
const END_RE = new RegExp(String.raw`^\[chain-env\] end ${FIELDS}(?: .*)?$`);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const chainLines = (text: string): string[] => text.split('\n').filter((l) => l.startsWith('[chain-env]'));
const nonChain = (text: string): string => text.split('\n').filter((l) => !l.startsWith('[chain-env]')).join('\n');

// ================================================================ a. 起跑與結束行

describe('B3\' a:起跑與結束各在 stderr 印一行 [chain-env](host、核數、worker 數、1/5/15 load、ISO 8601 含時區)', () => {
  it('有設 VITEST_MAX_WORKERS:兩行各有 host / cores / workers=<數字> / load / time;值是這台機器的真值', () => {
    const before = Date.now();
    const r = runRunner(node(`console.log('child-out');console.error('child-err')`), { VITEST_MAX_WORKERS: '3' });
    const after = Date.now();
    expect(r.status, r.stderr).toBe(0);
    const lines = chainLines(r.stderr);
    expect(lines.length, `沒有長壓時間的子行程、間隔 100 秒 → 只有起跑與結束兩行:${lines.join('\n')}`).toBe(2);
    const start = START_RE.exec(lines[0]!);
    const end = END_RE.exec(lines[1]!);
    expect(start, `起跑行格式不對:${lines[0]}`).not.toBeNull();
    expect(end, `結束行格式不對:${lines[1]}`).not.toBeNull();
    for (const m of [start!, end!]) {
      expect(m[1]).toBe(hostname());
      expect(Number(m[2])).toBe(availableParallelism());
      expect(m[3]).toBe('3');
      expect(m[7]).toMatch(ISO_RE);
      const t = Date.parse(m[7]!);
      expect(t).toBeGreaterThanOrEqual(before - 2000);
      expect(t).toBeLessThanOrEqual(after + 2000);
    }
    expect(Date.parse(end![7]!)).toBeGreaterThanOrEqual(Date.parse(start![7]!));
  });

  it('沒設 VITEST_MAX_WORKERS:印 workers=default,不猜數字', () => {
    const r = runRunner(node('0'), { VITEST_MAX_WORKERS: undefined });
    expect(r.status, r.stderr).toBe(0);
    for (const line of chainLines(r.stderr)) expect(line).toMatch(/ workers=default /);
    expect(chainLines(r.stderr).length).toBeGreaterThanOrEqual(2);
  });

  it('起跑行在被包指令之前、結束行在它之後(同一條 stderr 的順序)', () => {
    const r = runRunner(node(`console.error('child-err-marker')`));
    const at = (needle: string): number => r.stderr.split('\n').findIndex((l) => l.includes(needle));
    expect(at('[chain-env] start')).toBeGreaterThanOrEqual(0);
    expect(at('[chain-env] start')).toBeLessThan(at('child-err-marker'));
    expect(at('child-err-marker')).toBeLessThan(at('[chain-env] end'));
  });

  it('wrapper 的行一律走 stderr:被包指令的 stdout 一個 [chain-env] 都沒有、而且逐字不變', () => {
    const r = runRunner(node(`console.log('child-out-1');console.log('child-out-2')`));
    expect(r.stdout).toBe('child-out-1\nchild-out-2\n');
    expect(r.stdout).not.toContain('[chain-env]');
  });

  it('被包指令失敗時結束行也要印(退出碼不是 0 也一樣)', () => {
    const r = runRunner(node('process.exit(5)'));
    expect(r.status).toBe(5);
    expect(chainLines(r.stderr).some((l) => END_RE.test(l))).toBe(true);
  });
});

// ================================================================ b. 取樣

describe('B3\' b:取樣(間隔、子行程結束後停、不卡住)', () => {
  it('子行程跑 1.2 秒、間隔 100 毫秒:起跑與結束之間至少 5 行取樣,每行有 load= 與 time=(ISO)', () => {
    const r = runRunner([...node(`setTimeout(() => {}, 1200)`)], { RUNNER_INTERVAL_MS: '100' });
    expect(r.status, r.stderr).toBe(0);
    const lines = chainLines(r.stderr);
    const startAt = lines.findIndex((l) => START_RE.test(l));
    const endAt = lines.findIndex((l) => END_RE.test(l));
    expect(startAt).toBe(0);
    expect(endAt).toBe(lines.length - 1);
    const samples = lines.slice(startAt + 1, endAt);
    expect(samples.length, `取樣行數 ${samples.length}`).toBeGreaterThanOrEqual(5);
    for (const s of samples) {
      expect(s).toMatch(/^\[chain-env\] sample /);
      expect(s).toMatch(/ load=\d+(?:\.\d+)?\/\d+(?:\.\d+)?\/\d+(?:\.\d+)?(?: |$)/);
      const t = /time=(\S+)/.exec(s);
      expect(t?.[1], s).toMatch(ISO_RE);
    }
  });

  it('取樣沒有比預期多很多(間隔 100 毫秒、跑 1.2 秒 → 不會超過 20 行)', () => {
    const r = runRunner(node(`setTimeout(() => {}, 1200)`), { RUNNER_INTERVAL_MS: '100' });
    expect(chainLines(r.stderr).some((l) => START_RE.test(l)), '前提:wrapper 真的有跑').toBe(true);
    const samples = chainLines(r.stderr).filter((l) => l.startsWith('[chain-env] sample'));
    expect(samples.length).toBeLessThanOrEqual(20);
  });

  it('子行程結束後不再印取樣、runWrapped resolve 之後行程自己結束(計時器清掉,不卡到逾時)', () => {
    const r = runRunner(node('0'), { RUNNER_INTERVAL_MS: '50' }, 20_000);
    expect(r.timedOut, 'wrapper 卡著不退出(計時器沒清)').toBe(false);
    expect(r.status).toBe(0);
    const lines = chainLines(r.stderr);
    expect(lines.at(-1), '結束行是最後一行,後面沒有取樣').toMatch(/^\[chain-env\] end /);
  });

  it('預設用長間隔時,短命令不會等到第一次取樣才退出(行程在 10 秒內結束)', () => {
    const r = runRunner(node('0'), { RUNNER_INTERVAL_MS: '60000' }, 30_000);
    expect(r.timedOut).toBe(false);
    expect(r.ms).toBeLessThan(15_000);
    expect(chainLines(r.stderr).some((l) => START_RE.test(l)) && chainLines(r.stderr).some((l) => END_RE.test(l)), '前提:wrapper 真的有跑').toBe(true);
    expect(chainLines(r.stderr).filter((l) => l.startsWith('[chain-env] sample'))).toEqual([]);
  });
});

// ================================================================ CLI 假 consumer

interface Fixture {
  root: string;
  marker: string;
}
function fixture(scripts: Record<string, string> | ((marker: string) => Record<string, string>), chain: string[]): Fixture {
  const root = tmp('lc-t3b-consumer-');
  const marker = join(root, 'MARKER');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'c', private: true, scripts: typeof scripts === 'function' ? scripts(marker) : scripts }), 'utf8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/gates.config.json'), JSON.stringify({ chain }), 'utf8');
  return { root, marker };
}
const markerScript = (marker: string): string => `node -e "require('fs').appendFileSync(${JSON.stringify(marker).replace(/"/g, "'")},'x')"`;

function runCli(entry: string, args: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TSX_CLI, entry, ...args], { cwd: EMPTY_CWD, encoding: 'utf8', env: cleanEnv(env), timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('B3\' b(CLI):CHAIN_ENV_SAMPLE_MS 壞輸入 → 啟動前退出碼 2、點名變數、被包指令一次都沒跑', () => {
  for (const bad of ['abc', '0', '-100', '99', '50', '1.5', '100abc', 'NaN']) {
    it(`CHAIN_ENV_SAMPLE_MS=${bad}:退出碼 2、stderr 提到 CHAIN_ENV_SAMPLE_MS、marker 沒被寫、stdout 沒有 gate 行`, () => {
      const fx = fixture((m) => ({ mark: markerScript(m) }), ['mark']);
      const r = runCli(WRAPPER, ['--root', fx.root], { CHAIN_ENV_SAMPLE_MS: bad });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2);
      expect(r.stderr).toContain('CHAIN_ENV_SAMPLE_MS');
      expect(existsSync(fx.marker), '被包指令不該被啟動').toBe(false);
      expect(r.stdout).not.toMatch(/gate=all/);
      expect(r.stdout).not.toContain('check-all:');
    });
  }

  for (const good of ['100', '250', '30000']) {
    it(`CHAIN_ENV_SAMPLE_MS=${good}(合法,100 是下限):照跑、退出碼 0、marker 被寫一次`, () => {
      const fx = fixture((m) => ({ mark: markerScript(m) }), ['mark']);
      const r = runCli(WRAPPER, ['--root', fx.root], { CHAIN_ENV_SAMPLE_MS: good });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      expect(readFileSync(fx.marker, 'utf8')).toBe('x');
    });
  }

  it('沒設 CHAIN_ENV_SAMPLE_MS:用預設(不報錯、照跑)', () => {
    const fx = fixture((m) => ({ mark: markerScript(m) }), ['mark']);
    const r = runCli(WRAPPER, ['--root', fx.root], {});
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(readFileSync(fx.marker, 'utf8')).toBe('x');
  });
});

// ================================================================ c. 逐字、退出碼、參數轉發

describe('B3\' c(匯出函式):失敗輸出逐字、退出碼相同、stdout 最後一行是被包指令的最後一行、參數原樣轉發', () => {
  it('失敗指令:退出碼 7;stdout 與 stderr 逐字(扣掉 [chain-env] 行)等於被包指令自己印的', () => {
    const r = runRunner(node(`console.log('OUT-1');console.error('ERR-逐字 ✗ 失敗 \\u0007 tab\\there');console.log('OUT-last');process.exit(7)`));
    expect(r.status).toBe(7);
    expect(r.stdout).toBe('OUT-1\nOUT-last\n');
    expect(nonChain(r.stderr)).toBe('ERR-逐字 ✗ 失敗 \u0007 tab\there\n');
  });

  it('成功指令:退出碼 0;stdout 的最後一行是被包指令自己的最後一行(沒有 wrapper 的行排在後面)', () => {
    const r = runRunner(node(`console.log('first');console.log('gate=all result=PASS scanned=3')`));
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=all result=PASS scanned=3');
    expect(r.stdout).toBe('first\ngate=all result=PASS scanned=3\n');
  });

  it('退出碼原樣:0、1、2、42、255 都原樣回來', () => {
    for (const code of [0, 1, 2, 42, 255]) {
      const r = runRunner(node(`process.exit(${code})`));
      expect(r.status, `exit ${code}`).toBe(code);
    }
  });

  it('參數原樣轉發(空字串、空白、引號、萬用字元、$、中文、--旗標=值 都不被 shell 或 wrapper 改寫)', () => {
    const args = ['', 'a b', "it's", 'say "hi"', '*', '$HOME', '--flag=x y', '中文 參數', '-', '--'];
    const r = runRunner([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(args);
  });

  it('指令找不到:退出碼不是 0、有說明、不卡住', () => {
    const r = runRunner(['/nonexistent/definitely-not-a-command-xyz'], {}, 20_000);
    expect(r.timedOut).toBe(false);
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBeNull();
    expect(nonChain(r.stderr).trim().length + r.stdout.length).toBeGreaterThan(0);
    expect(chainLines(r.stderr).some((l) => END_RE.test(l)), '起不來也要印結束行').toBe(true);
  });
});

describe('B3\' 安全:不管 wrapper 怎麼壞,測試都不會在 repo 根起真的整鏈', () => {
  it('測試用的 cwd 是空目錄、不在任何 git 工作樹裡', () => {
    expect(readdirSync(EMPTY_CWD)).toEqual([]);
    const g = spawnSync('git', ['-C', EMPTY_CWD, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    expect(g.status, `${g.stdout}`).not.toBe(0);
  });

  it('這個 cwd 下、沒有 --root 的 check-all 不起任何一步:印找不到、FAIL、退出 1(wrapper 吞掉 --root 時就是這個下場)', () => {
    const r = runCli(CHECK_ALL, []);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(1);
    expect(r.stdout).toMatch(/gate=all result=FAIL/);
    expect(r.stdout).not.toMatch(/^✓ /m);
  });
});

describe('B3\' c(CLI):跟直接跑 check-all.ts 比——退出碼、stdout、stderr(扣掉 [chain-env] 行)逐字相同,參數轉給 check-all', () => {
  const okFx = (): Fixture => fixture({ ok: 'node -e "console.log(\'hello-from-ok\')"', ok2: 'node -e "console.log(\'hello-from-ok2\')"' }, ['ok', 'ok2']);
  const badFx = (): Fixture => {
    return fixture((m) => ({ bad: `node -e "console.error('BOOM-verbatim ✗');process.exit(3)"`, after: markerScript(m) }), ['bad', 'after']);
  };

  const compare = (fx: Fixture, args: string[]): { wrapped: ReturnType<typeof runCli>; direct: ReturnType<typeof runCli> } => {
    const wrapped = runCli(WRAPPER, ['--root', fx.root, ...args], { CHAIN_ENV_SAMPLE_MS: '100' });
    const direct = runCli(CHECK_ALL, ['--root', fx.root, ...args]);
    return { wrapped, direct };
  };

  it('全綠的鏈:退出碼 0 相同、stdout 逐字相同、最後一行是 check-all 的 gate 行', () => {
    const { wrapped, direct } = compare(okFx(), []);
    expect(direct.status, direct.stderr).toBe(0);
    expect(wrapped.status, wrapped.stderr).toBe(direct.status);
    expect(wrapped.stdout).toBe(direct.stdout);
    expect(wrapped.stdout.trimEnd().split('\n').at(-1)).toMatch(/^gate=all result=PASS/);
    expect(nonChain(wrapped.stderr)).toBe(direct.stderr);
    expect(wrapped.stdout).not.toContain('[chain-env]');
    expect(chainLines(wrapped.stderr).some((l) => START_RE.test(l))).toBe(true);
    expect(chainLines(wrapped.stderr).some((l) => END_RE.test(l))).toBe(true);
  });

  it('有一步失敗的鏈:退出碼(1)相同、失敗那步的輸出逐字出現在原通道、stdout 逐字相同', () => {
    const fx = badFx();
    const { wrapped, direct } = compare(fx, []);
    expect(direct.status).toBe(1);
    expect(wrapped.status).toBe(1);
    expect(wrapped.stdout).toBe(direct.stdout);
    expect(wrapped.stderr).toContain('BOOM-verbatim ✗');
    expect(nonChain(wrapped.stderr)).toBe(direct.stderr);
    expect(wrapped.stdout.trimEnd().split('\n').at(-1)).toMatch(/^gate=all result=FAIL/);
  });

  it('--fail-fast 有轉給 check-all:失敗後面那步沒跑;不帶旗標時有跑', () => {
    const withFlag = badFx();
    expect(runCli(WRAPPER, ['--root', withFlag.root, '--fail-fast'], { CHAIN_ENV_SAMPLE_MS: '100' }).status).toBe(1);
    expect(existsSync(withFlag.marker), '--fail-fast 沒轉給 check-all').toBe(false);
    const without = badFx();
    expect(runCli(WRAPPER, ['--root', without.root], { CHAIN_ENV_SAMPLE_MS: '100' }).status).toBe(1);
    expect(existsSync(without.marker)).toBe(true);
  });

  it('--markdown 有轉給 check-all(輸出多一段 fenced code block),--root 也有轉(不然找不到假 consumer 的鏈)', () => {
    const fx = okFx();
    const { wrapped, direct } = compare(fx, ['--markdown']);
    expect(direct.stdout).toContain('```');
    expect(wrapped.stdout).toBe(direct.stdout);
    expect(wrapped.status).toBe(0);
  });

  it('壞設定(check-all 自己的錯誤):退出碼 1 與訊息逐字相同', () => {
    const fx = fixture({}, []);
    const { wrapped, direct } = compare(fx, []);
    expect(direct.status).toBe(1);
    expect(wrapped.status).toBe(1);
    expect(wrapped.stdout).toBe(direct.stdout);
    expect(nonChain(wrapped.stderr)).toBe(direct.stderr);
  });
});

// ================================================================ e. 訊號

interface Live {
  child: ReturnType<typeof spawn>;
  out: () => string;
  err: () => string;
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
function startRunner(childArgs: string[]): Live {
  const child = spawn(process.execPath, [TSX_CLI, RUNNER, ...childArgs], { cwd: EMPTY_CWD, env: cleanEnv({ RUNNER_INTERVAL_MS: '100000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => child.on('close', (code, signal) => res({ code, signal })));
  return { child, out: () => out, err: () => err, done };
}
async function until(cond: () => boolean, label: string, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`等不到:${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const SIGNAL_NUMBER: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

describe('B3\' e:子行程被訊號殺掉 → 128 + 訊號編號;wrapper 收到 SIGINT / SIGTERM 轉給子行程', () => {
  for (const sig of ['SIGKILL', 'SIGTERM', 'SIGINT'] as const) {
    it(`被包指令被 ${sig} 殺掉:退出碼 ${128 + SIGNAL_NUMBER[sig]!}(不是 0)`, () => {
      const r = runRunner(node(`process.kill(process.pid, '${sig}'); setTimeout(() => {}, 10000)`));
      expect(r.status, r.stderr).toBe(128 + SIGNAL_NUMBER[sig]!);
      expect(chainLines(r.stderr).some((l) => END_RE.test(l)), '被殺掉也要印結束行').toBe(true);
    });
  }

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    it(`wrapper 收到 ${sig}:子行程也收到(子行程的 handler 印出收到)`, async () => {
      const live = startRunner(node(`process.on('${sig}', () => { console.log('child-got-${sig}'); process.exit(0); }); console.log('ready'); setInterval(() => {}, 1000)`));
      await until(() => live.out().includes('ready'), '子行程 ready');
      live.child.kill(sig);
      const res = await live.done;
      expect(live.out(), `子行程沒收到 ${sig}:${live.err()}`).toContain(`child-got-${sig}`);
      expect(res.code, '子行程自己 exit 0,wrapper 原樣回 0').toBe(0);
    });

    it(`wrapper 收到 ${sig}、子行程沒有 handler:子行程被轉來的訊號殺掉 → wrapper 退出碼 ${128 + SIGNAL_NUMBER[sig]!}`, async () => {
      const live = startRunner(node(`console.log('ready'); setInterval(() => {}, 1000)`));
      await until(() => live.out().includes('ready'), '子行程 ready');
      live.child.kill(sig);
      const res = await live.done;
      expect(res.signal, 'wrapper 自己不能被訊號殺掉,要先等子行程').toBeNull();
      expect(res.code).toBe(128 + SIGNAL_NUMBER[sig]!);
    });
  }
});

// ================================================================ d. check-all.ts 不改、package.json、登記

describe('B3\' d:check-all.ts 一個位元組都沒動;check:all 指到 wrapper', () => {
  it('scripts/check-all.ts 的 sha256 與基底相同(模板檔,勿手改)', () => {
    const sha = createHash('sha256').update(readFileSync(CHECK_ALL)).digest('hex');
    expect(sha).toBe(CHECK_ALL_SHA256);
    expect(readFileSync(CHECK_ALL, 'utf8').split('\n')[0]).toMatch(/^\/\/ SOURCE: template v1\.6\.8/);
  });

  it('package.json 的 check:all 是 `tsx scripts/check-all-wrapped.ts`;wrapper 自己沒有 SOURCE 標頭(consumer 自己的檔)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:all']).toBe('tsx scripts/check-all-wrapped.ts');
    expect(existsSync(WRAPPER), 'scripts/check-all-wrapped.ts 要存在').toBe(true);
    expect(readFileSync(WRAPPER, 'utf8').split('\n')[0]).not.toMatch(/SOURCE: template/);
  });

  it('wrapper 啟動的是 check-all.ts(不是複製一份邏輯)', () => {
    const text = readFileSync(WRAPPER, 'utf8');
    expect(text).toMatch(/check-all\.ts/);
    expect(text).toMatch(/export (async )?function runWrapped|export const runWrapped/);
  });
});

describe('B3\' 登記:零輸入守門的 entry 與 owners', () => {
  const wrapped = ROSTER['scripts/check-all-wrapped.ts'];
  const base = ROSTER['scripts/check-all.ts'];

  it('zero-input-roster 有 scripts/check-all-wrapped.ts 的 entry(不是 excluded、不是 library)', () => {
    expect(wrapped, 'scripts/zero-input-roster.ts 要登記 scripts/check-all-wrapped.ts').toBeDefined();
    expect(wrapped!.kind).toBe('entry');
  });

  it('沿用 check-all 的四個 --root 假 consumer 探針:名字同、四種 kind 齊、builder 與 healthy 基線是同一批函式(不複製)', () => {
    if (!wrapped || wrapped.kind !== 'entry' || base?.kind !== 'entry') throw new Error('兩邊都要是 entry');
    const w = wrapped.commands[0]!;
    const b = base.commands[0]!;
    expect(w.probes.map((p) => p.name)).toEqual(b.probes.map((p) => p.name));
    expect(new Set(w.probes.map((p) => p.kind))).toEqual(new Set(['empty', 'missing', 'malformed', 'wrong-type']));
    w.probes.forEach((p, i) => expect(p.build, `probe「${p.name}」的 builder 要與 check-all 共用`).toBe(b.probes[i]!.build));
    expect(w.baselines['healthy'], 'healthy 基線的 builder 要與 check-all 共用').toBe(b.baselines['healthy']);
  });

  const ownersText = (): string => readFileSync(join(ROOT, 'scripts/boundaries.owners.json'), 'utf8');
  it('boundaries.owners.json 登記 wrapper(infra)', () => {
    expect(ownersText()).toMatch(/"scripts\/check-all-wrapped\.ts",\s*"infra"/);
  });
  it('boundaries.owners.json 登記它的測試(測試 agent 已登記;worker 不要拿掉)', () => {
    expect(ownersText()).toMatch(/"scripts\/check-all-wrapped\.test\.ts",\s*"infra"/);
  });
});
