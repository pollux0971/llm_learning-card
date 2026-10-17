# T32 驗收證據(考試卡 header 同一行,只改 CSS)

- 被驗分支:t32-opencode,tip 8445d03(起點 t32-start 8da755a = main 59f220b + 紅測試 7476c55)
- 驗收開跑與跑完的 tree sha:2bf5890ceeed2a50ee79494de38ef5d4f121bf16(前後相同)
- 日期:2026-10-18
- .env:不存在(ls 失敗)。

## 測試作者
worker 兩個 commit(4fefb49 實作、8445d03 報告)只動 App.svelte 與 docs/reviews/T32-report.md,測試檔 0 變動。

## 只改 style(顧問裁決,看 diff)
App.svelte 的 diff 只有一個 hunk,全在 style 區塊(+7/−2):.progress 由 grid 改 flex、flex-wrap、column-gap 0.75rem、row-gap 0.2rem,新增 .progress 直接子節點 hp-bar 的 :global 規則 flex-basis 100%。標記、文字、class、HpBar 位置都沒動。

## 基準
- t32 測試檔:6/6 綠。
- ui-shared、apps/test-card、apps/review 全部測試:27 檔 591 條綠(含 T15、T23 的考試卡渲染測試與靜態測試)。
- tsc:0。boundaries:PASS(336)。
- svelte 編譯警告:1 條 state_referenced_locally,起點版本也是同一條;沒有新的,沒有 Unused CSS selector。

## 丟棄式改壞(只改 App.svelte,每個跑完還原)
| 改壞 | 結果 |
|---|---|
| 拿掉 :global | 3 紅(HP 條間距、寬度、答一題後) |
| 只 flex + gap(拿掉 wrap) | 3 紅 |
| 拿掉 flex-basis | 3 紅 |
| flex-direction column | 3 紅 |
| row-reverse | 2 紅 |
| space-between | 2 紅 |
| column-gap 7px / 25px(邊界外一格) | 各 2 紅 |
| column-gap 8px / 24px(恰好邊界) | 綠,符合規格 8–24 |
| row-gap 0.3rem / 0 | 各 2 紅 |
| row-gap 0.25rem | 綠:差 0.8 px,在容許 ±1 內 |
| flex-basis 90% | 2 紅 |
| align-items flex-end | 綠:兩段字高一樣,不改位置,等價 |

## 資料前後
learning/:64 個檔、雜湊 c2e4dd6d71de3976、帳本 108 行,前後相同。

## 花費
worker 自報 0.71 美元。工單預算:不知道(未查)。

## 結論
通過
