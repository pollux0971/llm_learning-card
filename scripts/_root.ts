// SOURCE: template v1.4.1 (ff7f64b) sha256=1b93e85ff6cc307532c972d2ba4fd355e46d205a2cac1a9210957fae016d08c3 — 勿手改;升版用 sync-gates.sh
/**
 * 所有守門腳本共用的 repo 根解析。
 *
 * 舊版用 `resolve(import.meta.dirname, '..')`,也就是「腳本自己所在目錄的上一層」——
 * 這要求腳本必須先被複製進目標 repo 的 scripts/ 才能用。改成用 git 找目前 cwd 所在
 * 的 repo 頂層,腳本就能留在模板裡,直接用 `npx tsx <template>/scripts/x.ts`
 * 對「執行時的 cwd 所在的 repo」跑,不必複製。
 *
 * 解法:優先問 git(`git rev-parse --show-toplevel`,以 process.cwd() 為準);
 * 不在 git repo 裡(或找不到 git 執行檔)就退回 process.cwd() 本身。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function resolveRoot(): string {
  try {
    // stdio 顯式指定,避免不在 git repo 裡時 git 把 "fatal: not a git repository" 印到
    // 終端機——這條路徑是刻意的退回,不是使用者需要看到的錯誤。
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

export const ROOT: string = resolveRoot();

/**
 * 設定檔位置解析(CHANGELOG 1.3.2 (A);env 優先權見 CHANGELOG 1.3.4 (3))。
 *
 * `sync-gates.sh` 把守門腳本複製進 consumer 的**安裝目錄**——預設是 `scripts/`,
 * 但 cucumber 設定不在根目錄的專案常把它裝在別處(例如 `features/scripts/`),設定檔
 * (`gates.config.json`、`boundaries.*.json`)也一起裝在那裡。過去每支腳本只認
 * `ROOT/scripts/<name>`,裝在別處的設定就永遠讀不到——不會報錯,只會安靜套用預設值
 * 或觸發自動偵測,像是設定死掉了一樣(專案 B 實測的迴歸)。
 *
 * 找設定檔的順序:
 *   0. 環境變數 `GATES_CONFIG_DIR`(若設且該目錄存在)
 *   1. 呼叫端腳本自己所在的目錄(`import.meta.dirname`,sync 後就是 consumer 的安裝目錄)
 *   2. `ROOT/scripts/`
 * 三處都沒有 → 回傳 `undefined`,呼叫端印「設定檔未找到於 <搜尋過的路徑>」(必要設定)
 * 或靜默套用內建預設(選填設定,行為不變)。
 *
 * 為什麼要有第 0 順位:`verify-against.sh` 直接對模板路徑下的 `.ts` 執行(不經
 * `sync-gates.sh` 複製),此時「呼叫端腳本自己所在的目錄」(順位 1)是**模板自己的
 * `scripts/` 目錄**,裡面放的是給新專案抄的佔位設定——對 boundaries 這種硬性設定,
 * 永遠讀到模板的佔位 owners.json,對 consumer 的真實落點表永遠比出「差異」
 * (CHANGELOG 1.3.4 (3))。`GATES_CONFIG_DIR` 讓 `verify-against.sh` 明講「這次跑
 * 模板版時,設定要去哪裡找」,不受「腳本實際放在哪個目錄」影響。
 */
export function resolveConfig(scriptDir: string, name: string): string | undefined {
  for (const candidate of configSearchPaths(scriptDir, name)) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** `resolveConfig` 實際會依序嘗試的路徑(env 優先權存在時 3 個,否則 2 個),供找不到時的錯誤訊息使用。 */
export function configSearchPaths(scriptDir: string, name: string): string[] {
  const paths: string[] = [];
  const envDir = process.env.GATES_CONFIG_DIR;
  if (envDir && existsSync(envDir)) {
    paths.push(join(envDir, name));
  }
  paths.push(join(scriptDir, name), join(ROOT, 'scripts', name));
  return paths;
}

/**
 * S14(來源 AI_KM,2026-09-05;PITFALLS P-73)——`--root` 明講對別的 repo 跑守門時的設定檔
 * 解析,跟上面 `resolveConfig`/`configSearchPaths` 是同一個問題的另一半:那兩個函式綁死
 * 模組層級的 `ROOT`(現場 cwd 所在的 git repo),完全不知道呼叫端可能用 `--root <dir>`
 * 明講了一個**不同**的目標 repo(`check-boundaries.ts`、`check-doc-rot.ts` 這幾支支援
 * `--root` 的腳本各自另外維護一份 `configSearchPathsList`,原因正是這裡)。
 *
 * 事故(P-73):consumer 在**模板路徑**下對別的 repo 跑
 * `check-boundaries.ts --root /data/python/AI_KM`,沒有設 `GATES_CONFIG_DIR`——搜尋順序
 * 舊版是「腳本自己所在目錄 → `<root>/scripts/`」,不管 `--root` 有沒有明講都一樣,順位 1
 * 永遠先中——於是靜默套用了**模板自己的**佔位 `boundaries.owners.json`(FAIL
 * scanned=0 / 248 unmapped),不是 consumer 裝好的那份;加上 `GATES_CONFIG_DIR` 才對。
 * 跟 P-43 同型:模板端「看起來綠」蓋住了真正該讀的設定沒被讀到。
 *
 * 修法(這裡是規則,呼叫端把 `rootExplicit` 設成「這次呼叫有沒有給 `--root`」):
 *   - `--root` **沒有**明講(consumer 裝好之後在自己 repo 裡正常執行)→ 順序不變:
 *     `GATES_CONFIG_DIR` → 腳本自己所在目錄(sync 後是 consumer 的安裝目錄)→
 *     `<root>/scripts/`。
 *   - `--root` **明講**了 → 「腳本自己所在目錄」這個候選整個拿掉,只剩
 *     `GATES_CONFIG_DIR` → `<root>/scripts/`——找不到就是**缺席要抱怨,不要降級**:
 *     回傳的 `hardErrorMessage` 讓呼叫端印出來、印 gate 標記、`exit 1`,不准安靜地退回
 *     模板自己目錄下的範例設定當作「找到了」繼續跑(那正是這次事故的成因)。
 *   `GATES_CONFIG_DIR` 兩種情況下都優先,不受 `rootExplicit` 影響——它就是「這次跑模板版
 *   時,設定要去哪裡找」的明講管道(`verify-against.sh` 用的就是它)。
 *
 * 同時回傳 `source`(供每支 gate 印「設定:<resolved path>」透明度那一行——找不到就是
 * 「設定:無,使用預設」,讓讀 log 的人第一行就看得出這次到底讀了哪份設定,不用等到掃描
 * 結果對不上才回頭懷疑設定檔)。
 */
export interface ConfigLookup {
  /** 解析出來的路徑;找不到是 `undefined`。 */
  path: string | undefined;
  /** 給「設定:...」那一行印的說明文字。 */
  source: string;
  /** 只有「`--root` 明講、且 `GATES_CONFIG_DIR` 沒有覆蓋、且 `<root>/scripts/<name>`
   *  也沒有」這個組合才會填——呼叫端看到有值就代表要大聲失敗,不是靜默略過。 */
  hardErrorMessage?: string;
  /** 依序嘗試過的路徑,供呼叫端自己組「找不到」訊息時引用(跟舊版 `configSearchPaths`
   *  的用途一樣,這裡是 `rootExplicit` 版本)。 */
  triedPaths: string[];
}

export function lookupConfig(
  scriptDir: string,
  name: string,
  opts?: { root?: string; rootExplicit?: boolean },
): ConfigLookup {
  const root = opts?.root ?? ROOT;
  const rootExplicit = opts?.rootExplicit ?? false;
  const envDir = process.env.GATES_CONFIG_DIR;
  const triedPaths: string[] = [];
  if (envDir && existsSync(envDir)) {
    const p = join(envDir, name);
    triedPaths.push(p);
    if (existsSync(p)) return { path: p, source: `設定:${p}(GATES_CONFIG_DIR)`, triedPaths };
  }
  if (rootExplicit) {
    const p = join(root, 'scripts', name);
    triedPaths.push(p);
    if (existsSync(p)) return { path: p, source: `設定:${p}`, triedPaths };
    return {
      path: undefined,
      source: '設定:無,使用預設',
      hardErrorMessage:
        `設定檔未找到於 ${p}(--root 明講時不退回腳本自身目錄;要指定別處請設 GATES_CONFIG_DIR)`,
      triedPaths,
    };
  }
  const scriptDirPath = join(scriptDir, name);
  triedPaths.push(scriptDirPath);
  if (existsSync(scriptDirPath)) return { path: scriptDirPath, source: `設定:${scriptDirPath}`, triedPaths };
  const rootScriptsPath = join(root, 'scripts', name);
  triedPaths.push(rootScriptsPath);
  if (existsSync(rootScriptsPath)) return { path: rootScriptsPath, source: `設定:${rootScriptsPath}`, triedPaths };
  return { path: undefined, source: '設定:無,使用預設', triedPaths };
}

/**
 * 設定檔壞掉要大聲失敗(S9,來源:專案 A 協調者)。
 *
 * 動機:一個消費者實測到,`gates.config.json` 打壞(手改壞掉的 JSON、鍵打錯字、
 * 型別填錯)之後,有些 gate 直接丟出未捕捉的例外(堆疊噴到終端機,沒有印
 * `gate=<name> result=FAIL scanned=0` 這行機器可讀標記,CI 看起來像是腳本本身壞掉,
 * 不是設定壞掉),有些 gate 用 `try { JSON.parse(...) } catch { return {} }` 悄悄套用
 * 內建預設值——後者更危險:gate 印「PASS」,但其實整份設定形同沒填,「看起來有跑」
 * 但其實完全沒套用使用者的設定。兩種都不對。
 *
 * 統一規則,所有讀設定檔的 gate 都要走這三個共用函式:
 *   1. 解析錯誤(檔案讀不到、JSON.parse 炸掉)→ `readConfigJson()` 印
 *      `✗ 設定檔壞掉:<path>: <message>`,印 gate 標記(scanned=0)、exit 1。
 *      不是未捕捉的堆疊,也不是悄悄回退預設值。
 *   2. 已知鍵型別填錯(例如 `chain` 不是陣列、`runTimeoutMs` 不是數字)→
 *      `requireConfigType()` 印 `✗ 設定檔鍵型別錯:<key> 應為 <type>`,同樣印標記、exit 1。
 *   3. `gates.config.json` 出現不認識的頂層鍵(打錯字最常見的癥狀)→
 *      `requireKnownTopLevelKeys()` 印 `✗ 設定檔有不認識的鍵:<key>(打錯字?)已知鍵:<list>`,
 *      同樣印標記、exit 1。這一條只對 `gates.config.json` 有意義(它是唯一被多支 gate
 *      共讀共寫、容易「這支 gate 沒認得但那支認得」的設定檔;`boundaries.owners.json`
 *      這類單一 gate 專用的設定檔,結構錯誤直接照該 gate 自己既有的訊息處理即可)。
 *
 * `readConfigJson` / `requireConfigType` / `requireKnownTopLevelKeys` 都是 `never` 型別的
 * 失敗路徑(exit 1),呼叫端不需要、也不應該再自己 catch 一次——「設定檔壞掉」永遠是
 * 同一句話、同一種退出方式,不該每支 gate 各自決定要不要處理。
 */
function failConfig(gateName: string, message: string): never {
  console.error(`✗ ${message}`);
  console.log(`gate=${gateName} result=FAIL scanned=0`);
  process.exit(1);
}

/** 讀一份**已知存在**的 JSON 設定檔(呼叫端通常先用 `resolveConfig` / `configSearchPaths`
 *  確認過路徑存在);讀檔失敗或 `JSON.parse` 失敗都印「設定檔壞掉」並 exit 1,不丟出
 *  未捕捉的例外,也不悄悄回退成 `{}`。 */
export function readConfigJson(path: string, gateName: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return failConfig(gateName, `設定檔壞掉:${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return failConfig(gateName, `設定檔壞掉:${path}: ${(e as Error).message}`);
  }
}

/** `requireConfigType` 認得的型別名稱。`'array'` 特別用 `Array.isArray` 判斷
 *  (JS 的 `typeof [] === 'object'`,不能直接用 `typeof`)。 */
export type ConfigValueKind = 'array' | 'number' | 'string' | 'boolean' | 'object';

function actualKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** `value` 的型別跟 `kind` 不符 → 印 `✗ 設定檔鍵型別錯:<key> 應為 <kind>`、印標記、exit 1。
 *  呼叫端只在 `value !== undefined` 時呼叫這個函式——「這個鍵沒填」是另一回事(通常有
 *  自己的預設值或「尚未設定」流程),不該被這裡當成型別錯。 */
export function requireConfigType(value: unknown, key: string, kind: ConfigValueKind, gateName: string): void {
  const ok = kind === 'array' ? Array.isArray(value) : !Array.isArray(value) && value !== null && typeof value === kind;
  if (!ok) failConfig(gateName, `設定檔鍵型別錯:${key} 應為 ${kind}(實際:${actualKind(value)})`);
}

/**
 * `gates.config.json` 已知的頂層鍵清單(S9)。**每個 gate 新增一個頂層鍵都要加進這裡**——
 * 不管是哪支 gate 讀的:這份清單是「所有 gate 認得的鍵」的聯集,不是「這支 gate 自己用
 * 得到的鍵」的子集,不然 gate A 新增的鍵在 gate B 眼裡永遠是「不認識的鍵」。
 *   cucumberCwd / phaseCoverage — check-phase-coverage.ts
 *   docLinks                    — check-doc-links.ts
 *   gherkinDup                  — check-gherkin-dup.ts
 *   sync                        — sync-gates.sh(語言選集)
 *   chain                       — check-all.ts
 *   unwired                     — sync-gates.sh(接線檢查允許清單)
 *   nextGates                   — check-next-gates.ts
 *   skipDirs                    — 所有掃描器共用的略過目錄清單(S10,見 SKIP_DIRS)
 *   docRot                      — check-doc-rot.ts(S7)
 *   knownDefects                — check-known-defects.ts(S8)
 */
export const KNOWN_GATES_CONFIG_KEYS = [
  'cucumberCwd',
  'phaseCoverage',
  'docLinks',
  'gherkinDup',
  'sync',
  'chain',
  'unwired',
  'nextGates',
  'skipDirs',
  'docRot',
  'knownDefects',
] as const;

/** `obj` 的頂層鍵裡,有沒有不在 `knownKeys` 的——通常是打錯字(`"chian"` 之類)。
 *  命中就印 `✗ 設定檔有不認識的鍵:<key>(打錯字?)已知鍵:<list>`、印標記、exit 1。 */
export function requireKnownTopLevelKeys(
  obj: Record<string, unknown>,
  knownKeys: readonly string[],
  path: string,
  gateName: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      failConfig(
        gateName,
        `設定檔有不認識的鍵:${key}(打錯字?)已知鍵:${knownKeys.join(', ')}(${path})`,
      );
    }
  }
}

/**
 * 讀一份 `gates.config.json`,做 S9 規定的兩件事:解析錯誤大聲失敗(`readConfigJson`)、
 * 頂層鍵不認識大聲失敗(`requireKnownTopLevelKeys`)。找不到檔案回傳 `undefined`
 * (`gates.config.json` 對大多數 gate 是選填設定,找不到不是錯,呼叫端自己決定要不要
 * 當成「必要設定缺席」處理)。回傳值刻意是 `Record<string, unknown>`(未細分型別)——
 * 每支 gate 自己從裡面挑要的鍵、自己用 `requireConfigType` 檢查那個鍵的型別。
 */
export function loadGatesConfig(path: string | undefined, gateName: string): Record<string, unknown> | undefined {
  if (!path) return undefined;
  const raw = readConfigJson(path, gateName);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    failConfig(gateName, `設定檔壞掉:${path}: 頂層必須是物件`);
  }
  const obj = raw as Record<string, unknown>;
  requireKnownTopLevelKeys(obj, KNOWN_GATES_CONFIG_KEYS, path, gateName);
  return obj;
}

/**
 * 所有掃描目錄樹的 gate 共用的略過目錄清單(S10,來源 AI_KM)。
 *
 * 背景:`check-boundaries.ts` 的 `SKIP_DIRS` 原本沒有 `.next`,一個用 Next.js 的消費者
 * 因此吃到 511 筆雜訊違規(整個 apps 底下每個子專案的 `.next` 建置產物被當成原始碼掃描)。每支掃描器各自
 * 維護一份略過清單,漏一個新框架的建置產物目錄名,同一種事故就會在別的 gate 再發生一次。
 *
 * 移到這裡當唯一清單,**每一支會走目錄樹的 gate 都要 import 這個常數**,不准各自宣告
 * 自己的 `SKIP_DIRS`(有測試強制這條,見 check-boundaries.test.ts 的 grep 測試)。
 *
 * `gates.config.json` 的 `skipDirs`(字串陣列)**追加**在預設清單之後,不取代——專案有
 * 自己的建置產物目錄名時不必改任何一支 gate 本體。刻意不讀 `.gitignore`:那份檔案的規則
 * (glob、否定樣式)比這裡需要的複雜得多,而且 `.gitignore` 排除的東西不見得是「這不是
 * 原始碼」,兩者語意不同,硬套會兩邊都不準。
 */
export const DEFAULT_SKIP_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  '.claude/worktrees',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  'reports',
];

/** `DEFAULT_SKIP_DIRS` + `gates.config.json` 的 `skipDirs`(追加、去重)。
 *  `gatesConfig` 通常是 `loadGatesConfig(...)` 的回傳值;沒有設定檔或沒填 `skipDirs`
 *  就只用內建預設。`skipDirs` 存在但型別不是陣列 → 用 `requireConfigType` 大聲失敗
 *  (跟其他已知鍵型別錯一致,不悄悄忽略)。 */
export function resolveSkipDirs(gatesConfig: Record<string, unknown> | undefined, gateName: string): Set<string> {
  const extra = gatesConfig?.skipDirs;
  if (extra === undefined) return new Set(DEFAULT_SKIP_DIRS);
  requireConfigType(extra, 'skipDirs', 'array', gateName);
  const extraStrings = (extra as unknown[]).filter((s): s is string => typeof s === 'string');
  return new Set([...DEFAULT_SKIP_DIRS, ...extraStrings]);
}

/**
 * `.claude/worktrees/<name>` 這種一整段前綴形式的排除(`DEFAULT_SKIP_DIRS` 裡
 * `.claude/worktrees` 那一項是「路徑片段」寫法,單純用「目錄名字完全等於這個字串就跳過整棵
 * 子樹」的掃描器——例如 `check-boundaries.ts` 的 `walk()`——沒辦法用它跳過 `.claude/worktrees`
 * 本身以外的東西,因為 `.claude` 跟 `worktrees`是兩層,不會有任何一層的目錄名字剛好等於
 * `.claude/worktrees` 這個帶斜線的字串)。這個函式把 `skipDirs` 集合拆成「單層目錄名」
 * (逐層比對,例如 `node_modules`)跟「多層路徑前綴」(例如 `.claude/worktrees`)兩組,
 * 給需要精準比對相對路徑前綴的掃描器(`check-doc-links.ts` 走的是「相對 ROOT 的路徑
 * 前綴」邏輯,不是逐層目錄名)用。
 */
export function splitSkipDirs(skipDirs: Set<string>): { segments: Set<string>; prefixes: string[] } {
  const segments = new Set<string>();
  const prefixes: string[] = [];
  for (const entry of skipDirs) {
    if (entry.includes('/')) prefixes.push(entry);
    else segments.add(entry);
  }
  return { segments, prefixes };
}

/**
 * `features/<folder>/FEATURE.md` 的 Phase 表(唯一狀態來源)有沒有 `phaseNum` 那一列
 * (`check-next-gates.ts` 的 `phaseRowExists` 沒有 export,這裡是同一套邏輯的共用版——
 * 見 S8:`check-known-defects.ts` 的 `fix_in` 參照要驗證 phase 表格列真的存在,
 * 不重新發明一套解析)。檔案不存在或找不到那一列都回傳 `false`。
 */
export function featurePhaseRowExists(root: string, folder: string, phaseNum: string): boolean {
  const featurePath = join(root, 'features', folder, 'FEATURE.md');
  if (!existsSync(featurePath)) return false;
  const content = readFileSync(featurePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells[1] === phaseNum) return true;
  }
  return false;
}

/** `docs/02-decision-map.md` 裡有沒有 `## ADR-<id> · ...` 這個標題。 */
export function adrExists(root: string, id: string): boolean {
  const p = join(root, 'docs', '02-decision-map.md');
  if (!existsSync(p)) return false;
  const content = readFileSync(p, 'utf8');
  return new RegExp(`^##\\s+ADR-${id}\\s*·`, 'm').test(content);
}
