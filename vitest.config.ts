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
    // scripts/ 底下是掃描器(boundaries / standalone / doc-links)。它們的測試也要跑,
    // 否則「掃到 0 個就 FAIL」那條規則沒有人守。
    // features/support/ 是給「步驟用得到、但不含 cucumber 相依」的純輔助模組。
    // 測試不能放在 features/steps/:cucumber 的 import glob 會把那裡的每個 .ts
    // 都載進自己的行程,vitest 的 describe() 在那裡會炸掉。
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'scripts/**/*.test.ts',
      'features/support/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      // 行覆蓋率只是及格線。真正的品質由 mutation testing 決定,見
      // .claude/skills/mutation-testing/SKILL.md
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
