/**
 * render-test-support.ts 的自測(用合成的影像,不開瀏覽器、不依賴實作):量測本身會抓人,也會放行對的東西。
 * 這份本來就綠;它的用處是讓 render.test.ts 的「空陣列 = 沒問題」不是因為量尺壞掉。
 */
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, differingPixels, findChrome, inkAcross, px, type Image } from './render-test-support.js';

/** 做一張 w × h、整片同色的影像,再用 paint 改幾格 */
function image(w: number, h: number, fill: [number, number, number], paint: (set: (x: number, y: number, c: [number, number, number]) => void) => void = () => {}): Image {
  const data = new Uint8Array(w * h * 4);
  const set = (x: number, y: number, c: [number, number, number]) => { data.set([...c, 255], (y * w + x) * 4); };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) set(x, y, fill);
  paint(set);
  return { width: w, height: h, data };
}
const row = (y: number, from: number, n: number): [number, number][] => Array.from({ length: n }, (_, i) => [from + i, y]);

/** 照 PNG 規格做一張 RGB 圖(每列 filter 輪流用 0–4,好測反濾波) */
function encodePng(img: Image): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length); const v = new DataView(out.buffer);
    v.setUint32(0, body.length); out.set([...type].map((c) => c.charCodeAt(0)), 4); out.set(body, 8);
    v.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13); const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, img.width); iv.setUint32(4, img.height); ihdr.set([8, 2, 0, 0, 0], 8);
  const stride = img.width * 3;
  const raw = new Uint8Array(img.height * (stride + 1));
  let prev = new Uint8Array(stride);
  for (let y = 0; y < img.height; y += 1) {
    const cur = new Uint8Array(stride);
    for (let x = 0; x < img.width; x += 1) for (let k = 0; k < 3; k += 1) cur[x * 3 + k] = img.data[(y * img.width + x) * 4 + k]!;
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 3 ? cur[i - 3]! : 0; const b = prev[i]!; const c = i >= 3 ? prev[i - 3]! : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = Math.floor((a + b) / 2);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (stride + 1) + 1 + i] = (cur[i]! - pred) & 0xff;
    }
    prev = cur;
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  return Buffer.concat(parts);
}

describe('decodePng', () => {
  it('五種 filter 都解得回原本的像素', () => {
    const src = image(7, 10, [10, 20, 30], (set) => { for (let i = 0; i < 7; i += 1) set(i, i % 10, [200 + i, 100, i * 30]); set(3, 9, [0, 255, 0]); });
    const back = decodePng(encodePng(src));
    expect([back.width, back.height]).toEqual([7, 10]);
    for (let y = 0; y < 10; y += 1) for (let x = 0; x < 7; x += 1) expect(px(back, x, y)).toEqual(px(src, x, y));
  });
  it('不是 PNG 就丟錯', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/不是 PNG/);
  });
});

describe('inkAcross(線寬的量法)', () => {
  const panel: [number, number, number] = [251, 252, 253];
  const page: [number, number, number] = [213, 222, 230];
  it('落在整數像素上的 1 像素黑線 ≈ 1', () => {
    const img = image(7, 1, panel, (set) => set(3, 0, [0, 0, 0]));
    expect(inkAcross(img, row(0, 0, 7))).toBeCloseTo(1, 1);
  });
  it('落在半個像素上(兩格各 50% 灰)還是 ≈ 1', () => {
    const img = image(7, 1, panel, (set) => { set(3, 0, [126, 126, 127]); set(4, 0, [126, 126, 127]); });
    expect(inkAcross(img, row(0, 0, 7))).toBeGreaterThan(0.9);
    expect(inkAcross(img, row(0, 0, 7))).toBeLessThan(1.1);
  });
  it('2 像素、3 像素的線 ≈ 2、≈ 3(G3 那種框變粗會被抓到)', () => {
    expect(inkAcross(image(7, 1, panel, (set) => { set(3, 0, [0, 0, 0]); set(4, 0, [0, 0, 0]); }), row(0, 0, 7))).toBeCloseTo(2, 1);
    expect(inkAcross(image(7, 1, panel, (set) => { set(2, 0, [0, 0, 0]); set(3, 0, [0, 0, 0]); set(4, 0, [0, 0, 0]); }), row(0, 0, 7))).toBeCloseTo(3, 1);
  });
  it('線外比線內暗(半透明面板在淺灰頁面上):外面的底色不算墨水', () => {
    const img = image(7, 1, panel, (set) => { set(0, 0, page); set(1, 0, page); set(2, 0, page); set(3, 0, [0, 0, 0]); });
    expect(inkAcross(img, row(0, 0, 7))).toBeCloseTo(1, 1);
  });
  it('沒有線 ≈ 0', () => {
    expect(inkAcross(image(7, 1, panel), row(0, 0, 7))).toBeCloseTo(0, 5);
  });
});

describe('differingPixels', () => {
  it('一樣的圖是 0;改了 5 格就是 5;差得很小(≤ 32)不算', () => {
    const a = image(10, 10, [232, 120, 32]);
    expect(differingPixels(a, image(10, 10, [232, 120, 32]))).toBe(0);
    expect(differingPixels(a, image(10, 10, [232, 120, 32], (set) => { for (let i = 0; i < 5; i += 1) set(i, 0, [51, 51, 51]); }))).toBe(5);
    expect(differingPixels(a, image(10, 10, [240, 130, 40]))).toBe(0);
  });
  it('大小不同就當成全部不同', () => {
    expect(differingPixels(image(2, 2, [0, 0, 0]), image(3, 2, [0, 0, 0]))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('findChrome', () => {
  it('LC_CHROME 指到不存在的檔就丟錯,不默默跳過', () => {
    expect(() => findChrome({ LC_CHROME: '/nonexistent/chrome-for-hud-render' })).toThrow(/不存在/);
  });
});
