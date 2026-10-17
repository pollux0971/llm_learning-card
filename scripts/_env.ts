/**
 * ADR-034:.env 只在 CLI 入口讀,library 只讀 process.env。
 * ADR-076:每次 start / submit 可以再呼叫 loadDotEnv();環境裡本來就有的變數永遠優先;
 * LC_REVIEW_ 開頭的鍵一律不從檔案設(除錯開關只能來自啟動環境)。
 *
 * 每個 CLI 入口在最前面 `import './_env.js'`(side-effect import)即可,那就是第一次載入。
 * 重讀不能再呼叫 process.loadEnvFile:它不覆蓋已經有的值,改了的鍵、刪掉的鍵都看不到。
 * 解析用 Node 內建的 parseEnv,跟 loadEnvFile 同一個解析器。
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const ENV_FILE = new URL('../.env', import.meta.url);

/** 第一次載入之前環境裡就有的鍵。永遠不動。 */
const presetKeys = new Set(Object.keys(process.env));

/** 上一次從檔案設進 process.env 的鍵。這次檔案沒有了就刪掉。 */
let fromFile = new Set<string>();

function readDotEnv(): { [key: string]: string | undefined } {
  try {
    return parseEnv(readFileSync(ENV_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function isReviewSwitch(key: string): boolean {
  return key.startsWith('LC_REVIEW_');
}

/**
 * 把 .env 現在的內容套進 process.env。檔案不在或讀不到 = 空檔案,不丟錯。
 * 回傳 process.env 有沒有因此改變。值不印、不寫進 log。
 */
export function loadDotEnv(): boolean {
  const parsed = readDotEnv();
  const nextFromFile = new Set<string>();
  let changed = false;

  for (const key of Object.keys(parsed)) {
    if (isReviewSwitch(key)) continue;
    if (presetKeys.has(key)) continue;
    const value = parsed[key];
    if (value === undefined) continue;
    nextFromFile.add(key);
    if (process.env[key] !== value) {
      process.env[key] = value;
      changed = true;
    }
  }

  for (const key of fromFile) {
    if (nextFromFile.has(key)) continue;
    if (presetKeys.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      delete process.env[key];
      changed = true;
    }
  }

  fromFile = nextFromFile;
  return changed;
}

loadDotEnv();
