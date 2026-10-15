# 驗收證據:T15(14-hud-skin phase-2:教學卡與考試卡換上 HUD)

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-16(Asia/Taipei)。host 8 cores,驗收期間 load 約 2–3。
被驗分支:`pollux0971/t15-opencode` @ `00b202a`(3 個 commit:`d518d0c` 實作、`f25157b` 實作報告、`00b202a` 報告補累計花費),
紅測試作者 `6d299ad`(-e5,基底 `b4d7e6d`)。驗收用簽出 `acceptance-t15`,開跑時 tree `f5483f484fcdb87ce66f4238e8c762b8171396e3`,跑完後實作檔無變動(突變全已還原,`git status` 空)。
我只交證據,不合併、不 push、沒改 worker 的任何實作檔;這次沒有補測試(理由見 §6)。

> **本檔分兩部分**:§0–§11 是第一輪(`00b202a`)的驗收;第十二節起是**最終候選 `e862936`**(第四輪)的整輪重驗,以第十二節為準。第二、三輪(`ca24bd6`、`53af8d9`)被顧問退回,我在那兩個 tip 上也跑過基準與突變,但不是最終版,結果只留筆記、摘要見第十二節 §12.7。

## 0. 結論

**沒有阻擋項。** 工單 18 條 `must_catch` 由 -e5 的紅測試對應,在 worker 實作上全綠;我另做 18 條非作者突變,10 條紅、8 條存活;存活的 6 條是等價或疑似等價、2 條是工單沒要求的覆蓋缺口(§5)。
三個要特別看的點:

| # | 項目 | 結果 |
|---|---|---|
| 1 | 範例是否逐字照抄(顧問要求) | **兩張卡的新增行大部分跟測試支援檔的範例逐字相同**(考試卡新增 29 行裡 25 行、教學卡新增 22 行裡 11 行),見 §3。抄了不等於錯;範例通過的檢查,實作也通過 |
| 2 | 靜態掃描 vs 畫出來的量測 | 分開列於 §2,兩邊在 worker 實作上都綠 |
| 3 | CSP | build 產物 0 違規(§4) |

## 1. 乾淨簽出、測試作者檢查、基準

- 簽出:`git worktree add` 從 `00b202a`;`ls .env` → No such file。`node_modules` 自 `acceptance-t13` 複製(兩邊 `package-lock.json` 逐位元相同),`src-tauri/target` 複製(cucumber 用)。
- **測試作者檢查**:`git diff --name-only 6d299ad 00b202a` 共 7 檔(兩張卡的 `App.svelte`、`HudField.svelte`〔新〕、`HudPanel.svelte`、`hud.css`、`gallery/Gallery.svelte`、worker 報告),符合 `*.test.*`、`test-support`、`features/steps`、`.feature`、`contracts/fixtures` 的檔數 **0**。`git log --name-only 6d299ad..00b202a | grep -c mutants.out` = **0**。
- 落點都在工單 touches 內。`main.ts` 兩個都沒改:`hud.css` 是在兩張卡的 `App.svelte` 內 import 載入的(`import '@learning/ui-shared/hud/hud.css'`),測試有查「必須 import hud.css」。
- 重編:cucumber 的 `BeforeAll` 自己 `cargo build --bin lc-fs`,三次輸出都是 `Finished dev profile … in 0.17–0.19s`(複製來的 target 已是新的,沒有 Rust 檔變動)。
- 基準(未突變,`CI=1 VITEST_MAX_WORKERS=1 CARGO_BUILD_JOBS=2`):

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned 288) |
| vitest `packages/ui-shared/src/hud apps/teach-card apps/test-card` | 23 檔,**240 passed,0 failed,0 skipped**(`PANEL_FILLS_WINDOW` 是 true,沒有被跳過的 `runIf`) |
| cucumber `@hud-skin and @phase-2 and not @manual` | 4 scenarios 全過(13 steps) |
| cucumber `@hud-skin and @phase-1 and not @manual` | 19 scenarios 全過(57 steps) |
| cucumber `(@test-card or @teach-card) and @phase-1 and not @manual` | 16 scenarios 全過(75 steps) |
| cucumber `^The real front ends are loaded$` | 1 scenario 過 |
| `npm run lint:docs`、doc-links | PASS |
| `npm run build:frontends -w apps/desktop` | 成功(兩次 vite build) |

## 2. 靜態掃描 與 畫出來的量測(分開列)

兩者不互相背書。紅測試的靜態自測是對 -e5 自己的範例跑的;這裡列的是對 **worker 真檔**的結果。

| 類別 | 測試 | 對 worker 實作 |
|---|---|---|
| 靜態:原始碼掃描 | `card-static.test.ts`(8 條:最外層一個 HudPanel、無原生 button、不畫框與顏色字面值、import 路徑與 hud.css 載入、CSP、HudField 包法、HpBar 綁定、結果標記) | 全綠 |
| 靜態:掃描器自測 | `card-static-self.test.ts`(對範例改壞) | 全綠(它不看 worker 的檔) |
| 靜態:設計值 | `gallery-phase2.test.ts` 的 `--hud-pass` / `--hud-fail` 最差對比 ≥ 4.5、HudField 規則 | 全綠 |
| 靜態:cucumber | `@hud-skin` phase-2 場景 1(教學卡掃描)、場景 2(考試卡掃描) | 通過 |
| 畫出來:HP 條與結果字樣 | `card-render.test.ts` 的驗收 3(0 / 3 → 1/3 的 data-percent、綠段像素、「1 / 3」字)、驗收 2(剛好「✓ 答對了」「× 答錯了」,兩色換成同色字樣不變)、送出鍵出現時機、Enter 送出 | 全綠;cucumber 場景 3 通過 |
| 畫出來:版面 | 驗收 5(面板矩形 0,0,360,480、整頁不捲、四邊墨水)、驗收 6(例子框左右 ≥ 12 像素)、驗收 7(送出鍵不捲動就看得到、`elementFromPoint`) | 全綠 |
| 畫出來:展示頁 | `gallery-phase2.test.ts` 的 HudField 框線 / 切角 / 高寬 / focus / 停用、D1 頁首對比(一般與深色)、面板下緣、前三顆按鈕索引 | 全綠 |
| 退步 | `card-regression.test.ts`(done phase 的 `.feature` 雜湊)、cucumber 場景 4、T14 的 hud 測試 | 全綠 |

靜態自測過、畫出來的量測不一定過:worker 自述第一次量教學卡底邊墨水是 1.85(不是 1),修過才綠(`.hud-cut-inner` 底距 8 像素)。這正是工單要分開驗的情形。

## 3. 範例是否逐字照抄(顧問要求 1)

做法:把 `card-static-samples-test-support.ts` 的兩個範例(`GOOD_TEACH_APP`、`GOOD_TEST_APP`)展開成檔,跟 worker 的 `App.svelte` 與基底(`6d299ad`)版比對,去掉前後空白、略過空行,以「行」為單位。

| 項目 | 教學卡 | 考試卡 |
|---|---|---|
| 範例非空行數 / worker 非空行數 | 82 / 95 | 171 / 175 |
| worker 的行裡,逐字出現在範例的 | 84(88%) | 171(98%) |
| 序列相似度(difflib,行為單位) | 0.915 | 0.983 |
| worker 相對基底**新增或改過**的行 | 22 | 29 |
| 其中逐字等於範例的行 | 11 | **25** |
| 不在範例裡的新增行 | 11(`const controls = …`、`<HudPanel title="教學卡" {controls} fill>`、`flex-wrap`、`h2` / `.body` / `.controls` 的樣式) | 4(`const controls = …`、`<HudPanel title="考試卡" {controls} fill>`、`.prompt` 的樣式) |

觀察:
- 考試卡幾乎是範例:包括兩個 `<HudField>` 分支(`{#if i === 0}` 第一格 / 其他格)、`!(view.result && !view.error)`、`data-result={…}` 與符號字串、`<HpBar>` 與 `.progress` 的 grid、`.pass` / `.fail` 的樣式,都是同樣寫法。差別只在面板開頭(`const controls` 然後 `{controls} fill`,範例是 `controls={createWindowControls()} fill`)和一個 `.prompt` 樣式。
- worker 的報告自己寫「紅測試範例只讀、沒改」並且「prop 名字跟範例對齊」,承認參考了。
- 範例有 `fill` 這個 prop 名;工單只說「做法由實作者選」,worker 採用它,並自己實作 `HudPanel` 的 `fill` 與 `hud.css` 的撐滿規則(這些不在範例內,範例只有標記)。
- 這是**測試支援檔放近似完整範例**造成的(顧問 2026-10-16 已把這點寫進 SKILL 0.5 第 4 條)。判斷:不算 worker 違規,但 §2 靜態那排的綠不能證明「worker 自己會寫對」,所以畫出來的量測與非作者突變(§5)才是主要證據。

## 4. CSP(顧問要求 3)

- `npm run build:frontends -w apps/desktop`:兩張卡各一次 vite build,產物在 `apps/desktop/dist/teach/`、`apps/desktop/dist/test/`;字型 `Rajdhani-Medium-*.ttf` 隨輸出,沒有 `.ts`。
- 兩個 `index.html`:`style=` 與 `<style` 出現次數都是 0。
- 用 `tauri.conf.json` 的 CSP 字串(`default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'; img-src 'self' lc: data:; connect-src ipc: http://ipc.localhost`)當標頭,把產物放在本機伺服器,headless Chrome 360 × 480 開兩頁(`--enable-logging=stderr`,虛擬時間 5 秒):**0 筆 CSP / console 違規**。兩頁的 DOM 都有渲染出來(教學卡:`panel`、`button`;考試卡:`panel`、`button`、`field`、`hp-bar`),不是空白頁。
- 做法跟 T14 一樣(不跑 `tauri build`)。

## 5. 非作者突變(顧問要求 4)

做法:改 worker 的**真實作檔**(不是範例),跑 `packages/ui-shared/src/hud apps/teach-card apps/test-card`(240 條),記紅 / 活,`git checkout` 還原。刻意避開 -e5 自測清單的靜態與執行期改壞點(那些改的是範例字串)。腳本與清單在驗收者的暫存區,不進版控。還原後每條 `tracked-diff-lines=0`。

| # | 改了什麼 | 結果 |
|---|---|---|
| N1 | `hud.css`:卡片面板捲動區外的 8 像素底距改 0 | 紅(1 條,教學卡底邊墨水) |
| N2 | `hud.css`:`.hud-body` 的 `overflow: auto` 改 `visible` | 紅(3 條) |
| N3 | `hud.css`:作答欄 `min-height` 36→30 | **存活,等價**:框的實際高度由輸入框內距加行高決定(約 37 像素),`min-height` 沒有作用 |
| N4 | `hud.css`:作答欄 `:focus-within` 底色與 outline 改成黑線色 | 紅(1 條) |
| N5 | `hud.css`:作答欄停用不變淡 | 紅(1 條) |
| N6 | `hud.css`:作答欄外層切角 8→4 像素 | 紅(1 條,斜邊墨水) |
| N7 | `hud.css`:面板 `inset: 0` 改 `inset: 4px` | 紅(2 條) |
| N8 | 教學卡:`.lc-example` 左右負邊距,離內緣約 11 像素 | 紅(1 條,邊界外一格) |
| N9 | 教學卡:負邊距,離內緣約 13 像素 | 存活,等價(邊界內,仍 ≥ 12) |
| N10 | 考試卡:送出鍵條件改成 `!view.result && !view.error` | 存活,疑似等價:評分失敗時 `view.result` 本來就是空的,兩個式子同值;沒找到能分開它們的狀態 |
| N11 | `Gallery.svelte`:頁首底色 `--hud-solid` 改 `--hud-panel`(0.9 白) | 存活,等價:仍是接近白的底,對比不變 |
| N12 | `hud.css`:`html:has(.hud-fill)` 的 `overflow: hidden` 拿掉 | 存活,等價:面板是 `position: fixed`,文件本來就不會長出捲軸 |
| N13 | `hud.css`:`--hud-fail` 改 `#e5484d`(對比 < 4.5) | 紅(1 條,對比檢查) |
| N14 | `HudPanel.svelte`:`hud-fill` 一律開(展示頁也撐滿) | 紅(6 條) |
| N15 | 考試卡:HpBar 與「x / y」字的順序對調 | 存活,等價:工單只要求兩者在同一個 `header.progress`,沒規定順序 |
| N16 | 教學卡:`.body` 的 `overflow-wrap: anywhere` 拿掉 | **存活,覆蓋缺口(非工單要求)**:fixture 卡沒有超長不斷字,所以沒測到。真實內容有很長網址時,內文會往橫向撐出捲動區 |
| N17 | `hud.css`:作答欄輸入框內距 `0.4rem 0.6rem` 改 0 | **存活,覆蓋缺口(非工單要求)**:字貼框,沒有量尺;工單沒給內距數字 |
| N18 | `hud.css`:作答欄內層 `.hud-field-face` 的切角拿掉 | 紅(1 條,斜邊墨水) |

統計:18 條,**10 紅**(N1、N2、N4、N5、N6、N7、N8、N13、N14、N18),**8 存活**:等價 5 條(N3、N9、N11、N12、N15)、疑似等價 1 條(N10)、覆蓋缺口 2 條(N16、N17)。

兩條缺口不擋:N16、N17 不在工單驗收條件裡。建議列為後續(§8)。

## 6. 補測試

沒有補。理由:所有存活突變不是等價,就是工單沒要求的行為(內距、超長字)。要補的話,N16 需要一張內文有超長不斷字的 fixture,那是改 `apps/teach-card` 的 fixture(測試支援),超出這次範圍,交給顧問決定要不要開後續。

## 7. grok-4.20 對抗審查

`opencode run -m xai/grok-4.20-0309-reasoning`,從空目錄跑,提示只給工單、diff、兩個渲染測試全文;**沒有給**測試支援檔(它因此看不到量尺細節)。一次成功,花費不顯示(不知道)。它的主張與我重現的結果:

| 主張 | 我的重現 |
|---|---|
| 用 `fill` 達成撐滿,違反「class 由桌面殼決定」 | 未證實。`fill` 加的 class 是 `hud-fill`,不是 `hud-frameless` / `hud-solid`;工單 §5 明寫「做法由實作者選」,N7 / N14 證明量測會咬住它 |
| 考試卡 `.progress` 用 grid 可能讓量測偏移 | 未證實。HP 條與字樣的測試全綠,N15(順序)不影響 |
| HudField 的數字「極可能直接複製自測試支援檔」 | 部分:這些值(1 像素、30 像素差等)寫在工單與 FEATURE.md,不只在支援檔。我另外直接比對的結果在 §3 |
| 展示頁頁首與「第一個面板不動」衝突 | 未證實。測試「第一個面板與前三顆按鈕維持原樣」全綠 |
| `runIf(PANEL_FILLS_WINDOW)` 可能整批被跳過 | 未證實。常數是 true,vitest 0 skipped |
| 沒有真的把 pass / fail 換成同色再量 | 未證實(是錯的)。`card-render-test-support.ts` 的結果字樣檢查有換成同色再量,工單明寫這樣仍要綠 |
| 對比 / 框線檢查只是靜態字串比對 | 未證實。框線、斜邊、焦點是畫出來量的(N4、N5、N6、N18 紅證明);對比用 `worstContrast`(N13 紅) |
| worker 照抄支援檔 | **證實**(§3),但抄的是標記範例,不是 hud.css 的數值 |

它的結論「建議退回重作」不成立:它沒看到測試支援檔,多數主張建立在猜測上。

## 8. 給顧問的備註(不擋)

- N16:內文超長不斷字(網址)時,教學卡內文會往橫向撐。建議後續工單補 fixture 與量測,或接受現狀。
- N17:作答欄文字內距沒有量尺。
- 範例逐字照抄(§3)是支援檔設計的問題,SKILL 已改;這張的驗證主要靠 §5 的突變與畫出來的量測。
- `@manual`(教學卡與考試卡實機觀感、D1)不在驗收範圍,由前端用 `tauri build` 產物重拍。

## 9. learning/ 前後(唯一量法,只讀)

| | 檔數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 前 | 64 | `1e612e55854cdc1c` | 72 |
| 後 | 64 | `1e612e55854cdc1c` | 72 |

前後相同。證據檔裡沒有 `learning/` 的檔名或內容。

## 10. 花費

worker(opencode,`xai/grok-4.7`):US$8.319942,約 1705 秒;預算 $5;比值 **1.66×**(未超過 2×)。grok 不設上限,只記錄。我這邊的 grok-4.20 審查花費不知道。

## 11. 結論

通過(無阻擋項;兩條覆蓋缺口與逐字照抄觀察列在 §3、§5、§8,由顧問裁決)。

## 12. 最終候選 `e862936` 的整輪重驗

驗收用簽出 `acceptance-t15`,分支 `pollux0971/t15-accept-tests-4`,基底 = `e862936`(`pollux0971/t15-opencode`)。開跑 tree `e5bbf095fa45adc3e8595cc379899727d685501c`(含我帶入的第一輪證據檔),跑完實作檔無變動(突變全已還原,`git status` 空)。日期 2026-10-16。開跑時 load 約 2–3。
鏈:`6d299ad`(測試作者,第一輪)→ `00b202a`(實作 1)→ `d1c7359`(測試 2)→ `ca24bd6`(實作 2)→ `fe934f4` + `a256d21`(測試 3)→ `53af8d9`(實作 3,`9217da2` 只動 `hud.css`)→ `8fa5427`(測試 4)→ `798cae4`(實作 4,只動 `hud.css`,+17 −4)→ `e862936`(報告第 12 節)。

### 12.1 結論

**沒有阻擋項。** 基準全綠(vitest 250 條);四批測試作者 commit 以外,測試檔零變動;兩頁 CSP 0 違規。第四輪要修的 P1、P2、P3 都有像素測試咬住,我的 8 條新突變有 7 條被殺。仍有 9 條突變存活(§12.5),其中 `Q6`、`Q7`(按鈕 hover / focus 的橘色線)是**第三輪就列給 -e5、第四輪仍沒補上的缺口**,列給顧問裁決。

### 12.2 測試作者檢查

- 11 個 worker commit(`d518d0c`、`f25157b`、`00b202a`、`8268431`、`a2bc611`、`ca24bd6`、`9217da2`、`f1ced93`、`53af8d9`、`798cae4`、`e862936`)逐個 `git show --name-only`:符合 `*.test.*`、`test-support`、`features/steps`、`.feature`、`contracts/fixtures` 的檔數**全是 0**。它們動的檔:`apps/*/src/App.svelte`、`HudField.svelte`、`HudPanel.svelte`、`gallery/Gallery.svelte`、`hud.css`、報告。
- 測試檔只出現在四批測試作者 commit:`6d299ad` 及之前(第一輪)、`d1c7359`(4 檔)、`fe934f4`(5 檔)與 `a256d21`(1 檔)、`8fa5427`(4 檔)。
- `git log --name-only 6d299ad..e862936 | grep -c mutants.out` = **0**。`ls .env` → No such file。

### 12.3 基準(未突變,`CI=1 VITEST_MAX_WORKERS=1 CARGO_BUILD_JOBS=2`)

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries` | PASS(scanned 288) |
| vitest `packages/ui-shared/src/hud apps/teach-card apps/test-card` | 23 檔,**250 passed,0 failed**(第一輪 240;第二輪 244;第三輪 247) |
| cucumber `@hud-skin and @phase-2 and not @manual` | 4/4 |
| cucumber `@hud-skin and @phase-1 and not @manual` | 19/19 |
| cucumber `(@test-card or @teach-card) and @phase-1 and not @manual` | 16/16 |
| cucumber `^The real front ends are loaded$` | 1/1 |
| `npm run lint:docs`、doc-links | PASS |
| `npm run build:frontends -w apps/desktop` | 成功 |

### 12.4 CSP 與逐字比對

- **CSP**:build 產物用 `tauri.conf.json` 的 CSP 字串當標頭,headless Chrome 360 × 480 開兩頁:教學卡、考試卡**都是 0 筆 CSP / console 違規**;DOM 有渲染(教學卡 `panel`、`button`;考試卡 `panel`、`button`、`field`、`hp-bar`)。兩個 `index.html` 的 `style=` 與 `<style` 都是 0。
- **逐字比對**(兩個 `App.svelte` 對 `card-static-samples-test-support.ts` 的展開範例,去空白、略空行、以行為單位):`App.svelte` 在第二輪以後**沒有再動**,所以數字不變。

| | 教學卡 | 考試卡 |
|---|---|---|
| worker 非空行 / 其中逐字在範例裡 | 95 / 83(87%) | 182 / 174(96%) |
| 相對基底新增或改過的行 / 其中逐字等於範例 | 22 / 10 | 33 / 25 |
| 序列相似度 | 0.904 | 0.963 |

第二輪起 worker 新增的寫法(`.submit` 包裝、1 像素例子框線)與第三、四輪的 `hud.css` 改動(偽元素線、`color-mix`、`outline: none`)**都不在範例裡**,是 worker 自己的。

### 12.5 非作者突變(18 條,只改 `hud.css`,跑 250 條)

做法同第一輪。8 條是第三輪存活的再跑(`Q1`、`Q2`、`Q5`、`Q6`、`Q7`、`Q8`、`Q11`、`Q13`;`Q14` 作廢——第四輪刻意拿掉作答欄的方形 outline,那條突變改的線已不存在),10 條是針對第四輪新改法(`S1`–`S10`)。

| # | 改了什麼 | 結果 |
|---|---|---|
| Q1 | 切角線偽元素 `inset: -1px` 改 `0` | **存活** |
| Q2 | 切角線 clip-path 右上點歪 0.5 像素 | **存活** |
| Q5 | 作答欄 focus 的線不變橘 | **紅**(3 條;第三輪是存活,新測試殺掉了) |
| Q6 | 按鈕 hover 的線不變橘 | **存活** |
| Q7 | 按鈕 focus-visible 的線不變橘 | **存活** |
| Q8 | 偽元素 `z-index` 1 → -1 | **存活** |
| Q11 | 偽元素拿掉 `pointer-events: none` | **存活** |
| Q13 | 作答欄與按鈕內層切角 7 → 9 像素 | **存活** |
| S1 | hover / focus 又把按鈕底填成方塊橘色 | 紅(2 條,P1/P2 切角外側) |
| S2 | 按鈕 focus 又出現方形橘 outline | 紅(1 條) |
| S3 | 標籤 hover / focus 底色 35% → 5%(太淡) | 紅(3 條:G5 focus 與 hover 的差、內框) |
| S4 | 標籤底色 35% → 100%(全橘) | **存活** |
| S5 | `focus-visible` 不給標籤淡橘底(只剩 hover 給) | **存活** |
| S6 | 作答欄 focus 又出現方形橘 outline | 紅(1 條) |
| S7 | 作答欄 hover 也變橘(不該有) | 紅(1 條,P3) |
| S8 | 標籤底色混白不混透明(不透明淡橘) | 紅(1 條,底色只來自 `--hud-panel` 那條) |
| S9 | 按鈕不關瀏覽器預設 focus 外框 | 紅(2 條) |
| S10 | 作答欄 hover 變橘、focus 不變(對調) | 紅(4 條) |

統計:**9 紅、9 存活**。

存活的解讀:
- **缺口(列給顧問)**:`Q6`、`Q7` —— 按鈕 hover / focus-visible 時沿切角的**橘色線**沒有像素測試。標籤的淡橘底本身是橘色,所以「有橘色」的檢查被它滿足;線不是橘色時測試仍綠。這正是第三輪列給 -e5 的建議(「沿邊的線是橘色」),第四輪補了「切角外側是背景、沒有方形 outline」,沒補「線是橘色」。
- **幾何微調缺口**:`Q1`、`Q2`、`Q13` —— 線偽元素的位置與座標、內層切角大小,偏差在 ±0.5–2 像素內沒有被量到。跟第一輪的 `N16`、`N17` 一樣,非工單明文要求。
- **疑似等價**:`Q8`(`z-index: -1`)—— 面板是半透明的,線掉到底下仍然看得到,像素量不出差別;`Q11`(`pointer-events`)—— 偽元素的點擊本來就交給元素本身。
- **非缺陷**:`S4`(全橘標籤)—— 內框是另一個顏色,G5 的像素差仍夠;`S5`(focus-visible 不給淡橘底)—— focus 靠線與內框已分得出來,沒有規格要求 focus 要有淡橘底。

### 12.6 不退步與 O2–O4

- 第二輪的 O2(textarea 不縮放、至少五行)、O3(送出鍵離作答欄 ≥ 8 像素)、O4(例子框 1 像素線)的測試在 `e862936` 上全綠(`card-render.test.ts`,250 條內)。第三、四輪 worker 只動 `hud.css`,`App.svelte` 沒有再動。
- 第三輪新增的「底色只來自 `--hud-panel`、沒有寫死不透明色、沒有 `--hud-field`」靜態測試與「作答欄與按鈕內部像素符合疊色公式」在基準上綠,`S8`(不透明混白)、`Q3`/`Q4`/`Q12`(第三輪的不透明底突變,見 §12.7)證明它們有效。
- 視窗控制鈕(縮小、關閉)的 hover / focus 仍用方形 `outline`(`hud.css` 中 `minimize`、`close` 規則)。它們目前不在畫面上(視窗還不是無框),不在這輪範圍,留給 10 phase-6。

### 12.7 第二、三輪(被退回的 tip)摘要

| tip | 基準 | 突變 | 退回原因(顧問) |
|---|---|---|---|
| `ca24bd6` | vitest 244 全綠 | 13 條:10 紅、3 存活(`R2`、`R6` 等價;`R3`:例子框 `border-left` 改透明仍綠——線的顏色沒量) | O1:作答欄用不透明白 `#ffffff`,要半透明面板色;按鈕也要同畫法 |
| `53af8d9` | vitest 247 全綠,兩頁 CSP 0 | 14 條:6 紅(`Q3`、`Q4`、`Q9`、`Q10`、`Q12` 等)、8 存活(`Q1`、`Q2`、`Q5`–`Q8`、`Q11`、`Q13`、`Q14`) | P1、P2:hover / focus 把切角填成方塊橘,多一圈方形 outline;`Q5`–`Q7`、`Q14` 存活就是這類退步沒被測試擋住,我當時就建議 -e5 補 hover / focus 的像素測試,第四輪補了(`Q5` 轉紅) |

### 12.8 learning/ 前後(唯一量法,只讀)

| | 檔數 | 雜湊 | 帳本行數 |
|---|---|---|---|
| 驗收前 | 64 | `1e612e55854cdc1c` | 72 |
| 驗收後 | 64 | `1e612e55854cdc1c` | 72 |

前後相同。證據檔沒有 `learning/` 的檔名或內容。

### 12.9 花費

worker(opencode,`xai/grok-4.7`,同一個 session)累計 US$28.46:第一輪約 $8.32、第二輪約 $6.26、第三輪約 $7、第四輪約 $6.9;工單預算 $5。累計 / 預算 = **5.7×**,超過 2× 旗標線,**標出**。超在三輪退回後的修正(第二至四輪各約 $6–7,每輪都比整張工單的預算高)。grok 不設上限,只記錄。

### 12.10 結論

通過(無阻擋項;`Q6`、`Q7` 兩個按鈕 hover / focus 橘色線的覆蓋缺口與其他存活突變列在 §12.5,由顧問裁決;`@manual` 由前端重拍)。
