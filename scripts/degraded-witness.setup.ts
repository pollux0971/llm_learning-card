/**
 * vitest 的 setupFile(ADR-044):每個測試結束時,把它觸發過的退化訊號記成一行 JSONL。
 *
 * **只在設了 `DEGRADED_WITNESS_DIR` 的時候做事。** 沒設(平常的 `npx vitest run`、
 * Stryker 的 vitest.mutate.config.ts 也根本沒掛這支 setup)就一個 hook 都不註冊,
 * 對既有測試零影響——這支檔案唯一的工作是觀測,不判斷、不改任何測試的結果。
 *
 * 輸出:`<DEGRADED_WITNESS_DIR>/<pid>.jsonl`,一個 worker 一個檔,不用搶同一個檔的
 * append。每一行:
 *   { "file": "packages/core/src/llm/router-gateway.test.ts",
 *     "test": "GatewayLlmRouter > 備援 > 雲端 5xx 改走閘道",
 *     "signals": { "llm.fallback.cloud-failed": 1, ... } }
 * **每一個跑了的測試都寫一行**,沒觸發的 signals 是 `{}`——彙總要的是「N / M 個測試」,
 * 分母也得從這裡來。每一列帶 `status`:
 * - `ran`:測試本體跑完了(passed / failed 都算),就是 vitest 算進 `numPassedTests + numFailedTests` 的那些。
 * - `skipped`:測試本體裡的 `ctx.skip()`。vitest 4 **照樣跑 afterEach**,但它在 vitest 眼裡是 pending
 *   (2026-09-05 實測全套 138 筆,全是 zero-input-guard 缺 `.env` 的 runtime skip)。**照樣寫一列、標 skipped**,
 *   不進分母;`degraded-report.ts` 的 ran_all(ADR-047)拿它跟 vitest 的 `numPendingTests` 對——那是第二個等式,
 *   抓的是「環境缺東西 → 整批被跳過 → 數字看起來很乾淨」。
 * - 靜態 skip(`it.skip` / `it.skipIf(true)` / `describe.skip` 底下的、`-t` 篩掉的、beforeAll 掛掉被連坐的)
 *   沒有 afterEach,但 vitest **一樣算 pending**。所以在檔案的 `afterAll(suite)` 走一遍 `suite.tasks`,
 *   凡是 `type === 'test' && mode === 'skip'` 而 afterEach 沒寫過的,補一列 `skipped`、`signals: {}`——
 *   等式 (2) 的左邊才會跟 vitest 的 `numPendingTests` 同一個定義(它就是數 `mode === 'skip' || result.state === 'skip'`)。
 *   runtime `ctx.skip()` 的測試跑完之後 vitest 也會把 `mode` 改成 skip,所以要靠「afterEach 寫過的 id」去重,
 *   不然那一列會寫兩次。
 * - `it.todo` 是 `mode === 'todo'`,vitest 算 `numTodoTests` 不算 pending,不寫列。
 * - **做不到的一種**:整份檔案的測試全是靜態 skip(例如整檔 `describe.skip`)時,vitest 把 File 本身標成 skip,
 *   **afterAll 不跑**,那些 pending 就沒有列——等式 (2) 會紅,reason 會指名是這種情況(見 degraded-report.ts)。
 *   現況 repo 沒有這種檔;真的需要整檔 skip 就會紅在那裡,不會靜默。
 *
 * 歸屬規則:
 * - 測試本體(含它的 beforeEach / afterEach)裡觸發的,記在那個測試名下;runtime skip 的測試在 skip **之前**
 *   觸發的也記在它名下(那一列標 skipped)。**不沖到 outside**:outside 抓的是「測試之外觸發的」(接線問題),
 *   skip 是「測試裡但沒跑完」(環境 / 前置條件),兩種來源的錯法不同,混在一桶就分不出來,而且 138 筆會把
 *   outside 的基準撐大,以後真的漏了幾條 outside 看不到。
 * - 在 beforeAll / 檔案頂層觸發的,沒有測試可以歸,記成 `test: "(outside any test)"`
 *   那一行,在下一個測試開始前沖出去——**不丟掉**,丟掉就是這支工具自己在退化。
 * - 最後一個測試之後才觸發的(afterAll),在 worker 結束時沖出去,同樣記成 outside。
 *
 * 彙總:`npx tsx scripts/degraded-report.ts`(見那支檔案的檔頭)。
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeEach } from 'vitest';
import type { RunnerTestCase as Test, RunnerTestSuite as Suite } from 'vitest';
import {
  OUTSIDE_ANY_TEST,
  createDegradedTally,
  installDegradedCollector,
  type WitnessRecord,
  type WitnessStatus,
} from '../packages/contracts/src/witness.js';

/** 「describe > describe > it」的完整名字,跟 vitest 報表上看到的一樣。 */
export function fullTestName(task: Readonly<Test>): string {
  const names: string[] = [task.name];
  let suite: Suite | undefined = task.suite;
  while (suite !== undefined) {
    // 最上層那個 Suite 是 File 本身,name 是檔案路徑,不是 describe 的名字。
    if (!('filepath' in suite) && suite.name !== '') names.unshift(suite.name);
    suite = suite.suite;
  }
  return names.join(' > ');
}

const outDir = process.env.DEGRADED_WITNESS_DIR;

if (outDir !== undefined && outDir !== '') {
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${process.pid}.jsonl`);
  const tally = createDegradedTally();
  installDegradedCollector(tally);
  const root = process.cwd();

  // 同一個 worker 會連續跑好幾個測試檔;「上一個檔案的 afterAll」與「下一個檔案的
  // beforeAll」中間沒有 hook 可以攔,所以 outside 的歸屬只到檔案層級。
  let currentFile = '';

  const write = (record: WitnessRecord): void => {
    appendFileSync(outFile, `${JSON.stringify(record)}\n`, 'utf8');
  };

  const flushOutside = (): void => {
    if (tally.isEmpty()) return;
    write({ file: currentFile, test: OUTSIDE_ANY_TEST, signals: tally.drain() });
  };

  beforeEach((ctx) => {
    currentFile = relative(root, ctx.task.file.filepath);
    flushOutside();
  });

  /** afterEach 寫過的 task id:afterAll 補靜態 skip 的列時拿來去重(runtime skip 跑完 mode 也會變 skip)。 */
  const written = new Set<string>();

  afterEach((ctx) => {
    // runtime `ctx.skip()`:vitest 在跑 afterEach 之前就把 result 標成 skip / pending
    // (@vitest/runner 的 failTask 對 PendingError 的處理)。照樣寫一列,標 skipped;
    // skip 之前觸發過的訊號記在它自己名下,不沖到 outside(見檔頭的歸屬規則)。
    const result = ctx.task.result as (typeof ctx.task.result & { pending?: boolean }) | undefined;
    const status: WitnessStatus = result?.pending === true || result?.state === 'skip' ? 'skipped' : 'ran';
    written.add(ctx.task.id);
    write({ file: relative(root, ctx.task.file.filepath), test: fullTestName(ctx.task), signals: tally.drain(), status });
  });

  /** 靜態 skip 的測試(沒跑 afterEach 的 `mode === 'skip'`),一個檔案一次,從 File suite 往下走。 */
  const writeStaticSkips = (suite: Readonly<Suite>): void => {
    for (const t of suite.tasks) {
      if (t.type === 'suite') {
        writeStaticSkips(t);
      } else if (t.type === 'test' && t.mode === 'skip' && !written.has(t.id)) {
        written.add(t.id);
        write({ file: relative(root, t.file.filepath), test: fullTestName(t), signals: {}, status: 'skipped' });
      }
    }
  };

  afterAll(({}, suite) => {
    flushOutside();
    writeStaticSkips(suite);
  });
}
