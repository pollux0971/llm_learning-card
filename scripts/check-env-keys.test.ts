/**
 * scripts/check-env-keys.ts 的測試(工單 2026-09-12,`.env-keys-gate`)。
 *
 * 跟其餘掃描器的測試同一個形狀:暫存目錄當假 consumer 根,`--root` 明講。
 * ⚠️ fixture 裡的值一律是無意義佔位字串(`x`、`dummy-...`),不是真實金鑰——
 * 這支測試本身也要遵守「不碰值」的精神,不製造看起來像真金鑰的字串。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractKeys, diffKeys } from './check-env-keys.js';

const CHECK_ENV_KEYS_TS = resolve(import.meta.dirname, 'check-env-keys.ts');
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const EXAMPLE_CONTENT = [
  '# 複製成 .env(已被 .gitignore 擋住)',
  '',
  'OPENAI_API_KEY=',
  'LLM_CLOUD_PROVIDER=openai',
  'LLM_CLOUD_MODEL=dummy-model',
  '',
  '# 本機模型閘道',
  'GATEWAY_BASE_URL=http://localhost:8787',
  'GATEWAY_API_KEY=',
  'LLM_LOCAL_MODEL=dummy-local',
  'LLM_DAILY_CAP_USD=1',
  'LLM_PRICE_IN_PER_M=2.5',
  'LLM_PRICE_OUT_PER_M=10',
  '',
].join('\n');

/** `.env.example` 那份的鍵集合(照上面的 fixture 內容手數,供斷言用)。 */
const EXAMPLE_KEYS = [
  'OPENAI_API_KEY',
  'LLM_CLOUD_PROVIDER',
  'LLM_CLOUD_MODEL',
  'GATEWAY_BASE_URL',
  'GATEWAY_API_KEY',
  'LLM_LOCAL_MODEL',
  'LLM_DAILY_CAP_USD',
  'LLM_PRICE_IN_PER_M',
  'LLM_PRICE_OUT_PER_M',
];

/** 一份跟 EXAMPLE_KEYS 鍵集合完全一致、值全部是佔位字串的 `.env`。 */
function matchingEnvContent(): string {
  return EXAMPLE_KEYS.map((k) => `${k}=x`).join('\n') + '\n';
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-env-keys-'));
  tmpDirs.push(root);
  writeFileSync(join(root, '.env.example'), EXAMPLE_CONTENT, 'utf8');
  return root;
}

function writeEnv(root: string, content: string): void {
  writeFileSync(join(root, '.env'), content, 'utf8');
}

function run(root: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_ENV_KEYS_TS, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('check-env-keys:純函式(不碰檔案)', () => {
  it('extractKeys 只取鍵名,忽略註解、空行,不管值長什麼樣', () => {
    const keys = extractKeys(['# comment', '', 'FOO=bar', 'BAZ=', '  QUX = has spaces ', '#SKIP=nope'].join('\n'));
    expect([...keys].sort()).toEqual(['BAZ', 'FOO', 'QUX']);
  });

  it('extractKeys 對同一個鍵重複出現時去重', () => {
    const keys = extractKeys('A=1\nA=2\n');
    expect([...keys]).toEqual(['A']);
  });

  it('diffKeys 找出兩邊各自獨有的鍵,雙向都不遺漏', () => {
    const diff = diffKeys(new Set(['A', 'B', 'C']), new Set(['B', 'C', 'D']));
    expect(diff.missing).toEqual(['A']);
    expect(diff.extra).toEqual(['D']);
  });

  it('diffKeys 鍵集合完全一致時兩邊都是空陣列', () => {
    const diff = diffKeys(new Set(['A', 'B']), new Set(['B', 'A']));
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
  });
});

describe('check-env-keys:整支腳本(fixture root + --root)', () => {
  it('鍵集合一致 → exit 0、PASS,scanned 是鍵數', () => {
    const root = makeRoot();
    writeEnv(root, matchingEnvContent());
    const { code, output } = run(root);
    expect(code).toBe(0);
    expect(output).toContain(`gate=env-keys result=PASS scanned=${EXAMPLE_KEYS.length}`);
    expect(output).toContain('鍵集合一致');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (a):.env 少一個鍵 → exit 1,指名那個鍵;補回去 → exit 0', () => {
    const root = makeRoot();
    const withoutTwo = EXAMPLE_KEYS.filter((k) => k !== 'LLM_CLOUD_PROVIDER' && k !== 'LLM_CLOUD_MODEL')
      .map((k) => `${k}=x`)
      .join('\n');
    writeEnv(root, withoutTwo + '\n');

    const missingRun = run(root);
    expect(missingRun.code).toBe(1);
    expect(missingRun.output).toContain('缺少 2 個');
    expect(missingRun.output).toContain('LLM_CLOUD_PROVIDER');
    expect(missingRun.output).toContain('LLM_CLOUD_MODEL');
    expect(missingRun.output).toContain('gate=env-keys result=FAIL');
    // 沒有反向漂移,不該提到那句話。
    expect(missingRun.output).not.toContain('反向漂移');

    writeEnv(root, matchingEnvContent());
    const restoredRun = run(root);
    expect(restoredRun.code).toBe(0);
    expect(restoredRun.output).toContain('result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (b):.env 多一個 .env.example 沒有的鍵 → exit 1,說明是反向漂移;拿掉 → exit 0', () => {
    const root = makeRoot();
    writeEnv(root, matchingEnvContent() + 'SOME_NEW_FLAG_NOBODY_DOCUMENTED=x\n');

    const extraRun = run(root);
    expect(extraRun.code).toBe(1);
    expect(extraRun.output).toContain('多出 1 個');
    expect(extraRun.output).toContain('SOME_NEW_FLAG_NOBODY_DOCUMENTED');
    expect(extraRun.output).toContain('反向漂移');
    expect(extraRun.output).toContain('gate=env-keys result=FAIL');
    // 沒有缺鍵,不該提到「缺少」。
    expect(extraRun.output).not.toContain('缺少');

    writeEnv(root, matchingEnvContent());
    const restoredRun = run(root);
    expect(restoredRun.code).toBe(0);
    expect(restoredRun.output).toContain('result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('雙向同時發生:一邊缺、一邊多 → 兩段訊息都印,exit 1', () => {
    const root = makeRoot();
    const withoutOne = EXAMPLE_KEYS.filter((k) => k !== 'GATEWAY_API_KEY')
      .map((k) => `${k}=x`)
      .join('\n');
    writeEnv(root, withoutOne + '\nUNDOCUMENTED_KEY=x\n');

    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('缺少 1 個');
    expect(output).toContain('GATEWAY_API_KEY');
    expect(output).toContain('多出 1 個');
    expect(output).toContain('UNDOCUMENTED_KEY');
    expect(output).toContain('反向漂移');
  }, SPAWN_TIMEOUT_MS);

  it('反向驗證 (c):.env 不存在(乾淨簽出/CI)→ 不紅,印跳過那行;補回去 → 綠', () => {
    const root = makeRoot();
    // 刻意不呼叫 writeEnv:模擬乾淨簽出,worktree 裡本來就沒有 .env。

    const noEnvRun = run(root);
    expect(noEnvRun.code).toBe(0);
    expect(noEnvRun.output).toContain('.env: 不存在');
    expect(noEnvRun.output).toContain('跳過');
    expect(noEnvRun.output).toContain(`gate=env-keys result=PASS scanned=${EXAMPLE_KEYS.length}`);
    // 這一條是「合法跳過」,不是「掃描器壞了」的那個信號——兩者絕對不能共用字面。
    expect(noEnvRun.output).not.toContain('掃描器壞了');

    writeEnv(root, matchingEnvContent());
    const restoredRun = run(root);
    expect(restoredRun.code).toBe(0);
    expect(restoredRun.output).toContain('鍵集合一致');
  }, SPAWN_TIMEOUT_MS);

  it('.env 不存在不能被誤用成「一律跳過就過關」:少鍵的 .env 存在時仍然要紅', () => {
    // 這一條防止「沒有 .env 就跳過」的實作退化成「檔案存在與否都跳過」。
    const root = makeRoot();
    writeEnv(root, 'OPENAI_API_KEY=x\n'); // 存在,但只有 1 個鍵
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).not.toContain('跳過');
    expect(output).toContain('gate=env-keys result=FAIL');
  }, SPAWN_TIMEOUT_MS);

  it('.env.example 本身不存在 → exit 1,不是「跳過」(它是版控內的東西)', () => {
    const root = mkdtempSync(join(tmpdir(), 'lc-env-keys-noexample-'));
    tmpDirs.push(root);
    const { code, output } = run(root);
    expect(code).toBe(1);
    expect(output).toContain('找不到');
    expect(output).toContain('.env.example');
    expect(output).toContain('gate=env-keys result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('絕對不把值印出來:.env 用容易辨識的假金鑰值,輸出裡完全不能出現那個值', () => {
    const root = makeRoot();
    const secretLookingValue = 'sk-should-never-appear-in-output-zzz9';
    writeEnv(root, matchingEnvContent().replace('OPENAI_API_KEY=x', `OPENAI_API_KEY=${secretLookingValue}`));
    const { output } = run(root);
    expect(output).not.toContain(secretLookingValue);
  }, SPAWN_TIMEOUT_MS);
});
