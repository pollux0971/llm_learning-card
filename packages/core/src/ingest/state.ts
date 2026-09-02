/**
 * state/ 底下檔案的存取,遵守 contracts/types.md §11b 的寫入保證:
 * 寫暫存檔、fsync、rename;log.jsonl 例外,append-only 但每次寫入必須是完整的一行。
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
