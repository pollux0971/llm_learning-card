# 驗收證據:T18 子卡生成時看得到同分類的其他卡(跨主題不重述)

驗收角色:-ed(測試·驗收)。日期:2026-10-17(Asia/Taipei)。測試作者:前端(t18-red 7dff626);起草:-e5;我是驗收者(三個角色各不同)。
被驗分支:`t18-opencode` @ `b1c2a29`(worker 三個 commit:6bb108c 實作、78feccf prompt、b1c2a29 報告);起點 `t18-start2` 73f797e(= 前端紅測試 + 當時 main)。
驗收簽出 `acceptance-t18`(分支 `pollux0971/t18-accept-tests`,只加這份證據與兩個補測檔)。不合併、不 push、沒改 worker 的任何檔。
**prompt 以最終 commit(78feccf)為準;golden 由顧問另評**(第 1 輪:六個輸入全 5/5、每個 3 張子卡、跨主題重複 0,顧問記一筆「golden 的 already_covered 用固定檔,量不到同一輪內的重複」,不算 T18 的錯;評分紀錄與輸出目錄路徑見協調者先前訊息,不進版控)。

## 0. 結論

**通過,實作沒有阻擋項。** 工單 must_catch 每一條都有改壞版本被抓到;28 個改壞版本 27 個紅、1 個等價。真 cucumber(02 phase-4 五個場景)全綠。
Stryker(siblings.ts、generalization-slices.ts 新碼)補測前 87.97%、補測後 **93.04%**,高於標準 80%;剩下 11 個存活全是等價。補了兩個測試檔(12 條)關掉原本幾個缺口。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| V-1 | 測試缺口,已補 | Stryker 原有 19 個存活裡的缺口:`listSiblings` 上限守衛恆真時 50 張(介於 cap/2 與 cap 之間)會少掉前 20 張、分類資料夾讀不了(路徑是檔案)要回 [] 而不是丟錯、frontmatter 對不上契約的卡要略過、副檔名不是 .md 的檔(內容像卡)要忽略、`generalizationSliceBody` 對「沒有標題的範圍」與多行的切法 | 補 12 條(siblings-acceptance 8 + generalization-slices-acceptance 4)後 87.97% → 93.04% |
| V-2 | 流程確認 | `npm run boundaries` PASS;兩個新 .ts(siblings.ts、generalization-slices.ts)沒另登記 boundaries.owners.json 也過(目錄級 owners 已涵蓋);12→02 的 allow 例外**恰一條**(diff 只新增那一條,理由寫明與 children 管線共用 cardSummary / formatAlreadyCovered) | 確認 |
| V-3 | 成本 | worker cost $7.183,工單預算 $1 = **7.2×,超過 2× 旗標線**(協調者提供;session ses_eba3ed864ffeLyTHU3b1G5XP6s,xai/grok-4.7);grok 無 $ 上限,只記錄 | 標出 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 detached @ b1c2a29(node_modules、src-tauri/target 從別的驗收簽出複製,用完刪),沒有 `.env`。開跑 tree sha `bf5aeec8c6bd2d76d6196e804f5bdbe181de8194`。
- **測試作者檢查**:worker 三個 commit 的測試檔、fixture、golden/(`*.test.*`、`tests/`、`test-support`、`features/steps/**`、`.feature`、`fixtures/`、`golden/`)變動 **0**;動的檔只有 12 個實作與設定檔(ingest/{children,siblings,index}.ts、prompt-quality/{cli,types,index,parent-child-overlap}.ts、golden-sets/{registry,generalization-slices}.ts、scripts/boundaries.allow.json、children.md)與報告。受保護的測試(siblings.test、children-siblings.test、registry-t18.test、registry.test、sibling-overlap.test、cli.test、golden-generalization-words.test、ingest-phase4.steps)全來自前端的 5615a03。
- `git log --name-only t18-start2..b1c2a29 | grep -c mutants.out` = 0;與最新 main(4e29373)的 `git merge-tree`:無衝突。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| boundaries / check:steps / check:gherkin-dup / check:phase-status / check:next-gates / lint:docs / doc-links | 全 PASS(boundaries scanned=313) |
| vitest 受保護的 23 檔(siblings、children-siblings、prompt-quality 全部、golden-generalization-words) | 460 綠 |
| cucumber `@ingest-pipeline and @phase-4 and not @manual` | **5/5**(20 步) |
| cucumber `@ingest-pipeline and not @manual` | 37 場景:29 綠、8 undefined(02 後面還沒做的 phase,gate 未開) |
| cucumber `@review-cli and not @manual` | 32/32(188 步,不退步) |
| 重編 | cucumber BeforeAll 以複製的 target 增量重編 lc-fs |

## 3. 改壞版本(28 個:改一處實作 → 跑 23 個受保護檔 460 條 → 還原)

| 編號 | 改壞 | 結果 |
|---|---|---|
| Q01 | 摘要不是第一句(取整段) | 紅(11) |
| Q02 | 摘要不截斷 | 紅(3) |
| Q03 | 摘要上限 61 | 紅(3) |
| Q04 | example 圍欄內容算進摘要 | 紅(1) |
| Q05 | 列出父卡自己 | 紅(7) |
| Q06 | 列出別的分類的卡 | 紅(1) |
| Q07 | 載入包含 .short.md | 紅(2) |
| Q08 | 超過上限時留 id 最小的 | 紅(3) |
| Q09 | 上限 80 → 81 | 紅(2) |
| Q10 | 不依 id 排序 | 紅(2) |
| Q11 | 沒有 sibling 仍印空標題 | 紅(3) |
| Q12 | 冒號改全形 | 紅(13) |
| Q13 | 標題換行不壓平 | 紅(1) |
| Q14 | 壞掉的卡檔讓生成失敗(不略過) | 紅(2) |
| Q15 | 分類資料夾不存在就丟錯(拿掉 existsSync 守衛) | **存活(等價)**:`readdirSync` 的 catch 本來就回 [] |
| Q16 | sibling 清單只讀一次(跨呼叫快取) | 紅(6) |
| Q17 | already_covered 放在 body 之後 | 紅(5) |
| Q18 | 跨卡門檻 0.5 → 0.7 | 紅(3) |
| Q19 | 跨卡門檻 `>=` 改 `>` | 紅(3) |
| Q20 | 觀察門檻 0.3 → 0.35 | 紅(2) |
| Q21 | 觀察 `>=` 改 `>` | 紅(1) |
| Q22 | 也比自己的 key | 紅(10) |
| Q23 | 子卡對子卡也比同 key | 紅(6) |
| Q24 | A↔B 算兩次 | 紅(11) |
| Q25 | totalPairsChecked 不累加 | 紅(9) |
| Q26 | maxOverlap 只從 pairs 取 | 紅(2) |
| Q27 | `--overlap-siblings` 有對時退出碼 0 | 紅(2) |
| Q28 | `--overlap-siblings` 錯誤時退出碼 0 | 紅(3) |

對照工單 must_catch:already_covered 區塊位置與省略(Q11、Q17)、列的卡不含父卡/別分類/.short.md(Q05–Q07)、第二個父卡看得到第一個剛寫的(Q16)、摘要規格(Q01–Q04)、80 張上限與留 id 最大的(Q08、Q09、Q10)、`--overlap-siblings` 門檻 0.5 `>=`、觀察 0.3、不比自己 key、A↔B 一次、退出碼(Q18–Q28)。「golden 的 children 輸入有固定 already_covered」「泛化輸入進登記表」「原三個資安輸入的 prompt 位元組不變」「沒有 sibling 時 prompt 與 T12 之後逐字相同」由受保護的 registry-t18、children-siblings 測試在基準上守著(460 綠);「泛化輸入的子卡輸出沒有資安字樣」「未提交的 prompt 不寫進 golden/」是流程,見第 6 節。

## 4. Stryker(標準門檻 80%;用 `npm run mutate --`,concurrency 2)

範圍:siblings.ts、generalization-slices.ts(新碼);測試 = siblings、children-siblings、prompt-quality 全部。`stryker.t18.json`(驗收用,不進版控,已刪):
- 補測前 **87.97%**(138 殺、1 逾時、19 活);
- 補測後 **93.04%**(146 殺、1 逾時、11 活;siblings.ts 92.37%、generalization-slices.ts 96.30%)。

補測前的 19 個存活逐個判:**缺口 8 個(已補)**、等價 11 個。補測後剩下的 11 個全是等價:
- 迴圈 `i <= chars.length`(多跑的那一輪 chars[length] 是 undefined,不命中任何分支)、`.` 後面 `next === undefined` 判斷(結尾的句點本來就會取到整段)、排序比較子的 `<` / `<=`(id 唯一)與第二個比較(V8 的排序只看 `< 0`,回 0 或 1 結果相同;依引擎)、上限守衛 `>` / `>=`(剛好等於 cap 時 slice(0) 相同)、`existsSync` 守衛(readdirSync 的 catch 已回 [])、`readFileSync(..., "")`(回 Buffer,`parseCardText` 吃得下,結果相同)、`lines[0] ?? ''` 的預設值(合法範圍一定有第一行)。

## 5. grok

這張的顧問評分(golden)已達標,程式與 prompt 的對抗審核由改壞版本、Stryker 與受保護測試取代;協調者與顧問未要求另跑 grok。沒有另跑。

## 6. 流程項

- prompt(children.md)只改了 2 行(already_covered 說明加「(含子卡)」),worker 的 prompt commit 是最終版,顧問已評 golden 第 1 輪達標,不會再改。
- golden run 由協調者在主簽出 `--live` 跑(--out 在 golden/ 外),驗收端不花錢、沒動 golden/;「合併後在乾淨 main 重跑存新基準」待合併後。
- 沒有動 contracts/。

## 7. learning/ 前後(唯一量法,只讀)

| 時點 | 檔數 | 雜湊前 16 碼 | 帳本行數 |
|---|---|---|---|
| 開跑前(協調者確認的基準,含他 T18 golden 第 1 輪 6 筆) | 64 | bc1699974215c435 | 102 |
| 跑完後 | 64 | bc1699974215c435 | 102 |

前後相同;全程只讀,我的測試都用暫存目錄。

## 8. 結論

通過(實作無阻擋項);測試缺口 V-1 已補,兩個補測檔建議隨 worker 分支一起進 main;成本 7.2×(V-3,只記錄)。
