/**
 * 這兩樣是契約 §2「Example 圍欄」的一部分(1.5.0、ADR-081)。改它就是改 §2。
 * 畫面與 core 都用這裡的選項與判斷,不各自再寫一份。
 */
export const CARD_MARKDOWN_OPTIONS = Object.freeze({ html: false, linkify: true });

/** 資訊字串原文:trim 後用空白切開,第一段逐字等於 example。不解跳脫、不解 HTML 實體、大小寫必須相同。 */
export function isExampleFence(info: string): boolean {
  return info.trim().split(/\s+/)[0] === 'example';
}
