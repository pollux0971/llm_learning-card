/**
 * scripts/weekly.ts —— 壞掉的 `--state` 檔不可以被當成「這週剛開始」。
 *
 * ── 一個更正 ──
 * 工單原本寫的是「現況:噴 stack trace 卻 exit 0」。實測之後這句不準:
 *
 *   - 不是合法 JSON  → 已經是 `exit 1` + 一句人話(「讀不到 --state 指定的檔案:…」),
 *     那一條**現在就是對的**,下面有一條回歸測試把它鎖住。
 *   - `null`        → 在 applyEvent 深處噴 stack,exit 1。
 *
 * 真正的洞在別的地方,而且比 stack trace 嚴重得多:
 *
 *     $ npx tsx scripts/weekly.ts --state <內容是 {} 的檔> --event pass-d1 --card sec-0001
 *     { "week": "2026-W37", "learned": 0, "passed_d1": 1, "counted": ["sec-0001"], ... }
 *     >>> exit=0
 *
 * `{}`、`[]`、`"hi"` —— **合法 JSON 但不是 Weekly** —— 會讓 CLI **憑空捏造**一份
 * 看起來完全正常的 Weekly,然後正常結束。使用者看到的是「本週進度 1/undefined」
 * 這種**像是「這週還沒開始」而不是「你的資料壞了」**的東西。
 *
 * 這正是這一整批工單的形狀:**把「壞掉」偽裝成「正常的空狀態」**。而 weekly 這支
 * 又特別糟,因為它偽裝出來的不是 0,是一個**被事件改過、看起來有進度**的假物件。
 *
 * 要的行為:`--state` 讀進來的東西**不是 Weekly 就 exit 1**,訊息要說清楚
 * 「這個檔不是 Weekly」以及**它實際上是什麼**(前 80 個字元),而且不噴 stack。
 *
 * 根因是 `JSON.parse(...) as Weekly` —— 用 cast 假裝驗過了。防線(P-50)是所有讀
 * `state/` 與 `config/` 的入口一律用 schema 驗過再用,不准 `as Weekly`、不准 `?? {}`。
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
  const dir = mkdtempSync(join(tmpdir(), 'lc-weekly-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** 原樣寫入,所以壞 JSON 也塞得進去。 */
function stateFile(raw: string): string {
  const path = join(tmpDir(), 'weekly.json');
  writeFileSync(path, raw, 'utf8');
  return path;
}

function runWeekly(statePath: string): { code: number; output: string } {
  const r = spawnSync(
    'npx',
    ['tsx', 'scripts/weekly.ts', '--state', statePath, '--event', 'pass-d1', '--card', 'sec-0001', '--today', TODAY],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
  );
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** node 把例外丟到頂層時長這樣。使用者不該看到這個。 */
const STACK_TRACE = /^\s+at .+:\d+:\d+\)?$/m;

/** 契約 §9 的 Weekly。健康的那條路徑用它。 */
const HEALTHY = JSON.stringify({
  week: '2026-W37',
  target: 7,
  learned: 5,
  passed_d1: 3,
  counted: ['sec-0001', 'sec-0002', 'sec-0003'],
});

describe('scripts/weekly.ts:健康的 state', () => {
  it('合法的 Weekly → exit 0,吐出套用事件後的 JSON(現在就綠,回歸鎖)', () => {
    const { code, output } = runWeekly(stateFile(HEALTHY));

    expect(code).toBe(0);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.week).toBe('2026-W37');
    expect(parsed).toHaveProperty('target_met');
  }, SPAWN_TIMEOUT_MS);
});

describe('scripts/weekly.ts:合法 JSON 但不是 Weekly —— 不准憑空捏造', () => {
  // 這一組是這張工單真正的洞。現況全部 exit 0 並吐出一份假的 Weekly。
  const cases: [string, string][] = [
    ['{} 空物件', '{}'],
    ['[] 陣列', '[]'],
    ['"hi" 字串', '"hi"'],
    ['42 數字', '42'],
    ['null', 'null'],
    ['有 week 但少了 target / counted', '{"week":"2026-W37","learned":1}'],
    ['欄位型別不對(learned 是字串)', '{"week":"2026-W37","target":7,"learned":"lots","passed_d1":0,"counted":[]}'],
  ];

  for (const [name, raw] of cases) {
    it(`${name} → exit 1`, () => {
      expect(runWeekly(stateFile(raw)).code).toBe(1);
    }, SPAWN_TIMEOUT_MS);

    it(`${name} → 不吐出一份 Weekly(stdout 不可以是可以拿來用的 JSON)`, () => {
      const { output } = runWeekly(stateFile(raw));

      // 捏造出來的那份 JSON 帶著 week / passed_d1 / target_met,看起來完全正常。
      expect(output).not.toContain('"target_met"');
      expect(output).not.toContain('"passed_d1"');
    }, SPAWN_TIMEOUT_MS);

    it(`${name} → 訊息說「不是 Weekly」,並印出它實際是什麼,而且不噴 stack`, () => {
      const { output } = runWeekly(stateFile(raw));

      expect(output).toContain('Weekly');
      // 實際內容要看得到,不然使用者不知道自己開錯了哪個檔。
      expect(output).toContain(raw.slice(0, 80));
      expect(output).not.toMatch(STACK_TRACE);
    }, SPAWN_TIMEOUT_MS);
  }

  it('很長的內容只印前 80 個字元,不把整個檔倒出來', () => {
    const long = `{"week":"2026-W37","note":"${'長'.repeat(300)}"}`;
    const { output } = runWeekly(stateFile(long));

    expect(output).toContain(long.slice(0, 80));
    expect(output).not.toContain(long);
  }, SPAWN_TIMEOUT_MS);
});

describe('scripts/weekly.ts:讀不到檔', () => {
  it('不是合法 JSON → exit 1 + 一句人話(現在就綠,回歸鎖:改上面那條時別弄壞它)', () => {
    const { code, output } = runWeekly(stateFile('NOT JSON {{{\n'));

    expect(code).toBe(1);
    expect(output).toContain('讀不到');
    expect(output).not.toMatch(STACK_TRACE);
  }, SPAWN_TIMEOUT_MS);

  it('檔案不存在 → exit 1 + 一句人話,點得出路徑(現在就綠,回歸鎖)', () => {
    const missing = join(tmpDir(), 'nope.json');
    const { code, output } = runWeekly(missing);

    expect(code).toBe(1);
    expect(output).toContain(missing);
    expect(output).not.toMatch(STACK_TRACE);
  }, SPAWN_TIMEOUT_MS);

  it('「不是 Weekly」與「讀不到檔」的訊息不一樣', () => {
    const notWeekly = runWeekly(stateFile('{}')).output;
    const unreadable = runWeekly(join(tmpDir(), 'nope.json')).output;

    expect(notWeekly).not.toBe(unreadable);
  }, SPAWN_TIMEOUT_MS);
});
