/**
 * CLI 入口:scripts/llm.ts。見 features/03-llm-router/FEATURE.md「單獨執行」。
 *
 *   npx tsx scripts/llm.ts --task deepen --prompt "..."
 *   npx tsx scripts/llm.ts --probe
 *   npx tsx scripts/llm.ts --fake --log <path> --probe
 *
 * 真呼叫的帳本只能來自指標檔。--log 在真呼叫模式被拒絕;假 adapter 才可用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  ExplicitLedger,
  createLiveGatewayRouter,
  resolveVerifiedLedger,
  type LedgerHandle,
} from '../packages/core/src/llm/ledger.js';
import { isLlmTask, type LlmTask } from '../packages/core/src/llm/index.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // 沒有 .env 就用現有的 process.env,例如 CI 直接注入變數
}

export interface LlmLedgerInput {
  argv: string[];
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
}

export type LlmLedgerResult =
  | { ok: true; ledger: LedgerHandle; fake: boolean }
  | { ok: false; exitCode: 2; message: string };

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

export function resolveLlmLedger(input: LlmLedgerInput): LlmLedgerResult {
  const fake = hasFlag(input.argv, '--fake');
  const log = flagValue(input.argv, '--log');
  if (!fake && log !== undefined) {
    return {
      ok: false,
      exitCode: 2,
      message:
        '真呼叫的帳本位置只能由指標檔決定,不能用 --log。請執行 npx tsx scripts/vault.ts init 或 npx tsx scripts/vault.ts show。',
    };
  }
  if (fake && log !== undefined) {
    return { ok: true, fake: true, ledger: ExplicitLedger.unverified(log, 'scripts/llm.ts --fake --log') };
  }
  const resolved = resolveVerifiedLedger(input);
  if (!resolved.ok) return { ok: false, exitCode: 2, message: resolved.message };
  return { ok: true, fake, ledger: resolved.ledger };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const resolved = resolveLlmLedger({
    argv,
    env: process.env,
    homedir: () => homedir(),
    readFile: (path) => readFileSync(path, 'utf8'),
    exists: existsSync,
  });
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exitCode = resolved.exitCode;
    return;
  }
  if (resolved.ledger.kind !== 'verified') {
    if (hasFlag(argv, '--probe')) {
      console.log(JSON.stringify({ online: 'offline', local: { available: false, models: [] }, ledger: 'unverified' }));
      return;
    }
    console.error('假 adapter 的 --log 不能拿來打真的網路。');
    process.exitCode = 2;
    return;
  }

  const router = createLiveGatewayRouter({ ledger: resolved.ledger });
  if (hasFlag(argv, '--probe')) {
    const [online, local] = await Promise.all([router.probeOnline(), router.probeLocal()]);
    console.log(JSON.stringify({ online: online ? 'online' : 'offline', local }, null, 2));
    return;
  }

  const task = flagValue(argv, '--task');
  const prompt = flagValue(argv, '--prompt');
  if (task === undefined || prompt === undefined) {
    console.error('用法:llm.ts --task <task> --prompt "<text>" [--timeout-ms <ms>]');
    console.error('     llm.ts --probe');
    console.error('     llm.ts --fake --log <path> --probe');
    process.exitCode = 1;
    return;
  }
  if (!isLlmTask(task)) {
    console.error(`不在契約裡的任務:"${task}"`);
    process.exitCode = 1;
    return;
  }
  const timeoutRaw = flagValue(argv, '--timeout-ms');
  const timeoutMs = timeoutRaw === undefined ? undefined : Number(timeoutRaw);
  const result = await router.call(task as LlmTask, prompt, timeoutMs !== undefined ? { timeoutMs } : {});
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
