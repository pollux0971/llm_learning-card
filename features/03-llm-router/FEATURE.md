# 03 · llm-router

## 一句話

所有 LLM 呼叫的唯一入口。呼叫端只說任務,router 決定走本機還是雲端。

## 範圍

- 契約 §7 的 `LlmRouter` 實作
- 雲端 adapter:Anthropic、OpenAI
- 本機 adapter:Ollama HTTP API
- 網路與本機可用性偵測(含 60 秒快取)
- 路由表(契約 §7 的權威表)
- provisional 標記與複審佇列
- 每次呼叫寫 log

## 不在範圍

- 任何 prompt 內容(各功能自己管)
- 審核邏輯(→ 05)
- 對回傳做業務解析(呼叫端做)

## 單獨執行

```bash
LLM_CLOUD_PROVIDER=anthropic ANTHROPIC_API_KEY=... \
  npx tsx scripts/llm.ts --task deepen --prompt "用 50 字解釋同源政策"
npx tsx scripts/llm.ts --probe        # 印出線上與本機狀態,不呼叫模型
```

預期輸出:第一個印出 `LlmResult` 的 JSON;第二個印出 online / local 與可用模型清單。

## 依賴

**Wave 0(phase-1)**:無。log 寫入用自己的最小 appender。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | 自身 phase-1 | 路由建立在介面上 |
| phase-3 | 自身 phase-2、I5 通過 | provisional 只在真的離線用過才有意義 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| 最小 log appender | `packages/core/src/llm/log-min.ts` | I1(改用 01 的) |

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/core/src/llm/` |
| 雲端 | 官方 SDK | 只在 adapter 內 import |
| 本機 | fetch → `http://localhost:11434/api/generate` | 不用第三方 client |
| 設定 | 環境變數優先於 settings.yaml | |
| 變異門檻 | **標準 80%**,但 `routing.ts` 為**嚴格 95%** | 路由表決定成本與離線行為,必須測滿 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 介面、雲端 adapter、log、逾時 | Wave 0 | ready | |
| 2 | 本機 adapter、離線偵測、路由表 | I1 | todo | |
| 3 | provisional 標記與複審佇列 | I6 | todo | |

## 驗收方式

路由決策全自動(mock 網路與 Ollama 狀態)。真呼叫只在 `@llm` 與 `@manual`。
`routing.ts` 的變異門檻 95%——契約 §7 的表格每一格都要有測試。

## 開放問題

- 雲端逾時 60 秒是否太長?先這樣,用了再調。
- token 用量要不要做 UI?先只 log。
