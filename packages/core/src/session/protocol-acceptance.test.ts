/**
 * T22 驗收補測(-ed):protocol.ts 的 Stryker 存活逐個判決後留下的缺口。
 * 只用 protocol.ts 的公開函式與最小的合成行,不放任何接近完整的實作。
 */
import { describe, expect, it } from 'vitest';
import { MAX_LINE_BYTES, classifyRequestLine, parseHelloLine, parseResponseLine } from './protocol.js';

/** 把 filler 補到整行剛好 total 個位元組(全是 ASCII)。 */
function padTo(make: (filler: string) => string, total: number): string {
  const base = make('').length;
  const line = make('a'.repeat(total - base));
  expect(Buffer.byteLength(line, 'utf8')).toBe(total);
  return line;
}
const request = (filler: string): string => `{"v":1,"id":1,"method":"submit","params":{"fill":["${filler}"]}}`;
const response = (filler: string): string => `{"v":1,"id":1,"ok":true,"result":{"p":"${filler}"}}`;

describe('classifyRequestLine:邊界與信封', () => {
  it('剛好上限的一行可以過,多一個位元組就是 too-large 而且不讀 id', () => {
    expect(classifyRequestLine(padTo(request, MAX_LINE_BYTES)).ok).toBe(true);
    expect(classifyRequestLine(padTo(request, MAX_LINE_BYTES + 1))).toEqual({ ok: false, kind: 'too-large', id: null });
  });

  it('結尾的換行不算進大小:剛好上限的內容加上 \\n 還是可以過;多一個位元組加 \\n 仍然太大', () => {
    expect(classifyRequestLine(`${padTo(request, MAX_LINE_BYTES)}\n`).ok).toBe(true);
    expect(classifyRequestLine(`${padTo(request, MAX_LINE_BYTES + 1)}\n`)).toEqual({ ok: false, kind: 'too-large', id: null });
  });

  it('一般的行加結尾換行照樣通過(只剝最後一個換行),原樣吐回', () => {
    const line = '{"v":1,"id":3,"method":"status","params":{}}';
    expect(classifyRequestLine(`${line}\n`)).toEqual({ ok: true, request: JSON.parse(line) });
  });

  it('不是 JSON:bad-request、id null,三個欄位剛好這樣', () => {
    expect(classifyRequestLine('not json')).toEqual({ ok: false, kind: 'bad-request', id: null });
    expect(classifyRequestLine('')).toEqual({ ok: false, kind: 'bad-request', id: null });
  });

  it('id 的下限是 1:1 讀得出來(帶回),0 與負數讀不出來(null)', () => {
    expect(classifyRequestLine('{"v":2,"id":1,"method":"status","params":{}}')).toEqual({ ok: false, kind: 'unsupported-version', id: 1 });
    expect(classifyRequestLine('{"v":2,"id":2,"method":"status","params":{}}')).toEqual({ ok: false, kind: 'unsupported-version', id: 2 });
    expect(classifyRequestLine('{"v":2,"id":0,"method":"status","params":{}}')).toEqual({ ok: false, kind: 'unsupported-version', id: null });
    expect(classifyRequestLine('{"v":2,"id":-1,"method":"status","params":{}}')).toEqual({ ok: false, kind: 'unsupported-version', id: null });
  });

  it('id 讀不出來的各種型別都是 null', () => {
    for (const id of ['"1"', '1.5', 'null', 'true', '9007199254740993']) {
      expect(classifyRequestLine(`{"v":1,"id":${id},"method":"nope","params":{}}`), `id=${id}`).toEqual({ ok: false, kind: 'unknown-method', id: null });
    }
  });

  it('不是物件的 JSON(陣列、數字、null、字串)都是 bad-request、id null', () => {
    for (const body of ['[]', '[{"id":1}]', '7', 'null', '"x"']) {
      expect(classifyRequestLine(body), body).toEqual({ ok: false, kind: 'bad-request', id: null });
    }
  });
});

describe('parseResponseLine / parseHelloLine:邊界與回傳的形狀', () => {
  const hello = (today: string): string => JSON.stringify({ v: 1, kind: 'hello', fakeCloud: false, today });

  it('hello:合法的過;today 前後多一個字元都不行', () => {
    expect(parseHelloLine(hello('2026-10-17')).ok).toBe(true);
    expect(parseHelloLine(hello('x2026-10-17'))).toEqual({ ok: false });
    expect(parseHelloLine(hello('2026-10-17x'))).toEqual({ ok: false });
    expect(parseHelloLine(hello('2026-10-1'))).toEqual({ ok: false });
  });

  it('hello:壞 JSON、太長、欄位不對,都剛好回 { ok: false }(不是別的形狀)', () => {
    expect(parseHelloLine('not json')).toEqual({ ok: false });
    expect(parseHelloLine(`{"v":1,"kind":"hello","fakeCloud":false,"today":"2026-10-17","pad":"${'a'.repeat(MAX_LINE_BYTES)}"}`)).toEqual({ ok: false });
    expect(parseHelloLine('{"v":1,"kind":"hello"}')).toEqual({ ok: false });
    expect(parseHelloLine(`${hello('2026-10-17')}\n`).ok).toBe(true);
  });

  it('response:剛好上限可以過、多一個位元組不行;結尾換行不算進大小', () => {
    expect(parseResponseLine(padTo(response, MAX_LINE_BYTES)).ok).toBe(true);
    expect(parseResponseLine(`${padTo(response, MAX_LINE_BYTES)}\n`).ok).toBe(true);
    expect(parseResponseLine(padTo(response, MAX_LINE_BYTES + 1))).toEqual({ ok: false });
    expect(parseResponseLine(`${padTo(response, MAX_LINE_BYTES + 1)}\n`)).toEqual({ ok: false });
  });

  it('response:壞 JSON 與不符 schema 都剛好回 { ok: false };合法的回 { ok: true, value }', () => {
    expect(parseResponseLine('not json')).toEqual({ ok: false });
    expect(parseResponseLine('{"v":1}')).toEqual({ ok: false });
    expect(parseResponseLine('{"v":1,"id":1,"ok":true,"result":{"a":1}}')).toEqual({ ok: true, value: { v: 1, id: 1, ok: true, result: { a: 1 } } });
  });
});
