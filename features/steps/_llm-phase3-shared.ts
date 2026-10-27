/**
 * 03-llm-router/phase-3(provisional 佇列,T59)與別的功能「撞名」的三句步驟的共用接縫。
 *
 * phase-3.feature 有三句話,別的功能的步驟檔早就定義過了,cucumber 不准兩個定義長得一樣(會變成 ambiguous):
 *   - 「the network is available」   grading.steps.ts
 *   - 「the network is unavailable」 i1-content-pipeline.steps.ts
 *   - 「a warning is logged」        review-cli-phase2.steps.ts
 * .feature 的措辭不能改,所以三個原本的定義各加一行:場景帶 `@llm-router` 與 `@phase-3` 時,轉給這裡登記的處理函式,
 * 原本的行為完全不變。處理函式由 llm-router-phase3.steps.ts 載入時登記。
 */
import type { LearningWorld } from './_world.js';

export function isLlmPhase3(world: LearningWorld): boolean {
  return world.tags.includes('@llm-router') && world.tags.includes('@phase-3');
}

export const phase3Hooks: {
  network?: (online: boolean) => void;
  warningLogged?: () => void;
} = {};
