// SOURCE: template v1.4.2 (1c1d403) sha256=485eac66d0cfa5bdfb962502fd4f8214f946b936bcdd1f08436804de434dc15b — 勿手改;升版用 sync-gates.sh
/**
 * 單獨執行檢查(見 docs/02-decision-map.md ADR-005)。跑 standalone.json 裡每個非互動指令,
 * 要求退出碼符合預期且輸出含 expect 關鍵字。
 *
 * 暫存目錄清理是**設定驅動**的:每個條目可以選填 `"cleanup": ["./tmp-learning", ...]`,
 * 執行前後各清一次(rm -rf,不存在也不報錯)。程式本身不寫死任何目錄名——
 * 舊版硬編一個 `tmp-learning` / `tmp-output`,換了專案的暫存目錄名字就失效,
 * 而且會不小心清到剛好同名但無關的資料夾。
 *
 * **metadata 欄位(`_doc` 慣例)**:manifest 最上層可以放底線開頭的鍵當說明用的
 * metadata(例如 `"_doc": "這份 manifest 給 /phase-done 用,見 FEATURE.md"`),
 * 值可以是任何型別、不必是條目物件——這種鍵一律跳過,不計入 scanned、不嘗試執行。
 * 舊版沒有這個豁免,把 `_doc` 的字串值當條目物件處理,`entry.cmd` 是 `undefined`,
 * 執行到 `spawnSync(entry.cmd, ...)` 直接丟 `ERR_INVALID_ARG_TYPE` 炸掉,是消費者
 * 回報的真實事故(AI_KM,commit d3e0b80)。**不是底線開頭、但值不是物件**的鍵,
 * 不當成 metadata 放過——那通常是打錯字或格式壞掉,印 `✗ <key> 不是條目物件` 並 FAIL,
 * 不要在這裡靜默跳過、把「格式壞了」偽裝成「全部通過」。
 *
 * **`pending` 語意**(來源 nightmare-assault):條目可以選填
 * `"pending": "<NN-folder>/phase-N"`,代表「這個指令現在预期會紅,原因是還在等
 * 那個 phase」。解析 `features/<NN-folder>/FEATURE.md` 的 Phase 表,找 `phase-N`
 * 那一列的狀態:
 *   - 狀態是 `done` → pending 已經過期,這個條目**必須**通過,沒通過照樣 FAIL
 *     (訊息會明講「pending 已過期」,不是普通的失敗訊息——過期的 pending 比一般失敗
 *     更值得注意,代表「照理說已經解除的等待,實際上還沒解除」)。
 *   - 狀態不是 `done` → 照樣執行,但**不會**讓 gate 變紅,只是回報實際的退出碼
 *     (`○ ... pending(等 .../phase-N)實際 exit=N`),方便觀察但不擋 merge。
 *   - `features/<NN-folder>/FEATURE.md` 不存在,或裡面找不到 `phase-N` 那一列
 *     → 這是設定本身的問題(參照打錯字),FAIL,不當成「還沒 done」放過。
 * pending 條目一樣計入 `scanned=N`。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-standalone.ts                 # 複製進 repo 後執行,全部非互動
 *   npx tsx <template>/scripts/check-standalone.ts      # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-standalone.ts --only <key>
 *   npx tsx scripts/check-standalone.ts --list          # 只列出,不執行
 *   npx tsx scripts/check-standalone.ts --timeout 60000 # 每個指令的毫秒上限(預設 120000)
 *   npx tsx scripts/check-standalone.ts --manifest <path> # 改讀別的 manifest(測試用 fixture)
 *
 * 退出碼:0 全部通過;1 任一失敗(含過期的 pending、無效的 pending 參照、格式壞掉的條目),
 * 或 manifest **一個真正的條目都沒讀到**(metadata 鍵不算條目)。
 * 互動式(dev server)一律跳過,由 /phase-done 人工確認。
 *
 * 「讀到 0 個條目一律 FAIL」是刻意的:manifest 路徑打錯、檔案被清空、或格式改掉時,
 * 「全部通過」的退出碼 0 是騙人的——沒有東西通過,是根本沒讀到東西。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT as GIT_ROOT, readConfigJson } from './_root.js';

/** 三支掃描器共用的那句話。0 個東西的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'standalone';

interface ManifestEntry {
  cmd: string;
  interactive: boolean;
  expect?: string;
  expectExit?: number;
  /** 執行前後各清一次的相對路徑(相對 ROOT)。不填就不清理任何東西。 */
  cleanup?: string[];
  /** 見檔頭「pending 語意」:格式 `<NN-folder>/phase-N`。 */
  pending?: string;
}

type Manifest = Record<string, unknown>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT = resolve(arg('--root') ?? GIT_ROOT);
const only = arg('--only');
const timeout = Number(arg('--timeout') ?? 120_000);
const listOnly = process.argv.includes('--list');
const manifestPath = resolve(ROOT, arg('--manifest') ?? join(ROOT, 'standalone.json'));

// 讀不到檔案、或讀到了但不是合法 JSON,都在這裡大聲失敗(S9):印
// `✗ 設定檔壞掉:<path>: <message>` + gate 標記 + exit 1,不是未捕捉的堆疊。
const manifest = readConfigJson(manifestPath, GATE_NAME) as Manifest;
const rawEntries = Object.entries(manifest);

// _doc 慣例:底線開頭的鍵是 metadata,不當條目看,連驗證形狀都不做。
const metaEntries = rawEntries.filter(([name]) => name.startsWith('_'));
const candidateEntries = rawEntries.filter(([name]) => !name.startsWith('_'));

// 非底線開頭、但值不是物件的鍵:格式壞掉,直接 FAIL,不要放過。
const malformed = candidateEntries.filter(
  ([, value]) => typeof value !== 'object' || value === null || Array.isArray(value),
);
if (malformed.length) {
  for (const [name] of malformed) console.error(`✗ ${name} 不是條目物件`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

const all = candidateEntries as [string, ManifestEntry][];

console.log(
  `standalone: 從 ${manifestPath} 讀到 ${all.length} 個條目` +
    (metaEntries.length ? `(略過 ${metaEntries.length} 個 metadata 欄位:${metaEntries.map(([k]) => k).join(', ')})` : ''),
);

// 0 個條目跟「全部通過」的退出碼一樣是 0,所以先擋在這裡。這條要在 --only 的過濾之前,
// 「manifest 是空的」跟「--only 指到不存在的名字」是兩種完全不同的紅。
if (all.length === 0) {
  console.error(`\n✗ 讀到 0 個條目`);
  console.error(`${SCANNER_BROKEN}。manifest 路徑指錯、檔案被清空、或格式改掉時就長這樣。`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

const entries = all.filter(([name]) => !only || name === only);
if (!entries.length) {
  console.error(`${manifestPath} 裡沒有 ${only}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

function cleanUp(entry: ManifestEntry): void {
  for (const rel of entry.cleanup ?? []) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
  }
}

/** 已知的 phase 狀態值,見 FEATURE.md 的 Phase 表(唯一狀態來源)。 */
const PHASE_STATUSES = ['done', 'in-progress', 'ready', 'blocked', 'todo'] as const;

interface PendingResolution {
  status?: (typeof PHASE_STATUSES)[number];
  error?: string;
}

/**
 * 解析 `pending: "<NN-folder>/phase-N"` 參照,讀 `features/<NN-folder>/FEATURE.md`
 * 的 Phase 表找那一列的狀態。找不到檔案或找不到那一列都算「參照無效」,回傳 error,
 * 呼叫端要把這個條目判 FAIL,不能當成「還沒 done」靜默放過。
 */
function resolvePendingStatus(root: string, ref: string): PendingResolution {
  const m = /^(.+)\/phase-(\d+)$/.exec(ref);
  if (!m) return { error: `pending 格式應為 "<NN-folder>/phase-N",實際 "${ref}"` };
  const [, folder, phaseNum] = m;
  const featurePath = join(root, 'features', folder!, 'FEATURE.md');
  if (!existsSync(featurePath)) return { error: `找不到 ${featurePath}` };
  const content = readFileSync(featurePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // Phase 表格式:| Phase | 標題 | 階段 | 狀態 | 完成日 |,cells[0] 是空字串(開頭的 |)。
    if (cells[1] !== phaseNum) continue;
    const statusCell = cells[4] ?? '';
    const status = PHASE_STATUSES.find((s) => statusCell.startsWith(s));
    if (status) return { status };
    return { error: `${featurePath} 的 phase-${phaseNum} 那一列狀態格式看不懂:"${statusCell}"` };
  }
  return { error: `${featurePath} 沒有 phase-${phaseNum} 的表格列` };
}

let failed = 0;
for (const [name, entry] of entries) {
  if (entry.interactive) {
    console.log(`⏭  ${name}  (interactive,跳過)  ${entry.cmd}`);
    continue;
  }
  if (listOnly) {
    console.log(
      `•  ${name}  ${entry.cmd}  expect=${entry.expect ?? '(none)'}` +
        `${entry.cleanup ? `  cleanup=${entry.cleanup.join(',')}` : ''}` +
        `${entry.pending ? `  pending=${entry.pending}` : ''}`,
    );
    continue;
  }

  let pendingStatus: (typeof PHASE_STATUSES)[number] | undefined;
  if (entry.pending) {
    const resolved = resolvePendingStatus(ROOT, entry.pending);
    if (resolved.error) {
      failed++;
      console.log(`✗  ${name}  pending 參照無效(${entry.pending}):${resolved.error}`);
      continue;
    }
    pendingStatus = resolved.status;
  }

  cleanUp(entry); // 執行前先清,確保是乾淨的一次執行

  const t0 = Date.now();
  const r = spawnSync(entry.cmd, { cwd: ROOT, shell: true, encoding: 'utf8', timeout, env: process.env });
  const ms = Date.now() - t0;
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const timedOut = r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const wantExit = entry.expectExit ?? 0;
  const exitOk = r.status === wantExit && !timedOut;
  const expectOk = !entry.expect || output.includes(entry.expect);
  const passed = exitOk && expectOk;

  cleanUp(entry); // 執行後也清,不留下溢出到下一次執行、或下一個條目的髒狀態

  const why = timedOut
    ? `逾時 ${timeout} ms`
    : !exitOk
      ? `退出碼 ${r.status ?? r.signal},預期 ${wantExit}`
      : `輸出不含 "${entry.expect}"`;
  const tail = output.trim().split('\n').slice(-20).join('\n   | ');

  if (entry.pending && pendingStatus !== 'done') {
    // 還在等的 pending:回報實際結果,但不算進 failed——這是設計上允許的「預期紅」。
    console.log(`○  ${name}  pending(等 ${entry.pending})實際 exit=${r.status ?? r.signal ?? 'unknown'}(${ms} ms)`);
    continue;
  }

  if (passed) {
    console.log(entry.pending ? `✓  ${name}  (${ms} ms)  [pending ${entry.pending} 已 done,視為一般項目]` : `✓  ${name}  (${ms} ms)`);
  } else {
    failed++;
    if (entry.pending) {
      console.log(`✗  ${name}  pending 已過期(${entry.pending} 已 done)仍然紅:${why}\n   $ ${entry.cmd}`);
    } else {
      console.log(`✗  ${name}  ${why}\n   $ ${entry.cmd}`);
    }
    if (tail) console.log(`   | ${tail}`);
  }
}

if (!listOnly) console.log(failed ? `\n${failed} 個失敗` : '\n全部通過');
console.log(`gate=${GATE_NAME} result=${failed ? 'FAIL' : 'PASS'} scanned=${entries.length}`);
process.exit(failed ? 1 : 0);
