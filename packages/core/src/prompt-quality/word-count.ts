/**
 * 教學卡 body 字數。T52、ADR-060 第 3 點:只留 01 一份。
 * 這裡轉 export,不留自己的圍欄 regex 或 CJK 判斷。
 */
export { countBodyWords } from '@core/schema/word-count.js';
