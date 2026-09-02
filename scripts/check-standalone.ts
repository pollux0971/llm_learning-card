/**
 * 單獨執行檢查(ADR-022)。跑 standalone.json 裡每個非互動指令,
 * 要求退出碼 0 且輸出含 expect 關鍵字。
 *
 * 用法:
 *   npx tsx scripts/check-standalone.ts                 # 全部非互動
 *   npx tsx scripts/check-standalone.ts --only 04-scheduler
 *   npx tsx scripts/check-standalone.ts --list          # 只列出,不執行
 *   npx tsx scripts/check-standalone.ts --timeout 60000 # 每個指令的毫秒上限(預設 120000)
 *
 * 退出碼:0 全部通過;1 任一失敗。互動式(dev server)一律跳過,由 /phase-done 人工確認。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

type Manifest = Record<string, { cmd: string; interactive: boolean; expect?: string }>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const only = arg('--only');
const timeout = Number(arg('--timeout') ?? 120_000);
const listOnly = process.argv.includes('--list');

const manifest = JSON.parse(readFileSync(join(ROOT, 'standalone.json'), 'utf8')) as Manifest;
const entries = Object.entries(manifest).filter(([name]) => !only || name === only);
if (!entries.length) {
  console.error(`standalone.json 裡沒有 ${only}`);
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
  const exitOk = r.status === 0 && !timedOut;
  const expectOk = !entry.expect || output.includes(entry.expect);

  if (exitOk && expectOk) {
    console.log(`✓  ${name}  (${ms} ms)`);
  } else {
    failed++;
    const why = timedOut ? `逾時 ${timeout} ms` : !exitOk ? `退出碼 ${r.status ?? r.signal}` : `輸出不含 "${entry.expect}"`;
    console.log(`✗  ${name}  ${why}\n   $ ${entry.cmd}`);
    const tail = output.trim().split('\n').slice(-20).join('\n   | ');
    if (tail) console.log(`   | ${tail}`);
  }
}

if (!listOnly) console.log(failed ? `\n${failed} 個失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
