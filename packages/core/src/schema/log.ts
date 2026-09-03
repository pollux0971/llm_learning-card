import { LogEventSchema, type LogEvent } from '@contracts/index.js';
import { appendLineAtomic } from './atomic-write.js';
import { formatIssuePath } from './validate-card.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 驗證單一事件是否符合 §10:closed-set 的 type、必要欄位。 */
export function validateLogEvent(raw: unknown): ValidationResult {
  const parsed = LogEventSchema.safeParse(raw);
  if (parsed.success) return { ok: true, errors: [] };
  const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { ok: false, errors };
}

/**
 * 把一個事件寫進 state/log.jsonl。§11b 例外:log 是 append-only,不走
 * tmp → rename,但每次寫入必須是完整的一行(見 atomic-write.ts 的
 * appendLineAtomic)。呼叫前不驗證——要驗證先呼叫 validateLogEvent,
 * 這裡只負責「寫」。
 */
export function recordEvent(logPath: string, event: LogEvent): void {
  appendLineAtomic(logPath, JSON.stringify(event));
}

/** 讀回 log.jsonl,逐行 parse 成事件。空行略過。 */
export function parseLogLines(content: string): LogEvent[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogEvent);
}
