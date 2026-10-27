/**
 * 05-grading/phase-3(縮短版生成,T65)與別的功能「撞名」的兩句步驟的共用接縫。
 *
 * phase-3.feature 有兩句話,別的功能的步驟檔早就定義過了,cucumber 不准兩個定義長得一樣(會變成 ambiguous):
 *   - 「the network is available」   grading.steps.ts
 *   - 「the network is unavailable」 i1-content-pipeline.steps.ts
 * .feature 的措辭不能改,所以兩個原本的定義各加一行:場景帶 `@grading` 與 `@phase-3` 時,轉給這裡登記的處理函式,
 * 原本的行為完全不變(做法同 _llm-phase3-shared.ts,T59)。處理函式由 grading-phase3.steps.ts 載入時登記。
 *
 * 只寫 `@phase-3` 會碰到 03/06/07/10 的場景,所以兩個 tag 都要有。
 * 「the network is unavailable and a local model is running」(05 phase-4 第一個場景,teach-card-phase3.steps.ts 的另一句)
 * 是完整的另一句話,不撞名;phase-4 那張要接的時候,在這個檔多登記一個 hook 就好。
 */
import type { LearningWorld } from './_world.js';

export function isGradingPhase3(world: LearningWorld): boolean {
  return world.tags.includes('@grading') && world.tags.includes('@phase-3');
}

export const gradingPhase3Hooks: {
  network?: (world: LearningWorld, online: boolean) => void;
} = {};
