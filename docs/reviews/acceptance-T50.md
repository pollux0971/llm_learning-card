# T50 實作驗收證據

- 工單:T50(沒有 Wayland 提示時,黏底那一塊的偽元素不往下多蓋)
- 被驗分支:t50-impl,sha f9b3fc5609102076ee0a3be4b3aca7fdb473cc06(起點 t50-start 6143aae)
- 開跑與跑完的 tree sha:909f6ce1c43a2a86c6c6475b15d79b5243157ff0(相同;每次改壞後都已還原,git status 乾淨)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 測試作者
對起點只改兩個檔:apps/teach-card/src/App.svelte(<style>,+10/−4)與 docs/reviews/T50-implementation.md。沒有測試檔。起點與 t50-red 的差只有文件。通過。

## 基準
| 項目 | 結果 |
|---|---|
| teach-card + ui-shared + desktop(三路徑一起跑) | 65 檔 1119 條全綠;另有 1 檔(apps/desktop 的 learning-root-probe 測試)在這次一起跑時載入失敗、沒跑到(10 條被跳過),見下方說明 |
| apps/desktop 單獨再跑 | 20 檔 312 條全綠(含上面那一檔 10 條) |
| tsc | 乾淨 |
| boundaries | PASS,掃 376 |
| doc-links | PASS,掃 142 |
| cucumber,標籤 @teach-card and not @manual | 第一次 24 場景中 1 個失敗(114/118 步過、3 步被跳過);原因沒能保留下來;不改任何東西再跑一次:24 場景 118 步全綠 |

說明:兩次異常(一個測試檔載入失敗、cucumber 一個場景失敗)都發生在機器 load 約 28(別的專案在跑)的時候,重跑都綠,也沒法重現。我沒有看到任何指向 T50 改動的證據,但這是「沒重現」不是「查出原因」,如實記下,請顧問知道。T50 的 10 條、T49 的 32 條、T47 渲染檔、card-static、T35 在第一次一起跑時就全綠。純 CSS,不跑變異測試。

## 做法(讀 diff)
偽元素 inset 預設 0;只在 :global(body:has(> #lc-wayland-note)) 時偽元素 bottom 為 -1px。黏底那一塊本身的 bottom、margin-bottom 各 -1px 照舊。沒有色碼、style= 屬性或畫框屬性。

## 改壞(手改 t50-impl 的 App.svelte,測試範圍:T50、T49、T47 渲染、card-static、T35 共 141 條)
| # | 改法 | 結果 |
|---|---|---|
| R1 | 一律多蓋(拿掉 :has 規則,inset 回 -1px) | 紅 8,全在 T50(c1、c3、c4) |
| R2 | :has 裡提示的 id 寫錯 | 紅 6(T50 c2 + T49 b Wayland) |
| R3 | 多蓋整個拿掉 | 紅 6(T50 c2 + T49 b Wayland) |
| R4 | 拿掉黏底的 margin-bottom -1px | 紅 2(T50 c4) |
| R5 | 黏底的 bottom 改 0 | 紅 12(T49 b) |
| R6 | :has 規則 bottom 改 -2px | 紅 2(T50 c2) |
| R9 | :has 規則裡放 box-shadow | 紅 1(card-static) |
7 個全紅,沒有存活。每次還原,最後 git status 乾淨。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
worker 1.72 美元,工單預算 1,比值 1.72 倍,沒有超過 2 倍。LLM 真呼叫 0。grok 審核這次沒開。

## 結論
通過(附兩次沒重現的負載下失敗,見基準區塊)。
