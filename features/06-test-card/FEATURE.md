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
| 1 | UI 骨架、兩種題型、結果顯示(stub 後端) | Wave 0 | done | 2026-09-03 |
| 2 | 接上真的 scheduler、grading、檔案 | I3 | todo | |
| 3 | 進度、逾期、小結、續答 | I3 | todo | |
| 4 | 縮短版先複習 | I5 | todo | |

## 驗收方式

多數 `@manual`,每個 sprint 檔有 checklist。可自動的邏輯已在 core。

## 開放問題

- 應用題輸入要不要支援 markdown(寫程式碼片段)?先純文字。

## 待協調

- **`cucumber.js`(共用檔,只有協調者能改)有一個會讓全部 `npm run accept*` 誤判的 bug**:
  這個 repo 是 `"type": "module"`,cucumber-js 11 用 ESM `import()` 載入 `cucumber.js`,
  動態 `import()` 本身就會把預設匯出包一層 `.default`。目前檔案內容又自己包了一層
  `export default { default: { paths, import, tags, ... } }`,兩層 `.default` 疊起來,
  造成 `paths` / `import` / `tags` 都沒被讀到——**連 `common.steps.ts` 定義的步驟都會顯示
  Undefined**,不是只有 06 的場景。已用 `@cucumber/cucumber/api` 的 `loadConfiguration()`
  實測確認(`useConfiguration.import` 解析出來是 `[]`,paths/tags 同樣是空的),
  並用一份拿掉外層 `default:` 的暫存 config 驗證修好後 `06-test-card/phase-1` 六個
  非 `@manual` 場景全過。
  **修法**:`cucumber.js` 的 `export default` 直接寫設定物件本身,不要再包一層 `default:`:
  ```js
  export default {
    paths: [...],
    import: [...],
    tags: 'not @manual',
    format: ['progress'],
  };
  ```
  （`publishQuiet` 該版本已標記不需要,可以順便拿掉,但不影響這個 bug。）
  這個檔案我不能動,麻煩協調者確認並修。修好前,`npm run accept` / `accept:standalone` /
  `accept:integration` 對任何功能都會回報「全部 undefined」,不代表哪個功能沒寫步驟定義。
- phase-1.feature 有一行 wording 微調(不影響行為,只是消歧義):「A grading error leaves
  the question in place」情境的 When 從 `the result is displayed` 改成
  `the person submits an answer`——前者跟 `common.steps.ts` 的通用比對句
  `the result is {}`(cucumber expression 的 `{}` 是萬用參數)撞在一起,cucumber 會報
  ambiguous match。純文字改動,場景語意不變。
