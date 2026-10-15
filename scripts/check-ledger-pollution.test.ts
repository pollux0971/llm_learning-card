import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VaultResolveDeps } from '../packages/core/src/llm/ledger.js';
import { countLedgerLines, resolvePollutionLedger, runLedgerGuard } from './check-ledger-pollution.js';

const dirs: string[] = [];

function tempLedger(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-pollution-'));
  dirs.push(dir);
  const path = join(dir, 'log.jsonl');
  writeFileSync(path, contents, 'utf8');
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('countLedgerLines', () => {
  it('不存在時回 undefined，不把未知當成 0 行', () => {
    expect(countLedgerLines(join(tmpdir(), 'ledger-pollution-does-not-exist', 'log.jsonl'))).toBeUndefined();
  });

  it('空檔是可判斷的 0 行', () => {
    expect(countLedgerLines(tempLedger(''))).toBe(0);
  });

  it('計算 JSONL 的實際非空行數', () => {
    expect(countLedgerLines(tempLedger('{"a":1}\n{"a":2}\n'))).toBe(2);
  });
});

describe('runLedgerGuard', () => {
  it('行數相同時 PASS', () => {
    const output: string[] = [];
    const result = runLedgerGuard({ logPath: tempLedger('{"a":1}\n'), runTests: () => 0, print: (line) => output.push(line) });
    expect(result).toBe(0);
    expect(output).toEqual(['✓ 帳本行數相同:1', 'gate=ledger-pollution result=PASS scanned=1']);
  });

  it('故意讓測試追加一行時會紅——守門確實接上', () => {
    const path = tempLedger('{"a":1}\n');
    const output: string[] = [];
    const result = runLedgerGuard({
      logPath: path,
      runTests: () => {
        appendFileSync(path, '{"a":2}\n', 'utf8');
        return 0;
      },
      print: (line) => output.push(line),
    });
    expect(result).toBe(1);
    expect(output).toEqual([
      `✗ 帳本行數改變:before=1 after=2 path=${path}`,
      'gate=ledger-pollution result=FAIL scanned=1',
    ]);
  });

  it('帳本不存在時是 UNKNOWN，不印 PASS，且測試本身仍可成功', () => {
    const output: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'ledger-pollution-missing-'));
    dirs.push(dir);
    const path = join(dir, 'log.jsonl');
    const result = runLedgerGuard({ logPath: path, runTests: () => 0, print: (line) => output.push(line) });
    expect(result).toBe(0);
    expect(output[0]).toContain('○ 無法判斷');
    expect(output[1]).toBe('gate=ledger-pollution result=UNKNOWN scanned=1');
    expect(output.join('\n')).not.toContain('PASS');
  });
});

/**
 * T5:帳本位置改由指標檔決定。解析不到(指標不存在、讀不到、learning_dir 不存在、標記不符)
 * → 沿用既有的第三態 UNKNOWN:不是 PASS(沒量到不能說「行數相同」),也不是新增的紅;測試照跑,
 * 退出碼是測試自己的。不能為了觸發 UNKNOWN 而拿一個「剛好不存在」的假路徑去量。
 *
 * 隔離:HOME / XDG_* 指到 mkdtemp,結束時還原;解析用注入的 deps,不碰真的指標檔。
 */
describe('T5:帳本位置解析不到 → UNKNOWN', () => {
  const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'] as const;
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  const VAULT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  let box: { root: string; home: string; config: string };

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-pollution-t5-'));
    box = { root, home: join(root, 'home'), config: join(root, 'xdg-config') };
    mkdirSync(box.home, { recursive: true });
    mkdirSync(box.config, { recursive: true });
    process.env.HOME = box.home;
    process.env.XDG_CONFIG_HOME = box.config;
    process.env.XDG_RUNTIME_DIR = join(root, 'xdg-runtime');
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(box.root, { recursive: true, force: true });
  });

  function deps(): VaultResolveDeps {
    return {
      env: { HOME: box.home, XDG_CONFIG_HOME: box.config },
      homedir: () => box.home,
      readFile: (path) => readFileSync(path, 'utf8'),
      exists: (path) => existsSync(path),
    };
  }

  function tree(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        out.push(abs.slice(root.length + 1));
        if (statSync(abs).isDirectory()) walk(abs);
      }
    };
    walk(root);
    return out.sort();
  }

  it('沒有指標:unresolved,原因含 init 與 show;不建任何檔', () => {
    const before = tree(box.root);
    const ledger = resolvePollutionLedger(deps());
    expect(ledger.kind).toBe('unresolved');
    if (ledger.kind !== 'unresolved') return;
    expect(ledger.reason).toContain('npx tsx scripts/vault.ts init');
    expect(ledger.reason).toContain('npx tsx scripts/vault.ts show');
    expect(tree(box.root)).toEqual(before);
  });

  it('指標與標記相符:resolved,量的是那本的 state/log.jsonl', () => {
    const learning = join(box.root, 'learning');
    mkdirSync(join(learning, 'config'), { recursive: true });
    writeFileSync(join(learning, 'config', 'vault-id'), `${VAULT_ID}\n`);
    mkdirSync(join(box.config, 'llm-learning-cards'), { recursive: true });
    const pointer = join(box.config, 'llm-learning-cards', 'vault.json');
    writeFileSync(pointer, JSON.stringify({ learning_dir: learning, vault_id: VAULT_ID }));
    try {
      expect(resolvePollutionLedger(deps())).toEqual({ kind: 'resolved', logPath: join(learning, 'state', 'log.jsonl') });
    } finally {
      rmSync(pointer, { force: true });
    }
  });

  it('unresolved → UNKNOWN(不是 PASS、不是 FAIL),測試照跑,退出碼是測試的', () => {
    let runs = 0;
    const output: string[] = [];
    const result = runLedgerGuard({
      unresolved: '指標檔不存在。請執行 npx tsx scripts/vault.ts init 或 npx tsx scripts/vault.ts show。',
      runTests: () => {
        runs += 1;
        return 0;
      },
      print: (line) => output.push(line),
    });
    expect(result).toBe(0);
    expect(runs).toBe(1);
    expect(output).toEqual([
      '○ 無法判斷(帳本位置解析失敗:指標檔不存在。請執行 npx tsx scripts/vault.ts init 或 npx tsx scripts/vault.ts show。)',
      'gate=ledger-pollution result=UNKNOWN scanned=1',
    ]);
  });

  it('unresolved 且測試失敗 → 回測試的退出碼,仍然是 UNKNOWN 不是 PASS', () => {
    const output: string[] = [];
    const result = runLedgerGuard({ unresolved: 'x', runTests: () => 3, print: (line) => output.push(line) });
    expect(result).toBe(3);
    expect(output[1]).toBe('gate=ledger-pollution result=UNKNOWN scanned=1');
    expect(output.join('\n')).not.toContain('PASS');
  });
});
