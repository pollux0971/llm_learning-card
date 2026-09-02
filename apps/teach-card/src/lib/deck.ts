/**
 * phase-1 的「一次一張、下一個」狀態機。純資料操作,不碰 fs——載入卡片內容是呼叫端的事
 * (App.svelte 用 currentCardId() 決定要讀哪個檔)。
 *
 * learned 只存在記憶體,phase-1 不落地(見 FEATURE.md「單獨執行」段:learned 不落地)。
 */

export interface DeckState {
  order: string[];
  learned: Set<string>;
  /** 指向 order 的目前位置;超出範圍(含空 deck)代表這個類別已經結束。 */
  index: number;
}

export function createDeck(order: string[]): DeckState {
  return { order: [...order], learned: new Set(), index: order.length > 0 ? 0 : -1 };
}

export function currentCardId(state: DeckState): string | null {
  if (state.index < 0 || state.index >= state.order.length) return null;
  return state.order[state.index]!;
}

export function isFinished(state: DeckState): boolean {
  return currentCardId(state) === null;
}

/** 把目前顯示的卡標成 learned,前進到下一張還沒學過的卡。空 deck 或已結束時不做事。 */
export function pressNext(state: DeckState): void {
  const id = currentCardId(state);
  if (id === null) return;
  state.learned.add(id);
  state.index += 1;
  while (state.index < state.order.length && state.learned.has(state.order[state.index]!)) {
    state.index += 1;
  }
}
