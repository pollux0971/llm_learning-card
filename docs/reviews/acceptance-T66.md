# 驗收證據:T66(I4 整合層步驟定義)

- 被驗分支:t66-impl,1aefccdd0d59538ef0286a9a0b8c27da5e206270(基底 d9ff55a,1 個 commit、6 檔增 955 行)
- 開跑與跑完的 tree sha:9cff70ead8ec1a936a0dee30c95651ac297bd0bf(筆電與 i9 一致)。基底 d9ff55a 的 tree sha:555dc636da703c340b2cae352b16b8893154e509。
- 日期:2026-11-21。LLM 花費 0。沒有 `.env`。測試 agent 寫、沒有開發 worker。

## 1. 範圍與測試作者

- 6 檔:features/steps 的 i4-two-card-system.steps.ts(新)、grading.steps.ts、teach-card-phase3.steps.ts、ingest-phase3.steps.ts(各 +2 行);features/support 的 i4-harness.ts(新)、t66-source-marker-render.test.ts(新)。packages、apps、scripts、contracts、prompts、所有 .feature、docs:0 行變動。tracked 檔沒有 mutants 輸出夾。
- 三個分派檔各只加 1 行 import 與 1 行 `if (isI4(this)) return …`。`isI4` 只在 Before 看到場景檔案路徑是 i4 那個 feature 時才設成真,其他 feature 的場景走原本的路,沒有放寬任何既有場景。我另外把這三組的 phase 回歸在 i9 跑過(見第 3 節)。
- i4-harness.ts 與步驟檔裡所有寫檔、建目錄的呼叫(writeFileSync、mkdirSync)目標都在自己的 mktemp 暫存根底下(vault.dir、vault.scratch);沒有 rmSync;沒有碰真的 learning/、state/、raw/。清理走既有的 removeVault 與 cleanupTmps。
- 側車與視窗延到第一個 When 才起;全部用暫存根(learning、XDG_*、HOME 同一個 mkdtemp),假網路,沒有 `.env`、沒有 live。

## 2. 筆電

- tsc 乾淨;boundaries PASS(411);check:steps PASS(2713 句、1376 定義,0 重複)。
- D1 佈置過真的 lint(`createI4Vault` 後跑 lint):body_over_limit 0、missing_questions 0、orphan_questions 0、**missing_prereq 0、cycle 0、prereq_mismatch 0**、orphan_child 0、review_orphan 0、invalid_category 0、stale 0、source_missing 0。

## 3. i9(空 HOME,env 清掉 XDG_*、NO_COLOR、DBUS)

| 項目 | 結果 |
|---|---|
| **基底 d9ff55a** `@integration and @i4 and not @manual` | 8 個場景:**7 個 undefined**(i4 第 22、29、35、44、50、69、76 行那七條),1 個本來就過(不在那七條裡);52 步:45 undefined、4 skipped、3 過 → 紅,原因是「步驟還沒定義」 |
| **t66-impl** 同一指令 | **8/8 過,52/52 步全過**,0 undefined、0 ambiguous |
| `@i4 and not @manual`(23 個 phase 場景加整合 7 條加 T67 的 phase-5 8 條) | 38/38 過(193 步) |
| `@teach-card and @phase-3` | 8/8 過 |
| `@ingest-pipeline and @phase-3` | 8/8 過 |
| `@llm-router and @phase-3` | 8/8 過 |
| `@grading` | 38 場景:32 過、1 敗、5 undefined。敗的是 05-grading/phase-4.feature 第 7 行(phase-4 還沒做),另 undefined 也都在 phase-4;已知基線,與本票無關,三個分派檔的 phase-3 與其他 grading 場景全過 |
| D3 渲染 t66-source-marker-render(真 Chrome) | 3/3 過 |
| HOME 下 .cache | 只有 Chrome 的 fontconfig,沒有 llm-learning-cards |

## 4. 自選改壞(只改產品檔,不在 -67 的 M1–M14、R1 清單上;跑完每個都還原)

在 i9 上對 `@integration and @i4 and not @manual` 以 `--name` 只跑相關場景,D3 那條跑渲染檔。

| # | 改法 | 紅在哪一條、失敗訊息原文 |
|---|---|---|
| M1 | 先備提示不認別類別的卡(D1 跨類別先備) | 教學順序:「路上至少要有一張卡畫面上列出沒學的先備:{"sec-0001":[],"sec-0003":[],"sec-0002":[]}」 |
| M10 | 畫面上的先備清單永遠空 | 同上一條,同一句訊息 |
| M2 | 排卡完全不看 order 檔(照 id 排) | 教學順序:「依序出現的卡就是 order 檔的順序」 |
| M4 | 學過轉移的 next_due 寫成今天 | 換類別:「今天還沒到期」(review.ts --dry-run 在今天就列出它) |
| M9 | 記學過的日期寫死 2026-01-01 | 換類別:「紀錄等於排程的學過轉移(stage 1、學過日今天、明天到期)」 |
| M3 | 側車不認 LC_REVIEW_TODAY(D2:不是假造狀態) | 回歸:「佈置:今天學的那張是排程的學過轉移」——側車記學過日不是釘的那天,場景在第一步就紅;表示整條「今天學 → 隔天考」靠的是側車真的吃環境變數,不是步驟自己寫的假資料 |
| M11 | 深入時已有子卡還是呼叫模型 | 重用子卡:「假網路一個請求都不能收到」 |
| M8 | 超過 100 字的卡也照寫 | 字數:「至少留下一張(超字的那張略過,另一張留下)」 |
| M7 | 主題生成寫出 source raw | 沒有 raw 的類別:「scripts/ingest.ts --topic 失敗(1):…剛寫入的卡片 pea-0001 沒有通過 data-layer 驗證器:source_ref: a raw sourced card requires source_ref」(產品自己的驗證器就擋,場景因此紅) |
| M5b | 深入的 llm_call 不寫進帳本(改 router.ts 的成功路徑) | 深入生成:「log.jsonl 要有 llm_call(請求要經過驗證帳本的 router)」 |
| M12 | 教學卡的標示「生成」改成別的字 | 渲染測試 3 條裡 2 條紅(llm 與待審核各一) |
| M5 | 同上但改的是 router-gateway.ts | **存活——不是缺口**:側車走的是 router.ts 那條路寫 llm_call,router-gateway.ts 那處不在這條場景的路徑上;改對地方(M5b)就紅 |
| M6 | 深入生成的子卡 prereqs 寫成空 | **存活**:場景沒有斷言新子卡的 prereqs(工單 must_catch 也沒列)。小缺口,不擋;建議之後補一條「子卡的 prereqs = [父卡]」 |

13 個裡 11 紅(含 M5b)、2 個存活(M5 是我改錯路徑,已用 M5b 補;M6 是真的小缺口)。

## 5. 工單 must_catch 對照(我的結果加 -67 自量)

| must_catch | 我驗到 |
|---|---|
| 排教學卡不看 order 檔 | M2 紅 |
| 先備沒學畫面不列 | M1、M10 紅 |
| 換類別沒記學過 / 記的不是排程轉移 | M4、M9 紅(-67 的 M 清單另有直接拿掉記錄) |
| 深入帳本沒有 llm_call | M5b 紅 |
| 已有子卡還呼叫模型 | M11 紅 |
| 深入不檢查字數 | M8 紅 |
| 主題生成寫出 raw | M7 紅 |
| lc-fs 的 read 拒絕 cards/(Rust) | 我沒做 Rust 改壞(重編負擔),由 -67 的清單負責;步驟有 assertReadsWentThroughLcFs 量「走過 lc-fs 且沒被拒絕」 |

## 6. G2 證據表:I4 整合工作接上了什麼

| 零件 | 哪條場景 | 哪個斷言 | 改壞哪裡會紅(訊息原文見第 4 節) |
|---|---|---|---|
| 真的 fs(lc-fs,Rust 的 learning_fs) | i4 第 22、29、35、44 行每一條會顯示卡片的場景;第 69 行 | 視窗讀卡片內文走 lc-fs 的 read command、沒被拒絕,而且畫面上的內文逐位元等於磁碟上那張卡 | 工單 must_catch「lc-fs 的 read 拒絕 cards/」(-67 的清單);步驟的 assertReadsWentThroughLcFs |
| order 檔 | 第 22 行(教學順序)、第 29 行(換類別) | order 檔是圖的拓樸順序且不等於 id 順序;一路按下一個,依序出現的卡剛好等於 order 檔;換類別後顯示的是那個類別 order 檔的第一張沒學的 | M2 紅 |
| llm-router(驗證帳本的 router,網路層假的) | 第 35 行(深入生成)、第 44 行(重用子卡) | 假網路收到的每個請求,帳本剛好一筆 task 是 deepen 的 llm_call(筆數相等);已有子卡時假網路 0 請求、帳本不變 | M5b 紅、M11 紅 |
| scheduler(排程) | 第 29 行(換類別)、第 76 行(回歸) | 記的學過紀錄等於排程的學過轉移;隔天真的 review.ts --dry-run 列它;第 76 行:今天學、側車重啟、LC_REVIEW_TODAY 隔天,考試卡開起來那張在題目裡,答一題後的紀錄等於排程轉移函式對同一筆舊紀錄算出來的 | M4、M9 紅;M3 紅(側車不吃隔天的日期,不是假造狀態) |
| 第 55 行 `@manual`(範例的 markdown 與圖片),引用不重做 | — | 07 phase-1 的「An example fence renders as nested markdown」(features/07-teach-card/phase-1.feature 第 32 行,清單、粗體、不被當預格式);07 phase-4 的「Image paths resolve against the assets directory」(phase-4.feature 第 20 行,圖片從 assets 解析);加 docs/reviews 的 T46、T48 兩份 `@manual` 證據(真視窗裡圖片顯示)。第 12 行 `@e2e` 不算 | — |
| 第 73 行 llm 標示 | 第 69 行場景 + D3 渲染測試 | 場景:畫面上那張卡經 lc-fs 讀回來的 frontmatter 是 source llm;渲染測試:`source: llm` 畫「生成」、`source: raw` 畫「原始」、待審核徽章 | M12 紅 |

- **第 76 行那條(D2 甲)是「今天學、隔天考」的自動證據,不算第 12 行 `@e2e @manual` 的人工確認**(那條要真資料、真的跨一天)。

## 7. 資料前後

- learning/:64 檔 / e31b011a670e1a0f / 帳本 114 行(前後相同)。筆電 ~/.cache/llm-learning-cards 頂層 497(不變)。
- 全部測試在暫存根與空 HOME 跑,沒碰真的 learning/ 與指標檔。

## 8. 清理

- 筆電簽出、i9 的兩個簽出與暫存根、暫存分支與引用都已移除。i9 的 /tmp 下有很多 `lc-` 開頭的項目(852 個),不是這次留的(我的暫存都在自己的暫存根底下,已整個刪除),我沒碰。

## 結論

通過,沒有阻擋項。
