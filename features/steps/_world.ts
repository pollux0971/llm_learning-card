import { setWorldConstructor, World, IWorldOptions, Before, After } from '@cucumber/cucumber';
import { readFileSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** repo 根目錄(features/steps/ 的上兩層) */
export const ROOT = resolve(import.meta.dirname, '../..');

/**
 * cucumber 本身用 NODE_OPTIONS=--import=tsx 啟動(ADR-033)。這個變數會被子程序繼承,
 * 但 standalone.json 的指令是「使用者自己在 shell 打的東西」,不該被 cucumber 的載入器
 * 汙染環境——子程序若解析不到 tsx 的位置會假紅,而且跟使用者手動執行的環境不一致。
 * runCommand / startDevServer 一律用這份乾淨的 env。
 */
function withoutNodeOptions(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_OPTIONS, ...rest } = env;
  return rest;
}

type Manifest = Record<string, { cmd: string; interactive: boolean; expect?: string }>;

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr,方便「it prints …」類的斷言 */
  output: string;
}

/**
 * 所有步驟共用的狀態容器。
 *
 * 三個原則:
 * 1. 每個 scenario 一個新的 World,不共用狀態
 * 2. 需要寫入的 fixture 一律複製到暫存目錄再動,絕不修改 contracts/fixtures/
 * 3. lastResult 存放 When 的產出,Then 從這裡斷言
 *
 * 通用步驟(features/steps/common.steps.ts)只讀寫這裡的欄位;各功能的步驟檔負責填值。
 */
export class LearningWorld extends World {
  /** 暫存的 learning 目錄,由 useFixture 建立 */
  dir?: string | undefined;
  /** 測試裡的「今天」,預設 2026-09-10 以配合 mid-cycle fixture */
  today = '2026-09-10';
  /** 最近一次 When 的結果,型別由各步驟自己收斂 */
  lastResult: unknown;
  /**
   * 給通用步驟「the result is X」比對用的文字。
   * 當 lastResult 不是原始值時,When 步驟可以直接設這個欄位,省得通用步驟猜。
   */
  resultText?: string | undefined;
  /** 最近一次拋出的錯誤,給「應該失敗」的場景用 */
  lastError?: Error | undefined;
  /** FakeLlmRouter 記錄的呼叫,用來斷言「沒有呼叫模型」 */
  llmCalls: { task: string; prompt: string }[] = [];
  /** 任何對外網路請求的記錄(fake adapter 推進來),用來斷言「沒有網路請求」 */
  networkRequests: string[] = [];
  /** 通用步驟「a fake router replaying the recorded fixtures」設 true;各功能的 When 自己建 FakeLlmRouter */
  useFakeRouter = false;
  /** 最近一次外部指令(standalone / dev server)的結果 */
  lastRun?: RunResult;
  /** 目前 scenario 所屬 feature 的 tags(Before hook 填) */
  tags: string[] = [];
  /** 通用步驟載入的卡片原文(Given a card with three example fences …) */
  cardText?: string;
  /** 純函式檢查用:呼叫前的輸入物件參照與深拷貝,見 trackInput */
  inputRef?: unknown;
  inputSnapshot?: string;
  /**
   * 「重跑不改變卡片數」類場景的共用快照欄位:第一次跑完後記下卡片數,
   * 「the number of cards is unchanged」這個共用 Then 步驟讀這裡比對,不管是
   * 哪個功能的 Given/When 填的值(見 ingest.steps.ts 與 i1-content-pipeline.steps.ts)。
   */
  cardCountBefore?: number;

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** 把一份唯讀 fixture 複製到暫存目錄,回傳新路徑 */
  useFixture(name: string): string {
    const src = join(ROOT, 'contracts/fixtures', name);
    const dst = mkdtempSync(join(tmpdir(), 'lc-'));
    cpSync(src, dst, { recursive: true });
    this.dir = dst;
    return dst;
  }

  /** 直接讀 fixture,不複製。只用於不會被修改的情況 */
  readFixture(relPath: string): string {
    return readFileSync(join(ROOT, 'contracts/fixtures', relPath), 'utf8');
  }

  /** 讀暫存目錄裡的檔案 */
  read(relPath: string): string {
    if (!this.dir) throw new Error('尚未呼叫 useFixture');
    return readFileSync(join(this.dir, relPath), 'utf8');
  }

  /** 純函式檢查:在呼叫被測函式之前記下輸入,之後用「the original object is unchanged」斷言 */
  trackInput<T>(input: T): T {
    this.inputRef = input;
    this.inputSnapshot = JSON.stringify(input);
    return input;
  }

  /** 由 feature 檔的 tag 推出 standalone.json 的 key,例如 @scheduler → 04-scheduler */
  standaloneKey(): string {
    const manifest = this.manifest();
    for (const t of this.tags) {
      const name = t.replace(/^@/, '');
      const hit = Object.keys(manifest).find((k) => k.endsWith(`-${name}`));
      if (hit) return hit;
    }
    throw new Error(`從 tags ${this.tags.join(' ')} 推不出 standalone.json 的 key`);
  }

  manifest(): Manifest {
    return JSON.parse(readFileSync(join(ROOT, 'standalone.json'), 'utf8')) as Manifest;
  }

  /** 同步執行一個 shell 指令(cwd = repo 根),結果放進 lastRun 並回傳 */
  runCommand(cmd: string, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): RunResult {
    const r = spawnSync(cmd, {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 120_000,
      env: { ...withoutNodeOptions(process.env), ...opts.env },
    });
    const stdout = r.stdout ?? '';
    const stderr = r.stderr ?? '';
    this.lastRun = { status: r.error ? null : r.status, stdout, stderr, output: stdout + stderr };
    return this.lastRun;
  }

  /** 跑 standalone.json 裡某個 key 的指令。不給 key 就由 tags 推 */
  runStandalone(key?: string, extraArgs = ''): RunResult {
    const k = key ?? this.standaloneKey();
    const entry = this.manifest()[k];
    if (!entry) throw new Error(`standalone.json 裡沒有 ${k}`);
    if (entry.interactive) throw new Error(`${k} 是互動式指令,用 startDevServer`);
    return this.runCommand(extraArgs ? `${entry.cmd} ${extraArgs}` : entry.cmd);
  }

  /**
   * 啟動互動式指令(dev server),等到輸出出現 ready 字樣或逾時,然後關掉。
   * 結果放進 lastRun:status 0 表示有看到 ready 字樣。
   */
  async startDevServer(key?: string, opts: { readyPattern?: RegExp; timeoutMs?: number } = {}): Promise<RunResult> {
    const k = key ?? this.standaloneKey();
    const entry = this.manifest()[k];
    if (!entry) throw new Error(`standalone.json 裡沒有 ${k}`);
    const ready = opts.readyPattern ?? /localhost:\d+|Local:|ready in/i;
    const timeoutMs = opts.timeoutMs ?? 60_000;

    return new Promise<RunResult>((resolveRun) => {
      const child = spawn(entry.cmd, { cwd: ROOT, shell: true, env: withoutNodeOptions(process.env), detached: true });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (status: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* 已經結束 */ }
        this.lastRun = { status, stdout, stderr, output: stdout + stderr };
        resolveRun(this.lastRun);
      };
      const check = () => { if (ready.test(stdout + stderr)) finish(0); };
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); check(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); check(); });
      child.on('exit', (code) => finish(code ?? 1));
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  cleanup(): void {
    if (this.dir && existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true });
    this.dir = undefined;
  }
}

setWorldConstructor(LearningWorld);

Before(function (this: LearningWorld, { pickle }) {
  this.llmCalls = [];
  this.networkRequests = [];
  this.lastError = undefined;
  this.lastResult = undefined;
  this.resultText = undefined;
  this.useFakeRouter = false;
  this.tags = pickle.tags.map((t) => t.name);
});

After(function (this: LearningWorld) {
  this.cleanup();
});
