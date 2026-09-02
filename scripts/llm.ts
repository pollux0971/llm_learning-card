/**
 * CLI 入口:scripts/llm.ts。見 features/03-llm-router/FEATURE.md「單獨執行」。
 *
 *   npx tsx scripts/llm.ts --task deepen --prompt "..."   # 印出 LlmResult 的 JSON
 *   npx tsx scripts/llm.ts --probe                        # 印出線上與本機狀態,不呼叫模型
 *
 * ADR-034:.env 只在 CLI 入口用 Node 內建的 process.loadEnvFile 載入,檔案不存在時吞掉錯誤;
 * library 程式碼(router.ts 等)只讀 process.env,不碰檔案。
 */
import { CloudLlmRouter, isLlmTask, type LlmTask } from '../packages/core/src/llm/index.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // 沒有 .env 就用現有的 process.env,例如 CI 直接注入變數
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logPath = typeof args.log === 'string' ? args.log : 'learning/state/log.jsonl';
  const router = new CloudLlmRouter({ logPath });

  if (args.probe) {
    const [online, local] = await Promise.all([router.probeOnline(), router.probeLocal()]);
    console.log(JSON.stringify({ online: online ? 'online' : 'offline', local }, null, 2));
    return;
  }

  const task = args.task;
  const prompt = args.prompt;
  if (typeof task !== 'string' || typeof prompt !== 'string') {
    console.error('用法:llm.ts --task <task> --prompt "<text>" [--timeout-ms <ms>] [--log <path>]');
    console.error('     llm.ts --probe');
    process.exitCode = 1;
    return;
  }
  if (!isLlmTask(task)) {
    console.error(`不在契約裡的任務:"${task}"`);
    process.exitCode = 1;
    return;
  }

  const timeoutMs = typeof args['timeout-ms'] === 'string' ? Number(args['timeout-ms']) : undefined;
  const result = await router.call(task as LlmTask, prompt, timeoutMs !== undefined ? { timeoutMs } : {});
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
