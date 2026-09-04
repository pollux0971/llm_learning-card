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
 * TODO(ADR-040):以下函式體還是舊的三步版本 —— 沒有失敗清理、沒有第 4 步。
 * 行為規格見同目錄 `state.test.ts` 的 describe('atomicWriteJson · 契約 §11b'),
 * 那一組現在是紅的,由下一輪開發 agent 補上。
 */
export function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(data, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
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
