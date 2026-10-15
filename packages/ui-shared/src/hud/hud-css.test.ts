/**
 * 14-hud-skin / phase-1:hud.css 的設計值(FEATURE.md「外觀的設計值」那張表)。測試 agent 擁有。
 * 釘住的 CSS 自訂屬性(都寫在 hud.css 頂層,值寫死不用 var() 轉手):
 *   --hud-text   內文字色(深灰)        --hud-panel  面板底色(白色半透明)
 *   --hud-line   框線色(黑)            --hud-line-width  框線粗細(1px)
 *   --hud-cut    切角大小(8–12px)      --hud-accent 亮點(橘)       --hud-hp  HP 條填色(綠)
 * 展開動畫:一條規則有 animation,時間 ≤ 200ms、不無限重複;減少動態區塊要關掉所有 animation 與 transition。
 */
import {
  allStyleNodes, bodyContrast, colourLiteralProblems, cssVar, expandAnimationProblems, flattenRules, jsMotionProblems,
  parseColor, readHudCss, reducedMotionProblems, worstContrast,
} from './test-support.js';

describe('內文對比', () => {
  it('--hud-text 對 --hud-panel 的最差對比 ≥ 4.5(壓在純白與純黑上都要)', () => {
    const { nodes } = readHudCss();
    expect(bodyContrast(nodes)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('設計值', () => {
  const css = () => readHudCss().nodes;
  const px = (v: string | undefined) => { const m = /^(\d+(?:\.\d+)?)px$/.exec((v ?? '').trim()); return m ? parseFloat(m[1]!) : Number.NaN; };

  it('框線:1px、黑色', () => {
    expect(px(cssVar(css(), '--hud-line-width'))).toBe(1);
    const line = parseColor(cssVar(css(), '--hud-line') ?? '(沒有 --hud-line)');
    expect([line.r, line.g, line.b, line.a]).toEqual([0, 0, 0, 1]);
  });

  it('切角 8–12px', () => {
    const cut = px(cssVar(css(), '--hud-cut'));
    expect(cut).toBeGreaterThanOrEqual(8);
    expect(cut).toBeLessThanOrEqual(12);
  });

  it('面板:近白、不透明度約 0.9(0.85–0.95)', () => {
    const p = parseColor(cssVar(css(), '--hud-panel') ?? '(沒有 --hud-panel)');
    expect(Math.min(p.r, p.g, p.b)).toBeGreaterThanOrEqual(240);
    expect(p.a).toBeGreaterThanOrEqual(0.85);
    expect(p.a).toBeLessThanOrEqual(0.95);
  });

  it('內文字色是深灰:對純白對比 ≥ 7(不是黑也不是淺灰)且三通道差 ≤ 16', () => {
    const t = parseColor(cssVar(css(), '--hud-text') ?? '(沒有 --hud-text)');
    expect(Math.max(t.r, t.g, t.b) - Math.min(t.r, t.g, t.b)).toBeLessThanOrEqual(16);
    expect(worstContrast(t, { r: 255, g: 255, b: 255, a: 1 })).toBeGreaterThanOrEqual(7);
    expect(t.r + t.g + t.b).toBeGreaterThan(0); // 不是純黑
  });

  it('亮點是橘色、HP 條是綠色', () => {
    const o = parseColor(cssVar(css(), '--hud-accent') ?? '(沒有 --hud-accent)');
    expect(o.r).toBeGreaterThan(200);
    expect(o.g).toBeGreaterThan(90);
    expect(o.g).toBeLessThan(190);
    expect(o.b).toBeLessThan(90);
    const g = parseColor(cssVar(css(), '--hud-hp') ?? '(沒有 --hud-hp)');
    expect(g.g).toBeGreaterThan(g.r);
    expect(g.g).toBeGreaterThan(g.b);
  });

  it('橘色只用在線條與底色,不印內文(must_catch:橘字在白底對比不夠)', () => {
    const offenders = flattenRules(allStyleNodes()).filter(({ rule }) => /var\(\s*--hud-accent/.test(rule.decls['color'] ?? ''));
    expect(offenders.map((o) => o.rule.selector)).toEqual([]);
    // 配對的正面:橘色真的有被用到(border / background / outline / box-shadow 之一)
    const used = flattenRules(allStyleNodes()).some(({ rule }) =>
      Object.entries(rule.decls).some(([k, v]) => k !== 'color' && /var\(\s*--hud-accent/.test(v)));
    expect(used).toBe(true);
  });

  it('顏色字面值只在 hud.css:其他 css 與元件 <style> 一律引用變數(設計值只有一份)', () => {
    expect(colourLiteralProblems()).toEqual([]);
  });
});

describe('動畫', () => {
  it('展開動畫:有、≤ 200ms、不無限重複', () => {
    expect(expandAnimationProblems(readHudCss().nodes)).toEqual([]);
  });

  it('減少動態:每一個有 animation / transition 的選擇器都被關掉(或有 *{…!important} 總關閉)', () => {
    expect(reducedMotionProblems(readHudCss().nodes)).toEqual([]);
  });

  it('動畫只走 CSS:不用 Svelte 的 transition:/in:/out:/animate: 指令,不用 .animate()(它們不受媒體查詢管)', () => {
    expect(jsMotionProblems()).toEqual([]);
  });
});
