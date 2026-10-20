/**
 * T37(07-teach-card phase-2)紅測試的共用佈置與觀測。測試 agent 寫;開發 worker 不改。
 *
 * 只有「佈置」與「觀測」,沒有教學卡的邏輯:不算下一張、不算剩幾張。預期值由測試自己寫死。
 * 純輔助模組(沒有 vitest / cucumber 相依):vitest 與步驟檔都 import 它。
 *
 * 世界(三個類別,設定檔順序就是這個順序):
 *
 *   security(資安,require_raw)  sec-0001 sec-0002 sec-0003   fixture 原有的三張,有考題;先備鏈 0001 → 0002 → 0003
 *     order 檔:sec-0002, sec-0003, sec-0001      ← 跟 id 順序不同;第一張 sec-0002 有一個沒學的先備(sec-0001)
 *   language(語言)              lang-0001 … lang-0004
 *     order 檔:lang-0003, lang-0001, lang-0004, lang-0002   ← 跟 id 順序不同
 *     先備:lang-0003 要先有 lang-0001、lang-0002(兩個先備)
 *   network(網路)               net-0001 net-0002 net-0003   沒有 order 檔(退回 id 順序)
 *
 * 一開始 `state/reviews.json` 是 `{}`:什麼都沒學。`log.jsonl` 是空的。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp,見 review-session-harness.ts),不碰真的 learning/。
 *
 * 側車回應的形狀(T37 定,四個教學卡動作都一樣;測試與實作都照這份):
 *
 *   result = {
 *     category: string,                                  // 目前的類別 id
 *     categories: { id, name, remaining, requireRaw }[],  // 設定檔順序;remaining = 該類別磁碟上有、不在 reviews.json 的卡數
 *     card: { id, path, title } | null,                  // 目前顯示的那張;path 是 learning/ 裡的相對路徑(cards/<類別>/<id>.md);類別學完 = null
 *     prereqs: { id, title }[],                          // 目前那張「沒學」的先備,照卡片 frontmatter 的 prereqs 順序;沒有或 card 是 null = []
 *   }
 *
 * `teach.prereq` 的 `index` 是 `prereqs` 陣列的位置(從 0 起算)。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVault, ledgerEvents, readReviews, removeVault, reviewsPath, seedDue, TODAY, writeReviews, type ReviewRecord, type Vault } from './review-session-harness.js';

export { TODAY, ledgerEvents, readReviews, removeVault, reviewsPath, seedDue, writeReviews };
export type { ReviewRecord, Vault };

export const TOMORROW = '2026-09-11';

export interface CategoryRow {
  id: string;
  name: string;
  remaining: number;
  requireRaw: boolean;
}
export interface CardRef {
  id: string;
  path: string;
  title: string;
}
export interface TeachView {
  category: string;
  categories: CategoryRow[];
  card: CardRef | null;
  prereqs: { id: string; title: string }[];
}

export const CATEGORY_IDS = ['security', 'language', 'network'] as const;
export const SECURITY_ORDER = ['sec-0002', 'sec-0003', 'sec-0001'];
export const SECURITY_ID_ORDER = ['sec-0001', 'sec-0002', 'sec-0003'];
export const LANGUAGE_ORDER = ['lang-0003', 'lang-0001', 'lang-0004', 'lang-0002'];
export const LANGUAGE_ID_ORDER = ['lang-0001', 'lang-0002', 'lang-0003', 'lang-0004'];
export const NETWORK_ID_ORDER = ['net-0001', 'net-0002', 'net-0003'];

export const NAMES: Record<string, string> = { security: '資安', language: '語言', network: '網路' };
export const TITLES: Record<string, string> = {
  'lang-0001': '詞類',
  'lang-0002': '時態',
  'lang-0003': '語態',
  'lang-0004': '語氣',
  'net-0001': '封包',
  'net-0002': '路由',
  'net-0003': '埠號',
};

export interface TeachVaultOpts {
  /** 不寫這些類別的 order 檔(預設只有 network 沒有) */
  noOrder?: string[];
  /** 一開始就在 reviews.json 裡的卡(已經學過):stage 1,學過日 2026-09-01,今天到期 */
  learned?: string[];
  /** 額外的磁碟上有、但 order 檔沒列的 language 卡(id 照序,先備無) */
  extraLanguage?: string[];
  /** order 檔裡多列的磁碟上沒有的 id(附在 language 的 order 檔裡) */
  ghostInOrder?: string[];
  /** 設定檔只有這幾個類別(順序照這個);預設三個 */
  categories?: string[];
}

export function cardFile(id: string, category: string, title: string, prereqs: string[]): string {
  return [
    '---',
    `id: ${id}`,
    `category: ${category}`,
    `title: ${title}`,
    'level: 0',
    'source: raw',
    'source_ref: raw/security/web-basics.md#L1-L5',
    'created: 2026-09-01',
    `prereqs: [${prereqs.join(', ')}]`,
    '---',
    `${title}的內文。`,
    '',
  ].join('\n');
}

export function writeCardFile(vault: Vault, id: string, category: string, title: string, prereqs: string[]): void {
  mkdirSync(join(vault.dir, 'cards', category), { recursive: true });
  writeFileSync(join(vault.dir, 'cards', category, `${id}.md`), cardFile(id, category, title, prereqs), 'utf8');
}

export function writeOrder(vault: Vault, category: string, ids: string[]): void {
  mkdirSync(join(vault.dir, 'graph'), { recursive: true });
  writeFileSync(join(vault.dir, 'graph', `order-${category}.json`), `${JSON.stringify(ids)}\n`, 'utf8');
}

export function removeOrder(vault: Vault, category: string): void {
  rmSync(join(vault.dir, 'graph', `order-${category}.json`), { force: true });
}

/** 從磁碟上的卡片檔讀 title(security 三張是 fixture 原有的)。 */
export function titleOf(vault: Vault, id: string): string {
  const category = id.startsWith('sec-') ? 'security' : id.startsWith('lang-') ? 'language' : 'network';
  const text = readFileSync(join(vault.dir, 'cards', category, `${id}.md`), 'utf8');
  const m = /^title: (.+)$/m.exec(text);
  if (!m) throw new Error(`${id} 沒有 title`);
  return m[1]!.trim();
}

export function cardPathOf(id: string): string {
  const category = id.startsWith('sec-') ? 'security' : id.startsWith('lang-') ? 'language' : 'network';
  return `cards/${category}/${id}.md`;
}

export function createTeachVault(opts: TeachVaultOpts = {}): Vault {
  const vault = createVault({ cards: 3 });
  const cats = opts.categories ?? [...CATEGORY_IDS];
  const yaml = cats.map((c) => `- id: ${c}\n  name: ${NAMES[c]}\n  require_raw: ${c === 'security' ? 'true' : 'false'}\n`).join('');
  writeFileSync(join(vault.dir, 'config/categories.yaml'), yaml, 'utf8');

  const lang = [...LANGUAGE_ID_ORDER, ...(opts.extraLanguage ?? [])];
  for (const id of lang) {
    const prereqs = id === 'lang-0003' ? ['lang-0001', 'lang-0002'] : [];
    writeCardFile(vault, id, 'language', TITLES[id] ?? `語言 ${id}`, prereqs);
  }
  for (const id of NETWORK_ID_ORDER) writeCardFile(vault, id, 'network', TITLES[id]!, []);

  writeOrder(vault, 'security', SECURITY_ORDER);
  writeOrder(vault, 'language', [...LANGUAGE_ORDER, ...(opts.ghostInOrder ?? [])]);
  removeOrder(vault, 'network');
  for (const c of opts.noOrder ?? []) removeOrder(vault, c);

  writeReviews(vault, {});
  writeFileSync(join(vault.dir, 'state/log.jsonl'), '', 'utf8');
  if (opts.learned && opts.learned.length > 0) seedDue(vault, opts.learned, opts.learned.map(() => 0), TODAY);
  return vault;
}

// ---------------------------------------------------------------- 觀測

export function reviewsText(vault: Vault): string {
  return readFileSync(reviewsPath(vault), 'utf8');
}

export function logText(vault: Vault): string {
  const path = join(vault.dir, 'state/log.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function learnedEvents(vault: Vault): Record<string, unknown>[] {
  return ledgerEvents(vault).filter((e) => e['type'] === 'learned');
}

export function warningEvents(vault: Vault): Record<string, unknown>[] {
  return ledgerEvents(vault).filter((e) => e['type'] === 'warning');
}

/** 一張剛學過的卡在 reviews.json 該有的樣子(stage 1、今天學、明天到期、沒有歷史)。 */
export function freshLearned(learnedAt: string = TODAY, nextDue: string = TOMORROW): ReviewRecord {
  return { stage: 1, learned_at: learnedAt, next_due: nextDue, fails_in_row: 0, total_fails: 0, stuck: false, history: [] };
}

export function requestLine(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, id, method, params });
}

export { removeVault as cleanupTeachVault };
export function reviewsOf(vault: Vault): Record<string, ReviewRecord> {
  return readReviews(vault);
}
