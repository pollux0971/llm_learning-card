/**
 * 14-hud-skin phase-2(工單 T15)兩張卡原始碼的靜態掃描。測試 agent 寫;開發 worker 不改。
 * 檢查邏輯在 card-static-test-support.ts(cucumber 跑同一份)。用 fs 讀卡片的檔,不 import 06、07 的模組。
 */
import { describe, expect, it } from 'vitest';
import {
  buttonProblems, fieldProblems, importProblems, loadScanProblems, panelProblems, progressProblems, resultMarkupProblems,
  gradingTextProblems, styleProblems,
} from './card-static-test-support.js';

describe.each(['teach-card', 'test-card'] as const)('%s 的原始碼', (name) => {
  it('最外層只有一個 HudPanel,內容都在裡面;title、controls;沒有 h1;不提 frameless / solid / classList', () => {
    expect(panelProblems(name)).toEqual([]);
  });

  it('每一顆按鈕都是 HudButton,沒有原生 <button>;接線照舊', () => {
    expect(buttonProblems(name)).toEqual([]);
  });

  it('<style> 不畫框(border / outline / box-shadow / clip-path / mask;.lc-example 的 border-left 除外),顏色只用 var(--hud-*)', () => {
    expect(styleProblems(name)).toEqual([]);
  });

  it('HUD 元件從 @learning/ui-shared/hud/… import,hud.css 有被載入;考試卡不碰 ui-shared 的根', () => {
    expect(importProblems(name)).toEqual([]);
  });

  it('CSP:沒有 style= 屬性、不插 inline <style>、沒有外部網址', () => {
    expect(loadScanProblems(name)).toEqual([]);
  });
});

describe('考試卡的作答欄、進度、結果(驗收 2)', () => {
  it('每個 <input> 與 <textarea> 都包在 <HudField> 裡;輸入框本身還是原生元素,06 phase-1 的行為不動', () => {
    expect(fieldProblems()).toEqual([]);
  });

  it('進度:header.progress 裡是 HpBar(done=view.answeredCount、total=view.totalCount),「x / y」那行字還在', () => {
    expect(progressProblems()).toEqual([]);
  });

  it('結果那一行:data-result、「✓ 答對了」「× 答錯了」寫在標記裡不在 CSS content,評分失敗不帶符號', () => {
    expect(resultMarkupProblems()).toEqual([]);
  });

  it('評分失敗那行的字從 session.ts 的 GRADING_ERROR、SUBMIT_RETRY_HINT 來:兩個常數的值都沒有 ✓ × ✗', () => {
    expect(gradingTextProblems()).toEqual([]);
  });
});
