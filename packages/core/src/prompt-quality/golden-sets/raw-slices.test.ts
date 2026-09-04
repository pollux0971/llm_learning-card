/**
 * 切片被釘住的地方。
 *
 * 為什麼要釘:golden 基準的輸入是**執行時從 `contracts/fixtures/raw/security-basics.md`
 * 讀出來的**,不是複製一份。好處是不會有兩份會漂的文字;風險是那個檔真的被動到時,
 * 基準的輸入會悄悄換掉、`--diff` 卻只顯示「輸出不一樣」,看起來像 prompt 改壞了。
 * 這幾個測試讓那種情況變成**測試紅**,問題方向才對得上。
 */
import { describe, it, expect } from 'vitest';
import { RAW_SLICES, readRawFixture, sliceBody, sliceRaw, type RawSlice } from './raw-slices.js';
import { countBodyWords } from '../word-count.js';

const slice = (key: RawSlice['key']): RawSlice => RAW_SLICES.find((s) => s.key === key)!;

describe('RAW_SLICES', () => {
  it('三個切片,對應原檔自己的三個 ## 小節', () => {
    expect(RAW_SLICES.map((s) => s.key)).toEqual(['same-origin', 'cors', 'preflight']);
    for (const s of RAW_SLICES) {
      expect(sliceRaw(s).split('\n')[0]).toBe(`## ${s.heading}`);
    }
  });

  it('切片沒有重疊,而且照原檔順序往下', () => {
    for (let i = 1; i < RAW_SLICES.length; i += 1) {
      expect(RAW_SLICES[i]!.lines[0]).toBeGreaterThan(RAW_SLICES[i - 1]!.lines[1]);
    }
  });

  it('最後一個切片收在檔案的最後一行——不是切到一半就不管了', () => {
    const total = readRawFixture().replace(/\s+$/, '').split('\n').length;
    expect(RAW_SLICES[RAW_SLICES.length - 1]!.lines[1]).toBe(total);
  });

  it('三個切片長度不同:CORS 最長、預檢最短(這是選它們的理由之一)', () => {
    const len = (k: RawSlice['key']): number => sliceBody(slice(k)).length;
    expect(len('cors')).toBeGreaterThan(len('same-origin'));
    expect(len('same-origin')).toBeGreaterThan(len('preflight'));
  });

  /**
   * 逐字釘住最短的那一段。`toContain` 殺不掉「換行接錯」「頭尾沒修掉」這類 mutant:
   * 那些是 golden 輸入會不會偷偷多一個空行的差別,而輸入變了、基準就白立了。
   */
  it('sliceRaw 逐字等於原檔那幾行,含 ## 標題、不含尾端空白', () => {
    expect(sliceRaw(slice('preflight'))).toBe(
      [
        '## 預檢請求',
        '',
        '有些跨來源請求瀏覽器不敢直接送。改變伺服器狀態的方法、或帶了自訂標頭的請求,瀏覽',
        '器會先發一個詢問請求,問伺服器願不願意接受。',
        '',
        '伺服器同意之後,瀏覽器才送出真正的請求。這個機制是為了保護那些在同源政策出現之前',
        '就存在的舊系統——它們沒有預期會收到跨來源的寫入請求。',
        '',
        '預檢的結果可以被快取一段時間,避免每次都多一趟往返。',
      ].join('\n'),
    );
  });

  it('sliceBody 逐字等於同一段去掉 ## 標題的正文,前後都沒有空白', () => {
    expect(sliceBody(slice('preflight'))).toBe(
      [
        '有些跨來源請求瀏覽器不敢直接送。改變伺服器狀態的方法、或帶了自訂標頭的請求,瀏覽',
        '器會先發一個詢問請求,問伺服器願不願意接受。',
        '',
        '伺服器同意之後,瀏覽器才送出真正的請求。這個機制是為了保護那些在同源政策出現之前',
        '就存在的舊系統——它們沒有預期會收到跨來源的寫入請求。',
        '',
        '預檢的結果可以被快取一段時間,避免每次都多一趟往返。',
      ].join('\n'),
    );
  });

  /**
   * 第一行不是 `## ` 開頭時**不能砍掉它**——砍了就是把正文的第一句吃掉。
   * 條件寫成 `startsWith('')`(永遠成立)的 mutant 只有這個情境抓得到。
   */
  it('第一行不是 ## 標題時整段留著,不會砍掉第一行', () => {
    const fake = ['x', 'y', '第一行就是正文', '第二行', 'z'].join('\n');
    const s: RawSlice = { key: 'preflight', heading: '不管', lines: [3, 4] };
    expect(sliceRaw(s, fake)).toBe('第一行就是正文\n第二行');
    expect(sliceBody(s, fake)).toBe('第一行就是正文\n第二行');
  });

  it('切片的尾端空白被修掉,但段落中間的空行留著', () => {
    const fake = ['起頭', '', '結尾  ', '   ', '下一段'].join('\n');
    const s: RawSlice = { key: 'preflight', heading: '不管', lines: [1, 4] };
    expect(sliceRaw(s, fake)).toBe('起頭\n\n結尾');
  });

  it('sliceBody 也修掉開頭的空白(## 標題後面那一行空行)', () => {
    const fake = ['## 標題', '', '  正文  ', ''].join('\n');
    const s: RawSlice = { key: 'preflight', heading: '標題', lines: [1, 4] };
    expect(sliceBody(s, fake)).toBe('正文');
  });

  /**
   * regenerate 的 golden 輸入把切片正文當成「上一次太長的 body」。
   * 三段都必須真的超過 100 字上限,不然那組 golden 在測一個不存在的情境。
   */
  it('三段正文都超過 100 字上限,regenerate 的輸入才是真的情境', () => {
    for (const s of RAW_SLICES) {
      expect(countBodyWords(sliceBody(s))).toBeGreaterThan(100);
    }
  });
});
