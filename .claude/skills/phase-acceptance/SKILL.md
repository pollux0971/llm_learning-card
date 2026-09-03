---
name: phase-acceptance
description: 驗收一個 phase。當使用者說某個 phase 做完了、寫完了、可以收了,或問「這樣算完成了嗎」時使用,跑測試、跑單獨執行指令、跑嚴格級變異測試、列出人工確認清單。防止「感覺做完了」就標記完成。也在使用者直接要求 /phase-done 時使用。
---

# /phase-done — 驗收

目標:`$ARGUMENTS`

## 第一步:定位

解析為 `features/<NN-name>/phase-<N>.feature`。找不到就停,列出該資料夾有哪些 phase。

讀取該 `.feature`、該資料夾的 `FEATURE.md` 與 `NEXT.md`、`docs/01-roadmap.md` 找出所屬階段。

## 第二步:前置檢查

- 狀態必須是 `in-progress`。`todo` / `ready` → 回報「尚未開始」並停。`done` → 回報完成日並停。
- `NEXT.md` 的三類 gate 必須都滿足。有未滿足的,列出並停。

## 第三步:自動場景

```
NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@<name> and @phase-<N> and not @manual"
```

`<name>` 是資料夾名稱去掉編號前綴(例如 `04-scheduler` → `scheduler`,`01-data-layer` → `data-layer`)。
**不要用位置路徑參數限定範圍**——`cucumber.js` 的 `paths` 與 CLI 位置路徑是合併(concat)不是覆蓋,
給了路徑一樣會跑全 repo 的 453 個場景,只有 `--tags` 才真的縮小範圍(ADR-036/037)。
也不要漏掉 `NODE_OPTIONS=--import=tsx` 前綴,沒有它會直接 `ERR_UNKNOWN_FILE_EXTENSION` 掛掉,不是靜默的假結果。

`features/steps/` 為空時改跑 `npx vitest run`,並把每個非 `@manual` 場景對照到測試名稱,
回報哪些場景沒有對應測試。

記錄:通過數、失敗數、失敗場景與錯誤摘要。

## 第四步:單獨執行

從根目錄的 `standalone.json` 取出該功能的項目,**實際執行 `cmd`**。

- `interactive: false` → 跑它,退出碼 0 且輸出含 `expect` 字串 → 通過
- `interactive: true`(dev server 之類) → 無法自動驗,列進 `@manual` 清單
- 跑不起來 → **不算 done**,即使所有測試都過。這是核心項目

`standalone.json` 沒有這個功能的項目 → 提醒補上,但不擋。

## 第五步:Wave 0 的獨立性檢查(選配)

**只在該 phase 屬於 Wave 0 時執行。**

```
npm run boundaries
```

它掃跨資料夾 import,合法的只有 `contracts/`、自己的目錄、第三方套件。

發現違規 → **回報但不擋**。多數情況這是真的問題,但也可能是一個合理的例外
(`11-review-cli` 就是 ADR-028 記錄的例外)。列出來讓使用者判斷,
如果是刻意的例外,提示用 decision-record 記一筆。

順帶確認 `FEATURE.md` 的「Wave 0 的重複」表有列出這個 phase 造的 stub。漏了就補。

## 第六步:變異測試

依 `FEATURE.md` 的變異門檻欄位:

| 級別 | 做法 |
|---|---|
| **嚴格 95%** | 跑。**未達不算 done**——這些模組算錯會延遲數週才顯現 |
| 標準 80% | 跑。未達**回報但不擋**,問使用者要不要處理 |
| 寬鬆 | 跳過 |

```
npx stryker run --mutate "<該 phase 的原始碼路徑>"
```

用 `mutation-testing` skill 的準則判讀存活的變異。

## 第七步:@manual 場景

列出所有 `@manual` 場景加上第四步無法自動驗的:

```
## 需要你親手確認

- [ ] Scenario: The header shows how far through the session the person is
      預期:header shows zero of three
- [ ] 單獨執行:`npm run dev -w apps/test-card` 能啟動且顯示第一題
```

問:「以上都確認過了嗎?哪些沒過?」**等回覆。**

## 第八步:判定

**核心四項全過** → done:
1. 非 `@manual` 場景全過
2. 單獨執行通過(或是 interactive 且使用者確認)
3. 嚴格級變異達 95%(非嚴格級不擋)
4. 使用者確認所有 `@manual`

其餘是選配,沒做只回報不擋。

### 若 done

1. `FEATURE.md` 該 phase 狀態改 `done`,填完成日
2. **更新 `NEXT.md`**:「目前」表的已完成加這個 phase、下一個改成下一個 phase;
   重新評估下一個 phase 的三類 gate,把已滿足的打勾
3. 檢查其他資料夾的 `NEXT.md`,有哪些 phase 因此 gate 滿足了 → 列出來
4. 檢查是否所有 phase 都 done → 更新 `features/README.md` 索引
5. 檢查該階段(Wave 0 或某個 IN)的所有 phase 是否都 done → 若是,提示可以跑 `/integrate`
6. 建議 `git tag <NN-name>/phase-<N>`
7. 回報:
   ```
   ✓ <NN-name>/phase-<N> 完成
   - 自動場景 X / X
   - 單獨執行:通過
   - 變異測試:X%(門檻 Y%)
   - Wave 0 獨立性:通過 / 不適用
   - 人工場景 Y / Y
   - 新解鎖的 phase:…
   - 階段進度:…
   ```

### 若未通過

不改任何狀態。逐項列出哪一步沒過、為什麼。

## 第九步:順帶檢查

用 Grep 找 `TODO` `FIXME` `HACK` `provisional`,列出並問要處理還是留著。留著就寫進 FEATURE.md 開放問題。

問:「這個 phase 有沒有做什麼取捨還沒記進 decision map?」有就提示 `/decide`。

## 禁止事項

- 不在單獨執行指令跑不起來時標 done
- 不在**嚴格級**變異未達 95% 時標 done
- 不在 `@manual` 未確認時標 done
- 不修改 `.feature` 讓它通過(要改規格先走 feature-triage)
- 不為了通過而調低 `stryker.config.json` 或 `FEATURE.md` 的門檻
