# T49 紅測試驗收證據

- 工單:T49(黏底那一塊不透明、底下不留縫)。只驗測試,不驗實作。
- 被驗分支:t49-red,sha a4ce539d9c64930bda137ac994b6cdf3f801bd06(基底 main 63877ee)
- 開跑與跑完的 tree sha:44eb90dbcd1ce0d04357e0699597009b73a3cc37(相同;每次改壞後都已還原,git status 乾淨)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 只動測試
對 63877ee 只改兩個檔:apps/teach-card/src/t47-zoom-layout-render.test.ts(+127/−1)與新檔 apps/teach-card/src/t49-dock-opaque-render.test.ts。沒有實作檔。

## 基底紅綠
基底的 App.svelte(T47 實作)上,T49 新檔 32 條 = 22 紅 / 10 綠;T47 渲染檔 64 條全綠。10 條綠是「捲到最底」守門條(底下沒有東西可透)。與測試 agent 自報一致。

## must_catch 對照
| must_catch | 測試 | 我的改壞版 | 結果 |
|---|---|---|---|
| a 半透明 | T49 a | N1 黏底只剩面板色(半透明) | 紅 14 |
| a 色差 > 1 | T49 a | N2 黏底只剩 solid 色 | 紅 18 |
| b 底下留縫 | T49 b | N3 拿掉補縫(bottom 0、偽元素不往下多蓋) | 紅 12 |
| padding-bottom 0 | T35 | N4 | 紅 14 |
| bottom 改 4px | T47 c | N5 | 紅 16(含 T47 c 與 f) |

## 丟棄式實作(不進 git,已刪)
.dock 底用 solid 色,加兩個偽元素(solid 墊底、面板色在上)往下多蓋 1px,sticky 的 bottom 與 margin-bottom 各 -1px。T49 + T47 渲染 + card-static + T35 共 131 條全綠;teach-card + ui-shared + desktop 65 檔 1119 條全綠;tsc 乾淨;boundaries 375。
過程中兩個較天真的版本都不成立(證實「補縫與 T47 c 不能同時用 0.5 px」):
- 偽元素往下多蓋 2px(bottom 0):T49 全綠,T47 c 紅 4 條(多出可捲範圍)。
- 偽元素往下多蓋 1px(bottom 0):T47 c 綠,T49 Wayland b 紅 4 條(提示時有 2 排)。

## 自選改壞(都不在作者清單上)
測試範圍:T49 新檔、T47 渲染檔、card-static、T35 提示測試(131 條)。

| # | 改法 | 結果 |
|---|---|---|
| N6 | 不黏(relative) | 紅 56 |
| N7 | 兩個偽元素都不往下多蓋 | 紅 4(Wayland b) |
| N8 | 面板色那層比 solid 短 | 紅 10 |
| N9 | solid 那層比面板色短 | 紅 4(Wayland b) |
| N10 | 拿掉 .dock 的 z-index | **存活**(sticky 本來就自成堆疊環境,等價) |
| N11 | bottom 改 2px(離窗底 2px) | 紅 16 |
| N12 | bottom -1px 但不加 margin-bottom -1px | **存活**(只差可捲範圍多 1px,測試容差內;低,幾近等價) |
| N13 | bottom 0 但留 margin-bottom -1px | 紅 4 |

## 補測 M10 / M16 / M17 / M18(用我自己的改壞版)
| 項目 | 我的改壞 | 結果 |
|---|---|---|
| M10 | 放大層 fixed 改 absolute | 紅 2(100%、150%) |
| M16 | 壞的記錄值回 1.1 而不是 1 | 紅 1 |
| M17 | 記錄值只驗是正數、不驗級距 | 紅 1 |
| M18 | Ctrl+Alt 也算(拿掉 altKey 判斷) | 紅 1 |
| M18b | 只放行 Alt+= | 紅 1 |
都不寫死記錄用的鍵名,按一次看哪個鍵變 1.1,合理。

## 容差 0.5 → 1.5 px(21c0e18)
- diff 確認:T47 檔裡只動了「按鈕位置相同」那一個比較函式(上、中、下捲動),其餘是新增的補測;T45、T46、T48 與 T47 d 的 0 px 容差沒動。
- 必要性:把容差改回 0.5,我的實作(以及上面兩個天真版本)捲到底都差 1.0 至 1.3 px,T47 c 紅 4 條。補縫的偽元素讓最底停靠位置與黏住位置差約 1 px,兩者在 CSS 上無法同時成立。
- 有沒有放掉要擋的東西:沒有。放寬後,不黏(N6)、bottom 4px(N5)、bottom 2px(N11)都還是紅;「離窗底 ≤ 2 px」與「整塊在看得見範圍」沒動。沒黏住的會差幾十到幾百 px,離 1.5 很遠。
- 殘留:黏住的位置在 1.5 px 內漂移現在抓不到,屬真實視覺上看不出的差。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
測試 agent 寫紅測試,不是工單 worker 花費。LLM 真呼叫 0。grok 審核這次沒開。

## 結論
通過。
