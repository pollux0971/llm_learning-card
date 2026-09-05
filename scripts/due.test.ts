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
 *   3. **退出碼分得開**:0 = 算完了(讀到 N 張卡,N 可以是 0;今天到期幾張都算成功);
 *      1 = 沒算成(檔案不存在、不是合法 JSON、不是 Review 表)。
 *      1 這個碼是照 lint / weekly 這一批的共同約定選的,不是 due.ts 自創。
 *   4. **不噴 stack trace**,一句人話。
 *
 * ── 空表 `{}` 為什麼是 exit 0(ADR-045 裁定)──
 * `{}` 是合法的 reviews.json:剛 init 完、還沒開始複習就是這樣,跟 review.ts 的邊界 2
 * 同一個判斷。所以是**附條件的 exit 0**:(1) exit 0;(2) 輸出含基數(讀到 0 張卡、
 * 到期 0 張);(3) 空表跟安靜日(N>0、到期 0)各餵一次,兩份輸出**不得相同**。
 * 這個檔案原本要它 exit 1,那是本分支自己的規格,跟 ADR-045 互斥;以 ADR 為準。
 *
 * 只有兩種邊界、沒有第三種:due.ts 只讀 reviews.json,從不看 cards/,分不出「有卡但
 * 沒紀錄」跟「連卡都沒有」——那個區別歸 review.ts(有 `--dir`,印「N 張卡、M 張未排程」)。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

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

/**
 * 把暫存路徑換成固定字樣,剩下的才是「訊息本身」。
 *
 * 三個案例用三個不同的暫存路徑,不去掉路徑的話,只要訊息印了路徑就永遠兩兩不同——
 * 把三句話全部清空仍然綠。「三種 0 兩兩不同」比的是訊息,不是輸出。
 */
function withoutPath(output: string, ...paths: string[]): string {
  let s = output;
  for (const p of paths) s = s.split(p).join('<PATH>').split(dirname(p)).join('<DIR>');
  return s;
}

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

  it('有卡片到期 → exit 0,照舊列出來,標題帶分母,STUCK 只掛在卡住的那張後面', () => {
    const state = stateFile(
      JSON.stringify({
        'sec-0001': { ...review('2026-09-01', 1), stuck: true },
        'sec-0002': review('2026-09-01', 2),
      }),
    );
    const { code, output } = runDue(state);

    expect(code).toBe(0);
    expect(output).toContain('到期 2 張(讀到 2 張卡)');
    // 卡住的那張:行尾是 STUCK。
    expect(output).toMatch(/^ {2}sec-0001 {2}stage=1 {2}types=fill .*overdue_ratio=\d+\.\d{3} {2}STUCK$/m);
    // 沒卡住的那張:overdue_ratio 之後什麼都沒有。
    // stage 2 有兩種題型,types 用逗號接。
    expect(output).toMatch(/^ {2}sec-0002 {2}stage=2 {2}types=fill,apply .*overdue_ratio=\d+\.\d{3}$/m);
  }, SPAWN_TIMEOUT_MS);
});

describe('scripts/due.ts:三種 0', () => {
  it('空的 {} → 附條件的 exit 0(ADR-045):exit 0、印基數、跟安靜日的輸出不同', () => {
    const empty = runDue(stateFile('{}'));
    const quiet = runDue(stateFile(HEALTHY_NOT_DUE));

    // 條件 1:exit 0——{} 是合法的 reviews.json,剛 init 完就長這樣,不是錯誤。
    expect(empty.code).toBe(0);

    // 條件 2:輸出含基數。「掃了 N 張、到期 0 張」兩個數字都要在,不然 0 沒有份量。
    expect(empty.output).toMatch(/0\s*張卡/);
    expect(empty.output).toMatch(/到期\s*0\s*張/);

    // 條件 3:空表跟安靜日(N>0、到期 0)各餵一次,兩份輸出不得相同。
    // 兩邊都 exit 0、都是「今天 0 張到期」,只剩訊息能分——所以比的是訊息本身。
    expect(quiet.code).toBe(0);
    expect(empty.output.trim()).not.toBe('');
    expect(empty.output, `空表跟安靜日長一樣:\n${empty.output}`).not.toBe(quiet.output);

    // 空表那句不可以說「沒有到期的卡片」——那是安靜日的結論句,一出現使用者就會當真。
    expect(empty.output).not.toMatch(NOTHING_DUE);
    // 兩句補充各有用途:一句說這不是「今天沒事」,一句說剛 init 完是正常的、否則去查路徑。
    expect(empty.output).toContain('沒有複習資料可以算');
    expect(empty.output).toContain('init');
  }, SPAWN_TIMEOUT_MS * 2);

  it('檔案不存在 → exit 1,一句人話,不噴 stack trace', () => {
    const missing = join(tmpDir(), 'nope.json');
    const { code, output } = runDue(missing);

    expect(code).toBe(1);
    expect(output).not.toMatch(STACK_TRACE);
    expect(output).not.toMatch(NOTHING_DUE);
    expect(output).toContain(missing);
    expect(output).toContain('讀不到');
    // 作業系統給的原因也要在,不然「讀不到」可能是權限也可能是不存在。
    expect(output).toMatch(/ENOENT|no such file/);
  }, SPAWN_TIMEOUT_MS);

  it('不是合法 JSON → exit 1,一句人話,不噴 stack trace', () => {
    const { code, output } = runDue(stateFile('NOT JSON {{{\n'));

    expect(code).toBe(1);
    expect(output).not.toMatch(STACK_TRACE);
    expect(output).not.toMatch(NOTHING_DUE);
    expect(output).toContain('不是合法的 JSON');
    // JSON.parse 的原因與檔案開頭都要在——使用者才知道是哪個檔、壞在哪。
    expect(output).toMatch(/Unexpected token|is not valid JSON/);
    expect(output).toContain('它開頭長這樣:NOT JSON {{{');
  }, SPAWN_TIMEOUT_MS);

  it('不是合法 JSON 而且很長 → 只印開頭 80 個字元,不把整個檔倒出來', () => {
    const long = `NOT JSON ${'長'.repeat(300)}`;
    const { output } = runDue(stateFile(long));

    expect(output).toContain(long.slice(0, 80));
    expect(output).not.toContain(long);
  }, SPAWN_TIMEOUT_MS);

  it('三種 0 的訊息兩兩不同(路徑正規化之後比,不是比輸出)', () => {
    const emptyPath = stateFile('{}');
    const missingPath = join(tmpDir(), 'nope.json');
    const brokenPath = stateFile('NOT JSON {{{\n');
    const messages = [
      withoutPath(runDue(emptyPath).output, emptyPath),
      withoutPath(runDue(missingPath).output, missingPath),
      withoutPath(runDue(brokenPath).output, brokenPath),
    ];

    // 每一種 0 都要真的有話說;三句去掉路徑之後仍然兩兩不同。
    for (const m of messages) expect(m.trim(), '有一種 0 一句話都沒說').not.toBe('');
    expect(new Set(messages).size, `三種 0 有兩種長一樣:\n${messages.join('\n---\n')}`).toBe(3);
  }, SPAWN_TIMEOUT_MS);
});

describe('scripts/due.ts:合法 JSON 但不是 Review 表', () => {
  // 這一組全部走過 JSON.parse 但型別不對。現況是 `as Record<CardId, Review>` 直接
  // 相信,結果不是憑空捏造出「沒有到期」就是在 buildDueList 深處噴 stack。
  // 第三欄是「第一個對不上的地方」該指到哪:根層用「(根)」,巢狀路徑用 `.` 接。
  const cases: [string, string, string][] = [
    ['[] 是陣列不是物件', '[]', '(根): '],
    ['null', 'null', '(根): '],
    ['字串', '"hi"', '(根): '],
    ['數字', '42', '(根): '],
    ['物件的值不是 Review', '{"sec-0001": "yesterday"}', 'sec-0001: '],
    ['Review 裡面的欄位型別不對', '{"sec-0001": {"stage": "x"}}', 'sec-0001.stage: '],
  ];

  for (const [name, raw, where] of cases) {
    it(`${name} → exit 1,不噴 stack,也不說「沒有到期的卡片」`, () => {
      const { code, output } = runDue(stateFile(raw));

      expect(code).toBe(1);
      expect(output).not.toMatch(STACK_TRACE);
      expect(output).not.toMatch(NOTHING_DUE);
    }, SPAWN_TIMEOUT_MS);

    it(`${name} → 說「不是一份 reviews.json」、印它實際是什麼、指出第一個對不上的地方`, () => {
      const { output } = runDue(stateFile(raw));

      expect(output).toContain('不是一份 reviews.json');
      expect(output).toContain(`它實際是:${raw.slice(0, 80)}`);
      expect(output).toContain(`第一個對不上的地方:${where}`);
    }, SPAWN_TIMEOUT_MS);
  }

  it('不是 Review 表而且很長 → 「它實際是」只印前 80 個字元', () => {
    const long = `{"sec-0001": "${'長'.repeat(300)}"}`;
    const { output } = runDue(stateFile(long));

    expect(output).toContain(long.slice(0, 80));
    expect(output).not.toContain(long);
  }, SPAWN_TIMEOUT_MS);
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
