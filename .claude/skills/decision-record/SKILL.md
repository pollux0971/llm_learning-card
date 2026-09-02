---
name: decision-record
description: 記錄一個技術或設計決策到 decision map。當任何有取捨的選擇被做出時使用——包含 AI 自己在實作過程中做的選擇,例如選了某個資料結構、某個錯誤處理策略、某個預設值,而那個選擇本來可以是別的樣子。也在使用者說「就這樣決定」「我們用 X 不用 Y」時使用。先評估會不會動到契約。
---

# /decide — 記錄決策

描述:

> $ARGUMENTS

## 第一步:讀取

- `docs/02-decision-map.md` 全部,記下最大 ADR 編號
- `contracts/types.md`——判斷這個決策會不會動到契約
- 相關的 `FEATURE.md` 與 `NEXT.md`

## 第二步:契約影響評估

**先做這個,它會改變後面的所有事。**

這個決策會不會需要修改 `contracts/`?先分清楚是哪一層(ADR-029):

**軟約定**(§5 §6 §13、§7 的函式簽章)——記憶體介面。
→ **不需要 ADR。** 告訴使用者「這只需要跑測試、更新 types.md、commit 說明理由」,
然後問還要不要記 ADR。多數情況不用,這個 skill 到此就可以結束。

**硬約定**(§2 §3 §4 §7 的 LlmTask 與路由表 §8–§12)——磁碟格式。
→ 需要 ADR,而且要:

1. 明確指出要改哪一節
2. 列出**需要重驗的 phase**:已 done 且使用該格式的、in-progress 的、受影響的整合點
3. 決定版本:改欄位語意 = major、加選填欄位 = minor、修文字 = patch
4. 提醒:**已經產生的 learning/ 資料可能需要遷移**。這通常才是真正的成本
5. **等確認**

硬約定難改是刻意的,因為改了會讓磁碟上已存在的資料失效。軟約定不該難改。

## 第三步:補齊資訊

五個欄位。從描述能推出多少填多少,**不足的一次問完**:

- **Context**:什麼情況、什麼限制,才需要這個決定?
- **Decision**:決定了什麼?(要能直接照做)
- **Alternatives**:考慮過但沒選的?為什麼沒選?
- **Consequences**:好處與代價?影響哪些 feature?
- **Related**:相關的 ADR、契約章節、features 資料夾?

使用者只給一句話時,主動補 Context 與 Alternatives 的草稿讓他確認,不要五個都問。

## 第四步:衝突檢查

逐一比對所有 `accepted` ADR 的 Decision:

- **推翻**:直接矛盾 → 新 ADR 標 `accepted · 取代 ADR-XXX`;舊的改 `superseded by ADR-NNN`;
  舊內容**不刪**;「已推翻」索引加一行
- **修正**:改了參數但不改方向(如 daily_cap 10 → 8)→ 新 ADR 的 Related 寫 `修正 ADR-XXX`,舊的不動
- **無關**:正常新增

推翻時**明確問**:「這會推翻 ADR-XXX(標題),確定嗎?」等確認。

## 第五步:寫入

`docs/02-decision-map.md`,在最後一筆 ADR 之後、「待決」段落之前:

```
## ADR-NNN · <標題,一句話>

- **Status**: accepted · <日期>[ · 取代 ADR-XXX][ · 修正 00-design.md §X][ · 契約升版至 X.Y.Z]
- **Context**: …
- **Decision**: …
- **Alternatives**: …
- **Consequences**: …
- **Related**: …
```

同時:
1. 更新頂部 mermaid 依賴圖:加節點,有 Related 就畫箭頭(被依賴的指向新的)
2. 推翻的話更新舊 ADR 的 Status 與「已推翻」索引
3. 「待決」表有對應項目 → 移除

## 第六步:連動

- **動了契約** → 更新 `contracts/types.md` 的版本號與該節內容;
  把重驗清單寫進報告;若有已 `done` 的 phase 受影響,把它的狀態改回 `in-progress` 並在 NEXT.md 註明原因
- 改變某功能的技術棧 → 提示更新該 `FEATURE.md`
- 改變某 phase 的 gate → 提示更新該 `NEXT.md`
- 改變設計文件內容 → 在 `docs/00-design.md` 頂部的「已知不同之處」加一行,**不改正文**
- 讓某些 `.feature` 場景不再正確 → 列出受影響的場景,提示用 `/feature` 處理

## 第七步:回報

```
✓ ADR-NNN 已記錄:<標題>
- 契約影響:無 / 升版至 X.Y.Z,需重驗:…
- 推翻 / 修正 / 無關:…
- 依賴圖已更新
- 連動提示:…
```

## 禁止事項

- 不刪除任何 ADR
- 不修改既有 ADR 的 Context / Decision / Alternatives / Consequences(只能改 Status)
- 不修改 `docs/00-design.md` 正文
- ADR 編號只增不重用
- 不在未評估契約影響前寫入
