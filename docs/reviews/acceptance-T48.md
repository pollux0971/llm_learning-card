# T48 驗收證據(實作:同一張卡不重算例子 html、放大跟著視窗重算)

- 被驗分支:`t48-impl` ffaade6d1eefff95d1ea3fcba31057bc6e170f41(起點 `t48-start` ef3ed84,含紅測試)
- 驗收開跑與跑完的 tree sha:f12607acd6f4a482d2bd9de970a8fb1a90734c1b(同一棵,中間沒改任何檔)
- 日期:2026-10-24;驗收:驗收 agent;`VITEST_MAX_WORKERS=1`;工作樹是乾淨簽出,`.env` 不存在,`node_modules/@learning/*` 指向自己的 packages
- 本檔只是證據,結論由顧問裁決

## 測試作者

- t48 的三個測試檔與測試支援檔只來自紅測試的 commit;實作 commit 只動 `apps/teach-card/src/App.svelte` 與 `docs/reviews/T48-implementation.md`(`git diff --name-only t48-start..t48-impl` 兩個檔)。
- 不動的地方:對 `packages`、`contracts`、`apps/desktop`、`scripts`、`features/07-teach-card`、`teach-session.ts`、`apps/teach-card/dev` 的 diff 沒有輸出。
- 提交裡 `mutants.out` 的檔數:0。

## 基準(未突變,真實作)

| 項目 | 結果 |
|---|---|
| `apps/teach-card/` 加 `packages/ui-shared/src/` 的 vitest | 42 檔 703 條全過(含 t48 渲染與靜態、T46 渲染、card-static、card-render、T34/T35) |
| 型別檢查(tsc) | 乾淨 |
| boundaries | PASS,掃 371 檔 |
| doc-links | PASS,掃 131 檔 |
| cucumber teach-card phase-4(不含 manual) | 1 個場景,3 步全過 |
| cucumber teach-card phase-1 | 10 場景 41 步全過 |
| cucumber teach-card phase-2(不含 manual) | 5 場景 25 步全過 |
| cucumber teach-card phase-3(不含 manual) | 8 場景 49 步全過 |

這份實作不在變異測試範圍(App.svelte 不在設定裡),沒有跑變異測試。

## 讀 App.svelte 的 diff

- 記憶鍵 = path + cardText(各自比相等),只記一份(上一張卡);鍵一樣就回同一個 html 字串,不呼叫 renderMarkdown、不讀 storage。
- 記憶不是 `$state`(寫進 `$derived` 不會變依賴)。折疊狀態只在鍵不一樣時讀。
- 離開卡片畫面(`view.state` 不是 card)用 `$effect` 清記憶,不在 `parsed()` 裡清;註解寫了理由($derived 惰性)。
- 放大:打開時存 `naturalWidth` / `naturalHeight`;視窗改大小時 `place()` 用它們照目前視窗重算「等比例裝進視窗的最大」;寬高沒變就不寫;改回原本大小就回到原本。
- `.lc-missing` 改成 `:global(.lc-missing)`,字級與顏色沒變。
- card-static 禁令:最外層仍只有一個 HudPanel、沒有 `<svelte:window>`、沒有 `style=` 屬性(用 `style:` 指令)、沒有 border/outline;card-static 測試全過。

## 改壞證明(對真實作重做;每版只改 App.svelte,跑 t48 兩檔加 T46 渲染,共 39 條,改完還原並確認檔案相同)

| # | 改了什麼 | 結果(紅的測試) |
|---|---|---|
| M1 | 命中條件改成恆假(每次重算) | 紅 7:f 六條、h |
| M4 | 鍵只比 path | 紅 1:h |
| M12 | 鍵只比 cardText(不含 path) | 紅 1:新的「鍵要含 path」測試(上一輪這個存活,補測試後被抓到) |
| M5 | 鍵恆真(有記憶就命中) | 紅 7:T46 a 四條、b、e;T48 h 與「鍵要含 path」 |
| M6 | 拿掉離開卡片畫面清記憶的 effect | 紅 1:T46 a「換類別再選類別」(只有這條抓到) |
| M15 | 清記憶改寫進 `parsed()` 裡 | 紅 1:同上 |
| M19 | 只在 loading 時清 | 紅 1:同上 |
| M7 | resize 時不重算寬高 | 紅 3:g 的 resize 三條 |
| M17 | 拿掉 resize 監聽 | 紅 3:同上 |
| M25 | 蓋層大小沒變就跳過重算 | 紅 3:同上 |
| M26 | 只放大不縮回(縮小時不重算) | 紅 3:同上 |
| M8 | 裝進視窗的算式 min 改 max | 紅 7:T46 d 兩條、T48 g 五條 |
| M10 | 只看高、不看寬 | 紅 4 |
| M11 | 放大後乘 0.9 | 紅 7 |
| M24 | 重算時寬高對調 | 紅 7 |
| M9 | `:global(.lc-missing)` 改回 scoped | 紅 1:靜態 i |
| M20 | 只在 categories 時清記憶 | **存活** |
| M21 | loading、categories、error 時清,finished 不清 | **存活** |
| M22 | 寫記憶時拿舊記憶的 frontmatter(之後命中時標題與標記會是上一張卡的) | **存活** |

共 19 版,16 紅、3 存活。不在作者清單的版本(我自己設計):M12、M20、M21、M22、M24、M25、M26、M10、M11。

### 存活項

- **M22(真缺口,低到中)**:記憶裡的 frontmatter 若是舊卡的,換卡之後同一張卡再 pull 一次(取消、輪詢),標題與類別、等級標記會變成上一張卡的。目前沒有測試在 pull 之後量標題或標記;f 與 h 的卡每次 frontmatter 都一樣。實作本身是對的(命中時回的是同一張卡自己的 frontmatter)。建議補測試:換卡之後(下一個到另一個 frontmatter 的卡),取消或輪詢一次,量標題與標記沒變。
- **M20(低)**:只有 categories 會清;loading、error 離開再回同一張卡時,舊 html 會被重新掛上。要走到這條路需要「卡片 → error 或 loading → 同一張卡」;我沒找到在不改側車的情況下能走到的真實路徑(error 出現在開卡時),所以標低、不判阻擋。
- **M21(多半等價)**:finished 離開只能經過「換類別」進 categories,那裡本來就清。

## grok 審核

沒有跑(工單沒有要求,實作只有 App.svelte 一個檔、58 行)。

## 資料前後(只記數字)

| | 檔案數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | c2e4dd6d71de3976 | 108 |
| 後 | 64 | c2e4dd6d71de3976 | 108 |

## 花費

worker 實際 $2.08,工單預算 $2,比值 1.04,沒有超過 2 倍;約 20 分鐘。驗收的 CPU 時間:vitest 完整一次、cucumber 四條、改壞 19 版各一次。

## 結論

通過(有一個建議補的測試缺口 M22,沒有阻擋項)。
