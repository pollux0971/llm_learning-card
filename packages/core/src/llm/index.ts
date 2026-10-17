export * from './types.js';
export * from './errors.js';
export { CloudLlmRouter, type CloudLlmRouterOptions, type CloudSettings, type LogAppender } from './router.js';
export {
  credentialMessage,
  credentialProblem,
  envVarFor,
  missingGradingKeys,
  requiredGradingKeys,
  resolveProviderName,
  type CredentialEnv,
  type CredentialProblem,
  type GradingKey,
  type ProviderSettings,
} from './credentials.js';
export { llmUnavailableReason, type LlmUnavailableReason } from './failures.js';
export { anthropicAdapter } from './adapters/anthropic.js';
export { openaiAdapter } from './adapters/openai.js';
export { decideRoute, ROUTING_TABLE, type RouteGroup, type RouteInput, type RouteDecision } from './routing.js';
export { TASK_MAX_TOKENS } from './token-limits.js';
// -------------------------------------------------------------- T5(ADR-066):帳本指標與身分
export {
  ExplicitLedger,
  VerifiedLedger,
  VAULT_INIT_CMD,
  VAULT_SHOW_CMD,
  defaultVaultDeps,
  resolveVerifiedLedger,
  vaultPointerPath,
  type LedgerHandle,
  type VaultRejectReason,
  type VaultResolveDeps,
  type VaultResolveResult,
} from './ledger.js';
export {
  LlmRouterImpl,
  type LlmRouterImplOptions,
  type RouterSettings,
  type LocalProber,
  type OnlineProber,
} from './router-impl.js';

// -------------------------------------------------------------- phase-4(ADR-039)
export {
  GatewayClient,
  createGatewayClient,
  GATEWAY_PROVIDER,
  GATEWAY_DEFAULT_SERVICE,
  DEFAULT_GATEWAY_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  GATEWAY_PROBE_TIMEOUT_MS,
  GATEWAY_TOKEN_FALLBACK_TTL_MS,
  type CachedToken,
  type GatewayChatArgs,
  type GatewayChatResult,
  type GatewayClientOptions,
  type GatewayConfig,
  type GatewayProbeResult,
} from './adapters/gateway.js';
export {
  decideFallback,
  FALLBACK_TABLE,
  type CloudStatus,
  type FallbackDecision,
  type FallbackGroup,
  type FallbackInput,
  type FallbackReason,
} from './fallback.js';
export {
  computeDailySpend,
  dayOf,
  describeBadLine,
  isBudgetExhausted,
  isLlmCallEvent,
  parseLedger,
  readDailyCapUsd,
  readDailySpend,
  readSpendPrices,
  BAD_LINE_PREVIEW_CHARS,
  DEFAULT_DAILY_CAP_USD,
  DEFAULT_SPEND_PRICES,
  MissingLedgerError,
  UnknownSpendError,
  type BadLedgerLine,
  type DailySpend,
  type LedgerParse,
  type SpendPrices,
} from './spend.js';
export {
  GatewayLlmRouter,
  createLiveGatewayRouter,
  isCloudFailure,
  CLOUD_FAILURE_ERRORS,
  type ExplicitLedgerOptions,
  type GatewayLlmRouterBaseOptions,
  type GatewayLlmRouterOptions,
  type LiveGatewayRouterOptions,
  type NoLedgerOptions,
  type VerifiedLedgerOptions,
} from './router-gateway.js';
