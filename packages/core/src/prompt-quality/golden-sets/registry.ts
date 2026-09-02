/**
 * golden set 登記表:每個 prompt 任務的固定輸入(FEATURE.md「開放問題」:先每個任務 3 個輸入)。
 *
 * Wave 0 phase-1 沒有真的 prompt(02/05 都還沒動工),所以這裡只登記一組自我測試用的
 * demo golden set,示範框架本身的機制。phase-2(需要 I1 + 03 phase-1)會登記真的任務,
 * 屆時把 promptFile 指到 packages/core/prompts/<task>.md。
 */
import type { GoldenSet, LlmTask } from '../types.js';

const GRADE_APPLY_SELFTEST: GoldenSet = {
  task: 'grade.apply',
  promptFile: 'packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md',
  inputs: [
    { id: 'demo-1', prompt: '[PQ_DEMO_1] 學生答案:CORS 是瀏覽器的同源保護機制。' },
    { id: 'demo-2', prompt: '[PQ_DEMO_2] 學生答案:同源政策跟 cookie 有關。' },
    { id: 'demo-3', prompt: '[PQ_DEMO_3] 學生答案:我不確定,大概跟安全性有關。' },
  ],
};

const REGISTRY: Partial<Record<LlmTask, GoldenSet>> = {
  'grade.apply': GRADE_APPLY_SELFTEST,
};

export const GOLDEN_SET_REGISTRY_FILE = 'packages/core/src/prompt-quality/golden-sets/registry.ts';

export function getGoldenSet(task: LlmTask): GoldenSet | undefined {
  return REGISTRY[task];
}

export function listGoldenTasks(): LlmTask[] {
  return Object.keys(REGISTRY) as LlmTask[];
}
