/** CardId 配發:/^[a-z]{2,6}-\d{4}$/(contracts/types.md §1)。 */
import { existsSync, readdirSync } from 'node:fs';
import type { CardId, CategoryId } from './types.js';

/** 類別 → 前綴。目前用類別 id 的前三個字母,例如 "security" → "sec"。 */
export function categoryPrefix(category: CategoryId): string {
  const letters = category.toLowerCase().replace(/[^a-z]/g, '');
  return letters.slice(0, 3) || 'crd';
}

/**
 * 掃描 cardsDir 底下已存在的卡片,從最大編號之後繼續配發 count 個新 id。
 * 掃描時對編號位數寬鬆(避免漏掉),配發時固定補到 4 位數,符合契約格式。
 */
export function nextCardIds(cardsDir: string, category: CategoryId, count: number): CardId[] {
  const prefix = categoryPrefix(category);
  let max = 0;
  if (existsSync(cardsDir)) {
    const re = new RegExp(`^${prefix}-(\\d+)\\.md$`);
    for (const name of readdirSync(cardsDir)) {
      const m = re.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  const ids: CardId[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${prefix}-${String(max + i).padStart(4, '0')}`);
  }
  return ids;
}
