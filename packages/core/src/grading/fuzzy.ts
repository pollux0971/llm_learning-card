import { distance } from 'fastest-levenshtein';

/**
 * 第二層:編輯距離。太短的答案不用這層——短答案差一個字通常就是別的意思
 * (中文尤其明顯),寧可交給第三層的語意判斷,見 FEATURE.md「開放問題」。
 */
const MIN_LENGTH_FOR_FUZZY = 4;
const MAX_DISTANCE = 1;

export interface FuzzyMatch {
  matched: boolean;
  /** 這層有沒有真的被拿來比對(至少一個候選答案長度足夠) */
  used: boolean;
}

/** 輸入必須已經正規化(見 normalize.ts) */
export function matchFuzzy(normalizedAccepted: string[], normalizedInput: string): FuzzyMatch {
  let used = false;
  for (const accepted of normalizedAccepted) {
    if (accepted.length < MIN_LENGTH_FOR_FUZZY) continue;
    used = true;
    if (distance(accepted, normalizedInput) <= MAX_DISTANCE) return { matched: true, used: true };
  }
  return { matched: false, used };
}
