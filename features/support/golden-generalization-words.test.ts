/**
 * T18 (d2):手寫的化學泛化 L0 卡,每張 body ≤ 100 字(契約 §2),用 validateCard 同一條路算
 * (`countWords(parseCardText(...).body)`,同 `packages/core/src/ingest/generate-cards.ts` 的 `bodyWordCount`)。
 *
 * 為什麼放這裡:fixture 屬 12-prompt-quality,字數規則屬 01-data-layer,12 → 01 沒有開例外;
 * features/support/ 是 glue(boundaries.owners.json 標 steps),本來就能跨。
 * fixture 的 sha256 釘在 `packages/core/src/prompt-quality/golden-sets/registry-t18.test.ts`。
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_BODY_WORD_LIMIT } from '../../packages/contracts/src/index.js';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { validateCard } from '../../packages/core/src/schema/validate-card.js';
import { countWords } from '../../packages/core/src/schema/word-count.js';

const DIR = resolve(import.meta.dirname, '../../packages/core/src/prompt-quality/fixtures/golden-generalization/ingest.cards');

type Raw = { title: string; body: string };
const cardsOf = (key: string): Raw[] =>
  JSON.parse((JSON.parse(readFileSync(join(DIR, `cards-gen-${key}.output.json`), 'utf8')) as { text: string }).text) as Raw[];

describe('T18 (d2):化學泛化 L0 卡的字數(§2)', () => {
  it.each(['acid-base', 'buffer', 'titration'])('cards-gen-%s:每張 body ≤ 100 字,跟 validateCard 算的一樣', (key) => {
    const cards = cardsOf(key);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      const raw = `---\n---\n\n${c.body.trim()}\n`;
      const words = countWords(parseCardText(raw).body);
      expect(words, `${key} ${c.title}`).toBeLessThanOrEqual(CARD_BODY_WORD_LIMIT);
      expect(words, `${key} ${c.title}:跟 validateCard 不同路`).toBe(validateCard(raw).bodyWordCount);
      expect(words, `${key} ${c.title}:0 字代表讀錯欄位`).toBeGreaterThan(0);
    }
  });
});
