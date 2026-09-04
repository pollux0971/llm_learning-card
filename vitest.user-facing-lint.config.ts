import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 跟根 vitest.config.ts 對齊(見 vitest.user-facing-review.config.ts 的說明)。
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
    include: ['scripts/lint.test.ts', 'packages/core/src/lint/inventory.test.ts', 'packages/core/src/lint/inventory-order.test.ts'],
  },
});
