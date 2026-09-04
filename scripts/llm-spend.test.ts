/**
 * scripts/llm-spend.ts — 三態(0 / 1 / 2)。
 *
 * 守的是這一件事:**「今天沒花錢」跟「我算不出來」不可以長得一樣。**
 *
 * 這支是協調者 autopilot 每輪必跑的預算煞車,也是「花錢超過上限 → 問使用者」的唯一
 * 判斷依據。修之前實測到的洞:
 *
 *     $ npx tsx scripts/llm-spend.ts --today --log /tmp/nope.jsonl
 *     今日 OpenAI 花費 $0.0000(0 次呼叫),上限 $1.00
 *     >>> exit=0
 *
 * log 檔不存在,結論卻是「還有預算」。`learning/state/log.jsonl` 因為任何原因不見了
 * (換機器、路徑打錯、還沒 init),協調者就會每輪看到 `$0.00 / $1.00`、一路授權花錢,
 * **煞車永遠不會響**。
 *
 * ⚠️ 壞行的方向是 **P-22 的反轉,不是回歸**。
 *
 * P-22 修的是「log 有一行壞掉時,只跳過那一行,不要整份放棄」——那是在 *讀事件* 的
 * 情境,整份放棄會漏掉一堆好資料。這裡是 *算錢*:**跳過壞行等於低估花費**,而低估
 * 花費的後果是超支使用者的錢。所以在這支 CLI 裡,**有壞行 = 無法信任總數 = 算不出來
 * (exit 2)**,不是「跳過後照常回答」。
 *
 * 而且**不分哪一天**:`JSON.parse` 失敗的行讀不到 `ts`,沒有辦法證明它不是今天寫的,
 * 所以一律當成不可信。下面「壞行在非今日的位置」那條測試就是在擋一種很自然的實作
 * 寫法——先用 `ts` 濾出今日、再檢查壞行——那樣歷史壞行會被濾掉,而只放今日壞行的
 * 測試看不出差別。
 *
 * fail-closed 的代價是「卡住」。所以 exit 2 的訊息**必須**帶三樣東西:行號、該行前
 * 80 個字元、一句怎麼修。沒有這三樣的 fail-closed 會被下一個人想辦法繞過,那比
 * fail-open 更糟。下面有一條測試專門盯這三樣。
 *
 * 測試分兩層:
 *   - 純函式層(buildSpendReport / formatSpendReport / exitCodeFor):env 用參數傳,
 *     所以「環境變數沒設」測得到,不必真的去動 repo 的 .env。
 *   - CLI 層(spawn 真的跑一次):盯的是協調者實際看到的那一行與退出碼。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  buildSpendReport,
  formatSpendReport,
  exitCodeFor,
  parseSpendArgs,
  DEFAULT_LOG_PATH,
  EXIT_UNDER_CAP,
  EXIT_AT_OR_OVER_CAP,
  EXIT_CANNOT_COMPUTE,
} from './llm-spend.js';
import type { SpendReport } from './llm-spend.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** spawnSync 起一個 `npx tsx` 子行程要一到三秒,機器忙的時候更久。 */
const SPAWN_TIMEOUT_MS = 60_000;

const DAY = '2026-09-04';

/**
 * 一份「設好了」的環境。缺變數的情境由各條測試自己 delete,不要反過來只在需要時補——
 * 那樣會漏掉「這條測試其實是靠某個沒設的變數才過」的情況。
 */
function goodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    LLM_DAILY_CAP_USD: '1',
    LLM_PRICE_IN_PER_M: '2.5',
    LLM_PRICE_OUT_PER_M: '10',
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** 今天的一筆 OpenAI 呼叫。`usd = tokens_in/1e6*inPerM + tokens_out/1e6*outPerM`。 */
function openaiCall(tokensIn: number, tokensOut: number, day = DAY): string {
  return JSON.stringify({
    ts: `${day}T10:00:00.000Z`,
    type: 'llm_call',
    provider: 'openai',
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  });
}

/** 今天的一筆「不是 OpenAI 呼叫」的條目——證明 log 活著,但今天沒花錢。 */
function otherEvent(day = DAY): string {
  return JSON.stringify({ ts: `${day}T09:00:00.000Z`, type: 'review_done', card: 'sec-0001' });
}

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-spend-'));
  tmpDirs.push(dir);
  return dir;
}

/** 寫一份 log.jsonl,回傳路徑。`lines` 原樣寫,所以壞行 / 空行都塞得進去。 */
function writeLog(lines: string[]): string {
  const path = join(tmpDir(), 'log.jsonl');
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return path;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** 跑真的 CLI,回傳退出碼與 stdout+stderr 合起來的輸出。 */
function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): { code: number; output: string; stdout: string; stderr: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...goodEnv() };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync('npx', ['tsx', 'scripts/llm-spend.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    timeout: SPAWN_TIMEOUT_MS,
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return { code: r.status ?? -1, output: `${stdout}${stderr}`, stdout, stderr };
}

/**
 * 把暫存路徑換成固定字樣,剩下的才是「訊息本身」。
 * 兩次跑用兩個不同的暫存路徑,只比 output 的話路徑就足以讓它們永遠不同。
 */
function withoutPath(output: string, ...paths: string[]): string {
  let s = output;
  for (const p of paths) s = s.split(p).join('<PATH>').split(dirname(p)).join('<DIR>');
  return s;
}

/** 「還有預算」長什麼樣。exit 2 的輸出裡一個字都不能出現這些。 */
const BUDGET_SENTENCE = /今日 OpenAI 花費|上限 \$|還有預算|預算已用完/;

// ---------------------------------------------------------------- 純函式:三態

describe('buildSpendReport 的三態', () => {
  it('log 存在、今天有 OpenAI 呼叫、未達上限:computed,而且帶得出 log 路徑與今日條目數', () => {
    // 1000 in * 2.5/1e6 + 2000 out * 10/1e6 = 0.0025 + 0.02 = 0.0225
    const log = writeLog([otherEvent(), openaiCall(1000, 2000)]);
    const report = buildSpendReport(goodEnv(), log, DAY);

    expect(report.kind).toBe('computed');
    if (report.kind !== 'computed') return;
    expect(report.usd).toBeCloseTo(0.0225, 10);
    expect(report.calls).toBe(1);
    // 今日條目 = 今天所有的 log 行,不只 OpenAI 呼叫。
    expect(report.entriesToday).toBe(2);
    expect(report.capUsd).toBe(1);
    expect(report.logPath).toBe(log);
  });

  it('N=0 但 log 存在:仍然是 computed(今天沒呼叫是合法的,不是「算不出來」)', () => {
    const log = writeLog([otherEvent(), otherEvent()]);
    const report = buildSpendReport(goodEnv(), log, DAY);

    expect(report.kind).toBe('computed');
    if (report.kind !== 'computed') return;
    expect(report.usd).toBe(0);
    expect(report.calls).toBe(0);
    // 這個數字就是「0 元不是因為沒有 log」的證據。
    expect(report.entriesToday).toBe(2);
  });

  it('log 存在但完全是空檔:computed,今日條目 0 筆(空 log 也是一種「算得出來」)', () => {
    const report = buildSpendReport(goodEnv(), writeLog([]), DAY);

    expect(report.kind).toBe('computed');
    if (report.kind !== 'computed') return;
    expect(report.calls).toBe(0);
    expect(report.entriesToday).toBe(0);
  });

  it('空行與行尾換行不算壞行(append-only 的檔案本來就長這樣)', () => {
    const path = join(tmpDir(), 'log.jsonl');
    writeFileSync(path, `\n${openaiCall(1000, 0)}\n\n   \n`, 'utf8');

    const report = buildSpendReport(goodEnv(), path, DAY);
    expect(report.kind).toBe('computed');
  });

  it('log 檔不存在:unknown。**這就是這張工單的起點**', () => {
    const missing = join(tmpDir(), 'nope.jsonl');
    const report = buildSpendReport(goodEnv(), missing, DAY);

    expect(report.kind).toBe('unknown');
    if (report.kind !== 'unknown') return;
    // 原因要指得出是哪個檔,不然使用者不知道去哪裡找。
    expect(report.reason).toContain(missing);
  });

  it('log 路徑指到一個目錄(讀得到 stat、讀不出內容):unknown', () => {
    const dir = tmpDir();
    const report = buildSpendReport(goodEnv(), dir, DAY);
    expect(report.kind).toBe('unknown');
  });
});

describe('buildSpendReport:環境變數缺 / 空 / 非數字一律 unknown', () => {
  // router 那邊的 readDailyCapUsd() 缺變數會退回預設值 1,那對 router 是對的
  // (少了上限也還是要能回答問題)。煞車不行:退回預設值等於自己編一個上限。
  const cases: [string, Record<string, string | undefined>][] = [
    ['LLM_DAILY_CAP_USD 沒設', { LLM_DAILY_CAP_USD: undefined }],
    ['LLM_DAILY_CAP_USD 是空字串', { LLM_DAILY_CAP_USD: '' }],
    ['LLM_DAILY_CAP_USD 只有空白', { LLM_DAILY_CAP_USD: '   ' }],
    ['LLM_DAILY_CAP_USD 不是數字', { LLM_DAILY_CAP_USD: 'abc' }],
    ['LLM_PRICE_IN_PER_M 沒設', { LLM_PRICE_IN_PER_M: undefined }],
    ['LLM_PRICE_IN_PER_M 不是數字', { LLM_PRICE_IN_PER_M: 'cheap' }],
    ['LLM_PRICE_OUT_PER_M 沒設', { LLM_PRICE_OUT_PER_M: undefined }],
    ['LLM_PRICE_OUT_PER_M 不是數字', { LLM_PRICE_OUT_PER_M: '' }],
  ];

  for (const [name, overrides] of cases) {
    it(`${name} → unknown,而且原因裡點得出變數名`, () => {
      const log = writeLog([openaiCall(1000, 2000)]);
      const report = buildSpendReport(goodEnv(overrides), log, DAY);

      expect(report.kind).toBe('unknown');
      if (report.kind !== 'unknown') return;
      expect(report.reason).toContain(Object.keys(overrides)[0]!);
    });
  }
});

describe('parseSpendArgs', () => {
  it('沒給參數:log 走預設路徑、不是 --json、day 留白給 main() 填今天', () => {
    const args = parseSpendArgs([]);
    expect(args.logPath).toBe(DEFAULT_LOG_PATH);
    expect(DEFAULT_LOG_PATH).toBe('learning/state/log.jsonl');
    expect(args.json).toBe(false);
    expect(args.day).toBeUndefined();
  });

  it('--day 設了日期、--log 設了路徑、--json 開了 JSON', () => {
    const args = parseSpendArgs(['--day', DAY, '--log', '/tmp/x/log.jsonl', '--json']);
    expect(args.day).toBe(DAY);
    expect(args.logPath).toBe('/tmp/x/log.jsonl');
    expect(args.json).toBe(true);
  });

  it('--today 在 --day 之後:day 被清掉(今天不需要參數)', () => {
    expect(parseSpendArgs(['--day', DAY, '--today']).day).toBeUndefined();
  });

  it('--day 沒接日期、或接到另一個旗標 → 丟「需要一個 YYYY-MM-DD」', () => {
    expect(() => parseSpendArgs(['--day'])).toThrow(/需要一個 YYYY-MM-DD/);
    expect(() => parseSpendArgs(['--day', '--json'])).toThrow(/需要一個 YYYY-MM-DD/);
  });

  const badDays = ['yesterday', '2026-09-04x', 'x2026-09-04', '2026-9-4'];
  for (const bad of badDays) {
    it(`--day ${bad} → 丟「格式應該是 YYYY-MM-DD」,而且把原字串印回來`, () => {
      expect(() => parseSpendArgs(['--day', bad])).toThrow(/格式應該是 YYYY-MM-DD/);
      expect(() => parseSpendArgs(['--day', bad])).toThrow(bad);
    });
  }

  it('--log 沒接路徑、或接到另一個旗標 → 丟「需要一個檔案路徑」', () => {
    expect(() => parseSpendArgs(['--log'])).toThrow(/需要一個檔案路徑/);
    expect(() => parseSpendArgs(['--log', '--json'])).toThrow(/需要一個檔案路徑/);
  });

  it('不認得的參數 → 丟「不認得的參數」並附用法', () => {
    expect(() => parseSpendArgs(['--bogus'])).toThrow(/不認得的參數:"--bogus"/);
    expect(() => parseSpendArgs(['--bogus'])).toThrow(/用法/);
  });
});

describe('buildSpendReport:上限與今日條目的邊界', () => {
  it('LLM_DAILY_CAP_USD = 0 是合法的「不設限」,不是壞值', () => {
    const report = buildSpendReport(goodEnv({ LLM_DAILY_CAP_USD: '0' }), writeLog([openaiCall(1000, 2000)]), DAY);
    expect(report.kind).toBe('computed');
    if (report.kind !== 'computed') return;
    expect(report.capUsd).toBe(0);
  });

  it('LLM_DAILY_CAP_USD 是負數 → unknown,原因點得出變數名', () => {
    const report = buildSpendReport(goodEnv({ LLM_DAILY_CAP_USD: '-1' }), writeLog([openaiCall(1000, 2000)]), DAY);
    expect(report.kind).toBe('unknown');
    if (report.kind !== 'unknown') return;
    expect(report.reason).toContain('LLM_DAILY_CAP_USD');
  });

  it('今日條目只算今天的:別天的條目與沒有 ts 的條目都不算', () => {
    const log = writeLog([
      openaiCall(1000, 2000, '2026-09-03'),
      otherEvent('2026-09-03'),
      JSON.stringify({ type: 'review_done', card: 'sec-0002' }),
      otherEvent(),
      openaiCall(1000, 2000),
    ]);
    const report = buildSpendReport(goodEnv(), log, DAY);
    expect(report.kind).toBe('computed');
    if (report.kind !== 'computed') return;
    expect(report.entriesToday).toBe(2);
    expect(report.calls).toBe(1);
  });
});

describe('buildSpendReport:壞行 = 算不出來(P-22 的反轉)', () => {
  it('今日條目裡有一行 parse 失敗 → unknown,不是「跳過那行照常回答」', () => {
    // 舊行為會跳過壞行、回報 $0.0225(只算得出好的那筆),方向是低估。
    const log = writeLog([openaiCall(1000, 2000), '{"ts":"2026-09-04T11:00:00.000Z","type":"llm_ca']);
    const report = buildSpendReport(goodEnv(), log, DAY);

    expect(report.kind).toBe('unknown');
  });

  it('壞行看起來是「別天」的位置也一樣 unknown —— 不分哪一天', () => {
    // 壞行讀不到 ts,沒有辦法證明它不是今天的。這條擋的是「先用 ts 濾今日、再檢查
    // 壞行」的實作:那樣寫的話歷史壞行會先被濾掉,只放今日壞行的測試看不出來。
    const log = writeLog([
      openaiCall(1000, 2000, '2025-01-01'),
      'THIS LINE IS NOT JSON',
      openaiCall(1000, 2000, '2025-01-02'),
    ]);
    const report = buildSpendReport(goodEnv(), log, DAY);

    expect(report.kind).toBe('unknown');
  });

  it('壞行的原因要帶「行號 / 前 80 字 / 怎麼修」三樣,少一樣 fail-closed 就會被繞過', () => {
    const long = `{"ts":"2026-09-04T11:00:00.000Z","type":"llm_call","provider":"openai","tokens_in":123456789,"note":"這一行故意超過八十個字元,好驗證訊息有截斷"`;
    const log = writeLog([otherEvent(), long]);
    const report = buildSpendReport(goodEnv(), log, DAY);

    expect(report.kind).toBe('unknown');
    if (report.kind !== 'unknown') return;

    // 1. 行號:第 2 行(1-based,跟編輯器一致)
    expect(report.reason).toMatch(/第\s*2\s*行/);
    // 2. 那行的前 80 個字元,原樣出現
    expect(report.reason).toContain(long.slice(0, 80));
    // 但不可以整行倒出來——log 一行可能很長,煞車的訊息要看得完。
    expect(report.reason).not.toContain(long);
    // 3. 一句怎麼修,而且要講明白「不會自動跳過」
    expect(report.reason).toMatch(/重跑|移除|修好/);
    expect(report.reason).toContain('不會自動跳過');
  });
});

describe('buildSpendReport:整份檔都不是 JSONL,也是算不出來', () => {
  // 「其中一行壞」與「每一行都壞」在實作上可能走不同分支,不能假設前者蓋住後者。
  // 而且「壞」不只 JSON.parse 丟例外:`"hello"`、`42`、`[]`、`null` 每一行都是合法 JSON,
  // 但沒有一個是契約 §10 的 log 事件(物件 + ts)。把它們當事件算,結果是「今日條目 0 筆、
  // $0.0000、exit 0」——一個被寫壞的 log 變成「有 log 但沒花」。
  const cases: [string, string][] = [
    ['整份是一個字串 "hello"', '"hello"'],
    ['整份是一個數字 42', '42\n'],
    ['整份是一個陣列 []', '[]\n'],
    ['整份是 null', 'null\n'],
    ['整份是一段 HTML', '<html><body>login</body></html>\n<p>please sign in</p>\n'],
  ];

  for (const [name, content] of cases) {
    it(`${name} → unknown,原因帶行號 / 前 80 字 / 怎麼修`, () => {
      const path = join(tmpDir(), 'log.jsonl');
      writeFileSync(path, content, 'utf8');

      const report = buildSpendReport(goodEnv(), path, DAY);
      expect(report.kind).toBe('unknown');
      if (report.kind !== 'unknown') return;

      const firstLine = content.split('\n')[0]!;
      expect(report.reason).toMatch(/第\s*1\s*行/);
      expect(report.reason).toContain(firstLine.slice(0, 80));
      expect(report.reason).toContain('不會自動跳過');
    });
  }
});

// ---------------------------------------------------------------- 純函式:訊息與退出碼

describe('formatSpendReport / exitCodeFor', () => {
  const computed = (over: Partial<SpendReport & { kind: 'computed' }> = {}): SpendReport => ({
    kind: 'computed',
    usd: 0,
    calls: 0,
    entriesToday: 0,
    capUsd: 1,
    logPath: '/tmp/x/log.jsonl',
    ...over,
  });

  it('computed 的那一行帶得出 log 路徑、今日條目數、呼叫次數、上限', () => {
    const line = formatSpendReport(computed({ usd: 0, calls: 0, entriesToday: 7 }));

    expect(line).toContain('/tmp/x/log.jsonl');
    expect(line).toMatch(/今日條目\s*7\s*筆/);
    expect(line).toMatch(/0\s*次呼叫/);
    expect(line).toContain('$1.00');
    expect(line.startsWith('今日 OpenAI 花費 $0.0000')).toBe(true);
    expect(line).not.toContain('已用完');
  });

  it('cap = 0 印「無上限」,不印 $0.0000(那會看起來像立刻用完)', () => {
    const line = formatSpendReport(computed({ usd: 0.5, capUsd: 0 }));
    expect(line).toContain('無上限');
    expect(line).not.toContain('上限 $');
  });

  it('spent >= cap 那一行結尾說「今日預算已用完」,前半仍然是完整的數字', () => {
    const line = formatSpendReport(computed({ usd: 1, capUsd: 1 }));
    expect(line).toContain('今日預算已用完');
    expect(line).toContain('今日 OpenAI 花費 $1.0000');
  });

  it('unknown 一律 `算不出來:<原因>`,而且一個「還有預算」的字都不能出現', () => {
    const line = formatSpendReport({ kind: 'unknown', reason: 'log 檔不存在:/tmp/nope.jsonl' });

    expect(line.startsWith('算不出來:')).toBe(true);
    expect(line).toContain('/tmp/nope.jsonl');
    expect(line).not.toMatch(BUDGET_SENTENCE);
  });

  it('「有 log 但沒花」與「空 log」與「算不出來」三種輸出兩兩不同', () => {
    const withLog = formatSpendReport(computed({ entriesToday: 7 }));
    const emptyLog = formatSpendReport(computed({ entriesToday: 0 }));
    const cannot = formatSpendReport({ kind: 'unknown', reason: 'log 檔不存在:/tmp/x/log.jsonl' });

    expect(new Set([withLog, emptyLog, cannot]).size).toBe(3);
  });

  it('exitCodeFor:未達上限 0,達上限 1,算不出來 2', () => {
    expect(exitCodeFor(computed({ usd: 0.5, capUsd: 1 }))).toBe(EXIT_UNDER_CAP);
    expect(exitCodeFor(computed({ usd: 1.5, capUsd: 1 }))).toBe(EXIT_AT_OR_OVER_CAP);
    expect(exitCodeFor({ kind: 'unknown', reason: 'whatever' })).toBe(EXIT_CANNOT_COMPUTE);
  });

  it('剛好等於上限算「已達」(ADR-039 定的是 >=,不是 >)', () => {
    expect(exitCodeFor(computed({ usd: 1, capUsd: 1 }))).toBe(EXIT_AT_OR_OVER_CAP);
    // 邊界的另一側:差一分錢仍然是 0。
    expect(exitCodeFor(computed({ usd: 0.99, capUsd: 1 }))).toBe(EXIT_UNDER_CAP);
  });

  it('cap = 0 是「不設限」,不是「立刻用完」', () => {
    expect(exitCodeFor(computed({ usd: 99, capUsd: 0 }))).toBe(EXIT_UNDER_CAP);
  });
});

// ---------------------------------------------------------------- CLI:協調者真的看到的東西

describe('scripts/llm-spend.ts 的 CLI 三態', () => {
  it('log 檔不存在 → exit 2,而且一個「還有預算」的字都沒有', () => {
    const missing = join(tmpDir(), 'nope.jsonl');
    const { code, output } = runCli(['--day', DAY, '--log', missing]);

    expect(code).toBe(2);
    expect(output).toContain('算不出來');
    expect(output).not.toMatch(BUDGET_SENTENCE);
  }, SPAWN_TIMEOUT_MS);

  it('log 有壞行 → exit 2,不是跳過壞行後說 $0.00', () => {
    const log = writeLog([openaiCall(1000, 2000), 'not json at all']);
    const { code, output } = runCli(['--day', DAY, '--log', log]);

    expect(code).toBe(2);
    expect(output).toContain('算不出來');
    expect(output).not.toMatch(BUDGET_SENTENCE);
  }, SPAWN_TIMEOUT_MS);

  it('log 存在、今天 0 次呼叫 → exit 0,而且看得出「有 log、今天沒花」', () => {
    const log = writeLog([otherEvent(), otherEvent()]);
    const { code, output, stdout, stderr } = runCli(['--day', DAY, '--log', log]);

    expect(code).toBe(0);
    expect(output).toContain(log);
    expect(output).toMatch(/今日條目\s*2\s*筆/);
    // 算得出來的那一行走 stdout;stderr 乾淨。協調者接 stdout 就拿得到數字。
    expect(stdout).toContain('今日 OpenAI 花費');
    expect(stderr).toBe('');
  }, SPAWN_TIMEOUT_MS);

  it('算不出來走 stderr,stdout 一個字都沒有——接 stdout 的人不會拿到一句像數字的話', () => {
    const missing = join(tmpDir(), 'nope.jsonl');
    const { code, stdout, stderr } = runCli(['--day', DAY, '--log', missing]);

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('算不出來');
  }, SPAWN_TIMEOUT_MS);

  it('--json 在算得出來時吐 day / usd / calls / entries_today / log / cap_usd', () => {
    const log = writeLog([otherEvent(), openaiCall(1000, 2000)]);
    const { code, output } = runCli(['--day', DAY, '--log', log, '--json']);

    expect(code).toBe(0);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.day).toBe(DAY);
    expect(parsed.usd).toBeCloseTo(0.0225, 10);
    expect(parsed.calls).toBe(1);
    expect(parsed.entries_today).toBe(2);
    expect(parsed.log).toBe(log);
    expect(parsed.cap_usd).toBe(1);
    expect(parsed).not.toHaveProperty('error');
  }, SPAWN_TIMEOUT_MS);

  it('花費剛好等於上限 → exit 1(邊界,ADR-039)', () => {
    // cap = 0.0225,花費也是 0.0225。
    const log = writeLog([openaiCall(1000, 2000)]);
    const { code } = runCli(['--day', DAY, '--log', log], { LLM_DAILY_CAP_USD: '0.0225' });

    expect(code).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it('--json 在算不出來時不吐 usd / cap_usd,只吐 error', () => {
    // 下游拿 .usd 應該拿到 undefined 而不是 0——0 的方向是「還可以花」。
    const missing = join(tmpDir(), 'nope.jsonl');
    const { code, output } = runCli(['--day', DAY, '--log', missing, '--json']);

    expect(code).toBe(2);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.error).toBeTypeOf('string');
    expect(parsed).not.toHaveProperty('usd');
    expect(parsed).not.toHaveProperty('cap_usd');
  }, SPAWN_TIMEOUT_MS);

  it('log 不存在與 log 空檔的訊息不一樣(路徑正規化之後比,不是比輸出)', () => {
    const missingPath = join(tmpDir(), 'nope.jsonl');
    const emptyPath = writeLog([]);
    const missing = runCli(['--day', DAY, '--log', missingPath]);
    const empty = runCli(['--day', DAY, '--log', emptyPath]);

    // 兩次跑用兩個不同的暫存路徑,不去掉路徑的話只要訊息印了路徑就永遠「不一樣」——
    // 把兩句話全部清空仍然綠。比的是訊息本身。
    const missingMsg = withoutPath(missing.output, missingPath);
    const emptyMsg = withoutPath(empty.output, emptyPath);
    expect(missingMsg.trim()).not.toBe('');
    expect(emptyMsg.trim()).not.toBe('');
    expect(missingMsg).not.toBe(emptyMsg);
    expect(missing.code).not.toBe(empty.code);
  }, SPAWN_TIMEOUT_MS);

  it('整份 log 是 "hello"(合法 JSON,但不是 JSONL 事件)→ exit 2,不是「有 log 但沒花」', () => {
    const path = join(tmpDir(), 'log.jsonl');
    writeFileSync(path, '"hello"', 'utf8');
    const { code, output } = runCli(['--day', DAY, '--log', path]);

    expect(code).toBe(2);
    expect(output).toContain('算不出來');
    expect(output).not.toMatch(BUDGET_SENTENCE);
  }, SPAWN_TIMEOUT_MS);

  it('參數壞掉也是 exit 2,而且不印預算', () => {
    const { code, output } = runCli(['--day', 'yesterday']);

    expect(code).toBe(2);
    expect(output).not.toMatch(BUDGET_SENTENCE);
    // 同一句型:算不出來:<原因>,原因要說得出是 --day 的格式。
    expect(output).toContain('算不出來:');
    expect(output).toContain('格式應該是 YYYY-MM-DD');
  }, SPAWN_TIMEOUT_MS);
});

// 這個目錄是使用者好幾個月的記憶資料(CLAUDE.md 硬規則 2 / 5)。上面每一條測試都寫
// 暫存目錄,沒有任何一條碰得到它——留這個常數是為了讓「有沒有人不小心寫進去」
// 看得出來。
const FORBIDDEN = join(REPO_ROOT, 'learning');

it('測試本身不碰 learning/', () => {
  expect(tmpDirs.every((d) => !d.startsWith(FORBIDDEN))).toBe(true);
});
