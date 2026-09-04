/**
 * scripts/due.ts —— 空的 `{}` 不可以跟「健康但今天沒到期」講同一句話。
 *
 * 現況(實測):
 *
 *     $ npx tsx scripts/due.ts --state <內容是 {} 的檔> --today 2026-09-10
 *     2026-09-10 沒有到期的卡片        >>> exit=0
 *     $ npx tsx scripts/due.ts --state <內容是 [] 的檔> --today 2026-09-10
 *     2026-09-10 沒有到期的卡片        >>> exit=0
 *
 * 一份**空的 reviews.json**(可能是 init 之後還沒讀過書,也可能是原子寫入寫壞了、
 * 或者路徑指到別的檔)跟「你有 40 張卡,今天剛好都不用複習」是同一句話、同一個
 * 退出碼。第一種是「你的複習資料不見了」,第二種是「今天放假」——使用者需要分得出來。
 *
 * 缺檔與壞檔更糟,直接噴 node 的 stack trace:
 *
 *     Error: ENOENT: no such file or directory, open '.../nope.json'
 *         at readFileSync (node:fs:442:20)
 *         ...
 *
 * 要的形狀,跟 boundaries 的「掃描 195 個檔案」同一套:
 *
 *   1. **印出讀到幾張卡**——「沒有到期」後面要接得出分母。
 *   2. **三種 0 兩兩不同**:空表 / 缺檔 / 壞檔,三句話不可以有兩句一樣。
 *   3. **退出碼分得開**:0 = 讀到 N ≥ 1 張卡並且算完了(今天到期幾張都算成功);
 *      1 = 沒算成(檔案不存在、不是合法 JSON、不是 Review 表、或空表)。
 *      1 這個碼是照 lint / weekly 這一批的共同約定選的,不是 due.ts 自創。
 *   4. **不噴 stack trace**,一句人話。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SPAWN_TIMEOUT_MS = 60_000;
const TODAY = '2026-09-10';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-due-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** 寫一個 state 檔,內容原樣寫入(所以壞 JSON 也塞得進去),回傳路徑。 */
function stateFile(raw: string): string {
  const path = join(tmpDir(), 'reviews.json');
  writeFileSync(path, raw, 'utf8');
  return path;
}

function runDue(statePath: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', 'scripts/due.ts', '--state', statePath, '--today', TODAY], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** node 把例外丟到頂層時長這樣。使用者不該看到這個。 */
const STACK_TRACE = /^\s+at .+:\d+:\d+\)?$/m;

/** 「今天沒事」那句話。空表 / 缺檔 / 壞檔都不可以說它。 */
const NOTHING_DUE = /沒有到期的卡片/;

/** 兩張卡,今天(2026-09-10)都還沒到期——next_due 在未來。契約 §4 的 Review 形狀。 */
const HEALTHY_NOT_DUE = JSON.stringify({
  'sec-0001': review('2026-09-20'),
  'sec-0002': review('2026-09-20'),
});

/** 契約 §4 的 Review,只留這幾條測試會動到的欄位。 */
function review(nextDue: string | null, stage = 3): Record<string, unknown> {
  return {
    stage,
    learned_at: '2026-08-01',
    next_due: nextDue,
    fails_in_row: 0,
    total_fails: 0,
    stuck: false,
    history: [],
  };
}

describe('scripts/due.ts:算得成的時候', () => {
  it('讀到 2 張卡、今天都沒到期 → exit 0,而且印得出分母「2 張」', () => {
    const { code, output } = runDue(stateFile(HEALTHY_NOT_DUE));

    expect(code).toBe(0);
    expect(output).toMatch(NOTHING_DUE);
    // 「沒有到期」後面要接得出「(讀到 2 張卡)」之類的分母,不然 0 沒有份量。
    expect(output).toMatch(/2\s*張/);
  }, SPAWN_TIMEOUT_MS);

  it('有卡片到期 → exit 0,照舊列出來(現在就綠,回歸鎖)', () => {
    const state = stateFile(
      JSON.stringify({ 'sec-0001': review('2026-09-01') }),
    );
    const { code, output } = runDue(state);

    expect(code).toBe(0);
    expect(output).toContain('sec-0001');
  }, SPAWN_TIMEOUT_MS);
});

describe('scripts/due.ts:三種 0', () => {
  it('空的 {} → exit 1,而且不可以說「沒有到期的卡片」', () => {
    const { code, output } = runDue(stateFile('{}'));

    expect(code).toBe(1);
    expect(output).not.toMatch(NOTHING_DUE);
    // 要說清楚是「一張卡都沒有」,不是「今天沒事」。
    expect(output).toMatch(/0\s*張|一張.*都沒有|沒有任何/);
  }, SPAWN_TIMEOUT_MS);

  it('檔案不存在 → exit 1,一句人話,不噴 stack trace', () => {
    const missing = join(tmpDir(), 'nope.json');
    const { code, output } = runDue(missing);

    expect(code).toBe(1);
    expect(output).not.toMatch(STACK_TRACE);
    expect(output).not.toMatch(NOTHING_DUE);
    expect(output).toContain(missing);
  }, SPAWN_TIMEOUT_MS);

  it('不是合法 JSON → exit 1,一句人話,不噴 stack trace', () => {
    const { code, output } = runDue(stateFile('NOT JSON {{{\n'));

    expect(code).toBe(1);
    expect(output).not.toMatch(STACK_TRACE);
    expect(output).not.toMatch(NOTHING_DUE);
  }, SPAWN_TIMEOUT_MS);

  it('三種 0 的輸出兩兩不同', () => {
    const outputs = [
      runDue(stateFile('{}')).output,
      runDue(join(tmpDir(), 'nope.json')).output,
      runDue(stateFile('NOT JSON {{{\n')).output,
    ];
    expect(new Set(outputs).size, `三種 0 有兩種長一樣:\n${outputs.join('\n---\n')}`).toBe(3);
  }, SPAWN_TIMEOUT_MS);
});

describe('scripts/due.ts:合法 JSON 但不是 Review 表', () => {
  // 這一組全部走過 JSON.parse 但型別不對。現況是 `as Record<CardId, Review>` 直接
  // 相信,結果不是憑空捏造出「沒有到期」就是在 buildDueList 深處噴 stack。
  const cases: [string, string][] = [
    ['[] 是陣列不是物件', '[]'],
    ['null', 'null'],
    ['字串', '"hi"'],
    ['數字', '42'],
    ['物件的值不是 Review', '{"sec-0001": "yesterday"}'],
  ];

  for (const [name, raw] of cases) {
    it(`${name} → exit 1,不噴 stack,也不說「沒有到期的卡片」`, () => {
      const { code, output } = runDue(stateFile(raw));

      expect(code).toBe(1);
      expect(output).not.toMatch(STACK_TRACE);
      expect(output).not.toMatch(NOTHING_DUE);
    }, SPAWN_TIMEOUT_MS);
  }
});

describe('scripts/due.ts:用法', () => {
  it('沒給 --state 仍是 exit 1 並印用法(現在就綠,回歸鎖)', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/due.ts', '--today', TODAY], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout ?? ''}${r.stderr ?? ''}`).toContain('用法');
  }, SPAWN_TIMEOUT_MS);
});
