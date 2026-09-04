/**
 * 11-review-cli / phase-1:對 learning/ 目錄的讀寫邊界。
 *
 * 這裡集中放「碰磁碟」的部分,讓 build.ts / present.ts / answer.ts 的邏輯
 * 不用重複處理路徑組合與檔案格式。全部函式本體先 throw not implemented,
 * 邏輯留給下一輪開發 agent,但每個函式的預期行為寫在下面。
 *
 * 讀 reviews.json / questions/*.yaml / config/settings.yaml 一律用
 * @contracts 的 zod schema 驗證,不重新發明——這是 01-data-layer 已經做好的
 * 權威格式檢查。寫 reviews.json 用 01 的 writeFileAtomic
 * (硬規則 5:tmp → fsync → rename)。實作時會用到:
 *   node:fs 的 readFileSync / readdirSync / existsSync、node:path 的 join、
 *   yaml 的 parse、@contracts 的 ReviewSchema / QuestionFileSchema /
 *   SettingsSchema、@core/schema/atomic-write.js 的 writeFileAtomic。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  QuestionFileSchema,
  ReviewSchema,
  SettingsSchema,
  type CardId,
  type QuestionFile,
  type Review,
  type Settings,
} from '@contracts/index.js';
import { parseCardText } from '@core/schema/parse-card.js';
import { writeFileAtomic } from '@core/schema/atomic-write.js';

/**
 * state/reviews.json 讀成 Record<CardId, Review>。每筆值過
 * `ReviewSchema.parse`,格式錯誤時讓 zod 的錯誤直接往上丟(這是磁碟壞掉的
 * 徵兆,不該吞掉)。檔案不存在視為 `{}`(還沒有任何複習記錄)。
 */
export function loadReviews(learningDir: string): Record<CardId, Review> {
  const path = join(learningDir, 'state/reviews.json');
  if (!existsSync(path)) return {};

  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const reviews: Record<CardId, Review> = {};
  for (const [card, value] of Object.entries(raw)) {
    reviews[card] = ReviewSchema.parse(value);
  }
  return reviews;
}

/**
 * 整份覆寫 state/reviews.json(呼叫端保證傳進來的是最新的完整物件)。
 * 用 `writeFileAtomic`,不是普通的 writeFileSync——這是「幾個月的記憶資料」,
 * 見契約 §11b、CLAUDE.md 硬規則 5。
 */
export function saveReviews(learningDir: string, reviews: Record<CardId, Review>): void {
  const path = join(learningDir, 'state/reviews.json');
  writeFileAtomic(path, `${JSON.stringify(reviews, null, 2)}\n`);
}

/** config/settings.yaml,用 `SettingsSchema.parse` 驗證。phase-1 只用得到 daily_cap。 */
export function loadSettings(learningDir: string): Settings {
  const path = join(learningDir, 'config/settings.yaml');
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return SettingsSchema.parse(raw);
}

/** questions/<id>.yaml,用 `QuestionFileSchema.parse` 驗證與套預設值。 */
export function loadQuestionFile(learningDir: string, card: CardId): QuestionFile {
  const path = join(learningDir, 'questions', `${card}.yaml`);
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return QuestionFileSchema.parse(raw);
}

/**
 * 在 cards/*&#47; 底下找一張卡的檔案路徑。`opts.short` 為 true 找
 * `<id>.short.md`,否則找 `<id>.md`。找不到就丟錯——呼叫端不該對不存在的
 * 卡或不存在的縮短版發問。
 *
 * CardId 本身不含 category(reviews.json 裡沒有存這個欄位),只能掃
 * `cards/` 底下每個分類子目錄找檔名——phase-1 的規模(單一 session,最多
 * daily_cap 張)掃全部分類目錄夠快,不需要建索引。
 */
export function findCardFile(learningDir: string, card: CardId, opts: { short?: boolean } = {}): string {
  const cardsDir = join(learningDir, 'cards');
  const filename = opts.short ? `${card}.short.md` : `${card}.md`;
  if (existsSync(cardsDir)) {
    for (const category of readdirSync(cardsDir)) {
      const candidate = join(cardsDir, category, filename);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`找不到卡片檔案:${filename}(learningDir=${learningDir})`);
}

/**
 * `cards/<類別>/<id>.md` 的卡片 id 清單(排序過,不含 `.short.md`)。
 * `cards/` 不存在時回傳空陣列——「目錄不見了」與「目錄空的」對呼叫端是同一件事:
 * 這個 vault 沒有卡片。
 *
 * 為什麼需要它:`--dry-run` 以前只知道「今天有幾張到期」,而 0 張到期同時是
 * 「今天沒排到」與「卡片全部消失」的答案。基數要從磁碟數出來才分得開,
 * reviews.json 幫不上忙——真 vault 現在 25 張卡、連 reviews.json 都還沒有。
 */
export function listCardIds(learningDir: string): CardId[] {
  const cardsDir = join(learningDir, 'cards');
  if (!existsSync(cardsDir)) return [];

  const ids: CardId[] = [];
  for (const category of readdirSync(cardsDir)) {
    const categoryDir = join(cardsDir, category);
    if (!statSync(categoryDir).isDirectory()) continue;
    for (const name of readdirSync(categoryDir)) {
      if (!name.endsWith('.md') || name.endsWith('.short.md')) continue;
      ids.push(name.slice(0, -'.md'.length));
    }
  }
  return ids.sort();
}

/**
 * 讀一張卡(或縮短版)的 body 文字——不含 frontmatter、不含 example 圍欄
 * (用 `parseCardText` 的 `.body`)。reteach 呈現(「shown before the first
 * question」)與一般問答呈現都走這個函式,差別只在 `opts.short`。
 */
export function loadCardBody(learningDir: string, card: CardId, opts: { short?: boolean } = {}): string {
  const path = findCardFile(learningDir, card, opts);
  return parseCardText(readFileSync(path, 'utf8')).body;
}
