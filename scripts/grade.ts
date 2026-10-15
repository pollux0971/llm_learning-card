/**
 * 05-grading 的單獨執行入口。
 *
 * 用法:
 *   npx tsx scripts/grade.ts --fill --q <questions.yaml> --index <n> --answer "<逗號分隔,依空格順序>"
 *
 * 印出 GradeResult 的 JSON 到 stdout。
 *
 * router 是惰性的:第一、二層(exact、fuzzy)從不碰它,沒有指標檔也照常。
 * 要用到第三層才解析帳本;失敗印 message、退出碼 2。成功則走跟 scripts/llm.ts
 * 同一條真呼叫路(createLiveGatewayRouter)。
 *
 * --apply(rubric 應用題審核)是 phase-2 的範圍,這裡先不做,呼叫時明確報錯。
 */
import './_env.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { gradeFillQuestion } from '../packages/core/src/grading/grade-fill.js';
import type { FillQuestion, LlmResult, LlmRouter, LlmTask } from '../packages/core/src/grading/types.js';
import {
  createLiveGatewayRouter,
  defaultVaultDeps,
  resolveVerifiedLedger,
} from '../packages/core/src/llm/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usageError(message: string): never {
  console.error(message);
  console.error('用法:grade.ts --fill --q <questions.yaml> --index <n> --answer "<逗號分隔>"');
  process.exit(1);
}

/**
 * 第一次 call/probe 才解析帳本。失敗時 process.exit(2),不丟錯——
 * gradeFillQuestion 會把 router.call 的例外收成 fallback-strict,那不是這裡要的。
 */
function lazyVerifiedRouter(): LlmRouter {
  let live: LlmRouter | undefined;
  const ensure = (): LlmRouter => {
    if (live !== undefined) return live;
    const resolved = resolveVerifiedLedger(defaultVaultDeps());
    if (!resolved.ok) {
      console.error(resolved.message);
      process.exit(2);
    }
    live = createLiveGatewayRouter({ ledger: resolved.ledger });
    return live;
  };
  return {
    call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number }): Promise<LlmResult> {
      const router = ensure();
      return opts === undefined ? router.call(task, prompt) : router.call(task, prompt, opts);
    },
    probeOnline() {
      return ensure().probeOnline();
    },
    probeLocal() {
      return ensure().probeLocal();
    },
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) {
    console.error('--apply 尚未實作:rubric 應用題審核是 phase-2 的範圍。');
    process.exit(1);
  }
  if (!process.argv.includes('--fill')) {
    usageError('目前只實作 --fill(填空三層審核)。');
  }

  const qPath = arg('--q');
  const indexArg = arg('--index');
  const answerArg = arg('--answer');
  if (!qPath || indexArg === undefined || answerArg === undefined) {
    usageError('缺少 --q / --index / --answer。');
  }

  const index = Number(indexArg);
  if (!Number.isInteger(index) || index < 0) {
    usageError(`--index 必須是不小於 0 的整數,收到:${indexArg}`);
  }

  const file = readFileSync(resolve(process.cwd(), qPath), 'utf8');
  const data = parseYaml(file) as { fill?: FillQuestion[] };
  const question = data.fill?.[index];
  if (!question) {
    usageError(`${qPath} 的 fill 陣列沒有 index ${index}`);
  }

  const answers = answerArg.split(',').map((s) => s.trim());
  const result = await gradeFillQuestion(question, answers, lazyVerifiedRouter());
  console.log(JSON.stringify(result));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
