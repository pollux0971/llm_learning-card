# 驗收證據:T3 B3' 第二輪實作與補測

- 被驗分支:t3b-impl2 = 3de5282a85d754d6ed786b6be832c49e69606e5d(基底 t3b-red3 = f60b8125aa41cd20e227646fa21dd874e644b46b)
- 驗收開跑與跑完的 tree sha:63d95c5c380f721b95235288c3f39490d6248260(i9)
- 日期:2026-10-27

## 結論
通過。

## 1. 補測 t3b-red3 的快速複驗
- 只改 `scripts/check-all-wrapped.test.ts`(+169/−1),74 條。
- 對舊實作(44db1bb):7 紅/67 綠,紅的是上限 2 條與 childArgs 5 條,與測試作者報的相同。
- 我另寫的丟棄式實作(不進 git、已刪):74/74 綠。
- 讀測試:測行為,不要求防禦碼存在(第二輪刪掉不可達守衛後仍全綠)。重入守衛、listener detach 由行為測(end 行恰一行、listener 數回到呼叫前)釘住,是真行為,不是防禦碼存在檢查。
- 備註:`childArgs` 的靜態接線測試用正規式 `childArgs(\w+, \w+, process.argv)`,只允許變數名當前兩個參數;若日後改成內嵌運算式會誤紅,屬輕微脆弱,不擋。
- 備註:3600000 的上限是這輪新增的規格(工單沒寫),測試與實作一致。
- 自選改壞 11 個(上限 >→>=、上限放寬 1、前導零、只拆 SIGINT、只拆 SIGTERM、slice(2)→slice(1)、拿掉重入守衛、空字串 workers、前導空白、下限 <→<=、childArgs 改傳入陣列):全紅,0 存活。

## 2. 第二輪實作(t3b-impl2)
- 相對 t3b-red3 只改 `scripts/check-all-wrapped.ts` 與報告;測試檔未動;`scripts/check-all.ts` sha256 3b776a6d… 不變。
- i9 暫存簽出(非鏈專用):wrapper 測試 74/74;zero-input-guard 789 過、174 skip、0 紅;tsc 無輸出;boundaries 398 PASS;check:steps 1297 個定義 PASS。
- 讀碼:刪掉不可達防禦碼(load 值守衛、訊號編號後備、kill 前檢查、啟動前訊號補轉);保留重入守衛與 detach;加上限 3600000;匯出 `childArgs`,CLI 用它組參數。
- 實跑(i9 暫存簽出,假 consumer,`npm run check:all -- --root`):綠鏈退出碼 0,stderr 有 start/sample/end,stdout 末行 `gate=all result=PASS`,stdout 無 `[chain-env]`;紅鏈退出碼 1、末行 `gate=all result=FAIL`。

## 3. 變異(Stryker CLI,i9,設定 `stryker.t3b-wrapper.json`,全分母)
- 109 個變異:102 殺、1 逾時、6 存活 → **94.50%**(目標 ≥80%)。第一輪是 67.86%。
- 存活 6 個:
  - 第 62 行取樣內的 running 守衛(計時器已清,等價)。
  - 第 129 行 argv1 為空(不可達)2 個。
  - 第 147–150 行 main 最外層 catch 4 個中的 4 個(其中 `.then(undefined, …)` 區塊、錯誤訊息字串、`process.exit(1)`;只在 `import.meta.resolve` 之類啟動期例外才會走到,測試不易觸發,低風險)。
  - 沒有真測試缺口。

## 4. 自選改壞(6 個,i9,實作檔)
kill 恆送 SIGTERM(2 紅)、起不來碼 127→126(3 紅)、main 恆 exit 0(3 紅)、取樣間隔乘 3(1 紅)、end 行改印 sample(16 紅)、訊號優先判斷拿掉(7 紅):全紅,0 存活。

## 5. 資料前後
learning/ 前後:64 檔 / 01d84e9c918e1cf4 / 111 行,相同。

## 6. 花費
worker 第二輪花費由協調者記錄;我這邊不知道。
