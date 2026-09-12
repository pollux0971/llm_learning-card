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
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { LlmRouterImpl, UnaccountableLlmCallError, resolveVaultLearningDir } from '@core/llm/index.js';
import type { LogEvent } from '@contracts/index.js';
import {
  DEFAULT_GOLDEN_BASE_DIR,
  DEFAULT_FAKE_GOLDEN_BASE_DIR,
  ROOT,
  LiveRunOfflineError,
  MissingGoldenSetError,
  createDefaultLiveRouter,
  resolveLiveLearningDir,
  defaultGoldenBaseDir,
  estimateCostUsd,
  runGolden,
  runGoldenFake,
  runGoldenLive,
  type ModelPriceTable,
} from './golden-run.js';
import type { GoldenRunMeta, GoldenSet, GoldenSetId, LlmRouter } from './types.js';

/**
 * 沒有登記的 golden set id。`GoldenSetId` 的六個值現在全部都有登記,
 * 但 CLI 的 `--set` 收的是使用者打的字串,打錯字這條路是真的——
 * 所以 MissingGoldenSetError 要驗,用一個永遠不會被登記的名字。
 */
const NOT_REGISTERED = 'not-registered' as GoldenSetId;

/**
 * ROOT 本身就是 git repo 的頂層嗎?
 * 變異測試的沙箱是 repo 底下 `.stryker-tmp/sandboxNNN/` 的一份複本:它「在」工作區裡,
 * 但裡面的檔案一個都沒被追蹤,`git log -- <path>` 什麼都回不出來。
 * 所以要比的是 `--show-toplevel` 等不等於 ROOT,不是 `--is-inside-work-tree`。
 */
const IN_GIT_WORKTREE =
  spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() === ROOT;

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

/**
 * `logAppender` 一律明示注入——沒有 `log` 陣列時給明確的 no-op,而不是讓
 * `LlmRouterImpl` 落回沒人接的預設值(ADR-050:call() 現在對「沒有辦法記帳」
 * 這件事是硬錯,呼叫端必須自己決定要不要丟棄)。
 */
function makeRouter(log?: LogEvent[]): LlmRouter {
  return new LlmRouterImpl({
    env: liveEnv(),
    logAppender: log ? (e: LogEvent) => log.push(e) : () => {},
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
    const result = await runGolden({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() });

    expect(result.meta.mode).toBe('live');
    expect(result.meta.provider).toBe('anthropic');
    expect(result.meta.model).toBe(MODEL);
    expect(result.outputs).toHaveLength(3);
    expect(readdirSync(result.dir).filter((f) => f.endsWith('.output.json'))).toHaveLength(3);
    expect(existsSync(join(result.dir, 'prompt.snapshot.md'))).toBe(true);
    expect(existsSync(join(result.dir, 'SCORES.md'))).toBe(true);
  });

  it('真的走到網路邊界:三個輸入 → 三次 /v1/messages', async () => {
    await runGolden({ set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() });
    expect(requests.filter((u) => u.includes('/v1/messages'))).toHaveLength(3);
  });

  it('每次呼叫都被 router 記進 log(契約 §10 的 llm_call 事件)', async () => {
    const log: LogEvent[] = [];
    await runGolden({ set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter(log) });
    const calls = log.filter((e) => e.type === 'llm_call');
    expect(calls).toHaveLength(3);
    expect(calls.every((e) => (e as { task?: string }).task === 'grade.apply')).toBe(true);
  });

  it('meta 記 token 合計,model 在價目表上時填美金粗估', async () => {
    const result = await runGolden({
      set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: PRICES,
    });
    expect(result.meta.tokens_in).toBe(300); // 3 次 × 100
    expect(result.meta.tokens_out).toBe(120); // 3 次 × 40
    // 300/1e6*3 + 120/1e6*15 = 0.0009 + 0.0018
    expect(result.meta.estimated_cost_usd).toBeCloseTo(0.0027, 10);
  });

  it('model 不在價目表上時只記 token,不瞎猜金額', async () => {
    const result = await runGolden({
      set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: {},
    });
    expect(result.meta.tokens_in).toBe(300);
    expect(result.meta.estimated_cost_usd).toBeUndefined();
  });

  /**
   * 審核補測。上一個測試用 `toBeUndefined()`,那對「欄位不存在」與「欄位存在但值是
   * undefined」是同一個結果——分不出來。tsconfig 開了 exactOptionalPropertyTypes,
   * 意思就是**沒有價目時欄位整個不存在**;寫成 `estimated_cost_usd: undefined`
   * 在型別上是另一回事,在 `'x' in meta` 與 Object.keys 上也是。
   */
  it('查不到價目時 estimated_cost_usd **欄位整個不存在**,不是一個 undefined 的值', async () => {
    const result = await runGolden({
      set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: {},
    });
    expect('estimated_cost_usd' in result.meta).toBe(false);
    expect(Object.keys(result.meta)).not.toContain('estimated_cost_usd');
  });

  it('查得到價目時欄位才存在', async () => {
    const result = await runGolden({
      set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: PRICES,
    });
    expect('estimated_cost_usd' in result.meta).toBe(true);
  });

  it('meta.json 落到磁碟上,內容跟回傳的一致', async () => {
    const result = await runGolden({
      set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live',
      createRouter: () => makeRouter(), prices: PRICES,
    });
    const onDisk = JSON.parse(readFileSync(join(result.dir, 'meta.json'), 'utf8')) as GoldenRunMeta;
    expect(onDisk).toEqual(result.meta);
  });

  it('輸出仍然跑結構性檢查(live 不是繞過檢查的後門)', async () => {
    const result = await runGolden({ set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() });
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
      runGolden({ set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() }),
    ).rejects.toThrow(LiveRunOfflineError);
  });

  it('**不建立任何目錄**——半個空目錄之後會被當成一次 run', async () => {
    const out = tmpOutDir();
    await expect(
      runGolden({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() }),
    ).rejects.toThrow(LiveRunOfflineError);
    expect(readdirSync(out)).toEqual([]);
  });

  it('離線時完全沒有送出 /v1/messages', async () => {
    const out = tmpOutDir();
    await runGolden({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() }).catch(() => {});
    expect(requests.filter((u) => u.includes('/v1/messages'))).toEqual([]);
  });
});

/**
 * 審核補測:順序的第二段。probeOnline → **讀 prompt 檔** → mkdir。
 * 上面的離線測試只釘住了「probeOnline 在 mkdir 之前」;把讀檔搬到 mkdir 之後,
 * 原本的測試一個都不會紅。可是 prompt 檔不見(golden set 指錯路徑、prompt 被搬走)
 * 是真的會發生的事,那時候一樣會留下一個空目錄,之後 diff 把它當成一次 run。
 */
/**
 * 審核補測:兩個錯誤型別本身,以及 meta 裡兩個原本沒人看過的欄位。
 * 錯誤訊息與 `this.name` 被清空時,原本的 `rejects.toThrow(LiveRunOfflineError)`
 * 照樣通過——可是那句訊息是「為什麼跑不了、該怎麼辦」的唯一出口。
 */
describe('錯誤與 meta 的欄位(審核補測)', () => {
  it('LiveRunOfflineError 帶得出 task,訊息說得出替代做法', async () => {
    installFakeCloud(false);
    let err: unknown;
    try {
      await runGolden({
        set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter(),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LiveRunOfflineError);
    const offline = err as LiveRunOfflineError;
    expect(offline.name).toBe('LiveRunOfflineError');
    expect(offline.set).toBe('selftest');
    expect(offline.message).toContain('selftest');
    expect(offline.message).toContain('--fake');
  });

  it('沒登記 golden set 的任務丟 MissingGoldenSetError,訊息指向 registry 檔', async () => {
    installFakeCloud(true);
    let err: unknown;
    try {
      await runGolden({
        set: NOT_REGISTERED, today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter(),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingGoldenSetError);
    const missing = err as MissingGoldenSetError;
    expect(missing.name).toBe('MissingGoldenSetError');
    expect(missing.set).toBe(NOT_REGISTERED);
    expect(missing.message).toContain('registry');
  });

  /**
   * promptFileGitCommit 原本沒有任何測試看過它的值,所以 `git log` 的參數
   * 被改掉、`.trim()` 被拿掉都不會被發現——那個欄位正是 prompt 漂移偵測的依據
   * (detectPromptDrift 拿它跟現在的 commit 比),值錯了整條回歸流程就是錯的。
   */
  /**
   * 只在真的 git 工作區裡跑。變異測試的沙箱是 repo 的複本、**不是** git 工作區,
   * 那裡 `git log` 什麼都回不出來,值本來就會是 'uncommitted'——
   * 在那種環境下這條斷言驗的是環境不是程式,所以跳過。
   */
  it.skipIf(!IN_GIT_WORKTREE)('meta.promptFileGitCommit 是真的短 sha,不是 uncommitted、也沒有換行', async () => {
    installFakeCloud(true);
    const result = await runGolden({
      set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter(),
    });
    expect(result.meta.promptFileGitCommit).toMatch(/^[0-9a-f]{7,12}$/);
    expect(result.meta.promptFileGitCommit).not.toBe('uncommitted');
  });

  /**
   * fake 路徑的兩條「原本走不到」的路(runGoldenFake 抽出來之後才測得到)。
   * prompt 檔不存在時要丟錯而且訊息指得出是哪個 golden set、哪個檔。
   */
  it('fake 模式:prompt 檔不見時丟錯,訊息指得出 task 與檔名', async () => {
    await expect(
      runGoldenFake(
        { set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'fake' },
        { id: 'selftest', task: 'grade.apply', promptFile: 'packages/core/src/prompt-quality/golden-sets/不存在.md', inputs: [] },
      ),
    ).rejects.toThrow(/grade\.apply.*不存在\.md|不存在\.md/);
  });

  it('fake 模式:golden set 沒有輸入時 model 與 provider 是 unknown', async () => {
    const result = await runGoldenFake(
      { set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'fake' },
      { id: 'selftest', task: 'grade.apply', promptFile: 'packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md', inputs: [] },
    );
    expect(result.meta.model).toBe('unknown');
    expect(result.meta.provider).toBe('unknown');
    expect(result.meta.mode).toBe('fake');
    expect(result.outputs).toEqual([]);
  });

  /** 一個輸入都沒有的 golden set:model / provider 落在 'unknown',不是空字串。 */
  it('golden set 沒有輸入時 model 與 provider 是 unknown', async () => {
    installFakeCloud(true);
    const result = await runGoldenLive(
      { set: 'selftest', today: '2026-09-10', baseDir: tmpOutDir(), mode: 'live', createRouter: () => makeRouter() },
      { id: 'selftest', task: 'grade.apply', promptFile: 'packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md', inputs: [] },
    );
    expect(result.meta.model).toBe('unknown');
    expect(result.meta.provider).toBe('unknown');
    expect(result.outputs).toEqual([]);
    expect(result.meta.tokens_in).toBe(0);
  });
});

describe('runGolden --live:prompt 檔不見時也不留空目錄', () => {
  beforeEach(() => installFakeCloud(true));

  const MISSING_SET: GoldenSet = {
    id: 'selftest',
    task: 'grade.apply',
    promptFile: 'packages/core/src/prompt-quality/golden-sets/這個檔案不存在.md',
    inputs: [{ id: 'demo-1', prompt: '任意輸入' }],
  };

  it('丟錯,而且 baseDir 底下什麼都沒建立', async () => {
    const out = tmpOutDir();
    await expect(
      runGoldenLive({ set: 'selftest', today: '2026-09-10', baseDir: out, mode: 'live', createRouter: () => makeRouter() }, MISSING_SET),
    ).rejects.toThrow(/prompt 檔不存在/);
    expect(readdirSync(out)).toEqual([]);
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

/**
 * ADR-050 反向驗證(工單「LLM 呼叫必須可記帳」):golden-run 的實際 bug 是
 * `createDefaultLiveRouter()` 沒給 `settings` 也沒給 `logPath`,`--live` 真的打了
 * 錢卻一筆都沒記進 `learning/state/log.jsonl`。這裡直接測 `createDefaultLiveRouter()`
 * 本人(不透過 `runGolden` 的 `createRouter` 注入縫),把它退回舊行為(拿掉
 * `logPath`)這裡就要紅——證明「call() 硬錯」與「golden-run 預設有接上 logPath」
 * 兩件事都真的被鎖住,不是只鎖住其中一個。
 */
describe('createDefaultLiveRouter — ADR-050:預設一定要接上記帳,不能悄悄不寫', () => {
  const learningDirs: string[] = [];
  let realEnv: NodeJS.ProcessEnv;
  function tmpLearningDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'pq-live-learning-'));
    learningDirs.push(d);
    return d;
  }

  beforeEach(() => {
    realEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = realEnv;
    while (learningDirs.length) rmSync(learningDirs.pop()!, { recursive: true, force: true });
  });

  it('真的把這次呼叫寫進 <learningDir>/state/log.jsonl,不是靜默的 no-op', async () => {
    installFakeCloud(true);
    process.env.LLM_CLOUD_PROVIDER = 'anthropic';
    process.env.LLM_CLOUD_MODEL = MODEL;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const learningDir = tmpLearningDir();

    const router = createDefaultLiveRouter(learningDir);
    const result = await router.call('grade.apply', '同源政策是什麼?');

    expect(result.text).toBe(REPLY_TEXT);
    const logPath = join(learningDir, 'state/log.jsonl');
    expect(existsSync(logPath)).toBe(true);
    // 不借 @core/schema/log.js 的 parseLogLines()——那是 01-data-layer,12 跨資料夾
    // import 它只為了這一行測試斷言不值得(Wave 0 邊界規則),直接手拆 JSONL。
    const events = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'llm_call', task: 'grade.apply' });
  });

  /**
   * ADR-051:`resolveLiveLearningDir()` 是 `createDefaultLiveRouter()` 沒給
   * `learningDir` 時實際會用的那個決策,拆成純函式測,不必真的呼叫
   * `createDefaultLiveRouter()`(那會真的 `mkdirSync`,雖然目的地已存在時是
   * no-op,但不需要冒這個險)。跟 `resolveVaultLearningDir()` 本身跨 worktree
   * 解析同一個路徑的保證(見 packages/core/src/llm/vault.test.ts,合成的臨時
   * git repo,零真實資料風險)是兩層不同的東西:那邊測「怎麼解析」,這裡測
   * 「沒給的時候有沒有真的去解析,還是照抄了別的東西」。
   */
  it('resolveLiveLearningDir(): 有給就原樣用,沒給就退回 resolveVaultLearningDir(ROOT)', () => {
    expect(resolveLiveLearningDir('/custom/dir')).toBe('/custom/dir');
    expect(resolveLiveLearningDir(undefined)).toBe(resolveVaultLearningDir(ROOT));
    expect(resolveLiveLearningDir()).toBe(resolveVaultLearningDir(ROOT));
  });

  it('對照:直接用 LlmRouterImpl({}) 重現舊 bug(不給 logPath/logAppender)——call() 現在硬錯,不再是悄悄不寫', async () => {
    installFakeCloud(true);
    const router = new LlmRouterImpl({
      env: { LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: MODEL, ANTHROPIC_API_KEY: 'test-key' },
    });
    await expect(router.call('grade.apply', '同源政策是什麼?')).rejects.toThrow(UnaccountableLlmCallError);
    // 硬錯要在打真的 adapter 之前就發生,不是打完才報——不然「記不到帳」跟
    // 「已經花了錢」還是會同時發生。
    expect(requests.filter((u) => u.includes('/v1/messages'))).toHaveLength(0);
  });
});
