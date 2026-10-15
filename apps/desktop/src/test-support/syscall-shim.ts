/**
 * 編譯 syscall-shim.c(LD_PRELOAD 用的測試 shim),回傳 .so 的路徑。
 *
 * 跟 build-lc-fs.ts 一樣每個行程都重編一次(cc 編一個小檔不到一秒),不用「檔在就不編」:
 * 那擋不住改了 .c 卻用到舊的 .so。產物放在 src-tauri/target/ 底下(gitignored)。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, 'syscall-shim.c');
const OUT_DIR = join(import.meta.dirname, '../../src-tauri/target/lc-test-shim');
const OUT = join(OUT_DIR, 'libsyscallshim.so');

let built: string | undefined;

export function buildSyscallShim(): string {
  if (built) return built;
  mkdirSync(OUT_DIR, { recursive: true });
  const r = spawnSync('cc', ['-shared', '-fPIC', '-O1', '-Wall', '-o', OUT, SRC, '-ldl'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`cc syscall-shim.c 失敗 status=${r.status ?? 'error'} ${r.error?.message ?? ''}\n${r.stdout}${r.stderr}`);
  }
  built = OUT;
  return OUT;
}
