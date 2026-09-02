/** 主流程:raw → level 0 卡片。單一 raw 檔的一次 ingest 呼叫。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import type { CardFrontmatter, CardId, LlmRouter } from './types.js';
import { generateCards, type CardCandidate, type ParkedCandidate } from './generate-cards.js';
import { nextCardIds } from './ids.js';
import { ensureInitialized } from './init.js';
import { atomicWriteJson, readJsonOr, appendLogEvent } from './state.js';
import { CloudRequiredError } from './fake-llm.js';

export interface RunIngestOptions {
  /** learning 根目錄(絕對路徑)。 */
  outDir: string;
  /** raw 檔相對於 outDir 的路徑,例如 "raw/security/web-basics.md"。 */
  rawRelPath: string;
  category?: string;
  router: LlmRouter;
  /** 覆蓋「今天」,格式 YYYY-MM-DD。預設用目前系統日期。 */
  today?: string;
}

export interface RunIngestResult {
  ok: boolean;
  exitCode: number;
  message: string;
  cardsCreated: CardId[];
  alreadyProcessed: boolean;
  parkedCount: number;
  regenerateEvents: number;
}

interface IngestedState {
  [rawRelPath: string]: { sha256: string; cardIds: CardId[]; processedAt: string };
}

export async function runIngest(opts: RunIngestOptions): Promise<RunIngestResult> {
  ensureInitialized(opts.outDir);
  const category = opts.category ?? inferCategory(opts.rawRelPath) ?? 'security';
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const rawPath = join(opts.outDir, opts.rawRelPath);

  if (!existsSync(rawPath)) {
    return fail(`raw 檔案不存在:${opts.rawRelPath}`, 1);
  }
  const raw = readFileSync(rawPath, 'utf8');
  if (raw.trim().length === 0) {
    return fail('raw 檔案沒有可用內容(空白)', 1);
  }

  const statePath = join(opts.outDir, 'state/ingested.json');
  const state = readJsonOr<IngestedState>(statePath, {});
  const existing = state[opts.rawRelPath];
  if (existing) {
    return {
      ok: true,
      exitCode: 0,
      alreadyProcessed: true,
      parkedCount: 0,
      regenerateEvents: 0,
      cardsCreated: existing.cardIds,
      message: `${opts.rawRelPath} 已經處理過,略過(已產生 ${existing.cardIds.length} 張卡)`,
    };
  }

  const basename = opts.rawRelPath.split('/').pop()!;
  const t0 = Date.now();

  let generated: { accepted: CardCandidate[]; parked: ParkedCandidate[]; regenerateEvents: number };
  try {
    generated = await generateCards(opts.router, { relLabel: basename, category, content: raw });
  } catch (err) {
    if (err instanceof CloudRequiredError) {
      return fail('ingest 需要雲端模型,目前無法使用雲端,不會降級到本機模型', 1);
    }
    throw err;
  }

  const cardsDir = join(opts.outDir, 'cards', category);
  mkdirSync(cardsDir, { recursive: true });
  const totalLines = raw.split('\n').length;

  const ids = nextCardIds(cardsDir, category, generated.accepted.length);
  const cardsCreated: CardId[] = [];
  ids.forEach((id, i) => {
    const candidate = generated.accepted[i]!;
    const [start, end] = clampLines(candidate.lines, totalLines);
    const frontmatter: CardFrontmatter = {
      id,
      category,
      title: candidate.title,
      level: 0,
      source: 'raw',
      source_ref: `raw/${category}/${basename}#L${start}-L${end}`,
      created: today,
      prereqs: [],
    };
    writeCardFile(cardsDir, id, frontmatter, candidate.body, candidate.examples);
    cardsCreated.push(id);
  });

  if (generated.parked.length > 0) {
    const needsReviewPath = join(opts.outDir, 'state/needs-review.json');
    const existingParked = readJsonOr<unknown[]>(needsReviewPath, []);
    const entries = generated.parked.map((p) => ({
      category,
      title: p.title,
      source: opts.rawRelPath,
      lines: p.lines,
      reason: 'body_over_limit',
      attempts: p.attempts,
      recordedAt: new Date().toISOString(),
    }));
    atomicWriteJson(needsReviewPath, [...existingParked, ...entries]);
    appendLogEvent(join(opts.outDir, 'state/log.jsonl'), {
      ts: new Date().toISOString(),
      type: 'warning',
      file: opts.rawRelPath,
      message: `${generated.parked.length} 張卡因字數超過上限被暫緩,見 needs-review.json`,
    });
  }

  state[opts.rawRelPath] = { sha256: sha256Of(raw), cardIds: cardsCreated, processedAt: new Date().toISOString() };
  atomicWriteJson(statePath, state);

  const durationMs = Date.now() - t0;
  appendLogEvent(join(opts.outDir, 'state/log.jsonl'), {
    ts: new Date().toISOString(),
    type: 'ingested',
    file: opts.rawRelPath,
    cards_created: cardsCreated.length,
    duration_ms: durationMs,
  });

  for (let i = 0; i < generated.regenerateEvents; i++) {
    appendLogEvent(join(opts.outDir, 'state/log.jsonl'), {
      ts: new Date().toISOString(),
      type: 'regenerate',
      file: opts.rawRelPath,
    });
  }

  return {
    ok: true,
    exitCode: 0,
    alreadyProcessed: false,
    cardsCreated,
    parkedCount: generated.parked.length,
    regenerateEvents: generated.regenerateEvents,
    message: `建立了 ${cardsCreated.length} 張卡`,
  };
}

function fail(message: string, exitCode: number): RunIngestResult {
  return {
    ok: false,
    exitCode,
    message,
    cardsCreated: [],
    alreadyProcessed: false,
    parkedCount: 0,
    regenerateEvents: 0,
  };
}

function inferCategory(rawRelPath: string): string | undefined {
  const parts = rawRelPath.split('/');
  return parts.length === 3 && parts[0] === 'raw' ? parts[1] : undefined;
}

function clampLines([start, end]: [number, number], totalLines: number): [number, number] {
  const s = Math.max(1, Math.min(start, totalLines));
  const e = Math.max(s, Math.min(end, totalLines));
  return [s, e];
}

function writeCardFile(cardsDir: string, id: CardId, fm: CardFrontmatter, body: string, examples: string[]): void {
  const yamlFm = stringify(fm).trimEnd();
  const exampleBlocks = examples.map((e) => '```example\n' + e.trim() + '\n```').join('\n\n');
  const content = `---\n${yamlFm}\n---\n\n${body.trim()}\n${exampleBlocks ? '\n' + exampleBlocks + '\n' : ''}`;
  writeFileSync(join(cardsDir, `${id}.md`), content, 'utf8');
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
