# T56 實作驗收證據

- 工單:T56(HUD 的縮放把手與標題列,改在 mousedown 開始拖拉、只認左鍵)
- 被驗分支:t56-impl,sha c8c214a513322fc9dbba0d951b160f8e1b07fd41(起點 d347fff)
- 開跑與跑完的 tree sha:508c25a8543281cddf986929232d0f86e6a89c89(相同;改壞後都已還原)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 測試作者與範圍
對起點只改 3 個檔:packages/ui-shared/src/hud/HudResizeHandles.svelte(+5/−4)、HudTitleBar.svelte(+5/−4)與 docs/reviews/T56-implementation.md。測試檔沒動。渲染測試共 61 條 = 紅測試的 51 條加後補的 f 組 10 條(「不加 preventDefault」,是我上一輪建議、由測試 agent 補的);f 組在起點就已存在,不是 worker 加的。通過。

## 基準(VITEST_MAX_WORKERS=1)
| 項目 | 結果 |
|---|---|
| hud-drag-wiring-render.test.ts(真 Chrome 渲染) | 61 條全綠 |
| packages/ui-shared + apps/teach-card + apps/test-card 全部 | 53 檔 1198 條全綠 |
| tsc | 乾淨 |
| boundaries | PASS,掃 379 |
| doc-links | PASS(從主簽出以 --root 對含本證據檔的工作樹跑) |
手動確認(grep):兩個元件裡沒有 preventDefault、沒有 onpointerdown;只有 onmousedown;左鍵判斷(button 不是 0 就 return)在把手與標題列各有;標題列保留 closest('button') 的擋法。工單不跑變異。

## 改壞(手改 t56-impl,測試範圍:渲染測試 61 條)
| # | 改法 | 結果 |
|---|---|---|
| Z1 | 標題列加 preventDefault | 紅 2(f) |
| Z2 | 把手加 preventDefault | 紅 9(f) |
| Z3 | 標題列同時掛 pointerdown 與 mousedown | 紅 5(a 1、d 2、e 2) |
| Z4 | 把手改回 pointerdown | 紅 16(d) |
| Z5 | 標題列拿掉 closest('button') 擋法 | 紅 3(c) |
| Z6 | 把手拿掉左鍵判斷 | 紅 3(b) |
6 個全紅,沒有存活。上一輪存活的 preventDefault 缺口(Y11)現在由 f 組抓到。每次還原,最後 git status 乾淨。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
實際花費:不知道(協調者沒給)。工單預算 1 美元。

## 結論
通過。@manual(R、E1、E4、E8、E5、E7b)仍由前端做、顧問判。
