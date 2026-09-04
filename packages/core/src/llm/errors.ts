export class UnsupportedProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`unsupported cloud provider: "${provider}" (supported: anthropic, openai)`);
    this.name = 'UnsupportedProviderError';
    this.provider = provider;
  }
}

export class MissingCredentialError extends Error {
  readonly envVar: string;
  constructor(envVar: string) {
    super(`missing credential: environment variable ${envVar} is not set`);
    this.name = 'MissingCredentialError';
    this.envVar = envVar;
  }
}

export class UnknownTaskError extends Error {
  readonly task: string;
  constructor(task: string) {
    super(`unknown task: "${task}" is not in the LlmTask contract`);
    this.name = 'UnknownTaskError';
    this.task = task;
  }
}

export class LlmTimeoutError extends Error {
  readonly task: string;
  readonly timeoutMs: number;
  constructor(task: string, timeoutMs: number) {
    super(`task "${task}" timed out after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
    this.task = task;
    this.timeoutMs = timeoutMs;
  }
}

/** 契約 §7 路由表:任務要求雲端,但目前離線。phase-2 的 routing.ts 依表丟這個。 */
export class CloudRequiredError extends Error {
  readonly code = 'CLOUD_REQUIRED';
  readonly task: string;
  constructor(task: string) {
    super(`task "${task}" requires the cloud provider, but it is offline`);
    this.name = 'CloudRequiredError';
    this.task = task;
  }
}

/**
 * 契約 §7 路由表:離線且沒有可用的本機模型,沒有任何 provider 能接這個任務。
 *
 * `detail` 補一句「為什麼沒有本機模型」(例:本機閘道不可達),`cause` 放下層真正
 * 丟出來的那個錯誤。這兩個是給人看的診斷資訊,**不是**給呼叫端分支用的:§7 是
 * 硬約定,消費者(05-grading 的離線審核、11-review、之後的 06)只認 `NO_MODEL`
 * 這一個名字。閘道層的 `GATEWAY_FAILED` 這種內部詞彙一律降級成 `cause`——實作
 * 發明第二個名字,等於讓每一個消費者都多一個 case 要處理。
 */
export class NoModelError extends Error {
  readonly code = 'NO_MODEL';
  readonly task: string;
  constructor(task: string, options: { detail?: string; cause?: unknown } = {}) {
    super(
      `task "${task}" has no model available: offline and no local model` +
        (options.detail === undefined ? '' : ` (${options.detail})`),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'NoModelError';
    this.task = task;
  }
}

/**
 * 截斷的輸出絕不能靜默回傳給呼叫端(半截的 JSON 可能剛好合法,會得到一張少字
 * 的卡而且測試全綠)。adapter 偵測到 finish_reason==='length'(openai)或
 * stop_reason==='max_tokens'(anthropic)時,router.ts 的 call() 一律丟這個,
 * 不回傳 text。
 */
export class OutputTruncatedError extends Error {
  readonly code = 'OUTPUT_TRUNCATED';
  readonly task: string;
  readonly maxTokens: number;
  readonly tokensOut: number;
  constructor(task: string, maxTokens: number, tokensOut: number) {
    super(`task "${task}" output was truncated: maxTokens=${maxTokens}, tokensOut=${tokensOut}`);
    this.name = 'OutputTruncatedError';
    this.task = task;
    this.maxTokens = maxTokens;
    this.tokensOut = tokensOut;
  }
}

// ============================================================== phase-4(ADR-039)

/**
 * 閘道回 403:`model` 欄位填了雲端模型名或 `"auto"`。閘道只接受本機模型名。
 *
 * 這是**設定錯誤**,不是「閘道暫時不行」——備援到別的地方只會讓錯誤設定一直
 * 藏著。所以 router 看到這個錯誤一律往外丟,不觸發任何 fallback(phase-4.feature
 * 的「A cloud model name is rejected outright」)。
 */
export class GatewayModelRejectedError extends Error {
  readonly code = 'GATEWAY_MODEL_REJECTED';
  readonly model: string;
  constructor(model: string) {
    super(`gateway rejected model "${model}": only local model names are accepted (a cloud name or "auto" returns 403)`);
    this.name = 'GatewayModelRejectedError';
    this.model = model;
  }
}

/** 閘道本身失敗(5xx / 連線失敗 / 回應形狀不對)。不是 403 那種設定錯誤。 */
export class GatewayCallError extends Error {
  readonly code = 'GATEWAY_FAILED';
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(`gateway call failed: ${message}`);
    this.name = 'GatewayCallError';
    this.status = status;
  }
}

/**
 * 當日 OpenAI 花費已達 `LLM_DAILY_CAP_USD`(ADR-039:`spent >= cap` 就算達到,
 * 不是 `>`)。`deepen` / `grade.apply` / `reteach.short` 不會看到這個錯誤——
 * 它們改走免費的閘道並標 provisional;只有 `ingest.*` 沒有備援,直接拒絕開始。
 */
export class DailyBudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  readonly task: string;
  readonly spentUsd: number;
  readonly capUsd: number;
  constructor(task: string, spentUsd: number, capUsd: number) {
    super(
      `今日預算已用完 (daily OpenAI budget exhausted): task "${task}" refused, ` +
        `spent $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)} cap`,
    );
    this.name = 'DailyBudgetExceededError';
    this.task = task;
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}
