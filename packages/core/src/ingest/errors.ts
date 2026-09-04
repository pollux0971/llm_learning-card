/**
 * ingest 管線自己的錯誤型別。形狀比照 `packages/core/src/llm/errors.ts`:
 * 一個具名 class、`name` 設成同名字串、把診斷需要的欄位掛成唯讀屬性。
 */

/** 損壞內容摘要保留的位元組數,見 GraphFileCorruptError 的說明。 */
export const CORRUPT_HEAD_BYTES = 200;

/**
 * `graph/deps.json` 存在、但內容不是合法 JSON。
 *
 * 為什麼要有自己的名字(ADR-041):`removeCategoryGraph()` 是在
 * `analyzeDependencies()` 已經在處理另一個失敗(丟邊達上限仍有殘留循環)時才被
 * 呼叫的。`JSON.parse` 直接丟一個裸的 `SyntaxError` 出去,會讓呼叫端只看到
 * 「Unexpected token」而不知道是哪個檔、更不知道原本那筆殘留循環的 warning 根本
 * 沒機會寫出去。兩個失敗要各自有名字:圖檔都讀不出來時,「殘留環」在語意上到不了。
 *
 * 帶兩個欄位讓人不用另外開檔就能判斷:
 *   - `path`:哪一個檔壞了(絕對路徑)
 *   - `head`:檔案開頭的 `CORRUPT_HEAD_BYTES` 個**位元組**(不是字元)解成 UTF-8。
 *     夠看出是空檔、被截斷、還是被別的東西覆寫;又不會把整份可能很大的圖倒進
 *     log 或終端機。
 *
 * 這個錯誤**不**代表「檔案已經被處理掉了」——反過來,收到它的時候磁碟上那個檔
 * 一個位元組都沒被動過,刻意留給人看。
 */
export class GraphFileCorruptError extends Error {
  readonly path: string;
  readonly head: string;
  constructor(path: string, head: string, cause: Error) {
    super(`graph file corrupt: ${path} 不是合法 JSON(${cause.message});開頭 ${CORRUPT_HEAD_BYTES} 位元組:${head}`);
    this.name = 'GraphFileCorruptError';
    this.path = path;
    this.head = head;
  }
}
