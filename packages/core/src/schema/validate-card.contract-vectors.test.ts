/**
 * T51 → T57:契約 §2 的字數向量(兩張表每一列、四反引號各種寫法)原本寫在這裡,T57 起全部住在
 * `contracts/fixtures/word-count-vectors.json`,由 `features/support/word-count-vectors.test.ts` 讓每一份實作跑每一列
 * (舊條目與向量列的對照:`docs/reviews/T57-old-vectors-map.md`)。留下來的只有「不是向量」的一條:fixture 是一張合法的卡。
 * 測試 agent 寫;開發 worker 不改。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCard } from './validate-card.js';

const ROOT = join(import.meta.dirname, '../../../..');

describe('fixture valid-example-with-nested-content.md 是合法的卡', () => {
  it('validateCard:errors 空、ok(字數與 examples 由向量檔那一列管)', () => {
    const r = validateCard(readFileSync(join(ROOT, 'contracts/fixtures/cards/valid-example-with-nested-content.md'), 'utf8'));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
