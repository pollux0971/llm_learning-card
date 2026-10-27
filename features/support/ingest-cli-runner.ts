/**
 * T62 紅測試共用:起 `scripts/ingest.ts`(CLI)的小工具,和暫存指標檔(契約 §12:經指標檔與標記驗證過的帳本)。測試 agent 寫;開發 worker 不改。
 * T61 的 CLI 測試與 T62 的 CLI 測試共用這一份,只有一個假雲端(features/steps/_fake-cloud.mjs)。
 *
 * 煞車(顧問 2026-10-27;T62 合併前):不帶 --fake 的 scripts/ingest.ts 只在三件事同時成立時才准起——
 *   (a) 帶 _fake-cloud.mjs(換掉子行程的 globalThis.fetch,不打真網路);
 *   (b) 這個簽出沒有 .env(scripts/_env.ts 會載入 repo 根目錄的 .env;有就丟錯,一個行程都不起);
 *   (c) 子行程的 HOME、XDG_CONFIG_HOME、XDG_CACHE_HOME 都指到這個測試自己建的暫存目錄(不依賴機器上的指標檔)。
 * 子行程的環境變數從零組起(只帶 PATH 與測試要的幾個),真的金鑰一個都帶不進去。
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
const TSX_CLI = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
export const FAKE_CLOUD = join(ROOT, 'features/steps/_fake-cloud.mjs');
const SCRIPT = join(ROOT, 'scripts/ingest.ts');
export const RAW_SRC = join(ROOT, 'contracts/fixtures/raw/security-basics.md');

const tmps: string[] = [];
export function cleanupTmps(): void {
  while (tmps.length > 0) rmSync(tmps.pop()!, { recursive: true, force: true });
}
export function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}

/** 指標檔 + 身分標記(對的)。回傳 XDG_CONFIG_HOME。照 scripts/review-router.test.ts 的 xdgPointingAt。 */
export function xdgPointingAt(learningDir: string, opts: { markerOverride?: string; pointTo?: string } = {}): string {
  const xdg = tmp('lc-xdg-');
  const id = randomUUID();
  mkdirSync(join(xdg, 'llm-learning-cards'), { recursive: true });
  writeFileSync(join(xdg, 'llm-learning-cards/vault.json'), JSON.stringify({ learning_dir: opts.pointTo ?? learningDir, vault_id: id }));
  mkdirSync(join(learningDir, 'config'), { recursive: true });
  writeFileSync(join(learningDir, 'config/vault-id'), opts.markerOverride ?? `${id}\n`);
  return xdg;
}

/** 空的 XDG:沒有指標檔。 */
export const emptyXdg = (): string => tmp('lc-xdg-empty-');

export interface CliRun {
  status: number | null;
  output: string;
  /** 假雲端收到的請求路徑(每個一行,例如 /v1/models、/v1/messages);沒帶假雲端是 [] */
  requests: string[];
}

/** 假雲端收到的「叫模型」請求(不含可達性探測 /v1/models)。 */
export const modelCalls = (run: CliRun): string[] => run.requests.filter((r) => r.includes('/v1/messages'));

/** 輸出裡以 at 開頭的堆疊行 */
export const stackLines = (output: string): string[] => output.split('\n').filter((l) => /^\s*at\s/.test(l));

export interface RunOptions {
  /** XDG_CONFIG_HOME(必給:不依賴機器上的指標檔) */
  xdg: string;
  /** 預設 true:帶 _fake-cloud.mjs。--fake 的測試傳 false(--fake 不碰網路) */
  fakeCloud?: boolean;
  env?: Record<string, string>;
}

export function runIngestCli(args: string[], o: RunOptions): CliRun {
  const useFakeCloud = o.fakeCloud !== false;
  if (!args.includes('--fake')) {
    if (existsSync(join(ROOT, '.env'))) {
      throw new Error('這個簽出有 .env:煞車(T62 合併前)不准在這裡起不帶 --fake 的 scripts/ingest.ts。請在沒有 .env 的簽出跑這個測試。');
    }
    if (!useFakeCloud) throw new Error('不帶 --fake 的 scripts/ingest.ts 一定要帶假雲端(煞車 (a))');
  }
  if (useFakeCloud && !existsSync(FAKE_CLOUD)) throw new Error(`假雲端不存在:${FAKE_CLOUD}`);
  const home = tmp('lc-ingest-cli-home-');
  const xdgCache = join(home, 'cache');
  mkdirSync(xdgCache, { recursive: true });
  const requestLog = join(home, 'requests.log');
  const nodeArgs = [TSX_CLI, ...(useFakeCloud ? ['--import', FAKE_CLOUD] : []), SCRIPT, ...args];
  const run = spawnSync(process.execPath, nodeArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 170_000,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: o.xdg,
      XDG_CACHE_HOME: xdgCache,
      LLM_CLOUD_PROVIDER: 'anthropic',
      LLM_CLOUD_MODEL: 'test-model',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      LLM_DAILY_CAP_USD: '100',
      LLM_PRICE_IN_PER_M: '2.5',
      LLM_PRICE_OUT_PER_M: '10',
      FAKE_CLOUD_REQUEST_LOG: requestLog,
      ...o.env,
    },
  });
  const requests = existsSync(requestLog) ? readFileSync(requestLog, 'utf8').split('\n').filter((l) => l.length > 0) : [];
  return { status: run.error ? null : run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}`, requests };
}

/** 資料夾底下所有 *.md 檔(遞迴;資料夾不存在是空陣列) */
export function mdFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.md')) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out;
}

/**
 * 把「今天已經花掉 usd 美元」種進這個帳本資料夾的 state/log.jsonl(一筆 openai 的 llm_call,只用 output token 算,避免浮點誤差)。
 * 價格要跟子行程的 LLM_PRICE_OUT_PER_M 一致(runIngestCli 預設 10)。注意:LLM_DAILY_CAP_USD=0 **不是**「用完」——
 * spend.ts 的 isBudgetExhausted 對 cap <= 0 回 false(沒設上限);要讓預算用完,上限要是正數、花費 >= 上限。
 */
export function seedTodaySpend(ledgerDir: string, usd: number, outPerM = 10): void {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  mkdirSync(join(ledgerDir, 'state'), { recursive: true });
  const event = {
    ts: `${day}T09:30:00+08:00`,
    type: 'llm_call',
    task: 'deepen',
    provider: 'openai',
    model: 'gpt-5.6-luna',
    latency_ms: 100,
    tokens_in: 0,
    tokens_out: Math.round((usd * 1_000_000) / outPerM),
  };
  writeFileSync(join(ledgerDir, 'state/log.jsonl'), `${JSON.stringify(event)}\n`, { flag: 'a' });
}
