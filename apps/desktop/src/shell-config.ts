/**
 * 殼的設定面:內建 asset: 要關、自訂協定要開、前端不再是 placeholder、
 * fs plugin 沒有權限。測試釘簽名,實作換本體。
 */

export interface AssetProtocolStatus {
  /** 自訂協定(不是內建 asset:)有掛上,而且 scope 是 learning 根目錄 */
  customEnabled: boolean;
  scopeIsLearningRoot: boolean;
  scheme: string;
  builtinEnabled: boolean;
  builtinScope: string[];
  /** 自訂 handler 與 read command 跑同一份檢查(實作要真的比,不准寫死 true) */
  sameChecksAsRead: boolean;
}

export interface FrontEndStatus {
  teachLoaded: boolean;
  testLoaded: boolean;
  placeholderRemains: boolean;
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

export function assetProtocolStatus(_repoRoot: string): AssetProtocolStatus {
  throw new Error('T2b: assetProtocolStatus 尚未實作');
}

export function frontEndStatus(_repoRoot: string): FrontEndStatus {
  throw new Error('T2b: frontEndStatus 尚未實作');
}

export function pluginDirectRead(_repoRoot: string, _absPath: string): PluginRefusal {
  throw new Error('T2b: pluginDirectRead 尚未實作');
}

export function requestBuiltinAsset(_root: string, _rel: string): BuiltinAssetResult {
  throw new Error('T2b: requestBuiltinAsset 尚未實作');
}
