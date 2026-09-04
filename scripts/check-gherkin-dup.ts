// SOURCE: template v1.3.0 (ee4f611) — 勿手改;升版用 sync-gates.sh
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
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd):
 *   npx tsx scripts/check-gherkin-dup.ts               # 複製進 repo 後執行
 *   npx tsx <template>/scripts/check-gherkin-dup.ts    # 從模板路徑直接執行,cwd 需在目標 repo
 *
 * 退出碼:
 *   0  沒有本體逐字相同的場景
 *   1  有重複場景;或掃到 0 個 .feature 檔 / 0 個場景(這不是很乾淨,是掃描器壞了)
 *
 * 反向驗證(改完要還原,不要留下改動):
 *   (a) 挑一個既有場景(例如某功能 phase-1.feature 裡「單獨跑起來會怎樣」那個場景),
 *       把它的步驟本體整段複製,貼到同一個檔案下面,取一個新的 Scenario 名稱。
 *       重跑這支腳本 → 應該紅,列出那兩個場景的檔案:行號。
 *   (b) 刪掉剛貼的複製場景,還原檔案 → 重跑 → 應該綠。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './_root.js';

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (name.endsWith('.feature')) yield full;
  }
}

function collectFeatureFiles(): string[] {
  return [...walk(join(ROOT, 'features')), ...walk(join(ROOT, 'docs/integration'))];
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
    process.exit(1);
  }

  const scenarios: Scenario[] = [];
  for (const file of files) scenarios.push(...extractScenarios(file));

  if (scenarios.length === 0) {
    console.log('✗ 掃到 0 個場景(Scenario / Scenario Outline)。這不是很乾淨,是掃描器壞了。');
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

  const dupGroups = [...byBody.entries()].filter(([, list]) => list.length >= 2);
  if (dupGroups.length) {
    console.log(`\n✗ ${dupGroups.length} 組場景本體逐字相同:`);
    for (const [, list] of dupGroups) {
      console.log('  ---');
      for (const s of list) {
        const rel = toPosix(relative(ROOT, s.file));
        console.log(`  ${rel}:${s.line}  Scenario: ${s.name}`);
      }
    }
    process.exit(1);
  }

  console.log('✓ 無重複場景');
  process.exit(0);
}

main();
