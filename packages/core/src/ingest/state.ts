/**
 * state/ 底下檔案的存取。寫入保證只留 01 的一份(契約 §11b、ADR-070):
 * JSON 走 writeFileAtomic,log 走 appendLineAtomic。這裡只建目錄、組位元組。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { appendLineAtomic, writeFileAtomic } from '@core/schema/atomic-write.js';

/**
 * `state/` 全部 JSON 寫入的入口(`graph/deps.json` 也借用,見 ADR-038)。
 * 寫入本身是一行呼叫 writeFileAtomic;四步、EINVAL、失敗清理都在那邊。
 * 目錄不存在時照舊先建(writeFileAtomic 自己不建)。
 */
export function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n');
}

export function readJsonOr<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function appendLogEvent(logPath: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendLineAtomic(logPath, JSON.stringify(event));
}

export function readLogEvents(logPath: string): Record<string, unknown>[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
