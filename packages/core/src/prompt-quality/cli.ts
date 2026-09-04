/**
 * CLI 邏輯本體。scripts/prompt-check.ts 是薄薄的入口,呼叫這裡的 main()。
 * 拆開是為了讓 main() 可以直接被 vitest 測試,不用真的 spawn 子程序。
 *
 * 用法(FEATURE.md):
 *   prompt-check.ts --golden [--task <task>] [--fake] [--out <存放根目錄>]
 *   prompt-check.ts --diff <run 目錄 A> <run 目錄 B>
 *
 * --fake(預設)重播 fixture,不花錢不碰網路;--live(phase-2)走 03-llm-router 的
 * 真 router 打雲端,會花錢,而且離線時直接拒絕、不留下半個空目錄。
 * --out 不給時,fake run 存到 golden-fake/(不進 git),live run 存到 golden/(進 git);
 * 見 golden-run.ts 的 defaultGoldenBaseDir()。測試一律傳暫存目錄,不碰 repo 裡的檔案。
 */
import { runGolden, MissingGoldenSetError, LiveRunOfflineError } from './golden-run.js';
import { compareRuns, NotComparableError } from './compare.js';
import { listGoldenTasks } from './golden-sets/registry.js';
import type { LlmTask } from './types.js';

export interface CliResult {
  code: number;
  output: string;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<CliResult> {
  const lines: string[] = [];
  const log = (s: string): void => {
    lines.push(s);
  };

  if (argv.includes('--diff')) {
    return runDiff(argv, log, lines);
  }

  if (argv.includes('--golden')) {
    return runGoldenCommand(argv, log, lines);
  }

  log('用法:prompt-check.ts --golden [--task <task>] [--fake | --live] [--out <存放根目錄>]  |  --diff <run 目錄 A> <run 目錄 B>');
  return { code: 1, output: lines.join('\n') };
}

async function runGoldenCommand(argv: string[], log: (s: string) => void, lines: string[]): Promise<CliResult> {
  const explicitTask = arg(argv, '--task') as LlmTask | undefined;
  const outDir = arg(argv, '--out');
  if (argv.includes('--out') && !outDir) {
    log('--out 需要一個目錄:--out <存放根目錄>');
    return { code: 1, output: lines.join('\n') };
  }
  if (argv.includes('--fake') && argv.includes('--live')) {
    log('--fake 與 --live 只能擇一。');
    return { code: 1, output: lines.join('\n') };
  }
  const mode = argv.includes('--live') ? ('live' as const) : ('fake' as const);
  const tasks = explicitTask ? [explicitTask] : listGoldenTasks();
  let totalInputs = 0;
  let anyIssues = 0;
  let failed = false;

  for (const task of tasks) {
    try {
      const result = await runGolden({ task, mode, ...(outDir ? { baseDir: outDir } : {}) });
      totalInputs += result.outputs.length;
      log(`✓ golden run ${task} → ${result.dir}(${result.outputs.length} 個輸入)`);
      if (mode === 'live') {
        const { tokens_in = 0, tokens_out = 0, estimated_cost_usd, model, provider } = result.meta;
        const cost = estimated_cost_usd == null ? '(model 不在價目表上,不估)' : `約 US$${estimated_cost_usd.toFixed(4)}`;
        log(`  模型 ${provider}/${model},token 進 ${tokens_in} 出 ${tokens_out},花費 ${cost}`);
      }
      for (const o of result.outputs) {
        if (o.structural.issues.length) {
          anyIssues += o.structural.issues.length;
          log(`  ⚠ ${o.id}: ${o.structural.issues.map((i) => i.kind).join(', ')}`);
        }
      }
    } catch (e) {
      if (e instanceof LiveRunOfflineError) {
        log(`✗ ${e.message}`);
        return { code: 1, output: lines.join('\n') };
      }
      if (e instanceof MissingGoldenSetError) {
        log(`✗ ${e.message}`);
        // 明確指定的 task 缺 golden set 才算失敗;預設跑全部時,尚未登記的任務略過即可。
        if (explicitTask) failed = true;
        continue;
      }
      throw e;
    }
  }

  log(`golden run 完成:處理了 ${totalInputs} 個 golden 輸入${anyIssues ? `,${anyIssues} 個結構性問題(不代表品質不好,是不是好內容要人評分)` : ''}`);
  return { code: failed ? 1 : 0, output: lines.join('\n') };
}

function runDiff(argv: string[], log: (s: string) => void, lines: string[]): CliResult {
  const i = argv.indexOf('--diff');
  const dirA = argv[i + 1];
  const dirB = argv[i + 2];
  if (!dirA || !dirB) {
    log('--diff 需要兩個 run 目錄:--diff <run 目錄 A> <run 目錄 B>');
    return { code: 1, output: lines.join('\n') };
  }

  try {
    const result = compareRuns(dirA, dirB);
    log(`比對 ${result.task}:${dirA} vs ${dirB}`);
    for (const item of result.items) {
      log(`- ${item.id} ${item.same ? '(相同)' : '(不同)'}`);
      log(`  A: ${item.outputA ?? '(缺)'}`);
      log(`  B: ${item.outputB ?? '(缺)'}`);
      if (item.scoresA) log(`  A 的分數: ${JSON.stringify(item.scoresA)}`);
      if (item.scoresB) log(`  B 的分數: ${JSON.stringify(item.scoresB)}`);
    }
    return { code: 0, output: lines.join('\n') };
  } catch (e) {
    if (e instanceof NotComparableError) {
      log(e.message);
      return { code: 1, output: lines.join('\n') };
    }
    throw e;
  }
}
