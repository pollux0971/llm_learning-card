/**
 * cucumber 用的邊界:webview 端真的 LearningFs,只把 Tauri 的 invoke 換成「叫 probe」(T2c-1,測試 agent 寫的)。
 *
 * 取代 T2b 的 `apps/desktop/src/boundary.ts`(那份在 Node 裡自己 recordEvent;ADR-069 之後由 Rust 寫事件)。
 * 這樣 cucumber 走的是:webview 的 TS 轉接(參數名、錯誤類別) → probe → 跟 command 同一個 learning_fs 函式。
 * 被拒絕或 io 錯誤時丟出的是 webview 模組自己的 PathRefusedError / LearningIoError。
 */
import { join } from 'node:path';
import { runProbe, type FsCall, type ProbeResponse, type ShimOptions } from './probe.js';
import { loadWebviewLearningFs, type InvokeFn, type WebviewLearningFs, type WebviewLearningFsModule } from './webview-learning-fs.js';

export interface BoundaryResult {
  ok: boolean;
  refused: boolean;
  value?: unknown;
  fsCalls: FsCall[];
  checked?: string;
  error?: ProbeResponse['error'];
  resp?: ProbeResponse;
}

function toResult(resp: ProbeResponse): BoundaryResult {
  const out: BoundaryResult = {
    ok: resp.ok,
    refused: resp.refused,
    fsCalls: resp.fsCalls ?? [],
    error: resp.error ?? null,
    resp,
  };
  if (resp.value !== null && resp.value !== undefined) out.value = resp.value;
  if (typeof resp.checked === 'string') out.checked = resp.checked;
  return out;
}

export class ProbeBoundary {
  readonly root: string;
  readonly logPath: string;
  readonly mod: WebviewLearningFsModule;
  private readonly fs: WebviewLearningFs;
  private current: BoundaryResult = { ok: false, refused: false, fsCalls: [] };
  /** 下一次 probe 呼叫要掛的 shim(用一次就清掉)。 */
  shimNext: ShimOptions | undefined;
  lastTrace: ReturnType<typeof runProbe>['trace'] = [];

  constructor(root: string, mod: WebviewLearningFsModule) {
    this.root = root;
    this.logPath = join(root, 'state', 'log.jsonl');
    this.mod = mod;
    this.fs = mod.createLearningFs({ invoke: this.invoke, os: 'linux' });
  }

  private probe(body: Record<string, unknown>): ProbeResponse {
    const shim = this.shimNext;
    this.shimNext = undefined;
    const run = runProbe(body, shim);
    this.lastTrace = run.trace;
    this.current = toResult(run.resp);
    return run.resp;
  }

  /** Tauri 的 invoke 換成 probe;參數名照 command(relPath / relDir / content)。 */
  private readonly invoke: InvokeFn = async (cmd, args = {}) => {
    const path = cmd === 'list' ? args.relDir : args.relPath;
    if (typeof path !== 'string') {
      throw new Error(`invoke(${cmd}) 沒有字串參數 ${cmd === 'list' ? 'relDir' : 'relPath'}: ${JSON.stringify(args)}`);
    }
    if (!['read', 'write', 'list', 'exists'].includes(cmd)) throw new Error(`未知的 command ${cmd}`);
    const body: Record<string, unknown> = { op: cmd, root: this.root, path };
    if (cmd === 'write') body.content = args.content;
    const resp = this.probe(body);
    if (resp.error) throw resp.error;
    if (!resp.ok) throw new Error(`probe 回 ok=false 卻沒有 error: ${JSON.stringify(resp)}`);
    return resp.value ?? null;
  };

  last(): BoundaryResult {
    return this.current;
  }

  read(relPath: string): Promise<string> {
    return this.fs.read(relPath);
  }

  write(relPath: string, content: string): Promise<void> {
    return this.fs.write(relPath, content);
  }

  list(relDir: string): Promise<string[]> {
    return this.fs.list(relDir);
  }

  exists(relPath: string): Promise<boolean> {
    return this.fs.exists(relPath);
  }

  assetUrl(relPath: string): string {
    this.current = { ok: false, refused: false, fsCalls: [] };
    try {
      const url = this.fs.assetUrl(relPath);
      this.current = { ok: true, refused: false, fsCalls: [] };
      return url;
    } catch (err) {
      this.current = { ok: false, refused: this.isRefusal(err), fsCalls: [] };
      throw err;
    }
  }

  /** lc protocol:encodedRel 是 URL path 拿掉一個 `/`、還沒解碼的字串。 */
  requestAsset(encodedRel: string): BoundaryResult {
    this.probe({ op: 'asset', root: this.root, path: encodedRel });
    return this.current;
  }

  assetSequence(requests: { at: number; path: string }[], endAt: number | null): ProbeResponse {
    return this.probe({ op: 'asset-sequence', root: this.root, requests, endAt });
  }

  segment(seg: string): ProbeResponse {
    return this.probe({ op: 'segment', path: seg });
  }

  isRefusal(err: unknown): boolean {
    return err instanceof this.mod.PathRefusedError;
  }

  isIoError(err: unknown): boolean {
    return err instanceof this.mod.LearningIoError;
  }
}

export async function openProbeBoundary(root: string): Promise<ProbeBoundary> {
  return new ProbeBoundary(root, await loadWebviewLearningFs());
}
