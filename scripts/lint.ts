/**
 * 09-lint 的 CLI 入口。健檢一個 learning 目錄,列出問題,寫一份報告到
 * <dir>/state/lint-report-<日期>.md,同樣內容也印到終端機。不改 cards / questions
 * / graph / state/reviews.json 等既有檔案——lint 只看不動。
 *
 * 用法:
 *   npx tsx scripts/lint.ts --dir <learning 目錄>
 *
 * 退出碼:0 沒有問題;1 有問題。
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lint, formatReport } from '../packages/core/src/lint/index.js';

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
const result = lint(dir);

const now = new Date();
const dateStr = now.toISOString().slice(0, 10);
const report = formatReport(result, now.toISOString());

const stateDir = join(dir, 'state');
if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
const reportPath = join(stateDir, `lint-report-${dateStr}.md`);
writeFileSync(reportPath, report, 'utf8');

console.log(report);
console.log(`report written to ${reportPath}`);

process.exit(result.problems.length ? 1 : 0);
