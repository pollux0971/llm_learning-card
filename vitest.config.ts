import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 行覆蓋率只是及格線。真正的品質由 mutation testing 決定,見
      // .claude/skills/mutation-testing/SKILL.md
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
