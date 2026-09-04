/**
 * `atomicWriteJson()` 的寫入保證測試 —— 契約 §11b 與 ADR-040。
 *
 * 這個函式是 `state/` **全部**寫入的單一入口(`graph/deps.json` 也借用它,見
 * ADR-038),所以它的失敗形狀就是整個專案的失敗形狀。§11b 補齊後要求四步:
 *
 *   1. 寫 `<name>.tmp`
 *   2. `fsync(fd)`          —— 檔案內容落地
 *   3. `rename`             —— 同檔案系統上的 rename 是原子的
 *   4. `fsync(目標的目錄)`  —— rename 這個目錄項的變更本身也要落地
 *
 * 外加兩條:任何一步失敗都要**刪掉 tmp 再丟錯**(清理失敗不可以遮蔽原本的錯誤),
 * 以及第 4 步的 `EINVAL` 要吞、其他錯誤碼一律不吞。
 *
 * 為什麼要 mock `node:fs`:第 2 與第 4 步在真實檔案系統上**沒有可觀察的副作用**
 * (fsync 成功就是什麼都不會變),而第 4 步在 tmpfs 上還會直接 EINVAL。要驗
 * 「有沒有做、順序對不對」只能記錄 syscall 本身。下面的 mock 一律 pass-through 到
 * 真的 fs,只多做兩件事:把呼叫記進 `h.calls`,以及讓測試可以在指定的 syscall 上
 * 注入錯誤(`h.hooks`)。
 *
 * 「這是檔案的 fsync 還是目錄的 fsync」不看實作用哪個 API,而是看那個 fd 是從
 * `openSync()` 拿到的哪一個路徑、那個路徑在當下是不是目錄 —— 實作只要「開目錄、
 * fsync 它」就會被認出來,不綁死在某個寫法上。
 *
 * TODO(ADR-040):`atomicWriteJson()` 的函式體目前還是舊的三步版本,所以這一整組
 * 除了「內容有寫進去」那類斷言之外都是紅的,由下一輪開發 agent 補上。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** 依序記錄關心的 syscall:'fsync:file' | 'fsync:dir' | 'rename' | 'unlink' */
  calls: [] as string[],
  /** openSync 拿到的 fd → 當初開的路徑,用來判斷 fsync 的對象是檔案還是目錄 */
  fdPaths: new Map<number, string>(),
  /**
   * open / close 的事件序列,用來驗「開了就要關」。不能只記「關過哪些 fd」——作業系統
   * 會**重用** fd 編號(關掉 22 之後下一個 open 又拿到 22),用集合比對會讓「開 22、關
   * 22、再開 22 沒關」看起來是平的。照順序重放才算得準。
   */
  fdEvents: [] as ({ op: 'open'; fd: number; path: string } | { op: 'close'; fd: number })[],
  hooks: {} as {
    onRename?: (() => void) | undefined;
    onDirFsync?: (() => void) | undefined;
    onUnlink?: (() => void) | undefined;
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();

  function isDirFd(fd: number): boolean {
    const p = h.fdPaths.get(fd);
    if (p === undefined) return false;
    try {
      return real.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  return {
    ...real,
    openSync(path: Parameters<typeof real.openSync>[0], flags: Parameters<typeof real.openSync>[1], mode?: Parameters<typeof real.openSync>[2]) {
      const fd = real.openSync(path, flags, mode);
      h.fdPaths.set(fd, String(path));
      h.fdEvents.push({ op: 'open', fd, path: String(path) });
      return fd;
    },
    fsyncSync(fd: number) {
      const dir = isDirFd(fd);
      h.calls.push(dir ? 'fsync:dir' : 'fsync:file');
      if (dir) h.hooks.onDirFsync?.();
      return real.fsyncSync(fd);
    },
    renameSync(from: Parameters<typeof real.renameSync>[0], to: Parameters<typeof real.renameSync>[1]) {
      h.calls.push('rename');
      // hook 先跑:模擬「rename 這個 syscall 自己失敗」,目標檔不該被動到。
      h.hooks.onRename?.();
      return real.renameSync(from, to);
    },
    closeSync(fd: number) {
      h.fdEvents.push({ op: 'close', fd });
      return real.closeSync(fd);
    },
    unlinkSync(path: Parameters<typeof real.unlinkSync>[0]) {
      h.calls.push('unlink');
      h.hooks.onUnlink?.();
      return real.unlinkSync(path);
    },
    rmSync(path: Parameters<typeof real.rmSync>[0], options?: Parameters<typeof real.rmSync>[1]) {
      h.calls.push('unlink');
      h.hooks.onUnlink?.();
      return real.rmSync(path, options);
    },
  };
});

// mock 之後才 import 受測模組,拿到的才是被攔截過的 fs。
const { atomicWriteJson, readLogEvents } = await import('./state.js');

/** 帶 errno code 的錯誤,跟 fs 真的丟出來的形狀一致。 */
function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-atomic-'));
  h.calls.length = 0;
  h.fdPaths.clear();
  h.fdEvents.length = 0;
  h.hooks.onRename = undefined;
  h.hooks.onDirFsync = undefined;
  h.hooks.onUnlink = undefined;
});

afterEach(() => {
  h.hooks.onRename = undefined;
  h.hooks.onDirFsync = undefined;
  h.hooks.onUnlink = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('atomicWriteJson · 契約 §11b(ADR-040)', () => {
  // ------------------------------------------------------------ (a) 失敗清理
  //
  // rename 失敗代表「這次寫入沒有發生」。磁碟上該看到的東西有三件:tmp 不在、
  // 原檔一個位元組都沒變、丟出來的是 rename 自己那個錯誤。第三點特別重要 ——
  // 清理是善後,不是新的失敗原因,把它的錯誤丟出去會讓呼叫端追錯方向。

  it('刪掉 tmp 殘檔、原檔位元組不動,並丟出 rename 原本那個錯誤', () => {
    const path = join(dir, 'reviews.json');
    const before = '{"kept":"這是幾個月的記憶資料,不能被動到"}\n';
    writeFileSync(path, before, 'utf8');

    const renameFailure = errnoError('EXDEV', 'EXDEV: cross-device link not permitted, rename');
    h.hooks.onRename = () => {
      throw renameFailure;
    };

    let thrown: unknown;
    try {
      atomicWriteJson(path, { replaced: true });
    } catch (err) {
      thrown = err;
    }

    // 丟出來的必須是 rename 那一顆本人,不是包過的、也不是清理過程的錯。
    expect(thrown).toBe(renameFailure);
    expect(existsSync(`${path}.tmp`), '失敗後留下了 .tmp 殘檔').toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('連清理都失敗時,丟出去的仍然是原本那個錯誤(清理的錯不遮蔽它)', () => {
    const path = join(dir, 'weekly.json');
    const before = '{"kept":true}\n';
    writeFileSync(path, before, 'utf8');

    const renameFailure = errnoError('EIO', 'EIO: i/o error, rename');
    const cleanupFailure = errnoError('EPERM', 'EPERM: operation not permitted, unlink');
    h.hooks.onRename = () => {
      throw renameFailure;
    };
    h.hooks.onUnlink = () => {
      throw cleanupFailure;
    };

    let thrown: unknown;
    try {
      atomicWriteJson(path, { replaced: true });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(renameFailure);
    expect(thrown).not.toBe(cleanupFailure);
    // 清理**有被嘗試**才談得上「清理失敗不遮蔽」——沒有這一條的話,一個完全不清理
    // 的實作也會讓上面兩句成立。
    expect(h.calls, `沒有嘗試刪 tmp:${h.calls.join(' → ')}`).toContain('unlink');
    // 原檔照樣不能被動到。
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  // ------------------------------------------------------------ (b) 呼叫順序
  //
  // 兩個 fsync 分別保護不同的東西:fsync(fd) 保護「檔案內容」,必須在 rename
  // **之前**(不然 rename 上去的可能是還沒落地的內容);fsync(目錄) 保護「rename
  // 這個目錄項」,必須在 rename **之後**(不然它同步的是還沒發生的變更)。
  // 兩個都做了但順序反過來,等於兩個都沒做 —— 所以順序本身要被鎖住。

  it('fsync(fd) 在 rename 之前、fsync(目錄) 在 rename 之後', () => {
    const path = join(dir, 'state', 'ingested.json');

    atomicWriteJson(path, { ok: 1 });

    const fsyncFile = h.calls.indexOf('fsync:file');
    const rename = h.calls.indexOf('rename');
    const fsyncDir = h.calls.indexOf('fsync:dir');
    const trace = h.calls.join(' → ');

    expect(fsyncFile, `沒有 fsync 檔案內容:${trace}`).toBeGreaterThanOrEqual(0);
    expect(rename, `沒有 rename:${trace}`).toBeGreaterThanOrEqual(0);
    expect(fsyncDir, `沒有 fsync 目標所在的目錄:${trace}`).toBeGreaterThanOrEqual(0);

    expect(fsyncFile, `fsync(fd) 沒有排在 rename 之前:${trace}`).toBeLessThan(rename);
    expect(fsyncDir, `fsync(目錄) 沒有排在 rename 之後:${trace}`).toBeGreaterThan(rename);

    // 成功路徑的結果不能因為多了兩個 syscall 而改變。
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ok: 1 });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('fsync 的目錄就是目標檔所在的那個目錄', () => {
    const path = join(dir, 'state', 'reviews.json');

    atomicWriteJson(path, { ok: 1 });

    // fsync:dir 標記是靠「這個 fd 開的路徑是不是目錄」判出來的,所以有這一筆就
    // 代表真的開了一個目錄;再確認被開的目錄裡確實含有目標檔,不是隨便一個目錄。
    const dirPaths = [...h.fdPaths.values()].filter((p) => existsSync(p) && statSync(p).isDirectory());
    expect(dirPaths, `沒有任何目錄被開起來:${h.calls.join(' → ')}`).toContain(join(dir, 'state'));
  });

  // ------------------------------------------------------------ (c) EINVAL
  //
  // 目錄 fsync 在 tmpfs 與部分 CI 的檔案系統上會直接 EINVAL —— 那是「這個 fs 沒有
  // 這個概念」,不是資料完整性問題,吞掉它是對的。但也只有它可以吞:EIO 之類代表
  // 磁碟真的有事,吞掉就變成靜默成功,正是 ADR-038 剛在圖資料上消滅過的形狀。

  it('目錄 fsync 回 EINVAL 時當作成功,檔案照常寫出去', () => {
    const path = join(dir, 'state', 'log-index.json');
    h.hooks.onDirFsync = () => {
      throw errnoError('EINVAL', 'EINVAL: invalid argument, fsync');
    };

    expect(() => atomicWriteJson(path, { ok: 1 })).not.toThrow();

    // 「不丟錯」要是**吞掉 EINVAL** 的結果,不是**根本沒 fsync 目錄**的結果。
    expect(h.calls, `沒有 fsync 目標所在的目錄:${h.calls.join(' → ')}`).toContain('fsync:dir');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ok: 1 });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('目錄 fsync 回 EINVAL 以外的錯誤(EIO)時往外丟,不吞', () => {
    const path = join(dir, 'state', 'log-index.json');
    const dirFsyncFailure = errnoError('EIO', 'EIO: i/o error, fsync');
    h.hooks.onDirFsync = () => {
      throw dirFsyncFailure;
    };

    let thrown: unknown;
    try {
      atomicWriteJson(path, { ok: 1 });
    } catch (err) {
      thrown = err;
    }

    expect(thrown, '目錄 fsync 的 EIO 被吞掉了').toBe(dirFsyncFailure);
    // 這時 rename 已經成功,tmp 早就不在了 —— 清理是「刪得掉就刪」,不能因為
    // tmp 不存在而再丟一個 ENOENT 蓋掉 EIO。
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('目錄 fsync 回 ENOSPC 時也往外丟(只有 EINVAL 是例外,不是「fsync 的錯都吞」)', () => {
    const path = join(dir, 'state', 'weekly.json');
    const dirFsyncFailure = errnoError('ENOSPC', 'ENOSPC: no space left on device, fsync');
    h.hooks.onDirFsync = () => {
      throw dirFsyncFailure;
    };

    expect(() => atomicWriteJson(path, { ok: 1 })).toThrow(dirFsyncFailure);
  });

  // ------------------------------------------------------------ (d) fd 不外洩
  //
  // 四步裡開了兩個 fd(tmp 檔一個、目錄一個),兩個都要關。漏關在單次寫入上看不出
  // 任何症狀,但 `atomicWriteJson()` 是 state/ 全部寫入的單一入口:桌面端常駐、每次
  // 複習都寫,漏一個 fd 就是每次寫入漏一個,跑久了撞 EMFILE,而那時的錯誤會出現在
  // 一個跟真正原因完全無關的地方。所以「開了就要關」要跟四步一起被鎖住。

  /** 重放 open/close 序列,回傳結束時還開著的 fd(fd 編號會被重用,所以要照順序算)。 */
  function stillOpenFds(): string[] {
    const open = new Map<number, string>();
    for (const e of h.fdEvents) {
      if (e.op === 'open') open.set(e.fd, e.path);
      else open.delete(e.fd);
    }
    return [...open].map(([fd, path]) => `${fd}=${path}`);
  }

  /** 這一輪一共開了幾次(不是幾個不同的 fd 編號)。 */
  function openCount(): number {
    return h.fdEvents.filter((e) => e.op === 'open').length;
  }

  it('成功路徑上每一個開起來的 fd 都被關掉(檔案的與目錄的都是)', () => {
    const path = join(dir, 'state', 'reviews.json');

    atomicWriteJson(path, { ok: 1 });

    // 先確認這一輪真的開了兩次(tmp 檔一次、目錄一次),不然「全關掉」在零個 fd 上也成立。
    expect(openCount(), JSON.stringify(h.fdEvents)).toBe(2);
    expect(stillOpenFds(), `結束時還開著的 fd`).toEqual([]);
  });

  it('目錄 fsync 丟錯時,目錄的 fd 照樣被關掉(失敗路徑也不漏 fd)', () => {
    const path = join(dir, 'state', 'weekly.json');
    h.hooks.onDirFsync = () => {
      throw errnoError('EIO', 'EIO: i/o error, fsync');
    };

    expect(() => atomicWriteJson(path, { ok: 1 })).toThrow();

    expect(openCount(), JSON.stringify(h.fdEvents)).toBe(2);
    expect(stillOpenFds(), `結束時還開著的 fd`).toEqual([]);
  });

  // ------------------------------------------------------------ 既有行為的回歸
  //
  // 補保證不是改磁碟格式:落地的位元組、目錄自動建立、覆寫既有檔,全部照舊。

  it('照舊自動建立目標目錄,並寫出 2 空格縮排 + 結尾換行的位元組', () => {
    const path = join(dir, 'state', 'nested', 'ingested.json');

    atomicWriteJson(path, { a: 1 });

    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify({ a: 1 }, null, 2) + '\n');
  });

  it('照舊覆寫既有檔', () => {
    const path = join(dir, 'reviews.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, '{"old":true}\n', 'utf8');

    atomicWriteJson(path, { new: true });

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ new: true });
  });
});

// ============================================================== readLogEvents
//
// log.jsonl 是 append-only 的(§11b 的例外),所以它會被中斷、被編輯器補尾巴,
// 空白行是真的會出現的東西。過濾條件是 `l.trim().length > 0` 而不是 `l.length > 0`:
// 只含空白的那一行 `JSON.parse` 會直接丟,整份 log 就讀不出來了。

describe('readLogEvents', () => {
  it('略過只含空白的行,不讓它把整份 log 弄到讀不出來', () => {
    const logPath = join(dir, 'state', 'log.jsonl');
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(logPath, '{"type":"a"}\n   \n\t\n{"type":"b"}\n', 'utf8');

    expect(readLogEvents(logPath)).toEqual([{ type: 'a' }, { type: 'b' }]);
  });

  it('檔案不存在時回空陣列', () => {
    expect(readLogEvents(join(dir, 'state', 'nope.jsonl'))).toEqual([]);
  });
});
