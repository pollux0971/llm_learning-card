---
id: T29
deps: []
touches: [scripts/mutate.test.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 鎖測試的斷言被放寬、刪掉或改成 `toBeDefined` 之類不量值的寫法(為了讓它不逾時):原本的每一條斷言必須仍在,而且丟棄式改壞(例如 `acquireLock` 不清超過 2 小時的鎖、`RETRY_INTERVAL_MS` 少一半)仍然紅
  - 為了過關把全域 `testTimeout` 調大,或把逾時加在跟真 I/O、真行程無關的測試上:只准加在量到「鏈內耗時遠大於單跑」的那幾條,而且每條要寫理由
  - 改了 `scripts/mutate.ts`、`scripts/run-tests.ts` 或它們的行為(拿鎖、清殘鎖、重試間隔、2 小時規則、90 分鐘上限、超集規則):既有行為測試必須紅;這張只動測試
---

# 工單 T29:mutate.test.ts 的鎖測試在 IO 停頓時撞 5 秒逾時

> 狀態:**顧問裁決 2026-10-17 第三次改寫(量測做完,收窄到 IO 型)**。量測見 [measure-T29.md](../reviews/measure-T29.md)。優先度:低。
> 作者:協調者(短版)。測試改動:-e5。驗收:-ed。**這張不改產品碼、不改 `scripts/run-tests.test.ts`。**

## 為什麼有這張

整鏈裡 scripts 底下做真 I/O、起真行程的測試,偶爾逾時 5000ms;單跑都綠而且很快。已知三條:

| 次 | 哪條 | 鏈內 | 單跑 |
|---|---|---|---|
| T22 鏈(d11ccfa 之前) | `mutate.test.ts` 活鎖時每 15 秒重試 | 6364ms | 綠 |
| T24 鏈第 1 次(9e0a18c,2026-10-17 15:02–15:21) | `mutate.test.ts` 超過 2 小時的鎖也算殘鎖,清掉重拿 | 6344ms | 3 ms |
| T24 鏈第 1 次(06209d6,2026-10-17 16:17–16:36) | `run-tests.test.ts` 三個根:鎖被別人握著照樣立刻跑 | 5746ms | 還沒量 |

## 原因不是時鐘,也不是(只是)fsync

- 這幾條已經用注入的假時鐘(`now`、`sleep`、`isAlive`),沒有真的睡。
- 原本的假說是「測試準備呼叫被測的 `tryAcquire` 會 `fsync`,整鏈寫磁碟時偶爾停頓好幾秒」。**2026-10-17 的量測把它推翻了**:06209d6 兩次整鏈都每秒取樣 `/proc/pressure/io`,`run-tests` 那條逾時的時間窗(第 1 次 16:21 之後)沒有任何一秒 full 停頓超過 300ms;第 2 次 16:44 之後沒有超過 200ms。所以**至少那一條不是磁碟停頓**。
- 更像是 CPU 或事件迴圈被佔住(單 worker 的整鏈裡同時有別的行程),或這條測試本身要掃目錄、起行程;**都還沒量**。

## 量測結果(-e5,2026-10-17,見 [measure-T29.md](../reviews/measure-T29.md))

- **IO 型重現**:另一個行程連續 `dd conv=fsync`(同檔案系統)時,`tryAcquire` 30 次 p90 5016 ms、最大 6754 ms(空閒中位 0.95 ms)。`mutate.test.ts` 在這風暴下「活鎖時每 15 秒重試…」7782 ms 逾時;整檔 41.9 秒(單跑 12.4、整鏈 31–52)。停頓落在哪一條是碰運氣。
- **非 IO 型沒重現**:`run-tests.test.ts`「三個根:鎖被別人握著照樣立刻跑」單跑 3.6–5.2 ms,風暴下 3.2 ms;掃目錄約 2 ms。整鏈那次整檔 11.4 秒(單跑 0.94 秒的 12 倍)而 PSI 沒停頓,**原因不明**。

## 要做什麼(只修 IO 型)

1. 範圍:`scripts/mutate.test.ts` 的鎖測試。準備階段改用 `writeFileSync` 直接寫鎖檔內容,**不要用被測的 `tryAcquire` 造 fixture**;鎖檔格式不變;`tryAcquire` 自己的 `fsync` 行為仍由專門的測試覆蓋。
2. 被測流程本身仍會走 `tryAcquire`(例如「活鎖時每 15 秒重試」裡 `acquireLock` 自己的那次)的測試,**單條**設明確逾時(例如 30 秒),註解寫理由並引 measure-T29.md 第 3、4 節。**不調全域 `testTimeout`,不改產品碼。**
3. 斷言強度不變:每條原有斷言都在;驗收者對每一條有改動的測試做一個丟棄式改壞,確認會紅。

## 驗收

- 在 -e5 量測用的那個 `dd` 風暴開著的同條件下,`scripts/mutate.test.ts` 連跑 3 次全綠;斷言數不減;改壞會紅。
- 沒開風暴時 `scripts/mutate.test.ts` 全綠;`npm run check:all` 綠;沒有未登記的新 `scripts/*.ts`。

## 待診斷(這張不修)

- `scripts/run-tests.test.ts`「三個根:鎖被別人握著照樣立刻跑」:原因不明。原因找到之前,它跟 T29 這一類一樣:整鏈裡紅了,在同一份簽出單步重跑,綠就收。下次整鏈在驗證簽出加診斷(vitest JSON reporter、每秒 `ps` 前 5 名 CPU、`/proc/pressure/{cpu,io,memory}`,都不進版控),逾時那一刻的取樣跟原本那幾個檔放一起。

## 觀察(這張不修)

- `mutate.test.ts`「兩個行程同時搶…」單跑固定 8.0 秒(3 次都一樣,像固定等待)。

## 不在範圍

- `degraded-report.test.ts` 那種內層 vitest 慢,是另一個問題,見 SKILL §4e。
- `apps/test-card/dev/standalone.test.ts` 的 vite 收尾卡住:那是 T24 的補丁,已完成。
- 改 `mutate.ts` 的重試間隔、2 小時、90 分鐘規則;改 `run-tests.ts` 的超集規則。
