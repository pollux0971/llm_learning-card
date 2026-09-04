// SOURCE: template v1.3.0 (ee4f611) — 勿手改;升版用 sync-gates.sh
// HOTFIX: 2026-09-04 exactOptionalPropertyTypes: true 之下 loadGatesConfig 回傳 undefined 過不了 tsc(TS2375);已回報模板
/**
 * Phase 涵蓋率檢查(P-32,見 docs/03-agile-workflow.md 合併檢查段落)。
 *
 * 背景:cucumber 的 tag 表達式打錯字(例如 `@phase-1` 打成 `@phase1`,或資料夾名稱
 * 跟 tag 對不上)不會讓任何測試變紅——它只是安靜地比對到 0 個場景,`npm run accept` 一樣
 * 全綠,因為根本沒有場景被跑到。這支腳本對每個 phase 檔用「它自己宣稱的 tag」跑一次
 * cucumber,分兩段檢查,抓的是兩種不同的病:
 *
 *   段一(預設,dry-run):不執行 step 的內容,只確認 tag 表達式比對到 ≥1 個場景、
 *   且每個 step 都能對上一個定義(cucumber 在 dry-run 下仍會回報 undefined)。
 *   抓的是「接線」問題——tag 打錯字、資料夾跟 tag 對不上、step 完全沒寫——
 *   而且不會跑到 step 裡有副作用的程式碼。
 *
 *   段二(`--run`,真跑):實際執行 step,要求輸出 `N scenarios (N passed)`
 *   且 N ≥ 1,輸出裡只要出現 failed/undefined/ambiguous 就算這個 phase 紅。
 *   抓的是「邏輯」問題——step 有定義但斷言失敗、同一句話比對到兩個 step
 *   定義(ambiguous)——這些 dry-run 不會執行到,只有真跑才看得到。
 *   真跑比較慢、有副作用,所以預設不開,要加 `--run` 才做。
 *
 * cucumber 執行目錄(cwd)三層決定(某些 repo 的 cucumber 設定不在 repo 根,
 * 而是某個 workspace package 底下,例如 `features/cucumber.js` +
 * `features/node_modules/.bin/cucumber-js`;這種情況下用 `cwd: ROOT` 跑
 * `npx cucumber-js` 會完全找不到設定,`N scenarios` 抓不到甚至卡住):
 *   (a) `--cwd <dir>` 旗標(相對 ROOT,或絕對路徑)
 *   (b) `scripts/gates.config.json` 的 `"cucumberCwd"`(相對 ROOT;沒有這份檔或沒填這個欄位就跳過)
 *   (c) 自動偵測:ROOT 底下有 cucumber.js|cucumber.cjs|cucumber.mjs|cucumber.json|cucumber.yaml|cucumber.yml
 *       → 用 ROOT;否則掃 ROOT 的直接子目錄(排除 node_modules、.git、dist、archive),
 *       取第一個含上述任一檔案的目錄
 *   三層都沒有 → exit 1,印「找不到 cucumber 設定,用 --cwd 或 scripts/gates.config.json 指定」。
 *   實際採用的 cwd 會印在輸出的第一行。
 *
 * feature 檔的掃描(找 phase 檔、讀第一行 tag)永遠以 ROOT 為準
 * (`features/<NN-name>/phase-N.feature`),跟 cucumber 執行目錄是兩件事:
 * 我們只用 `--tags` 表達式,不傳路徑給 cucumber,cucumber 自己的設定檔(paths)
 * 會決定去哪裡找 feature 檔,所以 cwd ≠ ROOT 時不需要換算 feature 路徑。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-phase-coverage.ts                    # 複製進 repo 後執行,全部 phase 檔(dry-run)
 *   npx tsx <template>/scripts/check-phase-coverage.ts         # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-phase-coverage.ts --only 04-scheduler
 *   npx tsx scripts/check-phase-coverage.ts --list         # 只列出會檢查哪些檔案,不執行
 *   npx tsx scripts/check-phase-coverage.ts --cwd features # 指定 cucumber 執行目錄(相對 ROOT)
 *   npx tsx scripts/check-phase-coverage.ts --run          # 額外加跑段二(真跑,見上)
 *
 * 退出碼:
 *   0  每個 phase 檔用自己的 tag 都至少比對到 1 個場景(有 --run 時,段二也要全部通過)
 *   1  任一 phase 檔比對到 0 個場景,或 tag 掛錯,或執行/解析失敗;
 *      或掃到 0 個 phase 檔(這不是很乾淨,是掃描器壞了);
 *      或找不到 cucumber 執行目錄(三層都沒指定/偵測到);
 *      或 --run 時任一 phase 檔輸出含 failed/undefined/ambiguous
 *
 * 反向驗證(改完要還原,不要留下改動):
 *   (a) 挑一個 phase 檔(例如 features/04-scheduler/phase-1.feature),把第一行的
 *       `@phase-1` 手動改成 `@phase-9`(製造 tag 與檔名對不上)。重跑這支腳本 →
 *       應該紅,列出 04-scheduler/phase-1 的 tag 對不上或比對到 0 個場景。
 *   (b) 改回 `@phase-1` → 重跑 → 應該綠。
 *   (c) 這個 worktree 的舊版根目錄本身就是資料:直接跑一次全部,應該看到每個既有
 *       phase 檔都 ≥1 個場景(沒有場景清單本身就是紅,不用手動改壞就看得到)。
 *   (d) cwd 偵測:在一個 cucumber 設定不在根目錄的 repo(例如根目錄沒有
 *       cucumber.js,但 `features/cucumber.js` 有)跑這支腳本,應該自動偵測到
 *       `features/` 當 cwd,印出來;把那個子目錄的設定檔也拿掉 → 應該 exit 1
 *       印「找不到 cucumber 設定」。
 *   (e) `--run`:對一個已知會失敗的 phase(例如故意讓某個 step 斷言錯誤)跑
 *       `--run` → 應該紅且印出 failed;拿掉 `--run` 只跑 dry-run → 應該綠
 *       (因為 dry-run 不執行斷言)。這就是兩段分開存在的理由。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative } from 'node:path';
import { ROOT } from './_root.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ONLY = arg('--only');
const LIST_ONLY = process.argv.includes('--list');
const RUN = process.argv.includes('--run');

interface PhaseFile { folder: string; name: string; phase: number; file: string; relFile: string }

function collectPhaseFiles(): PhaseFile[] {
  const featuresDir = join(ROOT, 'features');
  if (!existsSync(featuresDir)) return [];
  const out: PhaseFile[] = [];
  for (const entry of readdirSync(featuresDir)) {
    const folderMatch = entry.match(/^(\d{2})-(.+)$/);
    if (!folderMatch) continue; // 跳過 _template、steps 等非 NN-name 資料夾
    const folder = entry;
    const name = folderMatch[2]!;
    const folderPath = join(featuresDir, folder);
    if (!statSync(folderPath).isDirectory()) continue;
    for (const file of readdirSync(folderPath)) {
      const phaseMatch = file.match(/^phase-(\d+)\.feature$/);
      if (!phaseMatch) continue;
      out.push({
        folder,
        name,
        phase: Number(phaseMatch[1]),
        file: join(folderPath, file),
        relFile: `features/${folder}/${file}`,
      });
    }
  }
  return out.sort((a, b) => (a.folder === b.folder ? a.phase - b.phase : a.folder.localeCompare(b.folder)));
}

function firstNonEmptyLine(file: string): string {
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.find((l) => l.trim().length > 0) ?? '';
}

function hasTag(line: string, tag: string): boolean {
  const tags: string[] = line.match(/@[^\s]+/g) ?? [];
  return tags.includes(tag);
}

// ---- cucumber 執行目錄(cwd)三層決定 ----

const CUCUMBER_CONFIG_FILES = ['cucumber.js', 'cucumber.cjs', 'cucumber.mjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
const CWD_SCAN_SKIP = new Set(['node_modules', '.git', 'dist', 'archive']);

interface GatesConfig { cucumberCwd?: string }

function loadGatesConfig(): GatesConfig {
  const p = join(ROOT, 'scripts', 'gates.config.json');
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<GatesConfig>;
  return typeof raw.cucumberCwd === 'string' ? { cucumberCwd: raw.cucumberCwd } : {};
}

function hasCucumberConfig(dir: string): boolean {
  return CUCUMBER_CONFIG_FILES.some((f) => existsSync(join(dir, f)));
}

/** 掃 ROOT 的直接子目錄(排除 node_modules、.git、dist、archive),取第一個含 cucumber 設定的。 */
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

function resolveCucumberCwd(): string {
  const cwdFlag = arg('--cwd');
  if (cwdFlag) {
    const resolved = resolve(ROOT, cwdFlag);
    if (!existsSync(resolved)) {
      console.log(`✗ --cwd 指定的目錄不存在:${resolved}`);
      process.exit(1);
    }
    return resolved;
  }

  const config = loadGatesConfig();
  if (config.cucumberCwd) {
    const resolved = resolve(ROOT, config.cucumberCwd);
    if (!existsSync(resolved)) {
      console.log(`✗ scripts/gates.config.json 的 "cucumberCwd" 指定的目錄不存在:${resolved}`);
      process.exit(1);
    }
    return resolved;
  }

  const detected = autodetectCucumberCwd();
  if (detected) return detected;

  console.log(
    '✗ 找不到 cucumber 設定(cucumber.js|.cjs|.mjs|.json|.yaml|.yml),用 --cwd 或 scripts/gates.config.json 的 "cucumberCwd" 指定。',
  );
  process.exit(1);
}

// ---- 執行 cucumber ----

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.NODE_OPTIONS = '--import=tsx';
  return env;
}

function runDryRun(cwd: string, tagExpr: string): { scenarios: number; output: string } | { error: string; output: string } {
  const r = spawnSync('npx', ['cucumber-js', '--tags', tagExpr, '--dry-run', '--format', 'summary'], {
    cwd,
    encoding: 'utf8',
    env: baseEnv(),
    timeout: 60_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error) return { error: r.error.message, output };
  const m = output.match(/(\d+)\s+scenarios?\b/);
  if (!m) return { error: '輸出裡找不到 "N scenarios"', output };
  return { scenarios: Number(m[1]), output };
}

interface RunResult { scenarios: number; passed: number; bad: string[]; output: string }
type RunOutcome = RunResult | { error: string; output: string };

/** 真跑(段二):解析 "N scenarios (詳細)",詳細裡出現 failed/undefined/ambiguous 就記在 bad。 */
function runActual(cwd: string, tagExpr: string): RunOutcome {
  const r = spawnSync('npx', ['cucumber-js', '--tags', tagExpr, '--format', 'summary'], {
    cwd,
    encoding: 'utf8',
    env: baseEnv(),
    timeout: 120_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error) return { error: r.error.message, output };
  const m = output.match(/(\d+)\s+scenarios?\s*\(([^)]*)\)/);
  if (!m) return { error: '輸出裡找不到 "N scenarios (N passed)"', output };
  const scenarios = Number(m[1]);
  const detail = m[2] ?? '';
  const bad = ['failed', 'undefined', 'ambiguous'].filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(detail));
  const passedMatch = detail.match(/(\d+)\s+passed/);
  const passed = passedMatch ? Number(passedMatch[1]) : 0;
  return { scenarios, passed, bad, output };
}

function main(): void {
  let phaseFiles = collectPhaseFiles();
  if (ONLY) phaseFiles = phaseFiles.filter((p) => p.folder === ONLY);

  if (phaseFiles.length === 0) {
    console.log(
      ONLY
        ? `✗ 找不到 features/${ONLY}/phase-*.feature`
        : '✗ 掃到 0 個 phase 檔(features/<NN-name>/phase-*.feature)。這不是很乾淨,是掃描器壞了。',
    );
    process.exit(1);
  }

  if (LIST_ONLY) {
    for (const p of phaseFiles) console.log(`  ${p.relFile}  →  @${p.name} and @phase-${p.phase}`);
    process.exit(0);
  }

  const cucumberCwd = resolveCucumberCwd();
  const cwdDisplay = relative(ROOT, cucumberCwd) || '.';
  console.log(`phase-coverage: cucumber cwd = ${cwdDisplay}`);
  console.log(`phase-coverage: 段一(dry-run)檢查 ${phaseFiles.length} 個 phase 檔`);

  const failures: string[] = [];
  const tagOkFiles: PhaseFile[] = [];
  for (const p of phaseFiles) {
    const line = firstNonEmptyLine(p.file);
    const nameTag = `@${p.name}`;
    const phaseTag = `@phase-${p.phase}`;
    if (!hasTag(line, nameTag) || !hasTag(line, phaseTag)) {
      failures.push(`${p.relFile}  第一行缺少 ${nameTag} 或 ${phaseTag}(實際:${line.trim() || '(空白)'})`);
      console.log(`  ✗ ${p.relFile}  tag 掛錯`);
      continue;
    }
    const tagExpr = `${nameTag} and ${phaseTag}`;
    const result = runDryRun(cucumberCwd, tagExpr);
    if ('error' in result) {
      failures.push(`${p.relFile}  執行/解析失敗:${result.error}`);
      console.log(`  ✗ ${p.relFile}  執行/解析失敗:${result.error}`);
      continue;
    }
    if (result.scenarios < 1) {
      failures.push(`${p.relFile}  tag "${tagExpr}" 比對到 0 個場景`);
      console.log(`  ✗ ${p.relFile}  0 個場景(tag "${tagExpr}")`);
      continue;
    }
    console.log(`  ✓ ${p.relFile}  ${result.scenarios} 個場景`);
    tagOkFiles.push(p);
  }

  if (failures.length) {
    console.log(`\n✗ 段一(dry-run):${failures.length} 個 phase 檔沒有涵蓋率:`);
    for (const f of failures) console.log(`  ${f}`);
  } else {
    console.log('\n✓ 段一(dry-run):全部 phase 檔至少涵蓋 1 個場景');
  }

  if (!RUN) {
    process.exit(failures.length ? 1 : 0);
  }

  // ---- 段二:--run(真跑) ----
  console.log(
    `\nphase-coverage: 段二(--run,真跑)檢查 ${tagOkFiles.length} 個 phase 檔(要求 "N scenarios (N passed)",排除 failed/undefined/ambiguous)`,
  );

  const runFailures: string[] = [];
  for (const p of tagOkFiles) {
    const tagExpr = `@${p.name} and @phase-${p.phase}`;
    const result = runActual(cucumberCwd, tagExpr);
    if ('error' in result) {
      runFailures.push(`${p.relFile}  執行/解析失敗:${result.error}`);
      console.log(`  ✗ ${p.relFile}  執行/解析失敗:${result.error}`);
      continue;
    }
    if (result.scenarios < 1 || result.bad.length > 0 || result.passed < 1) {
      const badDesc = result.bad.length ? result.bad.join('/') : '沒有任何 passed';
      runFailures.push(`${p.relFile}  真跑失敗(${badDesc})`);
      console.log(`  ✗ ${p.relFile}  真跑失敗(${badDesc})`);
      continue;
    }
    console.log(`  ✓ ${p.relFile}  ${result.scenarios} 個場景(${result.passed} passed)`);
  }

  if (runFailures.length) {
    console.log(`\n✗ 段二(--run):${runFailures.length} 個 phase 檔真跑失敗:`);
    for (const f of runFailures) console.log(`  ${f}`);
  } else {
    console.log('\n✓ 段二(--run):全部 phase 檔真跑通過');
  }

  process.exit(failures.length || runFailures.length ? 1 : 0);
}

main();
