/**
 * check:all 的鏈輸出 wrapper(T3 B3')。
 *
 * consumer 自己的檔,沒有 SOURCE 標頭。scripts/check-all.ts 是模板,一個位元組都不能改;
 * 這支只在 stderr 印機器狀態,再用絕對路徑起動它。測試的 cwd 是空的、不在 git 工作樹裡,
 * 不能 `--import tsx`(那會靠 cwd 解析套件名)。
 *
 * 匯出的 runWrapped 不自己 process.exit,intervalMs 不設下限。CLI 才讀 CHAIN_ENV_SAMPLE_MS。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { availableParallelism, constants, hostname, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_DEFAULT_MS = 30_000;
const SAMPLE_MIN_MS = 100;

export interface WrappedCommand {
  command: string;
  args: readonly string[];
  /** 取樣間隔(毫秒)。函式裡不設下限;CLI 才拒絕 < 100 或非整數。 */
  intervalMs: number;
}

function workersField(): string {
  const raw = process.env.VITEST_MAX_WORKERS;
  if (raw === undefined || raw === '') return 'default';
  return raw;
}

function formatLoadPart(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return '0';
  // 避免 1e-7 這種科學記號,regex 要的是 1.23 形式。
  return n.toFixed(2);
}

function formatLoad(): string {
  const [one, five, fifteen] = loadavg();
  return `${formatLoadPart(one)}/${formatLoadPart(five)}/${formatLoadPart(fifteen)}`;
}

function envLine(kind: 'start' | 'end' | 'sample'): string {
  return `[chain-env] ${kind} host=${hostname()} cores=${availableParallelism()} workers=${workersField()} load=${formatLoad()} time=${new Date().toISOString()}`;
}

function writeEnv(kind: 'start' | 'end' | 'sample'): void {
  process.stderr.write(`${envLine(kind)}\n`);
}

function signalNumber(signal: NodeJS.Signals): number {
  const n = constants.signals[signal];
  return typeof n === 'number' ? n : 1;
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
    let child: ChildProcess | undefined;
    let failedToStart = false;
    let pending: NodeJS.Signals | undefined;

    const forward = (sig: NodeJS.Signals): void => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill(sig);
      } catch {
        // ESRCH:子行程已經不見,結束行等 close / error。
      }
    };

    const onSignal = (sig: NodeJS.Signals): void => {
      pending = sig;
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

    child = spawn(command, args, { stdio: 'inherit' });
    if (pending !== undefined) forward(pending);

    child.on('error', (err: Error) => {
      failedToStart = true;
      process.stderr.write(`起不來 ${command}: ${err.message}\n`);
      finish(127);
    });

    child.on('close', (code, signal) => {
      if (failedToStart) {
        finish(127);
        return;
      }
      if (signal) {
        finish(128 + signalNumber(signal));
        return;
      }
      finish(code ?? 1);
    });
  });
}

function rejectSampleMs(raw: string): never {
  process.stderr.write(`CHAIN_ENV_SAMPLE_MS 必須是 >= ${SAMPLE_MIN_MS} 的正整數,收到 ${JSON.stringify(raw)}\n`);
  process.exit(2);
}

function sampleIntervalMs(): number {
  const raw = process.env.CHAIN_ENV_SAMPLE_MS;
  if (raw === undefined) return SAMPLE_DEFAULT_MS;
  if (!/^[1-9]\d*$/.test(raw)) rejectSampleMs(raw);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < SAMPLE_MIN_MS) rejectSampleMs(raw);
  return n;
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
    args: [tsxCli, checkAll, ...process.argv.slice(2)],
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
