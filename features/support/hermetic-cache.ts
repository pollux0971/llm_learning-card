/**
 * T64:cucumber 行程的 XDG_CACHE_HOME 指到暫存目錄(純函式,vitest 測得到;hook 在 features/steps/_hermetic-cache.ts)。
 * 沒有這個,起子行程的步驟(例如 i2-review-loop 的 childEnv)會把 session 快取寫進使用者真的 ~/.cache/llm-learning-cards。
 * 工單:docs/tickets/T64-cucumber-hermetic-cache.md。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface HermeticCache {
  /** 這次建的暫存快取目錄 */
  dir: string;
  /** 刪掉暫存目錄,XDG_CACHE_HOME 還原成原本的值;原本沒設就刪掉這個鍵。重複呼叫無害 */
  restore: () => void;
}

export function installHermeticCache(env: NodeJS.ProcessEnv = process.env): HermeticCache {
  const had = Object.prototype.hasOwnProperty.call(env, 'XDG_CACHE_HOME');
  const before = env['XDG_CACHE_HOME'];
  const dir = mkdtempSync(join(tmpdir(), 'lc-cucumber-cache-'));
  env['XDG_CACHE_HOME'] = dir;
  let done = false;
  return {
    dir,
    restore() {
      if (done) return;
      done = true;
      rmSync(dir, { recursive: true, force: true });
      if (had) env['XDG_CACHE_HOME'] = before;
      else delete env['XDG_CACHE_HOME'];
    },
  };
}
