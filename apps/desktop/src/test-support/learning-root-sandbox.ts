/**
 * T2c-2 的測試支援(測試 agent 寫):learning 根目錄「只有一個來源」= 使用者層指標檔。
 *
 * 所有測試與 probe 要指定根目錄,一律走「指向暫存目錄的 XDG_CONFIG_HOME + 暫存指標檔」(工單驗收 4),不另開後門。
 * 這裡提供:
 *   - 暫存沙箱(HOME、XDG_CONFIG_HOME、learning、cwd 都在 mkdtemp 底下;不碰真的指標檔與真的 learning/)
 *   - 寫指標檔與身分標記(只有測試會寫;桌面程式只讀)
 *   - 目錄快照(檔案清單 + 內容雜湊),用來證明「啟動不寫任何檔」
 *   - 共用向量檔 contracts/fixtures/vault-pointer-vectors.json 的型別與讀取
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const VECTORS_PATH = join(REPO_ROOT, 'contracts/fixtures/vault-pointer-vectors.json');

export const VAULT_ID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const VAULT_ID_B = '11111111-2222-4333-8444-555555555555';

export type StartReason = 'pointer-missing' | 'pointer-unreadable' | 'learning-dir-missing' | 'marker-mismatch' | 'ok';
export const START_REASONS: StartReason[] = ['pointer-missing', 'pointer-unreadable', 'learning-dir-missing', 'marker-mismatch', 'ok'];

export interface Sandbox {
  /** mkdtemp 出來、realpath 過的父目錄 */
  parent: string;
  home: string;
  /** 這個沙箱的 XDG_CONFIG_HOME */
  xdg: string;
  /** 一個存在的 learning 目錄(<LEARNING>) */
  learning: string;
  /** probe 的工作目錄(<RELATIVE> 相對於它) */
  cwd: string;
  /** probe 的 TMPDIR:程式若偷偷寫暫存檔,會落在沙箱快照裡 */
  tmp: string;
  /** 一定不存在的絕對路徑(<MISSING>) */
  missing: string;
  /** 指標檔路徑:`<xdg>/llm-learning-cards/vault.json` */
  pointer: string;
  /** 身分標記路徑:`<learning>/config/vault-id` */
  marker: string;
  cleanup(): void;
}

const live: Sandbox[] = [];

export function makeSandbox(): Sandbox {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'lc-root-')));
  const home = join(parent, 'home');
  const xdg = join(parent, 'xdg');
  const learning = join(parent, 'learning');
  const cwd = join(parent, 'cwd');
  const tmp = join(parent, 'tmp');
  for (const d of [home, xdg, learning, cwd, tmp]) mkdirSync(d, { recursive: true });
  const sb: Sandbox = {
    parent,
    home,
    xdg,
    learning,
    cwd,
    tmp,
    missing: join(parent, 'missing-learning'),
    pointer: join(xdg, 'llm-learning-cards', 'vault.json'),
    marker: join(learning, 'config', 'vault-id'),
    cleanup() {
      // 可能被 chmod 000 過;先改回來才刪得掉
      try {
        chmodSync(sb.pointer, 0o600);
      } catch {
        /* 不存在就算了 */
      }
      try {
        chmodSync(sb.marker, 0o600);
      } catch {
        /* 不存在就算了 */
      }
      rmSync(parent, { recursive: true, force: true });
      const at = live.indexOf(sb);
      if (at >= 0) live.splice(at, 1);
    },
  };
  live.push(sb);
  return sb;
}

export function cleanupAllSandboxes(): void {
  for (const sb of [...live]) sb.cleanup();
}

export function writePointerRaw(sb: Sandbox, raw: string): void {
  mkdirSync(join(sb.xdg, 'llm-learning-cards'), { recursive: true });
  writeFileSync(sb.pointer, raw);
}

export function writePointer(sb: Sandbox, learningDir: string, vaultId: string): void {
  writePointerRaw(sb, JSON.stringify({ learning_dir: learningDir, vault_id: vaultId }));
}

export function writeMarker(sb: Sandbox, text: string): void {
  mkdirSync(join(sb.learning, 'config'), { recursive: true });
  writeFileSync(sb.marker, text);
}

/** 一個標準的「全部正常」沙箱:指標指向 learning,標記相符。 */
export function okSandbox(): Sandbox {
  const sb = makeSandbox();
  writePointer(sb, sb.learning, VAULT_ID_A);
  writeMarker(sb, `${VAULT_ID_A}\n`);
  return sb;
}

/** 讓某個已存在的 learning 根(測試自己建的)成為「唯一來源」指到的根。回傳要給 probe 的環境變數。 */
export interface RootPointerBox {
  env: Record<string, string>;
  cleanup(): void;
}

export function pointerForRoot(root: string): RootPointerBox {
  const sb = makeSandbox();
  writePointer(sb, root, VAULT_ID_A);
  // 標記寫進那個根的 config/(只有測試寫;桌面程式只讀)
  const markerDir = join(root, 'config');
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(markerDir, 'vault-id'), `${VAULT_ID_A}\n`);
  return { env: { XDG_CONFIG_HOME: sb.xdg, HOME: sb.home }, cleanup: () => sb.cleanup() };
}

// ---------------------------------------------------------------- 快照

export interface SnapshotEntry {
  type: 'file' | 'dir' | 'symlink' | 'other';
  /** 檔案內容的 sha256;其他種類是 symlink 目標或空字串 */
  digest: string;
  mode: number;
}

export type Snapshot = Map<string, SnapshotEntry>;

function walk(base: string, dir: string, out: Snapshot): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative(base, full);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      out.set(rel, { type: 'symlink', digest: readlinkSync(full), mode: st.mode & 0o7777 });
    } else if (st.isDirectory()) {
      out.set(rel, { type: 'dir', digest: '', mode: st.mode & 0o7777 });
      walk(base, full, out);
    } else if (st.isFile()) {
      let digest = 'unreadable';
      try {
        digest = createHash('sha256').update(readFileSync(full)).digest('hex');
      } catch {
        /* chmod 000 的指標檔:雜湊不了就標 unreadable,模式還是會比 */
      }
      out.set(rel, { type: 'file', digest, mode: st.mode & 0o7777 });
    } else {
      out.set(rel, { type: 'other', digest: '', mode: st.mode & 0o7777 });
    }
  }
}

/** 一整棵目錄的檔案清單 + 內容雜湊 + 模式。目錄不存在也是合法的快照(空)。 */
export function snapshotTree(dir: string): Snapshot {
  const out: Snapshot = new Map();
  try {
    walk(dir, dir, out);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return out;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const [path, entry] of after) {
    const old = before.get(path);
    if (!old) problems.push(`新增: ${path}`);
    else if (old.type !== entry.type || old.digest !== entry.digest) problems.push(`內容變了: ${path}`);
    else if (old.mode !== entry.mode) problems.push(`模式變了: ${path}`);
  }
  for (const path of before.keys()) if (!after.has(path)) problems.push(`消失: ${path}`);
  return problems;
}

/** 沙箱整個父目錄(HOME、XDG、learning、cwd 全在裡面)的快照。 */
export function snapshotSandbox(sb: Sandbox): Snapshot {
  return snapshotTree(sb.parent);
}

// ---------------------------------------------------------------- 共用向量

export interface PointerPathRow {
  env: Record<string, string>;
  home: string;
  expect: string;
  why: string;
}
export interface MarkerCompareRow {
  marker_text: string;
  vault_id: string;
  expect: 'equal' | 'not-equal';
  why: string;
}
export interface PointerContentRow {
  raw: string;
  expect: 'ok' | 'unreadable';
  why: string;
  learning_dir?: string;
  vault_id?: string;
}
export type PointerSpec =
  | { kind: 'absent' }
  | { kind: 'io-error' }
  | { kind: 'raw'; raw: string }
  | { kind: 'json'; learning_dir: string; vault_id: string };
export type MarkerSpec = { kind: 'absent' } | { kind: 'io-error' } | { kind: 'text'; text: string };
export interface StateRow {
  pointer: PointerSpec;
  marker: MarkerSpec;
  expect: StartReason;
  why: string;
  decoy_learning_dir_with_valid_marker?: boolean;
  extra_env?: Record<string, string>;
}
export interface PointerVectors {
  description: string;
  reasons: StartReason[];
  pointer_path: PointerPathRow[];
  marker_compare: MarkerCompareRow[];
  pointer_content: PointerContentRow[];
  states: StateRow[];
}

export function loadPointerVectors(): PointerVectors {
  return JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as PointerVectors;
}

/** 向量檔的固定指紋:列數與 sha256。有人偷偷加列或刪列,這個測試會紅(工單驗收 2:不得自己新增或略過任何一列)。 */
export const VECTORS_SHA256 = '4f22dc2a8062686e69ebcfd4f770f1d4ac0103571acba9988a838288c4bbbd96';
export const VECTORS_ROW_COUNTS = { pointer_path: 3, marker_compare: 19, pointer_content: 11, states: 14 } as const;
export const VECTORS_TOTAL_ROWS = 47;

export function vectorsFingerprint(): { sha256: string; counts: Record<string, number>; total: number } {
  const v = loadPointerVectors();
  const counts = {
    pointer_path: v.pointer_path.length,
    marker_compare: v.marker_compare.length,
    pointer_content: v.pointer_content.length,
    states: v.states.length,
  };
  return {
    sha256: createHash('sha256').update(readFileSync(VECTORS_PATH)).digest('hex'),
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

/**
 * 把一列 states 向量在沙箱裡擺出來。回傳要給 probe 的額外環境變數。
 * <LEARNING> = sb.learning(存在);<MISSING> = sb.missing(不存在);<RELATIVE> = 相對 sb.cwd 到 sb.learning 的路徑。
 * io-error = 檔案存在但讀不了:chmod 000(以 root 跑時讀得了,呼叫端要檢查 canReadDespiteChmod)。
 */
export function arrangeStateRow(sb: Sandbox, row: StateRow): Record<string, string> {
  const sub = (s: string): string =>
    s.replaceAll('<LEARNING>', sb.learning).replaceAll('<MISSING>', sb.missing).replaceAll('<RELATIVE>', relative(sb.cwd, sb.learning));
  const p = row.pointer;
  if (p.kind === 'raw') writePointerRaw(sb, p.raw);
  else if (p.kind === 'json') writePointer(sb, sub(p.learning_dir), p.vault_id);
  else if (p.kind === 'io-error') {
    writePointer(sb, sb.learning, VAULT_ID_A);
    chmodSync(sb.pointer, 0o000);
  }
  const m = row.marker;
  if (m.kind === 'text') writeMarker(sb, m.text);
  else if (m.kind === 'io-error') {
    writeMarker(sb, `${VAULT_ID_A}\n`);
    chmodSync(sb.marker, 0o000);
  }
  if (row.decoy_learning_dir_with_valid_marker) writeMarker(sb, `${VAULT_ID_A}\n`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.extra_env ?? {})) env[k] = sub(v);
  return env;
}

/** chmod 000 對這個行程有沒有用(root 不受限)。沒用的話 io-error 列沒辦法擺,呼叫端要明說而不是靜默略過。 */
export function chmodZeroIsEffective(): boolean {
  const sb = makeSandbox();
  try {
    const f = join(sb.parent, 'probe-chmod');
    writeFileSync(f, 'x');
    chmodSync(f, 0o000);
    try {
      readFileSync(f);
      return false;
    } catch {
      return true;
    }
  } finally {
    sb.cleanup();
  }
}
