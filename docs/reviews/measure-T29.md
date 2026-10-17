# T29 量測(-e5,2026-10-17;只印數字,不改測試、不改產品碼)

被量的版本:main bff8c9e(clone 的 `t24-red` 已 merge 到這個點)。機器 8 核;`/tmp`、clone 與 scratchpad 同在 `/dev/nvme1n1p2`(ext4)。
量測當下重活位子在前端(tauri build 進行中),load average 1.8 / 2.6 / 3.3;`/proc/pressure/io` full avg10 = 0.00。
單跑一律 `VITEST_MAX_WORKERS=1 vitest run scripts/mutate.test.ts scripts/run-tests.test.ts --reporter=json`;沒起 cargo、cucumber。

## 1. 單跑耗時(連 3 次,毫秒)

| 測試 | 單跑 | 整鏈逾時那次 |
|---|---|---|
| mutate「超過 2 小時的鎖也算殘鎖,清掉重拿」 | 3.6 / 3.2 / 3.9 | 16081(bff8c9e r1) |
| mutate「活鎖時每 15 秒重試一次…」 | 8.6 / 8.3 / 7.8 | 7604(bff8c9e r1) |
| run-tests「三個根:鎖被別人握著照樣立刻跑」 | 5.2 / 3.9 / 3.6 | 5746(06209d6 r1) |

檔案層:mutate.test.ts 單跑 12.4 秒(185 條),整鏈失敗那幾次 31.5 / 51.5 / 52.4 秒(2.5–4.2 倍);run-tests.test.ts 單跑 0.94 秒(80 條),整鏈失敗那次 11.4 秒(**12 倍**)。
整鏈只有失敗的檔會印檔案層耗時,所以沒逾時那幾次沒有對照數字(要等整鏈開 JSON reporter)。
單跑最慢的條目不是這三條:mutate「兩個行程同時搶,只有一個拿到」8.0 秒(真行程,重複 3 次都 8.0 秒,像是固定等待)、run-tests「真的兩個行程…」0.63–0.68 秒。

## 2. isPartialRun / testRoots 對 REPO_ROOT 掃目錄

規則同 `scripts/run-tests.ts`(略過 node_modules、dist、target、coverage、reports 與點開頭目錄;找到第一個 `*.test.ts` 就停)。

| 簽出 | 頂層目錄數 | 全部 readdir 次數 | 掃到的項目數 | `testRoots()` 5 次 | `isPartialRun(3 根)` 3 次 |
|---|---|---|---|---|---|
| clone(`t24-red`) | 7 | 77 | 557 | 1.64–2.29 ms | 1.86–2.14 ms |
| 主簽出(只讀) | 9 | 98 | 642 | 1.67–2.42 ms | 1.67–1.87 ms |

沒有任何一個頂層目錄超過 2.5 ms。`target/` 與 `node_modules/` 在掃描規則裡整個略過,所以 `apps/desktop/src-tauri/target` 預熱後不會被走進去(規則是照名字略過,不看大小)。
結論:**掃目錄約 2 毫秒、不是 5.7 秒的來源**(這個檔案系統上;整鏈的簽出多出來的目錄沒有量,見第 5 節)。

## 3. `tryAcquire`(含 fsync)耗時

| 條件 | 30 次的中位 | p90 | 最大 |
|---|---|---|---|
| 空閒 | 0.95 ms | 1.32 ms | 6.49 ms |
| 另一個行程連續 `dd bs=1M count=300 conv=fsync`(同一個檔案系統) | 2.46 ms | **5016 ms** | **6754 ms** |
| 同上,第二次(風暴尾聲) | 0.97 ms | 31 ms | 45 ms |

→ fsync 在同檔案系統有別人大量 fsync 寫入時,單次可以停 5–7 秒。**這能重現 IO 型。**

## 4. 兩個檔在 fsync 風暴下(dd 風暴同上,另一個行程;連 1 次)

| 測試 | 耗時 | 結果 |
|---|---|---|
| mutate「活鎖時每 15 秒重試一次…」 | **7782 ms** | **逾時 5000 → 紅**(跟整鏈 7604 ms 同量級) |
| mutate「超過 2 小時的鎖也算殘鎖,清掉重拿」 | 320 ms | 綠 |
| run-tests「三個根:鎖被別人握著照樣立刻跑」 | 3.2 ms | 綠 |
| mutate.test.ts 整檔 | 41.9 秒 | (單跑 12.4 秒) |
| run-tests.test.ts 整檔 | 1.3 秒 | (單跑 0.94 秒) |

## 5. 讀法與沒量到的

- **(a) IO 停頓型:重現了。** 風暴下 mutate 檔 41.9 秒(整鏈 31–52 秒)、`活鎖時…` 7.8 秒逾時;被拖慢的是「準備階段用 `tryAcquire` 的 fsync」那幾條,停頓落在哪一條是碰運氣(這次落在 `活鎖時…`,整鏈那次落在 `超過 2 小時…` 與 `活鎖時…`)。
- **(b) 非 IO 型(run-tests「三個根…」):沒有重現。** 風暴下它只要 3.2 ms;`isPartialRun` 掃目錄 2 ms、`holdLiveLock` 只有一次 `tryAcquire`(空閒 1 ms)。整鏈那次 run-tests.test.ts 整檔 11.4 秒是單跑的 12 倍,而同時段 `/proc/pressure/io` 沒有超過 300 ms 的 full 停頓 → 要嘛不是磁碟(CPU / 事件迴圈 / 別的行程佔住),要嘛是 PSI 看不到的東西。**我不知道原因**,也沒有證據支持「掃目錄」。
- 沒量:整鏈簽出(`verify-*`)裡的目錄大小(那個簽出多的頂層目錄沒量);整鏈裡每條測試的耗時(等下一次起鏈開 JSON reporter);整鏈同時段的 CPU 前幾名行程。
- 下一次起鏈建議加(只在驗證簽出,不進版控):`--reporter=json --outputFile=…`,另外每秒記 `ps -eo pid,pcpu,etime,args --sort=-pcpu | head -5` 與 `/proc/pressure/{cpu,io,memory}`,逾時那一刻才對得上是誰。
- 修法含意(給顧問):(a) 照工單把 fixture 改成 `writeFileSync` 會繞過 fsync,風暴下那幾條就不會逾時;但 (b) 沒有證據是 fsync,工單的修法不一定救得了它,先別在 (b) 上動手。
