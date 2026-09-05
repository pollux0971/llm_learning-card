// SOURCE: template v1.4.3 (629b609) sha256=9132ac6a734e05f275024a132df8d87fd3610ccad52c3b470f9c5b172b49e97a — 勿手改;升版用 sync-gates.sh
/**
 * 已知缺陷登記表檢查(S8,來源 nightmare-assault)。
 *
 * 背景:cucumber 沒有嚴格意義的 xfail(「這個場景現在就是會紅,而且是已知的,不要讓它
 * 擋 merge,但也不要讓人忘記它還紅著」)。這個專案的慣例是:一個場景如果在釘一個已知
 * 缺陷,就掛 `@known-defect` tag,而且要登記進 `known-defects.json`——tag 跟登記表
 * 兩邊都要有,兩邊對不上就是這支 gate 要抓的東西:
 *   - 掛了 tag 但沒登記 → 有人加了 xfail 卻沒留下「為什麼」「什麼時候修」的紀錄
 *   - 登記了但場景不存在或沒掛 tag → 登記表在說謊(場景已經改名/刪掉/拿掉 tag 了,
 *     登記表沒跟著更新)
 *
 * `known-defects.json` 是一個陣列,每一筆:
 *   { "feature": "features/NN-x/phase-N.feature", "scenario": "<場景名稱,逐字>",
 *     "reason": "<缺陷的樣子>", "fix_in": "<NN-x>/phase-M" | "ADR-NNN" | "未定" | "TBD",
 *     "since": "YYYY-MM-DD", "hard_rule": true | false }
 * 底線開頭的鍵(例如 `_doc`)是 metadata,不算條目——跟 `check-standalone.ts` 的
 * manifest `_doc`慣例同一個道理,只是這裡容器是陣列不是物件,所以規則是「陣列裡
 * 有 `_doc` 鍵的物件項目」而不是「頂層有底線開頭的鍵」。模板出貨的空白版本就是
 * `[{ "_doc": "說明 schema……" }]`——語法上是非空陣列,但裡面 0 筆真正的登記。
 *
 * 核對方式(絕不相信外層的 tag 篩選——(a)):
 *   (a) 用 `--dry-run --tags @known-defect --format json` 在**子行程**裡跑一次 cucumber,
 *       列舉出所有標了 `@known-defect` 的場景(feature 路徑 + 場景名稱的 multiset);
 *       拿到結果後**自己再檢查每個場景的 tags 陣列真的有 `@known-defect`**,不是只信任
 *       `--tags` 篩選器回傳的就是對的(這支腳本存在的意義正是「確認 tag 跟登記表對得上」,
 *       如果連「篩選出來的真的有這個 tag」都不驗,等於什麼都沒驗)。
 *   (b) 標了 tag 的 multiset 要跟登記表的 multiset **完全相等**:
 *       多出來的(掛了 tag 沒登記)→ `✗ 帶 @known-defect 但沒登記`;
 *       多出來的(登記了但沒對到任何標了 tag 的場景)→ `✗ 登記了但場景不存在或沒帶 tag`。
 *   (c) **0 目標的例外**:如果登記表是空的(排除 `_doc` 項目後 0 筆)**而且**掃到 0 個
 *       標 `@known-defect` 的場景,這代表「這個專案現在根本沒有已知缺陷要釘」——
 *       跟其餘掃描器「0 目標 = 掃描器壞了」不同,這裡明講**這支 gate 現在用不到,
 *       可以先不要加進 `gates.config.json` 的 `chain`**,不是「掃描器壞了」;
 *       但仍然照 hard rule(見專案 CLAUDE.md 開頭「每個 gate 印 gate=<name>
 *       result=PASS|FAIL scanned=N,0 目標 exit 1」)回傳 exit 1、印 FAIL 標記——
 *       只是訊息方向不一樣,不要照抄「這不是很乾淨,是掃描器壞了」那句。
 *   (d) `fix_in` 一定要是字串欄位(可以是佔位值 `""` / `"未定"` / `"TBD"`);
 *       `hard_rule: true` 的登記,`fix_in` **不准**是這些佔位值——硬規則的違規不能靠
 *       一個「之後再修」的標記就合法化。
 *   (e) `fix_in` 不是佔位值時,必須能解析:`<NN-x>/phase-M` 要對到
 *       `features/<NN-x>/FEATURE.md` 真的有那個 phase 表格列(`_root.ts` 的
 *       `featurePhaseRowExists`);`ADR-NNN` 要對到 `docs/02-decision-map.md` 真的有
 *       那個 ADR 標題(`_root.ts` 的 `adrExists`)。
 *
 * cucumber 執行目錄(cwd)的三層決定,跟 `check-phase-coverage.ts` 同一套(這裡各自
 * 一份,不共用 helper——`sync-gates.sh` 把每支 check-*.ts 當獨立檔案複製):
 *   `--cwd` 旗標 > `gates.config.json` 的 `"cucumberCwd"` > 自動偵測(ROOT 或它的直接
 *   子目錄有沒有 cucumber.js 等設定檔)。
 *
 * **測試用的列舉替換**:cucumber 可能沒裝在測試用的臨時 repo 裡(dry-run 都不成立)。
 * 設 `KNOWN_DEFECTS_ENUMERATE_CMD` 環境變數指到一個指令(shell 字串),這支腳本就用
 * 它的 stdout 取代真的 `npx cucumber-js ...`——但格式**必須**跟 cucumber `--format json`
 * 的頂層格式一致(陣列,每個元素有 `uri`、`elements[].name`/`elements[].type`/
 * `elements[].tags[].name`),因為後續解析邏輯是同一套,不因為是不是被替換而不同。
 *
 * 用法:
 *   npx tsx scripts/check-known-defects.ts
 *   npx tsx scripts/check-known-defects.ts --root <dir> --cwd <cucumber 執行目錄>
 *
 * 退出碼:0 tag 與登記表完全對上(或兩邊都是空的例外——不,那個例外一樣 exit 1,
 * 只是訊息不同,見 (c));1 有任何一邊對不上、`fix_in` 違規、cucumber 執行/解析失敗。
 *
 * **接線(sync-gates.sh 的 `--check`)**:模板出貨的 `known-defects.json` 是空的
 * (見上面「0 筆真正的登記」那段),代表這支 gate 剛裝上時符合 (c) 的 0 目標例外——
 * 這種情況下**不必**把 `check:known-defects` 加進 `package.json` 的 `scripts` 或
 * `gates.config.json` 的 `chain`,可以在 `gates.config.json` 加:
 *   `"unwired": [{ "file": "check-known-defects.ts", "reason": "尚無 @known-defect 場景,見 (c)" }]`
 * 等真的有場景要掛 `@known-defect` 再接線、拿掉這條 allowlist。`check-doc-rot.ts`
 * 不適用這條——它出貨就有 3 條真的黑名單規則,不是 0 目標,應該照其餘六支掃描器一樣
 * 直接接線(加進 `chain` 或 `package.json` 的某個 script)。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  DEFAULT_SKIP_DIRS,
  ROOT as GIT_ROOT,
  adrExists,
  featurePhaseRowExists,
  loadGatesConfig,
  lookupConfig,
  readConfigJson,
  requireConfigType,
  requireRootDir,
} from './_root.js';

/** 這支腳本在 gate 機器可讀標記裡的名字。 */
const GATE_NAME = 'known-defects';

const KNOWN_DEFECT_TAG = '@known-defect';
const REGISTRY_FILENAME = 'known-defects.json';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROOT_EXPLICIT = argValue('--root') !== undefined;
const ROOT = resolve(argValue('--root') ?? GIT_ROOT);
requireRootDir(ROOT, ROOT_EXPLICIT, GATE_NAME);

function configError(msg: string): never {
  console.error(`✗ ${msg}`);
  console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
  process.exit(1);
}

/** 委派給 `_root.ts` 的 `lookupConfig`(S14,來源 AI_KM 2026-09-06,PITFALLS P-73):
 *  `--root` 明講時不退回這支腳本自己所在的目錄。每次呼叫印一行「<name>: 設定:...」。 */
function findConfigFile(name: string): { path: string | undefined; hardErrorMessage: string | undefined; triedPaths: string[] } {
  const result = lookupConfig(import.meta.dirname, name, { root: ROOT, rootExplicit: ROOT_EXPLICIT });
  console.log(`${name}: ${result.source}`);
  return { path: result.path, hardErrorMessage: result.hardErrorMessage, triedPaths: result.triedPaths };
}

// ---------------------------------------------------------------------------
// 登記表(known-defects.json)
// ---------------------------------------------------------------------------

export interface DefectEntry {
  feature: string;
  scenario: string;
  reason: string;
  fix_in: string;
  since: string;
  hard_rule: boolean;
}

/** `fix_in` 的三種佔位值(未定案):空字串、「未定」、"TBD"(不分大小寫)。 */
function isPlaceholderFixIn(v: string): boolean {
  const t = v.trim();
  return t === '' || t === '未定' || t.toLowerCase() === 'tbd';
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 讀 `known-defects.json`,驗證每一筆的形狀,`fix_in` 的規則 (d)(e)。
 *  陣列裡帶 `_doc` 鍵的項目是 metadata,跳過(不算條目,不驗證形狀)。 */
function loadRegistry(): { entries: DefectEntry[]; path: string } {
  const found = findConfigFile(REGISTRY_FILENAME);
  if (found.hardErrorMessage) configError(found.hardErrorMessage);
  const p = found.path;
  if (!p) {
    configError(
      `找不到 ${REGISTRY_FILENAME}(搜尋過:${found.triedPaths.join('、')})。` +
        '範例見 template/scripts/known-defects.json。',
    );
  }
  const raw = readConfigJson(p, GATE_NAME);
  if (!Array.isArray(raw)) configError(`${p} 必須是陣列(每一項是一筆已知缺陷登記,或帶 "_doc" 的說明項目)`);

  const entries: DefectEntry[] = [];
  raw.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      configError(`${p} 第 ${i + 1} 筆不是物件:${JSON.stringify(item)}`);
    }
    const obj = item as Record<string, unknown>;
    if ('_doc' in obj) return; // metadata 項目,跳過,不算條目

    for (const field of ['feature', 'scenario', 'reason', 'since'] as const) {
      requireConfigType(obj[field], `${REGISTRY_FILENAME}[${i}].${field}`, 'string', GATE_NAME);
      if (!nonEmptyString(obj[field])) configError(`${p} 第 ${i + 1} 筆的 "${field}" 不可為空字串`);
    }
    requireConfigType(obj.fix_in, `${REGISTRY_FILENAME}[${i}].fix_in`, 'string', GATE_NAME);
    requireConfigType(obj.hard_rule, `${REGISTRY_FILENAME}[${i}].hard_rule`, 'boolean', GATE_NAME);

    const fixIn = obj.fix_in as string;
    const hardRule = obj.hard_rule as boolean;
    const placeholder = isPlaceholderFixIn(fixIn);

    // (d) hard_rule 的登記不准用佔位值合法化。
    if (hardRule && placeholder) {
      configError(
        `${p} 第 ${i + 1} 筆 hard_rule=true,但 "fix_in" 是佔位值(${JSON.stringify(fixIn)})——` +
          '硬規則的違規不能靠一個「之後再修」的標記合法化,要嘛立刻修,要嘛給真的 phase/ADR 參照。',
      );
    }

    // (e) 不是佔位值就要能解析成真的 phase 或 ADR 參照。
    if (!placeholder) {
      const phaseMatch = /^(\d{2}-[^/]+)\/phase-(\d+)$/.exec(fixIn);
      const adrMatch = /^ADR-(\d+)$/.exec(fixIn);
      if (phaseMatch) {
        const [, folder, phaseNum] = phaseMatch;
        if (!featurePhaseRowExists(ROOT, folder!, phaseNum!)) {
          configError(`${p} 第 ${i + 1} 筆的 "fix_in" 參照不存在:${fixIn}(features/${folder}/FEATURE.md 沒有 phase-${phaseNum} 那一列)`);
        }
      } else if (adrMatch) {
        const [, adrId] = adrMatch;
        if (!adrExists(ROOT, adrId!)) {
          configError(`${p} 第 ${i + 1} 筆的 "fix_in" 參照不存在:${fixIn}(docs/02-decision-map.md 沒有 ADR-${adrId} 那個標題)`);
        }
      } else {
        configError(
          `${p} 第 ${i + 1} 筆的 "fix_in" 格式看不懂:${JSON.stringify(fixIn)}——` +
            '必須是 "<NN-x>/phase-M"、"ADR-NNN",或佔位值 "未定" / "TBD" / 空字串。',
        );
      }
    }

    entries.push({
      feature: obj.feature as string,
      scenario: obj.scenario as string,
      reason: obj.reason as string,
      fix_in: fixIn,
      since: obj.since as string,
      hard_rule: hardRule,
    });
  });
  return { entries, path: p };
}

// ---------------------------------------------------------------------------
// cucumber 執行目錄(cwd)三層決定——跟 check-phase-coverage.ts 同一套邏輯。
// ---------------------------------------------------------------------------

const CUCUMBER_CONFIG_FILES = ['cucumber.js', 'cucumber.cjs', 'cucumber.mjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
/** S10:共用略過清單(見 check-phase-coverage.ts 的同一段說明,這裡跟它同一個道理)+
 *  `archive`(模板慣例的封存目錄,不在通用清單裡)。 */
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

function resolveCucumberCwd(): string {
  const cwdFlag = argValue('--cwd');
  if (cwdFlag) {
    const resolved = resolve(ROOT, cwdFlag);
    if (!existsSync(resolved)) configError(`--cwd 指定的目錄不存在:${resolved}`);
    return resolved;
  }
  // gates.config.json 對這支腳本是選填設定(cucumberCwd),不理會 hardErrorMessage。
  const cfgPath = findConfigFile('gates.config.json').path;
  const cfg = loadGatesConfig(cfgPath, GATE_NAME);
  const cucumberCwd = cfg?.cucumberCwd;
  if (cucumberCwd !== undefined) {
    requireConfigType(cucumberCwd, 'cucumberCwd', 'string', GATE_NAME);
    const resolved = resolve(ROOT, cucumberCwd as string);
    if (!existsSync(resolved)) configError(`"cucumberCwd" 指定的目錄不存在:${resolved}`);
    return resolved;
  }
  const detected = autodetectCucumberCwd();
  if (detected) return detected;
  // 列舉被 KNOWN_DEFECTS_ENUMERATE_CMD 注入(測試用途)時,根本不會真的呼叫
  // cucumber-js,不需要真的 cucumber 設定——退回 ROOT,不要求一定要偵測到。
  if (process.env.KNOWN_DEFECTS_ENUMERATE_CMD) return ROOT;
  configError('找不到 cucumber 設定(cucumber.js|.cjs|.mjs|.json|.yaml|.yml),用 --cwd 或 gates.config.json 的 "cucumberCwd" 指定。');
}

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.NODE_OPTIONS = '--import=tsx';
  return env;
}

// ---------------------------------------------------------------------------
// 列舉標了 @known-defect 的場景。
// ---------------------------------------------------------------------------

export interface TaggedScenario {
  feature: string;
  scenario: string;
}

interface CucumberJsonTag { name?: unknown }
interface CucumberJsonElement { type?: unknown; name?: unknown; tags?: unknown }
interface CucumberJsonFeature { uri?: unknown; elements?: unknown }

function enumerateTaggedScenarios(cwd: string): TaggedScenario[] {
  const override = process.env.KNOWN_DEFECTS_ENUMERATE_CMD;
  let stdout: string;
  if (override) {
    const r = spawnSync(override, { shell: true, cwd, encoding: 'utf8' });
    if (r.error) configError(`KNOWN_DEFECTS_ENUMERATE_CMD 執行失敗:${r.error.message}`);
    if (r.status !== 0) configError(`KNOWN_DEFECTS_ENUMERATE_CMD 退出碼非 0(${r.status}):${r.stderr ?? ''}`);
    stdout = r.stdout ?? '';
  } else {
    const r = spawnSync('npx', ['cucumber-js', '--tags', KNOWN_DEFECT_TAG, '--dry-run', '--format', 'json'], {
      cwd,
      encoding: 'utf8',
      env: baseEnv(),
      timeout: 60_000,
    });
    if (r.error) configError(`cucumber 執行失敗:${r.error.message}`);
    if (r.status !== 0) {
      configError(`cucumber 退出碼非 0(${r.status}),無法列舉 ${KNOWN_DEFECT_TAG} 場景:${(r.stderr ?? '').slice(0, 2000)}`);
    }
    stdout = r.stdout ?? '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    configError(`cucumber 列舉輸出不是合法 JSON:${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) configError('cucumber 列舉輸出必須是陣列(cucumber --format json 的頂層格式)');

  const out: TaggedScenario[] = [];
  for (const featRaw of parsed as CucumberJsonFeature[]) {
    const uri = typeof featRaw.uri === 'string' ? featRaw.uri : '';
    const elements = Array.isArray(featRaw.elements) ? (featRaw.elements as CucumberJsonElement[]) : [];
    for (const el of elements) {
      if (el.type !== 'scenario') continue;
      const tags = Array.isArray(el.tags)
        ? (el.tags as CucumberJsonTag[]).map((t) => (typeof t.name === 'string' ? t.name : '')).filter(Boolean)
        : [];
      // 絕不相信外層 --tags 篩選:自己再檢查一次 tags 陣列真的含 @known-defect。
      if (!tags.includes(KNOWN_DEFECT_TAG)) continue;
      out.push({ feature: uri, scenario: typeof el.name === 'string' ? el.name : '' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// multiset 比對
// ---------------------------------------------------------------------------

function keyOf(feature: string, scenario: string): string {
  return `${feature} ${scenario}`;
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function main(): void {
  const { entries: registry, path: registryPath } = loadRegistry();
  const cwd = resolveCucumberCwd();
  const tagged = enumerateTaggedScenarios(cwd);

  console.log(`known-defects: 登記表 ${registryPath} 有 ${registry.length} 筆,cucumber 列舉到 ${tagged.length} 個 ${KNOWN_DEFECT_TAG} 場景`);

  // (c) 0 目標的例外:兩邊都空 → 這支 gate 現在用不到,不是掃描器壞了。
  if (registry.length === 0 && tagged.length === 0) {
    console.log(`○ 目前沒有任何登記、也沒有任何場景掛 ${KNOWN_DEFECT_TAG}——這支 gate 現在用不到,`);
    console.log('  可以先不要加進 gates.config.json 的 "chain"(不是掃描器壞了,只是還沒有已知缺陷要釘)。');
    console.log(`gate=${GATE_NAME} result=FAIL scanned=0`);
    process.exit(1);
  }

  const taggedCount = countBy(tagged, (t) => keyOf(t.feature, t.scenario));
  const registryCount = countBy(registry, (e) => keyOf(e.feature, e.scenario));

  const allKeys = new Set<string>([...taggedCount.keys(), ...registryCount.keys()]);
  const failures: string[] = [];

  for (const key of allKeys) {
    const [feature, scenario] = key.split(' ');
    const tCount = taggedCount.get(key) ?? 0;
    const rCount = registryCount.get(key) ?? 0;
    if (tCount > rCount) {
      failures.push(`✗ 帶 ${KNOWN_DEFECT_TAG} 但沒登記:${feature} :: ${scenario}`);
    } else if (rCount > tCount) {
      failures.push(`✗ 登記了但場景不存在或沒帶 tag:${feature} :: ${scenario}`);
    }
  }

  const scanned = allKeys.size;

  if (failures.length) {
    console.log('');
    for (const f of failures) console.log(f);
    console.log(`\n${failures.length} 筆對不上。@known-defect tag 跟 known-defects.json 兩邊要完全一致。`);
    console.log(`gate=${GATE_NAME} result=FAIL scanned=${scanned}`);
    process.exit(1);
  }

  console.log(`✓ ${KNOWN_DEFECT_TAG} 的 tag 與登記表完全對上`);
  console.log(`gate=${GATE_NAME} result=PASS scanned=${scanned}`);
  process.exit(0);
}

main();
