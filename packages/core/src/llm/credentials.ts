/**
 * T30:批改先走的那條路要哪個鍵、submit 丟出來的錯是不是憑證問題。
 * 只看傳進來的 env,不讀檔、不打網路。router 的 provider / 鍵名判斷也從這裡出,兩邊不會算得不一樣。
 */
import { GatewayCallError, MissingCredentialError } from './errors.js';
import { isCloudProvider, type CloudProvider } from './types.js';

export type CredentialEnv = Record<string, string | undefined>;

export interface ProviderSettings {
  cloud_provider?: string;
}

const GRADING_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEWAY_API_KEY'] as const;
export type GradingKey = (typeof GRADING_KEYS)[number];

export interface CredentialProblem {
  readonly kind: 'missing' | 'rejected';
  readonly key: GradingKey;
}

/** cause 鏈走到這裡就停,避免很深或繞圈。第一個認得的算。 */
const MAX_CAUSE_HOPS = 8;

export function envVarFor(provider: CloudProvider): GradingKey {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

/** router 的 resolveProviderName。沒有 env 也沒有 settings 就回空字串(不認得的雲端)。 */
export function resolveProviderName(env: CredentialEnv, settings?: ProviderSettings): string {
  const fromEnv = env.LLM_CLOUD_PROVIDER;
  if (fromEnv !== undefined) return fromEnv;
  if (settings === undefined) return '';
  const fromSettings = settings.cloud_provider;
  if (fromSettings !== undefined) return fromSettings;
  return '';
}

function isGradingKey(key: string): key is GradingKey {
  return (GRADING_KEYS as readonly string[]).includes(key);
}

/**
 * 批改先走的那條路要的鍵。只看 env(側車與終端機建 router 都不給 settings)。
 * openai / anthropic → 那家的鍵;沒設或不認得 → 閘道(probeOnline 回 false,應用題走 local)。
 */
export function requiredGradingKeys(env: CredentialEnv): GradingKey[] {
  const name = resolveProviderName(env);
  if (isCloudProvider(name)) return [envVarFor(name)];
  return ['GATEWAY_API_KEY'];
}

function isUnset(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === '') return true;
  return false;
}

/** requiredGradingKeys 裡值是空或沒設的那些。 */
export function missingGradingKeys(env: CredentialEnv): GradingKey[] {
  const missing: GradingKey[] = [];
  for (const key of requiredGradingKeys(env)) {
    if (isUnset(env[key])) missing.push(key);
  }
  return missing;
}

function rejectedKey(env: CredentialEnv): GradingKey | undefined {
  const key = requiredGradingKeys(env)[0];
  if (key === undefined) return undefined;
  return key;
}

function classify(value: object, env: CredentialEnv): CredentialProblem | undefined {
  if (!(value instanceof Error)) return undefined;
  if (value.name === 'MissingCredentialError' || value instanceof MissingCredentialError) {
    const envVar = (value as { envVar?: unknown }).envVar;
    if (typeof envVar !== 'string' || !isGradingKey(envVar)) return undefined;
    return { kind: 'missing', key: envVar };
  }
  if (value.name === 'GatewayCallError' || value instanceof GatewayCallError) {
    const status = (value as { status?: unknown }).status;
    if (status === 401) return { kind: 'rejected', key: 'GATEWAY_API_KEY' };
    return undefined;
  }
  const status = (value as { status?: unknown }).status;
  if (status !== 401) return undefined;
  const key = rejectedKey(env);
  if (key === undefined) return undefined;
  return { kind: 'rejected', key };
}

/**
 * 認得缺鍵、閘道 401、雲端 401(含包在 cause 裡的)。認不出來回 undefined。
 * 鍵名只能是三個之一;不是就當認不出來。
 */
export function credentialProblem(err: unknown, env: CredentialEnv): CredentialProblem | undefined {
  const seen = new Set<object>();
  let current: unknown = err;
  for (let hop = 0; hop < MAX_CAUSE_HOPS; hop += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    if (seen.has(current)) return undefined;
    seen.add(current);
    const found = classify(current, env);
    if (found !== undefined) return found;
    if (!('cause' in current)) return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isProblem(value: unknown): value is CredentialProblem {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  const key = (value as { key?: unknown }).key;
  if (kind !== 'missing' && kind !== 'rejected') return false;
  if (typeof key !== 'string' || !isGradingKey(key)) return false;
  return true;
}

/** 兩句固定樣板,只換鍵名。不帶值、不帶路徑、不帶例外原文。 */
export function credentialMessage(problem: unknown): string {
  if (!isProblem(problem)) {
    throw new Error('credentialMessage 需要 credentialProblem 認得的問題');
  }
  if (problem.kind === 'missing') {
    return `批改要用的金鑰沒有設定:${problem.key}。請在專案根目錄的 .env 加上。`;
  }
  return `批改用的金鑰被拒絕:${problem.key}(可能過期或打錯)。請在專案根目錄的 .env 換一個。`;
}
