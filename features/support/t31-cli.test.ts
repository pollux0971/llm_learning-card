/**
 * T31 驗收 4:終端機 `scripts/review.ts`——應用題遇到「模型這次不能用」→ 印那句 feedback、繼續下一題、小結有「Retry later: 1」、exit 0,
 * 有答題就照舊 snapshot;程式的 bug 照舊整個停(exit 1、不印小結、不藏成評分失敗)。紅測試作者寫;開發 worker 不改。
 *
 * 跑**真的** `scripts/review.ts` 子程序(量尺 `review-session-harness.ts`;網路層是假的 `--import` 模組 `t31-cloud-down.mjs`,
 * 不打網路、不花錢)。三種「不能用」的成因各一次:雲端 429、連線被拒、閘道 503(沒設 provider 走閘道)。
 *
 * 注意:`scripts/review.ts` 先 `import './_env.js'`,讀簽出根目錄的 `.env`;這裡假設簽出裡沒有 `.env`。有的話整組先擋下來。
 * 一律暫存目錄;題目:sec-0001 是應用題(stage 3,逾期 3 天,先問)、sec-0002 是填空(stage 1,逾期 1 天,後問,精確答案)。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODAY,
  addDays,
  commitCount,
  createVault,
  gitInit,
  readReviews,
  removeVault,
  reviewRecord,
  runReview,
  writeReviews,
  type Vault,
} from './review-session-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const CLOUD_DOWN = join(import.meta.dirname, 't31-cloud-down.mjs');
const TIMEOUT = 240_000;
const FEEDBACK = '這次沒辦法批改(模型暫時連不上),請再試一次。';
const SUMMARY = /\d+ passed, \d+ returned\./;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

function applyThenFillVault(): Vault {
  const v = createVault({ cards: 3 });
  vaults.push(v);
  writeReviews(v, {
    'sec-0001': reviewRecord({ stage: 3, next_due: addDays(TODAY, -3) }),
    'sec-0002': reviewRecord({ stage: 1, next_due: addDays(TODAY, -1) }),
  });
  gitInit(v);
  return v;
}

const CASES: [string, Record<string, string | undefined>][] = [
  ['雲端 429(限流)', { T31_FAKE_MODE: 'cloud-429' }],
  ['連線被拒(fetch failed / ECONNREFUSED)', { T31_FAKE_MODE: 'refused' }],
  ['閘道 503(沒設 provider,應用題走閘道)', { T31_FAKE_MODE: 'gateway-503', LLM_CLOUD_PROVIDER: undefined, GATEWAY_API_KEY: 'fake-gateway-key' }],
];

describe.skipIf(existsSync(join(ROOT, '.env')))('終端機:應用題遇到模型不能用(驗收 4)', () => {
  it.each(CASES)(
    '%s:印 feedback、繼續下一題(填空題照常記進 reviews.json)、小結有 Retry later: 1、exit 0、有答題就 snapshot',
    async (_name, env) => {
      const v = applyThenFillVault();
      const before = commitCount(v);
      const out = await runReview(v, { fakeCloud: CLOUD_DOWN, env });
      expect(out.status, out.output).toBe(0);
      expect(out.stdout).toContain(FEEDBACK);
      expect(out.stdout).toMatch(SUMMARY);
      expect(out.stdout).toContain('Retry later: 1 question(s).');
      expect(out.stdout, '不是舊的「有 grading error」那一行').not.toMatch(/had a grading error/);
      const reviews = readReviews(v);
      expect(reviews['sec-0001']!.history.filter((h) => h.date === TODAY), '被批改失敗的應用題:沒前進也沒退回').toHaveLength(0);
      expect(reviews['sec-0001']!.stage).toBe(3);
      expect(reviews['sec-0002']!.history.filter((h) => h.date === TODAY), '後面的填空題照常答完').toHaveLength(1);
      expect(commitCount(v), '有答題就照舊 snapshot').toBe(before + 1);
      expect(out.output).not.toMatch(/Rate limit reached|ECONNREFUSED|upstream down/);
    },
    TIMEOUT,
  );

  it(
    '程式的 bug 不藏:雲端回了不是 chat completion 的內容(adapter 丟 TypeError)→ exit 1、不印小結、不 snapshot、不印評分失敗那句',
    async () => {
      const v = applyThenFillVault();
      const before = commitCount(v);
      const out = await runReview(v, { fakeCloud: CLOUD_DOWN, env: { T31_FAKE_MODE: 'bug-body' } });
      expect(out.status, out.output).toBe(1);
      expect(out.stdout).not.toMatch(SUMMARY);
      expect(out.stdout).not.toContain(FEEDBACK);
      expect(commitCount(v)).toBe(before);
      expect(readReviews(v)['sec-0001']!.history.filter((h) => h.date === TODAY)).toHaveLength(0);
    },
    TIMEOUT,
  );
});
