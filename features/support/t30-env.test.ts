/**
 * T30 驗收 3:`scripts/_env.ts` 的重讀 `.env`(`loadDotEnv(): boolean`)。紅測試作者寫;開發 worker 不改。
 *
 * `_env.ts` 讀的是「自己旁邊上一層的 .env」(`new URL('../.env', import.meta.url)`)。為了不碰真的 .env,
 * 每個測試把 `scripts/_env.ts` **原樣複製**到暫存目錄的 `scripts/_env.ts`、`.env` 放在暫存目錄根,再 import 那份複製:
 * 讀的就是暫存的 .env;每個測試各自一份模組(各自的「第一次載入」),互不干擾。
 * 因此 `_env.ts` 必須自成一檔(只 import `node:`),下面有一條測試守這件事。
 *
 * 規則(工單):
 *   - 第一次載入之前環境裡就有的變數,永遠不動(環境優先);
 *   - 檔案裡的鍵:設成檔案現在的值(新的加上、改的換掉);上一次從檔案設的鍵、這次檔案裡沒有了 → 從 process.env 刪掉;
 *   - 檔案不在 / 讀不到 = 空檔案,不丟錯;
 *   - `LC_REVIEW_` 開頭的鍵一律不設(第一次載入也是;安全洞);
 *   - 回傳 process.env 有沒有因此改變。
 * 值不印、不寫進任何 log。
 *
 * 一律暫存目錄;.env 裡只放假值。測試前後把動過的環境變數還原。
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REAL_ENV_MODULE = join(import.meta.dirname, '../../scripts/_env.ts');

const KEYS = ['T30_A', 'T30_B', 'T30_C', 'T30_PRESET', 'T30_QUOTED', 'T30_SPACE', 'LC_REVIEW_FAKE_CLOUD', 'LC_REVIEW_TODAY', 'LC_REVIEW_OTHER'];
let saved: Record<string, string | undefined>;
const dirs: string[] = [];

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Sandbox {
  dir: string;
  envFile: string;
  write(text: string): void;
  remove(): void;
  load(): Promise<{ loadDotEnv: () => boolean }>;
}

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 't30-env-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(REAL_ENV_MODULE, join(dir, 'scripts/_env.ts'));
  const envFile = join(dir, '.env');
  return {
    dir,
    envFile,
    write: (text) => writeFileSync(envFile, text, 'utf8'),
    remove: () => rmSync(envFile, { force: true, recursive: true }),
    async load() {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'scripts/_env.ts')).href)) as { loadDotEnv?: () => boolean };
      if (typeof mod.loadDotEnv !== 'function') throw new Error('scripts/_env.ts 沒有匯出 loadDotEnv');
      return mod as { loadDotEnv: () => boolean };
    },
  };
}

describe('_env.ts 自成一檔(驗收 3)', () => {
  it('只 import node: 內建模組(複製到別處也能跑;只有 _env.ts 讀 .env,ADR-034)', () => {
    const src = readFileSync(REAL_ENV_MODULE, 'utf8');
    const bad = src
      .split('\n')
      .filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /\bimport\s*\(/.test(l) || /\brequire\s*\(/.test(l))
      .filter((l) => !/from\s+['"]node:/.test(l));
    expect(bad).toEqual([]);
  });

  it('用 Node 內建的 parseEnv 解析(跟 loadEnvFile 同一個解析器),不自己寫解析', () => {
    const src = readFileSync(REAL_ENV_MODULE, 'utf8');
    expect(src).toMatch(/\bparseEnv\b/);
  });
});

describe('第一次載入(import 的副作用,照舊)(驗收 3)', () => {
  it('.env 的鍵進 process.env', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\nT30_B=two\n');
    await sb.load();
    expect(process.env.T30_A).toBe('one');
    expect(process.env.T30_B).toBe('two');
  });

  it('環境優先:啟動環境已經有的變數不被 .env 蓋掉', async () => {
    process.env.T30_PRESET = 'from-env';
    const sb = sandbox();
    sb.write('T30_PRESET=from-file\nT30_A=one\n');
    await sb.load();
    expect(process.env.T30_PRESET).toBe('from-env');
    expect(process.env.T30_A).toBe('one');
  });

  it('沒有 .env 也不丟錯', async () => {
    const sb = sandbox();
    await expect(sb.load()).resolves.toBeDefined();
  });

  it('LC_REVIEW_ 開頭的鍵第一次載入也不設(安全洞:除錯開關只能來自啟動環境)', async () => {
    const sb = sandbox();
    sb.write('LC_REVIEW_FAKE_CLOUD=/tmp/evil.mjs\nLC_REVIEW_TODAY=2001-01-01\nLC_REVIEW_OTHER=x\nT30_A=one\n');
    await sb.load();
    expect(process.env.LC_REVIEW_FAKE_CLOUD).toBeUndefined();
    expect(process.env.LC_REVIEW_TODAY).toBeUndefined();
    expect(process.env.LC_REVIEW_OTHER).toBeUndefined();
    expect(process.env.T30_A).toBe('one');
  });
});

describe('loadDotEnv:重讀(驗收 3)', () => {
  it('檔案沒變 → false,環境不變', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\n');
    const mod = await sb.load();
    expect(mod.loadDotEnv()).toBe(false);
    expect(process.env.T30_A).toBe('one');
    expect(mod.loadDotEnv()).toBe(false);
  });

  it('側車起來之後才在 .env 補上的鍵:重讀就看到 → true', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\n');
    const mod = await sb.load();
    expect(process.env.T30_B).toBeUndefined();
    sb.write('T30_A=one\nT30_B=late\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_B).toBe('late');
    expect(process.env.T30_A).toBe('one');
  });

  it('一開始完全沒有 .env,之後才建檔:重讀看到', async () => {
    const sb = sandbox();
    const mod = await sb.load();
    sb.write('T30_A=created\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_A).toBe('created');
  });

  it('改了值:換成檔案現在的值(loadEnvFile 不覆蓋已經有的值,所以不能只再呼叫它一次)', async () => {
    const sb = sandbox();
    sb.write('T30_A=old\n');
    const mod = await sb.load();
    expect(process.env.T30_A).toBe('old');
    sb.write('T30_A=new\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_A).toBe('new');
    sb.write('T30_A=newer\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_A).toBe('newer');
  });

  it('刪掉一個鍵:從 process.env 刪掉 → true;其他鍵留著', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\nT30_B=two\n');
    const mod = await sb.load();
    sb.write('T30_B=two\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect('T30_A' in process.env).toBe(false);
    expect(process.env.T30_B).toBe('two');
  });

  it('整個 .env 刪掉 = 空檔案:上次從檔案設的鍵全部刪掉,不丟錯', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\nT30_B=two\n');
    const mod = await sb.load();
    sb.remove();
    expect(mod.loadDotEnv()).toBe(true);
    expect('T30_A' in process.env).toBe(false);
    expect('T30_B' in process.env).toBe(false);
    expect(mod.loadDotEnv()).toBe(false);
  });

  it('讀不到(.env 變成目錄)= 空檔案,不丟錯', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\n');
    const mod = await sb.load();
    sb.remove();
    mkdirSync(sb.envFile);
    let result: boolean | undefined;
    expect(() => {
      result = mod.loadDotEnv();
    }).not.toThrow();
    expect(result).toBe(true);
    expect('T30_A' in process.env).toBe(false);
  });

  it('刪掉再補回來:每次都照檔案現在的內容', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\n');
    const mod = await sb.load();
    sb.write('');
    expect(mod.loadDotEnv()).toBe(true);
    expect('T30_A' in process.env).toBe(false);
    sb.write('T30_A=back\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_A).toBe('back');
  });

  it('啟動環境本來就有的變數:檔案怎麼改(改值、刪掉、整個檔刪掉)都不動,也不算「改變」', async () => {
    process.env.T30_PRESET = 'from-env';
    const sb = sandbox();
    sb.write('T30_PRESET=file-1\nT30_A=one\n');
    const mod = await sb.load();
    expect(process.env.T30_PRESET).toBe('from-env');
    sb.write('T30_PRESET=file-2\nT30_A=one\n');
    expect(mod.loadDotEnv()).toBe(false);
    expect(process.env.T30_PRESET).toBe('from-env');
    sb.write('T30_A=one\n');
    expect(mod.loadDotEnv()).toBe(false);
    expect(process.env.T30_PRESET).toBe('from-env');
    sb.remove();
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_PRESET).toBe('from-env');
    expect('T30_A' in process.env).toBe(false);
  });

  it('不是從檔案設的鍵,即使檔案裡沒有它也不刪(只刪「上一次從檔案設的」)', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\n');
    const mod = await sb.load();
    process.env.T30_C = 'set-by-someone-else';
    try {
      sb.write('T30_A=one\nT30_B=x\n');
      mod.loadDotEnv();
      expect(process.env.T30_C).toBe('set-by-someone-else');
      sb.remove();
      mod.loadDotEnv();
      expect(process.env.T30_C).toBe('set-by-someone-else');
    } finally {
      delete process.env.T30_C;
    }
  });

  it('解析跟 Node 內建的 parseEnv 一樣(引號、含空格的值、註解)', async () => {
    const text = '# 註解\nT30_QUOTED="a b c"\nT30_SPACE=plain value\nT30_A=one # trailing\n';
    const expected = parseEnv(text);
    const sb = sandbox();
    sb.write('T30_A=first\n');
    const mod = await sb.load();
    sb.write(text);
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.T30_QUOTED).toBe(expected.T30_QUOTED);
    expect(process.env.T30_SPACE).toBe(expected.T30_SPACE);
    expect(process.env.T30_A).toBe(expected.T30_A);
  });

  it('LC_REVIEW_ 開頭的鍵重讀時一律不設(寫在 .env 後來才加的也一樣);只改這些行 → false', async () => {
    const sb = sandbox();
    sb.write('T30_A=one\n');
    const mod = await sb.load();
    sb.write('T30_A=one\nLC_REVIEW_FAKE_CLOUD=/tmp/evil.mjs\nLC_REVIEW_TODAY=2001-01-01\nLC_REVIEW_OTHER=x\n');
    expect(mod.loadDotEnv()).toBe(false);
    expect(process.env.LC_REVIEW_FAKE_CLOUD).toBeUndefined();
    expect(process.env.LC_REVIEW_TODAY).toBeUndefined();
    expect(process.env.LC_REVIEW_OTHER).toBeUndefined();
    sb.write('T30_A=two\nLC_REVIEW_FAKE_CLOUD=/tmp/evil.mjs\n');
    expect(mod.loadDotEnv()).toBe(true);
    expect(process.env.LC_REVIEW_FAKE_CLOUD).toBeUndefined();
  });

  it('啟動環境本來就有 LC_REVIEW_ 開頭的變數:.env 蓋不掉、也刪不掉', async () => {
    process.env.LC_REVIEW_TODAY = '2026-09-10';
    process.env.LC_REVIEW_FAKE_CLOUD = '/real/start/env.mjs';
    const sb = sandbox();
    sb.write('LC_REVIEW_TODAY=2001-01-01\nLC_REVIEW_FAKE_CLOUD=/tmp/evil.mjs\n');
    const mod = await sb.load();
    expect(process.env.LC_REVIEW_TODAY).toBe('2026-09-10');
    expect(process.env.LC_REVIEW_FAKE_CLOUD).toBe('/real/start/env.mjs');
    sb.write('LC_REVIEW_TODAY=1999-12-31\n');
    mod.loadDotEnv();
    expect(process.env.LC_REVIEW_TODAY).toBe('2026-09-10');
    sb.remove();
    mod.loadDotEnv();
    expect(process.env.LC_REVIEW_TODAY).toBe('2026-09-10');
    expect(process.env.LC_REVIEW_FAKE_CLOUD).toBe('/real/start/env.mjs');
  });

  it('值不印、不寫進 log:重讀前後 console 與 stdout / stderr 都沒有出現值', async () => {
    const SECRET = 'fake-secret-value-9a8b7c';
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sb = sandbox();
    sb.write(`T30_A=${SECRET}\n`);
    const mod = await sb.load();
    sb.write(`T30_A=${SECRET}-changed\nT30_B=${SECRET}-b\n`);
    mod.loadDotEnv();
    sb.remove();
    mod.loadDotEnv();
    const seen = [...out.mock.calls, ...err.mock.calls, ...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
    expect(seen).not.toContain(SECRET);
  });
});
