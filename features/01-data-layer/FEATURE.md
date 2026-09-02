# 01 · data-layer

## 一句話

把 `contracts/types.md` 變成可執行的 zod schema 與驗證器。其他模組整合後都用它。

## 範圍

- `packages/contracts/` 的 zod schema 與 TypeScript 型別(從契約產生)
- 卡片 frontmatter 與 body 的驗證,含 example 圍欄解析
- 字數計算函式(契約 §2 的權威實作)
- 考題、reviews、weekly、log、categories、settings 的驗證
- 依賴圖驗證、循環偵測、拓樸排序
- `learning/` 目錄初始化
- `contracts/fixtures/` 的建立(Wave 0 的附帶產出,其他功能靠它)

## 不在範圍

- 產生內容(→ 02)
- 讀寫狀態的業務邏輯(→ 04、08)
- 渲染(→ 07)

## 單獨執行

```bash
npx tsx packages/core/src/schema/cli.ts validate contracts/fixtures/cards/valid-basic.md
npx tsx packages/core/src/schema/cli.ts init ./tmp-learning
```

預期輸出:第一個印出 `OK` 與字數;第二個建立目錄樹並列出建立的檔案。

## 依賴

**Wave 0(phase-1)**:無。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | phase-1 | 共用 schema 基礎 |
| phase-3 | phase-2 | 圖的驗證需要卡片驗證 |

## Wave 0 的重複

無。這個資料夾是唯一不需要 stub 的——它只把契約變成程式。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/contracts/src/`、`packages/core/src/schema/` |
| schema | zod | 一個格式一個 schema,匯出對應型別 |
| frontmatter | gray-matter | |
| YAML | yaml | |
| 測試 | vitest + cucumber | |
| 變異門檻 | **嚴格 95%** | 字數與驗證器是所有模組的地基 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | schema、卡片驗證器、字數、init、fixtures | Wave 0 | ready | |
| 2 | 考題、狀態檔、log、設定檔 | I1 | todo | |
| 3 | 依賴圖、循環偵測、拓樸排序 | I1 | todo | |

## 驗收方式

全自動。變異測試範圍 `packages/core/src/schema/**`,門檻 95%。
字數計算與 example 圍欄解析的邊界(剛好 100 / 101 字、0 個 / 多個圍欄)必須有測試。

## 開放問題

- 字數計算對日文、韓文?目前依契約「CJK 每字算 1」,等真有該類別再議。
