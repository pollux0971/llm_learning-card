/**
 * 「the fake router fixtures directory is renamed away」這句步驟的取 router 規則。
 *
 * 這句話同時被 I1 與 I2 兩個 feature 借用,但兩邊的 Background 不一樣:
 *
 *   I1  Background 有「a cloud LLM provider is configured and reachable」,會留下 router
 *   I2  Background 只鋪 learning 目錄,不設 router
 *
 * 只寫 `state.router ??= build()` 可以讓 I2 跑起來,但會**把一個本來該紅的情況變成綠**:
 * I1 的 Background 如果哪天不再留下 router,「The pipeline works without any fake in
 * the loop」這個場景會自己就地生一個,安靜地變綠(其他 I1 場景會紅在
 * runIngestPipeline 裡的 `Cannot read properties of undefined`,但這個場景不會)。
 * 這支檔案存在的理由就是把那個保護留住:**跑過 I1 Background 的場景一律要求
 * Background 真的留下 router**,只有沒跑過的(I2)才就地建。
 *
 * 抽成沒有 cucumber 相依的純函式,是為了能被 `_router-guard.test.ts` 直接鎖住——
 * 步驟定義檔一 import 就會註冊 step,沒辦法在 vitest 裡安全載入。
 *
 * 為什麼在 `features/support/` 不在 `features/steps/`:cucumber 的 import glob
 * 會把 features/steps 底下每一個 .ts 都載進自己的行程,包含測試檔——
 * vitest 的 describe() 在 cucumber 行程裡跑會直接炸掉
 * (實測 `TypeError: Cannot read properties of undefined (reading 'config')`)。
 * 放在隔壁目錄,cucumber 只會透過步驟檔的 import 拿到這支純函式,拿不到測試。
 */

export interface RenamedAwayState<R> {
  /** I1 的 Background 跑過就是 true。I2 的 Background 不會設。 */
  cloudProviderConfigured?: boolean;
  router?: R;
}

/**
 * 回傳這個場景該用的 router。
 *
 * - Background 宣告過 provider:router 一定要在,不在就丟例外(**不會**就地補一個)
 * - Background 沒宣告過(I2 借用這句):就地建一個真的 cloud router
 */
export function resolveRenamedAwayRouter<R>(state: RenamedAwayState<R>, build: () => R): R {
  if (state.cloudProviderConfigured) {
    if (!state.router) {
      throw new Error(
        'Background 的 "a cloud LLM provider is configured and reachable" 跑過了,卻沒有留下 router。' +
          '這個場景要驗的是「不靠 fixture 重播也能跑」,不是「就地生一個 router」——不會幫你補。',
      );
    }
    return state.router;
  }

  return (state.router ??= build());
}
