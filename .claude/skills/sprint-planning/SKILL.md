---
name: sprint-planning
description: 規劃本週要做哪幾個 phase。當使用者問「接下來做什麼」「下一步」「哪些可以開始了」,或要求規劃本週時使用。讀所有 NEXT.md 算出哪些 phase 的 gate 已滿足,特別標出卡在「契約待決事項」的那些——那是使用者可以立刻解除的阻塞。
---

# /sprint — 規劃本週

指定週(可空):`$ARGUMENTS`

## 第一步:決定週

有值就用它;空的話用今天的 ISO 週(`date +%G-W%V`)。
檔案 `docs/sprints/<週>.md`。已存在就問「要重新規劃還是查看?」。

## 第二步:收集狀態

- `docs/01-roadmap.md` 的「現況」表與各階段的 phase 表
- **每一個** `features/*/NEXT.md`——這是 ready 判定的權威來源
- 每一個 `features/*/FEATURE.md` 的 phase 表
- 上一週的 sprint 檔,看哪些沒變成 done
- `docs/02-decision-map.md` 的「待決」表——契約 gate 靠它

## 第三步:計算 ready

對每個 `todo` 的 phase,查它在 `NEXT.md` 的三類 gate:

| Gate | 怎麼查 |
|---|---|
| 自身 | 前一個 phase 的狀態 |
| 整合 | roadmap 現況表,該整合點是否已通過 |
| 契約 | decision map 的待決表,該項目是否已決定 |

三類都滿足 → 實際上是 `ready`,**順手把 FEATURE.md 改成 ready**。
有一類沒滿足 → 維持 `todo`,記下卡在哪一類。

列出所有 `ready` 與 `in-progress`。

## 第四步:WIP 提醒

數 `in-progress`。超過 2 就提醒一次:
「目前有 N 個 phase 進行中,建議不超過 2。要先收掉幾個嗎?」

**使用者說要繼續就繼續。** 這是建議不是規則。

## 第五步:挑選

### Wave 0 期間

十一個都 ready(`11-review-cli` 不參與 Wave 0,見 ADR-028)。挑選規則不同於之後:

1. **Carry over 優先**
2. **解鎖最多的優先**:掃所有 `NEXT.md`,數每個 phase 完成後能解鎖幾個別的 phase。
   `01-data-layer/phase-1` 應該排最前(它產出 fixture,所有人都受惠)
3. **關鍵路徑優先**:03-llm-router 與 04-scheduler 是 I1 與 I2 的關鍵路徑。
   `12-prompt-quality/phase-1` 是最便宜的(約半天),早做完的話 02 與 05 寫 prompt 時就有基準可存
4. 總數 2–4 個
5. 明確告訴使用者:「Wave 0 順序自由,以下只是建議。想先做想做的也可以。」

### I1 之後

1. **Carry over 優先**
2. **目前整合點優先**:只從現況表指的整合點挑。那個整合點的 ready 全挑完才看下一個
3. **依賴鏈優先**:被最多其他 phase 依賴的先挑
4. 總數 2–4 個
5. ready 少於 2 個 → 就挑那幾個,並列出「以下 phase 在等什麼」:每個卡住的 phase 卡在哪一類 gate

### 估計

每個 phase 標「小(≤1 天)/ 中(2 天)/ 大(3 天)」。總和超過 5 天就少挑一個。
依據:場景數、`@manual` 比例、是否碰 LLM、變異門檻是不是嚴格(95% 的模組要多算半天)。

## 第六步:寫入

用 `docs/sprints/README.md` 的範本,填:

- 階段(Wave 0 / IN)
- 目標一句話(從 roadmap 該階段的「你做得到什麼」改寫)
- 本週 phase 表(含變異門檻欄)
- Carry over
- `@manual` 場景清單:從本週每個 phase 的 `.feature` 抓出所有 `@manual`,一行一個 checkbox
- 單獨執行檢查:本週每個 phase 的「單獨執行」指令,一行一個 checkbox
- Retro 空白區(Wave 0 期間多一題:「有沒有發現契約缺東西?」)

同時:
- 挑中的 phase 在各 `FEATURE.md` 改 `in-progress`
- 各 `NEXT.md` 的「進行中」欄更新
- roadmap 現況表的「目前 sprint」更新

## 第七步:回報

```
✓ Sprint <週> 已規劃(階段:Wave 0 / IN)
- 本週:(phase、預估、變異門檻)
- Carry over:…
- 新變為 ready 但沒挑:…
- 仍卡住的 phase 與卡在哪:
    07-teach-card/phase-2 — 整合 gate(等 I3)
    03-llm-router/phase-2 — 契約 gate(本機模型未決定)★ 這個你可以現在就決定
- 檔案:docs/sprints/<週>.md
```

**卡在契約 gate 的要特別標出來**——那是使用者可以立刻解除的阻塞,不是等待。

最後問:「從哪個開始?」

## 禁止事項

- 不挑 gate 未滿足的 phase(除非使用者明確說要)
- I1 之後不跳整合點
- 不改 `.feature` 內容
- 不強迫使用者照建議順序——Wave 0 尤其如此
