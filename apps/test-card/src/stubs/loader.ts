/**
 * 把 MemoryFs 裡的原始檔案(yaml、json 文字)組成 session.ts 要用的資料。
 * 這一層存在是為了讓「答案不落地、資料經過 LearningFs」這件事是真的,
 * 不是 fixtures.ts 裡的物件直接被 session 拿去用。
 */
import { parse as parseYaml } from 'yaml';
import type { CardId, LearningFs, QuestionFile } from '../types.js';
import type { ReviewsMap } from './scheduler.js';

export async function loadQuestions(fs: LearningFs, cards: CardId[]): Promise<Record<CardId, QuestionFile>> {
  const out: Record<CardId, QuestionFile> = {};
  for (const card of cards) {
    const raw = await fs.read(`questions/${card}.yaml`);
    out[card] = parseYaml(raw) as QuestionFile;
  }
  return out;
}

export async function loadReviews(fs: LearningFs): Promise<ReviewsMap> {
  const raw = await fs.read('state/reviews.json');
  return JSON.parse(raw) as ReviewsMap;
}

export async function loadDailyCap(fs: LearningFs): Promise<number> {
  const raw = await fs.read('config/settings.yaml');
  const settings = parseYaml(raw) as { daily_cap?: number };
  return settings.daily_cap ?? 10;
}
