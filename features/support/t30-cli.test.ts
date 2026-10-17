/**
 * T30 驗收 5:終端機 `scripts/review.ts` 缺金鑰與金鑰被拒。紅測試作者寫;開發 worker 不改。
 *
 * 跑**真的** `scripts/review.ts` 子程序(量尺 `features/support/review-session-harness.ts`;網路層是假的 `--import` 模組,
 * 不打網路、不花錢)。子程序環境由量尺佈置(provider openai、假鍵),各測試用 `env` 覆蓋(undefined = 刪掉)。
 *
 * 範圍:
 *   - 互動模式在 `liveRouterOrExit`(驗帳本)之後、`openDay` 之前查 `missingGradingKeys(process.env)`:
 *     缺 → stderr 印 `credentialMessage` 那一句、exit 2;這時還沒建當日快取、不 snapshot、不改 reviews.json;
 *   - `--dry-run`、`--pause`、暫停日的互動執行不評分,不查金鑰(照舊);
 *   - 答題時批改丟憑證錯誤(假雲端回 401)→ 印同一種樣板句、exit 2,不印小結、不 snapshot;之前答過的照舊已寫進 reviews.json;
 *   - 終端機一次跑完就結束,不重讀 `.env`(這裡不量,沒有可量的外顯行為)。
 *
 * 注意:`scripts/review.ts` 先 `import './_env.js'`,讀簽出根目錄的 `.env`;這裡假設簽出裡沒有 `.env`
 * (乾淨簽出本來就沒有)。有的話「沒有鍵」的測試會讀到它的鍵,所以整組先擋下來。
 * 一律暫存目錄;題目只用填空(精確答案)與一題會被 401 的應用題。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODAY,
  cacheBase,
  commitCount,
  createVault,
  gitInit,
  listTree,
  readReviews,
  removeVault,
  reviewRecord,
  addDays,
  runReview,
  seedDue,
  writeReviews,
  type RunOut,
  type Vault,
} from './review-session-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const CLOUD_401 = join(import.meta.dirname, 't30-cloud-401.mjs');
const TIMEOUT = 240_000;
const MISSING = (key: string): string => `批改要用的金鑰沒有設定:${key}。請在專案根目錄的 .env 加上。`;
const REJECTED = (key: string): string => `批改用的金鑰被拒絕:${key}(可能過期或打錯)。請在專案根目錄的 .env 換一個。`;
const SUMMARY = /\d+ passed, \d+ returned\./;
const NO_KEYS = { LLM_CLOUD_PROVIDER: undefined, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, GATEWAY_API_KEY: undefined } as const;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

/** sec-0001 逾期兩天、sec-0002 今天到期,都是 stage 1(填空);learning/ 是 git repo(看 snapshot) */
function fillVault(): Vault {
  const v = createVault({ cards: 3 });
  vaults.push(v);
  seedDue(v, ['sec-0001', 'sec-0002'], [2, 0]);
  gitInit(v);
  return v;
}

function nothingBuilt(v: Vault, out: RunOut, commitsBefore: number): void {
  expect(listTree(cacheBase(v)).filter((f) => /session-.*\.json$/.test(f)), '沒有建當日快取').toEqual([]);
  expect(commitCount(v), '沒有 snapshot').toBe(commitsBefore);
  expect(out.asked, '沒有出任何題').toEqual([]);
  expect(out.stdout).not.toMatch(SUMMARY);
}

describe.skipIf(existsSync(join(ROOT, '.env')))('終端機缺金鑰(驗收 5)', () => {
  it(
    '沒設 provider、沒有閘道鍵:stderr 印「沒有設定」那一句(指名 GATEWAY_API_KEY)、exit 2,沒建快取、沒 snapshot',
    async () => {
      const v = fillVault();
      const before = commitCount(v);
      const reviewsBefore = JSON.stringify(readReviews(v));
      const out = await runReview(v, { env: { ...NO_KEYS, OPENAI_API_KEY: 'fake-key', ANTHROPIC_API_KEY: 'fake-key' } });
      expect(out.status, out.output).toBe(2);
      expect(out.stderr.split('\n')).toContain(MISSING('GATEWAY_API_KEY'));
      nothingBuilt(v, out, before);
      expect(JSON.stringify(readReviews(v))).toBe(reviewsBefore);
    },
    TIMEOUT,
  );

  it.each([
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
  ])(
    'provider = %s 沒有 %s(其他鍵都有)→ 指名那個鍵',
    async (provider, key) => {
      const v = fillVault();
      const before = commitCount(v);
      const env: Record<string, string | undefined> = { ...NO_KEYS, LLM_CLOUD_PROVIDER: provider, OPENAI_API_KEY: 'fake-key', ANTHROPIC_API_KEY: 'fake-key', GATEWAY_API_KEY: 'fake-key' };
      env[key] = undefined;
      const out = await runReview(v, { env });
      expect(out.status, out.output).toBe(2);
      expect(out.stderr.split('\n')).toContain(MISSING(key));
      nothingBuilt(v, out, before);
    },
    TIMEOUT,
  );

  it(
    '訊息不帶鍵的值或絕對路徑',
    async () => {
      const v = fillVault();
      const out = await runReview(v, { env: { ...NO_KEYS, OPENAI_API_KEY: 'fake-key-VALUE-1234' } });
      expect(out.output).not.toContain('VALUE-1234');
      expect(out.output).not.toContain(v.dir);
    },
    TIMEOUT,
  );

  it(
    '沒設 provider、只有閘道鍵 → 不擋(要的鍵有了),正常答完、出小結(守「別擋過頭」)',
    async () => {
      const v = fillVault();
      const out = await runReview(v, { env: { ...NO_KEYS, GATEWAY_API_KEY: 'fake-key' } });
      expect(out.status, out.output).toBe(0);
      expect(out.stdout).toMatch(SUMMARY);
    },
    TIMEOUT,
  );

  it(
    '--dry-run、--pause 不評分,沒有金鑰也照常(exit 0)',
    async () => {
      const v = fillVault();
      const dry = await runReview(v, { args: ['--dry-run'], env: { ...NO_KEYS } });
      expect(dry.status, dry.output).toBe(0);
      const pause = await runReview(v, { args: ['--pause'], env: { ...NO_KEYS } });
      expect(pause.status, pause.output).toBe(0);
    },
    TIMEOUT,
  );

  it(
    '今天已暫停的互動執行:印暫停訊息、exit 0,不查金鑰',
    async () => {
      const v = fillVault();
      const pause = await runReview(v, { args: ['--pause'], env: { ...NO_KEYS } });
      expect(pause.status, pause.output).toBe(0);
      const again = await runReview(v, { rawArgs: ['--dir', v.dir, '--today', TODAY], env: { ...NO_KEYS } });
      expect(again.status, again.output).toBe(0);
      expect(again.stdout).toContain('今天已暫停');
      expect(again.stderr).not.toContain('金鑰');
    },
    TIMEOUT,
  );
});

describe('終端機答題時金鑰被拒(驗收 5)', () => {
  it(
    '第一張填空答完寫進 reviews.json,第二張應用題遇到 401 → 印「被拒絕」那一句(指名 OPENAI_API_KEY)、exit 2、不印小結、不 snapshot',
    async () => {
      const v = createVault({ cards: 3 });
      vaults.push(v);
      writeReviews(v, {
        'sec-0001': reviewRecord({ stage: 1, next_due: addDays(TODAY, -3) }),
        'sec-0002': reviewRecord({ stage: 3, next_due: addDays(TODAY, -1) }),
      });
      gitInit(v);
      const before = commitCount(v);
      const out = await runReview(v, { fakeCloud: CLOUD_401 });
      expect(out.status, out.output).toBe(2);
      expect(out.stderr.split('\n')).toContain(REJECTED('OPENAI_API_KEY'));
      expect(out.stdout, '不印小結').not.toMatch(SUMMARY);
      expect(commitCount(v), '不 snapshot').toBe(before);
      const reviews = readReviews(v);
      expect(reviews['sec-0001']!.history.filter((h) => h.date === TODAY), '之前答過的照舊已寫進去').toHaveLength(1);
      expect(reviews['sec-0002']!.history.filter((h) => h.date === TODAY), '被 401 的那題沒寫').toHaveLength(0);
      expect(out.output).not.toContain('Incorrect API key');
    },
    TIMEOUT,
  );
});
