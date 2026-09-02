/**
 * state/ 的原子寫入(契約 §11b,CLAUDE.md 硬規則 5)。
 *
 * 三步:寫到同目錄的 `<name>.tmp` → fsync → rename 到目標。
 * 同檔案系統上的 rename 是原子的,所以任何時刻正式檔要嘛是舊的完整內容、
 * 要嘛是新的完整內容,不會出現寫到一半的殘骸。
 *
 * 若中途失敗,盡力把暫存檔清掉,再把錯誤往外丟;正式檔不會被碰到。
 *
 * `ops` 只給測試用:node:fs 是 ESM namespace,vitest 沒辦法 spy,
 * 所以用注入的方式模擬「fsync 炸掉」「write 炸掉」這種中斷。
 */
import * as fs from 'node:fs';

/** 依契約 §11b 的命名:同目錄的 `<name>.tmp` */
export function tmpPathFor(target: string): string {
  return `${target}.tmp`;
}

export interface AtomicWriteOps {
  openSync: (path: string, flags: 'w') => number;
  writeSync: (fd: number, data: string) => void;
  fsyncSync: (fd: number) => void;
  closeSync: (fd: number) => void;
  renameSync: (from: string, to: string) => void;
  unlinkSync: (path: string) => void;
}

const defaultOps: AtomicWriteOps = {
  openSync: (path, flags) => fs.openSync(path, flags),
  writeSync: (fd, data) => {
    fs.writeSync(fd, data, null, 'utf8');
  },
  fsyncSync: (fd) => fs.fsyncSync(fd),
  closeSync: (fd) => fs.closeSync(fd),
  renameSync: (from, to) => fs.renameSync(from, to),
  unlinkSync: (path) => fs.unlinkSync(path),
};

export function atomicWriteFileSync(
  target: string,
  content: string,
  overrides: Partial<AtomicWriteOps> = {},
): void {
  const ops: AtomicWriteOps = { ...defaultOps, ...overrides };
  const tmp = tmpPathFor(target);
  let fd: number | undefined;
  try {
    fd = ops.openSync(tmp, 'w');
    ops.writeSync(fd, content);
    ops.fsyncSync(fd);
    ops.closeSync(fd);
    fd = undefined;
    ops.renameSync(tmp, target);
  } catch (err) {
    if (fd !== undefined) {
      try {
        ops.closeSync(fd);
      } catch {
        /* 已經壞了,忽略 */
      }
    }
    try {
      ops.unlinkSync(tmp);
    } catch {
      /* 暫存檔可能根本沒建出來 */
    }
    throw err;
  }
}
