/**
 * 變異測試專用的 vitest 設定:讓 stryker 只跑跟被變異的檔有關的測試。
 *
 * 為什麼要有這個檔:stryker 每一個 mutant 都重跑一次 vitest,全套 81 個測試檔的
 * 載入成本(實測約 21 秒 overhead)乘上幾百個 mutant 就是好幾個小時——
 * 一次 `--mutate` 四個檔曾經估到 10 小時,而別的資料夾的測試不會殺掉這些 mutant,
 * 跑了只是等。
 *
 * 用法:用 `MUTATE_TEST_GLOB` 指定這次要跑哪些測試,不給就跟 `vitest.config.ts` 一樣跑全部。
 *
 * ```bash
 * MUTATE_TEST_GLOB='packages/core/src/prompt-quality/**\/*.test.ts' \
 *   npm run mutate -- --mutate packages/core/src/prompt-quality/cli.ts
 * ```
 *
 * 縮小範圍是**加速**,不是放寬標準:縮掉的測試本來就殺不掉那些 mutant。
 * 縮太小的話分數會虛高,所以 glob 要蓋住被變異的檔的所有測試。
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const DEFAULT_INCLUDE = ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'];
const include = process.env.MUTATE_TEST_GLOB ? [process.env.MUTATE_TEST_GLOB] : DEFAULT_INCLUDE;

export default defineConfig({
  resolve: {
    alias: {
      '@contracts': fileURLToPath(new URL('./packages/contracts/src', import.meta.url)),
      '@core': fileURLToPath(new URL('./packages/core/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 縮了範圍還掃到 0 個測試檔,是 glob 打錯——不要當成「沒有測試要跑」放過去。
    passWithNoTests: false,
    include,
  },
});
