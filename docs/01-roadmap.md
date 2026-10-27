# Roadmap

一個 Wave + 八個 Integration。Wave 0 內部完全平行,I1–I8 嚴格依序。
每個 integration 通過時,系統都是完整可用的。

策略說明見 `05-parallel-and-integration.md`。

## 現況

| 欄位 | 值 |
|---|---|
| 目前階段 | **I3 · 桌面複習 —— 自動驗收通過(2026-10-21)**,不打 tag(ADR-073)。T34 已合併(`c1f6382` 已推),`@i3` 非 `@manual` 6 / 6 綠,三條 fixture `@manual` 技術顧問判過(證據 [T34 B4](reviews/T34-manual-2026-10-21.md);O1 提示蓋住捲到底的按鈕,開補丁票 T35,不擋 I3)。要真資料的 `@e2e @manual` 併到 I4。**以下是 2026-10-18 盤點時的敘述:**要的四個 phase(10-desktop-shell phase-2、06-test-card phase-2 與 phase-3、11-review-cli phase-2)都 `done`,兩項整合工作在 T24 做完(合併 `341b663`,形狀照 ADR-075)。`i3-desktop-review.feature` 的五條自動場景還沒有步驟定義(行為由各 phase 的場景守著,真跑全綠);Wayland 的一次性提示在真前端不見了。兩件都在 T34。I3 照 ADR-073 **不打 tag**:T34 之後自動場景全綠、三條用 fixture 做的人工確認由技術顧問判過,就算 I3 自動驗收通過;要真資料的 `@e2e @manual` 併到 I4 一起問使用者。見 [I3 盤點](reviews/I3-inventory.md)。**更早的狀態:** I2 · 複習迴圈 —— 自動場景通過(T13 已合併),**沒有 tag**,人工確認延到 I4(使用者 2026-10-16 選 B,不加 CLI 的學新卡指令,ADR-073)。I1 · 內容管線 —— 通過(2026-09-04,tag `I1`)。 |
| 目前 sprint | **待確認。** 最後一份 sprint 檔是 `sprints/2026-W37.md`(那一週沒有 feature phase 推進,整週在基礎設施與量尺);W38 之後沒有 sprint 檔。`--live` 花錢煞車沒接上的問題 2026-10-15 已解除(T1/T5/T8/T9 合併,見 `.claude/skills/autopilot/SKILL.md` §4g 第 22 條)。 |
| 下一個 gate 已解除但沒人排的 | **待確認有沒有人排。** gate 都已滿足、`docs/tickets/` 裡沒有工單的:目前沒有。03-llm-router/phase-3 已 `done`(2026-10-27,T59,變異 91.89%;呼叫端另開小票)。13-work-dag/phase-1 是 `ready`,協調者已配 T33。07-teach-card/phase-2 已 `done`(2026-10-23,T37 + T40,`@manual` 重做通過);07-teach-card/phase-3 已 `done`(2026-10-24,T43 + T44,`@manual` 重做通過;小票 T45 處理按鈕位置的殘留);02-ingest-pipeline/phase-3 已 `done`(2026-10-26,T53 + T55,顧問評 golden ingest.topic);07-teach-card/phase-4 已 `done`(2026-10-25,T46–T49,`@manual` 顧問判通過;小票 T50 處理捲到底按鈕上移 1.29 px),屬 I4 的關鍵路徑之一。 |
| 契約版本 | 1.5.0(`contracts/types.md` 檔頭;§2 的 example 圍欄以教學卡畫面的區塊解析為準、markdown-it 釘 15.0.1,見 ADR-081;1.4.0 是 §12 加帳本身分、§1 CategoryId 收窄,見 ADR-066、ADR-067) |
| 最後更新 | 2026-10-18 |

## 全貌

```mermaid
graph TD
  C[contracts 1.2.0 凍結] --> W0[Wave 0 · 十一個 phase-1 平行]
  W0 --> I1[I1 內容管線]
  I1 --> I2[I2 複習迴圈 CLI ★ 開始每天用]
  I2 --> I3[I3 桌面複習]
  I3 --> I4[I4 兩張卡完整]
  I4 --> I5[I5 日常習慣]
  I5 --> I6[I6 長期維護]
  I6 --> I7[I7 macOS]
  I7 --> I8[I8 Windows]
```

---

## Wave 0 · 十一個 phase-1,完全平行

**前提**:`contracts/types.md` 1.2.0 已凍結、`contracts/fixtures/` 已建立。

**規則**:這十一個 phase 之間**沒有任何依賴**。可以十一個同時開,也可以一次一個。
每個都只 import `contracts/`,跨資料夾 import 是違規。

| Phase | 交付 | 單獨執行 | Gherkin |
|---|---|---|---|
| 01-data-layer/phase-1 | zod schema、卡片驗證器、字數 | `npx tsx packages/core/src/schema/cli.ts validate <file>` | [phase-1](../features/01-data-layer/phase-1.feature) |
| 02-ingest-pipeline/phase-1 | raw → 卡片(FakeLlm) | `npx tsx scripts/ingest.ts --fake --file <raw>` | [phase-1](../features/02-ingest-pipeline/phase-1.feature) |
| 03-llm-router/phase-1 | 介面 + 雲端 adapter | `npx tsx scripts/llm.ts --task deepen --prompt "..."` | [phase-1](../features/03-llm-router/phase-1.feature) |
| 04-scheduler/phase-1 | 固定骨架純函式 | `npx tsx scripts/due.ts --state fixtures/reviews/mid-cycle.json` | [phase-1](../features/04-scheduler/phase-1.feature) |
| 05-grading/phase-1 | 填空三層 | `npx tsx scripts/grade.ts --fill --q <file> --answer "..."` | [phase-1](../features/05-grading/phase-1.feature) |
| 06-test-card/phase-1 | 考試卡 UI(stub 後端) | `npm run dev -w apps/test-card` | [phase-1](../features/06-test-card/phase-1.feature) |
| 07-teach-card/phase-1 | 教學卡 UI(MemoryFs) | `npm run dev -w apps/teach-card` | [phase-1](../features/07-teach-card/phase-1.feature) |
| 08-weekly-goal/phase-1 | 計數純函式 | `npx tsx scripts/weekly.ts --state <file>` | [phase-1](../features/08-weekly-goal/phase-1.feature) |
| 09-lint/phase-1 | 健檢(自帶最小驗證器) | `npx tsx scripts/lint.ts --dir fixtures/learning-broken` | [phase-1](../features/09-lint/phase-1.feature) |
| 10-desktop-shell/phase-1 | Tauri 兩視窗(placeholder) | `npm run tauri dev` | [phase-1](../features/10-desktop-shell/phase-1.feature) |
| 12-prompt-quality/phase-1 | golden 框架、結構檢查(FakeLlm) | `npx tsx scripts/prompt-check.ts --golden --fake` | [phase-1](../features/12-prompt-quality/phase-1.feature) |

**Wave 0 完成定義**:十一個 phase 全部 `done`,且 `standalone.json` 裡的非互動指令都能跑。

`11-review-cli` 不參與 Wave 0——它是組合層,在被組合的東西存在之前無法獨立(ADR-028)。

**順序完全自由。** 想從哪個開始都可以。要建議的話:`01-data-layer` 最先
(它把契約變成可執行的 schema,其他人整合時要用),`04-scheduler` 次之
(它是 I2 的關鍵路徑,而 I2 是第一個有價值的里程碑)。

---

## I1 · 內容管線

**你做得到什麼**:丟一篇文章進 `raw/`,執行一個指令,得到一疊可讀的卡片、考題和依賴順序。用 Obsidian 打開來看。

| 需要的 phase | 說明 |
|---|---|
| 01-data-layer/phase-2 | 考題、狀態檔、設定檔格式、原子寫入 |
| 01-data-layer/phase-3 | 依賴圖與拓樸排序 |
| 03-llm-router/phase-2 | 路由表 + 線上偵測(本機 adapter 延到 phase-4,ADR-037) |
| 02-ingest-pipeline/phase-2 | 考題、level 1、依賴圖 |

**整合工作**:02 丟掉自己的 FakeLlmRouter 改用 03;02 與 09 改用 01 的驗證器。

**驗收**:[i1-content-pipeline.feature](integration/i1-content-pipeline.feature) —— **已通過 2026-09-04**,
紀錄見 [I1-REVIEW.md](integration/I1-REVIEW.md)。第四次真呼叫產出 25 張卡 / 25 份考題 /
order 齊全 / 驗證器 25/25,三筆 `cycle_removed` 證明多重循環修復在真資料上生效。

**通過後立刻做**:把你手上三個類別的 raw 全部餵進去。
**但先做 12-prompt-quality/phase-2**——I1 驗收時發現約 8/25 張卡在講重複的事
(見 I1-REVIEW.md 第 8 節),先餵會放大這個問題。

---

## I2 · 複習迴圈(CLI)★

**你做得到什麼**:**每天在終端機複習。間隔重複真的在跑。** 這是系統第一次有實際價值。

| 需要的 phase | 說明 |
|---|---|
| 04-scheduler/phase-2 | 錯誤回退、連錯、stuck |
| 04-scheduler/phase-3 | 每日上限、逾期比例 |
| 05-grading/phase-2 | 應用題 rubric |
| 11-review-cli/phase-1 | **把上面三個串成能用的東西** |
| 12-prompt-quality/phase-2 | 真模型 golden run,建立品質基準 |

**整合工作**:05 改用 03 的 router。

**驗收**:[i2-review-loop-headless.feature](integration/i2-review-loop-headless.feature)

**通過後立刻做**:每天用。連續用一週再往下走——UI 做得再漂亮,排程錯了都沒用。

**實際狀態(2026-10-16,ADR-073)**:自動場景已通過、整合工作(T13)已合併,但**沒有打 tag**。「每天用一週」需要卡被標成學過,那是教學卡(I4)的事,
使用者選擇不加 CLI 的學新卡指令,所以人工確認延到 I4、和 I4 一起做;延後不是跳過,I4 通過前補完才打 `I2` tag。I3 照常開工。

---

## I3 · 桌面複習

**你做得到什麼**:在桌面視窗裡複習,不用開終端機。

| 需要的 phase | 說明 |
|---|---|
| 10-desktop-shell/phase-2 | Tauri commands、learning 路徑、fs scope |
| 06-test-card/phase-2 | 接上真的 scheduler 與 grading |
| 06-test-card/phase-3 | 進度、逾期、小結、續答 |
| 11-review-cli/phase-2 | session 邊界:續答、跨日、暫停 |

**整合工作**:06 丟掉 stub 改用 core;`MemoryFs` 換成 Tauri 的 `LearningFs`。

**驗收**:[i3-desktop-review.feature](integration/i3-desktop-review.feature)

**實際狀態(2026-10-18,ADR-073)**:四個 phase 都 `done`。整合工作在 T24 做完,但形狀照 ADR-075 改過:排程與批改不在 webview 算,
跑在 Node 側車(`scripts/review-sidecar.ts`,跟 CLI 同一份 core),webview 的 `LearningFs` 只剩讀 reteach 的卡。
驗收檔的五條自動場景還沒有步驟定義,Wayland 的一次性提示在真前端不見了,兩件都在 T34。盤點見 [I3 盤點](reviews/I3-inventory.md)。

**I3 的 gate**:不打 tag。「I3 自動驗收通過」= T34 合併後 `--tags '@i3 and not @manual'` 全綠,加上三條用暫存根與 fixture 做的 `@manual`
(視窗位置重開保留、X11 置頂、Wayland 偵測與說明)由技術顧問判過。**併到 I4、和 I4 一起問使用者的**:`@e2e @manual`「A person completes a review session in the window」
(要在真的 `learning/` 上有到期的卡,卡要先被教學卡標成學過)。延後,不是跳過:I4 通過前補做,結果回頭寫進 I3。

---

## I4 · 兩張卡完整

**你做得到什麼**:完整的兩張卡。學新概念、往下鑽、被考。不用開 Obsidian。

| 需要的 phase | 說明 |
|---|---|
| 07-teach-card/phase-2 | 換類別、依賴順序、先備提示 |
| 07-teach-card/phase-3 | 深入這個 |
| 07-teach-card/phase-4 | 範例、縮放、圖片 |
| 02-ingest-pipeline/phase-3 | require_raw、無 raw 生成、增量 |

**整合工作**:07 接上真的 fs、order 檔、llm-router、scheduler。

**驗收**:[i4-two-card-system.feature](integration/i4-two-card-system.feature)

---

## I5 · 日常習慣

**你做得到什麼**:開機就在系統列。週目標會計數。不用記得要開。

| 需要的 phase | 說明 |
|---|---|
| 08-weekly-goal/phase-2 | 顯示與調整 |
| 10-desktop-shell/phase-3 | 系統列、自啟、縮到系統列 |
| 06-test-card/phase-4 | 縮短版重教 |

**整合工作**:08 訂閱真的 scheduler 事件;06 接上 grading 的 generateShort。

**驗收**:[i5-daily-habit.feature](integration/i5-daily-habit.feature)

---

## I6 · 長期維護

**你做得到什麼**:斷網一天照用,恢復後補審。壞掉、過時、卡住的卡查得出來。

| 需要的 phase | 說明 |
|---|---|
| 03-llm-router/phase-3 | provisional 佇列(gate:使用者決定裝本機模型,ADR-037,可能延後 I6 本身) |
| 03-llm-router/phase-4 | 本機 adapter(gate 同上) |
| 05-grading/phase-3 | 離線審核、複審修正、縮短版生成(離線審核那部分同樣依賴本機模型,gate 同上) |
| 09-lint/phase-2 | 複審、stuck、重生 |

**整合工作**:09 丟掉自己的最小驗證器改用 01 的完整版。

**注意**:這個整合點的「斷網一天照用」情境依賴本機模型。ADR-037 決定本機模型延後,
所以 I6 本身可能要等使用者決定裝本機模型才能真正驗收——09-lint 那部分不受影響,可以先做。

**驗收**:[i6-maintenance.feature](integration/i6-maintenance.feature)

---

## I7 · macOS

| 需要的 phase | 10-desktop-shell/phase-4 |
|---|---|

**驗收**:[i7-macos.feature](integration/i7-macos.feature)

---

## I8 · Windows

| 需要的 phase | 10-desktop-shell/phase-5 |
|---|---|

**驗收**:[i8-windows.feature](integration/i8-windows.feature)

---

## 未排程

`/feature` 新增但還沒歸進任何 wave / integration 的。`/sprint` 時決定要不要拉進來。

| 功能 | 加入日期 | 建議位置 | 備註 |
|---|---|---|---|
| 13-work-dag(工作依賴圖與平行規則) | 2026-10-15 | 不綁整合點;phase-1 可立刻做,phase-2 等 ADR-065 | 使用者原話「重新設計dag,平行開發」即 `/feature` 確認;純文件規格,實作尚未派 |
| 14-hud-skin(SAO 無框 HUD 外觀) | 2026-10-15 | phase-1 Wave 0 可立刻做(只動 packages/ui-shared/src/hud/);phase-2 套到 06/07;10 phase-6 無框透明視窗等 T2c-2 合併與 14 phase-2 | 使用者要「無框+SAO 特殊框 HUD 風格」(透明視窗、亮色、兩塊拆法、1 像素黑線框);規格與 ADR-071 已審,實作尚未派 |

## 節奏

- 1 週一個 sprint,2–4 個 phase
- Wave 0 約 2–3 sprint(可平行所以看你投入多少)
- I1 約 1–2、I2 約 2、I3 約 1–2、I4 約 2、I5 約 1、I6 約 1–2、I7 / I8 各約 1
- 估計不是承諾。估錯了在 retro 記一筆,不用修 roadmap
