/**
 * 教學卡 deck 的純函式(ADR-077 第 2 點,顧問 B-lite)。
 * 輸入就是參數。不 import session/、schema、node:。
 * 讀 order 檔在 schema/graph.ts 的 readOrderFile。
 */

/** order 檔的卡照 order 檔排(磁碟上沒有的略過);其餘排在後面、照 id。沒有 order 檔(undefined)全部照 id。 */
export function orderDeck(order: readonly string[] | undefined, onDisk: readonly string[]): string[] {
  if (order === undefined) return [...onDisk].sort();
  const disk = new Set(onDisk);
  const used = new Set<string>();
  const head: string[] = [];
  for (const id of order) {
    if (!disk.has(id) || used.has(id)) continue;
    used.add(id);
    head.push(id);
  }
  const tail = onDisk.filter((id) => !used.has(id)).sort();
  return [...head, ...tail];
}

/** deck 裡第一張不在 reviews 的卡。全學過或空 deck 是 undefined。 */
export function nextUnlearned(deck: readonly string[], reviews: Record<string, unknown>): string | undefined {
  for (const id of deck) {
    if (!Object.prototype.hasOwnProperty.call(reviews, id)) return id;
  }
  return undefined;
}

/** deck 裡不在 reviews 的卡數。 */
export function remainingCount(deck: readonly string[], reviews: Record<string, unknown>): number {
  let n = 0;
  for (const id of deck) {
    if (!Object.prototype.hasOwnProperty.call(reviews, id)) n += 1;
  }
  return n;
}

/** 主流程只排 level 0、1(ADR-079 D5)。level 2 以上只從深入進去。 */
export function isMainFlowLevel(level: number): boolean {
  return level === 0 || level === 1;
}

/** 契約 §1 的 Level 上限。目前那張是這一層,深入回 deepen-floor,不打模型。 */
export const DEEPEN_FLOOR_LEVEL = 4;

export function atDeepenFloor(level: number): boolean {
  return level >= DEEPEN_FLOOR_LEVEL;
}

/** 同分類裡 parent 是這張的卡,照 id 排。學過的也算。 */
export function childIdsOf(cards: readonly { id: string; parent?: string }[], parentId: string): string[] {
  const ids: string[] = [];
  for (const card of cards) {
    if (card.parent === parentId) ids.push(card.id);
  }
  ids.sort();
  return ids;
}

/** 先備提示不列這些 id(麵包屑上的父卡:你剛從它下來)。順序保留。 */
export function omitIds(ids: readonly string[], omit: readonly string[]): string[] {
  const skip = new Set(omit);
  return ids.filter((id) => !skip.has(id));
}

export interface CrumbState {
  parentId: string;
  childIds: readonly string[];
  index: number;
}

export interface AdvancePlan {
  /** 這一步要記學過的卡,順序是目前這張、再往上的父卡。 */
  record: string[];
  crumbs: { parentId: string; childIds: string[]; index: number }[];
  /** undefined:回到主流程,由呼叫端照 phase-2 的下一個挑。 */
  cardId: string | undefined;
}

/**
 * 在一組子卡裡按下一個。最後一張會把父卡也放進 record,並往上一層;
 * 那一層也是最後一張就再往上,直到有下一張兄弟,或回到主流程。
 * 不改傳入的 crumbs。
 */
export function planAdvance(currentId: string | undefined, crumbs: readonly CrumbState[]): AdvancePlan {
  const record: string[] = [];
  if (currentId !== undefined) record.push(currentId);
  const next = crumbs.map((crumb) => ({
    parentId: crumb.parentId,
    childIds: [...crumb.childIds],
    index: crumb.index,
  }));
  while (next.length > 0) {
    const top = next[next.length - 1]!;
    if (top.index + 1 < top.childIds.length) {
      top.index += 1;
      const cardId = top.childIds[top.index];
      return { record, crumbs: next, cardId };
    }
    record.push(top.parentId);
    next.pop();
  }
  return { record, crumbs: [], cardId: undefined };
}

/** 照 prereqs 的順序,去掉已學過的與磁碟上沒有的。 */
export function unlearnedPrereqs(
  prereqs: readonly string[],
  reviews: Record<string, unknown>,
  onDisk: readonly string[],
): string[] {
  const disk = new Set(onDisk);
  const out: string[] = [];
  for (const id of prereqs) {
    if (!disk.has(id)) continue;
    if (Object.prototype.hasOwnProperty.call(reviews, id)) continue;
    out.push(id);
  }
  return out;
}
