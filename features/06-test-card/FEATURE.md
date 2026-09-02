# 06 · test-card

## 一句話

考試卡的 UI。列題、作答、顯示結果、小結。判斷都在 core,這裡只顯示與收輸入。

## 範圍

- 今日題目載入與呈現
- 填空 / 應用兩種輸入介面與送出鍵
- 結果顯示、feedback、正確答案
- 進度列、逾期數、每日小結、中斷續答
- 縮短版「先複習」區塊

## 不在範圍

- 任何判斷邏輯(→ 04、05)
- 視窗、置頂、位置(→ 10)
- 週目標計算(→ 08,這裡只顯示)

## 單獨執行

```bash
npm run dev -w apps/test-card
```

瀏覽器開 dev server,用 `contracts/fixtures/` 的資料與 stub 後端。
預期:能看到題、能作答、能看到結果。答案不落地(記憶體),重整即重置。

## 依賴

**Wave 0(phase-1)**:無。用 `MemoryFs` 與三個 stub。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、04 全部、05 phase-2、10 phase-2 | 接上真的邏輯與檔案 |
| phase-3 | 自身 phase-2 | |
| phase-4 | 自身 phase-3、05 phase-3 | 縮短版生成 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| `StubScheduler` | `apps/test-card/src/stubs/scheduler.ts` | I3 |
| `StubGrader` | `apps/test-card/src/stubs/grader.ts` | I3 |
| `MemoryFs` | `apps/test-card/src/stubs/memory-fs.ts` | I3 |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 框架 | Svelte 5 + Vite | `apps/test-card/` |
| 狀態 | Svelte runes,不引入狀態庫 | |
| 與 core 溝通 | I3 起 import `packages/core`;檔案透過 `LearningFs` | |
| markdown | markdown-it + example fence 插件(與教學卡共用 `packages/ui-shared/`) | |
| 變異門檻 | **寬鬆,不強制** | UI 由 @manual 與整合測試涵蓋 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | UI 骨架、兩種題型、結果顯示(stub 後端) | Wave 0 | ready | |
| 2 | 接上真的 scheduler、grading、檔案 | I3 | todo | |
| 3 | 進度、逾期、小結、續答 | I3 | todo | |
| 4 | 縮短版先複習 | I5 | todo | |

## 驗收方式

多數 `@manual`,每個 sprint 檔有 checklist。可自動的邏輯已在 core。

## 開放問題

- 應用題輸入要不要支援 markdown(寫程式碼片段)?先純文字。
