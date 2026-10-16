/**
 * T12:子卡不得重述父卡 —— 字面重疊係數(ADR-043:機器抓字面、語意歸人打分)。
 *
 * 為什麼不是 Jaccard:子卡只截父卡一小段時,聯集被父卡撐大,Jaccard 遠低於 0.6,
 * 但小的那邊已經被整段包住。重疊係數 `|A∩B| / min(|A|,|B|)` 兩個方向都是 1
 * (子卡把整張父卡包進去再加料,同樣是重述)。
 *
 * 這條抓的是「逐字照抄」。改寫式的重述(基準上顧問人判的那一對只有 0.074)
 * 分不開、也不該為了抓它把門檻從 0.3 往下調——同一個門檻會多抓人判沒問題的對。
 * 「0 對」不是語意重複解決了。
 *
 * T18 的跨卡重疊(`checkGoldenSiblings`)是同一把尺、另一張網:子卡對別的 key 的
 * L0 與子卡,不比自己的 key。門檻 0.5 只抓逐字照抄;0.3–0.5 只進觀察清單,不擋。
 * 改寫式的跨主題重複(顧問點名、字面 < 0.1 的那對)抓不到,也不該為了抓它把門檻往下調。
 * 「0 對」不是語意重複解決了。真正的判斷歸顧問。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  charNgrams,
  DUPLICATE_NGRAM_SIZE,
  normalizeBody,
  normalizeTitle,
  QUALITY_NOTE,
} from './structural-checks.js';
import type { StructuralCheckResult, StructuralIssue } from './types.js';

/** >= 才算一對。剛好 0.3 要報,不要改成 >。低於 0.15 會誤報基準上人判沒問題的對。 */
export const PARENT_CHILD_OVERLAP_THRESHOLD = 0.3;

/**
 * 跨卡(別的 key)字面重疊。>= 才算一對,不要改成 >。
 * 0.3 在共用大量標頭名的主題上會誤報,所以擋的門檻是 0.5,不是 T12 的 0.3。
 */
export const CROSS_CARD_OVERLAP_THRESHOLD = 0.5;

/** >= 進觀察清單,< 門檻才留在觀察(不擋)。剛好 0.3 要進觀察,不要改成 >。 */
export const CROSS_CARD_OBSERVE_THRESHOLD = 0.3;

/** 跟 checkDuplicates 同一個 n。兩邊各算各的會讓「同一段文字」對不出來。 */
export const PARENT_CHILD_NGRAM_SIZE = DUPLICATE_NGRAM_SIZE;

export interface ParentChildCard {
  id: string;
  title: string;
  body: string;
}

export interface ParentChildPair {
  parent: string;
  child: string;
  reason: 'title' | 'body';
  /** 一律是 body 的重疊係數,reason 為 title 時也照算,不改成 1。 */
  overlap: number;
}

export interface ParentChildOverlapReport {
  parentCount: number;
  childCount: number;
  /** 依 child、再依 parent 排序。 */
  pairs: ParentChildPair[];
  /** pairs.length / childCount;沒有子卡時是 0,不是 NaN。 */
  rate: number;
}

export interface ParentChildCheckResult extends StructuralCheckResult {
  report: ParentChildOverlapReport;
}

export interface GoldenParentChildInput {
  key: string;
  report: ParentChildOverlapReport;
}

export interface GoldenParentChildResult {
  /** 依 key 排序。 */
  inputs: GoldenParentChildInput[];
  totalPairs: number;
  totalChildren: number;
  /**
   * 所有「父 × 子」對(含沒過門檻的)之中,最大的 body 重疊係數。
   * 沒有任何一對時是 0。不能從 pairs 裡取最大——基準 0 對過門檻,最高值卻不是 0。
   */
  maxOverlap: number;
}

export interface ParentChildOptions {
  threshold?: number;
  ngramSize?: number;
}

/**
 * `|A∩B| / min(|A|,|B|)`。任一邊是空集合 → 0(不是 NaN、不是 1)。
 * 分母必須是較少的那邊:只除以其中一邊,長度差很多的包含會被算矮。
 */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  const denom = a.size < b.size ? a.size : b.size;
  if (denom === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const gram of small) if (large.has(gram)) intersection += 1;
  return intersection / denom;
}

interface PreparedCard {
  id: string;
  title: string;
  grams: Set<string>;
}

function prepare(cards: ParentChildCard[], ngramSize: number): PreparedCard[] {
  return cards.map((card) => ({
    id: card.id,
    title: normalizeTitle(card.title),
    grams: charNgrams(normalizeBody(card.body), ngramSize),
  }));
}

export function checkParentChildOverlap(
  parents: ParentChildCard[],
  children: ParentChildCard[],
  opts: ParentChildOptions = {},
): ParentChildOverlapReport {
  const threshold = opts.threshold ?? PARENT_CHILD_OVERLAP_THRESHOLD;
  const ngramSize = opts.ngramSize ?? PARENT_CHILD_NGRAM_SIZE;
  const preparedParents = prepare(parents, ngramSize);
  const preparedChildren = prepare(children, ngramSize);

  const pairs: ParentChildPair[] = [];
  // 只比父 × 子。子與子、父與父是 checkDuplicates 的事,混進來會誤報同層重複。
  for (const child of preparedChildren) {
    for (const parent of preparedParents) {
      const overlap = overlapCoefficient(parent.grams, child.grams);
      // 兩邊都沒標題時,空字串撞空字串不是「標題相同」。
      const sameTitle = parent.title.length > 0 && parent.title === child.title;
      if (!sameTitle && overlap < threshold) continue;
      pairs.push({
        parent: parent.id,
        child: child.id,
        reason: sameTitle ? 'title' : 'body',
        overlap,
      });
    }
  }

  pairs.sort((p, q) =>
    p.child === q.child ? (p.parent < q.parent ? -1 : p.parent > q.parent ? 1 : 0) : p.child < q.child ? -1 : 1,
  );

  return {
    parentCount: parents.length,
    childCount: children.length,
    pairs,
    rate: children.length === 0 ? 0 : pairs.length / children.length,
  };
}

export function runParentChildChecks(
  parents: ParentChildCard[],
  children: ParentChildCard[],
  opts: ParentChildOptions = {},
): ParentChildCheckResult {
  const report = checkParentChildOverlap(parents, children, opts);
  const issues: StructuralIssue[] = report.pairs.map((pair) => ({
    kind: 'parent-child-overlap',
    detail: `${pair.child} 重述父卡 ${pair.parent}(依${pair.reason === 'title' ? '標題' : 'body 重疊係數'},${pair.overlap.toFixed(3)})`,
  }));
  return { issues, note: QUALITY_NOTE, report };
}

const OUTPUT_SUFFIX = '.output.json';

function keyOf(id: string): string {
  const dash = id.indexOf('-');
  if (dash <= 0 || dash === id.length - 1) {
    throw new Error(`無法從 id 取出配對 key:${id}`);
  }
  return id.slice(dash + 1);
}

function parseCards(text: unknown, fileId: string): { title: string; body: string }[] {
  let parsed: unknown = text;
  if (typeof text === 'string') {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${fileId} 的 text 不是 JSON 陣列`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fileId} 的 text 不是 JSON 陣列`);
  }
  return parsed.map((item) => {
    if (item === null || typeof item !== 'object' || typeof (item as { body?: unknown }).body !== 'string') {
      throw new Error(`${fileId} 的 text 不是帶 body 的卡陣列`);
    }
    const obj = item as { title?: unknown; body: string };
    return { title: typeof obj.title === 'string' ? obj.title : '', body: obj.body };
  });
}

function loadSide(dir: string): Map<string, { title: string; body: string }[]> {
  if (!existsSync(dir)) {
    throw new Error(`目錄不存在:${dir}`);
  }
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) {
      throw new Error(`不是目錄:${dir}`);
    }
    entries = readdirSync(dir);
  } catch (e) {
    if (e instanceof Error && (e.message.startsWith('目錄不存在:') || e.message.startsWith('不是目錄:'))) throw e;
    throw new Error(`無法讀取目錄:${dir}`);
  }
  const files = entries.filter((name) => name.endsWith(OUTPUT_SUFFIX)).sort();
  // 0 個 output 是紅,方向是「路徑打錯」,不是「很乾淨、0 對」。
  if (files.length === 0) {
    throw new Error(`目錄裡沒有任何 *.output.json:${dir}`);
  }
  const byKey = new Map<string, { title: string; body: string }[]>();
  for (const name of files) {
    const fileId = name.slice(0, -OUTPUT_SUFFIX.length);
    let envelope: unknown;
    try {
      envelope = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      throw new Error(`${fileId} 的 text 不是 JSON 陣列`);
    }
    if (envelope === null || typeof envelope !== 'object') {
      throw new Error(`${fileId} 的 text 不是 JSON 陣列`);
    }
    const rec = envelope as { id?: unknown; text?: unknown };
    const id = typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : fileId;
    const key = keyOf(id);
    if (byKey.has(key)) {
      throw new Error(`key「${key}」在同一邊出現兩次(${id})`);
    }
    byKey.set(key, parseCards(rec.text, fileId));
  }
  return byKey;
}

function maxBodyOverlap(
  parents: { title: string; body: string }[],
  children: { title: string; body: string }[],
  ngramSize: number,
): number {
  if (parents.length === 0 || children.length === 0) return 0;
  const parentGrams = parents.map((card) => charNgrams(normalizeBody(card.body), ngramSize));
  const childGrams = children.map((card) => charNgrams(normalizeBody(card.body), ngramSize));
  let max = 0;
  for (const parent of parentGrams) {
    for (const child of childGrams) {
      const overlap = overlapCoefficient(parent, child);
      if (overlap > max) max = overlap;
    }
  }
  return max;
}

export function checkGoldenParentChild(args: {
  childrenDir: string;
  parentsDir: string;
  opts?: ParentChildOptions;
}): GoldenParentChildResult {
  const parentsByKey = loadSide(args.parentsDir);
  const childrenByKey = loadSide(args.childrenDir);
  const onlyParents = [...parentsByKey.keys()].filter((key) => !childrenByKey.has(key));
  const onlyChildren = [...childrenByKey.keys()].filter((key) => !parentsByKey.has(key));
  const missing = [...onlyParents, ...onlyChildren].sort();
  if (missing.length > 0) {
    throw new Error(`key 只在一邊有:${missing.join(', ')}`);
  }

  const ngramSize = args.opts?.ngramSize ?? PARENT_CHILD_NGRAM_SIZE;
  const keys = [...parentsByKey.keys()].sort();
  let totalPairs = 0;
  let totalChildren = 0;
  let maxOverlap = 0;
  const inputs: GoldenParentChildInput[] = keys.map((key) => {
    const parentBodies = parentsByKey.get(key) ?? [];
    const childBodies = childrenByKey.get(key) ?? [];
    const parents = parentBodies.map((card, i) => ({ id: `p${i}`, title: card.title, body: card.body }));
    const children = childBodies.map((card, i) => ({ id: `c${i}`, title: card.title, body: card.body }));
    const report = args.opts
      ? checkParentChildOverlap(parents, children, args.opts)
      : checkParentChildOverlap(parents, children);
    totalPairs += report.pairs.length;
    totalChildren += report.childCount;
    const localMax = maxBodyOverlap(parentBodies, childBodies, ngramSize);
    if (localMax > maxOverlap) maxOverlap = localMax;
    return { key, report };
  });

  return { inputs, totalPairs, totalChildren, maxOverlap };
}

export interface SiblingSide {
  key: string;
  kind: 'L0' | 'child';
  /** 在那個 output 檔陣列裡的位置(0 起)。 */
  index: number;
  title: string;
}

/** child 一定是子卡。兩邊都是子卡時,child 是 `${key}#${index}` 字典序較小的那張。 */
export interface SiblingPair {
  child: SiblingSide;
  other: SiblingSide;
  overlap: number;
}

export interface GoldenSiblingsResult {
  /** 重疊 >= 門檻(預設 0.5)。 */
  pairs: SiblingPair[];
  /** 0.3 <= 重疊 < 門檻。只列,不擋。 */
  observe: SiblingPair[];
  /** 實際比過的不重複對(含沒過門檻的)。不是 pairs.length。 */
  totalPairsChecked: number;
  /** 所有比過的對之中最大的重疊。沒有任何一對時是 0。不能從 pairs / observe 裡取。 */
  maxOverlap: number;
}

interface PreparedSide {
  key: string;
  kind: 'L0' | 'child';
  index: number;
  title: string;
  grams: Set<string>;
}

function prepareSide(
  byKey: Map<string, { title: string; body: string }[]>,
  kind: 'L0' | 'child',
  ngramSize: number,
): PreparedSide[] {
  const out: PreparedSide[] = [];
  for (const [key, cards] of byKey) {
    cards.forEach((card, index) => {
      out.push({
        key,
        kind,
        index,
        title: card.title,
        grams: charNgrams(normalizeBody(card.body), ngramSize),
      });
    });
  }
  return out;
}

function sideOf(card: PreparedSide): SiblingSide {
  return { key: card.key, kind: card.kind, index: card.index, title: card.title };
}

function childChildOrder(a: PreparedSide, b: PreparedSide): [PreparedSide, PreparedSide] {
  const aId = `${a.key}#${a.index}`;
  const bId = `${b.key}#${b.index}`;
  return aId < bId ? [a, b] : [b, a];
}

/**
 * 子卡對**別的 key** 的 L0 與子卡。不比自己的 key(那是 `--overlap`);
 * 同一個 key 的子卡彼此不比(那是 `checkDuplicates`)。A↔B 只算一次。
 *
 * `opts.threshold` 改的是 pairs 的門檻;observe 固定是 0.3 <= 重疊 < 門檻。
 * 兩邊 key 集合不同、目錄不存在、沒有 output 檔:跟 `--overlap` 同一句錯。
 */
export function checkGoldenSiblings(args: {
  childrenDir: string;
  cardsDir: string;
  opts?: ParentChildOptions;
}): GoldenSiblingsResult {
  const cardsByKey = loadSide(args.cardsDir);
  const childrenByKey = loadSide(args.childrenDir);
  const onlyCards = [...cardsByKey.keys()].filter((key) => !childrenByKey.has(key));
  const onlyChildren = [...childrenByKey.keys()].filter((key) => !cardsByKey.has(key));
  const missing = [...onlyCards, ...onlyChildren].sort();
  if (missing.length > 0) {
    throw new Error(`key 只在一邊有:${missing.join(', ')}`);
  }

  const threshold = args.opts?.threshold ?? CROSS_CARD_OVERLAP_THRESHOLD;
  const ngramSize = args.opts?.ngramSize ?? PARENT_CHILD_NGRAM_SIZE;
  const l0 = prepareSide(cardsByKey, 'L0', ngramSize);
  const children = prepareSide(childrenByKey, 'child', ngramSize);

  const pairs: SiblingPair[] = [];
  const observe: SiblingPair[] = [];
  let totalPairsChecked = 0;
  let maxOverlap = 0;

  const record = (child: PreparedSide, other: PreparedSide): void => {
    const overlap = overlapCoefficient(child.grams, other.grams);
    totalPairsChecked += 1;
    if (overlap > maxOverlap) maxOverlap = overlap;
    const pair: SiblingPair = { child: sideOf(child), other: sideOf(other), overlap };
    if (overlap >= threshold) pairs.push(pair);
    else if (overlap >= CROSS_CARD_OBSERVE_THRESHOLD && overlap < threshold) observe.push(pair);
  };

  for (const child of children) {
    for (const other of l0) {
      if (other.key === child.key) continue;
      record(child, other);
    }
  }
  for (let i = 0; i < children.length; i += 1) {
    for (let j = i + 1; j < children.length; j += 1) {
      const a = children[i]!;
      const b = children[j]!;
      if (a.key === b.key) continue;
      const [lo, hi] = childChildOrder(a, b);
      record(lo, hi);
    }
  }

  return { pairs, observe, totalPairsChecked, maxOverlap };
}
