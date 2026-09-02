# 02 · ingest-pipeline

## 一句話

把 raw/ 的素材編譯成卡片、考題、依賴圖。「編譯一次,之後只查」的落實。

## 範圍

- 掃描 raw/、增量處理、去重
- 產生 level 0 卡片,100 字硬檢查與重試
- 產生考題(fill ×2–3、apply ×1–2)
- 產生 level 1 子卡
- 標 prereqs、寫 deps.json、跑拓樸排序
- `require_raw` 開關與無 raw 時的 LLM 生成
- raw 變更時標 stale

## 不在範圍

- level 2+ 即時生成(→ 07 phase-3,共用本功能的「生成一張卡」函式)
- 縮短版生成(→ 05 phase-3,同上)
- 格式驗證本身(→ 01)

## 單獨執行

```bash
npx tsx scripts/ingest.ts --fake --file contracts/fixtures/raw/security-basics.md --out ./tmp-learning
```

`--fake` 用 `FakeLlmRouter` 重播 `contracts/fixtures/llm/`,完全離線、確定性。
預期輸出:在 `tmp-learning/cards/security/` 產生 3 張以上卡片並印出清單。

## 依賴

**Wave 0(phase-1)**:無。用自己的 `FakeLlmRouter` 與自己的最小字數檢查。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1、01 phase-2、01 phase-3、03 phase-2 | 考題格式、圖、真的 router |
| phase-3 | 自身 phase-2、I1 通過 | 增量與 stale 需要穩定的管線 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| `FakeLlmRouter` | `packages/core/src/ingest/fake-llm.ts` | I1(改用 03) |
| 最小字數檢查 | `packages/core/src/ingest/word-count-min.ts` | I1(改用 01) |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `scripts/ingest.ts` + `packages/core/src/ingest/` |
| raw 解析 | gray-matter + 純文字切段 | PDF 先在外面轉 markdown |
| 去重 | source_ref 的 sha256 存 `state/ingested.json` | |
| prompt | `packages/core/prompts/ingest/*.md` | 版本化,改 prompt 要 commit |
| 變異門檻 | **標準 80%** | 有 IO 與 LLM,重試與去重邏輯要測到 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | raw → level 0 卡片(FakeLlm)、字數重試、去重 | Wave 0 | ready | |
| 2 | 考題、level 1、依賴圖 | I1 | todo | |
| 3 | require_raw、無 raw 生成、增量與 stale | I4 | todo | |

## 驗收方式

phase-1 全自動(FakeLlm 是確定性的)。phase-2 起有 `@llm` 場景需真呼叫。
變異範圍 `packages/core/src/ingest/**` 排除 prompt 檔。

## 開放問題

- 一份 raw 該切成幾張卡?交給 LLM 判斷,上限 20。太大的 raw 應在放進來前先拆。
- 圖片如何從 raw 帶進 assets/?目前只處理 raw 已是 markdown 且圖片路徑相對的情況。

## 待協調

phase-1 實作完成、跑過(見下方驗證結果),但發現兩個不在本功能落點內的問題,
需要協調者處理:

1. **`cucumber.js` 的 profile 寫法讓所有步驟檔都載入不到(阻擋全部功能的
   `npm run accept` / `accept:standalone` / `accept:integration`)。**
   目前寫法是 `export default { default: { paths, import, tags, ... } }`,
   cucumber-js 11.3.0 印出「No profiles specified; using default profile」但
   實際上並沒有把巢狀的 `default` 攤平進最終設定,`import` 解析結果是空陣列,
   於是連 `common.steps.ts` 都載入不到,162 個場景全部 `undefined`
   (不是我這個功能寫壞的,拿掉 `features/steps/ingest.steps.ts` 問題依舊在)。
   已本機驗證:把 `cucumber.js` 改成不包一層 `default:`(直接
   `export default { paths, import, tags, format, publishQuiet }`)就正常了,
   `02-ingest-pipeline/phase-1` 的 10 個場景全過。因為 `cucumber.js` 是共用檔,
   我沒有動它,留給協調者判斷怎麼改(ADR-033 可能要補一條)。
2. `contracts/fixtures/cards/README.md` 的 `wordcount-cases.md` 範例宣稱合計
   26,但依 `contracts/types.md` §2 的演算法逐字元推演是 23(表格本身逐行加總
   也是 23)。已在 `word-count-min.test.ts` 用 23 並附註,沒有動 README,懷疑
   是原文筆誤,麻煩跟 01-data-layer / 09-lint 對一下。

順手修了一個只影響我自己這三個檔的小 bug:`features/02-ingest-pipeline/phase-{1,2,3}.feature`
第一行的 tag 原本是 `@ingest`,但 `standaloneKey()` 的規則要求跟
`standalone.json` 的 key 同尾碼,`02-ingest-pipeline` 需要 `@ingest-pipeline`
才配得到(跟其他功能的 tag 慣例一致,例如 `@llm-router`、`@weekly-goal`)。
已改成 `@ingest-pipeline`,全域搜尋過沒有其他地方依賴舊名字。

`npm run prompt:golden` 現在會直接噴 `Cannot find module scripts/prompt-check.ts`——
12-prompt-quality 還沒建,不是這次改動造成的,先記著。
