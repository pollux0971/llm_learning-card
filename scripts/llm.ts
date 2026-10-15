/**
 * CLI 入口:scripts/llm.ts。見 features/03-llm-router/FEATURE.md「單獨執行」。
 *
 *   npx tsx scripts/llm.ts --task deepen --prompt "..." [--timeout-ms <ms>]   # 真呼叫,印出 LlmResult 的 JSON
 *   npx tsx scripts/llm.ts --probe                                           # 線上與本機(閘道)狀態,不呼叫模型
 *   npx tsx scripts/llm.ts --fake --log <path> --task deepen --prompt "..."  # 假 adapter,不打任何 provider
 *   npx tsx scripts/llm.ts --fake --log <path> --probe
 *
 * 帳本(T5 / ADR-066,契約 §12 1.4.0):
 * - 真呼叫的帳本**只能**來自使用者層指標檔(`npx tsx scripts/vault.ts init` 建立、`show` 檢查),
 *   型別上是 `VerifiedLedger`。`--log` 在真呼叫模式不是選項,給了就 exit 2——否則 `--log /tmp/x` 會把
 *   錢記進另一本帳,日上限又裂開。指標不存在、讀不到、learning_dir 不存在、標記不符:exit 2,
 *   不發出任何請求、不建任何檔。
 * - `--fake` 用假的 adapter 與假的閘道,一定要 `--log`(`ExplicitLedger`):假呼叫不寫進指標指向的真帳本,
 *   也不會因為少給一個參數就變成真呼叫。
 * - `--probe` 不花錢、也不判斷花了多少(§12 的範圍外),不解析帳本——`standalone.json` 的 03-llm-router
 *   與 phase-4 的 probe 場景都靠它在還沒 init 的機器上照常 exit 0。
 *
 * ADR-034:.env 只在 CLI 入口用 Node 內建的 process.loadEnvFile 載入,檔案不存在時吞掉錯誤;
 * library 程式碼(router.ts 等)只讀 process.env,不碰檔案。
 */
import { pathToFileURL } from 'node:url';
import {
  ExplicitLedger,
  GatewayClient,
  GatewayLlmRouter,
  createLiveGatewayRouter,
  defaultVaultDeps,
  isLlmTask,
  resolveVerifiedLedger,
  type CloudAdapter,
  type LlmRouter,
  type LlmTask,
  type VaultResolveDeps,
  type VerifiedLedger,
} from '../packages/core/src/llm/index.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // 沒有 .env 就用現有的 process.env,例如 CI 直接注入變數
}

export type LlmRunPlan =
  | { kind: 'probe'; mode: 'live' }
  | { kind: 'probe'; mode: 'fake'; ledger: ExplicitLedger }
  | { kind: 'call'; mode: 'live'; ledger: VerifiedLedger; task: LlmTask; prompt: string; timeoutMs?: number }
  | { kind: 'call'; mode: 'fake'; ledger: ExplicitLedger; task: LlmTask; prompt: string; timeoutMs?: number }
  | { kind: 'exit'; exitCode: 1 | 2; message: string };

const USAGE = [
  '用法:llm.ts --task <task> --prompt "<text>" [--timeout-ms <ms>]',
  '     llm.ts --probe',
  '     llm.ts --fake --log <path> (--task <task> --prompt "<text>" | --probe)',
].join('\n');

/** 旗標後面的值;沒有值或下一個是旗標就回 undefined。 */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/**
 * 決定這次要做什麼。純函式:帳本解析用注入的 deps(入口層才給 defaultVaultDeps())。
 * 順序就是規則的優先順序:`--log` 的資格 → `--fake` 必須 `--log` → `--probe` → 用法 → 指標。
 */
export function planLlmRun(argv: readonly string[], deps: VaultResolveDeps): LlmRunPlan {
  const fake = argv.includes('--fake');
  const hasLog = argv.includes('--log');
  if (!fake && hasLog) {
    return {
      kind: 'exit',
      exitCode: 2,
      message:
        '真呼叫的帳本位置只能由指標檔決定,不接受 --log(--log 只在假 adapter 模式 --fake 可用)。' +
        '帳本位置請用 npx tsx scripts/vault.ts init 設定、npx tsx scripts/vault.ts show 檢查。',
    };
  }
  const log = flagValue(argv, '--log');
  if (fake && log === undefined) {
    return {
      kind: 'exit',
      exitCode: 2,
      message: '--fake 一定要給 --log <path>:假呼叫不寫進指標指向的真帳本。',
    };
  }
  const fakeLedger = fake && log !== undefined ? ExplicitLedger.unverified(log, 'scripts/llm.ts --fake --log:假 adapter') : undefined;

  if (argv.includes('--probe')) {
    return fakeLedger === undefined ? { kind: 'probe', mode: 'live' } : { kind: 'probe', mode: 'fake', ledger: fakeLedger };
  }

  const task = flagValue(argv, '--task');
  const prompt = flagValue(argv, '--prompt');
  if (task === undefined || prompt === undefined) return { kind: 'exit', exitCode: 1, message: USAGE };
  if (!isLlmTask(task)) return { kind: 'exit', exitCode: 1, message: `不認得的 task:${task}` };
  const timeoutRaw = flagValue(argv, '--timeout-ms');
  const timing = timeoutRaw === undefined ? {} : { timeoutMs: Number(timeoutRaw) };

  if (fakeLedger !== undefined) return { kind: 'call', mode: 'fake', ledger: fakeLedger, task, prompt, ...timing };

  const resolved = resolveVerifiedLedger(deps);
  if (!resolved.ok) return { kind: 'exit', exitCode: 2, message: resolved.message };
  return { kind: 'call', mode: 'live', ledger: resolved.ledger, task, prompt, ...timing };
}

/** 假模式的環境:不看 process.env / .env,所以真的 key 與閘道設定碰不到。 */
const FAKE_ENV: NodeJS.ProcessEnv = {
  LLM_CLOUD_PROVIDER: 'openai',
  LLM_CLOUD_MODEL: 'fake-cloud-model',
  OPENAI_API_KEY: 'fake-key',
  ANTHROPIC_API_KEY: 'fake-key',
  LLM_LOCAL_MODEL: 'fake-local-model',
};

const fakeCloudAdapter: CloudAdapter = {
  async call({ prompt, model }) {
    return { text: `[fake] ${prompt}`, provider: 'openai', model, latency_ms: 0, tokens_in: prompt.length, tokens_out: 8 };
  },
};

/** 假閘道:換 token、列模型、聊天都在程序內回,不開任何連線。 */
const fakeGatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/auth/token/exchange')) return json({ access_token: 'fake-token', expires_in: 3600 });
  if (url.endsWith('/gateway/models')) return json({ models: { 'fake-local-model': ['chat'] } });
  if (url.endsWith('/gateway/chat')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
    return json({ content: `[fake gateway] ${body.prompt ?? ''}`, model: 'fake-local-model', tokens_used: { prompt: 1, completion: 1 } });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

/** `--fake` 的 router:每個雲端 provider 都是假 adapter,閘道也是假的;事件寫進 `--log` 那本(未驗證)。 */
export function createFakeRouter(ledger: ExplicitLedger): GatewayLlmRouter {
  return new GatewayLlmRouter({
    env: FAKE_ENV,
    ledger,
    adapters: { openai: fakeCloudAdapter, anthropic: fakeCloudAdapter },
    onlineProber: async () => true,
    // 明講底層的本機探測(跟預設值同義:ADR-039 之後閘道才是「本機」),不借道
    // llm.router-impl.local-prober-default 那條退化分支(ADR-044)。
    localProber: async () => ({ available: false, models: [] }),
    gateway: new GatewayClient({
      config: { baseUrl: 'http://fake-gateway.invalid', apiKey: 'fake-key', model: 'fake-local-model' },
      fetchImpl: fakeGatewayFetch,
    }),
  });
}

async function probe(router: LlmRouter): Promise<void> {
  const [online, local] = await Promise.all([router.probeOnline(), router.probeLocal()]);
  console.log(JSON.stringify({ online: online ? 'online' : 'offline', local }, null, 2));
}

/** 入口層:只有這裡拿真的 process.env / os.homedir()(經 defaultVaultDeps)。 */
async function main(): Promise<void> {
  const plan = planLlmRun(process.argv.slice(2), defaultVaultDeps());
  switch (plan.kind) {
    case 'exit':
      console.error(plan.message);
      process.exitCode = plan.exitCode;
      return;
    case 'probe':
      // phase-4(ADR-039):走 GatewayLlmRouter,--probe 才會真的去問閘道有哪些模型。
      // 閘道沒設定時 probeLocal() 一樣回 unavailable,不會爆炸。沒有帳本:probe 不花錢。
      await probe(plan.mode === 'fake' ? createFakeRouter(plan.ledger) : new GatewayLlmRouter());
      return;
    case 'call': {
      const router = plan.mode === 'fake' ? createFakeRouter(plan.ledger) : createLiveGatewayRouter({ ledger: plan.ledger });
      const result = await router.call(plan.task, plan.prompt, plan.timeoutMs === undefined ? {} : { timeoutMs: plan.timeoutMs });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
