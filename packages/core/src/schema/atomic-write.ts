import { closeSync, existsSync, fchmodSync, fsyncSync, openSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** 舊樣式暫存檔:`.<name>.<pid>.<ts>.tmp`。新寫入固定用 `<name>.tmp`(§11b)。 */
function tmpNamePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\.${escaped}\\.\\d+\\.\\d+\\.tmp$`);
}

/**
 * 清掉同目錄下屬於同一個目標檔案、上次寫入中斷留下的舊樣式暫存檔。
 * 新樣式 `<name>.tmp` 由 writeFileAtomic 自己在 finally 清,不在這裡掃。
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
 * §11b 第 4 步:fsync 目標檔所在的目錄,讓 rename 這個目錄項的變更也落地。
 * 只有 EINVAL 算成功(tmpfs 與部分 CI 不支援對目錄 fsync);其他錯誤碼往外丟。
 */
function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EINVAL') throw err;
  } finally {
    closeSync(fd);
  }
}

/**
 * 契約 §11b、CLAUDE.md 硬規則 5:state/ 的寫入必須是原子的。TS 只留這一份。
 *
 * 1. 寫同目錄的 `<name>.tmp`
 * 2. fsync(檔案 fd)
 * 3. rename 到目標
 * 4. fsync(目標所在的目錄);只有 EINVAL 算成功
 *
 * 任何一步失敗都先刪掉 `<name>.tmp` 再把原本那個錯誤丟出去。清理自己失敗
 * 不可以遮蔽原本的錯誤。不建目錄:目錄不存在就讓 open 丟錯。
 *
 * `mode`(可選,T8):目標檔的權限,例如帳本指標檔的 0o600。暫存檔**建立時**就是這個權限,
 * 不是寫完再 chmod——rename 之後目標就是暫存檔那個 inode,所以沒有一個瞬間比 `mode` 寬。
 * 沒給 `mode` 時行為完全不變(open 的預設 0o666 & ~umask)。
 */
export function writeFileAtomic(path: string, content: string, mode?: number): void {
  cleanupStrayTmp(path);
  const dir = dirname(path);
  const tmp = join(dir, `${basename(path)}.tmp`);
  try {
    const fd = mode === undefined ? openSync(tmp, 'w') : openSync(tmp, 'w', mode);
    try {
      // open 的 mode 只在檔案是新建時才生效(上次中斷殘留的同名暫存檔會保留舊權限),而且會被
      // umask 再遮掉幾位。寫入任何內容之前再 fchmod 一次:結果恰好是 mode,不靠 umask 湊。
      if (mode !== undefined) fchmodSync(fd, mode);
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    fsyncDir(dir);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // 清理失敗不可以遮蔽原本那個錯誤(ADR-040)
    }
  }
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
