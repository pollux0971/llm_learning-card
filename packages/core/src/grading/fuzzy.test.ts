import { describe, expect, it } from 'vitest';
import { matchFuzzy } from './fuzzy.js';

describe('matchFuzzy', () => {
  it('matches one character of slack on a long enough answer', () => {
    expect(matchFuzzy(['protocol'], 'protocl')).toEqual({ matched: true, used: true });
  });

  it('does not match two characters of difference', () => {
    expect(matchFuzzy(['protocol'], 'protcl')).toEqual({ matched: false, used: true });
  });

  it('matches an exact-length identical string too (distance 0)', () => {
    expect(matchFuzzy(['protocol'], 'protocol')).toEqual({ matched: true, used: true });
  });

  it('skips answers shorter than the minimum length', () => {
    expect(matchFuzzy(['埠號'], '埠')).toEqual({ matched: false, used: false });
  });

  it('is used when at least one candidate is long enough, even if others are short', () => {
    expect(matchFuzzy(['no', 'protocol'], 'protocl')).toEqual({ matched: true, used: true });
  });

  it('reports used but unmatched when the long candidate does not match', () => {
    expect(matchFuzzy(['no', 'completely-different'], 'protocl')).toEqual({ matched: false, used: true });
  });

  it('treats a 4-character answer as long enough to use the layer', () => {
    expect(matchFuzzy(['abcd'], 'abcx')).toEqual({ matched: true, used: true });
  });

  it('treats a 3-character answer as too short to use the layer', () => {
    expect(matchFuzzy(['abc'], 'abx')).toEqual({ matched: false, used: false });
  });
});
