/**
 * markdown 相對連結檢查(P-28)。
 *
 * 掃 `docs/`、`features/`、`contracts/` 與根目錄的 README,
 * 檢查 markdown 裡的**相對連結**指到的檔案是不是真的存在。
 *
 * 規則:
 *   - 反引號裡提到的檔名不算連結(那是行文提及,不是連結)。fenced code block
 *     (``` 與 ~~~)與 inline code(`x`)裡的東西一律不算
 *   - 外部連結(http:// https:// mailto:)略過
 *   - 錨點只驗檔案部分:`./a.md#section` 驗 `./a.md`;純 `#section` 是同檔錨點,略過
 *   - **掃到 0 條連結也要 FAIL**:0 條跟「全部都對」的退出碼一樣是 0,
 *     那是掃描器壞了,不是文件很乾淨(同 check-boundaries / check-standalone)
 *
 * 用法:
 *   npx tsx scripts/check-doc-links.ts               # 檢查整個 repo
 *   npx tsx scripts/check-doc-links.ts --root <dir>  # 改掃別的根目錄(測試用)
 *
 * 退出碼:0 全部連結都存在;1 有壞連結,或一條連結都沒掃到。
 */

/** 要掃的目錄。根目錄的 README*.md 另外處理。 */
export const SCAN_DIRS = ['docs', 'features', 'contracts'];

/** 三支掃描器共用的那句話。0 個東西的紅,方向永遠是「掃描器壞了」。 */
export const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

export interface BrokenLink {
  /** repo 相對路徑 */
  file: string;
  line: number;
  /** 原文寫的目標,含錨點 */
  target: string;
}

export interface DocLinkResult {
  /** 掃到的 markdown 檔數 */
  files: number;
  /** 掃到的相對連結條數(外部連結與純錨點不算) */
  links: number;
  broken: BrokenLink[];
}

/**
 * 把 fenced code block 與 inline code 換成等長的空白,行號不變。
 *
 * TODO(P-28 開發輪):實作。注意 docs/00-design.md 裡有一個真的陷阱——
 * 一段 ```markdown 區塊裡面又寫了一行 ```example,再一行 ``` 才收尾。
 * 用非貪婪的 /```[\s\S]*?```/ 去挖會在 ```example 那裡提早收掉,
 * 於是區塊裡示範用的 `![同源判定流程](../../assets/sec-0042-sop.png)` 會被
 * 當成真的連結而誤報。要照 CommonMark 逐行判定:有 info string 的圍欄不算收尾。
 */
export function stripCode(_src: string): string {
  throw new Error('TODO(P-28): stripCode 尚未實作');
}

/**
 * 從已經挖掉 code 的內文找出相對連結。
 * 回傳的 target 是原文(可能含錨點);外部連結與純錨點不回傳。
 *
 * TODO(P-28 開發輪):實作。要涵蓋 `[文字](路徑)` 與 `![圖說](路徑)`,
 * 以及 `[文字](路徑 "title")` 這種帶 title 的形式。
 */
export function findRelativeLinks(_stripped: string): { target: string; line: number }[] {
  throw new Error('TODO(P-28): findRelativeLinks 尚未實作');
}

/**
 * 掃一個根目錄,回傳結果。不負責印東西,也不負責 process.exit。
 *
 * TODO(P-28 開發輪):實作。
 */
export function checkDocLinks(_root: string): DocLinkResult {
  throw new Error('TODO(P-28): checkDocLinks 尚未實作');
}

/**
 * CLI 入口。回傳退出碼與要印的字。
 *
 * TODO(P-28 開發輪):實作。三種輸出:
 *   - links === 0        → code 1,含「掃描到 0 條相對連結」與 SCANNER_BROKEN
 *   - broken.length > 0  → code 1,逐條列 file:line 與 target
 *   - 其餘              → code 0,含「doc-links: 掃描 N 個 markdown 檔,M 條相對連結」
 */
export function main(_argv: string[]): { code: number; output: string } {
  throw new Error('TODO(P-28): main 尚未實作');
}

const isDirectRun = process.argv[1]?.endsWith('check-doc-links.ts') ?? false;
if (isDirectRun) {
  const { code, output } = main(process.argv.slice(2));
  console.log(output);
  process.exit(code);
}
