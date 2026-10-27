/**
 * T59:provisional 佇列(03-llm-router phase-3)。
 *
 * 只做佇列與包裝,不接呼叫端。檔案是項目的 JSON 陣列,依寫入順序由舊到新。
 * 讀檔只有 load():enqueue、list、resolve、在線的 drain 都經過它;離線的 drain 不讀檔。
 * 壞檔(不是合法 JSON,或合法 JSON 但形狀不對)rename 成備份、重建空陣列、記 warning。
 * 除了修壞檔,list 與 drain 不寫檔。寫入一律走 writeFileAtomic(§11b)。
 * 事件交給建構子注入的 LogAppender;正式接線用 01 的 recordEvent(@core/schema/log.js)。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { CardIdSchema, type CardId } from '@contracts/index.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';
import type { LogAppender } from './router.js';
import { LLM_TASKS, type LlmRouter, type LlmTask } from './types.js';

const QUEUE_FILE = 'provisional-queue.json';

export interface ProvisionalEntry {
  task: LlmTask;
  card: CardId;
  /** ISO 8601,含時區。 */
  queued_at: string;
  /** 本機結果 text 的 UTF-8 sha256,小寫十六進位。 */
  local_sha256: string;
  prompt: string;
  /** 呼叫時有給 maxTokens 才有。timeoutMs 不記。 */
  max_tokens?: number;
}

const EntrySchema = z.object({
  task: z.enum(LLM_TASKS),
  card: CardIdSchema,
  queued_at: z.iso.datetime({ offset: true }),
  local_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  prompt: z.string(),
  max_tokens: z.number().int().positive().optional(),
});

const QueueFileSchema = z.array(EntrySchema);

export interface ProvisionalQueueOptions {
  path: string;
  log: LogAppender;
  now?: () => string;
}

export interface EnqueueArgs {
  task: LlmTask;
  card: CardId;
  prompt: string;
  localText: string;
  maxTokens?: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** `2026-10-27T09:30:00.123Z` → `20261027T093000123Z`。時間取 now(),一律先正規化成 UTC。 */
function corruptStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace('.', '');
}

/** 同名已經有檔就加 -2、-3……不准蓋掉舊的備份。 */
function backupName(dir: string, stamp: string): string {
  const stem = `${QUEUE_FILE}.corrupt-${stamp}`;
  let name = stem;
  let n = 2;
  while (existsSync(join(dir, name))) {
    name = `${stem}-${n}`;
    n += 1;
  }
  return name;
}

function sameSlot(entry: { card: string; task: string }, key: { card: string; task: string }): boolean {
  return entry.card === key.card && entry.task === key.task;
}

function copyEntry(entry: z.infer<typeof EntrySchema>): ProvisionalEntry {
  const copy: ProvisionalEntry = {
    task: entry.task,
    card: entry.card,
    queued_at: entry.queued_at,
    local_sha256: entry.local_sha256,
    prompt: entry.prompt,
  };
  if (entry.max_tokens !== undefined) copy.max_tokens = entry.max_tokens;
  return copy;
}

/** 不是合法 JSON,或 zod 驗不過,都是壞檔。 */
function parseQueue(text: string): ProvisionalEntry[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const parsed = QueueFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.map(copyEntry);
}

function buildEntry(args: EnqueueArgs, queuedAt: string): ProvisionalEntry {
  const entry: ProvisionalEntry = {
    task: args.task,
    card: args.card,
    queued_at: queuedAt,
    local_sha256: sha256(args.localText),
    prompt: args.prompt,
  };
  if (args.maxTokens !== undefined) entry.max_tokens = args.maxTokens;
  return entry;
}

export function provisionalQueuePath(learningDir: string): string {
  return join(learningDir, 'state', QUEUE_FILE);
}

export class ProvisionalQueue {
  private readonly path: string;
  private readonly log: LogAppender;
  private readonly now: () => string;

  constructor(opts: ProvisionalQueueOptions) {
    this.path = opts.path;
    this.log = opts.log;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** 同一個 card + task 已有一筆:拿掉舊的,新的放最後。新的沒給 maxTokens 就不留舊的。 */
  async enqueue(args: EnqueueArgs): Promise<void> {
    const next = this.load().filter((entry) => !sameSlot(entry, args));
    next.push(buildEntry(args, this.now()));
    this.save(next);
  }

  /** 目前所有項目的複本。除了修壞檔,不寫檔。 */
  async list(): Promise<ProvisionalEntry[]> {
    return this.load();
  }

  /**
   * 先問 isOnline。離線:空陣列,連檔都不讀。在線:所有項目的複本(含 prompt);
   * 除了修壞檔,不寫檔。
   */
  async drain(isOnline: () => Promise<boolean>): Promise<ProvisionalEntry[]> {
    const online = await isOnline();
    if (!online) return [];
    return this.load();
  }

  /**
   * 有那一筆:拿掉、寫檔、記 provisional_resolved,回 true。
   * 沒有:不寫、不記,回 false。changed 原樣記呼叫端給的值。
   */
  async resolve(key: { card: CardId; task: LlmTask }, result: { cloudText: string; changed: boolean }): Promise<boolean> {
    const entries = this.load();
    const hit = entries.find((entry) => sameSlot(entry, key));
    if (hit === undefined) return false;
    this.save(entries.filter((entry) => !sameSlot(entry, key)));
    this.log({
      ts: this.now(),
      type: 'provisional_resolved',
      card: hit.card,
      task: hit.task,
      changed: result.changed,
      local_sha256: hit.local_sha256,
      cloud_sha256: sha256(result.cloudText),
    });
    return true;
  }

  /** 唯一讀檔入口。檔不存在 = 空佇列,不是壞檔。 */
  private load(): ProvisionalEntry[] {
    if (!existsSync(this.path)) return [];
    const parsed = parseQueue(readFileSync(this.path, 'utf8'));
    if (parsed !== null) return parsed;
    this.quarantine();
    return [];
  }

  private save(entries: readonly ProvisionalEntry[]): void {
    writeFileAtomic(this.path, JSON.stringify(entries));
  }

  /** 原檔 rename 成備份(不改位元組)、寫空陣列、記 warning。backup 只寫檔名。 */
  private quarantine(): void {
    const ts = this.now();
    const dir = dirname(this.path);
    const name = backupName(dir, corruptStamp(ts));
    renameSync(this.path, join(dir, name));
    this.save([]);
    this.log({
      ts,
      type: 'warning',
      reason: 'provisional_queue_corrupt',
      backup: name,
    });
  }
}

/**
 * 包一層 router:provisional === true 才放進佇列。回傳值原樣交回;inner 丟錯就原樣往外丟。
 * probeOnline、probeLocal 直接委派。timeoutMs 不進佇列。
 */
export function recordProvisional(inner: LlmRouter, queue: ProvisionalQueue, card: CardId): LlmRouter {
  return {
    async call(task, prompt, opts) {
      const result = await inner.call(task, prompt, opts);
      if (result.provisional === true) {
        await queue.enqueue({
          task,
          card,
          prompt,
          localText: result.text,
          ...(opts?.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        });
      }
      return result;
    },
    probeOnline: () => inner.probeOnline(),
    probeLocal: () => inner.probeLocal(),
  };
}
