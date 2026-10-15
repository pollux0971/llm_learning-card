/**
 * 帳本位置由使用者層指標決定,並帶身分標記(ADR-066)。
 *
 * 純函式:env、homedir、檔案讀取都由呼叫端注入。只有入口層才拿真的
 * process.env / os.homedir()。測試注入合成 env,所以不可能讀到真的指標檔。
 *
 * VerifiedLedger 只能由本檔的解析器產生。ExplicitLedger.unverified 一眼就是未驗證。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { writeFileAtomic } from '../schema/atomic-write.js';

export const VAULT_INIT_CMD = 'npx tsx scripts/vault.ts init';
export const VAULT_SHOW_CMD = 'npx tsx scripts/vault.ts show';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class VerifiedLedger {
  readonly kind = 'verified' as const;
  readonly logPath: string;
  readonly learningDir: string;
  readonly vaultId: string;

  private constructor(learningDir: string, vaultId: string) {
    this.learningDir = learningDir;
    this.vaultId = vaultId;
    this.logPath = join(learningDir, 'state', 'log.jsonl');
  }

  /** 只有本檔的指標解析器可以呼叫。 */
  static mint(learningDir: string, vaultId: string): VerifiedLedger {
    return new VerifiedLedger(learningDir, vaultId);
  }
}

export class ExplicitLedger {
  readonly kind = 'explicit' as const;
  readonly logPath: string;
  readonly reason: string;

  private constructor(logPath: string, reason: string) {
    this.logPath = logPath;
    this.reason = reason;
  }

  static unverified(path: string, reason: string): ExplicitLedger {
    return new ExplicitLedger(path, reason);
  }
}

export type LedgerHandle = VerifiedLedger | ExplicitLedger;

export type VaultRejectReason =
  | 'pointer-missing'
  | 'pointer-unreadable'
  | 'learning-dir-missing'
  | 'marker-mismatch';

export interface VaultResolveDeps {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
}

export type VaultResolveResult =
  | { ok: true; ledger: VerifiedLedger; pointerPath: string }
  | { ok: false; reason: VaultRejectReason; message: string };

export interface VaultIo {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeAtomic: (path: string, content: string) => void;
  mkdir: (path: string, mode?: number) => void;
}

export const vaultAtomicWrite = writeFileAtomic;

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

export function defaultVaultDeps(): VaultResolveDeps {
  return {
    env: process.env,
    homedir: () => homedir(),
    readFile: (path) => readFileSync(path, 'utf8'),
    exists: existsSync,
  };
}

function hint(detail: string): string {
  return `${detail}。請執行 ${VAULT_INIT_CMD} 或 ${VAULT_SHOW_CMD}。`;
}

function reject(reason: VaultRejectReason, detail: string): VaultResolveResult {
  return { ok: false, reason, message: hint(detail) };
}

export function vaultPointerPath(env: NodeJS.ProcessEnv, homedirFn: () => string): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg !== '' ? xdg : join(homedirFn(), '.config');
  return join(base, 'llm-learning-cards', 'vault.json');
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** 逐字相等。容許且只容許一個結尾 `\n`。前綴、大小寫不同、格式不合都算不符。 */
export function vaultIdsEqual(markerText: string, pointerId: string): boolean {
  if (!isUuid(pointerId)) return false;
  let body = markerText;
  if (body.endsWith('\n')) body = body.slice(0, -1);
  if (body.includes('\n') || body.includes('\r')) return false;
  if (!isUuid(body)) return false;
  return body === pointerId;
}

export function markerPath(learningDir: string): string {
  return join(learningDir, 'config', 'vault-id');
}

export function resolveVerifiedLedger(deps: VaultResolveDeps): VaultResolveResult {
  const pointerPath = vaultPointerPath(deps.env, deps.homedir);
  if (!deps.exists(pointerPath)) {
    return reject('pointer-missing', `指標檔不存在:${pointerPath}`);
  }

  let raw: string;
  try {
    raw = deps.readFile(pointerPath);
  } catch (err) {
    return reject('pointer-unreadable', `指標檔讀不到:${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return reject('pointer-unreadable', '指標檔不是合法 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return reject('pointer-unreadable', '指標檔的 JSON 不是物件');
  }
  const record = parsed as Record<string, unknown>;
  const learningDir = record.learning_dir;
  const vaultId = record.vault_id;
  if (typeof learningDir !== 'string' || typeof vaultId !== 'string') {
    return reject('pointer-unreadable', '指標檔缺 learning_dir 或 vault_id,或型別不是字串');
  }
  if (!isAbsolute(learningDir)) {
    return reject('pointer-unreadable', 'learning_dir 必須是絕對路徑;相對路徑視為讀不到');
  }
  if (!deps.exists(learningDir)) {
    return reject('learning-dir-missing', `learning_dir 不存在:${learningDir}`);
  }

  const marker = markerPath(learningDir);
  if (!deps.exists(marker)) {
    return reject('marker-mismatch', '帳本身分標記不存在');
  }
  let markerText: string;
  try {
    markerText = deps.readFile(marker);
  } catch (err) {
    return reject('marker-mismatch', `帳本身分標記讀不到:${err instanceof Error ? err.message : String(err)}`);
  }
  if (!vaultIdsEqual(markerText, vaultId)) {
    return reject('marker-mismatch', '帳本身分標記與指標檔的 vault_id 不符');
  }

  return { ok: true, ledger: VerifiedLedger.mint(learningDir, vaultId), pointerPath };
}

/** 明確 --log。不讀指標檔。 */
export function ledgerFromExplicitLog(
  logPath: string,
  reason: string,
  _deps: VaultResolveDeps,
): { ok: true; ledger: ExplicitLedger } {
  return { ok: true, ledger: ExplicitLedger.unverified(logPath, reason) };
}

export { createLiveGatewayRouter } from './router-gateway.js';
