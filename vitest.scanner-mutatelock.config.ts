import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: true, environment: "node", testTimeout: 60000, include: ['scripts/mutate.test.ts', 'scripts/run-tests.test.ts'] },
});
