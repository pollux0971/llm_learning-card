/**
 * webview 端的 `LearningFs`(契約 §13 的五個方法;T2c-1 驗收 A3、D12、E16)。
 *
 * 跑在 webview(瀏覽器引擎)裡:不 import 任何 `node:` 模組,也不 import `@core/schema/log`
 * (warning 事件由 Rust 寫,ADR-069)。四個方法經 `@tauri-apps/api/core` 的 `invoke` 叫 Rust command
 * (`apps/desktop/src-tauri/src/commands.rs`),參數**原樣**交出去:TS 不先檢查、不轉換,權威在 Rust。
 *
 * command 的錯誤 JSON 轉成三個不同的錯誤類別:
 *   `{ kind: 'refused', reason }`     → `PathRefusedError`(白名單或 symlink 不過;Rust 已寫 warning)
 *   `{ kind: 'io', code, errno? }`    → `LearningIoError`(路徑合法、檔案系統出錯;不是攻擊)
 *   `{ kind: 'not-configured' }`      → `LearningNotConfiguredError`(T2c-2:啟動狀態不是 ok,learning 根沒設好;
 *                                        不是拒絕、不是 io 錯誤。畫面怎麼呈現由前端決定,這裡只給形狀)
 *
 * `assetUrl` 是同步的(回傳字串):先做 TS 端的提示檢查,不過就丟 `PathRefusedError`、不呼叫 invoke;
 * 過了就回 `assetUrlPrefix(os)` + 逐段 `encodeURIComponent`。真正擋人的是 `lc` 協定的 handler。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface LearningFs {
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
}

export interface CreateLearningFsOptions {
  /** 預設是 `@tauri-apps/api/core` 的 invoke;測試與 probe 換成自己的。 */
  invoke?: InvokeFn;
  /** `linux`、`macos`、`windows`、`android`……;預設從 `navigator.userAgent` 猜。 */
  os?: string;
}

/** 被拒絕:白名單或 symlink 不過(Rust 的 `Refusal`),或 assetUrl 的提示檢查不過。 */
export class PathRefusedError extends Error {
  readonly reason: string;
  readonly relPath: string;

  constructor(reason: string, relPath: string) {
    super(`path refused (${reason}): ${JSON.stringify(relPath)}`);
    this.name = 'PathRefusedError';
    this.reason = reason;
    this.relPath = relPath;
  }
}

/** io 錯誤:路徑合法、檔案系統出錯。`code` 是 Rust 的分類(`not_found`、`is_dir`、`permission`、`not_utf8`……)。 */
export class LearningIoError extends Error {
  readonly code: string;
  readonly relPath: string;
  readonly errno?: number;

  constructor(code: string, relPath: string, errno?: number) {
    super(`learning fs io error (${code}): ${JSON.stringify(relPath)}`);
    this.name = 'LearningIoError';
    this.code = code;
    this.relPath = relPath;
    if (errno !== undefined) this.errno = errno;
  }
}

/**
 * learning 根沒設好:指標檔不存在、讀不到、learning 資料夾不存在、或身分不符(T2c-2)。
 * Rust 沒碰檔案、沒寫 warning;要使用者跑 `npx tsx scripts/vault.ts init`,桌面程式不替人設定。
 */
export class LearningNotConfiguredError extends Error {
  readonly relPath: string;

  constructor(relPath: string) {
    super(`learning directory is not configured: ${JSON.stringify(relPath)}`);
    this.name = 'LearningNotConfiguredError';
    this.relPath = relPath;
  }
}

/** `lc` 協定在各平台上的 URL 前綴。Windows 與 Android 的 webview 只認 `http://<scheme>.localhost/`(phase-5)。 */
export function assetUrlPrefix(os: string): string {
  return os === 'windows' || os === 'android' ? 'http://lc.localhost/' : 'lc://localhost/';
}

function guessOs(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  return 'linux';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** command 的錯誤 JSON → 錯誤類別;認不得的形狀原樣丟出去(那是 Tauri 自己的錯,不是邊界的)。 */
function toBoundaryError(raw: unknown, relPath: string): unknown {
  if (isRecord(raw) && raw.kind === 'refused' && typeof raw.reason === 'string') {
    return new PathRefusedError(raw.reason, relPath);
  }
  if (isRecord(raw) && raw.kind === 'io' && typeof raw.code === 'string') {
    return new LearningIoError(raw.code, relPath, typeof raw.errno === 'number' ? raw.errno : undefined);
  }
  if (isRecord(raw) && raw.kind === 'not-configured') {
    return new LearningNotConfiguredError(relPath);
  }
  return raw;
}

async function call(invoke: InvokeFn, cmd: string, args: Record<string, unknown>, relPath: string): Promise<unknown> {
  try {
    return await invoke(cmd, args);
  } catch (raw) {
    throw toBoundaryError(raw, relPath);
  }
}

function expectString(value: unknown, cmd: string): string {
  if (typeof value !== 'string') throw new Error(`${cmd} 回傳的不是字串: ${JSON.stringify(value)}`);
  return value;
}

function expectBoolean(value: unknown, cmd: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${cmd} 回傳的不是 boolean: ${JSON.stringify(value)}`);
  return value;
}

function expectStrings(value: unknown, cmd: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${cmd} 回傳的不是字串陣列: ${JSON.stringify(value)}`);
  }
  return value as string[];
}

// ---------------------------------------------------------------- assetUrl 的提示檢查

const RESERVED_STEMS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...'123456789'.split('').flatMap((n) => [`com${n}`, `lpt${n}`]),
  ...['¹', '²', '³'].flatMap((s) => [`com${s}`, `lpt${s}`]),
]);

/** ASCII 的 A–Z a–z 0–9 _ - .,或 Unicode 一般類別 L、N、M。 */
const SEGMENT_CHARS = /^[\p{L}\p{N}\p{M}_.-]+$/u;

/** 只摺 A–Z,不用依語系變化的 toLowerCase。 */
function asciiFold(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function segmentHint(seg: string): string | undefined {
  if (seg.length === 0 || seg.startsWith('.') || !SEGMENT_CHARS.test(seg)) return 'structure';
  if (seg.normalize('NFC') !== seg) return 'nfc';
  if (seg.endsWith('.')) return 'trailing-dot';
  if (RESERVED_STEMS.has(asciiFold(seg.split('.')[0] ?? seg))) return 'reserved';
  return undefined;
}

/**
 * §13 白名單的 TS 謄本,只當提示:順序與 reason 名照 Rust 的 `check_rel_path`。
 * Unicode 版本可能與 Rust 不同(§13 已知限制),結論不一致時以 Rust 為準。
 */
export function hintRelPath(rel: string): string | undefined {
  if (rel.length === 0 || rel.startsWith('/') || rel.endsWith('/') || rel.includes('//')) return 'structure';
  for (const seg of rel.split('/')) {
    const reason = segmentHint(seg);
    if (reason) return reason;
  }
  if (rel.normalize('NFC') !== rel) return 'nfc';
  if (new TextEncoder().encode(rel).length > 240) return 'length';
  if (asciiFold(rel.split('/')[0] ?? '') === 'raw') return 'raw';
  return undefined;
}

// ---------------------------------------------------------------- 本體

export function createLearningFs(options: CreateLearningFsOptions = {}): LearningFs {
  const invoke: InvokeFn = options.invoke ?? tauriInvoke;
  const prefix = assetUrlPrefix(options.os ?? guessOs());
  return {
    async read(relPath) {
      return expectString(await call(invoke, 'read', { relPath }, relPath), 'read');
    },
    async write(relPath, content) {
      await call(invoke, 'write', { relPath, content }, relPath);
    },
    async list(relDir) {
      return expectStrings(await call(invoke, 'list', { relDir }, relDir), 'list');
    },
    async exists(relPath) {
      return expectBoolean(await call(invoke, 'exists', { relPath }, relPath), 'exists');
    },
    assetUrl(relPath) {
      const reason = hintRelPath(relPath);
      if (reason) throw new PathRefusedError(reason, relPath);
      return prefix + relPath.split('/').map(encodeURIComponent).join('/');
    },
  };
}
