/**
 * 殼的設定面(cucumber 與 vitest 用的測試支援,T2c-1 起歸測試 agent):內建 asset: 要關、自訂協定要開、
 * fs plugin 沒有權限。原本是 T2b 的 apps/desktop/src/shell-config.ts(工單 A4:probe 搬到測試支援的位置)。
 * 「前端載入」改由 frontend-dist.ts 的靜態檢查負責(驗收 F18),這裡的 frontEndStatus 已刪。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AssetProtocolStatus {
  customEnabled: boolean;
  scopeIsLearningRoot: boolean;
  scheme: string;
  builtinEnabled: boolean;
  builtinScope: string[];
  sameChecksAsRead: boolean;
}

export interface PluginRefusal {
  refused: boolean;
  by: 'plugin' | 'command';
  commandCheckCalled: boolean;
}

export interface BuiltinAssetResult {
  refused: boolean;
  fsCalls: { op: string; path: string }[];
}

const BIN = join(import.meta.dirname, '../../src-tauri/target/debug/lc-fs');

function readConf(repoRoot: string): {
  app: {
    security: { assetProtocol?: { enable: boolean; scope: string[] } };
  };
} {
  return JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
}

function probeStatus(): {
  scheme: string;
  customEnabled: boolean;
  scopeIsLearningRoot: boolean;
  sameChecksAsRead: boolean;
} {
  const r = spawnSync(BIN, { input: JSON.stringify({ op: 'status' }), encoding: 'utf8' });
  if (r.error) throw r.error;
  return JSON.parse(r.stdout) as {
    scheme: string;
    customEnabled: boolean;
    scopeIsLearningRoot: boolean;
    sameChecksAsRead: boolean;
  };
}

export function assetProtocolStatus(repoRoot: string): AssetProtocolStatus {
  const conf = readConf(repoRoot);
  const asset = conf.app.security.assetProtocol ?? { enable: true, scope: ['unset'] };
  const live = probeStatus();
  return {
    customEnabled: live.customEnabled,
    scopeIsLearningRoot: live.scopeIsLearningRoot,
    scheme: live.scheme,
    builtinEnabled: asset.enable,
    builtinScope: asset.scope,
    sameChecksAsRead: live.sameChecksAsRead,
  };
}

export function pluginDirectRead(repoRoot: string, _absPath: string): PluginRefusal {
  const caps = readFileSync(join(repoRoot, 'apps/desktop/src-tauri/capabilities/default.json'), 'utf8');
  const grantsFs = /"fs:|"plugin:fs|tauri-plugin-fs/.test(caps);
  return { refused: !grantsFs, by: 'plugin', commandCheckCalled: false };
}

export function requestBuiltinAsset(_root: string, _rel: string): BuiltinAssetResult {
  const r = spawnSync(BIN, { input: JSON.stringify({ op: 'builtin-asset' }), encoding: 'utf8' });
  if (r.error) throw r.error;
  const body = JSON.parse(r.stdout) as { refused: boolean; fsCalls: { op: string; path: string }[] };
  return { refused: body.refused, fsCalls: body.fsCalls ?? [] };
}
