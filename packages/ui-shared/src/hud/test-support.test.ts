/**
 * test-support.ts 的自測(用合成輸入,不依賴實作):檢查器本身會抓人,也會放行對的東西。
 * 這份本來就綠;它的用處是讓 hud-*.test.ts 的「空陣列 = 沒問題」不是因為檢查器壞掉。
 */
import {
  contrast, expandAnimationProblems, loadProblems, parseColor, parseCss, reducedMotionProblems, worstContrast,
} from './test-support.js';

describe('contrast', () => {
  it('黑白 21:1;同色 1:1', () => {
    expect(contrast(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5);
    expect(contrast(parseColor('#777'), parseColor('#777'))).toBeCloseTo(1, 5);
  });
  it('#767676 對白剛好約 4.54(WCAG 的經典邊界)', () => {
    expect(contrast(parseColor('#767676'), parseColor('#fff'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseColor('#777777'), parseColor('#fff'))).toBeLessThan(4.5);
  });
  it('半透明面板壓在黑底上變灰,最差對比比壓在白底上低', () => {
    const text = parseColor('#333');
    const panel = parseColor('rgba(255,255,255,0.9)');
    expect(worstContrast(text, panel)).toBeLessThan(contrast(text, parseColor('#fff')));
    expect(worstContrast(parseColor('#888'), panel)).toBeLessThan(4.5);
  });
  it('parseColor:#rgb、#rrggbbaa、rgb 空白語法、百分比', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColor('#ffffff80').a).toBeCloseTo(0.502, 2);
    expect(parseColor('rgb(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(() => parseColor('var(--x)')).toThrow();
  });
});

describe('loadProblems', () => {
  it('抓 style= 屬性、外部網址、插入 <style>;放行 SVG 命名空間與 <style> 區塊與 style: 指令', () => {
    expect(loadProblems('<div style="color:red"></div>', '.svelte')).not.toEqual([]);
    expect(loadProblems("<div style='x'></div>", '.html')).not.toEqual([]);
    expect(loadProblems('<div style={s}></div>', '.svelte')).not.toEqual([]);
    expect(loadProblems('@import url(https://x.test/a.css);', '.css')).not.toEqual([]);
    expect(loadProblems('a{background:url(//cdn.test/a.png)}', '.css')).not.toEqual([]);
    expect(loadProblems('<link href="//cdn.test/a.css">', '.html')).not.toEqual([]);
    expect(loadProblems("document.head.append(document.createElement('style'))", '.ts')).not.toEqual([]);
    expect(loadProblems("el.setAttribute('style','x')", '.ts')).not.toEqual([]);
    expect(loadProblems('el.style.cssText = "x"', '.ts')).not.toEqual([]);
    expect(loadProblems('const h = "<style>a{}</style>"', '.ts')).not.toEqual([]);
    // 放行
    expect(loadProblems('<svg xmlns="http://www.w3.org/2000/svg"></svg><div style:width="1px"></div>', '.svelte')).toEqual([]);
    expect(loadProblems('<p>x</p><style>.a{color:red}</style>', '.svelte')).toEqual([]);
    expect(loadProblems('@font-face{src:url("./fonts/a.woff2")}', '.css')).toEqual([]);
  });
});

describe('reducedMotionProblems / expandAnimationProblems', () => {
  const ok = `
    .hud-panel { animation: hud-expand 180ms ease-out 1; transition: opacity 120ms; }
    @keyframes hud-expand { from { opacity: 0 } to { opacity: 1 } }
    @media (prefers-reduced-motion: reduce) { .hud-panel { animation: none; transition: none; } }`;
  it('同選擇器關掉 → 沒問題', () => {
    expect(reducedMotionProblems(parseCss(ok))).toEqual([]);
    expect(expandAnimationProblems(parseCss(ok))).toEqual([]);
  });
  it('總關閉 *{…!important} → 沒問題', () => {
    const css = `.a{animation:x 100ms} .b{transition:all 1s}
      @media (prefers-reduced-motion: reduce){ .hud *, .hud *::before { animation: none !important; transition: none !important; } }`;
    expect(reducedMotionProblems(parseCss(css))).toEqual([]);
  });
  it('沒有媒體查詢 / 漏關 transition / 總關閉沒 !important → 有問題', () => {
    expect(reducedMotionProblems(parseCss('.a{animation:x 100ms}'))).not.toEqual([]);
    const missing = `.a{animation:x 100ms; transition:all 1s} @media (prefers-reduced-motion: reduce){ .a{animation:none} }`;
    expect(reducedMotionProblems(parseCss(missing))).not.toEqual([]);
    const weak = `.a{animation:x 100ms} @media (prefers-reduced-motion: reduce){ * { animation: none; transition: none } }`;
    expect(reducedMotionProblems(parseCss(weak))).not.toEqual([]);
  });
  it('動畫 > 200ms、無限重複、完全沒有動畫 → 有問題', () => {
    expect(expandAnimationProblems(parseCss('.a{animation:x 250ms}'))).not.toEqual([]);
    expect(expandAnimationProblems(parseCss('.a{animation:x 100ms infinite}'))).not.toEqual([]);
    expect(expandAnimationProblems(parseCss('.a{color:red}'))).not.toEqual([]);
    expect(expandAnimationProblems(parseCss('.a{animation:x 0.2s 1}'))).toEqual([]);
  });
});
