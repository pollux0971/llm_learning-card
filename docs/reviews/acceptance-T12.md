# 驗收證據:T12 子卡不得重述父卡、regenerate 一卡一概念(第 3 輪,含第 2 輪程式的完整驗收)

驗收角色:-ed(測試·驗收)。日期:2026-10-16/17(Asia/Taipei)。
被驗分支:`t12-opencode` @ `ffb8422`(第 3 輪 4308996 prompt、ffb8422 報告;第 2 輪 6bda1ec 之前的程式沒變)。起點 `t12-start`(c2e8486 = main abfe72b + -e5 的紅測試 f5cdea5)。
驗收簽出 `acceptance-t12`(分支 `pollux0971/t12-accept-tests`,只加這份證據與一個補測檔)。不合併、不 push、沒改 worker 的任何檔。
prompt 品質由顧問評分(第 3 輪全部 5/5),我只驗程式與流程,不評 prompt 品質。

## 0. 結論

**通過,程式沒有阻擋項;一處測試缺口已補。** 機器指標程式(parent-child-overlap.ts、cli.ts)與第 2 輪的 blob sha 完全相同,第 3 輪只動兩個 prompt 檔與報告。
26 個改壞版本(工單 must_catch 對應)23 個一次就紅;3 個存活(B5、B12、B14)是**測試缺口**,補 3 條測試後全紅。Stryker(parent-child-overlap.ts)補測前 60.08%、補測後 **83.40%**,高於標準 80%。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| J-1 | 測試缺口,已補 | (a) B12:`maxOverlap` 改成只看最後一個 key,測試全綠(沒有「最大值不在最後一個 key」的案例);(b) B14:同一邊 key 出現兩次不報錯,測試全綠(那條錯誤路徑沒有測試);(c) B5:pairs 不排序,測試全綠(輸入 id 本來就按字串順序) | 補 `parent-child-acceptance.test.ts`(20 條:跨 key 最大值、重複 key、排序 p10<p2、各條載入器錯誤路徑與訊息、issue 的 detail 內容、opts 傳遞、title 缺省等);B5/B12/B14 補測後全紅 |
| J-2 | 流程確認 | 第 3 輪新增與刪除的 prompt 行**不含**資安關鍵詞(CORS、預檢、同源、OPTIONS、Access-Control、萬用、預設埠、same-origin、cors、preflight):新增行 0 個命中;兩個 prompt 整檔 0 個命中。範例全改成歷史主題(締約、奏摺、改元、通商、兩稅法) | 確認 |
| J-3 | 流程確認 | golden 證據:協調者在乾淨主簽出暫時套上 worker 的兩個 prompt、`--live`、`--out` 在 golden/ 外、跑完還原。兩組 run 的 `prompt.snapshot.md` 與 ffb8422 的兩個 prompt 檔**逐字相同**(diff 無差異)——證明跑的就是交件的 prompt;meta 的 promptFileGitCommit 是 `-dirty`(暫時套用,所以按 T11 規則沒寫進 golden/)。worker 的分支沒有動 golden/ 或 fixtures | 確認;「合併後在乾淨 main 重跑存成 2026-10-16 基準」待合併後 |
| J-4 | 流程確認 | overlap 我自己重跑(`prompt-check.ts --overlap <第 3 輪 children run> <2026-10-15 cards 基準>`):**0 對**,最高 0.147(門檻 0.300);與協調者的 overlap.log 一致。三個輸入:cors 父4×子3、preflight 父3×子3、same-origin 父4×子3,各 0 對 | 確認 |
| J-5 | 備註 | 跨主題重複兩處歸 T18(同層卡之間的重複),不算 T12 | 依協調者 |
| J-6 | 成本 | worker 累計 cost $14.16(只記錄,工單預算 $1);golden 合計 $0.134(三輪:$0.0349、$0.0535、$0.0457) | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 detached @ ffb8422(node_modules 從別的驗收簽出複製),沒有 `.env`。開跑 tree sha(ffb8422)`43df14df7f966360a29d974a5c9708899465a480`。
- **測試作者檢查**:worker 全部 commit(第 1–3 輪共九個)測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures、golden/)變動 **0**;第 3 輪的檔案只有 children.md、regenerate.md、報告。紅測試 `parent-child-overlap.test.ts`、`parent-child-cli.test.ts` 與 fixtures 全來自 -e5 的 f5cdea5。
- **程式 sha 比對**:`parent-child-overlap.ts` blob `4b46d9214b8665fc4b4b8f57386d6078190a6875`、`cli.ts` blob `166f48a0423261b926c204f027e3f39ae1b2dfae`,在 6bda1ec 與 ffb8422 相同。
- `git log --name-only t12-start..ffb8422 | grep -c mutants.out` = 0。與最新 main(699e74b)的 `git merge-tree`:無衝突。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned=291) |
| `npm run lint:docs` | PASS |
| vitest `packages/core/src/prompt-quality` | 17 檔 339 綠(含 -e5 的 44 條) |
| prompt 改動的 golden run | 見 J-3、J-4(協調者 `--live` 跑,顧問評分;驗收端不花錢) |

## 3. 改壞版本(26 個:改一處實作 → 跑 prompt-quality 全部 339 條 → 還原)

| 編號 | 改壞 | 結果 |
|---|---|---|
| A1a | 門檻 0.3 → 0.31 | 紅(3) |
| A1b | 門檻 0.3 → 0.29 | 紅(1) |
| A1c | `>=` 改成 `>` | 紅(4) |
| A1d | 門檻往下調到 0.15(為了抓人判那一對) | 紅(5) |
| A2 | 只比標題不比內文(overlap 恆 0) | 紅(16) |
| A3a | 分母取兩邊較多的 | 紅(10) |
| A3b | 分母只取子卡那邊 | 紅(8) |
| A3c | 分母只取父卡那邊 | 紅(3) |
| A4 | 把子卡與子卡也拿來比 | 紅(7) |
| A5 | example 圍欄參與比對 | 紅(1) |
| A6a | `--overlap` 有對時退出碼仍 0 | 紅(2) |
| A6b | 空目錄回 0 對而不是錯誤 | 紅(1) |
| A6c | key 對不起來時不報錯 | 紅(3) |
| A6d | 錯誤時退出碼 0 | 紅(3) |
| B1 | 兩邊空標題也算標題相同 | 紅(1) |
| B2 | 標題相同不算 | 紅(2) |
| B3 | reason 顛倒 | 紅(5) |
| B4 | 沒有子卡時 rate 變 NaN | 紅(1) |
| B5 | pairs 不排序 | **存活**(補測後紅) |
| B7 | n-gram 大小改 2 | 紅(9) |
| B9 | `--threshold` 不合法時不報錯 | 紅(1) |
| B10 | 缺目錄參數不報用法 | 紅(1) |
| B11 | key 取最後一個 `-` 之後 | 紅(4) |
| B12 | maxOverlap 不跨 key 取最大 | **存活**(補測後紅) |
| B13 | totalPairs 沒累加 | 紅(1) |
| B14 | 同一邊 key 重複不報錯 | **存活**(補測後紅) |

對照工單 must_catch:門檻放寬(A1a–A1d)、只比標題(A2)、分母取錯(A3a–c)、同層也比(A4)、example 圍欄參與(A5)、`--overlap` 退出碼永遠 0 或空目錄/key 對不起來回 0 對(A6a–d)。「為抓人判那一對把門檻往下調」= A1d 紅(基準上同一個門檻會多抓 6 對)。最後一條(改 prompt 卻沒跑 golden、或 dirty prompt 寫進 golden/)是流程:J-3。

## 4. Stryker(parent-child-overlap.ts,測試 = prompt-quality 全部,標準門檻 80%)

`stryker.t12.json`(驗收用,不進版控,已刪):補測前 **60.08%**(152 殺 / 101 活);補測後 **83.40%**(211 殺 / 42 活)。
剩下 42 個存活:
- `overlapCoefficient` 的 `<` / `<=` 與 `small, large` 的 `<=` / `<`:兩邊大小相等時選哪一個結果相同(等價);
- 載入器與 `runParentChildChecks` 的錯誤訊息、issue detail 的措辭片段(測試釘訊息的關鍵字,不釘每個標點與空白);
- 其餘為字串字面與陣列初值的切分,觀察不到行為差。

## 5. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(協調者確認的基準,含他 golden 的 6 筆) | 64 | 03b3ca76e6cf509a | 90 |
| 跑完後 | 64 | 03b3ca76e6cf509a | 90 |

前後相同;全程只讀。

## 6. grok

這張的程式沒變、第 3 輪只動 prompt 文字,顧問已評分達標;沒有另跑對抗審核(新增程式行為由 26 個改壞版本與 Stryker 驗證)。

## 7. 待合併後

協調者合併後會在乾淨 main 重跑兩組 golden 存成 2026-10-16 基準(T11 會擋 dirty);這份證據寫「待合併後重跑」。

## 8. 結論

通過(程式無阻擋項;prompt 第 3 輪達標、關鍵詞檢查乾淨、golden 證據吻合);測試缺口 J-1 已補,補測檔建議隨 worker 分支一起進 main。
