import { closeSync, existsSync, fsyncSync, openSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** writeFileAtomic 使用的暫存檔名樣式:`.<name>.<pid>.<ts>.tmp`。 */
function tmpNamePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\.${escaped}\\.\\d+\\.\\d+\\.tmp$`);
}

/**
 * 清掉同目錄下屬於同一個目標檔案、上次寫入中斷留下的暫存檔。
 * 「中斷」指寫到 tmp、還沒 rename 就停了(crash、被殺掉之類)——這種殘留
 * 檔不會自己消失,下次寫入時先掃過去清乾淨(feature phase-2「stray temporary
 * file is cleaned up on the next write」)。
 */
function cleanupStrayTmp(path: string): void {
  const dir = dirname(path);
  const name = basename(path);
  if (!existsSync(dir)) return;
  const pattern = tmpNamePattern(name);
  for (const entry of readdirSync(dir)) {
    if (pattern.test(entry)) {
      try {
        unlinkSync(join(dir, entry));
      } catch {
        // 別的行程可能同時在清,消失了也無妨
      }
    }
  }
}

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
  cleanupStrayTmp(path);
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

/**
 * log.jsonl 的寫法(契約 §11b 例外):append-only,不用 tmp → rename,
 * 但每次寫入必須是「一次」完整的一行,不能被另一個寫入切開。
 *
 * 做法:用 O_APPEND 開檔,一次 writeSync 把整行(含結尾換行)寫完。POSIX
 * 保證對用 O_APPEND 開啟的檔案,單一 write() 系統呼叫(內容 <= PIPE_BUF,
 * 通常 4096 bytes)是原子的——寫入位置由核心在寫入當下決定,兩個行程
 * 輪流 append 不會交錯。一行遠小於這個上限,所以夠用。
 */
export function appendLineAtomic(path: string, line: string): void {
  const text = line.endsWith('\n') ? line : `${line}\n`;
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
