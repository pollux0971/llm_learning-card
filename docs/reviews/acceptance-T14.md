# 驗收證據:T14 14-hud-skin phase-1 修補(面板半透明、1 像素框線、焦點內框、格線搬出共用樣式、中英混排字高)

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t14-opencode` @ `a66a143`,base `t14-base` = `0d08b78`(前端的紅分支 `t14-hud-fixes-red` `88ac33c` 合進 `origin/main` `4108154`)。
worker 三個 commit:`4a707fc` 實作、`99b2bf2` 報告、`a66a143` 報告補超額花費。實作者:opencode grok-4.7(名目 $3.62,預算 $3 ≈ 1.2×,只記錄)。
測試作者:前端 -30(`f1b94e5`、`c1656be`、`6c2a105`、`88ac33c`)。我的補測在其上的分支 `pollux0971/t14-accept-tests`。
我只交證據與測試。不合併、不 push、沒改 worker 的實作檔。**觀感(驗收 8)不是我的**:前端重拍、顧問判。

## 0. 結論

**實作沒有阻擋項。** 工單十一條 `must_catch` 都有會紅的測試,實作全綠。
測試端兩個缺口(§3),都補了:按鈕被撐寬時的框線、焦點內框的粗細。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | 突變 K10(拿掉標籤的 `flex: 1 1 auto`)原本存活:前端的框線測試只量展示頁上「剛好等於文字寬」的按鈕;按鈕一旦比文字寬(卡片裡給 `min-width` 或 `width: 100%`),標籤兩側會露出黑底 | 補 1 條(三顆按鈕都撐到 320px 量兩側),K10 紅 |
| F-2 | 缺口,已補 | 突變 K12(焦點內框 2px → 0.5px)原本存活:「焦點跟 hover 只差 30 個像素」就過,內框細到看不見也過。實測內框是 2 像素、約 312 個像素的差 | 補 1 條(差 ≥ 250 個像素,且按鈕上半部中線那一欄有恰好 2 列接近 `--hud-solid` 的像素),K12 紅 |
| F-3 | 備註,等價 | K7(深色切換只拿掉橫線)存活:縱線(`::before` 的虛線層)獨自就提供對比;兩層都拿掉(K7b)則紅 | 無 |
| F-4 | 備註 | 工單 `touches` 列了 `HudPanel.svelte`、`HudButton.svelte`,worker 沒動(實作不需要);只動 `hud.css`、`Gallery.svelte` 與報告 | 無 |
| F-5 | 成本 | 名目 $3.62 / 預算 $3 ≈ 1.2×,未超過 2× 旗標線 | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t14`(基於 `t14-opencode`)。
- **測試作者檢查**:`git diff --name-only 0d08b78 a66a143` 中 `*.test.*`、`/tests/`、`test-support`、`features/steps/**`、`.feature`、`contracts/fixtures/**` 的變動共 **0** 個;worker 只動 `hud.css`(+63)、`gallery/Gallery.svelte`(+35)與報告。
- 驗收前後 `learning/`(唯一量法):**64 檔 / `ee37f9e1fa9193c6` / 70 行**,前後相同(我只讀)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `packages/ui-shared/src/hud`(vitest,含 headless Chrome 的渲染檢查) | 12 檔 105 條綠;加我的補測後 107 條 |
| `packages/ui-shared` 全部 | 121 條綠;加我的補測後 123 條 |
| cucumber `@hud-skin and @phase-1 and not @manual` | 19 場景 19 綠,57 步全綠 |
| cucumber 全 feature | 765 場景(250 undefined、515 passed、0 failed);undefined 是之後 phase 才寫步驟的場景,與 base 相同 |
| `npx tsc --noEmit`、`npm run boundaries`、`npm run lint:docs` | 0 錯、PASS(掃描 275)、PASS(51 條連結) |
| `witness:degraded` | 未標記 **149**(基準 152,可降到 149);目錄/呼叫點/觸發 27/27/27 |
| 併進最新 main(`4108154`) | `git merge-tree`:無衝突 |
| CSP | 原始碼沒有 `style=` 屬性(grep 非測試的 `.svelte`/`.html`/`.ts` 為 0);`vite build` 後 `index.html` 沒有 `style=`、沒有 `<style`;把 build 結果放在 app 的嚴格 CSP(`default-src 'self'; script-src 'self'`)下用 headless Chrome 打開:**0 筆 CSP 違規** |

## 3. 工單 `must_catch` 的突變(我自選,不在前端清單上)

做法:改一處實作 → 跑 `packages/ui-shared` 全部測試(121 條)→ 記紅 → `git checkout` 還原。

| 目標 | 突變 | 結果 |
|---|---|---|
| 面板半透明 | K1 alpha 0.9 → 0.99(剛好過閾值)、K8 黑線層壓回面板底下(`z-index` 2 → −1)、K9 拿掉 `evenodd`(黑線整片蓋住) | 全紅 |
| 框線 1 像素 | K2 `1px` → `1.4px`、K10 標籤不撐滿、K11 按鈕不是 flex | K2、K11 紅;**K10 原本存活**(F-1),補測後紅 |
| 焦點跟 hover 不同 | K3 內框只在 `hover` 且 `focus` 才出現、K13 內框顏色改成跟底差不多、K18 hover 沒有橘底、K12 內框 0.5px | K3、K13、K18 紅;**K12 原本存活**(F-2),補測後紅 |
| 共用樣式不畫頁面底色 | K15 `html` 規則裡又有 `background-color`、K14 `hud.css` 提到 gallery(註解) | 全紅 |
| 字高 | K4 `size-adjust` 100.5%(大於 100% 但比例不在區間)、K5 135%、K6 拿掉 | 全紅 |
| 深色背景 | K7 只拿掉橫線層、K7b 兩層都拿掉、K16 深色其實是亮色、K17 深色模式把面板改成不透明 | K16、K17、K7b 紅;K7 等價(F-3) |

(K19 想拿掉斜邊的線但改到了不影響外觀的頂點,是我寫壞的突變,不計;斜邊線有前端的 `DIAGONAL_INK` 檢查守著。)

## 4. 觀感與其餘

- 驗收 8(觀感)與 `@manual` 不是我的。
- 沒有跑 grok 審查:這張只動 CSS 與展示頁,像素與樣式檢查已經是實測;對抗審查對 CSS 的價值低於上面的非作者突變。

## 5. 補測

我的 commit(`pollux0971/t14-accept-tests`):`packages/ui-shared/src/hud/render-accept.test.ts`(新,2 條,用 headless Chrome,找不到 Chrome 就紅)。

## 6. 成本

worker 名目成本 $3.62;工單 `budget_usd: 3`;比值 **≈ 1.2×**,未超過 2× 旗標線。
