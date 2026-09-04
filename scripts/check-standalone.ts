// SOURCE: template v1.3.4 (eb04f73) sha256=9d09e58ac6bbe3bca866bbab7e8033065a8ef3d69861efd887b817419691c1fb — 勿手改;升版用 sync-gates.sh
/**
 * 單獨執行檢查(見 docs/02-decision-map.md ADR-005)。跑 standalone.json 裡每個非互動指令,
 * 要求退出碼符合預期且輸出含 expect 關鍵字。
 *
 * 暫存目錄清理是**設定驅動**的:每個條目可以選填 `"cleanup": ["./tmp-learning", ...]`,
 * 執行前後各清一次(rm -rf,不存在也不報錯)。程式本身不寫死任何目錄名——
 * 舊版硬編一個 `tmp-learning` / `tmp-output`,換了專案的暫存目錄名字就失效,
 * 而且會不小心清到剛好同名但無關的資料夾。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-standalone.ts                 # 複製進 repo 後執行,全部非互動
 *   npx tsx <template>/scripts/check-standalone.ts      # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-standalone.ts --only <key>
 *   npx tsx scripts/check-standalone.ts --list          # 只列出,不執行
 *   npx tsx scripts/check-standalone.ts --timeout 60000 # 每個指令的毫秒上限(預設 120000)
 *   npx tsx scripts/check-standalone.ts --manifest <path> # 改讀別的 manifest(測試用 fixture)
 *
 * 退出碼:0 全部通過;1 任一失敗,或 manifest **一個條目都沒讀到**。
 * 互動式(dev server)一律跳過,由 /phase-done 人工確認。
 *
 * 「讀到 0 個條目一律 FAIL」是刻意的:manifest 路徑打錯、檔案被清空、或格式改掉時,
 * 「全部通過」的退出碼 0 是騙人的——沒有東西通過,是根本沒讀到東西。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT as GIT_ROOT } from './_root.js';

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
}

type Manifest = Record<string, ManifestEntry>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT = resolve(arg('--root') ?? GIT_ROOT);
const only = arg('--only');
const timeout = Number(arg('--timeout') ?? 120_000);
const listOnly = process.argv.includes('--list');
const manifestPath = resolve(ROOT, arg('--manifest') ?? join(ROOT, 'standalone.json'));

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const all = Object.entries(manifest);

console.log(`standalone: 從 ${manifestPath} 讀到 ${all.length} 個條目`);

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

let failed = 0;
for (const [name, entry] of entries) {
  if (entry.interactive) {
    console.log(`⏭  ${name}  (interactive,跳過)  ${entry.cmd}`);
    continue;
  }
  if (listOnly) {
    console.log(`•  ${name}  ${entry.cmd}  expect=${entry.expect ?? '(none)'}${entry.cleanup ? `  cleanup=${entry.cleanup.join(',')}` : ''}`);
    continue;
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

  cleanUp(entry); // 執行後也清,不留下溢出到下一次執行、或下一個條目的髒狀態

  if (exitOk && expectOk) {
    console.log(`✓  ${name}  (${ms} ms)`);
  } else {
    failed++;
    const why = timedOut
      ? `逾時 ${timeout} ms`
      : !exitOk
        ? `退出碼 ${r.status ?? r.signal},預期 ${wantExit}`
        : `輸出不含 "${entry.expect}"`;
    console.log(`✗  ${name}  ${why}\n   $ ${entry.cmd}`);
    const tail = output.trim().split('\n').slice(-20).join('\n   | ');
    if (tail) console.log(`   | ${tail}`);
  }
}

if (!listOnly) console.log(failed ? `\n${failed} 個失敗` : '\n全部通過');
console.log(`gate=${GATE_NAME} result=${failed ? 'FAIL' : 'PASS'} scanned=${entries.length}`);
process.exit(failed ? 1 : 0);
