import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 跟 tsconfig.json 的 paths 對齊,讓 vitest 也能解析 @contracts/* 與 @core/*
    // (tsx 執行時原生支援 tsconfig paths,vitest 不會自動讀,所以另外設)。
    alias: {
      '@contracts': fileURLToPath(new URL('./packages/contracts/src', import.meta.url)),
      '@core': fileURLToPath(new URL('./packages/core/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 行覆蓋率只是及格線。真正的品質由 mutation testing 決定,見
      // .claude/skills/mutation-testing/SKILL.md
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
