/**
 * T18 驗收補測(驗收者寫):generalizationSliceBody 的切法。Stryker 存活:標題判斷的字串、join 的分隔符、
 * 沒有標題的範圍。現有三個切片剛好都是「標題 + 空行 + 一段」,看不出這幾處;這裡用自訂內容釘住。
 */
import { describe, expect, it } from 'vitest';
import { GENERALIZATION_SLICES, generalizationSliceBody, readChemistryFixture } from './generalization-slices.js';

describe('generalizationSliceBody', () => {
  const content = ['# 總標題', '', '## 甲', '', '甲的第一行', '甲的第二行', '', '## 乙', '', '乙的內容'].join('\n');

  it('範圍以 `## ` 標題開頭 → 去掉標題行,留下正文,多行用換行接回去,頭尾空白去掉', () => {
    expect(generalizationSliceBody({ key: 'a', heading: '甲', lines: [3, 6] }, content)).toBe('甲的第一行\n甲的第二行');
  });

  it('範圍不是以標題開頭 → 第一行不能被當標題丟掉', () => {
    expect(generalizationSliceBody({ key: 'a', heading: '甲', lines: [5, 6] }, content)).toBe('甲的第一行\n甲的第二行');
    expect(generalizationSliceBody({ key: 'b', heading: '乙', lines: [10, 10] }, content)).toBe('乙的內容');
  });

  it('只有 `#`(一個井字)開頭的行不算 `## ` 標題', () => {
    expect(generalizationSliceBody({ key: 'x', heading: '總', lines: [1, 1] }, content)).toBe('# 總標題');
  });

  it('真的化學原文:三個切片各自去掉標題、不含別的小節的字、正文不空', () => {
    const real = readChemistryFixture();
    const bodies = GENERALIZATION_SLICES.map((slice) => generalizationSliceBody(slice, real));
    for (const [i, body] of bodies.entries()) {
      expect(body.length, GENERALIZATION_SLICES[i]!.key).toBeGreaterThan(20);
      expect(body.startsWith('#')).toBe(false);
      expect(body).not.toContain(`## ${GENERALIZATION_SLICES[i]!.heading}`);
    }
    expect(new Set(bodies).size).toBe(3);
  });
});
