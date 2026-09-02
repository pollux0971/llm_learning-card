# 12 · prompt-quality

## 一句話

讓 prompt 的改動有辦法被驗證。LLM 產品最常見的靜默退化就是有人改了 prompt、
輸出品質下降、幾週後才發現。

## 為什麼需要

`packages/core/prompts/` 底下的檔案決定了卡片、考題、審核的品質,但它們:

- 不是程式,型別檢查抓不到
- 輸出是自然語言,單元測試斷言不了
- 改動很輕鬆(改一行文字),後果很嚴重(所有新卡片變差)

一般的測試對這個完全無能為力。需要的是**golden fixture 加人工評分**:
把一份基準輸入用當前 prompt 跑一次、人評分、存下來;之後每次改 prompt 重跑並比對。

這不是要自動判斷「好不好」——那做不到。是要讓**變差這件事被看見**。

## 範圍

- prompt 檔案的組織與版本(每個 prompt 一個檔,改動走 git)
- golden set:每個 prompt 任務一組固定輸入
- `--golden` 模式:跑一次、產出並存到 `prompts/golden/<task>/<date>/`
- `--diff` 模式:比對兩次 golden run,列出每一項的差異供人看
- 人工評分表:每次 golden run 附一份 `SCORES.md`,你打分數
- 結構性的自動檢查(不判斷品質,只判斷格式):字數、JSON 合法、rubric 條數、
  空格數與答案數一致

## 不在範圍

- 自動判斷輸出「好不好」(做不到,別假裝)
- prompt 內容本身(各功能自己寫)
- LLM 呼叫(→ 03)

## 單獨執行

```bash
npx tsx scripts/prompt-check.ts --golden --task ingest.cards --fake
npx tsx scripts/prompt-check.ts --diff prompts/golden/ingest.cards/2026-09-10 prompts/golden/ingest.cards/2026-10-01
```

`--fake` 用重播 fixture,所以單獨執行不花錢也不需要網路。
真的評分要 `--live`,那會呼叫雲端。

## 依賴

| Phase | 需要 | 原因 |
|---|---|---|
| 1 | 無(用 FakeLlmRouter) | 框架本身不需要真模型 |
| 2 | I1 通過、03 phase-1 | 要有真的 prompt 與真的輸出才有東西可評 |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `scripts/prompt-check.ts` |
| golden 儲存 | `prompts/golden/<task>/<ISO date>/` 底下一堆檔 | 進 git,diff 看得到 |
| diff | 逐項並排,不做語意比對 | 人來判斷 |
| 變異門檻 | **標準 80%**,只針對結構性檢查 | diff 與儲存不用 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | golden 框架、結構性檢查、diff(FakeLlm) | Wave 0 | ready | |
| 2 | 真模型 golden run、評分表、回歸流程 | I2 | todo | |

## 什麼時候該跑

| 時機 | 模式 |
|---|---|
| 改任何 `prompts/` 底下的檔 | `--golden --live` 然後 `--diff` 對上一次 |
| 換雲端模型 | 同上,而且要重新評分 |
| CI | `--golden --fake`,只驗結構不驗品質 |

**改了 prompt 沒跑 golden 就 commit,是這個專案唯一會靜默毀掉品質的操作。**
這條寫進 CLAUDE.md。

## 開放問題

- 評分要幾個維度?先兩個:「正確嗎」「是一個概念嗎」,各 1–5 分。太多維度沒人會填
- golden set 要多大?先每個任務 3 個輸入。大了你不會想評
