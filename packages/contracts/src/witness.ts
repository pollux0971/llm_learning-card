/**
 * 退化路徑見證器(ADR-044)。**只觀測,不判斷。**
 *
 * 問題:測試綠,不代表它走了它自以為在測的那條路。兩邊都退化成同一個預設值的時候,
 * 「相等」仍然成立——來源專案 35 個測試檔的反向驗證全過,卻在 fallback 路徑上綠了兩週。
 *
 * 這支模組做的事只有一件:每一個「失敗了卻回一個看起來正常的值」的分支,在程式碼裡
 * 呼叫一次 `witness('<訊號名>')`。沒有安裝 collector 的時候(正式執行、Stryker、
 * 沒設 `DEGRADED_WITNESS_DIR` 的 vitest)它是 no-op;安裝了(`scripts/degraded-witness.setup.ts`)
 * 就把訊號記到目前這個測試名下,跑完由 `scripts/degraded-report.ts` 彙總成
 * `reports/degraded/<sha>.md`。
 *
 * 為什麼放在 packages/contracts:boundaries 規則裡只有 contracts 這個擁有者可以被
 * 任何資料夾 import 而不需要 allow 例外,而訊號目錄本身就是一份跨模組的共同詞彙
 * (「這個系統有哪些退化分支」)。它不動 contracts/types.md 的任何硬約定。
 *
 * 為什麼訊號名是字串字面值聯集而不是 enum:Stryker 的 StringLiteral 變異會把
 * `witness('x')` 改成 `witness('')`,而 `''` 不在聯集裡,TypeScript checker 直接判
 * CompileError,不算存活變異——被觀測的檔案的變異分數不會因為多了一行觀測而變動。
 *
 * 兩種訊號:
 * - `swallow`:**失敗**發生了(例外、非 2xx、parse 不動、預算用完),程式接住之後
 *   回一個正常形狀的值繼續走。這是「測試綠但走錯路」最典型的來源。
 * - `default-path`:沒有失敗,但呼叫端**沒給**某個東西,程式自己選了一條路
 *   (拿 stub 代替真 router、沒 log 就當花費 0)。測試如果沒明說要走這條,
 *   它就是在不知情的情況下測了 stub。
 */

export type DegradedKind = 'swallow' | 'default-path';

export interface DegradedSignalMeta {
  kind: DegradedKind;
  /** boundaries.owners.json 的擁有者名,報告用它判斷「測試的資料夾 ≠ 訊號的資料夾」 */
  owner: string;
  /** 一句話:失敗了什麼、回了什麼正常值 */
  summary: string;
}

/**
 * 訊號目錄。**每一個訊號在程式碼裡恰好有一處以上的 `witness()` 呼叫**,
 * `scripts/degraded-report.ts` 會用 grep 反查實際的 檔案:行,目錄裡不寫行號
 * (行號會漂)。新增訊號:先在這裡登記,再到分支裡呼叫;沒登記的字串過不了型別檢查。
 */
export const DEGRADED_SIGNALS = {
  // ── 03-llm-router ─────────────────────────────────────────────────────────
  'llm.fallback.cloud-failed': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: '雲端呼叫失敗(逾時 / 截斷 / 5xx / NoModel)→ 改走閘道,回 provisional=true 的正常 LlmResult',
  },
  'llm.fallback.budget-exhausted': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: '當日預算已達上限 → 不打雲端,改走閘道,回 provisional=true 的正常 LlmResult',
  },
  'llm.gateway-router.probe-local-swallowed': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'GatewayLlmRouter.probeLocal() 丟錯(含沒設 GATEWAY_API_KEY)→ 回 { available: false, models: [] }',
  },
  'llm.gateway-router.spend-no-log-zero': {
    kind: 'default-path',
    owner: '03-llm-router',
    summary: '沒給 logPath 也沒注入 spendReader → 今日花費一律當 0,預算分支永遠走不到',
  },
  'llm.router-impl.probe-local-swallowed': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'LlmRouterImpl.probeLocal() 的 prober 丟錯 → 回 { available: false, models: [] }',
  },
  'llm.router-impl.local-prober-default': {
    kind: 'default-path',
    owner: '03-llm-router',
    summary: '沒注入 localProber → 用 alwaysUnavailable,本機永遠不可用,路由只剩雲端或丟錯',
  },
  'llm.cloud.probe-online-swallowed': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'CloudLlmRouter.probeOnline() 的 fetch 丟錯(含逾時 abort)→ 回 false(離線)',
  },
  'llm.gateway.probe.http-not-ok': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'GET /gateway/models 非 2xx → 回 { available: false, models: [] }',
  },
  'llm.gateway.probe.bad-body': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: '/gateway/models 回的 body 不是 JSON 或沒有 models 物件 → 回 { available: false, models: [] }',
  },
  'llm.gateway.probe.threw': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: '換 token 或 fetch 丟錯(401 / 連線被拒 / 逾時)→ 回 { available: false, models: [] }',
  },
  'llm.gateway.chat.401-retry': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'POST /gateway/chat 回 401 → 作廢 token 重換一次再重打,第二次成功就當正常回應',
  },
  'llm.spend.log-unreadable-zero': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'log.jsonl 讀不到(任何錯誤,不只 ENOENT)→ 今日花費當 { usd: 0, calls: 0 }',
  },
  'llm.spend.bad-line-skipped': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'log.jsonl 某一行不是 JSON → 跳過那一行,花費照算',
  },
  'llm.spend.tokens-missing-zero': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'llm_call 事件缺 tokens_in / tokens_out(或不是有限數字)→ 那一筆算 0 元',
  },
  'llm.spend.env-invalid-default': {
    kind: 'swallow',
    owner: '03-llm-router',
    summary: 'LLM_DAILY_CAP_USD / LLM_PRICE_*_PER_M 有設但不是非負數字 → 靜默改用預設值',
  },

  // ── 05-grading ────────────────────────────────────────────────────────────
  'grading.fill.llm-failed-strict': {
    kind: 'swallow',
    owner: '05-grading',
    summary: 'grade.fill.llm 呼叫丟錯 → 回 { pass: false, grader: "fallback-strict" } 的正常 GradeResult',
  },
  'grading.apply.invalid-response-retry': {
    kind: 'swallow',
    owner: '05-grading',
    summary: 'grade.apply 第一次回應解析不出 verdict → 記 warning 再打一次',
  },
  'grading.apply.unparsable-skipped': {
    kind: 'swallow',
    owner: '05-grading',
    summary: 'grade.apply 兩次都解析不出 → 回 { pass: null, grader: "error" },本次審核略過',
  },

  // ── 02-ingest-pipeline ────────────────────────────────────────────────────
  'ingest.questions.retry': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: 'ingest.questions 截斷 / 逾時 / 網路錯 → 重打一次(截斷時加倍 maxTokens)',
  },
  'ingest.questions.card-failed-skipped': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: '某張卡的考題產生失敗 → 收進 failures 清單,其餘卡照寫,管線繼續',
  },
  'ingest.cards.regenerate-retry': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: '卡 body 超過 100 字 → 用 regenerate prompt 再生成一次(最多 MAX_ATTEMPTS)',
  },
  'ingest.pipeline.children-failed-skipped': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: '子卡產生整批失敗 → 記一筆 warning,當作沒有子卡繼續',
  },
  'ingest.pipeline.deps-failed-skipped': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: '依賴圖分析失敗(非 GraphFileCorruptError)→ 記一筆 warning,order 當空陣列繼續',
  },
  'ingest.category-default-security': {
    kind: 'default-path',
    owner: '02-ingest-pipeline',
    summary: '沒給 category 且路徑推不出 → 分類一律當 "security"',
  },
  'ingest.deps.cycle-llm-retry': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: '模型回的依賴圖有環 → 帶著環的路徑再問模型一次',
  },
  'ingest.deps.cycle-local-repair': {
    kind: 'swallow',
    owner: '02-ingest-pipeline',
    summary: '重問之後仍有環 → 本地丟邊修成 DAG,以修過的圖繼續寫 order',
  },

  // ── 11-review-cli ─────────────────────────────────────────────────────────
  'session.router-default-fake': {
    kind: 'default-path',
    owner: '11-review-cli',
    summary: 'buildSession 沒給 router → 用 contracts/fixtures/llm 的 FakeLlmRouter(stub)',
  },

  // ── 12-prompt-quality ─────────────────────────────────────────────────────
  'prompt-quality.mode-default-fake': {
    kind: 'default-path',
    owner: '12-prompt-quality',
    summary: 'runGolden 沒給 mode → 走 fake(重播 fixture),不是 live',
  },
  'prompt-quality.router-default-fake': {
    kind: 'default-path',
    owner: '12-prompt-quality',
    summary: 'runGoldenFake 沒給 router → 用內建 fixture 目錄的 FakeLlmRouter(stub)',
  },
  'prompt-quality.fake.attempt-fallback-first': {
    kind: 'default-path',
    owner: '12-prompt-quality',
    summary: 'FakeLlmRouter 第 N 次呼叫沒有 attempt=N 的 fixture → 重播 attempt=1 的那一份',
  },
} as const satisfies Record<string, DegradedSignalMeta>;

export type DegradedSignal = keyof typeof DEGRADED_SIGNALS;

export interface DegradedCollector {
  record(signal: DegradedSignal): void;
}

/**
 * 掛在 globalThis 上而不是模組變數:同一支檔案可能被 `@contracts/witness.js` 與相對路徑
 * 各載入一次(vitest 的 alias 與 tsx 的 paths 解析結果不同),模組變數會變成兩份,
 * 訊號就漏掉一半。Symbol.for 是跨模組實例的同一把鑰匙。
 */
const COLLECTOR_KEY = Symbol.for('learning-cards.degraded-witness.collector');

type WithCollector = typeof globalThis & { [COLLECTOR_KEY]?: DegradedCollector };

/** 在退化分支裡呼叫。沒安裝 collector 就什麼都不做。 */
export function witness(signal: DegradedSignal): void {
  const collector = (globalThis as WithCollector)[COLLECTOR_KEY];
  if (collector !== undefined) collector.record(signal);
}

/**
 * 給 `a ?? witnessed('signal', b)` 這種寫法用:只有真的走到右邊才記,
 * 回傳值原封不動。
 */
export function witnessed<T>(signal: DegradedSignal, value: T): T {
  witness(signal);
  return value;
}

/** 安裝或拆掉 collector(傳 undefined)。回傳先前的那一個,方便還原。 */
export function installDegradedCollector(collector: DegradedCollector | undefined): DegradedCollector | undefined {
  const g = globalThis as WithCollector;
  const previous = g[COLLECTOR_KEY];
  if (collector === undefined) delete g[COLLECTOR_KEY];
  else g[COLLECTOR_KEY] = collector;
  return previous;
}

export interface DegradedTally extends DegradedCollector {
  /** 取出目前累積的 {訊號: 次數} 並清空。 */
  drain(): Partial<Record<DegradedSignal, number>>;
  /** 目前有沒有累積任何東西(不清空)。 */
  isEmpty(): boolean;
}

/** 最簡單的 collector:記次數。vitest setup 與測試用。 */
export function createDegradedTally(): DegradedTally {
  let counts = new Map<DegradedSignal, number>();
  return {
    record(signal) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    },
    drain() {
      const out: Partial<Record<DegradedSignal, number>> = {};
      for (const [signal, count] of counts) out[signal] = count;
      counts = new Map();
      return out;
    },
    isEmpty() {
      return counts.size === 0;
    },
  };
}

/** setup 寫出、report 讀回的一行 JSONL 的形狀。 */
export interface WitnessRecord {
  file: string;
  test: string;
  signals: Partial<Record<DegradedSignal, number>>;
  /**
   * `ran`:測試本體跑完了(passed / failed 都算)。`skipped`:測試本體裡 `ctx.skip()` 的——
   * **照樣寫列**,但不進分母、也不沖到 outside(ADR-047:outside 只收「測試之外觸發的」,
   * 兩種來源的錯法不同,不混桶)。省略等於 `ran`(有這個欄位之前寫出的 JSONL)。
   * `it.skip` / `it.todo` 沒有 afterEach,天生沒有列。
   */
  status?: WitnessStatus;
}

export type WitnessStatus = 'ran' | 'skipped';

/** 在 beforeAll / 檔案頂層 / afterAll 觸發、歸不到單一測試的紀錄,test 欄位填這個。 */
export const OUTSIDE_ANY_TEST = '(outside any test)';

export function isDegradedSignal(value: unknown): value is DegradedSignal {
  return typeof value === 'string' && Object.hasOwn(DEGRADED_SIGNALS, value);
}
