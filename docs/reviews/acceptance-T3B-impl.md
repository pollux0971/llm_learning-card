# 驗收證據:T3 B3' 實作(鏈輸出 wrapper)

- 被驗分支:t3b-impl = 44db1bb417a9642831d8e77f4941a2a5a7983533(起點 t3b-start ae71033)
- 驗收開跑與跑完的 tree sha:4153d8ed514f7276e69e9a5411f9f60ff5b9cb24(i9 與筆電兩份相同)
- 日期:2026-10-26

## 結論
**有阻擋項(1 個)**:變異分數 67.86%(全分母),低於 80%。其餘全過。

## 1. 範圍與作者
- 相對 t3b-start 只改:`scripts/check-all-wrapped.ts`(新)、`package.json`(只有 `check:all` 一行)、`scripts/zero-input-roster.ts`(抽出共用 `checkAllCommand`)、`scripts/boundaries.owners.json`(登記 +4)、`docs/reviews/T3B-implementation.md`。
- 測試檔、.feature、steps、fixtures:無改動。`scripts/check-all.ts` 位元組不變(sha256 3b776a6d… 與基底同)。
- 測試作者檢查:該分支唯一 commit 不含任何 `*.test.ts`。

## 2. 乾淨簽出與基準(i9 暫存簽出,非鏈專用)
- `ls .env` 失敗(沒有)。`npm ci` 後:
- tsc:無輸出(過)。boundaries:納管 398、PASS。check:steps:1297 個定義 PASS。
- `scripts/check-all-wrapped.test.ts`:47/47 綠。`scripts/zero-input-guard.test.ts`:789 過、174 skip、0 紅。
- doc-links(對含本證據的樹跑):見第 8 節。

## 3. 讀碼
- 輸出:`writeEnv` 只寫 `process.stderr`,前綴 `[chain-env]`;子行程 `stdio: 'inherit'`,wrapper 不經手位元組。
- 退出碼:正常原樣;被訊號殺掉 128 + 訊號編號(`os.constants.signals`);起不來 127 並仍印結束行。
- 訊號:SIGINT / SIGTERM handler 轉給子行程,自己等它結束;結束時 `process.off`。
- 計時器:`finish` 內 `clearInterval`,有重入守衛。
- tsx:`import.meta.resolve('tsx/cli')` 與 `new URL('./check-all.ts', import.meta.url)` 都是絕對路徑,不靠 cwd。
- `CHAIN_ENV_SAMPLE_MS` 驗證在 `main()` 起動 check-all 之前;壞值 `process.exit(2)`。
- roster:`checkAllCommand` 被 check-all 與 check-all-wrapped 同一個參考共用(未複製)。

## 4. 實跑(第 6 點;i9 暫存簽出,假 consumer,`npm run check:all -- --root <假 consumer>`)
- 全綠鏈:退出碼 0;stderr 有 `[chain-env] start`、`sample`(`CHAIN_ENV_SAMPLE_MS=100`)、`end` 三種行;stdout 最後一行是 check-all 自己的 `gate=all result=PASS scanned=1`,stdout 完全沒有 `[chain-env]`。
- 紅鏈(第一步 exit 3):`npm run check:all` 退出碼 1,與直接跑 check-all.ts 的 1 相同;stdout 末兩行含 `gate=all result=FAIL scanned=2`;stderr 有 2 行 `[chain-env]`(start、end)。
- `CHAIN_ENV_SAMPLE_MS=5`:退出碼 2,stderr 點名變數,鏈沒起。
- 沒有跑真的整鏈。

## 5. 變異(自備設定 `stryker.t3b-wrapper.json`,Stryker CLI,i9)
- 只改 `scripts/check-all-wrapped.ts`,測試 `scripts/check-all-wrapped.test.ts`;全分母、StringLiteral 不排除。
- 設定要點:`disableTypeChecks: false`。第一次沒設,Stryker 在沙箱的每個 .ts 前加 `// @ts-nocheck`,連模板檔 check-all.ts 也加,「sha256 不變」那條在初始跑就紅(工具副作用,不是實作問題);設了就乾淨。
- 結果:140 個變異,94 殺、1 逾時、45 存活 → **67.86%**(< 80%)。
- 存活 45 個分類(行號指實作檔):
  - 不可達或等價(約 37):第 32 行 load 值的 NaN/負值守衛(os.loadavg 不會給)14、第 52 行訊號編號後備 1、第 64 行取樣內 running 守衛 1、第 73 行 kill 前的已退出檢查 6、第 86–95 行 detach 與 `process.off` 4、第 104 行啟動前訊號補轉 2、第 109/113/114 行起不來路徑被 close 處理器重複蓋掉 4、第 142 行 argv1 為空 2、第 160–163 行 main 的最外層 catch 3。
  - 真測試缺口(約 9):
    1. 第 27 行:`VITEST_MAX_WORKERS=''` 應印 `default`(2 個)。
    2. 第 92/93 行:`finish` 重入守衛,起不來時 error 與 close 都來,應只印一行結束行(2 個)。
    3. 第 134 行:取樣值驗證的錨與前導零、前後空白(2–3 個;`abc`、`100abc` 目前靠後面的 Number 檢查擋掉,所以去掉正規式也綠)。
    4. 第 153 行:轉發的是 `process.argv.slice(2)`,換成整個 `process.argv` 仍綠(多餘參數 check-all 會忽略)。
- 如果清掉不可達的防禦碼(約 26 個變異消失)再補上面 4 條測試,分數會到 80% 以上;兩邊各做一半也行。

## 6. 自選改壞(15 個新點,筆電,在 `scripts/check-all-wrapped.test.ts` 上跑)
被抓到(6):stdio inherit→pipe(13 條紅)、isDirectRun 恆真(15 紅)、main 不 `process.exit`(3 紅)、onSignal 不轉(卡住,逾時收)、不註冊 SIGINT(卡住,逾時收)、錯誤訊息不點名變數(8 紅)。
存活(9):H1 load 守衛(不可達)、H2 空字串 workers(缺口)、H4 啟動前訊號補轉(等價)、H6 前導零放行(缺口,低)、H7 去掉 `isSafeInteger`(缺口:`CHAIN_ENV_SAMPLE_MS=99999999999999999999` 會讓 Node 把計時器壓成 1 毫秒並洗版 stderr)、H9 重入守衛(缺口)、H12 預設取樣值 30000→3000(缺口,低,不易測)、H14 detach(等價)、H21 `code ?? 1`→`?? 0`(不可達)。
- 另:第 3 節以外沒有發現實作與工單不符。

## 7. grok 審核
沒做(這張是小腳本,變異與手改壞已覆蓋);未證實項:無。

## 8. 資料前後、花費
- learning/ 前後:64 檔 / 01d84e9c918e1cf4 / 111 行,相同。
- 花費:worker 實際 US$2.18(只記錄,grok 不設限額)/ 工單預算 US$2 = 1.09 倍,未超過 2 倍。
