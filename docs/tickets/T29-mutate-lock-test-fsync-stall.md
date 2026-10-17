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
  - 為了過關把全域 `testTimeout` 調大,或把逾時加在跟檔案系統無關的測試上:只准加在確實會碰 `fsync` 的那幾條,而且要寫理由
  - 改了 `scripts/mutate.ts`(含只為測試速度去動 `fsync`)或它的行為(拿鎖、清殘鎖、重試間隔、2 小時規則、90 分鐘上限):既有行為測試必須紅;這張只動測試
---

# 工單 T29:`mutate.test.ts` 鎖測試偶發逾時(fsync 停頓),先量原因再修

> 狀態:**顧問裁決 2026-10-17(量測 + (b)+(a))**,待顧問審字面。優先度:**低,排在 T24 推出之後**。
> 派令:顧問 2026-10-17(同一條測試在兩次整鏈各逾時一次,第二次起開單)。
> 作者:協調者(短版)。測試改動:-e5。驗收:-ed。**這張不改 `scripts/mutate.ts` 的行為。**

## 為什麼有這張

整鏈裡 `scripts/mutate.test.ts` 偶爾逾時 5000ms,單跑都綠,而且很快:

| 次 | 哪條 | 鏈內 | 單跑 |
|---|---|---|---|
| T22 鏈(d11ccfa 之前) | 活鎖時每 15 秒重試 | 6364ms | 綠 |
| T24 鏈(9e0a18c,2026-10-17 15:02–15:21) | 超過 2 小時的鎖也算殘鎖,清掉重拿 | 6344ms | **3 ms** |

## 原因不是時鐘(協調者 2026-10-17 讀程式量到的)

顧問開單時的假設是「這些測試靠真時間,改成假計時器」。**實際上這幾條已經在用注入的假時鐘**(`fakeClock()` 傳 `now`、`sleep`;`acquireLock` 的 `now` / `sleep` / `isAlive` 都是注入點),單跑 3–16 ms,沒有任何一處真的睡。

慢在**測試準備**那一步:`tryAcquire()` 寫鎖檔時呼叫 `fsyncSync(fd)`(`scripts/mutate.ts` 的 `tryAcquire`),整鏈跑的時候磁碟在大量寫(cargo、node_modules、報告),`fsync` 偶爾停頓好幾秒。兩次都是 6.3 秒、都落在要先寫一個鎖檔的測試,和這個解釋一致;**還沒量到停頓本身**(沒有在鏈內記 `fsync` 耗時)。

## 要做什麼(顧問 2026-10-17 裁決)

顧問原本說「改假計時器」,沒打開測試檔就下的結論,已更正:這幾條已經用假時鐘;**每條測試做兩次 `fsync`**(準備階段呼叫一次被測的 `tryAcquire` 寫鎖檔,`acquireLock` 裡面再一次)。

1. **先量**(-e5 或 -ed;不改程式,量測用的修改不進 git):
   - 下一次整鏈時,每秒取樣 `/proc/pressure/io`(`some` 與 `full` 的 `avg10` 和 `total`;協調者已有取樣腳本放在 scratchpad,第 2 次 T24 整鏈就有一份資料),再用 vitest 的 JSON reporter 拿這兩條測試的耗時。要對得上:**慢的那幾秒,io 壓力是高的**。對不上就回報,不要硬套。
   - 記 `tmp()` 落在哪個檔案系統(協調者 15:32 量到:`/tmp` 與 `/` 同在 `/dev/nvme1n1p2`,和驗證簽出、cargo `target` 同一顆根分割區)。
2. **修法:(b) + (a),不做 (c)**:
   - **(b)** 準備階段用 `writeFileSync` 直接寫鎖檔內容,**不要用被測的 `tryAcquire` 造 fixture**(準備不該依賴被測函式,也少一次 `fsync`)。鎖檔格式不變;`tryAcquire` 自己的 `fsync` 行為仍由專門的測試覆蓋。
   - **(a)** 仍會真的走 `tryAcquire`(含 `fsync`)的鎖測試,**單條**設逾時(例如 30 秒),註解寫理由:「真 `fsync`,高 IO 時會停頓,引 T29 的量測」。不調全域 `testTimeout`。
   - **(c) 不做**:為了測試速度去改產品碼的 `fsync` 不值得(`scripts/mutate.ts` 第 305 行的註解已說明 `fsync` 只有掉電時看得出差別)。
3. 斷言強度不變:每條原有斷言都在;驗收者對每一條有改動的測試做一個丟棄式改壞,確認會紅。

## 驗收

- 先量的結果寫進 `docs/reviews/`(只印數字,不貼 `learning/` 內容)。
- 選定修法後:`scripts/mutate.test.ts` 全綠;再在**高 load**(同時跑 `VITEST_MAX_WORKERS=1` 的整套測試)下連跑 3 次都綠。
- `npm run check:all` 綠;沒有未登記的新 `scripts/*.ts`。

## 不在範圍

- 其他檔案的計時測試(`degraded-report.test.ts` 那種內層 vitest 慢,是另一個問題,見 SKILL §4e)。
- 改 `mutate.ts` 的重試間隔、2 小時、90 分鐘規則。
