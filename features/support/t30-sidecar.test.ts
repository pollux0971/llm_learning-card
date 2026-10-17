/**
 * T30 驗收 2、3:**真的**側車行程(`scripts/review-sidecar.ts`)上的金鑰檢查與「今天」,加上接線的靜態檢查。
 * 紅測試作者寫;開發 worker 不改。
 *
 * 側車子行程的環境由量尺 `childEnv` 佈置(假雲端 `LC_REVIEW_FAKE_CLOUD`、`LLM_CLOUD_PROVIDER=openai`、假鍵),
 * 各測試再用 `env` 覆蓋成要的樣子(undefined = 刪掉那個變數)。不打網路、不花錢;全部暫存目錄。
 *
 * 注意:側車先 `import './_env.js'` 讀的是**簽出根目錄的 `.env`**。這裡的測試假設簽出裡沒有 `.env`
 * (驗收用的乾淨簽出本來就沒有,見 worker-acceptance §2);有的話下面「沒有鍵」的測試會讀到它的鍵,所以先擋下來。
 * `.env` 重讀與 `LC_REVIEW_` 不從檔案設的行為在 `features/support/t30-env.test.ts`(複製 `_env.ts` 到暫存目錄量),
 * 不在這裡寫簽出裡的 `.env`。
 *
 * 本來就綠(基底上已成立,守不退步):LC_REVIEW_TODAY 固定日期、沒設時用本機日期、有鍵時 start 照常 ready。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  TODAY,
  addDays,
  createVault,
  removeVault,
  reviewRecord,
  writeReviews,
  type Vault,
} from './review-session-harness.js';
import { request, spawnSidecar, type Sidecar } from './review-sidecar-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const TIMEOUT = 240_000;
const MISSING = (key: string): string => `批改要用的金鑰沒有設定:${key}。請在專案根目錄的 .env 加上。`;
const NO_KEYS = { LLM_CLOUD_PROVIDER: undefined, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, GATEWAY_API_KEY: undefined } as const;
const HAS_REPO_ENV = existsSync(join(ROOT, '.env'));

const vaults: Vault[] = [];
const procs: Sidecar[] = [];
afterEach(() => {
  for (const p of procs.splice(0)) p.kill();
});
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

function vault(): Vault {
  const v = createVault({ cards: 6 });
  vaults.push(v);
  writeReviews(v, {
    'sec-0001': reviewRecord({ stage: 1, next_due: addDays(TODAY, -3) }),
    'sec-0002': reviewRecord({ stage: 1, next_due: addDays(TODAY, -2) }),
    'sec-0003': reviewRecord({ stage: 3, next_due: addDays(TODAY, -1) }),
  });
  return v;
}
function start(v: Vault, opts: Parameters<typeof spawnSidecar>[1] = {}): Sidecar {
  const p = spawnSidecar(v, opts);
  procs.push(p);
  return p;
}
async function hello(p: Sidecar): Promise<Record<string, unknown>> {
  return JSON.parse((await p.nextLine(60_000)) ?? 'null') as Record<string, unknown>;
}
const localToday = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

describe.skipIf(HAS_REPO_ENV)('真側車:start 缺金鑰(驗收 2)', () => {
  it(
    '沒設 provider、沒有閘道鍵(雲端的鍵都有):start 回 credential-unavailable,訊息指名 GATEWAY_API_KEY;app 不用關,側車還活著',
    async () => {
      const v = vault();
      const p = start(v, { env: { ...NO_KEYS, OPENAI_API_KEY: 'fake-key', ANTHROPIC_API_KEY: 'fake-key' } });
      expect(await hello(p)).toMatchObject({ kind: 'hello', fakeCloud: true });
      const res = await request(p, 1, 'start');
      expect(res).toMatchObject({ v: 1, id: 1, ok: false, error: { kind: 'credential-unavailable', message: MISSING('GATEWAY_API_KEY') } });
      expect(p.isAlive()).toBe(true);
      expect(p.stderr()).toContain('[review-sidecar] credential-unavailable');
      // 同一個行程還能回答別的請求
      expect(await request(p, 2, 'status')).toMatchObject({ ok: true });
    },
    TIMEOUT,
  );

  it(
    'provider = anthropic 但沒有 ANTHROPIC_API_KEY(其他鍵都有)→ 指名 ANTHROPIC_API_KEY',
    async () => {
      const v = vault();
      const p = start(v, { env: { ...NO_KEYS, LLM_CLOUD_PROVIDER: 'anthropic', OPENAI_API_KEY: 'fake-key', GATEWAY_API_KEY: 'fake-key' } });
      await hello(p);
      const res = await request(p, 1, 'start');
      expect(res).toMatchObject({ ok: false, error: { kind: 'credential-unavailable', message: MISSING('ANTHROPIC_API_KEY') } });
    },
    TIMEOUT,
  );

  it(
    'provider = openai 但沒有 OPENAI_API_KEY → 指名 OPENAI_API_KEY',
    async () => {
      const v = vault();
      const p = start(v, { env: { ...NO_KEYS, LLM_CLOUD_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'fake-key', GATEWAY_API_KEY: 'fake-key' } });
      await hello(p);
      const res = await request(p, 1, 'start');
      expect(res).toMatchObject({ ok: false, error: { kind: 'credential-unavailable', message: MISSING('OPENAI_API_KEY') } });
    },
    TIMEOUT,
  );

  it(
    '訊息裡沒有任何鍵的值;stdout 只有協定行',
    async () => {
      const v = vault();
      const p = start(v, { env: { ...NO_KEYS, OPENAI_API_KEY: 'fake-key-VALUE-1234' } });
      await hello(p);
      await request(p, 1, 'start');
      for (const line of p.stdoutLines) {
        expect(line).not.toContain('VALUE-1234');
        expect((JSON.parse(line) as { v?: unknown }).v).toBe(1);
      }
      expect(p.stderr()).not.toContain('VALUE-1234');
    },
    TIMEOUT,
  );

  it(
    '失敗的 start 沒有建當日快取、reviews.json 沒動',
    async () => {
      const v = vault();
      const before = readFileSync(join(v.dir, 'state/reviews.json'), 'utf8');
      const p = start(v, { env: { ...NO_KEYS } });
      await hello(p);
      await request(p, 1, 'start');
      expect(readFileSync(join(v.dir, 'state/reviews.json'), 'utf8')).toBe(before);
      expect(await request(p, 2, 'next')).toMatchObject({ ok: false, error: { kind: 'no-session' } });
    },
    TIMEOUT,
  );

  it(
    '要的鍵有設就照常 ready(沒設 provider + 只有閘道鍵;provider = openai + 只有 OpenAI 鍵)',
    async () => {
      const v1 = vault();
      const gateway = start(v1, { env: { ...NO_KEYS, GATEWAY_API_KEY: 'fake-key' } });
      await hello(gateway);
      expect(await request(gateway, 1, 'start')).toMatchObject({ ok: true, result: { state: 'ready', total: 3 } });
      const v2 = vault();
      const openai = start(v2, { env: { ...NO_KEYS, LLM_CLOUD_PROVIDER: 'openai', OPENAI_API_KEY: 'fake-key' } });
      await hello(openai);
      expect(await request(openai, 1, 'start')).toMatchObject({ ok: true, result: { state: 'ready', total: 3 } });
    },
    TIMEOUT,
  );
});

describe('真側車:今天(驗收 2)', () => {
  it(
    '設了 LC_REVIEW_TODAY:hello 與每次 start 的 today 都是那一天(不換成真的日期)',
    async () => {
      const v = vault();
      const p = start(v, { today: TODAY });
      expect(await hello(p)).toMatchObject({ today: TODAY });
      expect(await request(p, 1, 'start')).toMatchObject({ ok: true, result: { today: TODAY } });
      expect(await request(p, 2, 'start')).toMatchObject({ ok: true, result: { today: TODAY } });
    },
    TIMEOUT,
  );

  it(
    '沒設 LC_REVIEW_TODAY:start 的 today 是本機日期',
    async () => {
      const v = vault();
      const p = start(v, { today: null });
      const h = await hello(p);
      const res = await request(p, 1, 'start');
      expect(h.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const expected = localToday();
      // 剛好跨午夜的極小機率:接受 hello 或現在的日期
      expect([h.today, expected]).toContain((res.result as { today?: string } | undefined)?.today);
    },
    TIMEOUT,
  );
});

describe('接線(靜態,驗收 2、3)', () => {
  const sidecar = (): string => readFileSync(join(ROOT, 'scripts/review-sidecar.ts'), 'utf8');

  it('review-sidecar.ts 用 _env.ts 的 loadDotEnv 當 reloadEnv', () => {
    const src = sidecar();
    expect(src).toMatch(/\bloadDotEnv\b/);
    expect(src).toMatch(/\breloadEnv\b/);
  });

  it('missingKeys 用 missingGradingKeys(process.env)', () => {
    const src = sidecar();
    expect(src).toMatch(/\bmissingKeys\b/);
    expect(src).toMatch(/missingGradingKeys\s*\(\s*process\.env\s*\)/);
  });

  it('「今天」沒設 LC_REVIEW_TODAY 時傳 localToday 這個函式本身(每次 start 才算);hello 的 today 仍可以起來時算一次', () => {
    const src = sidecar();
    // 有一處用到 localToday 但後面沒有接 `(`(宣告 `function localToday(` 與呼叫 `localToday()` 都不算)
    expect(src).toMatch(/\blocalToday\b(?!\s*\()/);
  });

  it('createReviewHandler 的 today 傳的是函式來源,不是起來時算好的那個字串變數', () => {
    const src = sidecar();
    const call = /createReviewHandler\(\{([^]*?)\n  \}\)/.exec(src);
    expect(call, '找不到 createReviewHandler({…})').not.toBeNull();
    const body = call![1]!;
    expect(body).toMatch(/\btoday\s*:/);
    expect(body).not.toMatch(/\btoday\s*,/);
    expect(body).not.toMatch(/\btoday\s*:\s*today\s*[,\n]/);
  });

  it('LC_REVIEW_FAKE_CLOUD 只在起來時讀一次(不在 reloadEnv / start 裡再讀)', () => {
    const src = sidecar();
    expect((src.match(/LC_REVIEW_FAKE_CLOUD/g) ?? []).length).toBe(1);
  });

  it('handler.ts 的 today 型別是 string | (() => string),protocol.ts 有 credential-unavailable', () => {
    const handler = readFileSync(join(ROOT, 'packages/core/src/session/handler.ts'), 'utf8');
    expect(handler).toMatch(/today:\s*string\s*\|\s*\(\s*\(\s*\)\s*=>\s*string\s*\)/);
    expect(handler).toMatch(/reloadEnv\?/);
    expect(handler).toMatch(/missingKeys\?/);
    const protocol = readFileSync(join(ROOT, 'packages/core/src/session/protocol.ts'), 'utf8');
    expect(protocol).toContain("'credential-unavailable'");
  });

  it('只有 _env.ts 讀 .env(library 只讀 process.env,ADR-034):handler / credentials / router 不碰 .env 檔', () => {
    for (const rel of ['packages/core/src/session/handler.ts', 'packages/core/src/llm/credentials.ts', 'packages/core/src/llm/router.ts']) {
      const path = join(ROOT, rel);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, 'utf8');
      expect(src, rel).not.toMatch(/loadEnvFile|parseEnv|readFileSync\([^)]*\.env/);
    }
  });
});
