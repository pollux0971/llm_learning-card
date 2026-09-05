import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: true, environment: "node", testTimeout: 60000, include: ['scripts/check-standalone.test.ts', 'scripts/check-standalone.local.test.ts'] },
});
