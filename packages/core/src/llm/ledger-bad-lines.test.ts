/**
 * T8 驗收 A(壞行 = 不知道)的紅測試。測試 agent 寫;開發 agent 只寫實作,不改這個檔。
 *
 * 規則:帳本裡只要有一行壞掉,今日花費就是「不知道」——`readDailySpend` 丟錯、不回任何數字,
 * router 在打 adapter 之前就拒絕。跳過壞行 = 低估花費 = 「還可以繼續花」,錢的方向上不能這樣錯。
 * 壞行的定義只有一份(spend.ts),`scripts/llm-spend.ts` 引用同一份。
 *
 * 新錯誤類別的名字固定為 `UnknownSpendError`(從 spend.ts 匯出)。用 namespace 取它而不是具名 import,
 * 這樣實作之前 `tsc` 仍然是綠的,紅的是這些測試本身。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GatewayClient } from './adapters/gateway.js';
import { ExplicitLedger, VerifiedLedger, resolveVerifiedLedger, type VaultResolveDeps } from './ledger.js';
import { GatewayLlmRouter } from './router-gateway.js';
import * as spend from './spend.js';
import type { CloudAdapter } from './types.js';

const { readDailySpend } = spend;
const UnknownSpendError = (spend as Record<string, unknown>).UnknownSpendError as (new (...args: never[]) => Error) | undefined;
const PRICES = { inPerM: 2.5, outPerM: 10 };
const DAY = '2026-10-15';
const LOCAL_MODEL = 'qwen2.5:32b';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `t8-${prefix}-`));
  dirs.push(d);
  return d;
}

function call(day = DAY, tokensIn = 1_000_000): string {
  return JSON.stringify({ ts: `${day}T10:00:00Z`, type: 'llm_call', provider: 'openai', model: 'gpt-x', tokens_in: tokensIn, tokens_out: 0 });
}

function writeLog(lines: string[]): string {
  const dir = tmp('log');
  const path = join(dir, 'log.jsonl');
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return path;
}

function explicit(path: string): ExplicitLedger {
  return ExplicitLedger.unverified(path, 'T8 test');
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('T8 A:新錯誤類別存在,而且不是 MissingLedgerError', () => {
  it('spend.ts 匯出 UnknownSpendError(extends Error),name 是 UnknownSpendError', () => {
    expect(UnknownSpendError).toBeTypeOf('function');
    const path = writeLog([call(), 'not json']);
    const err = thrown(() => readDailySpend(explicit(path), DAY, PRICES));
    expect(err).toBeInstanceOf(UnknownSpendError!);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('UnknownSpendError');
    expect(err).not.toBeInstanceOf(spend.MissingLedgerError);
  });
});

describe('T8 A:readDailySpend 遇到壞行就丟錯,不回任何數字', () => {
  it('對照:全是好行 → 算得出來(兩行各 1M tokens = $5)', () => {
    const path = writeLog([call(), call()]);
    expect(readDailySpend(explicit(path), DAY, PRICES)).toEqual({ usd: 5, calls: 2 });
  });

  it.each([
    ['JSON 被截斷', '{"ts":"2026-10-15T10:00:00Z","type":"llm_call","provider":"openai"'],
    ['不是 JSON', 'not json at all'],
    ['JSON 是陣列', '[1,2,3]'],
    ['JSON 是字串', '"hello"'],
    ['JSON 是數字', '42'],
    ['JSON 是 null', 'null'],
    ['ts 存在卻是數字', '{"ts":1760000000,"type":"llm_call","provider":"openai","tokens_in":1000000,"tokens_out":0}'],
    ['ts 存在卻是 null', '{"ts":null,"type":"llm_call"}'],
  ])('must_catch: 壞行被跳過而不是不知道 —— %s', (_label, bad) => {
    const path = writeLog([call(), bad, call()]);
    const err = thrown(() => readDailySpend(explicit(path), DAY, PRICES));
    // 回了任何數字(例如 $5 的兩行好行)就是低估:這裡必須是丟錯。
    expect(err, `壞行 ${bad} 被跳過了`).toBeInstanceOf(UnknownSpendError!);
  });

  it('壞行不分哪一天:歷史上的壞行也是不知道(讀不到 ts,證明不了它不是今天的)', () => {
    const path = writeLog([call('2026-01-02'), 'garbage from last month', call()]);
    expect(thrown(() => readDailySpend(explicit(path), DAY, PRICES))).toBeInstanceOf(UnknownSpendError!);
  });

  it('壞行在檔案第一行、最後一行(沒有結尾換行)、中間都算', () => {
    for (const lines of [['bad', call()], [call(), 'bad'], [call(), 'bad', call()]]) {
      const path = writeLog([]);
      writeFileSync(path, lines.join('\n'), 'utf8'); // 刻意不留結尾換行
      expect(thrown(() => readDailySpend(explicit(path), DAY, PRICES))).toBeInstanceOf(UnknownSpendError!);
    }
  });

  it('不是壞行的:空白行、只有空白的行、沒有 ts 的物件——照常算,不丟錯', () => {
    const path = writeLog([call(), '', '   ', '\t', JSON.stringify({ type: 'other' }), call()]);
    expect(readDailySpend(explicit(path), DAY, PRICES)).toEqual({ usd: 5, calls: 2 });
  });

  it('帳本檔不存在仍是 0(全新安裝,合法)——壞行規則沒有把它誤傷', () => {
    const path = join(tmp('none'), 'nope.jsonl');
    expect(readDailySpend(explicit(path), DAY, PRICES)).toEqual({ usd: 0, calls: 0 });
  });

  it('驗證過的帳本(VerifiedLedger)行為相同', () => {
    const root = tmp('vault');
    const learning = join(root, 'learning');
    mkdirSync(join(learning, 'config'), { recursive: true });
    mkdirSync(join(learning, 'state'), { recursive: true });
    writeFileSync(join(learning, 'config', 'vault-id'), `${UUID}\n`);
    writeFileSync(join(learning, 'state', 'log.jsonl'), `${call()}\nnot json\n`);
    const config = join(root, 'xdg');
    mkdirSync(join(config, 'llm-learning-cards'), { recursive: true });
    writeFileSync(join(config, 'llm-learning-cards', 'vault.json'), JSON.stringify({ learning_dir: learning, vault_id: UUID }));
    const deps: VaultResolveDeps = {
      env: { XDG_CONFIG_HOME: config },
      homedir: () => root,
      readFile: (p) => readFileSync(p, 'utf8'),
      exists: (p) => {
        try {
          statSync(p);
          return true;
        } catch {
          return false;
        }
      },
    };
    const resolved = resolveVerifiedLedger(deps);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.ledger).toBeInstanceOf(VerifiedLedger);
    expect(thrown(() => readDailySpend(resolved.ledger, DAY, PRICES))).toBeInstanceOf(UnknownSpendError!);
  });
});

describe('T8 A:錯誤訊息要讓人修得了帳本', () => {
  it('帶出帳本路徑、1-based 行號、該行前 80 字,並指示去跑 npx tsx scripts/llm-spend.ts', () => {
    const longBad = `BAD-${'x'.repeat(200)}-END`;
    const path = writeLog([call(), call(), longBad, call()]);
    const err = thrown(() => readDailySpend(explicit(path), DAY, PRICES)) as Error;
    expect(err).toBeInstanceOf(UnknownSpendError!);
    const msg = err.message;
    expect(msg).toContain(path);
    expect(msg).toMatch(/第\s*3\s*行/);
    expect(msg).toContain(longBad.slice(0, 80));
    expect(msg).not.toContain(longBad.slice(0, 81));
    expect(msg).not.toContain('-END');
    expect(msg).toContain('npx tsx scripts/llm-spend.ts');
  });

  it('多個壞行:訊息指出第一個壞行的行號(先修第一個)', () => {
    const path = writeLog([call(), 'bad one', 'bad two']);
    const msg = (thrown(() => readDailySpend(explicit(path), DAY, PRICES)) as Error).message;
    expect(msg).toMatch(/第\s*2\s*行/);
    expect(msg).toContain('bad one');
  });
});

describe('T8 A:router 在打 adapter 之前就拒絕', () => {
  function harness(logPath: string): { router: GatewayLlmRouter; cloudCalls: () => number; gatewayChats: () => number } {
    let cloud = 0;
    let chats = 0;
    const adapter: CloudAdapter = {
      async call({ prompt, model }) {
        cloud += 1;
        return { text: `雲端:${prompt}`, provider: 'openai', model, latency_ms: 1, tokens_in: 10, tokens_out: 0 };
      },
    };
    const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/auth/token/exchange')) return json({ access_token: 'jwt', expires_in: 3600 });
      if (url.includes('/gateway/models')) return json({ auto_match: true, models: { [LOCAL_MODEL]: ['chat'] } });
      if (url.includes('/gateway/chat')) {
        chats += 1;
        return json({ content: '閘道', provider: 'ollama', model: LOCAL_MODEL, tokens_used: { prompt: 1, completion: 1 } });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const router = new GatewayLlmRouter({
      env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'gpt-5.6-luna', OPENAI_API_KEY: 'k', LLM_LOCAL_MODEL: LOCAL_MODEL },
      adapters: { openai: adapter, anthropic: adapter },
      onlineProber: async () => true,
      localProber: async () => ({ available: false, models: [] }),
      gateway: new GatewayClient({ config: { baseUrl: 'http://gateway.test:8787', apiKey: 'gk', model: LOCAL_MODEL }, fetchImpl }),
      dailyCapUsd: 1,
      prices: PRICES,
      today: () => DAY,
      ledger: ExplicitLedger.unverified(logPath, 'T8 router test'),
    });
    return { router, cloudCalls: () => cloud, gatewayChats: () => chats };
  }

  it('must_catch: 有壞行時 router 仍打了雲端或閘道 —— cloud-only 任務(ingest.cards):雲端 0 次、閘道 0 次,錯誤原樣丟出', async () => {
    const path = writeLog([call(), 'bad line']);
    const h = harness(path);
    const err = await h.router.call('ingest.cards', '第 1 次').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnknownSpendError!);
    expect(h.cloudCalls()).toBe(0);
    expect(h.gatewayChats()).toBe(0);
  });

  it('gateway-fallback 任務(deepen):也是拒絕,不是「當作預算沒滿」放行到雲端,也不是偷偷改走閘道', async () => {
    const path = writeLog(['bad line']);
    const h = harness(path);
    const err = await h.router.call('deepen', '同源政策').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnknownSpendError!);
    expect(h.cloudCalls()).toBe(0);
    expect(h.gatewayChats()).toBe(0);
  });

  it('每一次呼叫都拒絕(不是只有第一次):連續 3 次,雲端與閘道仍是 0 次', async () => {
    const path = writeLog([call(), 'bad line']);
    const h = harness(path);
    for (let i = 0; i < 3; i++) {
      const err = await h.router.call('ingest.cards', `第 ${i + 1} 次`).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(UnknownSpendError!);
    }
    expect(h.cloudCalls()).toBe(0);
    expect(h.gatewayChats()).toBe(0);
  });

  it('dailySpend() 與 budgetExhausted() 每一次都丟錯,沒有任何一次回數字', () => {
    const path = writeLog([call(), 'bad line']);
    const { router } = harness(path);
    for (let i = 0; i < 3; i++) {
      expect(() => router.dailySpend()).toThrow(UnknownSpendError!);
      expect(() => router.budgetExhausted()).toThrow(UnknownSpendError!);
    }
  });

  it('壞行修好之後(移除那一行)呼叫恢復正常——拒絕不是永久狀態', async () => {
    const path = writeLog([call(), 'bad line']);
    const h = harness(path);
    await expect(h.router.call('ingest.cards', '壞行時')).rejects.toThrow(UnknownSpendError!);
    writeFileSync(path, `${call()}\n`, 'utf8');
    const ok = await h.router.call('ingest.cards', '修好之後');
    expect(ok.text).toContain('修好之後');
    expect(h.cloudCalls()).toBe(1);
  });
});

describe('T8 A:壞行判定只有一份,而且舊的 witness 訊號隨程式一起消失', () => {
  const ROOT = join(dirname(new URL(import.meta.url).pathname), '../../../..');

  /** 非註解的程式行(很粗:去掉以 `//`、`*`、`/*` 開頭的行)。 */
  function codeLines(relPath: string): string[] {
    return readFileSync(join(ROOT, relPath), 'utf8')
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      });
  }

  it('帳本行的 JSON.parse 在 spend.ts 與 scripts/llm-spend.ts 加起來恰好一處(不留兩份判定)', () => {
    const hits = [...codeLines('packages/core/src/llm/spend.ts'), ...codeLines('scripts/llm-spend.ts')].filter((l) => l.includes('JSON.parse('));
    expect(hits).toHaveLength(1);
  });

  it('llm.spend.bad-line-skipped:程式裡沒有呼叫點,witness 目錄裡也沒有這個訊號(ADR-047)', () => {
    const calls = codeLines('packages/core/src/llm/spend.ts').filter((l) => l.includes('bad-line-skipped'));
    expect(calls).toEqual([]);
    const catalog = readFileSync(join(ROOT, 'packages/contracts/src/witness.ts'), 'utf8');
    expect(catalog).not.toContain('llm.spend.bad-line-skipped');
  });
});
