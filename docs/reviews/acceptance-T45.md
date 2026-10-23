# T45 實作驗收(教學卡系統狀態字樣不推動按鈕、直角引號不折斷)

- 工單:`docs/tickets/T45-teach-card-status-layout.md`
- 被驗分支:`t45-impl` = 5d06a8fa67efc515b802192749be3652c949e6b0(基底 t45-start 97a4de8 = main 7dc6b60 + t45-red 75011fc)
- 驗收開跑 / 跑完的 tree sha:19efaf432c22e00e5e734cafa7e0b2b300dbe851 / 同(原始碼沒被留下改動)
- 日期:2026-10-24;驗收者:驗收 -5b;無 .env

## 1. 測試作者與不動的地方
- `git diff --name-only 97a4de8..5d06a8f`:只有 App.svelte 與 docs/reviews/T45-implementation.md。測試檔 0 個。mutants.out 0。
- packages、contracts、apps/desktop、features、scripts、teach-session.ts、main.ts 的 diff:0 行。

## 2. 基準
- tsc 乾淨;boundaries PASS 364;doc-links PASS 131。
- 完整 vitest:246 檔全過,6648 條過、171 跳過(含 t45 42 條、t44 渲染與 session、t43、T40 靜態、card-static、Wayland T34/T35、零輸入守門)。
- cucumber(--tags,皆 not @manual):@hud-skin and @phase-2 13 步;@teach-card phase-3 49、phase-2 25、phase-1 41,全過、rc 0。

## 3. card-static 窄例外沒被擴大(讀 App.svelte 的 style 與標記)
- 分隔線只在 .generating,.deepen-error 這一條規則(1px solid var(--hud-line));外層 .status-slot 只有 display 與 min-height,不畫任何線。
- 沒有 style= 屬性、沒有 transition/animate/in/out 指令、沒有漸層、沒有 outline/box-shadow/clip-path/mask;顏色只用 var(--hud-*)。card-static 綠。
- `<div class="controls">` 標記沒動(整檔仍是 2 處,都在原位);沒有碰 .hud-body 的 padding-bottom。

## 4. 留位置的高度
- 寫法:`.status-slot { display: flow-root; min-height: calc(67.4px + 0.75rem + 2px); }`。67.4 是 360 寬量到的最高金鑰句(missing / ANTHROPIC_API_KEY,3 行)的邊框盒高;加上 0.75rem 的 margin-top,再留 2px 次像素。flow-root 有用:拿掉它,第一個 p 的 margin-top 會外溢,按鈕列在字樣收掉時多動 12px(手改 J7 紅)。
- 評語:是量過的數字加註解,不是估的;用 min-height 不是 height,字樣再長也只會往下長、不會推上面的按鈕。缺點(低):67.4px 是寫死在 CSS 的魔術數字,字型或字級改了要重量;註解已寫明來源。
- 兩行高度只夠 60px 的版本(J3)會紅;70px(J3b)也紅(生成中那塊 73.5px 比 70 高)。紅測試階段的丟棄式版本在 70/75px 不紅,是因為那一版的位置結構不同;這份實作兩者都紅,沒有問題。

## 5. 手改抽驗(只改 App.svelte,改完還原;跑 t45、t44 渲染、card-static,共 67 條)
| # | 改法 | 結果 |
|---|---|---|
| J1 | 字樣搬回按鈕列上面、不留位置 | 紅 27(a、b 各轉換、c…) |
| J2 | 拿掉 min-height | 紅 9(b) |
| J3 | 位置 60px(只夠兩行) | 紅 5(b) |
| J3b | 位置 70px | 紅 4(b) |
| J4 | 分隔線搬到外層 .status-slot | 紅 5(t44 g×3、t45 d、card-static) |
| J5 | 拿掉直角引號不折行規則 | 紅 2(e) |
| J6 | 不折行的長度上限改 3 字 | 紅 2(e) |
| J7 | 拿掉 flow-root | 紅 1(b 生成中→沒字) |
| J8 | 「取消」縮成 0.85rem | 紅 2(t44 g、t45 d) |
| J9 | 只對 deepen-failed 那句做不折行 | 紅 1(e 注入那句) |
10 個全紅。

## 6. 變異測試:跳過
理由:T45 只改 App.svelte 的標記與 `<style>`,加一個純函式 quoteParts(切直角引號段)。Stryker 的 TypeScript 變異不處理 .svelte 的 style 與標記;quoteParts 在 .svelte 裡,同樣不在變異範圍。teach-session.ts 這次沒改。quoteParts 的行為由渲染測試 e 守,並用 J5、J6、J9 手改驗過(各紅 1 到 2 條)。

## 7. 資料與花費
- learning/ 前後:64 檔 / c2e4dd6d71de3976 / 108 行,相同。
- 花費:worker 自述 $2.56,預算 2,比值 1.28,未超過 2 倍。

## 8. 結論
通過。
