/**
 * 驗收 A:內建 asset: 關閉(enable false、scope 空),直接用 asset: URL 讀 learning/ 內的檔會被拒。
 * fixture 只建在 mkdtemp,不碰真的 learning/。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { requestBuiltinAsset } from './shell-config.js';
import { BUILD_LC_FS_TIMEOUT_MS, buildLcFs } from './test-support/build-lc-fs.js';

const CONF = new URL('../src-tauri/tauri.conf.json', import.meta.url);
const CARGO = new URL('../src-tauri/Cargo.toml', import.meta.url);

describe('builtin asset: protocol is off', () => {
  // requestBuiltinAsset 會 spawn 預先編好的 target/debug/lc-fs;乾淨簽出沒有它,舊檔也可能是上一輪的。每次重編。
  beforeAll(() => {
    buildLcFs();
  }, BUILD_LC_FS_TIMEOUT_MS);

  it('tauri.conf.json sets assetProtocol.enable false and scope empty', () => {
    const conf = JSON.parse(readFileSync(CONF, 'utf8')) as {
      app: { security: { assetProtocol?: { enable: boolean; scope: string[] } } };
    };
    expect(conf.app.security.assetProtocol).toEqual({ enable: false, scope: [] });
  });

  it('Cargo.toml does not enable the protocol-asset feature', () => {
    const cargo = readFileSync(CARGO, 'utf8');
    expect(cargo).not.toMatch(/protocol-asset/);
  });

  it('an asset: URL for a file inside learning is refused and the file is not read', () => {
    const root = mkdtempSync(join(tmpdir(), 'lc-asset-'));
    try {
      mkdirSync(join(root, 'cards'));
      writeFileSync(join(root, 'cards', 'a.md'), 'SECRET');
      const r = requestBuiltinAsset(root, 'cards/a.md');
      expect(r.refused).toBe(true);
      expect(r.fsCalls).toEqual([]);
      expect(readFileSync(join(root, 'cards', 'a.md'), 'utf8')).toBe('SECRET');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
