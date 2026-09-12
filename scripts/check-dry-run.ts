// SOURCE: template v1.6.4 (4dc1513) sha256=02a4dfa0b5fdf8fe0833b540ce9d04852c5836ae4ea4ad3e5e8223fee461d093 — 勿手改;升版用 sync-gates.sh
/**
 * cucumber dry-run 守門:讀摘要行,不信退出碼(P-86,來源 AI_KM 顧問 2026-09-08)。
 *
 * 背景:`cucumber-js --dry-run` 會把 ambiguous(同一句話對到兩個定義)與 undefined(沒有
 * 任何定義)都印在摘要行裡——例如 `822 steps (1 ambiguous, …)`——但 **exit 0,加 `--strict`
 * 仍然 0**(@cucumber/cucumber 11.3.0 實測,見 CHANGELOG 1.6.0;`--strict` 只管 pending,
 * 不管 dry-run 下的 ambiguous/undefined)。直接把 `npm run accept:dry` 接進 CI 或
 * `gates.config.json` 的 `chain`,就是「接上了、印得出錯、永遠不紅」的守門——正是 P-32 /
 * P-43 那一型:綠燈來自「沒有人看結果」,不是「結果是對的」。
 *
 * 這支腳本做的事只有一件:自己跑一次 dry-run,把摘要行讀回來,**依摘要行判紅綠**:
 *   - 摘要行 `N scenarios (...)` / `N steps (...)` 裡出現 undefined / ambiguous / failed
 *     任一桶且數字 ≥ 1 → exit 1,把每桶的數字印出來。
 *   - `N scenarios` 是 0 → exit 1,印「掃到 0 個場景……掃描器壞了」——跟 P-32 同一條規則:
 *     tag 過濾器、paths 設定、feature 檔全被排除,任一種都會讓 dry-run「什麼都沒檢查」
 *     卻宣稱通過;0 目標永遠是掃描器壞了,不是很乾淨。
 *   - 輸出裡找不到摘要行、cucumber 起不來、或 cucumber 自己退出碼非 0(例如 Parse
 *     error,P-16)→ exit 1。**只有「退出碼非 0」這個方向信 cucumber**——它說壞就是壞;
 *     它說好(exit 0)不算數,要摘要行也乾淨才算。
 *   - 其餘 → exit 0。
 *
 * cucumber 的完整輸出(含 `Failures:` 清單,指出哪兩個定義撞了)原樣透傳到終端機,
 * 摘要行的判斷印在最後——終端機前的人看到的就是 cucumber 自己的訊息,不是轉述。
 *
 * **兩段,兩種桶(AI_KM 2026-09-08 第二輪)**:consumer 依規格刻意讓「還沒做」的場景 undefined
 * (todo 整合點、`@model` 場景——那是「還沒做」不是「弄壞了」),驗收 job 用 `--tags` 把它們排除。
 * 裸跑 dry-run 會把這些設計上的 undefined 當成錯,升版後第一次紅的不是 P-32 清單,是 todo。所以:
 *   段 A(驗收集合):用跟驗收 job **相同**的 tag 運算式跑,undefined / ambiguous / failed 都紅。
 *     tag 來源優先序:`--tags <expr>` 旗標 > `gates.config.json` 的 `dryRun.tags` > 不帶
 *     (交給 cucumber 設定檔自己的 `tags`)。
 *   段 B(全集):**不帶** `--tags` 再跑一次(cucumber 設定檔的 `tags` 仍生效),只看 ambiguous——
 *     兩個定義撞名跟 tag 無關,被 tag 排除的場景一旦被排進來就炸,所以要對全集看;undefined 在
 *     這一段一律不算(那正是刻意的 todo)。段 A 沒帶任何 tag 時,段 B 跟段 A 是同一次執行,略過。
 *   `scanned` 是段 A 的場景數。
 *
 * cucumber 執行目錄(cwd)三層決定,跟 `check-phase-coverage.ts` / `check-known-defects.ts`
 * 同一套(各自一份,不共用 helper——`sync-gates.sh` 把每支 check-*.ts 當獨立檔案複製):
 *   `--cwd` 旗標 > `gates.config.json` 的 `"cucumberCwd"` > 自動偵測(ROOT 或它的直接
 *   子目錄有沒有 cucumber.js 等設定檔)。三層都沒有 → exit 1、印「找不到 cucumber 設定」。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析;`--root <dir>` 明講的話優先):
 *   npx tsx scripts/check-dry-run.ts                          # tag 來自 gates.config.json 的 dryRun.tags,沒有就交給 cucumber 設定檔
 *   npx tsx scripts/check-dry-run.ts --tags 'not @manual'     # 明講 tag 表達式(package.json 的 accept:dry 就是這樣呼叫)
 *   npx tsx scripts/check-dry-run.ts --root <dir> --cwd <cucumber 執行目錄>
 *   npx tsx scripts/check-dry-run.ts -- --name 'Scenario X'   # `--` 之後的參數原樣附給 cucumber-js(兩段都附)
 *
 * gates.config.json:
 *   { "dryRun": { "tags": "not @manual and not @todo" } }     # 驗收 job 用的那一條,填這裡就不用跟 package.json 對兩份
 *
 * 退出碼:0 段 A 摘要行乾淨且場景數 ≥ 1、段 B 0 ambiguous;1 任一桶非零、0 個場景、找不到摘要行、
 * cucumber 起不來、cucumber 自己退出碼非 0、找不到 cucumber 設定、設定檔壞掉。
 *
 * gate 標記:`gate=dry-run result=PASS|FAIL scanned=<段 A 場景數>`(0 目標與執行失敗都是 scanned=0)。
 *
 * 反向驗證(坑 23,來源 AI_KM:**守門提案接進 CI 前要先讓它紅一次**,跟「先故意改壞設定檔」
 * 是同一條,只是改壞的是輸入):
 *   (a) 挑一句已經有定義的 Cucumber Expression,整行原樣複製貼進另一個 *.steps.ts →
 *       跑這支腳本 → 應該紅,摘要行出現 `ambiguous`,`Failures:` 列出兩個定義的檔案:行號。
 *       同一份 fixture 直接跑 `npx cucumber-js --dry-run --strict` → exit 0(這就是為什麼
 *       需要這支腳本)。
 *   (b) 刪掉剛貼的那個定義 → 重跑 → 應該綠。
 *   (c) 在某個 feature 檔加一句沒有任何定義的步驟 → 應該紅,摘要行出現 `undefined`。
 *   (d) `--tags '@這個tag不存在'` → 應該紅,印「掃到 0 個場景」。
 *   (e) 把 (c) 那句沒定義的步驟放進一個 `@todo` 場景、`--tags 'not @todo'` → 應該綠(設計上的
 *       todo 不算);把 (a) 的撞名句子放進同一個 `@todo` 場景、同樣的 tags → 應該紅(段 B 抓到)。
 *   `check-dry-run.test.ts` 把 (a)–(e) 都做成自動測試,對一個 fixture repo 跑真的 cucumber。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import {
  DEFAULT_SKIP_DIRS,
  ROOT as GIT_ROOT,
  loadGatesConfig,
  lookupConfig,
  requireConfigType,
  requireRootDir,
} from './_root.js';

/** 所有掃描器共用的那句話。0 個目標的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'dry-run';

/** dry-run 不執行 step,大型 repo(八百多個 step)也只要幾秒;這個逾時是防卡死,不是效能預算。 */
const DRY_RUN_TIMEOUT_MS = 120_000;

/** 摘要行裡看到這幾桶任一個 ≥ 1 就紅。dry-run 下 cucumber 會回報 undefined 與 ambiguous;
 *  failed 理論上不會出現(沒執行 step),列進來是防禦——出現了一樣不該綠。 */
const BAD_BUCKETS = ['undefined', 'ambiguous', 'failed'] as const;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
requireRootDir(ROOT, ROOT_EXPLICIT, GATE_NAME);

/** `--` 之後的參數原樣附給 cucumber-js。 */
function passthroughArgs(): string[] {
  const i = process.argv.indexOf('--');
  return i >= 0 ? process.argv.slice(i + 1) : [];
}

function configError(msg: string): never {
  console.error(`✗ ${msg}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

/** 委派給 `_root.ts` 的 `lookupConfig`(S14,PITFALLS P-73):`--root` 明講時不退回這支
 *  腳本自己所在的目錄。gates.config.json 對這支腳本是選填(只讀 `cucumberCwd`),找不到
 *  就走自動偵測,不理會 hardErrorMessage。 */
function findConfigFile(name: string): string | undefined {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return result.path;
}

// ---- cucumber 執行目錄(cwd)三層決定 ----

const CUCUMBER_CONFIG_FILES = ['cucumber.js', 'cucumber.cjs', 'cucumber.mjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
/** S10:共用略過清單 + `archive`(模板慣例的封存目錄,不在通用清單裡)。 */
const CWD_SCAN_SKIP = new Set([...DEFAULT_SKIP_DIRS, 'archive']);

function hasCucumberConfig(dir: string): boolean {
  return CUCUMBER_CONFIG_FILES.some((f) => existsSync(join(dir, f)));
}

function autodetectCucumberCwd(): string | undefined {
  if (hasCucumberConfig(ROOT)) return ROOT;
  let entries: string[];
  try {
    entries = readdirSync(ROOT);
  } catch {
    return undefined;
  }
  const dirs = entries
    .filter((e) => !CWD_SCAN_SKIP.has(e))
    .filter((e) => {
      try {
        return statSync(join(ROOT, e)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
  for (const d of dirs) {
    const full = join(ROOT, d);
    if (hasCucumberConfig(full)) return full;
  }
  return undefined;
}

interface GatesConfig { cucumberCwd?: string; tags?: string }

/** 讀一次 gates.config.json(選填):`cucumberCwd` 與 `dryRun.tags`。解析錯誤、不認識的頂層鍵、
 *  型別錯都在這裡大聲失敗(S9),不是未捕捉的堆疊。 */
function loadConfig(): GatesConfig {
  const cfgPath = findConfigFile('gates.config.json');
  const cfg = loadGatesConfig(cfgPath, GATE_NAME);
  const out: GatesConfig = {};
  if (cfg?.cucumberCwd !== undefined) {
    requireConfigType(cfg.cucumberCwd, 'cucumberCwd', 'string', GATE_NAME);
    out.cucumberCwd = cfg.cucumberCwd as string;
  }
  if (cfg?.dryRun !== undefined) {
    requireConfigType(cfg.dryRun, 'dryRun', 'object', GATE_NAME);
    const tags = (cfg.dryRun as { tags?: unknown }).tags;
    if (tags !== undefined) {
      requireConfigType(tags, 'dryRun.tags', 'string', GATE_NAME);
      if ((tags as string).trim() === '') configError('"dryRun.tags" 是空字串(要不帶 tag 就刪掉這個欄位)');
      out.tags = tags as string;
    }
  }
  return out;
}

const CONFIG = loadConfig();

function resolveCucumberCwd(): string {
  const cwdFlag = argValue('--cwd');
  if (cwdFlag) {
    const resolved = resolve(ROOT, cwdFlag);
    if (!existsSync(resolved)) configError(`--cwd 指定的目錄不存在:${resolved}`);
    return resolved;
  }
  const cucumberCwd = CONFIG.cucumberCwd;
  if (cucumberCwd !== undefined) {
    const resolved = resolve(ROOT, cucumberCwd);
    // 設定了但指錯路徑,不能被自動偵測靜默救回(CHANGELOG 1.3.2 (A))。
    if (!existsSync(resolved)) configError(`"cucumberCwd" 指定的目錄不存在:${resolved}`);
    return resolved;
  }
  const detected = autodetectCucumberCwd();
  if (detected) return detected;
  configError(
    `找不到 cucumber 設定(cucumber.js|.cjs|.mjs|.json|.yaml|.yml;找過 ${ROOT} 與它的直接子目錄),` +
      '用 --cwd 或 gates.config.json 的 "cucumberCwd" 指定。',
  );
}

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.NODE_OPTIONS = '--import=tsx';
  return env;
}

// ---- 摘要行解析 ----

export interface SummaryLine {
  total: number;
  /** 括號裡每一桶的數字,例如 { ambiguous: 1, skipped: 3 }。 */
  buckets: Record<string, number>;
}

/** 從 cucumber `--format summary` 的輸出裡抓 `N scenarios (...)` 或 `N steps (...)`。
 *  括號裡是 `<數字> <桶名>` 用逗號分隔;`0 scenarios` 這種沒括號的也要認得(cucumber 對 0
 *  個場景印的是 `0 scenarios` 加 `0 steps`,沒有括號)。 */
export function parseSummaryLine(output: string, noun: 'scenarios' | 'steps'): SummaryLine | undefined {
  const re = new RegExp(`(\\d+)\\s+${noun.replace(/s$/, '')}s?\\b\\s*(?:\\(([^)]*)\\))?`);
  const m = output.match(re);
  if (!m) return undefined;
  const total = Number(m[1]);
  const buckets: Record<string, number> = {};
  const detail = m[2] ?? '';
  for (const part of detail.split(',')) {
    const pm = part.trim().match(/^(\d+)\s+([a-z]+)$/i);
    if (pm) buckets[pm[2]!.toLowerCase()] = Number(pm[1]);
  }
  return { total, buckets };
}

/** 摘要行裡壞掉的桶(數字 ≥ 1 的 undefined / ambiguous / failed),回傳 `桶名=數字` 清單。 */
export function badBuckets(summary: SummaryLine): string[] {
  const out: string[] = [];
  for (const b of BAD_BUCKETS) {
    const n = summary.buckets[b] ?? 0;
    if (n >= 1) out.push(`${b}=${n}`);
  }
  return out;
}

interface DryRunOutcome { scenarios: SummaryLine; steps: SummaryLine; status: number | null; output: string }

/** 跑一次 dry-run,把輸出原樣透傳,回傳解析後的兩條摘要行。起不來 / 逾時 / 找不到摘要行 → configError。 */
function runDryRun(cwd: string, label: string, args: string[]): DryRunOutcome {
  console.log(`dry-run: ${label}:npx ${args.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')}`);
  const r = spawnSync('npx', args, { cwd, encoding: 'utf8', env: baseEnv(), timeout: DRY_RUN_TIMEOUT_MS });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (output.trim()) console.log(output.trimEnd());
  const isTimeout = (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') || !!r.signal;
  if (isTimeout) configError(`cucumber dry-run 逾時(超過 ${DRY_RUN_TIMEOUT_MS}ms 未完成${r.signal ? `,收到訊號 ${r.signal}` : ''})`);
  if (r.error) configError(`cucumber 執行失敗:${r.error.message}`);
  const scenarios = parseSummaryLine(output, 'scenarios');
  const steps = parseSummaryLine(output, 'steps');
  if (!scenarios || !steps) {
    // 找不到摘要行:多半是 cucumber 起不來(設定檔壞、模組載入失敗、Parse error 印在摘要之前就中止)。
    // 退出碼非 0 的話一起印——這個方向是信 cucumber 的。
    configError(
      `${label}:輸出裡找不到 "N scenarios (...)" / "N steps (...)" 摘要行` +
        `${r.status !== null && r.status !== 0 ? `(cucumber 退出碼 ${r.status})` : ''}`,
    );
  }
  return { scenarios, steps, status: r.status, output };
}

function main(): void {
  const cucumberCwd = resolveCucumberCwd();
  const cwdDisplay = relative(ROOT, cucumberCwd) || '.';
  const tagsFlag = argValue('--tags');
  const tags = tagsFlag ?? CONFIG.tags;
  const tagSource = tagsFlag !== undefined ? '--tags 旗標' : CONFIG.tags !== undefined ? 'gates.config.json 的 dryRun.tags' : '無(交給 cucumber 設定檔)';
  const extra = passthroughArgs();
  const base = ['cucumber-js', '--dry-run', '--format', 'summary'];

  console.log(`dry-run: cucumber cwd = ${cwdDisplay};tag 來源:${tagSource}${tags !== undefined ? `('${tags}')` : ''}`);

  // ---- 段 A:驗收集合(跟驗收 job 同一條 tag),undefined / ambiguous / failed 都紅 ----
  const argsA = [...base];
  if (tags !== undefined) argsA.push('--tags', tags);
  argsA.push(...extra);
  const a = runDryRun(cucumberCwd, '段 A(驗收集合)', argsA);

  if (a.scenarios.total === 0) {
    console.log(`\n✗ 段 A 掃到 0 個場景(cucumber cwd = ${cwdDisplay}${tags !== undefined ? `,--tags '${tags}'` : ''})。${SCANNER_BROKEN}`);
    console.log('  tag 表達式、cucumber 設定檔的 paths、或 feature 檔的位置,至少有一個讓 dry-run 什麼都沒檢查到(P-32)。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const failures: string[] = [];
  const badA = [...new Set([...badBuckets(a.steps), ...badBuckets(a.scenarios)])];
  if (badA.length) {
    failures.push(`段 A(驗收集合)摘要行不乾淨:${badA.join(', ')}(${a.scenarios.total} 個場景、${a.steps.total} 個 step)`);
    if (badA.some((b) => b.startsWith('undefined'))) {
      failures.push('  undefined:驗收集合裡有步驟句沒有任何定義——照 P-32 的清單修 tag / 定義;如果那是設計上的 todo,tag 運算式要跟驗收 job 一致(--tags 或 gates.config.json 的 dryRun.tags)。');
    }
  }
  if (a.status !== 0 && !badA.length) {
    // 摘要行乾淨但 cucumber 自己說壞(例如某個 feature 檔 Parse error)。這個方向信 cucumber。
    failures.push(`段 A:cucumber 退出碼 ${a.status ?? 'unknown'}(摘要行乾淨,但 cucumber 自己回報了錯誤,看上面的輸出)`);
  }

  // ---- 段 B:全集(不帶 --tags),只看 ambiguous ----
  let bNote = '';
  if (tags !== undefined) {
    const b = runDryRun(cucumberCwd, '段 B(全集,只看 ambiguous)', [...base, ...extra]);
    const amb = b.steps.buckets.ambiguous ?? b.scenarios.buckets.ambiguous ?? 0;
    if (amb >= 1) {
      failures.push(`段 B(全集)有 ${amb} 個 ambiguous step——撞名的定義跟 tag 無關,被 tag 排除的場景一旦排進來就炸(${b.scenarios.total} 個場景)`);
    }
    const und = b.steps.buckets.undefined ?? 0;
    bNote = `;段 B 全集 ${b.scenarios.total} 個場景,${amb} ambiguous${und ? `(${und} undefined 在驗收集合外,視為設計上的 todo,不算)` : ''}`;
  }

  if (failures.length) {
    console.log('\n✗ dry-run 守門紅:');
    for (const f of failures) console.log(`  ${f}`);
    console.log('  cucumber 對 dry-run 的這些狀態退出碼仍是 0(--strict 也是),所以這裡看的是摘要行,不是退出碼(P-86)。');
    if (failures.some((f) => f.includes('ambiguous'))) {
      console.log('  ambiguous:同一句話對到 ≥2 個定義——上面 Failures: 列出了撞在一起的檔案:行號;`npm run check:steps` 會列出全部重複定義(含還沒被 feature 用到的)。');
    }
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${a.scenarios.total}`);
    process.exit(1);
  }

  console.log(`\n✓ dry-run 摘要行乾淨:段 A ${a.scenarios.total} 個場景、${a.steps.total} 個 step,0 undefined、0 ambiguous${bNote}`);
  console.log(`gate=${GATE_NAME} result=PASS scanned=${a.scenarios.total}`);
  process.exit(0);
}

main();
