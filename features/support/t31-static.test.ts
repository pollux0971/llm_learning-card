/**
 * T31 驗收 2、6:靜態檢查——訊號目錄、boundaries 例外的理由、分類函式的接線。紅測試作者寫;開發 worker 不改。
 *
 *   - `packages/contracts/src/witness.ts` 登記 `grading.apply.llm-unavailable`(swallow、05-grading、有說明);
 *     `grading.fill.llm-failed-strict` 的說明不再寫「呼叫丟錯」;
 *   - `grade-apply.ts` 真的有 `witness('grading.apply.llm-unavailable')` 呼叫點;訊號目錄與呼叫點一一對上(degraded-report 的登記檢查);
 *   - `scripts/boundaries.allow.json`:05-grading → 03-llm-router 還是**一條**(不加新的),`reason` 補上 grade-apply.ts、grade-fill.ts 與
 *     llmUnavailableReason,原本的 scripts/grade.ts 說明還在;整份例外清單的條數不變;
 *   - `failures.ts` 用 instanceof 認 SDK 的錯(不用 name 比對 APIConnectionError),網路特徵正規式與 ingest/questions.ts 的
 *     NETWORK_ERROR_PATTERN 一模一樣,旁邊有「同一份」的註解;先排除憑證(用 T30 的 credentialProblem);
 *   - 05 不另寫一份分類:grade-apply.ts、grade-fill.ts 都 import llmUnavailableReason。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEGRADED_SIGNALS } from '../../packages/contracts/src/witness.js';
import { catalogDriftProblems, findCallSites } from '../../scripts/degraded-report.js';

const ROOT = join(import.meta.dirname, '../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
/**
 * 例外清單的條數。T31 當時是 21 條;之後 ADR-077(T37)依序加了兩條單向例外:
 * 07-teach-card → 10-desktop-shell(4c5aa62,用桌面殼的 ReviewClient 與 LearningFs,跟 06 → 10 同理由)、
 * 11-review-cli → 07-teach-card(3d471e4,B-lite:session/teach.ts 用 teach/ 的純函式)= 23;
 * 再加 T43 D8(ADR-079):11-review-cli → 02-ingest-pipeline(f6a9255,深入這個要叫匯入管線)= 24;
 * 再加 T52(ADR-060 第 3 點):12-prompt-quality → 01-data-layer(b515b2c,字數與 example 圍欄只留 01 一份)= 25。
 * 再加 T65(ADR-084):05-grading → 02-ingest-pipeline(2ebc05b,只 import card-file.ts 的 renderCardFile,ADR-082 唯一寫卡函式;
 * 另有 features/support/t65-grading-imports.test.ts 釘「grading/ 對 ingest/ 只准 card-file.js」)= 26。
 * 這個數字釘的是「T31 自己沒有多加一條」;別的工單加例外時,在這裡補上來源再改數字。
 */
const BASE_ALLOW_ENTRIES = 26;

interface AllowEntry {
  from: string;
  to: string;
  reason: string;
}
const allow = (): AllowEntry[] => JSON.parse(read('scripts/boundaries.allow.json')) as AllowEntry[];

describe('訊號目錄(驗收 2)', () => {
  const catalog = DEGRADED_SIGNALS as unknown as Record<string, { kind: string; owner: string; summary: string } | undefined>;

  it('grading.apply.llm-unavailable 已登記:swallow、05-grading、有一句說明', () => {
    const meta = catalog['grading.apply.llm-unavailable'];
    expect(meta, '訊號目錄裡沒有 grading.apply.llm-unavailable').toBeDefined();
    expect(meta!.kind).toBe('swallow');
    expect(meta!.owner).toBe('05-grading');
    expect(meta!.summary.trim().length).toBeGreaterThan(8);
  });

  it('既有的兩個 grading.apply 訊號還在(沒被改名或吃掉)', () => {
    expect(catalog['grading.apply.invalid-response-retry']).toBeDefined();
    expect(catalog['grading.apply.unparsable-skipped']).toBeDefined();
  });

  it('grading.fill.llm-failed-strict 的說明改成「模型不能用或沒有本機模型」,不再寫「呼叫丟錯」', () => {
    const summary = catalog['grading.fill.llm-failed-strict']!.summary;
    expect(summary).toContain('模型不能用');
    expect(summary).toContain('沒有本機模型');
    expect(summary).not.toContain('呼叫丟錯');
  });

  it('grade-apply.ts 有 witness("grading.apply.llm-unavailable") 的呼叫點', () => {
    expect(read('packages/core/src/grading/grade-apply.ts')).toMatch(/witness\(\s*'grading\.apply\.llm-unavailable'\s*\)/);
  });

  it('訊號目錄與程式裡的呼叫點一一對上(沒有未登記的、沒有沒呼叫的)', () => {
    expect(catalogDriftProblems(findCallSites(ROOT))).toEqual([]);
  });
});

describe('boundaries 例外的理由(驗收 6)', () => {
  it('05-grading → 03-llm-router 還是一條,reason 補上 grade-apply.ts、grade-fill.ts 與 llmUnavailableReason,原本的 scripts/grade.ts 還在', () => {
    const entries = allow().filter((e) => e.from === '05-grading' && e.to === '03-llm-router');
    expect(entries).toHaveLength(1);
    const reason = entries[0]!.reason;
    expect(reason).toContain('scripts/grade.ts');
    expect(reason).toContain('createLiveGatewayRouter');
    expect(reason).toContain('grade-apply.ts');
    expect(reason).toContain('grade-fill.ts');
    expect(reason).toContain('llmUnavailableReason');
  });

  it('整份例外清單條數不變(不加新的一條)', () => {
    expect(allow()).toHaveLength(BASE_ALLOW_ENTRIES);
  });
});

describe('分類函式的接線(驗收 1、2、3)', () => {
  const failures = (): string => read('packages/core/src/llm/failures.ts');

  it('failures.ts 存在,匯出 llmUnavailableReason', () => {
    expect(failures()).toMatch(/export function llmUnavailableReason\b/);
  });

  it('SDK 的錯用 instanceof 認,不用 name 比對 APIConnectionError(兩家 SDK 的錯 name 都是 "Error")', () => {
    const src = failures();
    expect(src).toMatch(/instanceof\s+[\w.]*APIConnectionError/);
    expect(src).not.toMatch(/name\s*===?\s*['"`]APIConnection/);
    expect(src).not.toMatch(/\['APIConnectionError['"`]/);
  });

  it('先排除憑證:用 T30 的 credentialProblem', () => {
    expect(failures()).toMatch(/credentialProblem\s*\(/);
  });

  it('網路特徵正規式跟 ingest/questions.ts 的 NETWORK_ERROR_PATTERN 一模一樣,旁邊有「同一份」的註解', () => {
    const ingest = /NETWORK_ERROR_PATTERN\s*=\s*(\/.+\/[a-z]*);/.exec(read('packages/core/src/ingest/questions.ts'));
    expect(ingest, 'ingest/questions.ts 的 NETWORK_ERROR_PATTERN 找不到').not.toBeNull();
    const src = failures();
    expect(src).toContain(ingest![1]!);
    expect(src).toContain('NETWORK_ERROR_PATTERN');
    expect(src).toMatch(/同一份/);
    expect(src).toMatch(/backlog/);
  });

  it('grade-apply.ts、grade-fill.ts 都 import llmUnavailableReason(05 不另寫一份分類)', () => {
    for (const rel of ['packages/core/src/grading/grade-apply.ts', 'packages/core/src/grading/grade-fill.ts']) {
      const src = read(rel);
      expect(src, rel).toMatch(/import\s*\{[^}]*\bllmUnavailableReason\b[^}]*\}\s*from\s*'[^']*llm[^']*'/);
      expect(src, rel).toMatch(/llmUnavailableReason\s*\(/);
    }
  });

  it('gradeApply 不再有沒包 try 的 router.call(grade.apply)', () => {
    const src = read('packages/core/src/grading/grade-apply.ts');
    const idx = src.indexOf("await router.call('grade.apply'");
    expect(idx).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, idx - 200), idx);
    expect(before).toMatch(/try\s*\{/);
  });

  it('gradeFillBlank 的 catch 不再是空的 catch {}', () => {
    const src = read('packages/core/src/grading/grade-fill.ts');
    expect(src).not.toMatch(/catch\s*\{/);
    expect(src).toMatch(/catch\s*\(\s*\w+\s*\)/);
  });
});
