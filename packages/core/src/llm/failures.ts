/**
 * T31:分辨「模型這次不能用」與「程式的 bug / 設定錯誤 / 憑證」。
 * 純函式:不打網路、不記 log、不讀檔、不改傳進來的錯。
 *
 * 先排除憑證(T30 的 credentialProblem,含 cause 鏈),再看這個錯和它的 cause 鏈。
 * 錯本身是第 1 層、cause 是第 2 層、cause 的 cause 是第 3 層;第 4 層不看。第一個認得的算。
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { credentialProblem, type CredentialEnv } from './credentials.js';
import { LlmTimeoutError, NoModelError, OutputTruncatedError } from './errors.js';

export type LlmUnavailableReason = 'timeout' | 'truncated' | 'no-model' | 'network' | 'rate-limited' | 'server-error';

/** 錯本身、cause、cause 的 cause。第 4 層不看。 */
const MAX_CAUSE_LAYERS = 3;

/**
 * 傳什麼 env 都行:credentialProblem 對數字 status 401 一律算憑證,不看鍵有沒有設。
 * 這裡不讀 process.env,分類才是純函式。
 */
const CREDENTIAL_ENV: CredentialEnv = {};

// 與 ingest/questions.ts 的 NETWORK_ERROR_PATTERN 同一份,收成一份見 backlog。
const NETWORK_ERROR_PATTERN = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|network error/i;

function numericStatus(err: object): number | undefined {
  const status = (err as { status?: unknown }).status;
  if (typeof status !== 'number') return undefined;
  if (!Number.isFinite(status)) return undefined;
  return status;
}

function networkCauseCode(err: Error): string | undefined {
  const cause = err.cause;
  if (typeof cause !== 'object' || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;
  return code;
}

function isNetworkError(err: Error): boolean {
  if (NETWORK_ERROR_PATTERN.test(err.message)) return true;
  const code = networkCauseCode(err);
  if (code === undefined) return false;
  return NETWORK_ERROR_PATTERN.test(code);
}

/**
 * 兩家 SDK 的錯 `name` 都是 "Error",只有 constructor.name 才是類別名。
 * 必須用 instanceof;APIConnectionTimeoutError 是 APIConnectionError 的子類,一起算 network。
 */
function isSdkConnectionError(err: Error): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  return false;
}

function reasonOfError(err: Error): LlmUnavailableReason | undefined {
  if (err instanceof LlmTimeoutError) return 'timeout';
  if (err.name === 'AbortError') return 'timeout';
  if (err instanceof OutputTruncatedError) return 'truncated';
  if (err instanceof NoModelError) return 'no-model';
  if (isSdkConnectionError(err)) return 'network';
  if (isNetworkError(err)) return 'network';
  const status = numericStatus(err);
  if (status === 429) return 'rate-limited';
  if (status !== undefined && status >= 500) return 'server-error';
  return undefined;
}

function firstReason(err: unknown): LlmUnavailableReason | undefined {
  const seen = new Set<object>();
  let current: unknown = err;
  for (let layer = 1; layer <= MAX_CAUSE_LAYERS; layer += 1) {
    if (!(current instanceof Error)) return undefined;
    if (seen.has(current)) return undefined;
    seen.add(current);
    const reason = reasonOfError(current);
    if (reason !== undefined) return reason;
    if (!('cause' in current)) return undefined;
    current = current.cause;
  }
  return undefined;
}

/**
 * 認得「模型這次不能用」就回原因代號;bug、設定錯誤、憑證、不是 Error 的丟出物回 undefined
 * (讓呼叫端原樣往外丟)。
 */
export function llmUnavailableReason(err: unknown): LlmUnavailableReason | undefined {
  if (credentialProblem(err, CREDENTIAL_ENV) !== undefined) return undefined;
  return firstReason(err);
}
