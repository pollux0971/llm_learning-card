import { describe, it, expect } from 'vitest';
import { createDeck, currentCardId, pressNext, isFinished } from './deck.js';

describe('deck', () => {
  it('starts on the first card', () => {
    const deck = createDeck(['a', 'b', 'c']);
    expect(currentCardId(deck)).toBe('a');
    expect(isFinished(deck)).toBe(false);
  });

  it('an empty order is immediately finished', () => {
    const deck = createDeck([]);
    expect(currentCardId(deck)).toBeNull();
    expect(isFinished(deck)).toBe(true);
  });

  it('pressNext marks the current card learned and advances', () => {
    const deck = createDeck(['a', 'b', 'c']);
    pressNext(deck);
    expect(deck.learned.has('a')).toBe(true);
    expect(currentCardId(deck)).toBe('b');
  });

  it('pressNext on the last card finishes the deck', () => {
    const deck = createDeck(['a']);
    pressNext(deck);
    expect(deck.learned.has('a')).toBe(true);
    expect(currentCardId(deck)).toBeNull();
    expect(isFinished(deck)).toBe(true);
  });

  it('pressNext on a finished deck does nothing', () => {
    const deck = createDeck(['a']);
    pressNext(deck);
    pressNext(deck);
    expect(deck.learned.size).toBe(1);
    expect(currentCardId(deck)).toBeNull();
  });

  it('merely displaying a card does not mark it learned', () => {
    const deck = createDeck(['a', 'b']);
    void currentCardId(deck);
    expect(deck.learned.has('a')).toBe(false);
  });

  it('skips over cards already marked learned when advancing', () => {
    const deck = createDeck(['a', 'b', 'c']);
    deck.learned.add('b');
    pressNext(deck);
    expect(currentCardId(deck)).toBe('c');
  });
});
