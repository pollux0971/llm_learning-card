# T47 實作驗收證據

- 工單:T47(教學卡內容縮放、按鈕列黏底、視窗最小寬高)
- 被驗分支:t47-impl,sha 1508d6cffde721e47f8e4600da7597ad3264ecc0(起點 t47-start e645b52)
- 開跑與跑完的 tree sha:6c80a161c09907d59590dd787a1e0a3731fe5ff7(兩者相同;手改壞後都已還原,git status 乾淨)
- 日期:2026-10-24
- 工作樹:乾淨簽出(detached),node_modules 複製後移除自指連結,@learning/ui-shared 指向工作樹自己的 packages;沒有 .env

## 測試作者
對起點只改三個檔:apps/desktop/src-tauri/tauri.conf.json、apps/teach-card/src/App.svelte、docs/reviews/T47-implementation.md。沒有 *.test.ts、feature、support 檔。通過。

## 基準(未突變,VITEST_MAX_WORKERS=1)
| 項目 | 結果 |
|---|---|
| teach-card | 19 檔 289 條綠 |
| ui-shared + desktop | 45 檔 794 條綠 |
| tsc | 乾淨 |
| boundaries | PASS,掃 374 |
| doc-links | PASS,掃 131 |
| cucumber,標籤 @teach-card and not @manual | 24 場景 118 步綠 |
| cargo check(src-tauri,CARGO_BUILD_JOBS=2) | 通過;tauri-build 吃得下 conf |

## card-static 規則(App.svelte)
單一 HudPanel;無 svelte:window;無 style= 屬性(只有 Svelte 的 style: 指令);無原生 button;無 clip-path、box-shadow、outline、transition、色碼;顏色只用 var(--hud-*)。兩處 border-top、border-left 是舊的,不在本次 diff。

## tauri.conf.json
teach 視窗只加 minWidth 360、minHeight 400 兩個欄位。test 視窗不動。

## 手改壞(自選,都不在作者清單上)
測試範圍:兩個 t47 測試檔 + card-static + T35 提示測試(共 102 條);M7、M10 另用 teach-card 全部測試(271 條)。M24–M26 只跑 t47 靜態檔(7 條)。

| # | 改法 | 結果 |
|---|---|---|
| M1 | 級距表拿掉 1.25 | 紅 4 |
| M2 | 不存級距 | 紅 1(跨卡記住) |
| M3 | 歸零改成 1.1 | 紅 24 |
| M4 | 拿掉 sticky | 紅 24 |
| M5 | 黏底 bottom 改 40px | 紅 4(Z11 缺口已補,抓得到) |
| M6 | 黏底區塊拿掉底色 | 紅 1 |
| M7 | scroll-padding-bottom 改 0 | 102 全綠(只用 t47+T35);改用 teach-card 全部 271 條 → 紅 7(全是 T48 展開例子測試) |
| M8 | padding-bottom 改 1rem | 紅 4 |
| M9 | padding-bottom 改 0 | 紅 1(T35 那條 base > 0) |
| M10 | 放大層 fixed 改 absolute | **存活**(271 條全綠) |
| M11 | zoom 改 transform scale | 紅 11 |
| M12 | 數字鍵盤不認 | 紅 4 |
| M13 | Meta 不認 | 紅 1 |
| M14 | 拿掉 preventDefault | 紅 1 |
| M15 | 到頂繞回去 | 紅 1 |
| M16 | 壞儲存值回 1.1 而不是 1 | **存活** |
| M17 | 儲存值不驗證級距 | **存活** |
| M18 | Alt 組合也算 | **存活** |
| M19 | 縮小到底繞回去 | 紅 1 |
| M20 | 黏底區塊拿掉 flow-root | **存活**(低,疑似等價) |
| M21 | 儲存鍵改名 | **存活**(工單沒釘鍵名,不算缺口) |
| M22 | 級距 0.8 改 0.7 | 紅 19 |
| M24 | minWidth 300 | 紅 1 |
| M25 | minHeight 300 | 紅 1 |
| M26 | minHeight 拿掉 | 紅 1 |

共 25 個:紅 19(M7 要靠 T48 測試)、存活 6(M10、M16、M17、M18、M20、M21)。第一輪跑到 M19 後因機器很忙我中止,M20 因我的腳本寫錯重寫後重跑;其餘沒有省略。

存活判讀:
- M10:真缺口,低到中。放大層若不是 fixed,就會跟著捲動而不是蓋在視窗上,沒有一條測試量放大層的 position;這是 T46 就有的行為,本張只是沒改壞它。建議補一條計算值為 fixed 的量測。
- M16、M17:低。儲存裡放壞值或不在級距的值時的退路沒有測試。建議補一條:塞 1.7、abc,進卡後仍是 100%。
- M18:低。Ctrl+Alt+= 這類組合不該縮放,沒測試。
- M20、M21:等價或不算缺口。

## padding-bottom 1px(worker 的待協調)
合理。T35 測試明文要求原本的 padding-bottom 大於 0(約第 191 行);t47 測試 c 要求黏底後多出來的空隙 ≤ 2px。0 讓 T35 紅(M9 證實),16px 讓 c 紅(M8 證實),1px 兩邊都過。T35 不用改。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
worker 實際 4.44 美元,工單估 4,比值約 1.1 倍,沒有超過 2 倍。grok 審核:這次沒開。

## 結論
通過(附建議補測:M10、M16–M18)。
