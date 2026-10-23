/**
 * 教學卡的四個動作(ADR-077,顧問 B-lite)。碰檔案的處理放這裡(歸 11):
 * 重讀 → 寫入、考試卡基準、learned 與 warning。純排法在 teach/deck.ts。
 * 讀 order 檔走 schema/graph.ts 的 readOrderFile。
 */
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { CategorySchema, type Card, type CardId, type CategoryId, type Review } from '@contracts/index.js';
import { readOrderFile } from '../schema/graph.js';
import { recordEvent } from '../schema/log.js';
import { parseCardText } from '../schema/parse-card.js';
import { listCardIds } from '../schema/validate-question.js';
import { applyLearnedTransition } from '../scheduler/transitions.js';
import {
  atDeepenFloor,
  childIdsOf,
  isMainFlowLevel,
  nextUnlearned,
  omitIds,
  orderDeck,
  planAdvance,
  remainingCount,
  unlearnedPrereqs,
  type CrumbState,
} from '../teach/deck.js';
import { findCardFile, readReviewsSnapshot, saveReviewsIfUnchanged } from './io.js';
import type { Session } from './types.js';

export interface TeachCategoryRow {
  id: string;
  name: string;
  remaining: number;
  requireRaw: boolean;
}

export interface TeachCardRef {
  id: string;
  path: string;
  title: string;
}

export interface TeachView {
  category: string;
  categories: TeachCategoryRow[];
  card: TeachCardRef | null;
  prereqs: { id: string; title: string }[];
  /** 麵包屑最上層(目前這組子卡)的父卡。沒有麵包屑是 null。 */
  from: { id: string; title: string } | null;
  canBack: boolean;
  /** 生成中由側車蓋掉;這裡組畫面時恆為 false。 */
  generating: boolean;
}

export type TeachOutcome = { ok: true; view: TeachView } | { ok: false; kind: 'bad-request' | 'teach-record-changed' };

export type DeepenPrep =
  | { action: 'bad-request' }
  | { action: 'floor' }
  | { action: 'reuse'; view: TeachView }
  | { action: 'generate'; parent: Card; view: TeachView };

export interface TeachHost {
  learningDir: string;
  /** 跟 session 同一個來源:handler 的 day()。沒有 start 過就每次問。 */
  today(): string;
  /** 沒有開著的考試卡 session 就回 undefined。 */
  examSession(): Session | undefined;
}

interface CategoryConfig {
  id: string;
  name: string;
  requireRaw: boolean;
}

interface CardMeta {
  title: string;
  prereqs: string[];
  level: number;
  parent?: string;
}

const WRITE_ATTEMPTS = 2;

function isReviewsChanged(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'reviews-changed';
}

function loadCategories(learningDir: string): CategoryConfig[] {
  const raw: unknown = parseYaml(readFileSync(join(learningDir, 'config/categories.yaml'), 'utf8'));
  if (!Array.isArray(raw)) return [];
  const out: CategoryConfig[] = [];
  for (const item of raw) {
    const parsed = CategorySchema.safeParse(item);
    if (!parsed.success) continue;
    out.push({ id: parsed.data.id, name: parsed.data.name, requireRaw: parsed.data.require_raw });
  }
  return out;
}

function cardsInCategory(learningDir: string, category: string, allIds: ReadonlySet<string>): string[] {
  const dir = join(learningDir, 'cards', category);
  if (!existsSync(dir)) return [];
  const ids: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name.endsWith('.short.md')) continue;
    const id = name.slice(0, -'.md'.length);
    if (allIds.has(id)) ids.push(id);
  }
  return ids;
}

function readMeta(learningDir: string, id: string): CardMeta {
  const text = readFileSync(findCardFile(learningDir, id as CardId), 'utf8');
  const fm = parseCardText(text).frontmatter;
  const title = typeof fm.title === 'string' && fm.title.length > 0 ? fm.title : id;
  const prereqs = Array.isArray(fm.prereqs) ? fm.prereqs.filter((item): item is string => typeof item === 'string') : [];
  const level = typeof fm.level === 'number' ? fm.level : 0;
  const parent = typeof fm.parent === 'string' ? fm.parent : undefined;
  return parent === undefined ? { title, prereqs, level } : { title, prereqs, level, parent };
}

function loadCard(learningDir: string, id: string): Card {
  const text = readFileSync(findCardFile(learningDir, id as CardId), 'utf8');
  const parsed = parseCardText(text);
  const fm = parsed.frontmatter;
  const meta = readMeta(learningDir, id);
  const created = typeof fm.created === 'string' ? fm.created : '2026-01-01';
  return {
    frontmatter: {
      id: id as CardId,
      category: String(fm.category) as CategoryId,
      title: meta.title,
      level: meta.level,
      source: fm.source === 'raw' ? 'raw' : 'llm',
      created,
      ...(meta.parent === undefined ? {} : { parent: meta.parent as CardId }),
      prereqs: meta.prereqs as CardId[],
      provisional: fm.provisional === true,
      stale: fm.stale === true,
      source_missing: fm.source_missing === true,
    },
    body: parsed.body,
    examples: parsed.examples,
  };
}

function cardRef(learningDir: string, id: string): TeachCardRef {
  const abs = findCardFile(learningDir, id as CardId);
  const path = relative(learningDir, abs).split('\\').join('/');
  return { id, path, title: readMeta(learningDir, id).title };
}

export function createTeachRuntime(host: TeachHost): {
  open(category: string | undefined): TeachOutcome;
  next(): TeachOutcome;
  switchTo(category: string): TeachOutcome;
  prereq(index: number): TeachOutcome;
  back(): TeachOutcome;
  prepareDeepen(): DeepenPrep;
  /** 生成寫完之後推一層麵包屑,顯示第一張新卡。 */
  enterChildren(parentId: string, childIds: readonly string[]): TeachOutcome;
  view(): TeachView;
} {
  const { learningDir } = host;
  let category: string | undefined;
  let cardId: string | undefined;
  let crumbs: CrumbState[] = [];
  const warned = new Set<string>();

  function allIds(): Set<string> {
    return new Set(listCardIds(learningDir));
  }

  function mainFlowIds(cat: string, ids: ReadonlySet<string>): string[] {
    return cardsInCategory(learningDir, cat, ids).filter((id) => isMainFlowLevel(readMeta(learningDir, id).level));
  }

  function deckOf(cat: string, reviews: Record<string, unknown>, ids: ReadonlySet<string>): string[] {
    const onDisk = mainFlowIds(cat, ids);
    const order = readOrderFile(learningDir, cat);
    if (order.kind === 'missing') {
      if (!warned.has(cat)) {
        warned.add(cat);
        const logPath = join(learningDir, 'state/log.jsonl');
        mkdirSync(dirname(logPath), { recursive: true });
        recordEvent(logPath, {
          ts: new Date().toISOString(),
          type: 'warning',
          message: `分類 ${cat} 沒有 order 檔,已改照 id 排序。建議重跑 ingest 重建 order。`,
        });
      }
      return orderDeck(undefined, onDisk);
    }
    return orderDeck(order.ids, onDisk);
  }

  function crumbParents(): string[] {
    return crumbs.map((crumb) => crumb.parentId);
  }

  function buildView(reviews: Record<string, Review>, ids: ReadonlySet<string>): TeachView {
    const cats = loadCategories(learningDir);
    const current = category ?? cats[0]?.id ?? '';
    const categories: TeachCategoryRow[] = cats.map((cat) => ({
      id: cat.id,
      name: cat.name,
      remaining: remainingCount(mainFlowIds(cat.id, ids), reviews),
      requireRaw: cat.requireRaw,
    }));
    const top = crumbs[crumbs.length - 1];
    const from = top === undefined ? null : { id: top.parentId, title: readMeta(learningDir, top.parentId).title };
    const canBack = crumbs.length > 0;
    if (cardId === undefined) {
      return { category: current, categories, card: null, prereqs: [], from, canBack, generating: false };
    }
    const meta = readMeta(learningDir, cardId);
    const prereqIds = omitIds(unlearnedPrereqs(meta.prereqs, reviews, [...ids]), crumbParents());
    return {
      category: current,
      categories,
      card: cardRef(learningDir, cardId),
      prereqs: prereqIds.map((id) => ({ id, title: readMeta(learningDir, id).title })),
      from,
      canBack,
      generating: false,
    };
  }

  function currentView(): TeachView {
    return buildView(readReviewsSnapshot(learningDir).reviews, allIds());
  }

  function shownPrereqs(): string[] {
    if (cardId === undefined) return [];
    const ids = allIds();
    const reviews = readReviewsSnapshot(learningDir).reviews;
    return omitIds(unlearnedPrereqs(readMeta(learningDir, cardId).prereqs, reviews, [...ids]), crumbParents());
  }

  /**
   * 把這幾張一起標成學過(同一次寫入)。已經在 reviews 裡的略過、不重複記 learned。
   * 衝突重試一次;還是不過就一筆都不寫。空清單是 none。
   */
  function recordIds(ids: readonly string[]): 'ok' | 'conflict' | 'none' {
    const unique: string[] = [];
    for (const id of ids) {
      if (id.length > 0 && !unique.includes(id)) unique.push(id);
    }
    if (unique.length === 0) return 'none';
    const learnedAt = host.today();
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const snap = readReviewsSnapshot(learningDir);
      const fresh = unique.filter((id) => !Object.prototype.hasOwnProperty.call(snap.reviews, id));
      if (fresh.length === 0) return 'ok';
      const nextReviews: Record<CardId, Review> = { ...snap.reviews };
      for (const id of fresh) {
        nextReviews[id as CardId] = applyLearnedTransition({ card: id as CardId, learnedAt }) as unknown as Review;
      }
      try {
        const newHash = saveReviewsIfUnchanged(learningDir, nextReviews, snap.hash);
        const exam = host.examSession();
        if (exam && exam.reviewsHash === snap.hash) exam.reviewsHash = newHash;
        const logPath = join(learningDir, 'state/log.jsonl');
        mkdirSync(dirname(logPath), { recursive: true });
        for (const id of fresh) {
          recordEvent(logPath, { ts: new Date().toISOString(), type: 'learned', card: id as CardId });
        }
        return 'ok';
      } catch (err) {
        if (!isReviewsChanged(err)) throw err;
      }
    }
    return 'conflict';
  }

  function childrenOf(parentId: string): string[] {
    if (category === undefined) return [];
    const ids = cardsInCategory(learningDir, category, allIds());
    return childIdsOf(
      ids.map((id) => {
        const parent = readMeta(learningDir, id).parent;
        return parent === undefined ? { id } : { id, parent };
      }),
      parentId,
    );
  }

  function pushCrumb(parentId: string, childIds: readonly string[]): TeachOutcome {
    const sorted = [...childIds].sort();
    const first = sorted[0];
    if (first === undefined) return { ok: false, kind: 'bad-request' };
    crumbs = [...crumbs, { parentId, childIds: sorted, index: 0 }];
    cardId = first;
    return { ok: true, view: currentView() };
  }

  function showCategory(cat: string): TeachOutcome {
    category = cat;
    const ids = allIds();
    const reviews = readReviewsSnapshot(learningDir).reviews;
    const deck = deckOf(cat, reviews, ids);
    cardId = nextUnlearned(deck, reviews);
    return { ok: true, view: buildView(reviews, ids) };
  }

  return {
    open(requested?: string): TeachOutcome {
      const cats = loadCategories(learningDir);
      if (cats.length === 0) return { ok: false, kind: 'bad-request' };
      crumbs = [];
      const picked = requested !== undefined && cats.some((cat) => cat.id === requested) ? requested : cats[0]!.id;
      return showCategory(picked);
    },

    next(): TeachOutcome {
      if (category === undefined) return { ok: false, kind: 'bad-request' };
      const plan = planAdvance(cardId, crumbs);
      if (plan.record.length > 0) {
        const recorded = recordIds(plan.record);
        if (recorded === 'conflict') return { ok: false, kind: 'teach-record-changed' };
      }
      crumbs = plan.crumbs;
      if (plan.cardId === undefined) return showCategory(category);
      cardId = plan.cardId;
      return { ok: true, view: currentView() };
    },

    switchTo(nextCategory: string): TeachOutcome {
      const cats = loadCategories(learningDir);
      if (!cats.some((cat) => cat.id === nextCategory)) return { ok: false, kind: 'bad-request' };
      if (cardId !== undefined) {
        const recorded = recordIds([cardId]);
        if (recorded === 'conflict') return { ok: false, kind: 'teach-record-changed' };
      }
      crumbs = [];
      return showCategory(nextCategory);
    },

    prereq(index: number): TeachOutcome {
      if (category === undefined || cardId === undefined) return { ok: false, kind: 'bad-request' };
      const prereqs = shownPrereqs();
      if (!Number.isInteger(index) || index < 0 || index >= prereqs.length) return { ok: false, kind: 'bad-request' };
      const picked = prereqs[index];
      if (picked === undefined) return { ok: false, kind: 'bad-request' };
      crumbs = [];
      cardId = picked;
      return { ok: true, view: currentView() };
    },

    back(): TeachOutcome {
      if (crumbs.length === 0) return { ok: false, kind: 'bad-request' };
      const top = crumbs[crumbs.length - 1];
      if (top === undefined) return { ok: false, kind: 'bad-request' };
      crumbs = crumbs.slice(0, -1);
      cardId = top.parentId;
      return { ok: true, view: currentView() };
    },

    prepareDeepen(): DeepenPrep {
      if (category === undefined || cardId === undefined) return { action: 'bad-request' };
      const meta = readMeta(learningDir, cardId);
      if (atDeepenFloor(meta.level)) return { action: 'floor' };
      const kids = childrenOf(cardId);
      if (kids.length > 0) {
        const entered = pushCrumb(cardId, kids);
        if (!entered.ok) return { action: 'bad-request' };
        return { action: 'reuse', view: entered.view };
      }
      return { action: 'generate', parent: loadCard(learningDir, cardId), view: currentView() };
    },

    enterChildren(parentId: string, childIds: readonly string[]): TeachOutcome {
      return pushCrumb(parentId, childIds);
    },

    view: currentView,
  };
}
