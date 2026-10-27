/**
 * CLI 邏輯本體。scripts/prompt-check.ts 是薄薄的入口,呼叫這裡的 main()。
 * 拆開是為了讓 main() 可以直接被 vitest 測試,不用真的 spawn 子程序。
 *
 * 用法(FEATURE.md):
 *   prompt-check.ts --list
 *   prompt-check.ts --golden [--set <golden set>] [--fake] [--out <存放根目錄>]
 *   prompt-check.ts --diff <run 目錄 A> <run 目錄 B>
 *   prompt-check.ts --overlap <children run 目錄> <parents run 目錄> [--threshold <0..1>]
 *   prompt-check.ts --overlap-siblings <children run 目錄> <cards run 目錄> [--threshold <0..1>]
 *
 * `--set` 收的是 **golden set id**,不是契約 §7 的 LlmTask:`ingest/` 底下三個 prompt 檔
 * 共用 `'ingest.cards'` 這一個任務,一個檔一組 golden set,所以要各自的 key。
 *
 * --fake(預設)重播 fixture,不花錢不碰網路;--live(phase-2)走 03-llm-router 的
 * 真 router 打雲端,會花錢。離線或今日預算已用完時直接拒絕、不留下半個空目錄。
 * --out 不給時,fake run 存到 golden-fake/(不進 git),live run 存到 golden/(進 git);
 * 見 golden-run.ts 的 defaultGoldenBaseDir()。測試一律傳暫存目錄,不碰 repo 裡的檔案。
 * dirty 的 prompt 若解析後的輸出目錄落在 golden/ 底下(沒給 --out 時 live 的預設就是那裡),
 * 退出碼非 0:先提交,或用 --out 指到 golden/ 以外。不建目錄、不呼叫 router。
 */
import { runGolden, MissingGoldenSetError, LiveRunOfflineError, LiveRunBudgetExceededError, DirtyPromptError } from './golden-run.js';
import { compareRuns, LegacyRunLayoutError, NotComparableError } from './compare.js';
import {
  checkGoldenParentChild,
  checkGoldenSiblings,
  CROSS_CARD_OBSERVE_THRESHOLD,
  CROSS_CARD_OVERLAP_THRESHOLD,
  PARENT_CHILD_OVERLAP_THRESHOLD,
  type SiblingPair,
} from './parent-child-overlap.js';
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

export async function main(argv: string[], deps?: { root?: string }): Promise<CliResult> {
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

  if (argv.includes('--overlap-siblings')) {
    return runOverlapSiblings(argv, log, lines);
  }

  if (argv.includes('--overlap')) {
    return runOverlap(argv, log, lines);
  }

  if (argv.includes('--golden')) {
    return runGoldenCommand(argv, log, lines, deps);
  }

  log(
    '用法:prompt-check.ts --list  |  --golden [--set <golden set>] [--fake | --live] [--out <存放根目錄>]  |  --diff <run 目錄 A> <run 目錄 B>  |  --overlap <children run 目錄> <parents run 目錄> [--threshold <0..1>]  |  --overlap-siblings <children run 目錄> <cards run 目錄> [--threshold <0..1>]',
  );
  return { code: 1, output: lines.join('\n') };
}

/** `--threshold` 只收 0..1 的十進位數字。空字串 `Number('') === 0`,不能靠 Number() 自己擋。 */
function parseUnitInterval(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^(?:0|1)(?:\.0+)?$|^0\.\d+$|^[1-9]\d*\.\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return n;
}

/**
 * 父卡 run 對子卡 run 的字面重疊。0 對 → 退出碼 0;有對、路徑錯、配不起來、門檻不合法 → 1。
 * 錯誤只印原因,不把例外丟出去(呼叫端是終端機,stack trace 不是給人看的訊息)。
 */
function runOverlap(argv: string[], log: (s: string) => void, lines: string[]): CliResult {
  const i = argv.indexOf('--overlap');
  const childrenDir = argv[i + 1];
  const parentsDir = argv[i + 2];
  if (!childrenDir || !parentsDir || childrenDir.startsWith('--') || parentsDir.startsWith('--')) {
    log('用法:prompt-check.ts --overlap <children run 目錄> <parents run 目錄> [--threshold <0..1>]');
    return { code: 1, output: lines.join('\n') };
  }

  const threshold = argv.includes('--threshold') ? parseUnitInterval(arg(argv, '--threshold')) : undefined;
  if (argv.includes('--threshold') && threshold === undefined) {
    log('--threshold 需要 0 到 1 的數字:--threshold <0..1>');
    return { code: 1, output: lines.join('\n') };
  }

  try {
    const result = checkGoldenParentChild({
      childrenDir,
      parentsDir,
      ...(threshold !== undefined ? { opts: { threshold } } : {}),
    });
    const used = threshold ?? PARENT_CHILD_OVERLAP_THRESHOLD;
    log(`重疊 ${result.totalPairs} 對(字面;門檻 ${used.toFixed(3)}。改寫式重述歸人評分,0 對不等於語意沒重複)`);
    for (const input of result.inputs) {
      log(`${input.key}: 父 ${input.report.parentCount} × 子 ${input.report.childCount},成立 ${input.report.pairs.length} 對`);
      for (const pair of input.report.pairs) {
        log(`  ${input.key} ${pair.child} 對 ${pair.parent} 重疊 ${pair.overlap.toFixed(3)}(${pair.reason})`);
      }
    }
    log(`最高 ${result.maxOverlap.toFixed(3)}`);
    return { code: result.totalPairs > 0 ? 1 : 0, output: lines.join('\n') };
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return { code: 1, output: lines.join('\n') };
  }
}

function formatSiblingPair(pair: SiblingPair): string {
  const side = (s: SiblingPair['child']): string => `${s.key}#${s.index}「${s.title}」`;
  return `  ${side(pair.child)} ↔ ${side(pair.other)} 重疊 ${pair.overlap.toFixed(3)}`;
}

/**
 * 跨卡字面重疊。pairs 為空 → 退出碼 0,否則 1。觀察清單一律印(0 對也印),不擋。
 * 錯誤只印原因,不把例外丟出去。
 */
function runOverlapSiblings(argv: string[], log: (s: string) => void, lines: string[]): CliResult {
  const i = argv.indexOf('--overlap-siblings');
  const childrenDir = argv[i + 1];
  const cardsDir = argv[i + 2];
  if (!childrenDir || !cardsDir || childrenDir.startsWith('--') || cardsDir.startsWith('--')) {
    log('用法:prompt-check.ts --overlap-siblings <children run 目錄> <cards run 目錄> [--threshold <0..1>]');
    return { code: 1, output: lines.join('\n') };
  }

  const threshold = argv.includes('--threshold') ? parseUnitInterval(arg(argv, '--threshold')) : undefined;
  if (argv.includes('--threshold') && threshold === undefined) {
    log('--threshold 需要 0 到 1 的數字:--threshold <0..1>');
    return { code: 1, output: lines.join('\n') };
  }

  try {
    const result = checkGoldenSiblings({
      childrenDir,
      cardsDir,
      ...(threshold !== undefined ? { opts: { threshold } } : {}),
    });
    const used = threshold ?? CROSS_CARD_OVERLAP_THRESHOLD;
    log(`跨卡重疊 ${result.pairs.length} 對(字面;門檻 ${used.toFixed(3)}。改寫式重述歸人評分,0 對不等於語意沒重複)`);
    for (const pair of result.pairs) log(formatSiblingPair(pair));
    log(`觀察清單 ${result.observe.length} 對(${CROSS_CARD_OBSERVE_THRESHOLD.toFixed(3)} ≤ 重疊 < ${used.toFixed(3)},不擋)`);
    for (const pair of result.observe) log(formatSiblingPair(pair));
    log(`最高 ${result.maxOverlap.toFixed(3)}`);
    return { code: result.pairs.length > 0 ? 1 : 0, output: lines.join('\n') };
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return { code: 1, output: lines.join('\n') };
  }
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

async function runGoldenCommand(
  argv: string[],
  log: (s: string) => void,
  lines: string[],
  deps?: { root?: string },
): Promise<CliResult> {
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
      // --out 給的話,live 模式的 settings 從同一個目錄讀(呼應 scripts/ingest.ts 的 outDir 慣例)。
      // 帳本**不跟著 --out**(T5 / ADR-066):--live 的帳本只來自使用者層指標檔驗證過的那本——
      // `--out /tmp/x --live` 若把錢記進 /tmp/x/state/log.jsonl,日上限又裂成兩本。
      // 測試一律用沙箱的 HOME / XDG_CONFIG_HOME 與合成指標(ADR-032、T5 第 15 條)。
      const result = await runGolden({
        set,
        mode,
        ...(outDir ? { baseDir: outDir, learningDir: outDir } : {}),
        ...(deps?.root !== undefined ? { root: deps.root } : {}),
      });
      totalInputs += result.outputs.length;
      log(`✓ golden run ${set} → ${result.dir}(${result.outputs.length} 個輸入)`);
      if (mode === 'live') {
        const { tokens_in = 0, tokens_out = 0, estimated_cost_usd, model, provider } = result.meta;
        // ADR-050:這行只是估計(golden-run.ts 的 ModelPriceTable),跟 llm-spend.ts
        // 那條真的預算煞車(讀 .env 的 LLM_PRICE_IN_PER_M / OUT,不看 model 名字)
        // 是兩個互相獨立的機制。這裡不估,不代表煞車也沒接上——訊息要講清楚,
        // 不然「不估」很容易被誤讀成「上限也不會動」。
        const cost =
          estimated_cost_usd == null
            ? '(此模型未定價,上面的估計不可用;每日上限走 .env 費率,仍然有效)'
            : `約 US$${estimated_cost_usd.toFixed(4)}`;
        log(`  模型 ${provider}/${model},token 進 ${tokens_in} 出 ${tokens_out},花費 ${cost}`);
      }
      for (const o of result.outputs) {
        if (o.structural.issues.length) {
          anyIssues += o.structural.issues.length;
          log(`  ⚠ ${o.id}: ${o.structural.issues.map((i) => i.kind).join(', ')}`);
        }
      }
    } catch (e) {
      if (e instanceof DirtyPromptError) {
        log(`✗ ${e.message}`);
        return { code: 1, output: lines.join('\n') };
      }
      if (e instanceof LiveRunOfflineError || e instanceof LiveRunBudgetExceededError) {
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
