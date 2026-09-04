/**
 * scripts/lint.ts 的「掃描器壞了」測試(P-28,面向使用者資料的那一半)。
 *
 * 守的是跟 check-boundaries / check-doc-links 完全同一件事,只是這次的受害者
 * 不是 repo 而是**使用者幾個月的學習資料**:
 *
 *   $ npx tsx scripts/lint.ts --dir ./learning        # 25 張卡 + 25 份考題
 *   0 problems found.                                  exit=0
 *   $ npx tsx scripts/lint.ts --dir <完全空的目錄>
 *   0 problems found.                                  exit=0
 *
 * 除了時間戳與路徑,一個字都不差。使用者的卡片如果因為路徑改了、目錄搬了、
 * 同步壞了而全部消失,他看到的是一模一樣的綠燈。所以:
 *
 *   1. 報告與 stdout 都要印**檢查數量**(幾個類別、幾張卡、幾份考題、
 *      graph 與 order 檔在不在),形狀比照 boundaries 的
 *      「掃描 195 個檔案,允許例外 11 條」。
 *   2. 掃到 0 張卡 → exit 1,共用那句「這不是很乾淨,是掃描器壞了」。
 *   3. 三種「0」要分得出來,使用者才知道要修什麼:
 *      cards/ 不存在 / cards/ 底下沒有類別子目錄 / 類別目錄裡沒有 .md。
 *   4. --dir 指到不存在的目錄 → 明確錯誤,不當機也不綠燈,而且**不可以
 *      順手把那個目錄建出來**(今天會,見 `--dir 不存在` 那一組)。
 *
 * 測法:一律用臨時目錄,絕不拿 `/data/python/llm_learning-cards/learning/`
 * 當測試對象(CLAUDE.md 硬規則 2)。lint.ts 正常行為就會往 `<dir>/state/`
 * 寫報告檔,拿真 vault 當受測目錄等於在寫使用者的資料。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** 三支守門掃描器共用的那句話。看到它就知道方向是「掃描器壞了」,不是「資料很乾淨」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** P-28 之前唯一的那行輸出。0 張卡的路徑不可以再只印它。 */
const OLD_CLEAN_LINE = '0 problems found.';

/**
 * spawnSync 起一個 `npx tsx` 子行程要一到三秒,機器忙的時候更久。vitest 預設
 * 5 秒會讓這些測試在負載高時假性變紅,所以每條都放寬(同 check-boundaries.test.ts)。
 */
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

function tmpRoot(prefix = 'lc-lint-cli-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** learning-minimal 的複本:3 張卡、3 份考題、1 個類別、deps.json + 1 份 order 檔。 */
function healthyVault(): string {
  const dir = tmpRoot();
  cpSync(join(REPO_ROOT, 'contracts/fixtures/learning-minimal'), dir, { recursive: true });
  return dir;
}

function run(dir: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', 'scripts/lint.ts', '--dir', dir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 讀 CLI 剛寫出來的那份報告(`<dir>/state/lint-report-<日期>.md`)。 */
function readReport(dir: string): string {
  const stateDir = join(dir, 'state');
  if (!existsSync(stateDir)) return '';
  const report = readdirSync(stateDir).find((n) => n.startsWith('lint-report-') && n.endsWith('.md'));
  return report ? readFileSync(join(stateDir, report), 'utf8') : '';
}

/** 從輸出裡撈一個「N <單位>」的數字。撈不到回傳 null,測試就會指著缺的那個數字紅。 */
function count(output: string, unit: string): number | null {
  const m = new RegExp(`(\\d+)\\s*${unit}`).exec(output);
  return m ? Number(m[1]) : null;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('lint.ts 印出檢查數量(空的跟健康的不可以長一樣)', () => {
  it('健康的 vault:stdout 帶類別 / 卡 / 考題三個數字,而且數字跟磁碟上的一致', () => {
    const dir = healthyVault();
    const { code, output } = run(dir);

    expect(code).toBe(0);
    expect(count(output, '個類別')).toBe(1);
    expect(count(output, '張卡')).toBe(3);
    expect(count(output, '份考題')).toBe(3);
  }, SPAWN_TIMEOUT_MS);

  it('健康的 vault:stdout 說得出 graph 的 deps 與 order 檔在不在', () => {
    const dir = healthyVault();
    const { output } = run(dir);

    expect(output).toContain('deps.json');
    expect(output).toContain('order');
  }, SPAWN_TIMEOUT_MS);

  it('數字是真的數出來的,不是寫死的字串:加一張卡與一份考題,數字要跟著動', () => {
    const dir = healthyVault();
    const before = run(dir).output;
    expect(count(before, '張卡')).toBe(3);
    expect(count(before, '份考題')).toBe(3);

    // 第二個類別 + 第 4 張卡 + 第 4 份考題。刻意換類別,連類別數也要跟著動。
    mkdirSync(join(dir, 'cards/network'), { recursive: true });
    writeFileSync(
      join(dir, 'cards/network/net-0001.md'),
      [
        '---',
        'id: net-0001',
        'category: network',
        'title: 三向交握',
        'level: 0',
        'source: raw',
        'source_ref: raw/network/tcp.md#L1-L5',
        'created: 2026-09-01',
        'prereqs: []',
        '---',
        'TCP 連線開始前雙方要先交換三個封包確認彼此都收得到。',
        '',
      ].join('\n'),
      'utf8',
    );
    cpSync(join(dir, 'questions/sec-0001.yaml'), join(dir, 'questions/net-0001.yaml'));
    writeFileSync(
      join(dir, 'questions/net-0001.yaml'),
      readFileSync(join(dir, 'questions/net-0001.yaml'), 'utf8').replace('card: sec-0001', 'card: net-0001'),
      'utf8',
    );

    const after = run(dir).output;
    expect(count(after, '個類別')).toBe(2);
    expect(count(after, '張卡')).toBe(4);
    expect(count(after, '份考題')).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it('寫出去的報告檔也帶同一組數字,不是只有終端機看得到', () => {
    const dir = healthyVault();
    run(dir);
    const report = readReport(dir);

    expect(report).not.toBe('');
    expect(count(report, '張卡')).toBe(3);
    expect(count(report, '份考題')).toBe(3);
  }, SPAWN_TIMEOUT_MS);
});

describe('lint.ts 掃到 0 張卡一律 FAIL,而且三種 0 分得出來', () => {
  /** cards/ 整個不存在——目錄被搬走 / 路徑打錯 / 同步刪掉。 */
  function noCardsDir(): string {
    const dir = healthyVault();
    rmSync(join(dir, 'cards'), { recursive: true, force: true });
    return dir;
  }

  /** cards/ 在,但底下一個類別子目錄都沒有——init 過但還沒 ingest 任何東西。 */
  function noCategoryDir(): string {
    const dir = healthyVault();
    rmSync(join(dir, 'cards'), { recursive: true, force: true });
    mkdirSync(join(dir, 'cards'), { recursive: true });
    return dir;
  }

  /** 類別目錄在,但裡面沒有任何 .md——卡片檔案本身消失了,最像「資料不見了」的一種。 */
  function emptyCategoryDir(): string {
    const dir = healthyVault();
    for (const name of readdirSync(join(dir, 'cards/security'))) {
      rmSync(join(dir, 'cards/security', name), { force: true });
    }
    return dir;
  }

  it('cards/ 不存在 → exit 1,並且說出方向是掃描器壞了', () => {
    const { code, output } = run(noCardsDir());
    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 存在但沒有類別子目錄 → exit 1,並且說出方向是掃描器壞了', () => {
    const { code, output } = run(noCategoryDir());
    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);

  it('類別目錄存在但裡面沒有 .md → exit 1,並且說出方向是掃描器壞了', () => {
    const { code, output } = run(emptyCategoryDir());
    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 不存在時,訊息指名 cards/ 這個目錄不存在', () => {
    const { output } = run(noCardsDir());
    expect(output).toContain('cards/');
    expect(output).toMatch(/不存在|找不到/);
  }, SPAWN_TIMEOUT_MS);

  it('沒有類別子目錄時,訊息指名缺的是類別(不是說 cards/ 不存在)', () => {
    const { output } = run(noCategoryDir());
    expect(output).toContain('類別');
    // cards/ 明明在,不可以沿用「cards/ 不存在」那句話騙人。
    expect(output).not.toMatch(/cards\/[^\n]*(不存在|找不到)/);
  }, SPAWN_TIMEOUT_MS);

  it('類別目錄空的時候,訊息指名是哪一個類別空了', () => {
    const { output } = run(emptyCategoryDir());
    expect(output).toContain('security');
  }, SPAWN_TIMEOUT_MS);

  it('三種 0 的輸出兩兩不同——使用者要看得出來該修哪一種', () => {
    const strip = (s: string): string => s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<t>').replace(/\/tmp\/\S+/g, '<dir>');
    const a = strip(run(noCardsDir()).output);
    const b = strip(run(noCategoryDir()).output);
    const c = strip(run(emptyCategoryDir()).output);

    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  }, SPAWN_TIMEOUT_MS);

  it('0 張卡的時候不可以只印舊的那句「0 problems found.」就收工', () => {
    for (const dir of [noCardsDir(), noCategoryDir(), emptyCategoryDir()]) {
      const { output } = run(dir);
      expect(output.trim()).not.toBe(OLD_CLEAN_LINE);
      expect(output).toContain(SCANNER_BROKEN);
    }
  }, SPAWN_TIMEOUT_MS);

  it('健康的 vault 不可以被誤判成掃描器壞了', () => {
    const { code, output } = run(healthyVault());
    expect(code).toBe(0);
    expect(output).not.toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);
});

describe('lint.ts --dir 指到不存在的目錄', () => {
  it('exit 1,而且訊息指名那個路徑不存在', () => {
    const missing = join(tmpRoot(), 'does-not-exist');
    const { code, output } = run(missing);

    expect(code).toBe(1);
    expect(output).toContain(missing);
    expect(output).toMatch(/不存在|找不到/);
  }, SPAWN_TIMEOUT_MS);

  it('不可以順手把不存在的目錄建出來(今天會建 <dir>/state/ 再寫報告進去)', () => {
    const missing = join(tmpRoot(), 'does-not-exist');
    run(missing);

    expect(existsSync(missing)).toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('不當機:不可以把 node 的 stack trace 直接噴給使用者', () => {
    const { output } = run(join(tmpRoot(), 'does-not-exist'));
    expect(output).not.toContain('    at ');
  }, SPAWN_TIMEOUT_MS);
});
