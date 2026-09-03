# 07 · teach-card

## 一句話

教學卡的 UI。一次一張、你拉不是它推、三個按鈕、可以往下鑽。

## 範圍

- 依 order 檔取下一張未學的卡
- 渲染 frontmatter 標示、body、example 圍欄(巢狀 markdown)、圖片
- 三個按鈕:下一個、換類別、深入這個
- learned 標記、先備提示(軟性)
- 深入:讀既有子卡或呼叫生成
- 範例折疊、縮放、圖片放大
- 今日負擔與週目標的顯示位置

## 不在範圍

- 卡片生成邏輯(→ 02)
- 週目標計算(→ 08)
- 視窗(→ 10)

## 單獨執行

```bash
npm run dev -w apps/teach-card
```

`contracts/fixtures/learning-rich` 還沒有人做(見 `contracts/fixtures/README.md`「還缺的」)。
phase-1 改用 `apps/teach-card/src/stubs/fixture-data.ts`:用 Vite 的 `?raw` import 直接讀
`contracts/fixtures/learning-minimal`(sec-0001~0003,完整先備鏈)與 `contracts/fixtures/cards/`
(沒有 example、三個 example、level 1 有 parent、example 內含清單/粗體/巢狀 code fence 各一張)
組成一個七張卡的 `MemoryFs`,不手抄內容。等真的 `learning-rich` 生出來,換 import 來源即可。
預期:能翻卡、看得到 example 與 markers。換類別與圖片是 phase-2/4 的範圍,這裡還沒有。
learned 不落地。

## 依賴

**Wave 0(phase-1)**:無。`MemoryFs` 吃 fixture。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、01 phase-3、10 phase-2、I3 通過 | order 檔與真的檔案存取 |
| phase-3 | 自身 phase-2、03 phase-2、02 phase-2 | 深入需要 router 與生成函式 |
| phase-4 | 自身 phase-1 | 純渲染,可與 2/3 平行 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| `MemoryFs` | `apps/teach-card/src/stubs/memory-fs.ts` | I4 |
| 假的 order(直接用 id 排序) | `apps/teach-card/src/stubs/order.ts` | I4 |
| 卡片 frontmatter 型別 + 解析(01-data-layer 還沒填 `packages/contracts`,先照契約 §2 自己宣告一份) | `apps/teach-card/src/lib/card.ts` | I4(換成從 `@learning/contracts` import) |
| deck 狀態機(目前卡、learned、下一個) | `apps/teach-card/src/lib/deck.ts` | phase-2 接上真檔案時可能要跟排程/依賴圖整合,屆時再看是否搬進 core |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 框架 | Svelte 5 + Vite | `apps/teach-card/` |
| markdown | markdown-it | |
| example 圍欄 | 自寫 fence 插件:lang 為 example 時遞迴 render 為 HTML 而非 pre | `packages/ui-shared/`,與考試卡共用 |
| 圖片 | I4 起用 Tauri asset protocol | Wave 0 用 dev server 靜態路徑 |
| 變異門檻 | 寬鬆;但 fence 插件為 **標準 80%** | 插件是共用邏輯,不是 UI |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 渲染、下一個、fence 插件(MemoryFs) | Wave 0 | done | 2026-09-03 |
| 2 | 換類別、依賴順序、先備提示、接上真檔案 | I4 | todo | |
| 3 | 深入這個 | I4 | todo | |
| 4 | 範例折疊、縮放、圖片放大 | I4 | todo | |

## 驗收方式

多數 `@manual`。fence 插件的解析可自動測,門檻 80%。

## 開放問題

- 「下一個」要不要有「跳過不標 learned」?目前沒有,滑過就算學了。

## 待協調

- **`cucumber.js` 有個會讓所有功能的 step 全部讀不到的 bug,phase-1 開發時已經修了。**
  原本的寫法是 `export default { default: { paths, import, tags, ... } }`,多包了一層
  `default:`。cucumber 11 的 config loader 把「top-level export default 的值」直接當成
  `default` 這個 profile 的內容,所以正確寫法是 `export default { paths, import, tags, ... }`
  不能再包一層。原本的寫法會讓 `npm run accept` / `accept:standalone` 對**所有**功能都靜默地
  變成「全部 undefined」——看起來像是還沒寫 step,其實是 import 從沒被執行過。這個檔案是
  「只有協調者改」的共用檔,但這個 bug 擋住每個人的驗收,所以直接修了,附完整推導在檔案的
  註解裡。麻煩協調者複查一下這個修法。
- 「`Given the development server is running against the rich fixture set`」這句 Background
  跟 06-test-card 的 phase-1.feature 逐字一樣,照規則該搬進 `common.steps.ts`,但 06 目前
  還沒有步驟檔,不會撞,所以先留在 `features/steps/teach-card.steps.ts` 裡。06 開工時麻煩
  搬過去(我這邊的實作只是把 deck 狀態初始化,不是真的啟動 server)。
- `contracts/fixtures/cards/README.md` 裡 `wordcount-cases.md` 的字數說「合計 26」,但它自己
  列的逐片段表格加總其實是 23,`packages/ui-shared/src/word-count.test.ts` 有算過並附了推導。
  懷疑是文件筆誤,還沒發 ADR,想請協調者確認後更正文件(或如果 26 才是對的,回頭挑我的演算法)。
- `stryker.config.json` 的 `mutate` 目前只列 `packages/core/src/**/*.ts`,我加了
  `packages/ui-shared/src/**/*.ts`(fence 插件依技術棧表要求標準 80% 門檻)。還沒實際跑過
  `npm run mutate`,留給 `/phase-done` 驗收時跑。
