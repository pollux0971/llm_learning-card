// SOURCE: template v1.4.2 (1c1d403) sha256=69724be769bd33351a06d3aca253fab468ddabe28844d225ba05473b7688add0 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-all.ts 的單元測試(模板 1.4.0 S1)。
 *
 * 跟其餘掃描器的測試同一個形狀:不能讓真的 repo 當 fixture(太重、太慢、也沒有可控的
 * 失敗案例),所以每個測試造一個一次性的臨時目錄當「假 consumer 根」,裡面放一個
 * `package.json`(scripts 用 `node -e "process.exit(N)"` 模擬會過/會炸的守門)跟一個
 * `scripts/gates.config.json`(`chain` 欄位)。
 *
 * `GATES_CONFIG_DIR` 一定要設成 `<fixture>/scripts`:check-all.ts 找設定檔的順位 1 是
 * 「腳本自己所在的目錄」,對這裡的測試來說那是模板自己的 `scripts/`(裡面那份
 * `gates.config.json` 沒有 `chain`),不設 env 的話永遠讀到模板的佔位設定,不會讀到
 * fixture——這跟 check-boundaries.ts / check-standalone.ts 的測試是同一個坑,見
 * `_root.ts` 的 `resolveConfig` 文件。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_ALL_TS = resolve(import.meta.dirname, 'check-all.ts');

/** spawnSync 起一個 `npx tsx` 子行程要一到三秒,機器忙的時候更久,放寬逾時避免假紅。 */
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

interface FixtureOpts {
  scripts: Record<string, string>;
  gatesConfig: unknown;
}

/** 造一個一次性的假 consumer 根:package.json + scripts/gates.config.json。 */
function makeFixture({ scripts, gatesConfig }: FixtureOpts): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-check-all-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts }, null, 2), 'utf8');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'gates.config.json'), JSON.stringify(gatesConfig, null, 2), 'utf8');
  return dir;
}

function runCheckAll(fixtureDir: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_ALL_TS, '--root', fixtureDir, ...extra], {
    cwd: fixtureDir,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(fixtureDir, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const PASS = 'node -e "process.exit(0)"';
const failWith = (n: number) => `node -e "process.exit(${n})"`;

describe('check-all:全部通過', () => {
  it('鏈上每一項都 exit 0 → 整體 exit 0,印每一項的 ✓ 與 gate=all result=PASS', () => {
    const dir = makeFixture({
      scripts: { a: PASS, b: PASS },
      gatesConfig: { chain: ['a', 'b'] },
    });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(0);
    expect(output).toContain('✓ a');
    expect(output).toContain('✓ b');
    expect(output).toContain('gate=all result=PASS scanned=2');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-all:一項失敗', () => {
  it('exit 1,印 ✗ 與退出碼,--markdown 的 fenced block 也要提到那一項', () => {
    const dir = makeFixture({
      scripts: { a: PASS, broken: failWith(3) },
      gatesConfig: { chain: ['a', 'broken'] },
    });

    const { code, output } = runCheckAll(dir, '--markdown');

    expect(code).toBe(1);
    expect(output).toContain('✗ broken (exit 3)');
    expect(output).toContain('gate=all result=FAIL scanned=2');
    // markdown 摘要是一段 fenced code block,裡面要再提一次那個失敗項跟退出碼。
    expect(output).toContain('```');
    const fenced = output.slice(output.indexOf('```'));
    expect(fenced).toContain('✗ broken (exit 3)');
    expect(fenced).toContain('gate=all result=FAIL scanned=2');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-all:chain 裡的名字不是 npm script', () => {
  it('印 P-55 訊息,算失敗,不嘗試執行', () => {
    const dir = makeFixture({
      scripts: { a: PASS },
      gatesConfig: { chain: ['a', 'does-not-exist'] },
    });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('✗ does-not-exist 不是 npm script(P-55)');
    expect(output).toContain('gate=all result=FAIL scanned=2');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-all:0 個目標一律 FAIL', () => {
  it('gates.config.json 沒有 "chain" 鍵 → exit 1,印範例', () => {
    const dir = makeFixture({ scripts: { a: PASS }, gatesConfig: {} });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('gate=all result=FAIL scanned=0');
    expect(output).toContain('"chain"');
  }, SPAWN_TIMEOUT_MS);

  it('"chain" 是空陣列 → 一樣 exit 1', () => {
    const dir = makeFixture({ scripts: { a: PASS }, gatesConfig: { chain: [] } });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('gate=all result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-all:--fail-fast 對照 --continue(預設)', () => {
  it('--fail-fast:第一個失敗之後,後面的項目不執行(印 ⏭ 未執行)', () => {
    const dir = makeFixture({
      scripts: { broken: failWith(1), a: PASS },
      gatesConfig: { chain: ['broken', 'a'] },
    });

    const { code, output } = runCheckAll(dir, '--fail-fast');

    expect(code).toBe(1);
    expect(output).toContain('✗ broken (exit 1)');
    expect(output).toContain('⏭  a  (--fail-fast,未執行)');
    expect(output).not.toContain('✓ a');
    expect(output).toContain('gate=all result=FAIL scanned=2');
  }, SPAWN_TIMEOUT_MS);

  it('預設(--continue):第一個失敗之後,後面的項目照跑', () => {
    const dir = makeFixture({
      scripts: { broken: failWith(1), a: PASS },
      gatesConfig: { chain: ['broken', 'a'] },
    });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('✗ broken (exit 1)');
    expect(output).toContain('✓ a');
    expect(output).toContain('gate=all result=FAIL scanned=2');
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// S9:設定檔壞掉要大聲失敗(不是未捕捉的堆疊,也不是悄悄套用預設值)。
// ---------------------------------------------------------------------------

describe('check-all:S9 設定檔壞掉', () => {
  it('gates.config.json 是壞掉的 JSON → 印「設定檔壞掉」+ 標記,不是未捕捉的堆疊', () => {
    const dir = makeFixture({ scripts: { a: PASS }, gatesConfig: { chain: ['a'] } });
    writeFileSync(join(dir, 'scripts', 'gates.config.json'), '{ this is not json', 'utf8');

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=all result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
    expect(output).not.toContain('SyntaxError');
  }, SPAWN_TIMEOUT_MS);

  it('"chain" 型別錯(填成字串而不是陣列)→ 印「設定檔鍵型別錯」', () => {
    const dir = makeFixture({ scripts: { a: PASS }, gatesConfig: { chain: 'a' } });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔鍵型別錯:chain 應為 array');
    expect(output).toContain('gate=all result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('gates.config.json 有不認識的頂層鍵(打錯字)→ 印「設定檔有不認識的鍵」', () => {
    const dir = makeFixture({ scripts: { a: PASS }, gatesConfig: { chian: ['a'] } });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔有不認識的鍵:chian');
    expect(output).toContain('gate=all result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('合法設定不受影響(有效的 chain 照常跑,行為不變)', () => {
    const dir = makeFixture({ scripts: { a: PASS, b: PASS }, gatesConfig: { chain: ['a', 'b'] } });

    const { code, output } = runCheckAll(dir);

    expect(code).toBe(0);
    expect(output).toContain('gate=all result=PASS scanned=2');
  }, SPAWN_TIMEOUT_MS);
});
