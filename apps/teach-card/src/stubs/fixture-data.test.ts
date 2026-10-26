import { describe, it, expect } from 'vitest';
import { ORDER, CATEGORY, cardPath, createFixtureFs } from './fixture-data.js';

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
});
