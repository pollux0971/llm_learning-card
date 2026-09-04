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

/** 契約 §7 路由表:離線且沒有可用的本機模型,沒有任何 provider 能接這個任務。 */
export class NoModelError extends Error {
  readonly code = 'NO_MODEL';
  readonly task: string;
  constructor(task: string) {
    super(`task "${task}" has no model available: offline and no local model`);
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
