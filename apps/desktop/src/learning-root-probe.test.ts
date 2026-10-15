/**
 * T2c-2 經 probe 的行為測試(測試 agent 寫):工單驗收 3(未設定的錯誤)、4(沒有後門)、5(啟動不寫檔)、10(warning 不靜默消失)。
 *
 * 根目錄一律走暫存 XDG_CONFIG_HOME + 暫存指標檔(`learning-root-sandbox.ts`),不碰真的指標檔與真的 learning/。
 * probe 的 JSON 介面見 `test-support/probe.ts` 的檔頭。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { validateLogEvent } from '../../../packages/core/src/schema/log.js';
import { BUILD_LC_FS_TIMEOUT_MS, buildLcFs } from './test-support/build-lc-fs.js';
import { LC_FS_BIN, runProbe, type ProbeResponse } from './test-support/probe.js';
import {
  VAULT_ID_A,
  cleanupAllSandboxes,
  diffSnapshots,
  makeSandbox,
  okSandbox,
  snapshotSandbox,
  writeMarker,
  writePointer,
  type Sandbox,
} from './test-support/learning-root-sandbox.js';

beforeAll(() => {
  buildLcFs();
}, BUILD_LC_FS_TIMEOUT_MS);

afterEach(() => cleanupAllSandboxes());

function env(sb: Sandbox, extra: Record<string, string> = {}): Record<string, string> {
  return { XDG_CONFIG_HOME: sb.xdg, HOME: sb.home, TMPDIR: sb.tmp, ...extra };
}

function probe(sb: Sandbox, body: Record<string, unknown>, extra: Record<string, string> = {}): { resp: ProbeResponse; stderr: string } {
  const { resp, stderr } = runProbe(body, undefined, { env: env(sb, extra), cwd: sb.cwd });
  return { resp, stderr };
}

function logLines(sb: Sandbox): string[] {
  const p = join(sb.learning, 'state', 'log.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0) : [];
}

describe('驗收 10:warning 事件不能靜默消失', () => {
  it('剛用 vault.ts init 初始化的根(有 config/vault-id、沒有 state/):read 被拒絕,之後 state/ 存在、log 恰好一行 warning', () => {
    const sb = okSandbox();
    expect(existsSync(join(sb.learning, 'state'))).toBe(false);
    const { resp } = probe(sb, { op: 'read', path: 'raw/x.md' });
    expect(resp.refused).toBe(true);
    const lines = logLines(sb);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(validateLogEvent(event).ok).toBe(true);
    expect(event.type).toBe('warning');
    expect(event.reason).toBe('path-refused');
    expect(event.path).toBe('raw/x.md');
  });

  it('同一種新的根,經 lc 請求 raw/x.png:403,state/log.jsonl 有那一行(限流規則照 T2c-1:第一次一定寫)', () => {
    const sb = okSandbox();
    const { resp } = probe(sb, { op: 'asset', path: 'raw/x.png' });
    expect(resp.status).toBe(403);
    const lines = logLines(sb);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(event.type).toBe('warning');
    expect(event.path).toBe('raw/x.png');
  });

  it('<根>/state 是一般檔案(建不了目錄也開不了 log):拒絕照樣是拒絕,stderr 說明 warning 沒寫成', () => {
    const sb = okSandbox();
    writeFileSync(join(sb.learning, 'state'), 'I am a file, not a directory');
    const { resp, stderr } = probe(sb, { op: 'read', path: 'raw/x.md' });
    expect(resp.refused).toBe(true);
    expect(readFileSync(join(sb.learning, 'state'), 'utf8')).toBe('I am a file, not a directory');
    expect(stderr).toContain('could not append a warning event');
  });

  it('state/ 已經存在不算錯:第二次被拒絕在同一個 log 再加一行', () => {
    const sb = okSandbox();
    mkdirSync(join(sb.learning, 'state'));
    probe(sb, { op: 'read', path: 'raw/x.md' });
    probe(sb, { op: 'read', path: 'raw/y.md' });
    expect(logLines(sb)).toHaveLength(2);
  });

  it('指標檔的 learning_dir 不存在:read raw/x.md 回「未設定」,不是拒絕、不寫 warning、根沒有被建出來', () => {
    const sb = makeSandbox();
    writePointer(sb, sb.missing, VAULT_ID_A);
    const before = snapshotSandbox(sb);
    const { resp } = probe(sb, { op: 'read', path: 'raw/x.md' });
    expect(resp.ok).toBe(false);
    expect(resp.refused).toBe(false);
    expect((resp.error as { kind?: string } | null | undefined)?.kind).toBe('not-configured');
    expect(existsSync(sb.missing)).toBe(false);
    expect(diffSnapshots(before, snapshotSandbox(sb))).toEqual([]);
  });

  it('啟動(ok 狀態)不建 state/,也沒有因為這條多出任何檔', () => {
    const sb = okSandbox();
    const before = snapshotSandbox(sb);
    const { resp } = probe(sb, { op: 'startup' });
    expect(resp.state).toBe('ok');
    expect(existsSync(join(sb.learning, 'state'))).toBe(false);
    expect(diffSnapshots(before, snapshotSandbox(sb))).toEqual([]);
  });
});

describe('驗收 4:沒有第二個來源、沒有後門', () => {
  it('沒有指標檔、但設了 LC_LEARNING_ROOT:command 回「未設定」,不讀那個資料夾', () => {
    const sb = makeSandbox();
    mkdirSync(join(sb.learning, 'cards'), { recursive: true });
    writeFileSync(join(sb.learning, 'cards', 'c.md'), 'SHOULD-NOT-BE-READ');
    writeMarker(sb, `${VAULT_ID_A}\n`);
    const { resp } = probe(sb, { op: 'read', path: 'cards/c.md' }, { LC_LEARNING_ROOT: sb.learning });
    expect(resp.ok).toBe(false);
    expect((resp.error as { kind?: string } | null | undefined)?.kind).toBe('not-configured');
    expect(JSON.stringify(resp)).not.toContain('SHOULD-NOT-BE-READ');
    const asset = probe(sb, { op: 'asset', path: 'cards/c.md' }, { LC_LEARNING_ROOT: sb.learning }).resp;
    expect(asset.status).toBe(403);
  });

  it('請求裡帶 root 欄位的 probe 要當壞請求:不能用它另開一條給根目錄的路', () => {
    const sb = okSandbox();
    const other = makeSandbox();
    mkdirSync(join(other.learning, 'cards'), { recursive: true });
    writeFileSync(join(other.learning, 'cards', 'c.md'), 'BACKDOOR-CONTENT');
    const r = spawnSync(LC_FS_BIN, {
      input: JSON.stringify({ op: 'read', root: other.learning, path: 'cards/c.md' }),
      encoding: 'utf8',
      env: { ...process.env, ...env(sb) },
      cwd: sb.cwd,
    });
    expect(r.stdout).not.toContain('BACKDOOR-CONTENT');
    const resp = JSON.parse(r.stdout.trim() || '{}') as ProbeResponse;
    expect(resp.ok).toBe(false);
  });

  it('XDG_CONFIG_HOME 指到哪,根就跟到哪:同一個行程環境換一個指標檔,拿到另一個根的內容', () => {
    const a = okSandbox();
    mkdirSync(join(a.learning, 'cards'), { recursive: true });
    writeFileSync(join(a.learning, 'cards', 'c.md'), 'ROOT-A');
    const b = okSandbox();
    mkdirSync(join(b.learning, 'cards'), { recursive: true });
    writeFileSync(join(b.learning, 'cards', 'c.md'), 'ROOT-B');
    expect(probe(a, { op: 'read', path: 'cards/c.md' }).resp.value).toBe('ROOT-A');
    expect(probe(b, { op: 'read', path: 'cards/c.md' }).resp.value).toBe('ROOT-B');
  });
});

describe('驗收 3/8:probe 的 status 不再有自我回報欄位', () => {
  it('status 只回 scheme,沒有 custom_enabled、scope_is_learning_root、same_checks_as_read(也沒有 camelCase 版)', () => {
    const sb = okSandbox();
    const { resp } = probe(sb, { op: 'status' });
    expect(resp.scheme).toBe('lc');
    for (const key of ['custom_enabled', 'customEnabled', 'scope_is_learning_root', 'scopeIsLearningRoot', 'same_checks_as_read', 'sameChecksAsRead']) {
      expect(Object.keys(resp), key).not.toContain(key);
    }
  });
});
