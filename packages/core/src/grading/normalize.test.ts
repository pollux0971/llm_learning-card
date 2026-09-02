import { describe, expect, it } from 'vitest';
import { normalize } from './normalize.js';

describe('normalize', () => {
  it('trims surrounding space', () => {
    expect(normalize(' protocol')).toBe('protocol');
  });

  it('lowercases', () => {
    expect(normalize('Protocol')).toBe('protocol');
  });

  it('folds full width latin letters', () => {
    expect(normalize('ＰＲＯＴＯＣＯＬ')).toBe('protocol');
  });

  it('removes internal full width space between CJK characters', () => {
    expect(normalize('埠　號')).toBe('埠號');
  });

  it('removes internal ascii space too', () => {
    expect(normalize('proto col')).toBe('protocol');
  });

  it('leaves an already-clean answer unchanged', () => {
    expect(normalize('scheme')).toBe('scheme');
  });

  it('normalizes an empty string to empty', () => {
    expect(normalize('')).toBe('');
  });

  it('normalizes whitespace-only input to empty', () => {
    expect(normalize('   ')).toBe('');
  });
});
