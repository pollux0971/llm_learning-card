# T49 實作驗收證據

- 工單:T49(黏底那一塊不透明、底下不留縫)
- 被驗分支:t49-impl,sha 775e5756bdffe8f81f364e7746eb06142560918e(起點 t49-start 00da5bf)
- 開跑與跑完的 tree sha:294a9b273a0eabd221a1f260b4cfc4e5836387f9(相同;每次改壞後都已還原,git status 乾淨)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 測試作者
對起點只改兩個檔:apps/teach-card/src/App.svelte(+32/−6)與 docs/reviews/T49-implementation.md。沒有測試檔。t49-red 與 t49-start 的測試檔沒有差異。通過。

## 基準(未突變,VITEST_MAX_WORKERS=1)
| 項目 | 結果 |
|---|---|
| teach-card + ui-shared + desktop | 65 檔 1119 條全綠(含 T49 新檔 32、T47 渲染檔、card-static、T35 提示) |
| tsc | 乾淨 |
| boundaries | PASS,掃 375 |
| doc-links | PASS,掃 136 |
| cucumber,標籤 @teach-card and not @manual | 24 場景 118 步綠 |

純 CSS 改動,不跑變異測試。

## 做法(讀 diff)
.dock 底用 solid 色;::before 鋪面板色、::after 墊 solid 色,兩者往下多蓋 1px;sticky 的 bottom 與 margin-bottom 各 -1px;padding-bottom 仍 1px。沒有色碼、沒有 style= 屬性、沒有畫框屬性、沒有漸層;card-static 綠。

## 改壞(手改 t49-impl 的 App.svelte,測試範圍:T49 新檔、T47 渲染檔、card-static、T35,共 131 條)
| # | 改法 | 結果 |
|---|---|---|
| Q1 | 黏底只剩面板色(半透明) | 紅 14 |
| Q2 | 黏底只剩 solid 色 | 紅 18 |
| Q3 | 拿掉補縫(bottom 0、不加 margin、偽元素不往下多蓋) | 紅 12 |
| Q4 | padding-bottom 改 0 | 紅 14(含 T35) |
| Q5 | bottom 改 4px | 紅 16 |
| Q6 | 不黏(relative) | 紅 56 |
| Q7 | solid 墊底層比黏底短(不往下多蓋) | 紅 3 |
| Q8 | bottom 改 2px | 紅 16 |
| Q9 | padding-bottom 改 1rem | 紅 16 |
| Q10 | 面板色那層比 solid 短 | 紅 10 |
10 個全紅,沒有存活。每次改壞後還原,最後 git status 乾淨。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
worker 0.963 美元,工單預算 2,比值約 0.48 倍,沒有超過 2 倍。LLM 真呼叫 0。grok 審核這次沒開。

## 結論
通過。
