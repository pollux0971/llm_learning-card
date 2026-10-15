/**
 * T7:§11b 共用向量與「只留一份」靜態檢查。
 *
 * 行為列從 atomic-write.vectors.json 讀,不寫死在測試裡。列數與列名另外寫死一份,
 * 向量檔少一列而這條仍綠,就是向量與實作脫鉤。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const VECTOR_URL = new URL('./atomic-write.vectors.json', import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');

/** 寫死的清單。向量檔被刪一列、改名、多一列,這份對不上就紅。 */
const VECTOR_NAMES = [
  'syscall-order',
  'stale-tmp-overwritten',
  'old-style-stray-cleaned',
  'other-tmp-untouched',
  'rename-exdev',
  'rename-and-cleanup-both-fail',
  'dir-fsync-einval',
  'dir-fsync-eio',
  'dir-fsync-enospc',
  'fds-closed-on-success',
  'fds-closed-on-dir-fsync-error',
] as const;

const SECOND_COPY_NAMES = [
  'renameSync',
  'fsyncSync',
  'openSync',
  'writeSync',
  'closeSync',
  'rmSync',
  'appendFileSync',
] as const;

interface ExtraFile {
  name: string;
  bytes: string;
}

interface InjectSpec {
  call: string;
  nth: number;
  code: string;
}

interface Untouched {
  name: string;
  bytes: string;
}

interface Expectation {
  outcome: 'ok' | 'error';
  code: string | null;
  remaining: string[];
  target_bytes: string | null;
  absent?: string[];
  untouched?: Untouched[];
  order?: string[];
  tmp_basename?: string;
  fds_closed?: boolean;
  open_count?: number;
  identity?: string;
  cleanup_attempted?: boolean;
  saw_calls?: string[];
}

interface Vector {
  name: string;
  setup: {
    target: string;
    content: string;
    prior_target: string | null;
    extra_files: ExtraFile[];
  };
  inject: InjectSpec[];
  expect: Expectation;
}

interface Injected extends InjectSpec {
  err: NodeJS.ErrnoException;
}

const h = vi.hoisted(() => ({
  calls: [] as string[],
  fdPaths: new Map<number, { path: string; kind: 'file' | 'dir' }>(),
  fdEvents: [] as ({ op: 'open'; fd: number; path: string } | { op: 'close'; fd: number })[],
  openedWritePaths: [] as string[],
  seen: new Map<string, number>(),
  injects: [] as Injected[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();

  function kindOf(path: string): 'file' | 'dir' {
    try {
      if (real.existsSync(path) && real.statSync(path).isDirectory()) return 'dir';
    } catch {
      /* 開 tmp 時檔還沒有,當檔案 */
    }
    return 'file';
  }

  function maybeInject(call: string): void {
    const n = (h.seen.get(call) ?? 0) + 1;
    h.seen.set(call, n);
    const hit = h.injects.find((i) => i.call === call && i.nth === n);
    if (hit) throw hit.err;
  }

  return {
    ...real,
    openSync(path: Parameters<typeof real.openSync>[0], flags: Parameters<typeof real.openSync>[1], mode?: Parameters<typeof real.openSync>[2]) {
      const text = String(path);
      const kind = kindOf(text);
      h.calls.push(kind === 'dir' ? 'open:dir' : 'open:tmp');
      if (kind === 'file') h.openedWritePaths.push(text);
      maybeInject(kind === 'dir' ? 'open:dir' : 'open:tmp');
      const fd = real.openSync(path, flags, mode);
      h.fdPaths.set(fd, { path: text, kind });
      h.fdEvents.push({ op: 'open', fd, path: text });
      return fd;
    },
    writeSync(fd: number, data: string): number {
      h.calls.push('write');
      maybeInject('write');
      return real.writeSync(fd, data);
    },
    fsyncSync(fd: number) {
      const kind = h.fdPaths.get(fd)?.kind ?? 'file';
      const call = kind === 'dir' ? 'fsync:dir' : 'fsync:file';
      h.calls.push(call);
      maybeInject(call);
      return real.fsyncSync(fd);
    },
    closeSync(fd: number) {
      const kind = h.fdPaths.get(fd)?.kind ?? 'file';
      h.calls.push(kind === 'dir' ? 'close:dir' : 'close:file');
      h.fdEvents.push({ op: 'close', fd });
      h.fdPaths.delete(fd);
      return real.closeSync(fd);
    },
    renameSync(from: Parameters<typeof real.renameSync>[0], to: Parameters<typeof real.renameSync>[1]) {
      h.calls.push('rename');
      maybeInject('rename');
      return real.renameSync(from, to);
    },
    unlinkSync(path: Parameters<typeof real.unlinkSync>[0]) {
      h.calls.push('unlink');
      maybeInject('unlink');
      return real.unlinkSync(path);
    },
    rmSync(path: Parameters<typeof real.rmSync>[0], options?: Parameters<typeof real.rmSync>[1]) {
      h.calls.push('unlink');
      maybeInject('unlink');
      return real.rmSync(path, options);
    },
  };
});

const { writeFileAtomic } = await import('./atomic-write.js');

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function loadVectors(): Vector[] {
  const raw = readFileSync(VECTOR_URL, 'utf8');
  const parsed = JSON.parse(raw) as { vectors?: Vector[] };
  if (!Array.isArray(parsed.vectors)) throw new Error('atomic-write.vectors.json 沒有 vectors 陣列');
  return parsed.vectors;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

function wordHits(src: string, names: readonly string[]): string[] {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(src));
}

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`找不到 function ${name}`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  throw new Error(`function ${name} 沒有配對的括號`);
}

function stillOpen(): string[] {
  const open = new Map<number, string>();
  for (const e of h.fdEvents) {
    if (e.op === 'open') open.set(e.fd, e.path);
    else open.delete(e.fd);
  }
  return [...open].map(([fd, path]) => `${fd}=${path}`);
}

function resetTrace(): void {
  h.calls.length = 0;
  h.fdPaths.clear();
  h.fdEvents.length = 0;
  h.openedWritePaths.length = 0;
  h.seen.clear();
  h.injects.length = 0;
}

afterEach(() => {
  resetTrace();
});

function runVector(vector: Vector): void {
  const root = mkdtempSync(join(tmpdir(), 'lc-vec-'));
  try {
    resetTrace();
    for (const inj of vector.inject) {
      h.injects.push({
        ...inj,
        err: errnoError(inj.code, `${inj.code}: injected at ${inj.call}#${inj.nth}`),
      });
    }
    const target = join(root, vector.setup.target);
    if (vector.setup.prior_target !== null) writeFileSync(target, vector.setup.prior_target, 'utf8');
    for (const extra of vector.setup.extra_files) {
      writeFileSync(join(root, extra.name), extra.bytes, 'utf8');
    }

    let thrown: unknown;
    try {
      writeFileAtomic(target, vector.setup.content);
    } catch (err) {
      thrown = err;
    }

    if (vector.expect.outcome === 'ok') {
      expect(thrown, vector.name).toBeUndefined();
    } else {
      expect(thrown, `${vector.name} 應該丟錯`).toBeInstanceOf(Error);
      if (vector.expect.code !== null) {
        expect((thrown as NodeJS.ErrnoException).code, vector.name).toBe(vector.expect.code);
      }
      const identity = vector.expect.identity;
      if (typeof identity === 'string') {
        const inj = h.injects.find((i) => i.call === identity);
        expect(inj, `${vector.name} 沒有注入 ${identity}`).toBeDefined();
        expect(thrown, `${vector.name} 丟出去的不是注入的那一顆`).toBe(inj?.err);
      }
    }

    expect(readdirSync(root).sort(), vector.name).toEqual([...vector.expect.remaining].sort());
    if (vector.expect.target_bytes === null) {
      expect(existsSync(target), vector.name).toBe(false);
    } else {
      expect(readFileSync(target, 'utf8'), vector.name).toBe(vector.expect.target_bytes);
    }
    for (const name of vector.expect.absent ?? []) {
      expect(existsSync(join(root, name)), `${vector.name} 不該留下 ${name}`).toBe(false);
    }
    for (const file of vector.expect.untouched ?? []) {
      expect(readFileSync(join(root, file.name), 'utf8'), vector.name).toBe(file.bytes);
    }
    if (vector.expect.order) {
      const wanted = new Set(vector.expect.order);
      const actual = h.calls.filter((c) => wanted.has(c));
      expect(actual, `${vector.name}: ${h.calls.join(' → ')}`).toEqual(vector.expect.order);
    }
    const tmpBasename = vector.expect.tmp_basename;
    if (typeof tmpBasename === 'string') {
      const opened = h.openedWritePaths[0];
      expect(opened, `${vector.name} 沒有開暫存檔`).toBeTruthy();
      expect(basename(opened ?? ''), vector.name).toBe(tmpBasename);
      expect(opened, vector.name).toBe(join(root, tmpBasename));
    }
    if (vector.expect.fds_closed === true) {
      expect(stillOpen(), vector.name).toEqual([]);
    }
    if (vector.expect.open_count !== undefined) {
      const opens = h.fdEvents.filter((e) => e.op === 'open').length;
      expect(opens, vector.name).toBe(vector.expect.open_count);
    }
    if (vector.expect.cleanup_attempted === true) {
      expect(h.calls, `${vector.name}: ${h.calls.join(' → ')}`).toContain('unlink');
    }
    for (const call of vector.expect.saw_calls ?? []) {
      expect(h.calls, `${vector.name}: ${h.calls.join(' → ')}`).toContain(call);
    }
  } finally {
    // 測試自己的清目錄不能算進 unlink 注入,否則 nth 1 會打到 harness 而不是實作。
    h.injects.length = 0;
    rmSync(root, { recursive: true, force: true });
  }
}

describe('atomic-write.vectors.json', () => {
  it('列數與列名等於測試裡寫死的清單', () => {
    expect(fileURLToPath(VECTOR_URL)).toMatch(/packages\/core\/src\/schema\/atomic-write\.vectors\.json$/);
    const vectors = loadVectors();
    expect(VECTOR_NAMES.length).toBeGreaterThan(0);
    expect(vectors.map((v) => v.name)).toEqual([...VECTOR_NAMES]);
    for (const v of vectors) {
      expect(Array.isArray(v.inject), `${v.name} 缺 inject`).toBe(true);
      expect(v.expect?.outcome === 'ok' || v.expect?.outcome === 'error', `${v.name} 缺 expect.outcome`).toBe(true);
      expect('code' in v.expect, `${v.name} 缺 expect.code`).toBe(true);
      expect(Array.isArray(v.expect.remaining), `${v.name} 缺 expect.remaining`).toBe(true);
      expect('target_bytes' in v.expect, `${v.name} 缺 expect.target_bytes`).toBe(true);
      expect(typeof v.setup?.target, `${v.name} 缺 setup.target`).toBe('string');
      expect(typeof v.setup.content, `${v.name} 缺 setup.content`).toBe('string');
    }
  });

  describe('逐列跑 writeFileAtomic', () => {
    const vectors = loadVectors();
    for (const vector of vectors) {
      it(vector.name, () => {
        runVector(vector);
      });
    }
  });
});

describe('只留一份 §11b', () => {
  it('state.ts 非註解程式碼裡,第二份寫入的七個 syscall 名字零命中,而且寫入本身是轉呼叫', () => {
    const src = stripComments(readFileSync(join(REPO_ROOT, 'packages/core/src/ingest/state.ts'), 'utf8'));
    expect(wordHits(src, SECOND_COPY_NAMES)).toEqual([]);
    const writeBody = functionBody(src, 'atomicWriteJson');
    const appendBody = functionBody(src, 'appendLogEvent');
    expect(writeBody.match(/writeFileAtomic\(/g) ?? []).toHaveLength(1);
    expect(appendBody.match(/appendLineAtomic\(/g) ?? []).toHaveLength(1);
  });

  it('lint 非測試程式碼與 scripts/lint.ts 不再留第二份原子寫入', () => {
    const lintDir = join(REPO_ROOT, 'packages/core/src/lint');
    expect(existsSync(join(lintDir, 'atomic-write.ts')), 'lint/atomic-write.ts 不該還在').toBe(false);
    const sources = readdirSync(lintDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(lintDir, name));
    sources.push(join(REPO_ROOT, 'scripts/lint.ts'));
    for (const file of sources) {
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(wordHits(src, ['renameSync', 'fsyncSync']), file).toEqual([]);
    }
    const lintCli = stripComments(readFileSync(join(REPO_ROOT, 'scripts/lint.ts'), 'utf8'));
    expect(lintCli).not.toContain('atomicWriteFileSync');
    expect(lintCli).not.toContain('lint/atomic-write');
    expect(lintCli).toContain('writeFileAtomic(');
  });
});
