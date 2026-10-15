/**
 * I2 整合測試用的「假雲端」回應腳本。純函式、沒有副作用(cucumber 會把這個檔當模組載入,
 * 所以這裡**不可以**換 globalThis.fetch——換 fetch 的是 `_fake-review-cloud.mjs`,它只在子程序載入)。
 *
 * 兩個地方共用同一份腳本,免得「程序內注入的假 adapter」與「子程序的假網路」答得不一樣:
 *   - i2-review-loop.steps.ts 把它包成假的 CloudAdapter,注入 CloudLlmRouter;
 *   - _fake-review-cloud.mjs 用它回 OpenAI chat completions 的假回應。
 *
 * 答案裡的標記決定回應(作答文字是「使用者回答:」之後的整段):
 *   PASSALL → 每一條 rubric 都過;       FAILONE → 第一條不過、其餘過;
 *   GARBAGE → 一段不是 JSON 的文字(用來測「無法解析」,gradeApply 會重試一次再放棄);
 *   LONGFEEDBACK → 全過,但 feedback 超過 40 字(用來測截斷)。
 * 沒有任何標記 → 丟錯:腳本沒預期到這個作答,要立刻爆,不要靜默回一個看起來合理的答案。
 */

export const APPLY_MARKERS = ['PASSALL', 'FAILONE', 'GARBAGE', 'LONGFEEDBACK'] as const;
export type ApplyMarker = (typeof APPLY_MARKERS)[number];

/** buildApplyPrompt 把 rubric 寫成「1. …」「2. …」的行;數行數就是 rubric 條數。 */
export function countRubricLines(prompt: string): number {
  return prompt.split('\n').filter((line) => /^\d+\. /.test(line)).length;
}

export function applyMarkerOf(prompt: string): ApplyMarker | undefined {
  const answer = prompt.split('使用者回答:')[1] ?? '';
  return APPLY_MARKERS.find((m) => answer.includes(m));
}

const LONG_FEEDBACK = '回答有指出跨來源請求,也說明需要伺服器端設定允許,而且沒有事實錯誤。'.repeat(3);

/** grade.apply 的回應文字。 */
export function scriptedApplyReply(prompt: string): string {
  const marker = applyMarkerOf(prompt);
  const n = countRubricLines(prompt);
  switch (marker) {
    case 'PASSALL':
      return JSON.stringify({ criteria: Array.from({ length: n }, () => true), feedback: '每一條都達成。' });
    case 'FAILONE':
      return JSON.stringify({ criteria: Array.from({ length: n }, (_, i) => i !== 0), feedback: '第一條沒有達成。' });
    case 'LONGFEEDBACK':
      return JSON.stringify({ criteria: Array.from({ length: n }, () => true), feedback: LONG_FEEDBACK });
    case 'GARBAGE':
      return '這不是 JSON,模型亂回了一段話。';
    default:
      throw new Error(`假雲端沒有預期到的作答(要含 ${APPLY_MARKERS.join('/')} 其中一個標記):\n${prompt.slice(-200)}`);
  }
}

export interface FakeCloudCall {
  prompt: string;
}
