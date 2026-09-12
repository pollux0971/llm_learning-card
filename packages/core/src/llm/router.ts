import {
  CLOUD_PROVIDERS,
  isCloudProvider,
  isLlmTask,
  type CloudAdapter,
  type CloudProvider,
  type LlmResult,
  type LlmRouter,
  type LlmTask,
} from './types.js';
import {
  LlmTimeoutError,
  MissingCredentialError,
  OutputTruncatedError,
  UnaccountableLlmCallError,
  UnknownTaskError,
  UnsupportedProviderError,
} from './errors.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { openaiAdapter } from './adapters/openai.js';
import { TASK_MAX_TOKENS } from './token-limits.js';
import type { LogEvent } from '@contracts/index.js';
import { recordEvent } from '@core/schema/log.js';
import { witness } from '@contracts/witness.js';

/** 寫一筆 log 事件。契約 §10/§11b 的正式實作見 01-data-layer 的 recordEvent()。 */
export type LogAppender = (event: LogEvent) => void;

/** 用 01 的 recordEvent() 原子寫入。ADR-050:沒有 path 就不建這個 appender——
 * 呼叫端不給 logPath 也不給 logAppender 是「沒有接上記帳」,call() 要硬錯,
 * 不能在這裡悄悄退回一個什麼都不做的函式。 */
function createFileLogAppender(path: string): LogAppender {
  return (event) => recordEvent(path, event);
}

/** 契約 §7 開放問題:雲端逾時先訂 60 秒,用了再調。 */
const DEFAULT_TIMEOUT_MS = 60_000;
/** probeOnline() 只是可達性檢查,不是模型呼叫,逾時要短。 */
const PROBE_TIMEOUT_MS = 5_000;

const PROBE_URL: Record<CloudProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1/models',
  openai: 'https://api.openai.com/v1/models',
};

function envVarFor(provider: CloudProvider): string {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

export interface CloudSettings {
  cloud_provider?: string;
  cloud_model?: string;
}

export interface CloudLlmRouterOptions {
  /** 預設 process.env;測試用可換成假的 */
  env?: NodeJS.ProcessEnv;
  /** 契約 §11:環境變數覆蓋這裡的設定 */
  settings?: CloudSettings;
  /** 依 provider 替換 adapter,測試用假的取代真的 SDK 呼叫 */
  adapters?: Partial<Record<CloudProvider, CloudAdapter>>;
  defaultTimeoutMs?: number;
  /** log.jsonl 的路徑。ADR-050:兩個都不給,call() 會硬錯——純單元測試想不寫檔案,
   * 明確注入 `logAppender: () => {}`,不要靠這裡悄悄退回不寫。 */
  logPath?: string;
  /** 直接注入 appender,優先於 logPath */
  logAppender?: LogAppender;
}

/**
 * 契約 §7 的 LlmRouter。Wave 0 / phase-1 只有雲端路徑——路由表(本機、離線判斷)
 * 在 phase-2 才加,所以這裡的 call() 一律走雲端,provisional 恆為 false。
 */
export class CloudLlmRouter implements LlmRouter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly settings: CloudSettings;
  private readonly adapters: Record<CloudProvider, CloudAdapter>;
  private readonly defaultTimeoutMs: number;
  /** undefined = 呼叫端既沒給 logPath 也沒給 logAppender,call() 要硬錯(ADR-050)。 */
  private readonly log: LogAppender | undefined;

  constructor(opts: CloudLlmRouterOptions = {}) {
    this.env = opts.env ?? process.env;
    this.settings = opts.settings ?? {};
    this.adapters = {
      anthropic: opts.adapters?.anthropic ?? anthropicAdapter,
      openai: opts.adapters?.openai ?? openaiAdapter,
    };
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = opts.logAppender ?? (opts.logPath === undefined ? undefined : createFileLogAppender(opts.logPath));
  }

  async call(task: LlmTask, prompt: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<LlmResult> {
    if (!isLlmTask(task)) {
      throw new UnknownTaskError(task);
    }

    // ADR-050:能不能記帳不該由呼叫方選擇性提供。沒有明示注入 logAppender、
    // 也沒給 logPath,就在打真的 adapter 之前擋下來——省得先花錢才發現這次
    // 呼叫沒有留下任何可稽核的記錄。要不記帳,呼叫端要自己明講(`logAppender: () => {}`)。
    const log = this.log;
    if (!log) throw new UnaccountableLlmCallError();

    const providerName = this.resolveProviderName();
    if (!isCloudProvider(providerName)) {
      throw new UnsupportedProviderError(providerName);
    }

    const apiKey = this.env[envVarFor(providerName)];
    if (!apiKey) {
      throw new MissingCredentialError(envVarFor(providerName));
    }

    const model = this.resolveModel();
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const maxTokens = opts.maxTokens ?? TASK_MAX_TOKENS[task];
    const adapter = this.adapters[providerName];
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        adapter.call({ prompt, model, apiKey, signal: controller.signal, maxTokens }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new LlmTimeoutError(task, timeoutMs));
          }, timeoutMs);
        }),
      ]);

      if (result.truncated) {
        throw new OutputTruncatedError(task, maxTokens, result.tokens_out ?? 0);
      }

      const llmResult: LlmResult = { ...result, provisional: false };
      log({
        ts: new Date().toISOString(),
        type: 'llm_call',
        task,
        provider: llmResult.provider,
        model: llmResult.model,
        latency_ms: llmResult.latency_ms,
        ...(llmResult.tokens_in != null ? { tokens_in: llmResult.tokens_in } : {}),
        ...(llmResult.tokens_out != null ? { tokens_out: llmResult.tokens_out } : {}),
      });
      return llmResult;
    } catch (err) {
      if (err instanceof LlmTimeoutError) {
        log({
          ts: new Date().toISOString(),
          type: 'llm_call',
          task,
          provider: providerName,
          model,
          timeout: true,
          timeout_ms: timeoutMs,
        });
      } else if (err instanceof OutputTruncatedError) {
        log({
          ts: new Date().toISOString(),
          type: 'llm_call',
          task,
          provider: providerName,
          model,
          truncated: true,
          max_tokens: err.maxTokens,
          tokens_out: err.tokensOut,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async probeOnline(): Promise<boolean> {
    const providerName = this.resolveProviderName();
    if (!isCloudProvider(providerName)) return false;

    const apiKey = this.env[envVarFor(providerName)];
    const headers: Record<string, string> = {};
    if (apiKey) {
      if (providerName === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(PROBE_URL[providerName], { signal: controller.signal, headers });
      return res.status < 500;
    } catch {
      witness('llm.cloud.probe-online-swallowed');
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** phase-2 才有本機 adapter(ADR-034 待決:本機模型未定)。phase-1 一律回報不可用。 */
  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    return { available: false, models: [] };
  }

  private resolveProviderName(): string {
    return this.env.LLM_CLOUD_PROVIDER ?? this.settings.cloud_provider ?? '';
  }

  private resolveModel(): string {
    const model = this.env.LLM_CLOUD_MODEL ?? this.settings.cloud_model;
    if (!model) throw new Error('no cloud model configured (LLM_CLOUD_MODEL / settings.llm.cloud_model)');
    return model;
  }
}

export { CLOUD_PROVIDERS };
