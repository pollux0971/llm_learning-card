/**
 * 叫無頭 probe(`src-tauri/target/debug/lc-fs`):一行 JSON 進、一行 JSON 出(T2c-1,測試 agent 寫的)。
 *
 * probe 是開發 worker 寫的 Rust(`src/bin/lc-fs.rs`),呼叫的是跟 Tauri command、lc protocol 同一份 library 函式。
 * 這裡定的是 probe 的 JSON 介面,cucumber 的步驟定義靠它;改欄位名要先回報協調者。
 *
 * 請求(所有 op):
 *   { op: 'read' | 'write' | 'list' | 'exists', root, path, content? }   → 跟 command 同一個 learning_fs 函式
 *   { op: 'asset', root, path }            path = URL path 拿掉一個開頭 `/`、還沒解碼(asset_protocol::respond)
 *   { op: 'asset-sequence', root, requests: [{ at, path }], endAt }
 *        同一個 AssetRefusalLimiter 依序處理每個請求,時鐘 = 某個固定起點 + at 秒;endAt 不是 null 就在那一秒 flush
 *   { op: 'segment', path }                path_guard::check_segment
 *   { op: 'status' } / { op: 'builtin-asset' }   (T2b,不變)
 *
 * T2c-2 起 learning 根目錄只有一個來源(使用者層指標檔),probe 也一樣:
 *   - probe 行程從自己的環境(`XDG_CONFIG_HOME`、`HOME`)找 `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`,
 *     用 library 的 `learning_root::resolve` 解析一次;**請求裡不再有 `root` 欄位**(probe 看到 `root` 要當壞請求)。
 *   - 這裡的 runProbe 為了讓舊的測試好寫,收到 `body.root` 時會自己在暫存目錄寫指標檔與 `config/vault-id`,
 *     把 `root` 從請求拿掉,再用 `XDG_CONFIG_HOME` 指過去。也就是說:給 probe 根目錄的唯一管道是指標檔。
 *   - 五種啟動狀態不是 `ok` 時:read/write/list/exists 回 `ok:false, refused:false, error:{kind:'not-configured'}`
 *     (不是拒絕、不是 io 錯誤、不寫 warning、fsCalls 空);asset 回 status 403(不寫 log)。
 *   新的 op:
 *   { op: 'startup' }
 *        → { ok:true, state: 'pointer-missing'|'pointer-unreadable'|'learning-dir-missing'|'marker-mismatch'|'ok',
 *            root: string|null, pointerPath: string,
 *            view: { text: string },   畫面上整段文字(狀態不是 ok 才有意義)
 *            windows: string[] }       state==='ok' 是 ['teach','test'],其他狀態是 []
 *        什麼檔都不寫(不建目錄、不碰指標檔、不碰 config/vault-id、不建 state/)。
 *   { op: 'session', requests: [{ kind: 'read' | 'asset', path }] }
 *        → 一次 resolve,之後 command 與 lc 協定都吃同一份結果(跟 main.rs 的 Tauri state 一樣)。
 *          { state, root, results: [{ kind, ok, status?, bodyHex?, valueText?, error?, fsCalls }] }
 *   { op: 'pointer-path', xdg: string|null, home }        → { ok:true, value: <路徑字串> }
 *   { op: 'marker-compare', markerText, vaultId }          → { ok:true, value: 'equal'|'not-equal' }
 *   { op: 'pointer-parse', raw }                           → { ok:true, value: 'ok'|'unreadable', learningDir?, vaultId? }
 *   後三個是純函式,不讀環境。
 * 回應:
 *   ok、refused、error(command 回給 webview 的同一個錯誤 JSON,成功是 null)、value、fsCalls、checked
 *   asset 另有 status、headers(名字一律小寫)、bodyHex;asset-sequence 回 responses: [{ status }]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSyscallShim } from './syscall-shim.js';
import { pointerForRoot } from './learning-root-sandbox.js';

export const LC_FS_BIN = join(import.meta.dirname, '../../src-tauri/target/debug/lc-fs');

export interface FsCall {
  op: string;
  path: string;
}

/** command 的錯誤在邊界上的形狀。 */
export interface WireError {
  kind: 'refused' | 'io' | 'not-configured';
  reason?: string;
  code?: string;
  errno?: number;
  [k: string]: unknown;
}

export interface ProbeResponse {
  ok: boolean;
  refused: boolean;
  error?: WireError | null;
  value?: unknown;
  fsCalls?: FsCall[];
  rustLog?: string[];
  checked?: string | null;
  status?: number;
  headers?: Record<string, string>;
  bodyHex?: string;
  responses?: { status: number }[];
  [k: string]: unknown;
}

export interface ShimOptions {
  /** 要追蹤的目錄(絕對、realpath 過)。 */
  dir: string;
  /** `<call>@<nth>@<ERRNO>`,呼叫名同 atomic-write.vectors.json 的 inject.call。 */
  inject?: string[];
}

export interface TraceEntry {
  call: string;
  fields: Record<string, string>;
}

export interface ProbeRun {
  resp: ProbeResponse;
  trace: TraceEntry[];
  stderr: string;
}

export function parseTrace(text: string): TraceEntry[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [call, ...rest] = line.split('\t');
      const fields: Record<string, string> = {};
      for (const kv of rest) {
        const eq = kv.indexOf('=');
        if (eq > 0) fields[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      return { call: call ?? '', fields };
    });
}

export interface ProbeOptions {
  /** 加在行程環境上;值是 undefined 就是把那個變數拿掉 */
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export function runProbe(body: Record<string, unknown>, shim?: ShimOptions, opts: ProbeOptions = {}): ProbeRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 真環境的指標檔與舊的後門一律不能漏進測試:先清掉,再由呼叫端指定
  delete env.LC_LEARNING_ROOT;
  let pointerBox: { cleanup(): void } | undefined;
  if (typeof body.root === 'string') {
    const box = pointerForRoot(body.root);
    pointerBox = box;
    Object.assign(env, box.env);
    body = { ...body };
    delete body.root;
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  let traceDir: string | undefined;
  let tracePath: string | undefined;
  if (shim) {
    traceDir = mkdtempSync(join(tmpdir(), 'lc-shim-trace-'));
    tracePath = join(traceDir, 'trace.tsv');
    env.LD_PRELOAD = buildSyscallShim();
    env.LC_SHIM_DIR = shim.dir;
    env.LC_SHIM_TRACE = tracePath;
    env.LC_SHIM_INJECT = (shim.inject ?? []).join(',');
  }
  try {
    const r = spawnSync(LC_FS_BIN, { input: JSON.stringify(body), encoding: 'utf8', env, ...(opts.cwd ? { cwd: opts.cwd } : {}) });
    if (r.error) throw r.error;
    const out = (r.stdout ?? '').trim();
    if (!out) {
      throw new Error(`lc-fs 沒有輸出 status=${r.status} op=${String(body.op)}\n${r.stderr}`);
    }
    let resp: ProbeResponse;
    try {
      resp = JSON.parse(out) as ProbeResponse;
    } catch (err) {
      throw new Error(`lc-fs 的輸出不是 JSON op=${String(body.op)}: ${out}\n${(err as Error).message}`);
    }
    let trace: TraceEntry[] = [];
    if (tracePath) {
      try {
        trace = parseTrace(readFileSync(tracePath, 'utf8'));
      } catch {
        trace = [];
      }
    }
    return { resp, trace, stderr: r.stderr ?? '' };
  } finally {
    if (traceDir) rmSync(traceDir, { recursive: true, force: true });
    pointerBox?.cleanup();
  }
}

export function hexToBytes(hex: string): Buffer {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error(`bodyHex 不是十六進位: ${hex.slice(0, 40)}`);
  return Buffer.from(hex, 'hex');
}
