import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * CLAUDE.md 硬規則 5:state/ 的寫入必須是原子的。
 *
 * 做法:先寫到同目錄的暫存檔 → fsync 把資料真正推到磁碟 → rename 覆蓋目標。
 * rename 在同一個檔案系統上是原子操作,所以讀者永遠只會看到「舊的完整檔」
 * 或「新的完整檔」,不會看到寫到一半的內容。暫存檔放同目錄是為了保證
 * 跟目標在同一個檔案系統(跨檔案系統 rename 不是原子的)。
 *
 * phase-1 只在 init 用到;phase-2 起的 reviews.json / weekly.json 更新也走這裡。
 */
export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // 暫存檔清不掉也不影響結果,原始錯誤比較重要
    }
    throw err;
  }
  closeSync(fd);
  renameSync(tmp, path);
}
