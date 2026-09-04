/**
 * phase-2 的 `--live` 路徑。
 *
 * **不打真 API,但也不繞過 router**:造假只在最外層的網路邊界(globalThis.fetch),
 * 所以 03 的 LlmRouterImpl / CloudLlmRouter / anthropicAdapter / Anthropic SDK 全都跑真的
 * ——這正是這個 phase 要驗的東西(理由同 features/steps/_fake-cloud.mjs 的註解)。
 * 換成注入一個假 router 就等於什麼都沒驗到。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmRouterImpl } from '@core/llm/index.js';
import type { LogEvent } from '@contracts/index.js';
import {
  DEFAULT_GOLDEN_BASE_DIR,
  DEFAULT_FAKE_GOLDEN_BASE_DIR,
  LiveRunOfflineError,
  defaultGoldenBaseDir,
  estimateCostUsd,
  runGolden,
  type ModelPriceTable,
} from './golden-run.js';
import type { GoldenRunMeta, LlmRouter } from './types.js';

const MODEL = 'claude-sonnet-5';
const PRICES: ModelPriceTable = { [MODEL]: { inPerMTok: 3, outPerMTok: 15 } };

const tmpDirs: string[] = [];
function tmpOutDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pq-live-'));
  tmpDirs.push(d);
  return d;
}

let realFetch: typeof globalThis.fetch;
/** 這次測試裡假雲端收到的請求,用來斷言「真的走了網路邊界」與呼叫次數 */
let requests: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** grade.apply 的合法輸出:criteria 長度 2..4(契約 §5),結構性檢查會過 */
const REPLY_TEXT = JSON.stringify({ criteria: [true, false], feedback: '方向對,細節再補' });

/** @param online false 時 /v1/models 回 500,CloudLlmRouter.probeOnline() 就會判定離線 */
function installFakeCloud(online = true): void {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url.includes('/v1/models')) return jsonResponse({ data: [] }, online ? 200 : 500);
    if (url.includes('/v1/messages')) {
      const raw = init?.body ?? '';
      const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer)) as {
        model?: string;
      };
      return jsonResponse({
        id: 'msg_fake', type: 'message', role: 'assistant', model: body.model ?? MODEL,
        content: [{ type: 'text', text: REPLY_TEXT }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40 },
      });
    }
    throw new Error(`live-run.test 沒有預期到的請求:${url}`);
  }) as typeof globalThis.fetch;
}

function liveEnv(): NodeJS.ProcessEnv {
  return { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: MODEL, ANTHROPIC_API_KEY: 'test-key' };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeRouter(log?: LogEvent[]): LlmRouter {
  return new LlmRouterImpl({
    env: liveEnv(),
    ...(log ? { logAppender: (e: LogEvent) => log.push(e) } : {}),
  });
}

describe('runGolden --live:存放位置', () => {
  it('live 的預設存放處是進 git 的 golden/,不是 golden-fake/', () => {
    expect(defaultGoldenBaseDir('live')).toBe(DEFAULT_GOLDEN_BASE_DIR);
    expect(defaultGoldenBaseDir('fake')).toBe(DEFAULT_FAKE_GOLDEN_BASE_DIR);
  });
});

describe('runGolden --live:線上', () => {
  beforeEach(() => installFakeCloud(true));

  it('用設定的雲端模型跑,每個輸入一個輸出檔,meta.mode 是 live', async () => {
    const out = tmpOutDir();
    const result = await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() });

    expect(result.meta.mode).toBe('live');
    expect(result.meta.provider).toBe('anthropic');
    expect(result.meta.model).toBe(MODEL);
    expect(result.outputs).toHaveLength(3);
    expect(readdirSync(result.dir).filter((f) => f.endsWith('.output.json'))).toHaveLength(3);
    expect(existsSync(join(result.dir, 'prompt.snapshot.md'))).toBe(true);
    expect(existsSync(join(result.dir, 'SCORES.md'))).toBe(true);
  });

  it('真的走到網路邊界:三個輸入 → 三次 /v1/messages', async () => {
    await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() });
    expect(requests.filter((u) => u.includes('/v1/messages'))).toHaveLength(3);
  });

  it('每次呼叫都被 router 記進 log(契約 §10 的 llm_call 事件)', async () => {
    const log: LogEvent[] = [];
    await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter(log) });
    const calls = log.filter((e) => e.type === 'llm_call');
    expect(calls).toHaveLength(3);
    expect(calls.every((e) => (e as { task?: string }).task === 'grade.apply')).toBe(true);
  });

  it('meta 記 token 合計,model 在價目表上時填美金粗估', async () => {
    const result = await runGolden({
      task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: PRICES,
    });
    expect(result.meta.tokens_in).toBe(300); // 3 次 × 100
    expect(result.meta.tokens_out).toBe(120); // 3 次 × 40
    // 300/1e6*3 + 120/1e6*15 = 0.0009 + 0.0018
    expect(result.meta.estimated_cost_usd).toBeCloseTo(0.0027, 10);
  });

  it('model 不在價目表上時只記 token,不瞎猜金額', async () => {
    const result = await runGolden({
      task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: {},
    });
    expect(result.meta.tokens_in).toBe(300);
    expect(result.meta.estimated_cost_usd).toBeUndefined();
  });

  it('meta.json 落到磁碟上,內容跟回傳的一致', async () => {
    const result = await runGolden({
      task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: PRICES,
    });
    const onDisk = JSON.parse(readFileSync(join(result.dir, 'meta.json'), 'utf8')) as GoldenRunMeta;
    expect(onDisk).toEqual(result.meta);
  });

  it('輸出仍然跑結構性檢查(live 不是繞過檢查的後門)', async () => {
    const result = await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() });
    for (const o of result.outputs) {
      expect(o.structural.note).toBeTruthy();
      expect(o.structural.issues).toEqual([]);
    }
  });
});

describe('runGolden --live:離線', () => {
  beforeEach(() => installFakeCloud(false));

  it('連不上就丟 LiveRunOfflineError', async () => {
    await expect(
      runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() }),
    ).rejects.toThrow(LiveRunOfflineError);
  });

  it('**不建立任何目錄**——半個空目錄之後會被當成一次 run', async () => {
    const out = tmpOutDir();
    await expect(
      runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() }),
    ).rejects.toThrow(LiveRunOfflineError);
    expect(readdirSync(out)).toEqual([]);
  });

  it('離線時完全沒有送出 /v1/messages', async () => {
    const out = tmpOutDir();
    await runGolden({ task: 'grade.apply', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() }).catch(() => {});
    expect(requests.filter((u) => u.includes('/v1/messages'))).toEqual([]);
  });
});

describe('estimateCostUsd', () => {
  it('依價目表算:進 100 萬 token × 3 + 出 100 萬 token × 15', () => {
    expect(estimateCostUsd(MODEL, 1_000_000, 1_000_000, PRICES)).toBeCloseTo(18, 10);
  });

  it('零 token 是 0,不是 undefined', () => {
    expect(estimateCostUsd(MODEL, 0, 0, PRICES)).toBe(0);
  });

  it('model 不在表上回 undefined(不猜)', () => {
    expect(estimateCostUsd('某個沒登記的模型', 1000, 1000, PRICES)).toBeUndefined();
  });

  it('預設價目表是空的,所以預設不估', () => {
    expect(estimateCostUsd(MODEL, 1000, 1000)).toBeUndefined();
  });
});
