/**
 * T53(02 phase-3:來源規則、增量與 stale)測試共用的小工具。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T53-ingest-phase3-incremental-stale.md。
 *
 * 被測的新函式用名字 `runIngestScan` 從 `packages/core/src/ingest/index.ts`(barrel)匯出——工單說名字給 worker 定,
 * 但紅測試得釘一個;檔案放哪裡不綁(從 barrel 載)。選項與結果的形狀照工單「結果的形狀」:
 *   runIngestScan({ outDir, router, category?, topic?, today?, levelZeroOnly? })
 *   levelZeroOnly:true 時只跑 level 0(= CLI 的 --fake;fixtures 只錄了 ingest.cards),測試一律傳 true。
 * 載入用動態 import + 算出來的 file URL,所以函式還沒有時 tsc 乾淨、測試是紅的(原因:匯出還不存在)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakeLlmRouter, type FakeFixtureRecord } from './fake-llm.js';
import { runIngest } from './ingest.js';
import { ensureInitialized, setCategory } from './init.js';

export const REPO_ROOT = join(import.meta.dirname, '../../../..');
export const INGEST_BARREL = join(import.meta.dirname, 'index.ts');

export type Refusal = 'category_undefined' | 'requires_raw' | 'raw_conflict' | 'topic_not_implemented';

export interface ScanResult {
  refused?: Refusal;
  topicIgnored: boolean;
  processed: string[];
  skipped: string[];
  skippedLinks: string[];
  outsideCategory: string[];
  staleCards: string[];
  missingSourceCards: string[];
  unreadableFlags: string[];
  /** raw/ 底下不在 categories.yaml 裡的資料夾名字(只報出來、不處理;工單 D4) */
  unconfiguredFolders: string[];
  message: string;
}

export interface ScanOptions {
  outDir: string;
  router: unknown;
  category?: string;
  topic?: string;
  today?: string;
  levelZeroOnly?: boolean;
}

export type RunIngestScan = (opts: ScanOptions) => Promise<ScanResult>;

/** 從 ingest 的 barrel 取 runIngestScan;沒有就丟清楚的錯(紅的原因:功能還沒有) */
export async function loadScan(): Promise<RunIngestScan> {
  const barrel = (await import(/* @vite-ignore */ pathToFileURL(INGEST_BARREL).href)) as Record<string, unknown>;
  const fn = barrel['runIngestScan'];
  if (typeof fn !== 'function') throw new Error('packages/core/src/ingest/index.ts 還沒有匯出 runIngestScan(T53 要新增的掃描 / 主題跑法)');
  return fn as RunIngestScan;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- learning 目錄

export interface Cat {
  id: string;
  name: string;
  require_raw: boolean;
}

export function makeLearning(categories: Cat[] = [{ id: 'security', name: '資安', require_raw: true }]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-t53-'));
  ensureInitialized(dir);
  for (const c of categories) setCategory(dir, c);
  return dir;
}

export function writeRaw(dir: string, category: string, name: string, content: string): string {
  const rel = `raw/${category}/${name}`;
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content, 'utf8');
  return rel;
}

/** 一個 raw 檔的內容:有足夠的行(每張卡的行號範圍都落在檔內),含這個檔自己的名字標記以外的字 */
export function rawText(tag: string, lines = 12): string {
  return Array.from({ length: lines }, (_, i) => `第 ${i + 1} 行:${tag} 的素材內容,講同源政策與跨站請求。`).join('\n') + '\n';
}

// ---------------------------------------------------------------- 假 router

export interface Counting {
  router: FakeLlmRouter;
  calls: { task: string; prompt: string }[];
  /** 雲端探測(probeOnline)被叫了幾次 */
  probes: () => number;
}

/** 數 probeOnline 次數的 FakeLlmRouter */
class ProbeCountingRouter extends FakeLlmRouter {
  probeCount = 0;
  override async probeOnline(): Promise<boolean> {
    this.probeCount += 1;
    return super.probeOnline();
  }
}

/** 每個 raw 檔名對應 `cards` 張短卡(三張時行號 [1,2]、[3,4]、[5,6])。marker 是檔名,互斥。 */
export function cardsFixture(fileName: string, titles: string[]): FakeFixtureRecord {
  const cards = titles.map((title, i) => ({ title, body: `${title}的說明文字很短。`, examples: [], lines: [i * 2 + 1, i * 2 + 2] }));
  return {
    task: 'ingest.cards',
    prompt_contains: fileName,
    attempt: 1,
    response: { text: JSON.stringify(cards), provider: 'fake', model: 'scenario', latency_ms: 0, provisional: false },
  };
}

/**
 * files:檔名 → 卡的標題。數呼叫次數與探測次數;沒有預錄回應的檔被拿去生成會丟錯(FakeLlmRouter 不靜默)。
 * offline:true = 離線(probeOnline 回 false、call 丟 CloudRequiredError)。
 */
export function countingRouter(files: Record<string, string[]>, opts: { offline?: boolean } = {}): Counting {
  const calls: { task: string; prompt: string }[] = [];
  const extra = Object.entries(files).map(([name, titles]) => cardsFixture(name, titles));
  const router = new ProbeCountingRouter({ extra, onCall: (c) => calls.push(c), cloudUnavailable: opts.offline ?? false });
  return { router, calls, probes: () => router.probeCount };
}

/** 先用既有的 runIngest 把一個 raw 檔處理掉(產生卡、ingested.json 的鍵),回傳卡 id */
export async function ingestOne(dir: string, category: string, fileName: string, titles: string[], today = '2026-09-01'): Promise<string[]> {
  const { router } = countingRouter({ [fileName]: titles });
  const r = await runIngest({ outDir: dir, rawRelPath: `raw/${category}/${fileName}`, category, router, today });
  if (!r.ok) throw new Error(`前提:先處理 ${fileName} 失敗:${r.message}`);
  return r.cardsCreated;
}

// ---------------------------------------------------------------- 檢查用

export const cardPath = (dir: string, category: string, id: string): string => join(dir, 'cards', category, `${id}.md`);
export const readCard = (dir: string, category: string, id: string): string => readFileSync(cardPath(dir, category, id), 'utf8');
export const ingestedJson = (dir: string): Record<string, { sha256: string; cardIds: string[]; processedAt: string }> =>
  JSON.parse(readFileSync(join(dir, 'state/ingested.json'), 'utf8')) as Record<string, { sha256: string; cardIds: string[]; processedAt: string }>;
export const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** 整棵目錄的雜湊:相對路徑(含空目錄、符號連結目標)與檔案內容。符號連結不跟,只記目標字串 */
export function treeHash(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        lines.push(`L ${rel}`);
      } else if (st.isDirectory()) {
        lines.push(`D ${rel}`);
        walk(full);
      } else {
        lines.push(`F ${rel} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export const mtimeOf = (path: string): number => statSync(path).mtimeMs;

/**
 * 預期的標記結果:在 frontmatter 結尾那一行 `---` 前面插一行 `key: true`(用檔案原本的換行);
 * 已經有頂層 `key: false` 那一行就只換那一行。除此之外位元組完全相同。
 */
export function expectedMarked(original: string, key: 'stale' | 'source_missing'): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(eol);
  if (lines[0] !== '---') throw new Error('前提:卡要以 --- 開頭');
  const close = lines.indexOf('---', 1);
  if (close < 0) throw new Error('前提:卡要有結尾的 ---');
  const existing = lines.findIndex((l, i) => i > 0 && i < close && l === `${key}: false`);
  if (existing >= 0) {
    const copy = [...lines];
    copy[existing] = `${key}: true`;
    return copy.join(eol);
  }
  const copy = [...lines];
  copy.splice(close, 0, `${key}: true`);
  return copy.join(eol);
}

/** 三種會被「解析再序列化」弄壞的卡寫法:帶引號的日期與註解、不是預設順序的鍵(LF)、CRLF、已經有 key: false */
export function trickyCards(category: string, ids: string[], source: string): string[] {
  const body = '這張卡的內容。\n';
  const fmCommon = (): string[] => [`category: ${category}`, 'level: 0', 'source: raw', `source_ref: ${source}#L1-L2`, 'prereqs: []'];
  const lf = [
    '---',
    '# 這是一行註解,解析再序列化會被拿掉',
    'title: "有引號的標題"',
    `id: ${ids[0]}`,
    'created: "2026-09-01"',
    ...fmCommon(),
    '---',
    '',
    body,
  ].join('\n');
  const crlf = ['---', `id: ${ids[1]}`, `title: 'CRLF 的卡'`, `created: 2026-09-01`, ...fmCommon(), '---', '', body.trimEnd(), ''].join('\r\n');
  const withFalse = ['---', `id: ${ids[2]}`, 'title: 已經有旗標的卡', 'created: 2026-09-01', ...fmCommon(), 'stale: false', 'source_missing: false', '---', '', body].join('\n');
  return [lf, crlf, withFalse];
}

export function overwriteCards(dir: string, category: string, ids: string[], texts: string[]): void {
  ids.forEach((id, i) => writeFileSync(cardPath(dir, category, id), texts[i]!, 'utf8'));
}
