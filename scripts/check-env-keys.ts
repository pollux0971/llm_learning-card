/**
 * `.env` 與 `.env.example` 鍵集合守門(工單 2026-09-12,`.env-keys-gate`)。
 *
 * 事故:`.env.example` 列 10 個鍵,`.env` 只有 7 個,少的正好是
 * `LLM_CLOUD_PROVIDER` / `LLM_CLOUD_MODEL`。`--live` 這條路完全依賴這兩個鍵——
 * 沒有它們,`resolveProviderName()` 回空字串、`isCloudProvider()` false、
 * `probeOnline()` 直接 return false,而錯誤訊息說的是「live golden run 需要
 * 雲端,現在連不上」,把設定問題講成網路問題(實測網路是通的)。
 * `12-prompt-quality/phase-2` 因此卡了 8 天,沒有任何守門發現 `.env` 跟
 * `.env.example` 不同步——因為 `.env` 是版控外的東西(SKILL.md §4b),`git status`
 * 一向乾淨,`check:gates` 這類守門也不會去比對它。
 *
 * ⚠️ 只比鍵,永遠不讀、不印、不比對值——那裡面是金鑰。`extractKeys()` 的正規式
 * 只擷取 `=` 前面的名字,`=` 後面的內容(可能是金鑰本體)從掃描的當下就被丟棄,
 * 不會被指派進任何變數、不會出現在任何輸出。
 *
 * 三種結果:
 *   - `.env.example` 有、`.env` 沒有的鍵 → 紅,列出缺哪幾個。
 *   - `.env` 有、`.env.example` 沒有的鍵 → 紅(反向漂移:有人在 `.env` 加了新設定
 *     卻沒有記回 `.env.example`,下一台機器 / 下一次乾淨簽出就會少那一個),
 *     訊息跟上面那條分開講,不要混在一起。
 *   - `.env` 不存在(乾淨簽出、CI 常見狀況——測試已經不依賴它,見 `env-probe`)
 *     → 不紅,印一行「沒有 .env,跳過」。`scanned` 用 `.env.example` 的鍵數,
 *     不是 0——`scanned=0` 在這套範式裡的既有語意是「掃描器壞了」(見其餘
 *     `check-*.ts` 的 `SCANNER_BROKEN`),這裡是合法狀態,兩種紅燈原因不共用
 *     同一個信號。這一條有測試守著(見 check-env-keys.test.ts),避免它退化成
 *     「在 CI 永遠跳過,等於沒接」。
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析;`--root <dir>` 明講的話
 * 優先,測試/對照用):
 *   npx tsx scripts/check-env-keys.ts
 *   npx tsx scripts/check-env-keys.ts --root <dir>
 *
 * 退出碼:0 鍵集合一致,或 `.env` 不存在(跳過);1 任一邊多了鍵,或 `.env.example`
 * 本身不存在(它是版控內的東西,不存在就是掃描器/簽出壞了)。
 * gate 標記:`gate=env-keys result=PASS|FAIL scanned=<檢查過的鍵數>`
 *
 * 反向驗證(工單原文,check-env-keys.test.ts 做成自動測試):
 *   (a) 暫時從 `.env` 拿掉一個鍵 → 紅且指名那個鍵;還原 → 綠。
 *   (b) 暫時往 `.env` 加一個 `.env.example` 沒有的鍵 → 紅且說明是反向漂移;還原 → 綠。
 *   (c) 把 `.env` 整個移走 → 不紅,印跳過那行;還原。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT as GIT_ROOT, requireRootDir } from './_root.js';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'env-keys';

/** 所有掃描器共用的那句話。0 個目標的紅,方向永遠是「掃描器壞了」。 */
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * 從檔案內容取出鍵名的集合。⚠️ 只回傳鍵名——`=` 後面那一段(可能含金鑰)
 * 從來沒有被擷取進任何 capture group 以外的地方,呼叫端拿到的只有 `Set<string>`。
 * 跳過空行與 `#` 開頭的註解行;鍵名規則跟 Node 內建 `process.loadEnvFile` 一致:
 * `[A-Za-z_][A-Za-z0-9_]*` 後面接 `=`(允許前後空白)。
 */
export function extractKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = KEY_RE.exec(line);
    if (m) keys.add(m[1]!);
  }
  return keys;
}

export interface KeyDiff {
  /** `.env.example` 有、`.env` 沒有的鍵,已排序。 */
  missing: string[];
  /** `.env` 有、`.env.example` 沒有的鍵(反向漂移),已排序。 */
  extra: string[];
}

/** 純函式,只認鍵名的集合,不知道也不需要知道值——所以這個函式簽章本身
 *  就無法被誤用來洩漏值。 */
export function diffKeys(exampleKeys: Set<string>, envKeys: Set<string>): KeyDiff {
  const missing = [...exampleKeys].filter((k) => !envKeys.has(k)).sort();
  const extra = [...envKeys].filter((k) => !exampleKeys.has(k)).sort();
  return { missing, extra };
}

/** 讀一個已知存在的檔案取鍵名;讀檔失敗(例如那個路徑其實是個目錄,`EISDIR`)
 *  印一句包了前後文的訊息並印 gate 標記、exit 1——不讓 fs 的引擎話原樣噴出來
 *  (那句話不會提到是哪個檔案、也不會提到這是這支守門在讀)。 */
function readKeysOrFail(path: string, label: string): Set<string> {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`✗ 讀不到 ${label}:${path}(${(e as Error).message})`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }
  return extractKeys(content);
}

function main(): void {
  const ROOT_EXPLICIT = argValue('--root') !== undefined;
  const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
  requireRootDir(ROOT, ROOT_EXPLICIT, GATE_NAME);

  const examplePath = join(ROOT, '.env.example');
  const envPath = join(ROOT, '.env');

  if (!existsSync(examplePath)) {
    console.error(`✗ 找不到 ${examplePath}(它是版控內的東西,不該不存在)`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const exampleKeys = readKeysOrFail(examplePath, '.env.example');

  if (exampleKeys.size === 0) {
    console.error(`✗ ${examplePath} 一個鍵都沒有。${SCANNER_BROKEN}——這份檔案本來就該列出所有需要的環境變數。`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  if (!existsSync(envPath)) {
    console.log(`.env: 不存在(乾淨簽出/CI 常見),跳過鍵集合比對`);
    console.log(`gate=${GATE_NAME} result=PASS scanned=${exampleKeys.size}`);
    process.exit(0);
  }

  const envKeys = readKeysOrFail(envPath, '.env');
  const { missing, extra } = diffKeys(exampleKeys, envKeys);
  const scanned = new Set([...exampleKeys, ...envKeys]).size;

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ .env 與 .env.example 的鍵集合一致(${scanned} 個鍵)`);
    console.log(`gate=${GATE_NAME} result=PASS scanned=${scanned}`);
    process.exit(0);
  }

  if (missing.length > 0) {
    console.log(`\n✗ .env 缺少 ${missing.length} 個 .env.example 有的鍵:`);
    for (const k of missing) console.log(`  ${k}`);
    console.log(
      '  這幾個鍵沒設,依賴它們的功能可能安靜地退化(空字串、預設值),' +
        '而錯誤訊息通常不會提到「設定沒填」,容易被誤判成別的原因(2026-09-12 的事故)。',
    );
  }

  if (extra.length > 0) {
    console.log(`\n✗ .env 多出 ${extra.length} 個 .env.example 沒有的鍵(反向漂移):`);
    for (const k of extra) console.log(`  ${k}`);
    console.log(
      '  有人在 .env 加了新設定,但忘了同步進 .env.example——下一台機器/下一次乾淨簽出' +
        '不會知道要設這個鍵。把鍵名(不含真實值)補進 .env.example。',
    );
  }

  console.log(`\ngate=${GATE_NAME} result=FAIL scanned=${scanned}`);
  process.exit(1);
}

const isDirectRun = process.argv[1]?.endsWith('check-env-keys.ts') ?? false;
if (isDirectRun) main();
