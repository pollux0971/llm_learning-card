# 05 · grading

## 一句話

判斷一個回答對不對。填空盡量不用 LLM;應用一定用,但離線降級並補審。

## 範圍

- 填空三層:正規化 + 精確、模糊(編輯距離)、本機 LLM 同義
- 應用題:rubric 逐條判斷,雲端優先,離線本機並標 provisional
- 契約 §5 的 `GradeResult`
- provisional 複審後的 stage 修正(呼叫 scheduler)
- 縮短版重教的生成

## 不在範圍

- 出題(→ 02)
- 排程狀態推進(→ 04,這裡只回傳 pass / fail)
- UI(→ 06)

## 單獨執行

```bash
npx tsx scripts/grade.ts --fill \
  --q contracts/fixtures/questions/sec-0042.yaml --index 0 --answer "協定,主機,埠號"
npx tsx scripts/grade.ts --apply --fake \
  --q contracts/fixtures/questions/sec-0042.yaml --answer "這是跨來源請求,後端要加 CORS header"
```

預期輸出:`GradeResult` 的 JSON,含 grader 欄位顯示走了哪一層。

## 依賴

**Wave 0(phase-1)**:無。第三層用自己的 `FakeLlmRouter`。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、03 phase-2 | 應用題需要真的雲端路由 |
| phase-3 | 自身 phase-2、04 phase-2、03 phase-3、I5 通過 | 複審要改 stage,縮短版要真的離線經驗 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| `FakeLlmRouter` | `packages/core/src/grading/fake-llm.ts` | I2(改用 03) |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/core/src/grading/` |
| 正規化 | 自寫:trim、NFKC、toLowerCase | |
| 編輯距離 | fastest-levenshtein | |
| LLM 回傳 | 要求 JSON,zod 驗證,失敗重試一次 | |
| 變異門檻 | 前兩層 **嚴格 95%**,LLM 相關 **標準 80%** | 前兩層是純函式且決定成本 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 填空三層審核 | Wave 0 | done | 2026-09-02 |
| 2 | 應用題 rubric 雲端審核 | I2 | todo | |
| 3 | 離線審核、複審修正、縮短版生成 | I6 | todo | |

## 驗收方式

前兩層全自動。變異測試必須殺死「第一層命中就不呼叫 LLM」的短路變異——那是成本控制的行為。

## 開放問題

- 模糊比對門檻(長度 ≥ 4 允許 1)對中文是否合適?中文四字詞差一字可能意思完全不同。
  先這樣,收集實際誤判再 `/decide`。

## 待協調

- `npm run accept:standalone`(以及不帶路徑參數的 `npx cucumber-js`)目前對**整個 repo**
  回報全部 scenario 為 undefined,連 `common.steps.ts` 定義的句子(如 `it exits with status {int}`)
  都不例外。這是 pre-existing 問題,不是 05-grading 造成的——把 `features/steps/grading.steps.ts`
  整個移走再跑一次,結果一樣全部 undefined。
  用 `NODE_OPTIONS=--import=tsx npx cucumber-js --import 'features/steps/**/*.ts' --tags '@grading and @standalone' features/05-grading`
  明確帶 `--import` 就正常(05-grading 20 scenarios / 75 steps 全過),
  代表問題出在 `cucumber.js` 設定檔的 `import` 欄位沒有被吃到,不是步驟定義本身的問題。
  `cucumber.js` 是協調者才能改的共用檔,這裡先記錄,由協調者排查(可能與 cucumber-js 讀取
  ESM `export default` 設定檔的方式有關)。
