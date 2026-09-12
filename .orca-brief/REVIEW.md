# reports-persist 收尾審核

判定：PASS（2026-09-12 完整 `check:all` 通過；詳見下列實測結果）。

## 完整守門

指令：`LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10 TEMPLATE_DIR=/data/python/dev-paradigm npm run check:all`

完整鏈為 19 項；開頭已實測 `check:json-duplicate-keys` 為 `gate=json-duplicate-keys result=PASS scanned=25`、新增的 `check:adr-numbers` 為 `gate=adr-numbers result=PASS scanned=52`、boundaries 為 `gate=boundaries result=PASS scanned=213`（納管 257 / 掃描 257）。完整命令未使用 fail-fast，所有 gate 結果均為 PASS；`check:all` 的成功退出碼為 0。

## 摘要自驗：先紅後綠

`scripts/reports-persist.test.ts` 現在掃 `reports/mutation/` 下所有 SHA 摘要；用檔內 `killed + timeout + survived + noCoverage` 重算 `(killed + timeout) / valid * 100`，四捨五入到兩位，再以 0.01 容差比對存檔 `score`。這段刻意不 import `mutate.ts`，所以 Stryker 改分數定義或寫入端與審核端漂移時會立刻變紅；沒有任何摘要時會印出 `mutation summary self-check: 0 summaries found`，不是靜默通過。

先把 `e7f8f00-scanner-mutatelock.json` 的 `score` 從 `94.29` 暫改成 `94.19`，執行 `npm test -- scripts/reports-persist.test.ts` 得到原文：

```text
AssertionError: e7f8f00-scanner-mutatelock.json: stored score 94.19 differs from recomputed 94.29 by 0.10: expected 0.10000000000000853 to be less than or equal to 0.01
```

逐位還原後用同一條指令回綠：`Test Files 1 passed (1)`、`Tests 7 passed (7)`。所有目前版控的 SHA 摘要也已重算為 delta `0.00`。

## Mutation 摘要與四分類判讀

### `73c6a0f-scanner-mutatelock.json`

指令：`npm run mutate -- stryker.scanner-mutatelock.json`。分數 79.07%（`(449 killed + 8 timeout) / (449 + 8 + 48 survived + 73 noCoverage)`）；四類為 Killed 449、Timeout 8、Survived 48、NoCoverage 73。Ignored 68、RuntimeError 0、CompileError 0、Pending 0 都被保存以供稽核，但依 Stryker 10 的 valid-mutant 定義不進分母；此檔是修補前基線，不能拿它宣稱現況已被守住。

### `e7f8f00-scanner-mutatelock.json`

指令：`npm run mutate -- stryker.scanner-mutatelock.json`。分數 94.29%（`(537 killed + 8 timeout) / (537 + 8 + 26 survived + 7 noCoverage)`）；四類為 Killed 537、Timeout 8、Survived 26、NoCoverage 7。Ignored 68、RuntimeError 0、CompileError 0、Pending 0 另存；26 個 Survived 是仍須逐個設計觀測／案例的真缺口，不以「等價變異」籠統結案。

7 個 NoCoverage 均在 raw 報告明示位置，沒有被歸咎於黑盒手法：

- id 504，`mutate.ts:719`，`strykerVersion()` 找不到套件的 `'unknown'` fallback。
- id 567，`mutate.ts:816`，摘要 metadata 的 `basename(configFileArg)`。
- id 568，`mutate.ts:819–822`，摘要寫入 catch block。
- id 570，`mutate.ts:820`，摘要寫入失敗的診斷字串。
- id 571，`mutate.ts:821`，`code === 0` 的 true 分支。
- id 572，`mutate.ts:821`，同條件的 false 分支。
- id 573，`mutate.ts:821`，`code === 0` 的 equality operator。

這七項都不是必須真的發 OS signal 或真的 kill process group 的 `spawnStryker` 路徑；可同行程測。未在本輪順手把分數改高，是因為現行 scanner 的 `include` 僅有 `scripts/mutate.test.ts` 與 `scripts/run-tests.test.ts`，排除了實際覆蓋這些摘要落盤路徑的 `reports-persist.test.ts`；這是下輪應補到同程式測試／scanner 範圍的具體缺口，不可稱為 ADR-049 允許的架構代價。

### `1c06514-scanner-runtestslock.json`

指令：`npm run mutate -- stryker.scanner-runtestslock.json`。第一次量到 57.87%（`125 killed / (125 + 0 timeout + 5 survived + 86 noCoverage)`）；四類為 Killed 125、Timeout 0、Survived 5、NoCoverage 86。Ignored 85、RuntimeError 0、CompileError 0、Pending 0 仍保存但不計分；這是首次量測，沒有為了數字好看而改測試，5 個 Survived 與 86 個 NoCoverage 是待逐項建立觀測的清單，不是「等價變異」的結論。

## 未修正但必須交接

- 上述 7 個 `mutate.ts` no-coverage 並非真的跨 OS/process-group 才可驗的行為；前輪把 `reports-persist.test.ts` 放在 scanner include 外，留下了可同行程補測的量測孔。此次只補摘要自驗護欄，沒有偽造較高分數或改 raw／contracts。
- `run-tests.ts` 的 86 個 NoCoverage 是新 scanner 第一次建立的基線；它們集中在 XML 解析、局部／全套判別與實際 spawn 路徑，尚未被逐 mutant 判決，不能以目前 57.87% 作為完成宣告。
