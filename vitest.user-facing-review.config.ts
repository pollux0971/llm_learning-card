import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `packages/core/src/session/io.ts` 走 `@contracts/*`。根 vitest.config.ts 有這組
  // alias,變異測試用的設定檔也要有,不然 zero-guard.test.ts 一 import 就解析失敗。
  resolve: {
    alias: {
      '@contracts': fileURLToPath(new URL('./packages/contracts/src', import.meta.url)),
      '@core': fileURLToPath(new URL('./packages/core/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    include: ['scripts/review.test.ts', 'packages/core/src/session/zero-guard.test.ts', 'packages/core/src/session/list-card-ids-order.test.ts'],
  },
});
