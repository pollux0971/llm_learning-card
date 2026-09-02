# llm/ — 預錄回應

`FakeLlmRouter` 從這裡讀,所以 Wave 0 的測試完全離線且確定性。

格式:

```json
{
  "task": "ingest.cards",
  "prompt_contains": "web-basics",
  "attempt": 1,
  "response": { "text": "…", "provider": "fake", "model": "recorded",
                "latency_ms": 0, "provisional": false }
}
```

依 `task` + `prompt_contains` 選檔,同一組有多個 `attempt` 時依呼叫次數遞增。
都不中就丟錯——「忘記錄某個情境」要立刻爆,不要靜默回空字串。
