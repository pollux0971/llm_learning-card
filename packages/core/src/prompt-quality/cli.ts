/**
 * CLI 邏輯本體。scripts/prompt-check.ts 是薄薄的入口,呼叫這裡的 main()。
 * 拆開是為了讓 main() 可以直接被 vitest 測試,不用真的 spawn 子程序。
 *
 * 用法(FEATURE.md):
 *   prompt-check.ts --list
 *   prompt-check.ts --golden [--set <golden set>] [--fake] [--out <存放根目錄>]
 *   prompt-check.ts --diff <run 目錄 A> <run 目錄 B>
 *
 * `--set` 收的是 **golden set id**,不是契約 §7 的 LlmTask:`ingest/` 底下三個 prompt 檔
 * 共用 `'ingest.cards'` 這一個任務,一個檔一組 golden set,所以要各自的 key。
 *
 * --fake(預設)重播 fixture,不花錢不碰網路;--live(phase-2)走 03-llm-router 的
 * 真 router 打雲端,會花錢,而且離線時直接拒絕、不留下半個空目錄。
 * --out 不給時,fake run 存到 golden-fake/(不進 git),live run 存到 golden/(進 git);
 * 見 golden-run.ts 的 defaultGoldenBaseDir()。測試一律傳暫存目錄,不碰 repo 裡的檔案。
 */
import { runGolden, MissingGoldenSetError, LiveRunOfflineError } from './golden-run.js';
import { compareRuns, LegacyRunLayoutError, NotComparableError } from './compare.js';
import {
  allGoldenSets,
  checkPromptCoverage,
  listGoldenSets,
  PROMPTS_DIR,
  REAL_TASK_GOLDEN_SET_IDS,
} from './golden-sets/registry.js';
import type { PromptCoverage } from './golden-sets/registry.js';
import type { GoldenSetId } from './types.js';

/**
 * 三支掃描器共用的那句話(check-boundaries.ts / check-doc-links.ts / check-standalone.ts
 * 各自留一份,不跨資料夾 import)。0 個東西的紅,方向永遠是「掃描器壞了」。
 */
export const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

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

  if (argv.includes('--list')) {
    return runList(log, lines, checkPromptCoverage());
  }

  if (argv.includes('--diff')) {
    return runDiff(argv, log, lines);
  }

  if (argv.includes('--golden')) {
    return runGoldenCommand(argv, log, lines);
  }

  log('用法:prompt-check.ts --list  |  --golden [--set <golden set>] [--fake | --live] [--out <存放根目錄>]  |  --diff <run 目錄 A> <run 目錄 B>');
  return { code: 1, output: lines.join('\n') };
}

/**
 * 登記了哪些 golden set,以及**每個 prompt 檔是不是恰好被一組登記了**。
 *
 * 後者是守門(工單第 3 項):沒被任何 golden set 引用的 prompt 檔就退出碼 1。
 * 改了那個檔、跑 `--diff` 只會拿到「沒有變化」,因為根本沒在比那個 prompt——
 * 「框架有沒有接上真的東西」不能靠下一個人記得問。
 *
 * 被**兩組以上**指到也是 1:那一組的基準其實在評別人的 prompt,改了自己的 prompt 檔
 * 一樣沒有人在看。守門要的是「恰好一組」,不是「至少一組」。
 *
 * 掃到 0 個 prompt 檔一樣是 1(P-28:空的掃描器跟全綠一樣)。
 */
export function runList(log: (s: string) => void, lines: string[], coverage: PromptCoverage): CliResult {
  log('登記的 golden set:');
  for (const set of allGoldenSets()) {
    const real = REAL_TASK_GOLDEN_SET_IDS.includes(set.id) ? '' : '(自我測試,不是真實任務)';
    log(`- ${set.id} → LlmTask ${set.task},prompt ${set.promptFile},${set.inputs.length} 個輸入${real}`);
  }

  log('');
  log(`${PROMPTS_DIR}/ 底下掃到 ${coverage.scanned.length} 個 prompt 檔。`);

  if (coverage.scannerBroken) {
    log(`✗ 一個 prompt 檔都沒掃到:${SCANNER_BROKEN}(${PROMPTS_DIR}/)`);
    return { code: 1, output: lines.join('\n') };
  }
  let failed = false;
  for (const f of coverage.missing) {
    log(`✗ 登記表指到不存在的 prompt 檔:${f}`);
    failed = true;
  }
  for (const f of coverage.unregistered) {
    log(`✗ 這個 prompt 檔沒有任何 golden set 登記,改了它不會有人發現:${f}`);
    failed = true;
  }
  // 引用數 2 跟引用數 0 一樣糟:其中一組的基準其實在評別人的 prompt。
  for (const d of coverage.duplicated) {
    log(`✗ 這個 prompt 檔被 ${d.sets.length} 組 golden set 登記(要恰好一組),${d.sets.join(' / ')} 都指到:${d.promptFile}`);
    failed = true;
  }
  if (!failed) log('✓ 每個 prompt 檔都恰好被一組 golden set 登記。');
  return { code: failed ? 1 : 0, output: lines.join('\n') };
}

async function runGoldenCommand(argv: string[], log: (s: string) => void, lines: string[]): Promise<CliResult> {
  const explicitSet = (arg(argv, '--set') ?? arg(argv, '--task')) as GoldenSetId | undefined;
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
  const sets = explicitSet ? [explicitSet] : listGoldenSets();
  let totalInputs = 0;
  let anyIssues = 0;
  let failed = false;

  for (const set of sets) {
    try {
      const result = await runGolden({ set, mode, ...(outDir ? { baseDir: outDir } : {}) });
      totalInputs += result.outputs.length;
      log(`✓ golden run ${set} → ${result.dir}(${result.outputs.length} 個輸入)`);
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
        // 明確指定的 set 沒登記才算失敗;預設跑全部時,尚未登記的略過即可。
        if (explicitSet) failed = true;
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
    log(`比對 ${result.set}:${dirA} vs ${dirB}`);
    for (const item of result.items) {
      log(`- ${item.id} ${item.same ? '(相同)' : '(不同)'}`);
      log(`  A: ${item.outputA ?? '(缺)'}`);
      log(`  B: ${item.outputB ?? '(缺)'}`);
      if (item.scoresA) log(`  A 的分數: ${JSON.stringify(item.scoresA)}`);
      if (item.scoresB) log(`  B 的分數: ${JSON.stringify(item.scoresB)}`);
    }
    return { code: 0, output: lines.join('\n') };
  } catch (e) {
    if (e instanceof NotComparableError || e instanceof LegacyRunLayoutError) {
      log(e.message);
      return { code: 1, output: lines.join('\n') };
    }
    throw e;
  }
}
