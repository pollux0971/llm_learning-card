/**
 * 合成的批次,給重複率與圖形狀檢查的正面/負面/邊界測試用。
 * 真實資料的基準在 i1-security-batch.ts;這裡是刻意造出來的、算得清楚的例子。
 *
 * 邊界字串為什麼長這樣:字母挑成 3-gram 好數。
 *   'abcdefghij'  → abc bcd cde def efg fgh ghi hij(8 個)
 *   'abcdefghxy'  → abc bcd cde def efg fgh ghx hxy(8 個,前 6 個共用)
 *                   交集 6、聯集 10 → Jaccard **剛好 0.6**
 *   'abcdefghwxy' → 9 個 gram,交集仍是 6、聯集 11 → 6/11 ≈ 0.545,差一格就在門檻下
 */
import type { BatchCard } from '../types.js';

export const BOUNDARY_BODY_A = 'abcdefghij';
/** 與 BOUNDARY_BODY_A 的 Jaccard 剛好等於 0.6 */
export const BOUNDARY_BODY_EXACTLY_AT = 'abcdefghxy';
/** 與 BOUNDARY_BODY_A 的 Jaccard 是 6/11 ≈ 0.545,剛好在門檻下 */
export const BOUNDARY_BODY_JUST_BELOW = 'abcdefghwxy';

export function batchCard(id: string, title: string, body: string, level = 0, prereqs: string[] = []): BatchCard {
  return { id, title, level, prereqs, body };
}

/** 10 張卡,刻意做出 4 對:兩對靠標題正規化、兩對靠 body 相似度。 */
export const FOUR_DUPLICATE_PAIRS: BatchCard[] = [
  batchCard('syn-0001', 'CORS 預檢請求', '這一張講的是甲主題,內容跟其他張完全沒有關係。'),
  batchCard('syn-0002', 'cors－預檢請求', '這一張講的是乙主題,寫法跟上一張差很多。'),
  batchCard('syn-0003', 'ＣＯＲＳ 憑證', '這一張講的是丙主題,用字也完全不同。'),
  batchCard('syn-0004', 'CORS憑證', '這一張講的是丁主題,同樣沒有重複。'),
  batchCard('syn-0005', '邊界甲', BOUNDARY_BODY_A),
  batchCard('syn-0006', '邊界乙', BOUNDARY_BODY_EXACTLY_AT),
  batchCard('syn-0007', '幾乎一樣甲', 'qrstuvwxyz0123456789'),
  batchCard('syn-0008', '幾乎一樣乙', 'qrstuvwxyz0123456789'),
  batchCard('syn-0009', '無關的一張', '完全不相干的正文,沒有任何一張跟它像。'),
  batchCard('syn-0010', '另一張無關的', '再一段互不相干的文字,也沒有重複對象。'),
];

/** 這 4 對就是 FOUR_DUPLICATE_PAIRS 應該算出來的清單,依 (a, b) 字典序。 */
export const FOUR_DUPLICATE_PAIRS_EXPECTED: [string, string][] = [
  ['syn-0001', 'syn-0002'],
  ['syn-0003', 'syn-0004'],
  ['syn-0005', 'syn-0006'],
  ['syn-0007', 'syn-0008'],
];

/** 完全不重複的一批。 */
export const NO_DUPLICATES: BatchCard[] = [
  batchCard('n-0001', '同源的判定', '同源由協定、主機、埠號三部分決定。'),
  batchCard('n-0002', '預檢結果快取', 'ABCDEFGHIJKLMNOP 這串跟上一張毫無交集。'),
  batchCard('n-0003', '暴露回應標頭', 'qrstuvwxyz0123 也一樣互不相干。'),
];

/** 只差大小寫、空白與標點的兩個標題。 */
export const TITLE_ONLY_DUPLICATE: BatchCard[] = [
  batchCard('t-0001', 'CORS 預檢請求', '甲的正文,跟乙完全不像。'),
  batchCard('t-0002', '「cors－預　檢請求」', 'ABCDEFGH 乙的正文。'),
];

/** L0 卡的 prereq 指向 L1 卡:圖形狀違規。 */
export const BAD_GRAPH_SHAPE: BatchCard[] = [
  batchCard('g-0001', '主卡', '主卡正文', 0, ['g-0002']),
  batchCard('g-0002', '子卡', 'ABCDEFGH 子卡正文', 1, []),
];

/** L1 卡的 prereq 指向 L0 卡:正常方向,不該報。 */
export const GOOD_GRAPH_SHAPE: BatchCard[] = [
  batchCard('g-0001', '主卡', '主卡正文', 0, []),
  batchCard('g-0002', '子卡', 'ABCDEFGH 子卡正文', 1, ['g-0001']),
];
