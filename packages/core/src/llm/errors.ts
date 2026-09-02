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
