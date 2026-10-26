# 驗收證據:T3 B3' 鏈輸出 wrapper 紅測試

- 被驗分支:t3b-red = 854e01a067984ba2ecec45a640fb1988e12b3924(基底 82a1bc6)
- 驗收開跑 tree sha:371c331db1766321f3ec1e937a6fab9b65b7c12e(跑完同一個;丟棄式實作沒進 git)
- 日期:2026-10-26

## 結論
**有阻擋項(1 個)**:CLI 測試在 wrapper 壞掉(吃掉參數)時會起真的整鏈。其餘全過。

## 1. 範圍與作者
- 只動 `scripts/check-all-wrapped.test.ts`(+458)與 `scripts/boundaries.owners.json`(+4,只登記測試檔)。無 .feature。
- 作者:該 commit 唯一作者是測試 agent。`scripts/check-all.ts` sha256 與基底相同(測試釘 3b776a6d…)。

## 2. 基底紅綠
- 基底(無 wrapper):45 條中 43 紅、2 綠。綠的兩條是 check-all.ts 位元組釘死、測試檔 owners 登記,都是守門,對得上。
- 我自己寫的丟棄式 wrapper(不進 git、已刪)+ package.json 指向 + roster entry 共用 builder + owners 登記:45/45 綠。
- 同一份丟棄式實作下 zero-input-guard:789 過、174 skip、0 紅。

## 3. 阻擋項:測試可能起真的整鏈
做法:把丟棄式 wrapper 改成不轉發 `process.argv.slice(2)`(等於吃掉 `--root`),只跑一條 CLI 測試(CHAIN_ENV_SAMPLE_MS=250 合法)。
結果:真的整鏈起來了。行程樹出現 `npm run check:test-ledger` → `scripts/run-tests.ts`(全套 vitest)→ `cargo build --bin lc-fs`。
原因:`runCli` 的 cwd 是 repo 根;check-all 沒有 `--root` 時用 git 根,也就是真鏈。
影響:會跑全套 vitest(含這個測試檔本身,遞迴)與 cargo,在筆電或 i9 的鏈專用簽出都會出事。我手動殺乾淨了。
建議修法(測試端,由測試 agent 改):`runCli` 的 cwd 改成一個空的非 git 暫存目錄。我實測 check-all 在這種 cwd 且沒 `--root`:
印「找不到 package.json」、`gate=all result=FAIL`、退出碼 1,不起任何一步。建議再加一條測試:對壞 wrapper 也不會起真鏈(或至少所有 spawn 都用該 cwd)。
runner 那組(匯出函式)用的是假指令 `node -e`,沒有這個風險。

## 4. 自選改壞(14 個,都不是 a6 清單已知的;全在丟棄式 wrapper 上做)
| # | 改壞 | 結果 |
|---|---|---|
| M1 | 下限 <100 → <101 | 紅 6 條(100 合法 + 轉發組) |
| M2 | 下限 → <99 | 紅(99 該拒) |
| M3 | 數字檢查放寬(去掉尾端錨) | 紅(100abc) |
| M4 | 取樣改寫 stdout | 紅 5 條 |
| M5 | SIGTERM 編號 15→14 | 紅 2 條 |
| M6 | 只轉 SIGINT 不轉 SIGTERM | 紅 2 條 |
| M7 | 不清計時器 | 紅(卡住,撞 400 秒外層逾時,無摘要) |
| M8 | 起不來退出碼 127→0 | 紅 |
| M9 | workers 預設印 0 | 紅 |
| M10 | 時間戳不是 ISO | 紅 2 條 |
| M11 | 取樣間隔寫死 | 紅 |
| M12 | 被訊號殺掉回 0 | 紅 5 條 |
| M13 | 起不來不印結束行 | 紅 |
| M14 | 壞值退出碼 2→1 | 紅 8 條 |
另做:吃掉參數的壞版(見第 3 節)只跑到整鏈起來就停,未算紅綠。全部 14 個被抓到,0 存活。

## 5. 其他檢查
- tsc 無輸出(過);boundaries 納管 456、PASS;check:steps PASS(1297 個定義);zero-input-guard 見第 2 節。
- 讀測試:無對自己 mock 的同義反覆;逐字比對用的是直接跑 check-all.ts 當對照。沒有寫 learning/ 的程式碼(grep 0)。
- 備註(非阻擋):e 組的 SIGINT/SIGTERM 轉發測試依賴子行程 ready 字樣,在負載高時靠 30 秒等待,可接受。

## 6. 資料前後
learning/ 前後:64 檔 / 01d84e9c918e1cf4 / 111 行,相同。

## 7. 花費
測試作者與本次驗收沒有 LLM 花費;實際 / 預算:不知道(工單預算 US$2 是 worker 的)。
