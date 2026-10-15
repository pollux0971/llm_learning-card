# 驗收證據:14-hud-skin phase-1(HUD 元件與展示頁)

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t14p1-opencode` @ `29592d2`(樹 `55fb38439086`),base `t14-red` = `2ca266e`(`origin/main` `6798c1e` 加 -e5 的紅測試)。worker 兩個 commit:`e6384ac` 實作、`29592d2` 報告。實作者:opencode grok-4.7(名目 $5.49,不設上限只記錄)。
我的補測在其上的分支 `pollux0971/t14p1-accept-tests`;所有突變都在驗收用簽出做、事後還原。
我只交證據與測試。不合併、不 push、沒改 worker 的實作檔。

## 0. 結論

**實作沒有阻擋項。** 協調者列的六件事:(1) 字型來源與授權、(2) 三條必有、(3) 沒有 inline style、(4) 沒有 import 06/07、(5) 展示頁跑得起來,都有證據;(6) `@manual` 外觀由顧問判。
測試端一類缺口(§3):`HudPanel` 沒傳 prop 時讀頁面根元素 class,原本沒有測試,拿掉整段仍全綠。已補。

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | `HudPanel` 在沒傳 `frameless` / `solid` 時讀 `<html>` 的 `hud-frameless` / `hud-solid`(桌面殼 10 phase-6 設的契約)沒有測試:突變「忽略根元素 class」存活 | 補 4 條,兩個突變紅 |
| F-2 | 備註,等價 | `hpPercent` 的 `total <= 0` 改成 `< 0` 仍然正確(`done/0` 得 `Infinity`,下一行 `!isFinite(raw)` 兜住);純外觀的 `font-display: swap` 沒有測試 | 不處理 |
| F-3 | 備註 | grok 審查說 `HpBar` 的 `style:--hp-fill` 違反 CSP。**實測不成立**(§4):`style:` 指令走 CSSOM,嚴格 CSP 下 0 筆違規 | 無 |
| F-4 | 備註,給協調者 | 全 cucumber `undefined` 250(舊基準 241):多出來的 9 個我逐個檔案比對過——是 `features/10-desktop-shell/phase-6.feature` 5 個與 `features/14-hud-skin/phase-2.feature` 4 個,都是 14-hud-skin 規格帶進來、之後 phase 才會寫步驟的場景。**14 phase-1 的 11 個場景全綠、0 failed** | 之後的 phase 實作時歸零 |
| F-5 | 備註 | `learning/` 在驗收期間被別人改了:19:19–19:24 的 golden run(18 次 `llm_call`,`--live` 煞車解除後的第一次真跑)讓帳本從 52 行變 70 行。不是我跑的;協調者的 `bf84ce3` 已記載新基準 | 見 §1 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t14p1`(基於 `t14p1-opencode`),沒有 `.env`。
- **測試作者檢查**:`git diff --name-only 2ca266e 29592d2` 中 `*.test.*`、`/tests/`、`test-support/`、`features/steps/**`、`.feature`、`contracts/fixtures/**` 的變動共 **0** 個;worker 動 16 個檔,全在 `packages/ui-shared/src/hud/`(5 個 Svelte 元件、`hud.css`、`hp-bar.ts`、`layout.ts`、`window-controls.ts`、`gallery/` 四個檔、`fonts/` 兩個檔)加報告。
- `learning/`(唯一量法):驗收開始時 64 檔 / `c5aa80b18b474ed4` / 52 行;結束時 **64 / `ee37f9e1fa9193c6` / 70 行**。差別全部來自 F-5 那次 golden run(新增的 18 行都是 `llm_call`,時間 11:19–11:24Z,對應 `bf84ce3` 記載的「18 次 $0.1157、帳本 70 行 ee37…」)。**不是 14 phase-1 的驗收造成的**:我的所有指令都不寫 `learning/`。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `packages/ui-shared`(vitest) | 10 檔 97 條綠;加我的補測後 101 條 |
| cucumber 全 feature | 738 場景(250 undefined、488 passed、0 failed),3383 步;14 phase-1 的 11 個場景綠(見 F-4) |
| 全部 vitest(`witness:degraded` 內含) | 3617 條綠、168 跳過 |
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries`、`npm run lint:docs` | PASS(掃描 266、46 條連結) |
| `witness:degraded` | 未標記 **151**(基準 152,可降到 151);目錄/呼叫點/觸發 27/27/27 |
| 靜態(`hud-static.test.ts`、`hud-css.test.ts`) | 沒有 `style=` 屬性、沒有外部網址、沒有 import 06/07、動畫都有 reduced-motion 對應 |

## 3. 字型與三條必有(協調者 (1)(2))

**(1) 字型。** 我從上游 `google/fonts` 倉庫的 `ofl/rajdhani` 重新下載 `Rajdhani-Medium.ttf` 與 `OFL.txt`,與 repo 裡的逐位元組比對:**兩個檔完全相同**(sha256 `12ff7dcfe4c206e3875ac53b1762eab57de6a2fa7f5a86c26b97b88d6591eac2`)。字型自己的 `name` 表:`Rajdhani Medium`、版本 `1.201`、`Copyright (c) 2014 Indian Type Foundry`、授權 `SIL Open Font License, Version 1.1`。`OFL.txt` 是完整原文(PREAMBLE、DEFINITIONS、五條 PERMISSION & CONDITIONS、TERMINATION、DISCLAIMER 都在)。報告所述屬實。`FEATURE.md` 技術棧那一列(worker 待協調 #1)還沒回寫,歸協調者。

**(2) 三條必有。** 對實作做 19 條突變,跑 `packages/ui-shared` 全部測試:

| 要求 | 突變 | 結果 |
|---|---|---|
| 沒有 `hud-frameless` 不畫標題列與把手 | H1 標題列永遠畫、H2 把手永遠畫、H16 `HudPanel` 永遠畫標題列 | 全紅 |
| 同上(讀根元素 class) | H15 忽略根元素 `hud-frameless`、H17 忽略 `hud-solid` | **原本存活**(F-1);補測後紅 |
| 不在 Tauri 時按鈕隱藏、不丟錯 | H3 不在 Tauri 也畫按鈕、H4 按鈕不要求 frameless、H5 永遠當可用、H9 `minimize` 不先檢查 | 全紅 |
| 視窗動作轉給對的方法 | H6 `close` 轉給 `minimize`、H7 `startDragging` 空動作、H8 縮放方向不轉 | 全紅 |
| `prefers-reduced-motion` 關動畫 | H10 不關 `animation`、H11 不關 `transition` | 全紅 |
| 血條 | H12 不夾上限、H13 做了四捨五入、H14 `total` 為 0 | H12、H13 紅;H14 等價(F-2) |
| 字型本地載入 | H18 改成外部網址、H19 拿掉 `font-display` | H18 紅;H19 純外觀(F-2) |

## 4. 展示頁與 CSP(協調者 (3)(5))

- `npx vite packages/ui-shared/src/hud/gallery`:`index.html`、`main.ts`、`Gallery.svelte`、字型都回 200;vite log 0 個錯。
- `npx vite build packages/ui-shared/src/hud/gallery`:成功(231 ms);字型當獨立資源輸出(384 KB,沒有內嵌成 `data:`);輸出的 `index.html` 沒有 `style=`。
- **嚴格 CSP 實測**:把 build 結果放在帶 app 的 CSP(`default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'`,沒有 `style-src`)的伺服器上,用 headless Chrome 打開:**0 筆 CSP 違規**;DOM 裡 3 個 `hp-bar` 的 `--hp-fill`(0%、66.67%、100%)都套上了——`style:` 指令是 CSSOM 操作,CSP 放行。這推翻 grok 審查的第 1 條。

## 5. 對抗審查(grok-4.20)

五條主張:(1) `HpBar` 的 `style:` 違反 CSP——**不成立**(§4 實測);(2) `$derived(readRoot(...))` 在根元素 class 之後才加時不會更新——**是設計**:桌面殼在頁面載入前就設好 class(契約),且 prop 優先;(3) SSR 與 client 的 hydration 不一致——本專案沒有 SSR 路徑(Tauri 只做 client render);(4) `disabled="false"`——Svelte 對布林屬性不會輸出 `false`;(5) 明確的 `frameless={false}` 蓋過根元素——這是已測的優先序。沒有成立的主張。

## 6. 補測

我的 commit(`pollux0971/t14p1-accept-tests`):`packages/ui-shared/src/hud/panel-root-class.test.ts`(新,4 條:根元素有 / 沒有 `hud-frameless`、prop 優先、`hud-solid` 的三種情形;用 stub 的 `document` 在 node 裡跑 SSR render)。

## 7. 成本

worker 名目成本 $5.49(session 資料庫的 cost)。工單沒有預算值可比;使用者裁決 grok 不設花費上限,只記錄。
