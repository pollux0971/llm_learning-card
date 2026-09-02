export * from './types.js';
export * from './validator-min.js';
export * from './scan.js';
export * from './checks.js';
export * from './report.js';
export * from './atomic-write.js';

import { scanDir } from './scan.js';
import { runChecks } from './checks.js';
import type { LintResult } from './types.js';

/** 對一個 learning 目錄跑完整的健檢。純函式,不寫任何東西。 */
export function lint(dir: string): LintResult {
  return runChecks(scanDir(dir));
}
