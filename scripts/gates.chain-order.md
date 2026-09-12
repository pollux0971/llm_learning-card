# `--fail-fast` 下的排序原則

`--fail-fast` 下的排序原則:
enforce 模式、且能獨立失敗的步驟,依「執行成本」由小到大;
report 模式的步驟位置無關(它們不會中止鏈),放在最後。
`test` 之後只放真的依賴它產出的步驟。

事實:

- `docRot` 與 `phaseStatus` 是 `report` 模式,**結構上不可能觸發 fail-fast** ——
  所以「便宜的先」是錯的原則,把它們排前面是零收益的重排。
- `typecheck` 在 `test` 之前**不是相依**(vitest 走 tsx,不需要 tsc 的產出),是成本。
- `check:gates`(比 sha)與 `accept:coverage`(cucumber dry-run)**都不讀 test 的產出**,
  排在後面純粹是 append 的歷史。
- **現在的順序是浮現的,不是設計的。** 既有順序沒有權威,不要去猜它背後的用意。
