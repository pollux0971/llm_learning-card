import { countBodyWords, countWords, stripExampleFences } from './word-count-min.js';

describe('countWords', () => {
  it('CJK 每字算 1', () => {
    expect(countWords('同源政策')).toBe(4);
  });

  it('連字號切斷英數字序列', () => {
    expect(countWords('same-origin')).toBe(2);
  });

  it('連續英數字算一個序列', () => {
    expect(countWords('TLS')).toBe(1);
  });

  it('句點切斷序列', () => {
    expect(countWords('1.5')).toBe(2);
  });

  it('撇號切斷序列', () => {
    expect(countWords("don't")).toBe(2);
  });

  it('空白切斷序列', () => {
    expect(countWords('RFC 6265')).toBe(2);
  });

  it('標點與符號本身算 0', () => {
    expect(countWords('。、!?')).toBe(0);
  });

  it('混合案例:contracts/fixtures/cards/wordcount-cases.md 的 body', () => {
    // 逐段驗證見 contracts/fixtures/cards/README.md;該檔宣稱合計 26,
    // 但依 contracts/types.md §2 的演算法逐字元推演,正確答案是 23
    // (README 的表格本身加總起來也是 23,26 疑似筆誤)。見 FEATURE.md 待協調。
    const body = "同源政策(same-origin policy)在 TLS 1.3 下不變。don't 算兩個。RFC 6265 也是。";
    expect(countWords(body)).toBe(23);
  });
});

describe('stripExampleFences', () => {
  it('移除 example 圍欄,body 只剩其他文字', () => {
    const text = '正文開頭\n```example\n範例內容\n```\n正文結尾';
    const { body, examples } = stripExampleFences(text);
    expect(body).toBe('正文開頭\n\n正文結尾');
    expect(examples).toEqual(['範例內容']);
  });

  it('沒有圍欄時原樣返回,examples 是空陣列', () => {
    const { body, examples } = stripExampleFences('只是一段文字');
    expect(body).toBe('只是一段文字');
    expect(examples).toEqual([]);
  });

  it('多個圍欄依序收集', () => {
    const text = '```example\nA\n```\n中間\n```example\nB\n```';
    const { examples } = stripExampleFences(text);
    expect(examples).toEqual(['A', 'B']);
  });
});

describe('countBodyWords', () => {
  it('計算前會先去掉 example 圍欄的內容', () => {
    const body = '正文四個字\n```example\n這裡有很多不該被算進去的字\n```';
    expect(countBodyWords(body)).toBe(5);
  });
});
