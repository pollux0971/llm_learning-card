import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Wave 0 的最小 log appender(見 FEATURE.md「Wave 0 的重複」)。
 * I1 整合後改用 01-data-layer 的正式實作,契約 §11b:log.jsonl 是
 * append-only,直接 append 即可,但每次寫入必須是完整的一行。
 */
export type LogAppender = (event: Record<string, unknown>) => void;

export function createFileLogAppender(path: string | undefined): LogAppender {
  if (!path) return () => {};
  return (event) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
  };
}
