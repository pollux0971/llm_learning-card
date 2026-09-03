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
