/**
 * 帳本的位置由使用者層指標決定,並帶帳本身分標記(契約 §12 1.4.0、ADR-066)。
 * 取代舊的 `vault.ts`(`git rev-parse --git-common-dir` 的上一層 + `learning/`):那一招在 worktree
 * 之間算出同一個位置,在 clone 之間各算各的——三個 clone 就是三本帳本、三個互不相通的日上限。
 *
 * - 指標檔:`${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`,
 *   內容 `{ "learning_dir": "<絕對路徑>", "vault_id": "<uuid>" }`。`XDG_CONFIG_HOME` 為空字串視同未設。
 * - 標記:`<learning_dir>/config/vault-id`,內容是同一個 uuid,逐字相等,容許且只容許一個結尾 `\n`。
 * - 指標不存在、讀不到、`learning_dir` 不存在、標記不符:四種一律拒絕,不退回任何預設位置。
 *
 * 兩種帳本把手:
 * - `VerifiedLedger`:**只能**由本檔的 `resolveVerifiedLedger` 產生(私有建構子 + 模組內的 mint;
 *   `#` 私有欄位讓它成為名義型別,結構相同的字面值冒充不了)。真呼叫(打網路、花錢)的 router 只收它。
 * - `ExplicitLedger`:明確參數(`--log` 之類),**未驗證**。只能經 `ExplicitLedger.unverified(path, reason)`
 *   產生,grep 找得到每一個用到的地方;只准給假的 adapter、讀取報告與測試。
 *
 * 純函式:env、homedir、檔案讀取都由呼叫端注入(`VaultResolveDeps`)。只有入口層——
 * `scripts/llm.ts`、`scripts/llm-spend.ts`、`scripts/vault.ts`、`scripts/check-ledger-pollution.ts` 的 `main`
 * 與 `createDefaultLiveRouter` 的零參數預設——才用 `defaultVaultDeps()` 拿真的 `process.env` / `os.homedir()`。
 * 測試永遠注入合成的 env,所以不可能讀到真的指標檔(ADR-051 同一個理由:「沒給的話退回哪裡」要能不碰
 * 真的檔案系統就測到)。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { writeFileAtomic } from '../schema/atomic-write.js';

export const VAULT_INIT_CMD = 'npx tsx scripts/vault.ts init';
export const VAULT_SHOW_CMD = 'npx tsx scripts/vault.ts show';

/** 小寫的 RFC 4122 形狀(`crypto.randomUUID()` 產生的就是這個)。大寫不是本系統寫出的格式,算不合。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let mintVerified: (learningDir: string, vaultId: string) => VerifiedLedger;

/** 經指標檔與身分標記驗證過的帳本。只有 `resolveVerifiedLedger` 做得出來。 */
export class VerifiedLedger {
  /** 名義型別的錨:有它,結構相同的物件字面值就不是 VerifiedLedger(只給型別系統看,執行期不讀)。 */
  readonly #verified = true;
  readonly kind = 'verified' as const;
  /** `<learningDir>/state/log.jsonl` */
  readonly logPath: string;
  readonly learningDir: string;
  readonly vaultId: string;

  private constructor(learningDir: string, vaultId: string) {
    this.learningDir = learningDir;
    this.vaultId = vaultId;
    this.logPath = join(learningDir, 'state', 'log.jsonl');
  }

  static {
    // 只在本模組可見:類別上不留任何公開的 static 工廠。
    mintVerified = (learningDir, vaultId) => new VerifiedLedger(learningDir, vaultId);
  }
}

/** 明確參數給的帳本,未驗證。 */
export class ExplicitLedger {
  /** 同上:名義型別的錨。 */
  readonly #explicit = true;
  readonly kind = 'explicit' as const;
  readonly logPath: string;
  /** 為什麼這裡可以用未驗證的帳本(給 grep 與審核看的) */
  readonly reason: string;

  private constructor(logPath: string, reason: string) {
    this.logPath = logPath;
    this.reason = reason;
  }

  /** 名字刻意寫明「未驗證」:`git grep -n "ExplicitLedger.unverified"` 列得出每一個用到的地方。 */
  static unverified(path: string, reason: string): ExplicitLedger {
    return new ExplicitLedger(path, reason);
  }
}

export type LedgerHandle = VerifiedLedger | ExplicitLedger;

export type VaultRejectReason = 'pointer-missing' | 'pointer-unreadable' | 'learning-dir-missing' | 'marker-mismatch';

export interface VaultResolveDeps {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
}

export type VaultResolveResult =
  | { ok: true; ledger: VerifiedLedger; pointerPath: string }
  | { ok: false; reason: VaultRejectReason; message: string };

/** `scripts/vault.ts` 的檔案操作。兩份檔的寫入都走原子寫入(暫存檔 → fsync → rename)。 */
export interface VaultIo {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  /** `mode` 可選(T8):指標檔傳 0o600,暫存檔建立時就是這個權限(見 writeFileAtomic)。 */
  writeAtomic: (path: string, content: string, mode?: number) => void;
  mkdir: (path: string, mode?: number) => void;
}

export function realVaultIo(): VaultIo {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeAtomic: writeFileAtomic,
    mkdir: (path, mode) => {
      if (mode === undefined) mkdirSync(path, { recursive: true });
      else mkdirSync(path, { recursive: true, mode });
    },
  };
}

/** 入口層專用:真的 env、真的 homedir、真的檔案系統。 */
export function defaultVaultDeps(): VaultResolveDeps {
  return {
    env: process.env,
    homedir: () => homedir(),
    readFile: (path) => readFileSync(path, 'utf8'),
    exists: existsSync,
  };
}

export function vaultPointerPath(env: NodeJS.ProcessEnv, homedirFn: () => string): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg !== '' ? xdg : join(homedirFn(), '.config');
  return join(base, 'llm-learning-cards', 'vault.json');
}

export function markerPath(learningDir: string): string {
  return join(learningDir, 'config', 'vault-id');
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** 標記檔內容 → uuid。容許且只容許一個結尾 `\n`;其他任何多出來的字元(含 `\r`、空白)或格式不合回 undefined。 */
export function parseMarker(text: string): string | undefined {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return isUuid(body) ? body : undefined;
}

/** 標記與指標的 `vault_id` 整串相等。不是前綴、不是不分大小寫;任一邊格式不合都算不符。 */
export function vaultIdsEqual(markerText: string, pointerId: string): boolean {
  const markerId = parseMarker(markerText);
  return markerId !== undefined && markerId === pointerId;
}

export type PointerParse = { ok: true; learningDir: string; vaultId: string } | { ok: false; detail: string };

/** 指標檔的內容。JSON 壞、不是物件、欄位缺或型別錯、`learning_dir` 不是絕對路徑,一律「讀不到」。 */
export function parsePointer(raw: string): PointerParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, detail: '指標檔不是合法 JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, detail: '指標檔的 JSON 不是物件' };
  }
  const record = parsed as Record<string, unknown>;
  const learningDir = record.learning_dir;
  const vaultId = record.vault_id;
  if (typeof learningDir !== 'string' || typeof vaultId !== 'string') {
    return { ok: false, detail: '指標檔缺 learning_dir 或 vault_id,或型別不是字串' };
  }
  if (!isAbsolute(learningDir)) {
    return { ok: false, detail: 'learning_dir 必須是絕對路徑(相對路徑視為讀不到)' };
  }
  return { ok: true, learningDir, vaultId };
}

function reject(reason: VaultRejectReason, detail: string): VaultResolveResult {
  return { ok: false, reason, message: `${detail}。帳本位置只由指標檔決定;請執行 ${VAULT_INIT_CMD} 或 ${VAULT_SHOW_CMD}。` };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 指標檔 → 標記 → `VerifiedLedger`。只讀這兩個檔,不建任何東西。
 * 四種拒絕:指標不存在、讀不到(含 JSON 壞、欄位缺或型別錯、相對路徑)、`learning_dir` 不存在、標記不符(含標記不存在)。
 */
export function resolveVerifiedLedger(deps: VaultResolveDeps): VaultResolveResult {
  const pointerPath = vaultPointerPath(deps.env, deps.homedir);
  if (!deps.exists(pointerPath)) {
    return reject('pointer-missing', `指標檔不存在:${pointerPath}`);
  }

  let raw: string;
  try {
    raw = deps.readFile(pointerPath);
  } catch (err) {
    return reject('pointer-unreadable', `指標檔讀不到:${pointerPath}:${errorText(err)}`);
  }
  const pointer = parsePointer(raw);
  if (!pointer.ok) {
    return reject('pointer-unreadable', `指標檔讀不到:${pointerPath}:${pointer.detail}`);
  }

  if (!deps.exists(pointer.learningDir)) {
    return reject('learning-dir-missing', `指標檔的 learning_dir 不存在:${pointer.learningDir}`);
  }

  const marker = markerPath(pointer.learningDir);
  if (!deps.exists(marker)) {
    return reject('marker-mismatch', `帳本身分標記不存在:${marker}`);
  }
  let markerText: string;
  try {
    markerText = deps.readFile(marker);
  } catch (err) {
    return reject('marker-mismatch', `帳本身分標記讀不到:${marker}:${errorText(err)}`);
  }
  if (!vaultIdsEqual(markerText, pointer.vaultId)) {
    return reject('marker-mismatch', `帳本身分標記與指標檔的 vault_id 不符:${marker}`);
  }

  return { ok: true, ledger: mintVerified(pointer.learningDir, pointer.vaultId), pointerPath };
}
