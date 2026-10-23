/**
 * 靜態掃描的自測(T15):正確的範例 → 0 個問題;每一種改壞的版本 → 抓得到。測試 agent 寫;開發 worker 不改。
 * 這證明掃描器本身有牙齒,跟真的卡片檔無關(真檔由 card-static.test.ts 掃)。
 */
import { describe, expect, it } from 'vitest';
import { GOOD_MAIN, GOOD_TEACH_APP, GOOD_TEST_APP } from './card-static-samples-test-support.js';
import {
  buttonProblems, fieldProblems, gradingTextProblems, importProblems, loadScanProblems, panelProblems, parseCardSource, parseMarkup, progressProblems,
  resultMarkupProblems, styleProblems, rootLevel, type CardSource,
} from './card-static-test-support.js';
import type { CardName } from './card-design-values-test-support.js';

/** boundaries 掃描器會把字串裡的 import 當真的 import 掃,所以 07 的路徑拆開寫 */
const UI_ROOT = ['@learning', 'ui-shared'].join('/');
const HUD_CSS = `${UI_ROOT}/hud/hud.css`;

const teach = (app: string = GOOD_TEACH_APP, main: string = GOOD_MAIN) => parseCardSource('teach-card', app, main);
const test = (app: string = GOOD_TEST_APP, main: string = GOOD_MAIN) => parseCardSource('test-card', app, main);

function all(name: CardName, src: CardSource): string[] {
  return [
    ...panelProblems(name, src), ...buttonProblems(name, src), ...styleProblems(name, src), ...importProblems(name, src), ...loadScanProblems(name, src),
    ...(name === 'test-card' ? [...fieldProblems(src), ...progressProblems(src), ...resultMarkupProblems(src)] : []),
  ];
}

describe('範例是對的', () => {
  it('教學卡範例:0 個問題', () => { expect(all('teach-card', teach())).toEqual([]); });
  it('考試卡範例:0 個問題', () => { expect(all('test-card', test())).toEqual([]); });
  it('範例真的有東西可掃(防止空範例綠)', () => {
    const root = parseMarkup(test().markup);
    expect(rootLevel(root).els.map((e) => e.tag)).toEqual(['HudPanel']);
    expect(GOOD_TEST_APP).toContain('data-result');
  });
});

function mutate(src: string, from: string | RegExp, to: string): string {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`改不動:找不到 ${String(from)}(範例變了?)`);
  return out;
}

const teachMutants: [string, string, string | RegExp, string, RegExp][] = [
  ['「下一個」改回原生 <button>', 'buttons', '<HudButton onclick={handleNext} disabled={finished}>下一個</HudButton>', '<button type="button" onclick={handleNext} disabled={finished}>下一個</button>', /原生 <button>/],
  ['<h1> 搬回面板上方', 'panel', '<HudPanel title="教學卡"', '<h1>教學卡</h1>\n<HudPanel title="教學卡"', /最外層要剛好一個|<h1>/],
  ['面板外面多一段字', 'panel', '</HudPanel>', '</HudPanel>\n<p>外面</p>', /最外層要剛好一個/],
  ['傳 frameless 給 HudPanel', 'panel', '<HudPanel title="教學卡"', '<HudPanel frameless title="教學卡"', /不該傳 frameless/],
  ['傳 solid 給 HudPanel', 'panel', '<HudPanel title="教學卡"', '<HudPanel solid={true} title="教學卡"', /不該傳 solid/],
  ['卡片碰 classList', 'panel', "  const fs = createFixtureFs();", "  document.documentElement.classList.add('x');\n  const fs = createFixtureFs();", /classList/],
  ['卡片提到 hud-frameless', 'panel', "  const fs = createFixtureFs();", "  const cls = 'hud-frameless';\n  const fs = createFixtureFs();", /hud-frameless/],
  ['標題不是「教學卡」', 'panel', 'title="教學卡"', 'title="Teach"', /title 要是/],
  ['沒有 controls', 'panel', ' controls={createWindowControls()}', '', /沒有傳 controls/],
  ['「下一個」的 onclick 接錯', 'buttons', 'onclick={handleNext}', 'onclick={pressNext}', /onclick 要是 handleNext/],
  ['「下一個」沒有 disabled={finished}', 'buttons', ' disabled={finished}>下一個', '>下一個', /disabled 要是 finished/],
  ['style 畫框:border', 'style', '    color: var(--hud-text);\n  }\n  .badge', '    color: var(--hud-text);\n    border: 1px solid var(--hud-line);\n  }\n  .badge', /畫框/],
  ['style 畫框:box-shadow', 'style', '    padding: 0 0.4rem;', '    padding: 0 0.4rem;\n    box-shadow: 0 0 2px var(--hud-line);', /畫框/],
  ['style 畫框:outline', 'style', '    padding: 0 0.4rem;', '    padding: 0 0.4rem;\n    outline: 1px solid var(--hud-line);', /畫框/],
  ['style 畫框:clip-path', 'style', '    padding: 0 0.4rem;', '    padding: 0 0.4rem;\n    clip-path: inset(0);', /畫框/],
  ['style 畫框:mask', 'style', '    padding: 0 0.4rem;', '    padding: 0 0.4rem;\n    mask-image: none;', /畫框/],
  ['.lc-example 以外的 border-left', 'style', '    padding: 0 0.4rem;', '    padding: 0 0.4rem;\n    border-left: 3px solid var(--hud-line);', /畫框/],
  ['顏色字面值 #hex', 'style', 'background: var(--hud-accent-wash);', 'background: #fff3cd;', /顏色/],
  ['顏色字面值 rgb()', 'style', 'color: var(--hud-text);\n  }\n  .badge', 'color: rgb(85, 85, 85);\n  }\n  .badge', /顏色/],
  ['顏色用具名色', 'style', 'background: var(--hud-solid);', 'background: white;', /顏色不是 var/],
  ['例子框的 border-left 顏色寫死', 'style', 'border-left: 3px solid var(--hud-line);', 'border-left: 3px solid #ccc;', /顏色/],
  ['沒有載入 hud.css', 'import', "  import '@learning/ui-shared/hud/hud.css';\n", '', /hud\.css/],
  ['HUD 元件從相對路徑 import', 'import', "'@learning/ui-shared/hud/HudPanel.svelte'", "'../../../packages/ui-shared/src/hud/HudPanel.svelte'", /相對路徑|HudPanel\.svelte/],
  ['元素帶 style= 屬性', 'load', '<div class="body">', '<div class="body" style="color: red">', /style=/],
  ['外部網址', 'load', "  const fs = createFixtureFs();", "  const u = 'https://example.com/x';\n  const fs = createFixtureFs();", /http/],
];

function check(kind: string, src: CardSource, name: CardName): string[] {
  if (kind === 'panel') return panelProblems(name, src);
  if (kind === 'buttons') return buttonProblems(name, src);
  if (kind === 'style') return styleProblems(name, src);
  if (kind === 'import') return importProblems(name, src);
  if (kind === 'load') return loadScanProblems(name, src);
  if (kind === 'field') return fieldProblems(src);
  if (kind === 'progress') return progressProblems(src);
  if (kind === 'result') return resultMarkupProblems(src);
  throw new Error(kind);
}

describe('教學卡:改壞的版本抓得到', () => {
  for (const [label, kind, from, to, re] of teachMutants) {
    it(label, () => {
      const problems = check(kind, teach(mutate(GOOD_TEACH_APP, from, to)), 'teach-card');
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(re);
    });
  }
});

const testMutants: [string, string, string | RegExp, string, RegExp][] = [
  ['<h1> 沒拿掉', 'panel', '<HudPanel title="考試卡"', '<h1>考試卡</h1>\n<HudPanel title="考試卡"', /最外層要剛好一個|<h1>/],
  ['兩顆「送出」之一改回原生 <button>', 'buttons', '<HudButton onclick={submitApply} disabled={view.submitting}>送出</HudButton>', '<button onclick={submitApply} disabled={view.submitting}>送出</button>', /原生 <button>|應用題沒有/],
  ['「下一題」改回原生 <button>', 'buttons', '<HudButton onclick={next}>下一題</HudButton>', '<button onclick={next}>下一題</button>', /原生 <button>|下一題/],
  ['填空「送出」的 onclick 不是 submitFill', 'buttons', '<HudButton onclick={submitFill} disabled={view.submitting}>送出</HudButton>', '<HudButton onclick={() => session?.submitFill(fillInputs)} disabled={view.submitting}>送出</HudButton>', /填空題沒有「送出」/],
  ['應用題「送出」的 onclick 不是 submitApply', 'buttons', 'onclick={submitApply}', 'onclick={next}', /應用題沒有「送出」/],
  ['「送出」沒有 view.submitting', 'buttons', '<HudButton onclick={submitFill} disabled={view.submitting}>', '<HudButton onclick={submitFill}>', /view\.submitting/],
  ['鍵盤路徑不再呼叫 submitFill', 'buttons', 'void submitFill();', 'void next();', /handleFillKeydown/],
  ['textarea 沒包 HudField', 'field', /<HudField>\s*<textarea([\s\S]*?)<\/textarea>\s*<\/HudField>/, '<textarea$1</textarea>', /<textarea> 沒有包在/],
  ['只包第一格', 'field', /<HudField>\s*(<input type="text" bind:value=\{fillInputs\[i\]\} onkeydown)([^>]*>)\s*<\/HudField>/, '$1$2', /<input> 沒有包在/],
  ['HudField 接管 bind:value', 'field', '<HudField>\n              <input\n', '<HudField bind:value={x}>\n              <input\n', /bind:value 留在原生/],
  ['<textarea> rows 改掉', 'field', 'rows="6"', 'rows="2"', /rows/],
  ['進度不是 HpBar', 'progress', '<HpBar done={view.answeredCount} total={view.totalCount} />', '<progress value={view.answeredCount}></progress>', /HpBar/],
  ['HpBar done 多 1', 'progress', 'done={view.answeredCount}', 'done={view.answeredCount + 1}', /done 要是/],
  ['HpBar total 寫死', 'progress', 'total={view.totalCount}', 'total={3}', /total 要是/],
  ['「x / y」那行字拿掉', 'progress', '<span>{view.answeredCount} / {view.totalCount}</span>', '', /那行字不見了/],
  ['「x / y」搬出進度那一區', 'progress', '<span>{view.answeredCount} / {view.totalCount}</span>\n      <HpBar', '<HpBar', /那行字不見了/],
  ['答對答錯字樣一樣', 'result', "'✓ 答對了' : '× 答錯了'", "'✓ 答對了' : '✓ 答對了'", /答錯了/],
  ['拿掉符號', 'result', "'✓ 答對了' : '× 答錯了'", "'答對了' : '答錯了'", /標記裡沒有/],
  ['符號改用 ✗(U+2717)', 'result', "'× 答錯了'", "'" + String.fromCodePoint(0x2717) + " 答錯了'", /標記裡沒有|U\+2717/],
  ['符號改用 CSS ::before', 'result', '  .pass {', "  .pass::before {\n    content: '" + String.fromCodePoint(0x2713) + "';\n  }\n  .pass {", /::before|content/],
  ['拿掉 data-result', 'result', " data-result={view.result.pass ? 'pass' : 'fail'}", '', /data-result/],
  ['data-result 只有 pass', 'result', "data-result={view.result.pass ? 'pass' : 'fail'}", 'data-result="pass"', /pass 與 fail/],
  ['評分失敗那行帶 data-result', 'result', '<p class="error">{view.gradingError}', '<p class="error" data-result="fail">{view.gradingError}', /評分失敗/],
  ['評分失敗那行帶符號', 'result', '<p class="error">{view.gradingError}', '<p class="error">× {view.gradingError}', /評分失敗/],
  ['評分失敗那行帶 ✓', 'result', '<p class="error">{view.gradingError}', '<p class="error">✓ {view.gradingError}', /評分失敗/],
  ['評分失敗那行不見', 'result', '{view.gradingError}</p>', '</p>', /找不到「評分失敗/],
  ['評分失敗那行顯示別的欄位', 'result', '{view.gradingError}</p>', '{view.loadError}</p>', /找不到「評分失敗/],
  ['寫死的評分失敗帶符號', 'result', '<p class="error">{view.gradingError}', '<p class="error">× 評分失敗,請再試一次', /評分失敗/],
  ['寫死的評分失敗帶 data-result', 'result', '<p class="error">{view.gradingError}', '<p class="error" data-result="fail">評分失敗,請再試一次', /評分失敗/],
  ['import 07 的根', 'import', `  import '${HUD_CSS}';`, `  import '${HUD_CSS}';\n  import { renderMarkdown } from '${UI_ROOT}';`, /不能 import/],
  ['import ui-shared 的別的檔', 'import', `  import '${HUD_CSS}';`, `  import '${UI_ROOT}/example-fence.js';\n  import '${HUD_CSS}';`, /不能 import/],
  ['答對答錯顏色改回 #1a7f37', 'style', 'color: var(--hud-pass);', 'color: #1a7f37;', /顏色/],
  ['答錯顏色改回 #d1242f', 'style', 'color: var(--hud-fail);', 'color: #d1242f;', /顏色/],
  ['考試卡傳 solid', 'panel', '<HudPanel title="考試卡"', '<HudPanel solid title="考試卡"', /不該傳 solid/],
];

describe('考試卡:改壞的版本抓得到', () => {
  for (const [label, kind, from, to, re] of testMutants) {
    it(label, () => {
      const problems = check(kind, test(mutate(GOOD_TEST_APP, from, to)), 'test-card');
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(re);
    });
  }
});

describe('考試卡:評分失敗那行寫死的字也收', () => {
  it('寫死「評分失敗,請再試一次」沒有問題', () => {
    const app = mutate(GOOD_TEST_APP, '<p class="error">{view.gradingError}', '<p class="error">評分失敗,請再試一次');
    expect(check('result', test(app), 'test-card')).toEqual([]);
  });
});

const GOOD_SESSION = `const SUBMIT_RETRY_HINT = '改好之後再按「送出」。';
const GRADING_ERROR = '評分失敗,請再試一次';
`;

describe('評分失敗常數:不帶對錯符號', () => {
  it('好的:0 個問題', () => { expect(gradingTextProblems(GOOD_SESSION)).toEqual([]); });
  it('真的 session.ts 的常數讀得到(防止掃空)', () => {
    expect(gradingTextProblems()).toEqual([]);
  });
  const bad: [string, string, string, RegExp][] = [
    ['GRADING_ERROR 加 ✓', '評分失敗,請再試一次', '✓ 評分失敗,請再試一次', /GRADING_ERROR.*✓/],
    ['GRADING_ERROR 加 ×', '評分失敗,請再試一次', '× 評分失敗,請再試一次', /GRADING_ERROR/],
    ['GRADING_ERROR 加 ✗', '評分失敗,請再試一次', String.fromCodePoint(0x2717) + ' 評分失敗', /GRADING_ERROR/],
    ['SUBMIT_RETRY_HINT 加 ×', '改好之後再按「送出」。', '× 改好之後再按「送出」。', /SUBMIT_RETRY_HINT/],
    ['SUBMIT_RETRY_HINT 加 ✓', '改好之後再按「送出」。', '改好之後再按「送出」。✓', /SUBMIT_RETRY_HINT/],
  ];
  for (const [label, from, to, re] of bad) {
    it(label, () => {
      const problems = gradingTextProblems(mutate(GOOD_SESSION, from, to));
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(re);
    });
  }
  it('常數不見 → 報「找不到」', () => {
    expect(gradingTextProblems(GOOD_SESSION.replace('const GRADING_ERROR', 'const OTHER')).join('\n')).toMatch(/找不到 const GRADING_ERROR/);
  });
  it('常數改成字串以外(函式回傳)→ 報「找不到」,不默默放過', () => {
    expect(gradingTextProblems(GOOD_SESSION.replace("'評分失敗,請再試一次'", 'pick()')).join('\n')).toMatch(/找不到 const GRADING_ERROR/);
  });
});

describe('解析器本身', () => {
  it('認得 {…} 裡的 > 與 <、帶引號的屬性、簡寫屬性', () => {
    const root = parseMarkup('<A x={a > b} y="p > q" {z}><b>t</b></A><C/>');
    const top = rootLevel(root).els;
    expect(top.map((e) => e.tag)).toEqual(['A', 'C']);
    expect(top[0]!.attrs.map((a) => a.name)).toEqual(['x', 'y', 'z']);
  });

  it('{#if} 區塊裡的元素算最外層', () => {
    const root = parseMarkup('{#if a}<p>x</p>{/if}<Panel>y</Panel>');
    expect(rootLevel(root).els.map((e) => e.tag)).toEqual(['p', 'Panel']);
  });

  it('input 這種 void 元素不吞掉後面的兄弟', () => {
    const root = parseMarkup('<Panel><input type="text"><p>x</p></Panel>');
    expect(rootLevel(root).els).toHaveLength(1);
    expect(rootLevel(root).els[0]!.children).toHaveLength(2);
  });
});

// ───────────────────────────── T44:教學卡分隔線的窄例外(顧問 2026-10-24 裁)
const SEP = '1px solid var(--hud-line)';
const withRule = (name: CardName, css: string): CardSource => {
  const base = name === 'teach-card' ? teach() : test();
  return parseCardSource(name, base.app.replace('</style>', `${css}\n</style>`), base.main);
};
const sepProblems = (css: string, name: CardName = 'teach-card'): string[] => styleProblems(name, withRule(name, css));

describe('T44 分隔線例外:該放行的放行', () => {
  const ok: [string, string][] = [
    ['.generating + .deepen-error 合寫', `.generating,\n.deepen-error { border-top: ${SEP}; }`],
    ['只有 .generating', `.generating { border-top: ${SEP}; }`],
    ['只有 .deepen-error', `.deepen-error { border-top: ${SEP}; }`],
    ['三個 longhand', '.generating { border-top-width: 1px; border-top-style: solid; border-top-color: var(--hud-line); }'],
    ['空白與大小寫不同', '.generating { border-top:  1PX   SOLID   var( --hud-line ) ; }'],
  ];
  for (const [label, css] of ok) it(label, () => { expect(sepProblems(css)).toEqual([]); });
  it('訊息把兩個例外都寫出來', () => {
    const msg = sepProblems('.x { border-top: 1px solid var(--hud-line); }').join('\n');
    expect(msg).toMatch(/\.lc-example 的 border-left/);
    expect(msg).toMatch(/\.generating \/ \.deepen-error/);
  });
});

describe('T44 分隔線例外:該紅的照舊紅', () => {
  const bad: [string, string, CardName][] = [
    ['2px', '.generating { border-top: 2px solid var(--hud-line); }', 'teach-card'],
    ['dashed', '.generating { border-top: 1px dashed var(--hud-line); }', 'teach-card'],
    ['別的 hud 顏色', '.generating { border-top: 1px solid var(--hud-text); }', 'teach-card'],
    ['顏色字面值', '.generating { border-top: 1px solid #ccc; }', 'teach-card'],
    ['border-bottom', `.generating { border-bottom: ${SEP}; }`, 'teach-card'],
    ['border-left', `.generating { border-left: ${SEP}; }`, 'teach-card'],
    ['整個 border', `.generating { border: ${SEP}; }`, 'teach-card'],
    ['longhand 寬度 2px', '.generating { border-top-width: 2px; }', 'teach-card'],
    ['longhand 樣式 dotted', '.generating { border-top-style: dotted; }', 'teach-card'],
    ['longhand 顏色字面值', '.generating { border-top-color: red; }', 'teach-card'],
    ['別的 selector', `.badge { border-top: ${SEP}; }`, 'teach-card'],
    ['selector 多帶一個', `.generating, .badge { border-top: ${SEP}; }`, 'teach-card'],
    ['後代 selector', `.generating p { border-top: ${SEP}; }`, 'teach-card'],
    ['同一條規則多寫 outline', `.generating { border-top: ${SEP}; outline: 1px solid var(--hud-line); }`, 'teach-card'],
    ['outline', '.generating { outline: 1px solid var(--hud-line); }', 'teach-card'],
    ['box-shadow', '.generating { box-shadow: 0 -1px 0 var(--hud-line); }', 'teach-card'],
    ['考試卡同一條規則', `.generating { border-top: ${SEP}; }`, 'test-card'],
  ];
  for (const [label, css, name] of bad) {
    it(label, () => {
      const problems = sepProblems(css, name);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(/畫框|顏色/);
    });
  }
  it('background 漸層偽造線(要紅)', () => {
    const problems = sepProblems('.generating { background-image: linear-gradient(var(--hud-line), var(--hud-line)); background-size: 100% 1px; }');
    expect(problems.length).toBeGreaterThan(0);
  });
});
