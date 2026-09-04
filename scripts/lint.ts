/**
 * 09-lint 的 CLI 入口。健檢一個 learning 目錄,列出問題,寫一份報告到
 * <dir>/state/lint-report-<日期>.md(原子寫入:tmp → fsync → rename),同樣內容也印到終端機。不改 cards / questions
 * / graph / state/reviews.json 等既有檔案——lint 只看不動。
 *
 * P-28:報告與終端機都要說**掃了幾個東西**,而且掃到 0 張卡一律 exit 1。
 * 沒有這一段的時候,25 張卡的 vault 與一個空目錄印出來的字完全一樣
 * (「0 problems found.」),使用者的卡片消失時看到的是同一盞綠燈。
 *
 * 用法:
 *   npx tsx scripts/lint.ts --dir <learning 目錄>
 *
 * 退出碼:0 沒有問題;1 有問題,或掃到 0 張卡,或 --dir 指到不存在的目錄;
 *         2 沒給 --dir。
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  lint,
  formatReport,
  formatScanSummary,
  formatZeroCards,
  inventory,
  atomicWriteFileSync,
} from '../packages/core/src/lint/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dirArg = arg('--dir');
if (!dirArg) {
  console.error('用法: npx tsx scripts/lint.ts --dir <learning 目錄>');
  process.exit(2);
}

const dir = resolve(dirArg);

// 目錄不存在就在這裡收工,而且**不建目錄**。以前會一路走到 mkdirSync(<dir>/state)
// 再把報告寫進去,結果是:路徑打錯 → 憑空生出一個空 vault → 回報「0 problems
// found.」。那比單純報錯糟得多,因為它把打錯的路徑變成看起來很健康的東西。
if (!existsSync(dir)) {
  console.error(`✗ lint: --dir 指到的目錄不存在:${dir}`);
  console.error('不會幫你建出來——建了就等於把打錯的路徑變成一個空 vault,然後回報「很乾淨」。');
  process.exit(1);
}

const inv = inventory(dir);

// 0 張卡:先印清點摘要(讓使用者看到掃到的其他東西),再印三種 0 各自的診斷。
// 這裡不寫報告檔——掃描器自己都不相信這次的結果,寫一份「0 problems found.」
// 的報告進去只會變成日後的誤導證據。
const zeroCards = formatZeroCards(dir, inv);
if (zeroCards.length) {
  console.error(formatScanSummary(inv));
  for (const line of zeroCards) console.error(line);
  process.exit(1);
}

const result = lint(dir);

const now = new Date();
const dateStr = now.toISOString().slice(0, 10);
const report = formatReport(result, now.toISOString(), inv);

const stateDir = join(dir, 'state');
if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
const reportPath = join(stateDir, `lint-report-${dateStr}.md`);
// state/ 的寫入必須是原子的(契約 §11b、CLAUDE.md 硬規則 5):tmp → fsync → rename
atomicWriteFileSync(reportPath, report);

console.log(report);
console.log(`report written to ${reportPath}`);

process.exit(result.problems.length ? 1 : 0);
