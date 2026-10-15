/**
 * T2c-1 驗收 A3、D12、E16:webview 端的 LearningFs(apps/desktop/src/webview/learning-fs.ts)。
 * 測試 agent 寫的;實作者不要改。介面寫在 test-support/webview-learning-fs.ts 的檔頭。
 *
 * `@tauri-apps/api/core` 的 invoke 換成 mock:這裡只驗 TS 這一層(command 名、參數原樣、錯誤分類),
 * Rust 那一層由 src-tauri/tests/commands.rs 經過真的 Tauri IPC 驗。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWebviewLearningFs, type WebviewLearningFsModule } from './test-support/webview-learning-fs.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

let cached: Promise<WebviewLearningFsModule> | undefined;
function mod(): Promise<WebviewLearningFsModule> {
  cached ??= loadWebviewLearningFs();
  return cached;
}

beforeEach(() => {
  invoke.mockReset();
});

async function refusedWith(promise: Promise<unknown>, m: WebviewLearningFsModule): Promise<Error & { reason: string }> {
  const err = await promise.then(
    (v) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(v)}`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(m.PathRefusedError);
  expect(err).not.toBeInstanceOf(m.LearningIoError);
  return err as Error & { reason: string };
}

async function ioErrorWith(promise: Promise<unknown>, m: WebviewLearningFsModule): Promise<Error & { code: string }> {
  const err = await promise.then(
    (v) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(v)}`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(m.LearningIoError);
  expect(err).not.toBeInstanceOf(m.PathRefusedError);
  return err as Error & { code: string };
}

describe('webview LearningFs → Tauri invoke(A3)', () => {
  it('read goes through invoke exactly once, command read, relPath byte for byte', async () => {
    const m = await mod();
    invoke.mockResolvedValueOnce('# card');
    const fs = m.createLearningFs({ os: 'linux' });
    await expect(fs.read('cards/a.md')).resolves.toBe('# card');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('read', { relPath: 'cards/a.md' });
  });

  it('a suspicious path is still handed to invoke unchanged (TS does not pre-check; Rust is the authority)', async () => {
    const m = await mod();
    invoke.mockRejectedValueOnce({ kind: 'refused', reason: 'structure' });
    const fs = m.createLearningFs({ os: 'linux' });
    const err = await refusedWith(fs.read('..\\..\\etc\\passwd'), m);
    expect(err.reason).toBe('structure');
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = invoke.mock.calls[0] as [string, { relPath: string }];
    expect(cmd).toBe('read');
    expect(args.relPath).toBe('..\\..\\etc\\passwd');
    expect(Buffer.from(args.relPath, 'utf8').equals(Buffer.from('..\\..\\etc\\passwd', 'utf8'))).toBe(true);
  });

  it('a non-NFC path is not normalised before invoke', async () => {
    const m = await mod();
    invoke.mockRejectedValueOnce({ kind: 'refused', reason: 'nfc' });
    const fs = m.createLearningFs({ os: 'linux' });
    const nfd = 'cards/é.md';
    await refusedWith(fs.read(nfd), m);
    expect((invoke.mock.calls[0] as [string, { relPath: string }])[1].relPath).toBe(nfd);
  });

  it('write passes relPath and content unchanged', async () => {
    const m = await mod();
    invoke.mockResolvedValueOnce(null);
    const fs = m.createLearningFs({ os: 'linux' });
    await expect(fs.write('state/reviews.json', '{"a":1}\n')).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('write', { relPath: 'state/reviews.json', content: '{"a":1}\n' });
  });

  it('list uses the relDir argument', async () => {
    const m = await mod();
    invoke.mockResolvedValueOnce(['a.md', 'b.md']);
    const fs = m.createLearningFs({ os: 'linux' });
    await expect(fs.list('cards')).resolves.toEqual(['a.md', 'b.md']);
    expect(invoke).toHaveBeenCalledWith('list', { relDir: 'cards' });
  });

  it('exists uses the relPath argument and returns the boolean', async () => {
    const m = await mod();
    invoke.mockResolvedValueOnce(false);
    const fs = m.createLearningFs({ os: 'linux' });
    await expect(fs.exists('cards/missing.md')).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledWith('exists', { relPath: 'cards/missing.md' });
  });

  it('an injected invoke is used instead of the Tauri one', async () => {
    const m = await mod();
    const own = vi.fn().mockResolvedValue('from-own');
    const fs = m.createLearningFs({ invoke: own, os: 'linux' });
    await expect(fs.read('cards/a.md')).resolves.toBe('from-own');
    expect(own).toHaveBeenCalledWith('read', { relPath: 'cards/a.md' });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('io errors and refusals are different classes(D12)', () => {
  it('a missing file is a LearningIoError with code not_found, not a refusal', async () => {
    const m = await mod();
    invoke.mockRejectedValueOnce({ kind: 'io', code: 'not_found', errno: 2 });
    const fs = m.createLearningFs({ os: 'linux' });
    const err = await ioErrorWith(fs.read('cards/missing.md'), m);
    expect(err.code).toBe('not_found');
  });

  it('raw/ is a PathRefusedError with reason raw, not an io error', async () => {
    const m = await mod();
    invoke.mockRejectedValueOnce({ kind: 'refused', reason: 'raw' });
    const fs = m.createLearningFs({ os: 'linux' });
    const err = await refusedWith(fs.read('raw/x.md'), m);
    expect(err.reason).toBe('raw');
  });

  it.each(['is_dir', 'permission', 'not_utf8'])('io code %s comes through as LearningIoError.code', async (code) => {
    const m = await mod();
    invoke.mockRejectedValueOnce({ kind: 'io', code });
    const fs = m.createLearningFs({ os: 'linux' });
    const err = await ioErrorWith(fs.read('cards/x.md'), m);
    expect(err.code).toBe(code);
  });

  it('write, list and exists classify errors the same way', async () => {
    const m = await mod();
    const fs = m.createLearningFs({ os: 'linux' });
    invoke.mockRejectedValueOnce({ kind: 'refused', reason: 'symlink' });
    expect((await refusedWith(fs.write('cards/evil.md', 'x'), m)).reason).toBe('symlink');
    invoke.mockRejectedValueOnce({ kind: 'io', code: 'not_found' });
    expect((await ioErrorWith(fs.list('cards/nope'), m)).code).toBe('not_found');
    invoke.mockRejectedValueOnce({ kind: 'refused', reason: 'raw' });
    expect((await refusedWith(fs.exists('raw/x.md'), m)).reason).toBe('raw');
  });
});

describe('assetUrl(E16)', () => {
  it('the prefix depends on the platform', async () => {
    const m = await mod();
    expect(m.assetUrlPrefix('linux')).toBe('lc://localhost/');
    expect(m.assetUrlPrefix('macos')).toBe('lc://localhost/');
    expect(m.assetUrlPrefix('windows')).toBe('http://lc.localhost/');
    expect(m.assetUrlPrefix('android')).toBe('http://lc.localhost/');
  });

  it('on Linux each segment is encodeURIComponent-ed and no invoke happens', async () => {
    const m = await mod();
    const fs = m.createLearningFs({ os: 'linux' });
    expect(fs.assetUrl('assets/sec-0042-diagram.png')).toBe('lc://localhost/assets/sec-0042-diagram.png');
    expect(fs.assetUrl('assets/가.png')).toBe('lc://localhost/assets/%EA%B0%80.png');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('on Windows the same path gets the http://lc.localhost/ prefix', async () => {
    const m = await mod();
    const fs = m.createLearningFs({ os: 'windows' });
    expect(fs.assetUrl('assets/가.png')).toBe('http://lc.localhost/assets/%EA%B0%80.png');
  });

  it.each(['raw/security/x.md', 'Raw/x.png', 'assets/../secret', '../x.png', '/etc/passwd', 'assets/a b.png', ''])(
    'assetUrl(%j) is refused synchronously without invoke',
    async (rel) => {
      const m = await mod();
      const fs = m.createLearningFs({ os: 'linux' });
      let thrown: unknown;
      try {
        fs.assetUrl(rel);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(m.PathRefusedError);
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------- 驗收補測(測試 agent,T2c-1 驗收時加)

describe('acceptance: TS never rewrites the path it hands to invoke (whitespace, NUL, dots)', () => {
  // 突變:read 先 trim 再送出,既有的「原樣」測試沒有任何帶空白的路徑,所以綠。
  const ODD = [' cards/a.md', 'cards/a.md ', '\tcards/a.md\n', 'cards/a.md\u0000.png', 'cards//a.md', './cards/a.md', 'cards/a.md.'];

  it.each(ODD)('read(%j) reaches invoke bit-for-bit', async (path) => {
    const m = await mod();
    invoke.mockResolvedValueOnce('x');
    await m.createLearningFs({ os: 'linux' }).read(path);
    expect((invoke.mock.calls[0] as [string, { relPath: string }])[1].relPath).toBe(path);
  });

  it.each(ODD)('write(%j) reaches invoke bit-for-bit', async (path) => {
    const m = await mod();
    invoke.mockResolvedValueOnce(null);
    await m.createLearningFs({ os: 'linux' }).write(path, 'c');
    expect((invoke.mock.calls[0] as [string, { relPath: string }])[1].relPath).toBe(path);
  });

  it.each(ODD)('exists(%j) reaches invoke bit-for-bit', async (path) => {
    const m = await mod();
    invoke.mockResolvedValueOnce(false);
    await m.createLearningFs({ os: 'linux' }).exists(path);
    expect((invoke.mock.calls[0] as [string, { relPath: string }])[1].relPath).toBe(path);
  });

  it.each(ODD)('list(%j) reaches invoke bit-for-bit', async (path) => {
    const m = await mod();
    invoke.mockResolvedValueOnce([]);
    await m.createLearningFs({ os: 'linux' }).list(path);
    expect((invoke.mock.calls[0] as [string, { relDir: string }])[1].relDir).toBe(path);
  });

  it('write passes the content bit-for-bit too (no trailing newline added, no trimming)', async () => {
    const m = await mod();
    invoke.mockResolvedValueOnce(null);
    const content = '  spaced  \r\n\u0000tail';
    await m.createLearningFs({ os: 'linux' }).write('cards/a.md', content);
    expect((invoke.mock.calls[0] as [string, { content: string }])[1].content).toBe(content);
  });
});
