// SOURCE: template v1.4.3 (629b609) sha256=5465419fc2f0c3409cb43620b116aca305b9e770ff2faaad61505ea57d880de6 — 勿手改;升版用 sync-gates.sh
/**
 * 場景重複檢查(見 docs/03-agile-workflow.md「契約先於平行、規格先於程式」)。
 *
 * 抓的是「複製貼上一個場景到另一個檔案(或同一個檔案),名稱改了但步驟本體逐字相同」。
 * 這種重複通常代表:應該用 Scenario Outline 收斂、應該共用一個 Background,或是規格被
 * 不小心複製而不是重新設計。不管名稱有沒有改,步驟本體相同就算。
 *
 * 規則:
 *   1. 掃 features/**\/*.feature 與 docs/integration/**\/*.feature(同一檔內、跨檔都算)
 *   2. 一個場景的「本體」= Scenario / Scenario Outline 名稱那一行之後,
 *      到下一個 Scenario / Scenario Outline / Examples 關鍵字之前的所有步驟行,
 *      每行去頭尾空白後,以換行接起來
 *   3. 本體逐字相同(不看場景名稱)的兩個以上場景 → 列出檔案:行號成對,退出 1
 *   4. **allowlist**(CHANGELOG 1.3.2 (2)):`gates.config.json` 的 `gherkinDup.allow` 可以
 *      列出刻意允許的重複組,格式 `{ scenario, onlyUnder?, reason }`。一個重複組要套用
 *      某條 allow 才不算紅,三個條件都要成立:(a) 組裡**每個**場景的名稱都等於 `scenario`
 *      (場景名不同就不算同一組刻意重複,即使步驟本體逐字相同);(b) 有給 `onlyUnder` 時,
 *      組裡每個場景所在的檔案路徑都要以它開頭(相對 ROOT,例如 `docs/integration/`);
 *      (c) `reason` 是非空字串。三個條件都成立 → 印 `○ 允許:<scenario>(<reason>)`,
 *      不計入失敗;`reason` 空或缺 → 這條 allow **無效**,命中時印警告、該組照常判紅
 *      (不能讓一條寫壞的 allow 悄悄放行一組真的重複)。範例:
 *      ```json
 *      { "gherkinDup": { "allow": [
 *        { "scenario": "Every standalone entry point still runs",
 *          "onlyUnder": "docs/integration/",
 *          "reason": "每個整合點各自重跑一次 standalone 回歸(ADR-024)" }
 *      ] } }
 *      ```
 *      找設定檔的順序見 `_root.ts` 的 `resolveConfig`:先找這支腳本自己所在的目錄,
 *      再找 `ROOT/scripts/`;這份檔不存在就沒有任何 allow 條目,所有重複都照常判紅。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-gherkin-dup.ts               # 複製進 repo 後執行
 *   npx tsx <template>/scripts/check-gherkin-dup.ts    # 從模板路徑直接執行,cwd 需在目標 repo
 *
 * 退出碼:
 *   0  沒有本體逐字相同的場景(allowlist 允許的重複組不算)
 *   1  有(未被 allowlist 允許的)重複場景;或掃到 0 個 .feature 檔 / 0 個場景
 *      (這不是很乾淨,是掃描器壞了)
 *
 * 反向驗證(改完要還原,不要留下改動):
 *   (a) 挑一個既有場景(例如某功能 phase-1.feature 裡「單獨跑起來會怎樣」那個場景),
 *       把它的步驟本體整段複製,貼到同一個檔案下面,取一個新的 Scenario 名稱。
 *       重跑這支腳本 → 應該紅,列出那兩個場景的檔案:行號。
 *   (b) 刪掉剛貼的複製場景,還原檔案 → 重跑 → 應該綠。
 *   (c) allowlist(在一個假 repo 裡做,不要動到這個 worktree 自己的資料):建兩個
 *       `docs/integration/*.feature`,各放一個 Scenario 名稱、步驟本體都逐字相同的場景
 *       (例如「Every standalone entry point still runs」)→ 重跑應該紅。在假 repo 的
 *       `scripts/gates.config.json` 加上面範例的 allow 條目 → 重跑應該綠,印
 *       `○ 允許:...`。把那條 allow 的 `reason` 清空(或整條刪掉再放回一條沒有 reason 的)
 *       → 重跑應該紅,且印「allow 條目無效」的警告。把其中一個 feature 檔搬到
 *       `features/` 底下(不再滿足 `onlyUnder: "docs/integration/"`)→ 重跑應該紅
 *       (onlyUnder 不符,allow 不套用)。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_SKIP_DIRS, ROOT, loadGatesConfig, requireConfigType, resolveConfig } from './_root.js';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'gherkin-dup';

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

// ---- allowlist(CHANGELOG 1.3.2 (2)) ----
//
// 有些重複是刻意的:每個整合點各自重跑一次同一份 standalone 回歸(ADR-024),場景名跟步驟
// 本體本來就該逐字相同,不是複製貼上的失誤。這些例外寫在 `gates.config.json` 的
// `gherkinDup.allow`,不是改這支腳本——程式(規則)跟設定(哪些重複被允許)分開,升級
// 這支腳本不會把專案填好的例外清單洗掉。

interface AllowEntry { scenario: string; onlyUnder?: string; reason: string }
interface InvalidAllowEntry { scenario: string; onlyUnder?: string }

/** 讀 `gherkinDup.allow`,分成「有效」(reason 非空)與「無效」(reason 空或缺)兩批——
 *  無效的條目不生效(該組照常判紅),但要在命中時印警告,不能悄悄忽略。
 *  找不到 `scenario` 欄位的條目整條忽略(連比對的依據都沒有,不算「無效」,只是壞掉的資料)。 */
function loadAllowEntries(): { valid: AllowEntry[]; invalid: InvalidAllowEntry[] } {
  const p = resolveConfig(import.meta.dirname, 'gates.config.json');
  // 解析錯誤、不認識的頂層鍵在這裡大聲失敗(S9)——舊版 `try { JSON.parse(...) } catch
  // { return { valid: [], invalid: [] } }` 會讓壞掉的 gates.config.json 悄悄變成
  // 「沒有任何 allow 條目」,gate 照樣能印 PASS 或 FAIL,但完全沒套用設定。
  const raw = loadGatesConfig(p, GATE_NAME);
  if (!raw) return { valid: [], invalid: [] };
  if (raw.gherkinDup !== undefined) requireConfigType(raw.gherkinDup, 'gherkinDup', 'object', GATE_NAME);
  const list = (raw as { gherkinDup?: { allow?: unknown } }).gherkinDup?.allow;
  if (!Array.isArray(list)) return { valid: [], invalid: [] };
  const valid: AllowEntry[] = [];
  const invalid: InvalidAllowEntry[] = [];
  for (const entryRaw of list as { scenario?: unknown; onlyUnder?: unknown; reason?: unknown }[]) {
    const scenario = typeof entryRaw.scenario === 'string' ? entryRaw.scenario : undefined;
    if (!scenario) continue;
    const onlyUnder = typeof entryRaw.onlyUnder === 'string' ? entryRaw.onlyUnder : undefined;
    const reason = typeof entryRaw.reason === 'string' ? entryRaw.reason.trim() : '';
    if (reason) {
      valid.push({ scenario, ...(onlyUnder !== undefined ? { onlyUnder } : {}), reason });
    } else {
      invalid.push({ scenario, ...(onlyUnder !== undefined ? { onlyUnder } : {}) });
    }
  }
  return { valid, invalid };
}

/** 一個重複組要不要套用某條 allow 條目:組裡**每個**場景的名稱都要等於 `entry.scenario`
 *  (不是「至少一個」——場景名不同,即使步驟本體逐字相同,也不算「同一個刻意重複的場景」);
 *  有給 `onlyUnder` 時,組裡每個場景所在的檔案路徑都要以它開頭。 */
function groupMatchesAllow(group: Scenario[], scenario: string, onlyUnder: string | undefined): boolean {
  if (!group.every((s) => s.name === scenario)) return false;
  if (onlyUnder) {
    return group.every((s) => toPosix(relative(ROOT, s.file)).startsWith(onlyUnder));
  }
  return true;
}

/** S10:跟其餘會走目錄樹的 gate 共用同一份略過清單(`_root.ts` 的 `DEFAULT_SKIP_DIRS`
 *  + `gates.config.json` 的 `skipDirs` 追加),不在這支腳本裡另外寫一份。 */
function resolveSkipDirsForGherkinDup(): Set<string> {
  const p = resolveConfig(import.meta.dirname, 'gates.config.json');
  const cfg = loadGatesConfig(p, GATE_NAME);
  if (cfg?.skipDirs !== undefined) requireConfigType(cfg.skipDirs, 'skipDirs', 'array', GATE_NAME);
  const extra = Array.isArray(cfg?.skipDirs) ? (cfg.skipDirs as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  return new Set([...DEFAULT_SKIP_DIRS, ...extra]);
}

function* walk(dir: string, skipDirs: Set<string>): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, skipDirs);
    else if (name.endsWith('.feature')) yield full;
  }
}

function collectFeatureFiles(): string[] {
  const skipDirs = resolveSkipDirsForGherkinDup();
  return [...walk(join(ROOT, 'features'), skipDirs), ...walk(join(ROOT, 'docs/integration'), skipDirs)];
}

interface Scenario { file: string; line: number; name: string; body: string }

const SCENARIO_START_RE = /^\s*(Scenario|Scenario Outline)\s*:\s*(.*)$/;
const SECTION_BREAK_RE = /^\s*(Scenario|Scenario Outline|Examples)\s*:/;

function extractScenarios(file: string): Scenario[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: Scenario[] = [];
  let current: { line: number; name: string; bodyLines: string[] } | undefined;

  const flush = () => {
    if (current) {
      out.push({ file, line: current.line, name: current.name, body: current.bodyLines.join('\n') });
      current = undefined;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const startMatch = line.match(SCENARIO_START_RE);
    if (startMatch) {
      flush();
      current = { line: i + 1, name: startMatch[2]!.trim(), bodyLines: [] };
      continue;
    }
    if (current) {
      const isBreak = SECTION_BREAK_RE.test(line);
      if (isBreak) {
        // 下一個 Scenario 已經在上面的分支處理;這裡只需要在遇到 Examples 時收尾。
        flush();
        continue;
      }
      const trimmed = line.trim();
      if (trimmed) current.bodyLines.push(trimmed);
    }
  }
  flush();
  return out;
}

function main(): void {
  const files = collectFeatureFiles();
  if (files.length === 0) {
    console.log('✗ 掃到 0 個 .feature 檔(features/**/*.feature 或 docs/integration/**/*.feature)。這不是很乾淨,是掃描器壞了。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const scenarios: Scenario[] = [];
  for (const file of files) scenarios.push(...extractScenarios(file));

  if (scenarios.length === 0) {
    console.log('✗ 掃到 0 個場景(Scenario / Scenario Outline)。這不是很乾淨,是掃描器壞了。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const byBody = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    if (!s.body) continue; // 空本體(例如純 Background 或格式異常)不比對,避免誤報
    const list = byBody.get(s.body) ?? [];
    list.push(s);
    byBody.set(s.body, list);
  }

  console.log(`gherkin-dup: 掃描 ${files.length} 個 .feature 檔,${scenarios.length} 個場景`);

  const { valid: allowValid, invalid: allowInvalid } = loadAllowEntries();
  const dupGroups = [...byBody.entries()].filter(([, list]) => list.length >= 2);

  const redGroups: [string, Scenario[]][] = [];
  const allowedNotices: string[] = [];
  const warnings: string[] = [];

  for (const entry of dupGroups) {
    const [, list] = entry;
    const matchedValid = allowValid.find((e) => groupMatchesAllow(list, e.scenario, e.onlyUnder));
    if (matchedValid) {
      allowedNotices.push(`○ 允許:${matchedValid.scenario}(${matchedValid.reason})`);
      continue;
    }
    const matchedInvalid = allowInvalid.find((e) => groupMatchesAllow(list, e.scenario, e.onlyUnder));
    if (matchedInvalid) {
      warnings.push(
        `⚠ allow 條目無效(reason 空或缺):"${matchedInvalid.scenario}"${matchedInvalid.onlyUnder ? ` (onlyUnder: ${matchedInvalid.onlyUnder})` : ''} 這條規則不生效,該組照常判紅`,
      );
    }
    redGroups.push(entry);
  }

  for (const w of warnings) console.log(w);
  for (const a of allowedNotices) console.log(a);

  if (redGroups.length) {
    console.log(`\n✗ ${redGroups.length} 組場景本體逐字相同:`);
    for (const [, list] of redGroups) {
      console.log('  ---');
      for (const s of list) {
        const rel = toPosix(relative(ROOT, s.file));
        console.log(`  ${rel}:${s.line}  Scenario: ${s.name}`);
      }
    }
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${scenarios.length}`);
    process.exit(1);
  }

  console.log(dupGroups.length ? `✓ 無重複場景(${dupGroups.length} 組經 allowlist 允許)` : '✓ 無重複場景');
  console.log(`gate=${GATE_NAME} result=PASS scanned=${scenarios.length}`);
  process.exit(0);
}

main();
