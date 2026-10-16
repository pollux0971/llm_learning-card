# 驗收證據:T19 regenerate 的回應不要求 lines(02-ingest-pipeline 生產路徑)

驗收角色:-ed(測試·驗收)。日期:2026-10-16(Asia/Taipei)。
被驗分支:`t19-opencode` @ `e089710`(worker 兩個 commit:c407ce7 實作、e089710 報告);起點 `t19-start2` d49cad3(= t19-start f4599ca〔dcbd243 + 前端紅測試 7749d3e + 工單 v3〕併入 origin/main fdb0a75)。
驗收簽出 `acceptance-t19`(分支 `pollux0971/t19-accept-tests`,只加這份證據)。不合併、不 push、沒改 worker 的實作檔。紅測試作者:前端;起草:-e5;我是驗收者(三個角色各不同)。

## 0. 結論

**通過,無阻擋項,也沒有測試缺口。** 工單 must_catch 十二條都有改壞版本被抓到;23 個改壞版本**全部**紅。Stryker(generate-cards.ts)86.50%,高於 80%;22 個存活裡,T19 新增程式的存活全是等價(第 4 節)。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| K-1 | **顧問 Q3 的確認** | 字數判斷和 `validateCard` 走同一條路:`countBodyWords` 是 `countWords(parseCardText(CARD_FILE_PREFIX + body.trim() + '
').body)`,`countWords`、`parseCardText` 都從 `@core/schema/index.js` import;`generate-cards.ts` 沒有自抄圍欄正則、沒有用 `word-count-min.ts` 的算字複本(只剩 `BODY_WORD_LIMIT` 這個常數 import,工單明寫「仍是 100、word-count-min.ts 不刪」)。差分測試與葉模組 mock 的 word-authority 測試都過;G11(字數不經 parseCardText)改壞後紅 | 確認 |
| K-2 | 備註 | 契約有權威常數 `CARD_BODY_WORD_LIMIT`(`validateCard` 用它),`generate-cards.ts` 的限制值來自 `word-count-min.ts` 的 `BODY_WORD_LIMIT`(100)。工單明定這樣(「`BODY_WORD_LIMIT` 仍是 100」),所以不算偏離;但這是之後 Wave 0 複本要收掉時一起改的點 | 提顧問知道,不擋 |
| K-3 | 備註 | 多筆的 warning 訊息多帶了卡片標題(`regenerate 回了 N 筆,只用第一筆(<標題>)`),工單文字是「regenerate 回了 N 筆,只用第一筆」;測試只釘前半句與 N,不衝突 | 不擋 |
| K-4 | 成本 | worker cost $2.598,工單預算 $1 = **約 2.6×,超過 2× 旗標線**(協調者提供;session ses_ebb54a029ffeyKLwXB5g6qSvqf,xai/grok-4.7,約 13.9 分鐘);grok 無 $ 上限,只記錄 | 標出 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 detached @ e089710(node_modules 從別的驗收簽出複製),沒有 `.env`。開跑 tree sha `eebdd3a895f49e60b2a526accd75d4a76c453091`。
- **測試作者檢查**:worker 兩個 commit 的測試檔(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、fixtures)變動 **0**;`git diff --name-only t19-start2 t19-opencode` 只有 generate-cards.ts(+94)、ingest.ts(+11)、報告。受保護測試(generate-cards.regenerate、generate-cards.word-authority、ingest.regenerate)全來自前端的 7749d3e。
- `git log --name-only t19-start2..t19-opencode | grep -c mutants.out` = 0;與最新 main(0ca1c25)的 `git merge-tree`:無衝突。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned=300) |
| `check-doc-links` | PASS |
| vitest `packages/core/src/ingest` | 16 檔 365 綠 |
| 受保護三檔(regenerate 26、word-authority 5、ingest.regenerate 8,含 each 展開) | 152 綠 |

## 3. 改壞版本(23 個:改一處實作 → 跑整個 ingest 目錄 365 條 → 還原)

| 編號 | 改壞 | 結果 |
|---|---|---|
| G01 | regenerate 要求 lines(沒有就丟錯) | 紅(25 條失敗 / 365) |
| G02 | regenerate 回應的 lines 被採用 | 紅(26 條失敗 / 365) |
| G03 | lines 是亂值就丟錯 | 紅(4 條失敗 / 365) |
| G04 | examples 是 [] 時採用(清空) | 紅(4 條失敗 / 365) |
| G05 | 沒有 examples 時卡的 examples 變 undefined | 紅(30 條失敗 / 365) |
| G06 | 連續重寫回退到第一批的 examples | 紅(5 條失敗 / 365) |
| G07 | 非空 examples 不採用 | 紅(12 條失敗 / 365) |
| G08 | examples 含非字串時半採用(略過壞項) | 紅(7 條失敗 / 365) |
| G09 | examples 非陣列就丟錯 | 紅(4 條失敗 / 365) |
| G10 | 超過 100 字仍被接受(門檻放寬) | 紅(8 條失敗 / 365) |
| G11 | 字數不經 parseCardText(自己算) | 紅(9 條失敗 / 365) |
| G12 | regenerate 回多筆就丟錯 | 紅(12 條失敗 / 365) |
| G13 | 多筆時取最後一筆 | 紅(12 條失敗 / 365) |
| G14 | 多筆時不記 warning | 紅(11 條失敗 / 365) |
| G15 | 批次回應不檢查 lines 長度 | 紅(2 條失敗 / 365) |
| G16 | regenerate 的 title 被採用 | 紅(25 條失敗 / 365) |
| G17 | body 不是字串沒擋 | 紅(6 條失敗 / 365) |
| G18 | 錯誤訊息沒有 regenerate | 紅(4 條失敗 / 365) |
| G19 | parked 的 lines 不是原卡的 | 紅(2 條失敗 / 365) |
| G20 | attempts 少記重寫那一次 | 紅(15 條失敗 / 365) |
| G21 | 警告沒有寫進 log | 紅(2 條失敗 / 365) |
| G22 | 警告事件類型不是 warning | 紅(2 條失敗 / 365) |
| G23 | warnings 沒有重寫時是 undefined | 紅(41 條失敗 / 365) |

對照工單 must_catch:只有 title/body 不能丟錯(G01)、lines 以原卡為準且亂值不丟錯(G02、G03)、examples 缺/[] 保留目前候選且連續重寫不回退(G04、G05、G06)、非空 examples 採用與壞格式整個忽略(G07、G08、G09)、超長不寫檔且字數同一條路(G10、G11)、多筆取第一筆不丟錯不驗證記 warning 且批次語意不變(G12–G15、G21–G23)、title 不被採用(G16)、body 非字串/非陣列/空陣列要丟錯且訊息有 regenerate(G17、G18)、parked 的 lines 與 attempts(G19、G20)。「用 golden 真輸出餵進去」由前端的 golden 夾具測試在基準上綠守著。

## 4. Stryker(generate-cards.ts;測試 = generate-cards*、ingest* 共 6 檔 213 條)

`stryker.t19.json`(驗收用,不進版控):**86.50%**(140 殺、1 逾時、22 活;高於標準 80%)。存活 22 個:
- 既有 phase-1 程式:批次 `parseCardCandidates` 的 JSON 錯誤訊息與非陣列訊息(該路徑只檢查有丟錯)、`buildBatchPrompt`/`buildRegeneratePrompt` 的提示字串切分(只檢查有內容)、`witness` 的標籤字串;
- T19 新增程式,全是等價:`countBodyWords` 裡 `body.trim()` 與結尾 `'
'`(`countWords` 不算空白,結果相同)、regenerate 的 JSON.parse catch 清空(`parsed` 變 undefined 後會被「必須是陣列」那條擋下,訊息一樣含 regenerate)、`if (examples !== undefined)` 恆真(`applyRegenerated` 自己再判一次)、`isPlainObject` 的 typeof 恆真(字串等會被後面的 body 字串檢查擋下)。

## 5. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(沿用 T25 收尾量值,協調者確認) | 64 | 03b3ca76e6cf509a | 90 |
| 跑完後 | 64 | 03b3ca76e6cf509a | 90 |

前後相同;全程只讀,所有測試用暫存目錄。

## 6. grok

這張是輕量工單(兩個檔、+105 行),協調者與顧問未要求對抗審核;三個顧問重點(Q1 連續重寫以目前候選為準、Q2 多筆取第一筆記 warning、Q3 同一條路)都用改壞版本逐項驗證(G04–G06、G12–G14、G11)。沒有另跑 grok。

## 7. 花費

worker cost $2.598 / 預算 $1 = **約 2.6×**(超過 2×,只記錄)。驗收端沒有用 LLM。

## 8. 結論

通過(無阻擋項、無測試缺口)。K-1 回答顧問 Q3:字數走 validateCard 同一條路,已確認。
