/**
 * golden set 的輸入來源:`contracts/fixtures/raw/security-basics.md` 的三個切片。
 *
 * 為什麼是這個檔:I1 那次真跑用的就是它(`features/12-prompt-quality/FEATURE.md`
 * 的「基準資料放哪」記的 25 張卡就是從它 ingest 出來的)。基準要對應真實使用,
 * 所以輸入從它切,不自己編例子。
 *
 * 為什麼是「讀出來」而不是複製一份:`raw/` 是使用者的素材、唯讀(CLAUDE.md 硬規則 2),
 * 內容不會漂;而複製一份的話,以後有人改了那個檔、golden 基準卻還在比舊文字,
 * 沒有人會發現。`raw-slices.test.ts` 用行號與開頭標題把三個切片釘住:
 * 那個檔真的被動到時是**測試變紅**,不是基準悄悄換掉。
 *
 * 為什麼切成這三段(FEATURE.md 開放問題已定「先每個任務 3 個輸入」):
 *   - 三段是原檔自己的三個 `##` 小節,不是我硬切的段落
 *   - 長度不同:CORS 那段最長(4 段、含一條例外規則),預檢那段最短(3 段短句)
 *   - 結構不同:同源政策是「定義 + 三項列舉」、CORS 是「機制 + 條件例外」、
 *     預檢是「流程順序 + 快取補充」。三種形狀都餵過,prompt 改壞其中一種才看得出來
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** repo 根目錄。這個檔在 packages/core/src/prompt-quality/golden-sets/ 底下,往上五層。 */
const ROOT = resolve(import.meta.dirname, '../../../../..');

/** 相對 repo 根目錄。**唯讀**——這個模組只讀,絕不寫(CLAUDE.md 硬規則 2)。 */
export const RAW_FIXTURE_FILE = 'contracts/fixtures/raw/security-basics.md';

export interface RawSlice {
  /** 穩定的短代號,同時是 golden input id 的字尾 */
  key: 'same-origin' | 'cors' | 'preflight';
  /** 原檔的 `##` 標題(不含 `## `) */
  heading: string;
  /** 1-based、含頭尾的行號範圍,跟 ingest.cards 的 `lines` 同一套規則 */
  lines: [number, number];
}

/**
 * 三個切片的行號。改這裡等於換掉 golden 基準的輸入——真要改,先跑一次 `--live` 重立基準。
 */
export const RAW_SLICES: readonly RawSlice[] = [
  { key: 'same-origin', heading: '同源政策', lines: [3, 12] },
  { key: 'cors', heading: '跨來源資源共享', lines: [14, 24] },
  { key: 'preflight', heading: '預檢請求', lines: [26, 34] },
] as const;

/** 讀整個 raw fixture(唯讀)。 */
export function readRawFixture(): string {
  return readFileSync(join(ROOT, RAW_FIXTURE_FILE), 'utf8');
}

/**
 * 取出一個切片的原文。行號是 1-based 含頭尾,跟 `RawSlice.lines` 一致。
 * 尾端的空行去掉,前面不動——縮排在 markdown 裡帶意義。
 */
export function sliceRaw(slice: RawSlice, content = readRawFixture()): string {
  const [from, to] = slice.lines;
  return content.split('\n').slice(from - 1, to).join('\n').replace(/\s+$/, '');
}

/** 切片的正文(去掉 `## 標題` 那一行),當作「一張卡的 body」用。 */
export function sliceBody(slice: RawSlice, content = readRawFixture()): string {
  const text = sliceRaw(slice, content);
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  return (first.startsWith('## ') ? lines.slice(1) : lines).join('\n').replace(/^\s+|\s+$/g, '');
}
