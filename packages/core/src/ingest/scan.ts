/**
 * 掃描 / 主題跑法(T53,02 phase-3)。
 *
 * 不給 --file 時走這裡:讀 categories.yaml,掃 raw/<分類>/ 第一層的 .md,
 * 新檔交給 phase-2 管線,sha 相同的略過,sha 變了只標 stale,檔案不見只標
 * source_missing。標記是純文字插一行(或換掉頂層 `key: false`),不准解析再序列化。
 *
 * 一個 raw 檔只落一個桶:skipped 只有「已處理且 sha 相同」;內容變了的只進
 * staleCards;刪了的只進 missingSourceCards。
 * 沒有新檔要生成時不呼叫 probeOnline、不呼叫 LLM(離線也能標旗標)。
 * 拒絕(分類沒定義、要求 raw、主題正規化後無效)也不探測。
 * `topic:` 開頭的鍵是主題生成的紀錄,不是 raw 路徑:掃描、stale、source_missing 都跳過。
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { writeFileAtomic } from '@core/schema/atomic-write.js';
import { validateCategoryId } from '@core/schema/category-id.js';
import { runIngest, runIngestPipeline, type RunIngestOptions } from './ingest.js';
import { listCategories, type CategoryConfig } from './init.js';
import { appendLogEvent, readJsonOr } from './state.js';
import { generateFromTopic, isTopicKey } from './topic.js';
import type { CardId, LlmRouter } from './types.js';

export type ScanRefusal = 'category_undefined' | 'requires_raw' | 'raw_conflict' | 'topic_invalid' | 'topic_failed';

export interface ScanOptions {
  outDir: string;
  router: LlmRouter;
  category?: string;
  topic?: string;
  today?: string;
  /** true = 只跑 level 0(CLI 的 --fake)。沒給就跑完整管線。 */
  levelZeroOnly?: boolean;
}

export interface ScanResult {
  refused?: ScanRefusal;
  topicIgnored: boolean;
  processed: string[];
  skipped: string[];
  skippedLinks: string[];
  outsideCategory: string[];
  staleCards: string[];
  missingSourceCards: string[];
  unreadableFlags: string[];
  /** raw/ 第一層、不在 categories.yaml 裡的資料夾名字。不給 category 才列;沒有就是空陣列。 */
  unconfiguredFolders: string[];
  message: string;
  /** 有新檔要生成但雲端探測失敗。不是工單的 refused 種類;CLI 用它決定退出碼 1。 */
  cloudBlocked?: boolean;
  /** 這一次主題生成寫出的 level 0 卡 id。沒有主題生成就沒有這個欄位或是空陣列。 */
  topicGenerated?: string[];
  /** 同一個分類、正規化後同一個主題已經生成過:那幾張卡的 id。 */
  topicAlready?: string[];
}

interface IngestedEntry {
  sha256: string;
  cardIds: CardId[];
  processedAt: string;
}

type IngestedState = Record<string, IngestedEntry>;

type FlagKey = 'stale' | 'source_missing';

interface ListedRaw {
  files: { rel: string; abs: string }[];
  skippedLinks: string[];
  outsideCategory: string[];
}

const CLOUD_MESSAGE = 'ingest requires a cloud model,目前偵測不到可用的雲端模型,不會降級到本機模型。';

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function emptyResult(message: string, extra: Partial<ScanResult> = {}): ScanResult {
  return {
    topicIgnored: false,
    processed: [],
    skipped: [],
    skippedLinks: [],
    outsideCategory: [],
    staleCards: [],
    missingSourceCards: [],
    unreadableFlags: [],
    unconfiguredFolders: [],
    message,
    ...extra,
  };
}

function refuse(refused: ScanRefusal, message: string): ScanResult {
  return emptyResult(message, { refused });
}

/** 解析後必須是分類資料夾的直接子檔。`..` 或跑到別的目錄都不算。 */
function resolvedInsideCategory(categoryReal: string, fileReal: string): boolean {
  const rel = relative(categoryReal, fileReal);
  if (rel === '' || isAbsolute(rel)) return false;
  const parts = rel.split(sep);
  if (parts.length !== 1) return false;
  if (parts[0] === '' || parts[0] === '..' || parts[0] === '.') return false;
  return true;
}

/**
 * raw/<分類>/ 第一層:一般檔、副檔名 .md、不以 . 開頭。
 * 符號連結一律略過(不跟)。解析後不在這個資料夾裡的不處理。
 * 分類資料夾本身是連結也不跟。
 */
function listCategoryRaw(outDir: string, category: string): ListedRaw {
  const out: ListedRaw = { files: [], skippedLinks: [], outsideCategory: [] };
  const categoryDir = join(outDir, 'raw', category);
  let dirStat;
  try {
    dirStat = lstatSync(categoryDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  if (dirStat.isSymbolicLink()) {
    out.skippedLinks.push(`raw/${category}`);
    return out;
  }
  if (!dirStat.isDirectory()) return out;

  let categoryReal: string;
  try {
    categoryReal = realpathSync(categoryDir);
  } catch {
    return out;
  }

  for (const name of readdirSync(categoryDir).sort()) {
    if (name.startsWith('.')) continue;
    const abs = join(categoryDir, name);
    const rel = `raw/${category}/${name}`;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      out.skippedLinks.push(rel);
      continue;
    }
    if (!st.isFile()) continue;
    if (!name.endsWith('.md')) continue;

    let fileReal: string;
    try {
      fileReal = realpathSync(abs);
    } catch {
      out.outsideCategory.push(rel);
      continue;
    }
    if (!resolvedInsideCategory(categoryReal, fileReal)) {
      out.outsideCategory.push(rel);
      continue;
    }
    out.files.push({ rel, abs });
  }
  return out;
}

/** 不給 category 時才列。名字,不是路徑。不含 raw/ 直接放的檔、不含已設定的分類、不含符號連結。 */
function listUnconfiguredFolders(outDir: string, configured: Set<string>): string[] {
  const rawRoot = join(outDir, 'raw');
  let names: string[];
  try {
    names = readdirSync(rawRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const found: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (configured.has(name)) continue;
    let st;
    try {
      st = lstatSync(join(rawRoot, name));
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) found.push(name);
  }
  found.sort();
  return found;
}

function isDirectRawKey(rel: string, category: string): boolean {
  const prefix = `raw/${category}/`;
  if (!rel.startsWith(prefix)) return false;
  const rest = rel.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/');
}

function pathKind(abs: string): 'missing' | 'symlink' | 'file' | 'other' {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return 'symlink';
    if (st.isFile()) return 'file';
    return 'other';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
}

/**
 * 在 frontmatter 結尾那一行 `---` 前面插一行 `key: true`,或把頂層 `key: false` 換成 `key: true`。
 * 用檔案原本的換行。其他寫法(引號、yes、縮排、重複鍵)不改,叫呼叫端報「看不懂」。
 * 已經是 `key: true` 就不改。
 */
function markFlagText(original: string, key: FlagKey): { action: 'write'; text: string } | { action: 'already' } | { action: 'unreadable' } {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(eol);
  if (lines[0] !== '---') return { action: 'unreadable' };
  const close = lines.indexOf('---', 1);
  if (close < 0) return { action: 'unreadable' };

  const re = new RegExp(`^\\s*['"]?${key}['"]?\\s*:`);
  const mentions: number[] = [];
  for (let i = 1; i < close; i++) {
    if (re.test(lines[i]!)) mentions.push(i);
  }
  if (mentions.length === 0) {
    const copy = [...lines];
    copy.splice(close, 0, `${key}: true`);
    return { action: 'write', text: copy.join(eol) };
  }
  if (mentions.length === 1) {
    const line = lines[mentions[0]!]!;
    if (line === `${key}: true`) return { action: 'already' };
    if (line === `${key}: false`) {
      const copy = [...lines];
      copy[mentions[0]!] = `${key}: true`;
      return { action: 'write', text: copy.join(eol) };
    }
  }
  return { action: 'unreadable' };
}

interface FlagBuckets {
  staleCards: string[];
  missingSourceCards: string[];
  unreadableFlags: string[];
  missingCardFiles: string[];
}

function applyFlag(outDir: string, category: string, id: CardId, key: FlagKey, buckets: FlagBuckets): void {
  const path = join(outDir, 'cards', category, `${id}.md`);
  if (pathKind(path) !== 'file') {
    buckets.missingCardFiles.push(id);
    return;
  }
  const marked = markFlagText(readFileSync(path, 'utf8'), key);
  const list = key === 'stale' ? buckets.staleCards : buckets.missingSourceCards;
  if (marked.action === 'write') {
    writeFileAtomic(path, marked.text);
    list.push(id);
    return;
  }
  if (marked.action === 'already') {
    list.push(id);
    return;
  }
  buckets.unreadableFlags.push(id);
}

function logWarning(outDir: string, event: Record<string, unknown>): void {
  appendLogEvent(join(outDir, 'state/log.jsonl'), {
    ts: new Date().toISOString(),
    type: 'warning',
    ...event,
  });
}

function markEntry(outDir: string, category: string, rel: string, ids: CardId[], key: FlagKey, buckets: FlagBuckets): void {
  const beforeStale = buckets.staleCards.length;
  const beforeMissing = buckets.missingSourceCards.length;
  const beforeUnread = buckets.unreadableFlags.length;
  const beforeGone = buckets.missingCardFiles.length;
  for (const id of ids) applyFlag(outDir, category, id, key, buckets);
  const marked = (key === 'stale' ? buckets.staleCards.length - beforeStale : buckets.missingSourceCards.length - beforeMissing);
  const unread = buckets.unreadableFlags.slice(beforeUnread);
  const gone = buckets.missingCardFiles.slice(beforeGone);
  if (marked > 0) {
    logWarning(outDir, {
      file: rel,
      cards: ids,
      message: key === 'stale' ? `${marked} 張卡的來源改了` : `${marked} 張卡的來源不見了`,
    });
  }
  for (const id of unread) {
    logWarning(outDir, { file: rel, card: id, message: '看不懂,沒標' });
  }
  for (const id of gone) {
    logWarning(outDir, { file: rel, card: id, message: '卡檔不見了,沒有重建' });
  }
}

function buildMessage(r: {
  topicIgnored: boolean;
  processed: string[];
  skipped: string[];
  skippedLinks: string[];
  outsideCategory: string[];
  staleCards: string[];
  missingSourceCards: string[];
  unreadableFlags: string[];
  unconfiguredFolders: string[];
  missingCardFiles: string[];
  cloudBlocked: boolean;
  failures: string[];
}): string {
  const parts: string[] = [];
  if (r.topicIgnored) parts.push('有 raw,主題被略過');
  if (r.staleCards.length > 0) parts.push(`${r.staleCards.length} 張卡的來源改了`);
  if (r.missingSourceCards.length > 0) parts.push(`${r.missingSourceCards.length} 張卡的來源不見了`);
  if (r.unreadableFlags.length > 0) parts.push(`${r.unreadableFlags.length} 張卡看不懂,沒標`);
  if (r.missingCardFiles.length > 0) parts.push(`卡檔不見了,沒有重建:${r.missingCardFiles.join(',')}`);
  if (r.processed.length > 0) parts.push(`處理了 ${r.processed.length} 個 raw 檔`);
  if (r.skipped.length > 0) parts.push(`略過 ${r.skipped.length} 個沒改的 raw 檔`);
  if (r.skippedLinks.length > 0) parts.push(`略過 ${r.skippedLinks.length} 個符號連結`);
  if (r.outsideCategory.length > 0) parts.push(`${r.outsideCategory.length} 個路徑不在分類資料夾裡`);
  if (r.unconfiguredFolders.length > 0) parts.push(`未設定的分類資料夾:${r.unconfiguredFolders.join(',')}`);
  if (r.cloudBlocked) parts.push(CLOUD_MESSAGE);
  if (r.failures.length > 0) parts.push(r.failures.join(';'));
  if (parts.length === 0) parts.push('沒有需要處理的 raw 檔');
  return parts.join(';');
}

export async function runIngestScan(opts: ScanOptions): Promise<ScanResult> {
  const topicGiven = opts.topic !== undefined;

  let selected: CategoryConfig[] | undefined;
  if (opts.category !== undefined) {
    // 不合法的名字當「沒有定義」拒絕,而且不能拿去拼路徑。
    const verdict = validateCategoryId(opts.category);
    if (!verdict.ok) return refuse('category_undefined', `分類 ${opts.category} 沒有定義`);
    const found = listCategories(opts.outDir).find((c) => c.id === opts.category);
    if (!found) return refuse('category_undefined', `分類 ${opts.category} 沒有定義`);

    const listed = listCategoryRaw(opts.outDir, found.id);
    if (opts.topic !== undefined && listed.files.length === 0) {
      if (found.require_raw) return refuse('requires_raw', '這個分類要求 raw 素材');
      const generated = await generateFromTopic({
        outDir: opts.outDir,
        router: opts.router,
        category: found.id,
        topic: opts.topic,
        ...(opts.today !== undefined ? { today: opts.today } : {}),
        ...(opts.levelZeroOnly !== undefined ? { levelZeroOnly: opts.levelZeroOnly } : {}),
      });
      const extra: Partial<ScanResult> = {
        topicGenerated: generated.topicGenerated,
        topicAlready: generated.topicAlready,
      };
      if (generated.refused) extra.refused = generated.refused;
      if (generated.cloudBlocked) extra.cloudBlocked = true;
      return emptyResult(generated.message, extra);
    }
    selected = [found];
  }

  const configured = selected ?? listCategories(opts.outDir);
  // 不合法的 id 不拿去拼路徑(契約 §1)。列未設定資料夾時仍把它們算已設定,避免漏報成「不在設定裡」。
  const categories = configured.filter((c) => validateCategoryId(c.id).ok);
  const unconfiguredFolders = selected
    ? []
    : listUnconfiguredFolders(opts.outDir, new Set(configured.map((c) => c.id)));

  const state = readJsonOr<IngestedState>(join(opts.outDir, 'state/ingested.json'), {});
  const processed: string[] = [];
  const skipped: string[] = [];
  const skippedLinks: string[] = [];
  const outsideCategory: string[] = [];
  const buckets: FlagBuckets = { staleCards: [], missingSourceCards: [], unreadableFlags: [], missingCardFiles: [] };
  const pending: { rel: string; category: string }[] = [];
  let processable = 0;

  for (const cat of categories) {
    const listed = listCategoryRaw(opts.outDir, cat.id);
    processable += listed.files.length;
    skippedLinks.push(...listed.skippedLinks);
    outsideCategory.push(...listed.outsideCategory);

    const onDisk = new Set(listed.files.map((f) => f.rel));
    const byRel = new Map(listed.files.map((f) => [f.rel, f.abs]));

    for (const rel of Object.keys(state)) {
      // 主題鍵不是 raw 路徑。isDirectRawKey 也會擋,這裡再明確跳過,兩道都要在。
      if (isTopicKey(rel)) continue;
      if (!isDirectRawKey(rel, cat.id)) continue;
      const entry = state[rel];
      if (!entry) continue;
      const abs = byRel.get(rel);
      if (abs) {
        const sha = sha256Of(readFileSync(abs, 'utf8'));
        if (sha === entry.sha256) {
          skipped.push(rel);
        } else {
          // 內容變了:只標 stale,不進 skipped,不更新 sha,不呼叫 LLM。
          markEntry(opts.outDir, cat.id, rel, entry.cardIds, 'stale', buckets);
        }
        continue;
      }
      // 不在可處理清單裡。檔案真的不見才標 source_missing;連結或雜物不算刪除。
      if (pathKind(join(opts.outDir, rel)) === 'missing') {
        markEntry(opts.outDir, cat.id, rel, entry.cardIds, 'source_missing', buckets);
      }
    }

    for (const rel of onDisk) {
      if (state[rel]) continue;
      pending.push({ rel, category: cat.id });
    }
  }

  if (skippedLinks.length > 0) {
    logWarning(opts.outDir, { files: skippedLinks, message: `略過 ${skippedLinks.length} 個符號連結` });
  }
  if (outsideCategory.length > 0) {
    logWarning(opts.outDir, { files: outsideCategory, message: `${outsideCategory.length} 個路徑不在分類資料夾裡` });
  }
  if (unconfiguredFolders.length > 0) {
    logWarning(opts.outDir, { folders: unconfiguredFolders, message: `未設定的分類資料夾:${unconfiguredFolders.join(',')}` });
  }

  let cloudBlocked = false;
  const failures: string[] = [];
  if (pending.length > 0) {
    // 有新檔要生成才探測。探測失敗就不呼叫 LLM(離線不降級)。
    let online = false;
    try {
      online = await opts.router.probeOnline();
    } catch {
      online = false;
    }
    if (!online) {
      cloudBlocked = true;
    } else {
      const run = opts.levelZeroOnly ? runIngest : runIngestPipeline;
      for (const item of pending) {
        const ingestOpts: RunIngestOptions = {
          outDir: opts.outDir,
          rawRelPath: item.rel,
          category: item.category,
          router: opts.router,
        };
        if (opts.today !== undefined) ingestOpts.today = opts.today;
        const result = await run(ingestOpts);
        if (!result.ok) {
          failures.push(`${item.rel}: ${result.message}`);
          continue;
        }
        if (result.alreadyProcessed) {
          skipped.push(item.rel);
          continue;
        }
        processed.push(item.rel);
      }
    }
  }

  const topicIgnored = topicGiven && processable > 0;
  const message = buildMessage({
    topicIgnored,
    processed,
    skipped,
    skippedLinks,
    outsideCategory,
    staleCards: buckets.staleCards,
    missingSourceCards: buckets.missingSourceCards,
    unreadableFlags: buckets.unreadableFlags,
    unconfiguredFolders,
    missingCardFiles: buckets.missingCardFiles,
    cloudBlocked,
    failures,
  });

  const result: ScanResult = {
    topicIgnored,
    processed,
    skipped,
    skippedLinks,
    outsideCategory,
    staleCards: buckets.staleCards,
    missingSourceCards: buckets.missingSourceCards,
    unreadableFlags: buckets.unreadableFlags,
    unconfiguredFolders,
    message,
  };
  if (cloudBlocked) result.cloudBlocked = true;
  return result;
}
