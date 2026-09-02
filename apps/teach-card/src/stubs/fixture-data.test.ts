import { describe, it, expect } from 'vitest';
import { ORDER, CATEGORY, cardPath, createFixtureFs } from './fixture-data.js';
import { parseCard } from '../lib/card.js';
import { wordCount } from '@learning/ui-shared';

describe('fixture-data', () => {
  it('orders the first category starting at sec-0001', () => {
    expect(ORDER[0]).toBe('sec-0001');
    expect(CATEGORY).toBe('security');
  });

  it('every card in order is readable from the fixture fs', async () => {
    const fs = createFixtureFs();
    for (const id of ORDER) {
      await expect(fs.read(cardPath(id))).resolves.toContain(`id: ${id}`);
    }
  });

  it('every fixture card body stays within the 100-word teaching-card limit (contracts/types.md §2)', async () => {
    const fs = createFixtureFs();
    for (const id of ORDER) {
      const raw = await fs.read(cardPath(id));
      const { bodyMarkdown } = parseCard(raw);
      expect(wordCount(bodyMarkdown)).toBeLessThanOrEqual(100);
    }
  });
});
