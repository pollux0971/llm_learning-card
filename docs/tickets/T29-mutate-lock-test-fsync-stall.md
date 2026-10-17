---
id: T29
deps: []
touches: [scripts/mutate.test.ts, scripts/run-tests.test.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 鎖測試的斷言被放寬、刪掉或改成 `toBeDefined` 之類不量值的寫法(為了讓它不逾時):原本的每一條斷言必須仍在,而且丟棄式改壞(例如 `acquireLock` 不清超過 2 小時的鎖、`RETRY_INTERVAL_MS` 少一半)仍然紅
  - 為了過關把全域 `testTimeout` 調大,或把逾時加在跟真 I/O、真行程無關的測試上:只准加在量到「鏈內耗時遠大於單跑」的那幾條,而且每條要寫理由
  - 改了 `scripts/mutate.ts`、`scripts/run-tests.ts` 或它們的行為(拿鎖、清殘鎖、重試間隔、2 小時規則、90 分鐘上限、超集規則):既有行為測試必須紅;這張只動測試
---

# 工單 T29:scripts 測試在整鏈裡偶發撞 5 秒逾時,先量再修

> 狀態:**顧問裁決 2026-10-17 第二次改寫(範圍擴大,fsync 假說已被推翻)**。優先度:**低,排在 T24 推出之後**。
> 作者:協調者(短版)。測試改動:-e5。驗收:-ed。**這張不改產品碼。**

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

## 要做什麼

1. **先量**(-e5 或 -ed;不改程式,量測用的修改不進 git):
   - 之後的整鏈開 vitest 的 JSON reporter(只在驗證簽出裡加,不進版控),拿每條測試的鏈內耗時。
   - 列出鏈內耗時超過 2 秒、或是單跑時間 3 倍以上的測試。範圍:scripts 底下「做真 I/O 或起真行程」的測試。
   - 同時每秒取樣 `/proc/pressure/io`(協調者已有取樣腳本放在 scratchpad)與 load,對得上才說是磁碟;對不上就老實寫「不是磁碟」。
   - 記 `tmp()` 落在哪個檔案系統(協調者 2026-10-17 量到:`/tmp` 與 `/` 同在 `/dev/nvme1n1p2`)。
2. **修法**(只對量到的那幾條):
   - 準備階段用 `writeFileSync` 直接寫鎖檔內容,**不要用被測的 `tryAcquire` 造 fixture**(準備不該依賴被測函式,也少一次 `fsync`)。鎖檔格式不變;`tryAcquire` 自己的 `fsync` 行為仍由專門的測試覆蓋。
   - 仍會真的起行程、寫鎖檔、`fsync` 的測試,**單條**設明確逾時(例如 30 秒),註解寫理由並引用量測。**不調全域 `testTimeout`,不改產品碼。**
3. 斷言強度不變:每條原有斷言都在;驗收者對每一條有改動的測試做一個丟棄式改壞,確認會紅。

## 驗收

- 先量的結果寫進 `docs/reviews/`(只印數字,不貼 `learning/` 內容)。
- 選定修法後:`scripts/mutate.test.ts`、`scripts/run-tests.test.ts` 全綠;再在**高 load**(同時跑 `VITEST_MAX_WORKERS=1` 的整套測試)下連跑 3 次都綠。
- `npm run check:all` 綠;沒有未登記的新 `scripts/*.ts`。

## 不在範圍

- `degraded-report.test.ts` 那種內層 vitest 慢,是另一個問題,見 SKILL §4e。
- `apps/test-card/dev/standalone.test.ts` 的 vite 收尾卡住:那是 T24 的補丁,不在這張。
- 改 `mutate.ts` 的重試間隔、2 小時、90 分鐘規則;改 `run-tests.ts` 的超集規則。
