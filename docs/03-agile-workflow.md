# 敏捷流程

一個人加一個 AI 配對開發者。儀式越少越好,但四件事不能省:
**契約先於平行、規格先於程式、測試先於驗收、決策留痕**。

## 角色

| 角色 | 誰 | 負責 |
|---|---|---|
| Product owner | 你 | 決定做什麼、凍結契約、確認 gherkin、驗收 |
| 開發者 | 你 + Claude Code | 寫程式、寫測試、跑測試與變異測試 |
| 記錄者 | Claude Code(透過指令) | 更新狀態、NEXT.md、decision map、sprint 檔 |

## 兩種節奏

**Wave 0**:十個 phase-1 沒有依賴,你可以照任何順序做,也可以同時開幾個。
`/sprint` 會依「解鎖最多」排序建議,但你可以完全不理它。

**I1 之後**:嚴格依序。整合點不能跳。

## Sprint

1 週一個。

| 時間 | 做什麼 | 指令 |
|---|---|---|
| 週一 | 規劃:挑 2–4 個 ready 的 phase | `/sprint` |
| 每天 | 做一個 phase 的一部分,小 commit | — |
| phase 快做完 | 跑變異測試 | `/mutate <folder>` |
| phase 做完 | 驗收 | `/phase-done` |
| 整合點所有 phase 都 done | 整合驗收 | `/integrate <IN>` |
| 週五 | 回顧(5 分鐘,寫進 sprint 檔) | 手動 |

Retro 三題:這週哪個 phase 比預期難?為什麼?下週要改估法或拆法嗎?

## 功能生命週期

```
想法
 │
 ▼
/feature <描述>            AI 判斷:新資料夾 / 改既有 / 衝突 / 跨功能
 │                          提案 → 你確認 → 寫檔
 ▼
.feature 存在,狀態 todo
 │
 ▼
NEXT.md 的 gate 全部滿足 ──► 狀態 ready
 │
 ▼
/sprint 挑進本週 ─────────► 狀態 in-progress
 │
 ▼
實作 + vitest + cucumber
 │
 ▼
/mutate ──────────────────► 達門檻才往下
 │
 ▼
/phase-done ──────────────► 全過:done,更新 NEXT.md  /  沒過:仍 in-progress
 │
 ▼
一個整合點的 phase 全 done ─► /integrate
 │
 ▼
過程中的取捨 ─────────────► /decide
```

## Definition of Ready

一個 phase 可以開工:

- [ ] `.feature` 存在,至少 3 個場景
- [ ] `NEXT.md` 的三類 gate 全部滿足(自身 / 整合 / 契約)
- [ ] `FEATURE.md` 的技術棧沒有「待定」
- [ ] 沒有標 `blocked`
- [ ] **Wave 0 額外**:確認這個 phase 不需要任何跨資料夾 import

## Definition of Done

**核心(這四項沒過就不算完成)**

- [ ] 所有非 `@manual` 場景自動通過
- [ ] 所有 `@manual` 場景由你親手確認
- [ ] `standalone.json` 裡該功能的指令跑過且退出碼 0
- [ ] **嚴格級**模組的變異測試達 95%(標準級未達只回報,不擋)

**選配(有幫助,但不擋)**

- [ ] Wave 0:`npm run boundaries` 沒有跨資料夾 import
- [ ] `npm run lint:docs` 沒有斷掉的相對連結(文件裡指到的檔案真的存在)
- [ ] `FEATURE.md` 狀態與完成日已更新
- [ ] `NEXT.md` 的「目前」與 gate 已更新
- [ ] 過程中的取捨已 `/decide`
- [ ] 沒有留下 TODO / FIXME 註解

選配的東西維護得好,`/sprint` 的建議會準;不維護也不會壞掉,只是要自己記得誰在等誰。

## Definition of Integrated

**核心**

- [ ] `@e2e` 場景由你親手確認——**這一項不能被任何測試代替**
- [ ] `@regression` 場景全過(前面的沒被弄壞)
- [ ] `npm run standalone` 全過(所有模組仍可單獨跑)

**選配**

- [ ] 該整合點的所有 phase 都 `done`
- [ ] 其餘非 `@manual` 場景全過
- [ ] 該移除的 Wave 0 重複都移除了
- [ ] 涉及模組的變異測試仍達門檻
- [ ] roadmap 現況表已更新

如果 `@e2e` 你做得到、`@regression` 全過、單獨執行沒壞,那系統就是可用的。
其餘是把帳記整齊,重要但不擋路。

## Gherkin 慣例

見 `features/README.md`。要點:全英文、第一行是 tags、一個場景一件事、
需人眼的加 `@manual`、phase-1 的第一個場景是「單獨跑起來會怎樣」。

## WIP 建議

**同時 `in-progress` 的 phase 建議不超過 2 個。** `/sprint` 會提醒,但不會擋你。

Wave 0 期間這條特別容易被打破——十一個都 ready 會讓人想全開。
平行的意思是「順序自由」,不是「同時做十件事」。但如果你就是想同時開三個,那是你的選擇。

## 分支與提交

Trunk-based,直接在 main 上小 commit。建議訊息格式 `feat(scheduler): phase-2 failure handling`,
讓 git log 能對回 phase。phase 完成時 tag:`git tag 04-scheduler/phase-2`。
整合完成時 tag:`git tag I2`。

## 最小模式

一百多個檔案的流程對一個人來說偏重。**如果開工後覺得儀式比程式多,就縮到這個子集:**

| 保留 | 為什麼 |
|---|---|
| `contracts/` | 沒有它就沒有平行,而且 AI 會跨 session 漂移 |
| 每個 phase 的 `.feature` | 規格即測試。這是防止「做完了但不知道做對沒」的唯一機制 |
| `/phase-done` 的前四項 | 測試過、單獨跑得起來、嚴格級變異達標、人工場景確認過 |
| `@e2e` 場景 | 「系統可用」的唯一判準 |

**可以先關掉的:**

- sprint 檔與 `/sprint` — 你自己知道下一個要做什麼就不用它
- `/integrate` 的完整清單 — 只跑 `@e2e` 與 `@regression` 也行
- decision map 的 mermaid 圖 — ADR 本身要記,圖可以不畫
- 標準級的變異測試 — 嚴格級一定要跑,其他看心情
- `NEXT.md` 的維護 — 不維護的話 `/sprint` 會給爛建議,但不影響開發

**不要關掉的是 `contracts/` 與 gherkin。** 那兩個關掉之後,三個月後你會不知道當初為什麼那樣寫,
而 AI 會用不同的假設重寫同一個東西。

需要的時候再把關掉的打開。流程是為了保護你不犯已知的錯,不是為了被遵守而存在。

## 什麼時候可以跳過流程

- 修 typo、改註解:直接改
- 修一個明顯 bug 且不改行為:直接改,commit 寫 `fix`,但**要補一個會失敗的測試**
- 小的行為調整(改個預設值、加個旗標):直接改,順手更新對應的 gherkin
- **改 `prompts/` 底下任何檔案:一定要跑 golden run**(ADR-032)。這是唯一沒有例外的
- 其他建議走 `/feature`,但你想直接動手也可以——只要記得回頭補 gherkin

## 什麼時候要停下來問人

- 需求與契約、設計文件或某 ADR 衝突
- 想改 `contracts/` 底下任何東西
- 一個需求橫跨 3 個以上功能
- 估計超過一個 sprint 的 phase(應該拆)
- Wave 0 期間發現「不 import 別人就做不下去」——這代表契約缺東西,是重要訊號
- 任何「這樣做好像比較快但跟規則不一樣」的念頭
