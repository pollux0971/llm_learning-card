// SOURCE: template v1.4.1 (ff7f64b) sha256=c46a93f09e7b65d10ae5a587c96f4a021ebabcaf441ec7a3afd22eef3b0bb30b — 勿手改;升版用 sync-gates.sh
/**
 * 單一入口:把「必跑鏈」(gates.config.json 的 `chain`)依序跑過一次。
 *
 * 動機:每個守門(boundaries / standalone / doc-links / gherkin-dup / phase-coverage /
 * step-dup,加上 consumer 自己的 test / typecheck / accept 等)各自有各自的 npm script,
 * 沒有人規定「合併前到底要跑哪幾個」——這支腳本把答案寫進設定檔,merge 前一個指令跑完
 * 整條鏈,不必記口訣。
 *
 * **不寫死鏈的內容**,讀 `gates.config.json` 的 `chain`(陣列,元素是 package.json
 * `scripts` 底下的名字,依序執行):
 *
 *   { "chain": ["typecheck", "test", "boundaries", "standalone"] }
 *
 * 這份鍵不存在(或存在但是空陣列)→ exit 1 並印出範例——跟其餘守門一樣,
 * 「讀到 0 個目標」不是「沒事可做」,是設定沒填。
 *
 * 執行方式:對 `chain` 裡每個名字,先確認它真的是 package.json `scripts` 底下的一個鍵
 * (不存在 → 印 `✗ <name> 不是 npm script(P-55)`,不嘗試執行,直接算失敗),存在才
 * `npm run <name>`(cwd 是 consumer 根,子行程的 stdout/stderr 直接透傳到終端機,
 * 不吃掉——這條鏈裡常常有跑很久的 test/mutate,終端機前的人需要看到即時輸出)。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd;
 * `--root <dir>` 明講的話優先,跟 check-boundaries.ts 同一套規則,方便測試對照):
 *   npx tsx scripts/check-all.ts                  # 依序跑完整條鏈,沿路都跑(預設)
 *   npx tsx scripts/check-all.ts --fail-fast       # 遇到第一個失敗就停,後面的不跑
 *   npx tsx scripts/check-all.ts --markdown        # 額外印一段 fenced code block,方便貼進合併訊息
 *   npx tsx scripts/check-all.ts --root <dir>      # 明講根目錄(測試/對照用)
 *
 * 退出碼:0 全部通過;1 任一項失敗(含「不是 npm script」),或 `chain` 沒讀到任何項目。
 *
 * `scanned` 就是 `chain` 的長度,不管 `--fail-fast` 有沒有讓後面的項目沒真的跑——
 * 這個數字回答的是「這條鏈設定了幾個目標」,不是「這次真的執行了幾個」。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT as GIT_ROOT, loadGatesConfig, lookupConfig, readConfigJson, requireConfigType } from './_root.js';

/** 所有掃描器共用的那句話。0 個目標的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'all';

/** 印一則設定錯誤、印 gate 標記(0 目標)、exit 1(S14 的 hardErrorMessage 用)。 */
function configErrorAll(msg: string): never {
  console.error(`✗ ${msg}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
const MARKDOWN = process.argv.includes('--markdown');
const FAIL_FAST = process.argv.includes('--fail-fast');

/**
 * `gates.config.json` 的搜尋——委派給 `_root.ts` 的 `lookupConfig`(S14,來源 AI_KM
 * 2026-09-05,PITFALLS P-73):`--root` 明講時不退回這支腳本自己所在的目錄(那通常是
 * 模板自己的佔位設定)。這份設定對 check-all.ts 是必要的(沒有 `chain` 就不知道要跑
 * 什麼),找不到時把 `hardErrorMessage`(如果有)當成找不到的訊息本身用。
 */
function findConfigFile(name: string): { path: string | undefined; hardErrorMessage: string | undefined; triedPaths: string[] } {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return { path: result.path, hardErrorMessage: result.hardErrorMessage, triedPaths: result.triedPaths };
}

interface PackageJson {
  scripts?: Record<string, string>;
}

const CHAIN_EXAMPLE = `{
  "chain": ["typecheck", "test", "boundaries", "standalone"]
}`;

function loadChain(): string[] {
  const found = findConfigFile('gates.config.json');
  if (found.hardErrorMessage) configErrorAll(found.hardErrorMessage);
  const p = found.path;
  if (!p) {
    console.error(`✗ 設定檔未找到於 ${found.triedPaths.join('、')}`);
    console.error('check-all 需要 gates.config.json 的 "chain"(要依序跑哪幾個 npm script)才知道跑什麼。範例:\n');
    console.error(CHAIN_EXAMPLE);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  // 解析錯誤(壞掉的 JSON)、不認識的頂層鍵(打錯字)都在這裡大聲失敗(S9),不會是
  // 未捕捉的堆疊,也不會悄悄套用預設值。
  const raw = (loadGatesConfig(p, GATE_NAME) ?? {}) as { chain?: unknown };
  // "chain" 有填但型別不對(例如寫成字串而不是陣列)→ 型別錯,跟「根本沒填/填空陣列」
  // (下面「尚未設定」那條路)是兩種不同的病,訊息要分開。
  if (raw.chain !== undefined) requireConfigType(raw.chain, 'chain', 'array', GATE_NAME);
  if (!Array.isArray(raw.chain) || raw.chain.length === 0) {
    console.error(`✗ ${p} 沒有 "chain"(或是空陣列)`);
    console.error('check-all 需要在 gates.config.json 加一個非空的 "chain" 陣列,元素是 package.json scripts 底下的名字。範例:\n');
    console.error(CHAIN_EXAMPLE);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  for (const name of raw.chain) {
    if (typeof name !== 'string' || !name) {
      console.error(`✗ ${p} 的 "chain" 每一項都要是非空字串,實際:${JSON.stringify(raw.chain)}`);
      console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
      process.exit(1);
    }
  }
  return raw.chain as string[];
}

function loadPackageScripts(): Record<string, string> {
  const p = join(ROOT, 'package.json');
  if (!existsSync(p)) {
    console.error(`✗ 找不到 ${p}`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  // package.json 不是 gates.config.json,沒有「已知頂層鍵」這個概念(name、scripts、
  // devDependencies……),只需要壞掉時大聲失敗(readConfigJson),不做頂層鍵檢查
  // (那是 loadGatesConfig 專門為 gates.config.json 做的事)。
  const raw = readConfigJson(p, GATE_NAME) as PackageJson;
  return raw.scripts ?? {};
}

interface ChainResult {
  name: string;
  ok: boolean;
  wired: boolean;
  exitCode: number | null;
  ran: boolean;
}

function main(): void {
  const chain = loadChain();
  const scripts = loadPackageScripts();

  console.log(`check-all: gates.config.json 的 chain 有 ${chain.length} 個項目`);

  const results: ChainResult[] = [];
  let stop = false;

  for (const name of chain) {
    if (stop) {
      // --fail-fast 命中之後,剩下的項目一律不跑,但仍計進 scanned(這條鏈本來就設定了這麼多)。
      console.log(`⏭  ${name}  (--fail-fast,未執行)`);
      results.push({ name, ok: false, wired: true, exitCode: null, ran: false });
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
      console.log(`✗ ${name} 不是 npm script(P-55)`);
      results.push({ name, ok: false, wired: false, exitCode: null, ran: false });
      if (FAIL_FAST) stop = true;
      continue;
    }
    const r = spawnSync('npm', ['run', name], { cwd: ROOT, stdio: 'inherit' });
    const exitCode = r.status;
    const ok = exitCode === 0;
    if (ok) {
      console.log(`✓ ${name}`);
    } else {
      console.log(`✗ ${name} (exit ${exitCode ?? r.signal ?? 'unknown'})`);
    }
    results.push({ name, ok, wired: true, exitCode: exitCode ?? null, ran: true });
    if (!ok && FAIL_FAST) stop = true;
  }

  const failed = results.filter((r) => !r.ok);
  const scanned = results.length;

  console.log(failed.length ? `\n${failed.length} 個失敗` : '\n全部通過');
  const marker = `gate=${GATE_NAME} result=${failed.length ? 'FAIL' : 'PASS'} scanned=${scanned}`;
  console.log(marker);

  if (MARKDOWN) {
    const lines: string[] = [];
    for (const r of results) {
      if (!r.ran && r.wired) {
        lines.push(`⏭ ${r.name} (--fail-fast,未執行)`);
      } else if (!r.wired) {
        lines.push(`✗ ${r.name} 不是 npm script(P-55)`);
      } else if (r.ok) {
        lines.push(`✓ ${r.name}`);
      } else {
        lines.push(`✗ ${r.name} (exit ${r.exitCode ?? 'unknown'})`);
      }
    }
    lines.push(marker);
    console.log('\n```');
    console.log(lines.join('\n'));
    console.log('```');
  }

  if (scanned === 0) {
    // 理論上 loadChain() 已經擋掉空陣列,這裡是防禦性的第二道:萬一以後 loadChain()
    // 被改壞、放行了空陣列,這裡仍然要擋住「0 個目標卻宣稱通過」。
    console.log(SCANNER_BROKEN);
    process.exit(1);
  }

  process.exit(failed.length ? 1 : 0);
}

main();
