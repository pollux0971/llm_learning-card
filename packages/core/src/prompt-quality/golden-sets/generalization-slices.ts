/**
 * T18 (d2):泛化 golden 輸入的來源。自擬的公開常識短文,不取自 `raw/`、`learning/`、帳本。
 *
 * 結構仿 `raw-slices.ts`。**唯讀**——這個模組只讀 fixture,絕不寫。
 * 行號與 sha256 由紅測試釘死;換內容要跑新基準,不是在這裡改。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 相對這個檔。化學三個小節的原文。 */
const CHEMISTRY_FILE = join(import.meta.dirname, '../fixtures/golden-generalization/chemistry.md');

export interface GeneralizationSlice {
  /** 穩定的短代號,同時是 `children-gen-<key>` 的字尾 */
  key: string;
  /** 原文的 `##` 標題(不含 `## `) */
  heading: string;
  /** 1-based、含頭尾的行號範圍,跟 `RawSlice.lines` 同一套規則 */
  lines: [number, number];
}

/**
 * 三個切片。主題是化學酸鹼,跟 `children.md` 裡出現過的範例(朝廷、條約、年號)不同。
 * 改這裡等於換掉泛化基準的輸入。
 */
export const GENERALIZATION_SLICES: readonly GeneralizationSlice[] = [
  { key: 'acid-base', heading: '酸與鹼', lines: [3, 5] },
  { key: 'buffer', heading: '緩衝溶液', lines: [7, 9] },
  { key: 'titration', heading: '滴定', lines: [11, 13] },
];

/** 讀化學原文(唯讀)。 */
export function readChemistryFixture(): string {
  return readFileSync(CHEMISTRY_FILE, 'utf8');
}

/**
 * 切片的正文(去掉 `## 標題` 那一行)。頭尾空白去掉,跟登記表組 prompt 的切法一致。
 */
export function generalizationSliceBody(slice: GeneralizationSlice, content = readChemistryFixture()): string {
  const [from, to] = slice.lines;
  const lines = content.split('\n').slice(from - 1, to);
  const first = lines[0] ?? '';
  return (first.startsWith('## ') ? lines.slice(1) : lines).join('\n').trim();
}
