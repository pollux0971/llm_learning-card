/**
 * 單獨執行檢查(ADR-022)。跑 standalone.json 裡每個非互動指令,
 * 要求退出碼 0 且輸出含 expect 關鍵字。
 *
 * 用法:
 *   npx tsx scripts/check-standalone.ts                 # 全部非互動
 *   npx tsx scripts/check-standalone.ts --only 04-scheduler
 *   npx tsx scripts/check-standalone.ts --list          # 只列出,不執行
 *   npx tsx scripts/check-standalone.ts --timeout 60000 # 每個指令的毫秒上限(預設 120000)
 *   npx tsx scripts/check-standalone.ts --manifest <path> # 改讀別的 manifest(測試用 fixture)
 *
 * 退出碼:0 全部通過;1 任一失敗,或 manifest **一個條目都沒讀到**。
 * 互動式(dev server)一律跳過,由 /phase-done 人工確認。
 *
 * 最後那條是 P-28 加的:讀到 0 個條目時「全部通過」的 0 是騙人的——
 * 沒有東西通過,是根本沒讀到東西。0 個條目一律當 FAIL。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** 三支掃描器共用的那句話。0 個東西的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

type Manifest = Record<
  string,
  { cmd: string; interactive: boolean; expect?: string; expectExit?: number }
>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const only = arg('--only');
const timeout = Number(arg('--timeout') ?? 120_000);
const listOnly = process.argv.includes('--list');

const manifestPath = arg('--manifest') ?? join(ROOT, 'standalone.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const all = Object.entries(manifest);

console.log(`standalone: 從 ${manifestPath} 讀到 ${all.length} 個條目`);

// 0 個條目跟「全部通過」的退出碼一樣是 0,所以先擋在這裡。這條要在 --only 的過濾之前,
// 「manifest 是空的」跟「--only 指到不存在的名字」是兩種完全不同的紅。
if (all.length === 0) {
  console.error(`\n✗ 讀到 0 個條目`);
  console.error(`${SCANNER_BROKEN}。manifest 路徑指錯、檔案被清空、或格式改掉時就長這樣。`);
  process.exit(1);
}

const entries = all.filter(([name]) => !only || name === only);
if (!entries.length) {
  console.error(`${manifestPath} 裡沒有 ${only}`);
  process.exit(1);
}

let failed = 0;
for (const [name, entry] of entries) {
  if (entry.interactive) {
    console.log(`⏭  ${name}  (interactive,跳過)  ${entry.cmd}`);
    continue;
  }
  if (listOnly) {
    console.log(`•  ${name}  ${entry.cmd}  expect=${entry.expect ?? '(none)'}`);
    continue;
  }
  // 02 的指令會寫 ./tmp-learning;每次先清掉,確保是乾淨的一次執行
  const tmp = join(ROOT, 'tmp-learning');
  if (entry.cmd.includes('./tmp-learning') && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });

  const t0 = Date.now();
  const r = spawnSync(entry.cmd, { cwd: ROOT, shell: true, encoding: 'utf8', timeout, env: process.env });
  const ms = Date.now() - t0;
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const timedOut = r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const wantExit = entry.expectExit ?? 0;
  const exitOk = r.status === wantExit && !timedOut;
  const expectOk = !entry.expect || output.includes(entry.expect);

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
process.exit(failed ? 1 : 0);
