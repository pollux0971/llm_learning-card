/**
 * 11-review-cli / phase-2:當日 session 快取(ADR-074)。
 *
 * 位置:`${XDG_CACHE_HOME:-~/.cache}/llm-learning-cards/<vault_id>/session-<YYYY-MM-DD>.json`。
 * 不在 learning/ 裡(可以丟掉重建,也不該被 snapshot commit)。XDG_CACHE_HOME 空字串視同未設。
 * 寫入走 writeFileAtomic。讀不到或欄位不合就由呼叫端丟掉重建,並記一筆 warning。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { parseMarker } from '@core/llm/ledger.js';
import { recordEvent } from '@core/schema/log.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const QueueItemSchema = z.strictObject({
  card: z.string(),
  stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  overdue_days: z.number(),
  overdue_ratio: z.number(),
});

/** 工單「快取格式」。未知 version、缺欄位、queue 項多欄位都是壞的。 */
export const SessionCacheSchema = z.strictObject({
  version: z.literal(1),
  date: z.string().regex(DATE_RE),
  paused: z.boolean(),
  total_due: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  queue: z.array(QueueItemSchema),
  reteach: z.array(z.string()),
});

export type SessionCache = z.infer<typeof SessionCacheSchema>;

export type SessionCacheRead =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'stale'; cache: SessionCache }
  | { kind: 'ok'; cache: SessionCache };

/** XDG_CACHE_HOME 空字串或未設 → `$HOME/.cache`(HOME 空字串也視同未設,退回 homedir())。 */
export function sessionCacheHome(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== undefined && xdg !== '') return xdg;
  const home = env.HOME;
  const base = home !== undefined && home !== '' ? home : homedir();
  return join(base, '.cache');
}

/**
 * 帳本資料夾名。有合法 vault-id(容許一個結尾換行)就用它;
 * 沒有或格式不對,用 `path-` 加 `--dir` 真實絕對路徑 sha256 的前 16 個十六進位字元。
 */
export function sessionCacheFolder(learningDir: string): string {
  const markerPath = join(learningDir, 'config', 'vault-id');
  if (existsSync(markerPath)) {
    try {
      const id = parseMarker(readFileSync(markerPath, 'utf8'));
      if (id !== undefined) return id;
    } catch {
      // 讀不到標記檔,跟沒有一樣,改走路徑雜湊
    }
  }
  const real = realpathSafe(learningDir);
  return `path-${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}

function realpathSafe(learningDir: string): string {
  try {
    return realpathSync(learningDir);
  } catch {
    return learningDir;
  }
}

export function sessionCacheFile(learningDir: string, date: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionCacheHome(env), 'llm-learning-cards', sessionCacheFolder(learningDir), `session-${date}.json`);
}

export function sessionCacheFilename(date: string): string {
  return `session-${date}.json`;
}

/** 只讀。不建目錄、不寫檔。ENOENT 是 missing;其他讀取錯誤與格式錯誤是 invalid;date 不等於今天是 stale。 */
export function readSessionCache(learningDir: string, today: string, env: NodeJS.ProcessEnv = process.env): SessionCacheRead {
  const path = sessionCacheFile(learningDir, today, env);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'invalid' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = SessionCacheSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'invalid' };
  if (parsed.data.date !== today) return { kind: 'stale', cache: parsed.data };
  return { kind: 'ok', cache: parsed.data };
}

/**
 * 原子寫入今天的快取,然後刪掉同一個帳本資料夾裡其他日期的 session-*.json。
 * 別的帳本的資料夾不在這個目錄裡,不會被動到。
 */
export function writeSessionCache(learningDir: string, cache: SessionCache, env: NodeJS.ProcessEnv = process.env): void {
  const path = sessionCacheFile(learningDir, cache.date, env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(cache, null, 2)}\n`);
  const dir = dirname(path);
  const keep = sessionCacheFilename(cache.date);
  for (const name of readdirSync(dir)) {
    if (name !== keep && name.startsWith('session-') && name.endsWith('.json')) {
      unlinkSync(join(dir, name));
    }
  }
}

/** 壞快取:warning 到 state/log.jsonl。path 只寫檔名,不寫絕對路徑。 */
export function warnInvalidSessionCache(learningDir: string, date: string): void {
  const logPath = join(learningDir, 'state', 'log.jsonl');
  mkdirSync(dirname(logPath), { recursive: true });
  recordEvent(logPath, {
    ts: new Date().toISOString(),
    type: 'warning',
    reason: 'session-cache-invalid',
    path: sessionCacheFilename(date),
  });
}

/** 從剛建好的 session 組出要落地的快取。只留 DueItem 的四個欄位,不存 learned_at / 答案 / 分數。 */
export function toSessionCache(input: {
  date: string;
  paused: boolean;
  totalDue: number;
  deferred: number;
  queue: readonly { card: string; stage: number; overdue_days: number; overdue_ratio: number }[];
  reteach: readonly string[];
}): SessionCache {
  return {
    version: 1,
    date: input.date,
    paused: input.paused,
    total_due: input.totalDue,
    deferred: input.deferred,
    queue: input.queue.map((item) => ({
      card: item.card,
      stage: item.stage as SessionCache['queue'][number]['stage'],
      overdue_days: item.overdue_days,
      overdue_ratio: item.overdue_ratio,
    })),
    reteach: [...input.reteach],
  };
}
