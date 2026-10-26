/**
 * check:all 的鏈輸出 wrapper(T3 B3')。
 *
 * consumer 自己的檔,沒有 SOURCE 標頭。scripts/check-all.ts 是模板,一個位元組都不能改;
 * 這支只在 stderr 印機器狀態,再用絕對路徑起動它。測試的 cwd 是空的、不在 git 工作樹裡,
 * 不能 `--import tsx`(那會靠 cwd 解析套件名)。
 *
 * 匯出的 runWrapped 不自己 process.exit,intervalMs 不設下限。CLI 才讀 CHAIN_ENV_SAMPLE_MS。
 */
import { spawn } from 'node:child_process';
import { availableParallelism, constants, hostname, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_DEFAULT_MS = 30_000;
const SAMPLE_MIN_MS = 100;
const SAMPLE_MAX_MS = 3_600_000;

export interface WrappedCommand {
  command: string;
  args: readonly string[];
  /** 取樣間隔(毫秒)。函式裡不設上下限;CLI 才拒絕範圍外或非整數。 */
  intervalMs: number;
}

function workersField(): string {
  const raw = process.env.VITEST_MAX_WORKERS;
  if (raw === undefined || raw === '') return 'default';
  return raw;
}

function formatLoadPart(n: number): string {
  return n.toFixed(2);
}

function formatLoad(): string {
  const [one, five, fifteen] = loadavg() as [number, number, number];
  return `${formatLoadPart(one)}/${formatLoadPart(five)}/${formatLoadPart(fifteen)}`;
}

function envLine(kind: 'start' | 'end' | 'sample'): string {
  return `[chain-env] ${kind} host=${hostname()} cores=${availableParallelism()} workers=${workersField()} load=${formatLoad()} time=${new Date().toISOString()}`;
}

function writeEnv(kind: 'start' | 'end' | 'sample'): void {
  process.stderr.write(`${envLine(kind)}\n`);
}

function signalNumber(signal: NodeJS.Signals): number {
  return constants.signals[signal];
}

/**
 * 起動被包指令(stdio inherit,一個位元組都不經手),印起跑行、按 intervalMs 取樣、
 * 子行程結束後清計時器、印結束行、resolve 退出碼。被訊號殺掉 = 128 + 訊號編號。
 * 起不來 = 127,仍印結束行。收到 SIGINT / SIGTERM 轉給子行程,自己不退,等它結束。
 */
export function runWrapped({ command, args, intervalMs }: WrappedCommand): Promise<number> {
  writeEnv('start');
  let running = true;
  const timer = setInterval(() => {
    if (running) writeEnv('sample');
  }, intervalMs);

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });

    const forward = (sig: NodeJS.Signals): void => {
      child.kill(sig);
    };

    const onSignal = (sig: NodeJS.Signals): void => {
      forward(sig);
    };

    const detach = (): void => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };

    const finish = (code: number): void => {
      if (!running) return;
      running = false;
      clearInterval(timer);
      detach();
      writeEnv('end');
      resolve(code);
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    child.on('error', (err: Error) => {
      process.stderr.write(`起不來 ${command}: ${err.message}\n`);
      finish(127);
    });

    child.on('close', (code, signal) => {
      if (signal) {
        finish(128 + signalNumber(signal));
        return;
      }
      finish(code ?? 1);
    });
  });
}

function rejectSampleMs(raw: string): never {
  process.stderr.write(`CHAIN_ENV_SAMPLE_MS 必須是 ${SAMPLE_MIN_MS} 到 ${SAMPLE_MAX_MS} 的純十進位整數(無前導零、無空白),收到 ${JSON.stringify(raw)}\n`);
  process.exit(2);
}

function sampleIntervalMs(): number {
  const raw = process.env.CHAIN_ENV_SAMPLE_MS;
  if (raw === undefined) return SAMPLE_DEFAULT_MS;
  if (!/^[1-9]\d*$/.test(raw)) rejectSampleMs(raw);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < SAMPLE_MIN_MS || n > SAMPLE_MAX_MS) rejectSampleMs(raw);
  return n;
}

/** 子行程參數:tsx cli、check-all.ts,再加上 argv 從第 3 個起(node 與本腳本路徑不轉發)。 */
export function childArgs(tsxCli: string, checkAll: string, argv: readonly string[]): string[] {
  return [tsxCli, checkAll, ...argv.slice(2)];
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

async function main(): Promise<void> {
  const intervalMs = sampleIntervalMs();
  // 絕對路徑:測試 cwd 是空目錄,不能靠 cwd 解析 tsx。
  const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
  const checkAll = fileURLToPath(new URL('./check-all.ts', import.meta.url));
  const code = await runWrapped({
    command: process.execPath,
    args: childArgs(tsxCli, checkAll, process.argv),
    intervalMs,
  });
  process.exit(code);
}

if (isDirectRun()) {
  void main().then(undefined, (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`wrapper 失敗: ${message}\n`);
    process.exit(1);
  });
}
