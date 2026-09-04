/**
 * state/ 底下檔案的存取,遵守 contracts/types.md §11b 的寫入保證:
 * 寫暫存檔、fsync(fd)、rename、fsync(目錄);log.jsonl 例外,append-only 但每次
 * 寫入必須是完整的一行。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * 契約 §11b 的寫入保證,`state/` 全部寫入的單一入口(`graph/deps.json` 也借用,
 * 見 ADR-038)。四個步驟一步都不能少:
 *
 *   1. 寫 `<path>.tmp`
 *   2. `fsync(fd)` —— 檔案**內容**落地
 *   3. `rename(tmp, path)` —— 同檔案系統的 rename 是原子的
 *   4. `fsync(目錄)` —— rename 這個**目錄項**的變更本身也要落地
 *
 * 加上:**任何一步失敗都要先刪掉 tmp、再把錯誤丟出去**,不留殘檔;清理自己失敗時
 * 不可以遮蔽原本那個錯誤(呼叫端要看到的是「為什麼寫失敗」)。
 * 第 4 步唯一的例外是 **`EINVAL`**(tmpfs 與部分 CI 不支援對目錄 fsync)→ 當成功;
 * 其他錯誤碼一律往外丟。理由與取捨見 ADR-040。
 *
 * 行為規格見同目錄 `state.test.ts` 的 describe('atomicWriteJson · 契約 §11b')。
 */
export function atomicWriteJson(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify(data, null, 2) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    fsyncDir(dir);
  } finally {
    // 唯一的清理點。放在 finally 而不是每個步驟各包一次 catch:失敗清理與成功後
    // 的「tmp 早就被 rename 走了」是同一件事(`force` 吸收掉 ENOENT),而且無論
    // 從哪一步跳出去都會經過這裡。清理自己丟的錯全部吞掉 —— 呼叫端要看到的是
    // 「為什麼寫失敗」,不是「為什麼清不掉」,而 finally 裡丟錯會**取代**原本那顆。
    try {
      // Stryker disable next-line all: 等價變異。`force: true` 的唯一作用是吸收「tmp 已經不在」
      // 的 ENOENT(成功路徑上 tmp 早就被 rename 走了),但外面這個 catch 本來就會吞掉清理自己
      // 丟的每一顆錯,所以 `{}` / `{ force: false }` 的可觀察行為與這裡完全相同。留著旗標是因為
      // ADR-040 指名了「刪不掉就算了」的形式,而且它讓意圖不依賴外層 catch 才看得懂。
      rmSync(tmp, { force: true });
    } catch {
      /* 清理失敗不可以遮蔽原本那個錯誤(ADR-040) */
    }
  }
}

/**
 * §11b 第 4 步:fsync 目標檔所在的**目錄**,讓 rename 這個目錄項的變更也落地。
 *
 * `EINVAL` 是唯一吞掉的錯誤碼:tmpfs 與部分 CI 的檔案系統不支援對目錄 fsync,
 * 那是「這個 fs 沒有這個概念」。其他錯誤碼(`EIO`、`ENOSPC`……)一律往外丟 ——
 * 吞掉 `EIO` 等於把「磁碟壞了」變成靜默成功(ADR-040 (d) 已否決)。
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

export function readJsonOr<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function appendLogEvent(logPath: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf8');
}

export function readLogEvents(logPath: string): Record<string, unknown>[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
