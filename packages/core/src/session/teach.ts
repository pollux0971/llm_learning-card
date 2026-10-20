/**
 * 教學卡的四個動作(ADR-077,顧問 B-lite)。碰檔案的處理放這裡(歸 11):
 * 重讀 → 寫入、考試卡基準、learned 與 warning。純排法在 teach/deck.ts。
 * 讀 order 檔走 schema/graph.ts 的 readOrderFile。
 */
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { CategorySchema, type CardId, type Review } from '@contracts/index.js';
import { readOrderFile } from '../schema/graph.js';
import { recordEvent } from '../schema/log.js';
import { parseCardText } from '../schema/parse-card.js';
import { listCardIds } from '../schema/validate-question.js';
import { applyLearnedTransition } from '../scheduler/transitions.js';
import { nextUnlearned, orderDeck, remainingCount, unlearnedPrereqs } from '../teach/deck.js';
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
}

export type TeachOutcome = { ok: true; view: TeachView } | { ok: false; kind: 'bad-request' | 'teach-record-changed' };

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
  return { title, prereqs };
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
} {
  const { learningDir } = host;
  let category: string | undefined;
  let cardId: string | undefined;
  const warned = new Set<string>();

  function allIds(): Set<string> {
    return new Set(listCardIds(learningDir));
  }

  function deckOf(cat: string, reviews: Record<string, unknown>, ids: ReadonlySet<string>): string[] {
    const onDisk = cardsInCategory(learningDir, cat, ids);
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

  function buildView(reviews: Record<string, Review>, ids: ReadonlySet<string>): TeachView {
    const cats = loadCategories(learningDir);
    const current = category ?? cats[0]?.id ?? '';
    const categories: TeachCategoryRow[] = cats.map((cat) => ({
      id: cat.id,
      name: cat.name,
      remaining: remainingCount(cardsInCategory(learningDir, cat.id, ids), reviews),
      requireRaw: cat.requireRaw,
    }));
    if (cardId === undefined) {
      return { category: current, categories, card: null, prereqs: [] };
    }
    const meta = readMeta(learningDir, cardId);
    const prereqIds = unlearnedPrereqs(meta.prereqs, reviews, [...ids]);
    return {
      category: current,
      categories,
      card: cardRef(learningDir, cardId),
      prereqs: prereqIds.map((id) => ({ id, title: readMeta(learningDir, id).title })),
    };
  }

  /**
   * 把目前顯示的那張標成學過。已經在 reviews 裡就不寫。
   * 衝突重試一次;還是不過就不改目前卡。
   */
  function recordCurrent(): 'ok' | 'conflict' | 'none' {
    if (cardId === undefined) return 'none';
    const id = cardId;
    const learnedAt = host.today();
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const snap = readReviewsSnapshot(learningDir);
      if (Object.prototype.hasOwnProperty.call(snap.reviews, id)) return 'ok';
      const nextReviews: Record<CardId, Review> = {
        ...snap.reviews,
        [id]: applyLearnedTransition({ card: id, learnedAt }) as unknown as Review,
      };
      try {
        const newHash = saveReviewsIfUnchanged(learningDir, nextReviews, snap.hash);
        const exam = host.examSession();
        if (exam && exam.reviewsHash === snap.hash) exam.reviewsHash = newHash;
        const logPath = join(learningDir, 'state/log.jsonl');
        mkdirSync(dirname(logPath), { recursive: true });
        recordEvent(logPath, { ts: new Date().toISOString(), type: 'learned', card: id });
        return 'ok';
      } catch (err) {
        if (!isReviewsChanged(err)) throw err;
      }
    }
    return 'conflict';
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
      const picked = requested !== undefined && cats.some((cat) => cat.id === requested) ? requested : cats[0]!.id;
      return showCategory(picked);
    },

    next(): TeachOutcome {
      if (category === undefined) return { ok: false, kind: 'bad-request' };
      const recorded = recordCurrent();
      if (recorded === 'conflict') return { ok: false, kind: 'teach-record-changed' };
      return showCategory(category);
    },

    switchTo(nextCategory: string): TeachOutcome {
      const cats = loadCategories(learningDir);
      if (!cats.some((cat) => cat.id === nextCategory)) return { ok: false, kind: 'bad-request' };
      const recorded = recordCurrent();
      if (recorded === 'conflict') return { ok: false, kind: 'teach-record-changed' };
      return showCategory(nextCategory);
    },

    prereq(index: number): TeachOutcome {
      if (category === undefined || cardId === undefined) return { ok: false, kind: 'bad-request' };
      const ids = allIds();
      const reviews = readReviewsSnapshot(learningDir).reviews;
      const prereqs = unlearnedPrereqs(readMeta(learningDir, cardId).prereqs, reviews, [...ids]);
      if (!Number.isInteger(index) || index < 0 || index >= prereqs.length) return { ok: false, kind: 'bad-request' };
      const picked = prereqs[index];
      if (picked === undefined) return { ok: false, kind: 'bad-request' };
      cardId = picked;
      return { ok: true, view: buildView(reviews, ids) };
    },
  };
}
