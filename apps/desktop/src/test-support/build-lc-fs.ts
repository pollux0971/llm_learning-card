import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** 冷編譯實測約 55 秒;呼叫端的 hook timeout 要比這個大。 */
export const BUILD_LC_FS_TIMEOUT_MS = 180_000;

const SRC_TAURI = join(import.meta.dirname, '../../src-tauri');

/**
 * 每次都重編 lc-fs(`cargo build --bin lc-fs`),所有會走到 lc-fs 的測試共用這一個入口
 * (vitest 的 beforeAll 與 cucumber 的 BeforeAll)。
 *
 * 刻意不用「缺檔才編」或「缺檔就紅」:兩者都擋不住「檔在,但是上一輪的舊二進位」。
 * 編譯失敗就印出 cargo 的完整輸出並丟錯,讓測試紅。
 * 多個測試檔同時呼叫沒關係:cargo 對 target/ 有檔案鎖,後到的會等,而且增量編譯很快。
 *
 * 回傳 cargo 輸出裡 Finished / Compiling 那幾行,給呼叫端記錄。
 */
export function buildLcFs(): string {
  const r = spawnSync('cargo', ['build', '--bin', 'lc-fs'], {
    cwd: SRC_TAURI,
    encoding: 'utf8',
    timeout: BUILD_LC_FS_TIMEOUT_MS,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error || r.status !== 0) {
    console.error(output);
    throw new Error(`cargo build --bin lc-fs 失敗 status=${r.status ?? 'error'}${r.error ? ` error=${r.error.message}` : ''}\n${output}`);
  }
  return output
    .split('\n')
    .filter((line) => line.includes('Finished') || line.includes('Compiling learning-cards-desktop'))
    .join(' | ');
}
