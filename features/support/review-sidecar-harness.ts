/**
 * T22(複習側車)紅測試的共用量尺:在暫存目錄上起**真的** `scripts/review-sidecar.ts` 子行程,
 * 一行一則 JSON 地跟它講話(stdin / stdout),查它留在磁碟上的東西與 stderr。
 *
 * 這裡只有「佈置」與「觀測」,沒有側車邏輯:不組回應、不判斷 kind。預期值由測試自己從工單與 protocol 向量寫死。
 * 純輔助模組(沒有 vitest / cucumber 相依):vitest 與步驟檔都可以 import。
 *
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp,見 review-session-harness.ts),不碰真的 learning/ 與真的 ~/.cache。
 * 子行程的網路層是假的(`_fake-review-cloud.mjs`,由 `LC_REVIEW_FAKE_CLOUD` 在啟動時載入),不打真網路、不花錢。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join, resolve } from 'node:path';
import { childEnv, runCwd, TODAY, type Vault } from './review-session-harness.js';

const ROOT = resolve(import.meta.dirname, '../..');
const TSX_LOADER = join(ROOT, 'node_modules/tsx/dist/esm/index.mjs');
export const SIDECAR_SCRIPT = join(ROOT, 'scripts/review-sidecar.ts');
export const FAKE_CLOUD_MODULE = join(ROOT, 'features/steps/_fake-review-cloud.mjs');

export interface SpawnOpts {
  /** `LC_REVIEW_FAKE_CLOUD`:預設假雲端;`null` = 不設(側車走 live 路徑,測試不能真的呼叫它) */
  fakeCloud?: string | null;
  /** `LC_REVIEW_TODAY`:預設 TODAY;`null` = 不設(側車用本機日期) */
  today?: string | null;
  /** 額外覆蓋子行程環境;undefined = 刪掉那個變數 */
  env?: Record<string, string | undefined>;
  /** `--dir`:預設 vault.dir;`null` = 不帶 */
  dir?: string | null;
}

export interface Sidecar {
  child: ChildProcessWithoutNullStreams;
  /** stdout 已收到的完整行(只用 `\n` 切;不含換行) */
  stdoutLines: string[];
  /** stdout 目前收到、還沒收到換行的尾巴 */
  stdoutTail(): string;
  stderr(): string;
  /** 等下一行 stdout(超過 timeout 回 undefined) */
  nextLine(timeoutMs?: number): Promise<string | undefined>;
  /** 送一則請求(物件會 JSON.stringify,加 `\n`),回傳下一行的解析結果 */
  call(request: unknown, timeoutMs?: number): Promise<Record<string, unknown>>;
  /** 原樣寫進 stdin(不加換行) */
  writeRaw(text: string): void;
  /** 關 stdin(EOF) */
  endStdin(): void;
  /** 等行程結束;回退出碼(超時回 'timeout') */
  exited(timeoutMs?: number): Promise<number | null | 'timeout'>;
  isAlive(): boolean;
  kill(): void;
}

export function spawnSidecar(vault: Vault, opts: SpawnOpts = {}): Sidecar {
  const over: Record<string, string | undefined> = { ...(opts.env ?? {}) };
  const fake = opts.fakeCloud === undefined ? FAKE_CLOUD_MODULE : opts.fakeCloud;
  if (fake !== null) over['LC_REVIEW_FAKE_CLOUD'] = fake;
  else over['LC_REVIEW_FAKE_CLOUD'] = undefined;
  const today = opts.today === undefined ? TODAY : opts.today;
  if (today !== null) over['LC_REVIEW_TODAY'] = today;
  else over['LC_REVIEW_TODAY'] = undefined;
  const dir = opts.dir === undefined ? vault.dir : opts.dir;
  const args = ['--import', TSX_LOADER, SIDECAR_SCRIPT, ...(dir === null ? [] : ['--dir', dir])];
  const child = spawn(process.execPath, args, { cwd: runCwd(vault), env: childEnv(vault, over), stdio: ['pipe', 'pipe', 'pipe'] });

  const stdoutLines: string[] = [];
  let tail = '';
  let stderrText = '';
  let consumed = 0;
  let waiter: (() => void) | undefined;
  let exitCode: number | null | undefined;
  const wake = (): void => {
    const w = waiter;
    waiter = undefined;
    w?.();
  };
  child.stdout.on('data', (chunk: Buffer) => {
    tail += chunk.toString('utf8');
    let at = tail.indexOf('\n');
    while (at >= 0) {
      stdoutLines.push(tail.slice(0, at));
      tail = tail.slice(at + 1);
      at = tail.indexOf('\n');
    }
    wake();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString('utf8');
  });
  child.stdin.on('error', () => {
    /* 子行程先結束了,寫入失敗不是這裡要報的 */
  });
  child.on('close', (code) => {
    exitCode = code;
    wake();
  });

  const nextLine = async (timeoutMs = 30_000): Promise<string | undefined> => {
    const deadline = Date.now() + timeoutMs;
    while (consumed >= stdoutLines.length) {
      if (exitCode !== undefined) return undefined;
      const left = deadline - Date.now();
      if (left <= 0) return undefined;
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(() => {
          waiter = undefined;
          resolveWait();
        }, left);
        waiter = () => {
          clearTimeout(timer);
          resolveWait();
        };
      });
    }
    const line = stdoutLines[consumed];
    consumed += 1;
    return line;
  };

  return {
    child,
    stdoutLines,
    stdoutTail: () => tail,
    stderr: () => stderrText,
    nextLine,
    async call(request, timeoutMs) {
      child.stdin.write(`${typeof request === 'string' ? request : JSON.stringify(request)}\n`);
      const line = await nextLine(timeoutMs);
      if (line === undefined) throw new Error(`側車沒有回應(stderr:${stderrText.slice(-400)})`);
      return JSON.parse(line) as Record<string, unknown>;
    },
    writeRaw: (text) => {
      child.stdin.write(text);
    },
    endStdin: () => {
      child.stdin.end();
    },
    exited: async (timeoutMs = 15_000) => {
      if (exitCode !== undefined) return exitCode;
      return await new Promise<number | null | 'timeout'>((resolveExit) => {
        const timer = setTimeout(() => resolveExit('timeout'), timeoutMs);
        child.once('close', (code) => {
          clearTimeout(timer);
          resolveExit(code);
        });
      });
    },
    isAlive: () => exitCode === undefined,
    kill: () => {
      if (exitCode === undefined) child.kill('SIGKILL');
    },
  };
}

/** 送出 `{v:1,id,method,params}` 並回傳解析後的回應物件。id 由呼叫端給(測試自己管遞增)。 */
export async function request(proc: Sidecar, id: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return await proc.call({ v: 1, id, method, params });
}
