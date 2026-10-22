---
id: T32
deps: []
touches: [apps/test-card/src/App.svelte]
cpu: light
budget_usd: 1
status: merged
owner: worker-grok
must_catch:
  - `.progress` 照舊是一欄的 grid,或改成 `flex-direction: column`:「已答 / 總數」與「逾期 N」還是上下兩行,同一行的測試必須紅
  - 只寫 `display: flex` 加 `gap`,HP 條沒有自己一行:HP 條被擠進同一行、寬度只剩兩條邊框(約 2 px),HP 條寬度與位置的測試必須紅(T15 的 HP 條渲染測試這時是空過,見「一個陷阱」)
  - 讓 HP 條換行的規則寫成 `.progress > [data-hud="hp-bar"]`(沒有 `:global`):Svelte 把它當沒用到的選擇器丟掉、只給一個 warning,結果跟上一條一樣,HP 條寬度與位置的測試必須紅
  - 「逾期 N」畫在「已答 / 總數」左邊(`order`、`row-reverse`、`direction: rtl`):左右順序的測試必須紅(T15 讀的是 innerText 的第一個數字,版面順序換了它看不出來)
  - 兩段之間的空白小於 8 px(例如沿用 `gap: 0.2rem` 只有 3.2 px,兩段字黏在一起),或大於 24 px(`justify-content: space-between` 把逾期數推到最右邊):間距的測試必須紅
  - HP 條跟上面那一行的間距不是原本的 0.2rem(row-gap 拿掉或加大):HP 條位置的測試必須紅;`@manual` 的「送出」y 對不上 T24
  - 動到 `<style>` 以外(合成一個 span、改字、HpBar 搬出 header、加 class 或包一層):驗收的 diff 檢查必須擋下;靜態測試擋得到的那幾種(字改了、HpBar 不在 header 裡、兩段文件順序反了)照舊紅
  - T15、T23 的考試卡渲染測試與靜態測試任一條變紅,或任何 `.feature` 被改:不退步必須紅
---

# 工單 T32:考試卡 header 的「已答 / 總數」與「逾期 N」放同一行

> 狀態:顧問審過 2026-10-18(兩點裁決:間距 8–24 px 靠左、保留上限;「只改 `<style>`」由 -ed 看 diff。兩處措辭改入)。
> 作者:UI/Tauri 負責人(06-test-card 的規格作者)。編號:T32(協調者配)。派工:協調者。
> 實作:worker-grok(opencode grok-4.7)。紅測試:-e5。驗收:-ed。觀感:前端(驗收 5),技術顧問判。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 起因:T23 `@manual` 的 O1(`../reviews/T23-manual-2026-10-17.md`,「O1 header 的兩段各佔一行」)。
> 決策:顧問 2026-10-17 裁決、2026-10-18 確認排序(協調者轉達):兩段放同一行,**只改 CSS**(例如 flex + gap;只寫 flex + gap 會把 HP 條擠掉,見「一個陷阱」),**不動 DOM、不動文字**;驗收量「送出」的 y 回到 T24 的值(±1)。
> 基底:main(`d2a09a9` 或之後)。06 phase-3 維持 `done`;這張是觀感修正,不是新 phase。

## 為什麼有這張

T23 在考試卡的 header 加了第二段「逾期 N」(`../../apps/test-card/src/App.svelte:140`)。
`.progress` 是 `display: grid`、`gap: 0.2rem`、沒有設欄(`../../apps/test-card/src/App.svelte:212`),所以每個子元素各佔一行:
「0 / 5」一行、「逾期 2」一行、HP 條一行。題目整個往下推了 27.2(一行 24 加 grid 間距 3.2)。

T23 `@manual` 量到的(Xvfb、視窗 360 × 480、Rajdhani 已載入):

| | T24(header 只有一段) | T23(兩段各一行) |
|---|---|---|
| 「已答 / 總數」 | (16.2, 81.9) | (16.2, 81.9) |
| 「逾期 N」 | (沒有) | (16.2, 109.1) |
| 「送出」,填空 3 格 | (16.2, 330.6) | (16.2, 357.8) |
| 「送出」,填空 1 格 | (16.2, 213.0) | (16.2, 240.2) |
| 「送出」,應用題 | (16.2, 347.4) | (沒量) |
| 「送出」,填空 3 格 + stuck 那一行 | (沒有 stuck) | (16.2, 385.0) |

出處:`../reviews/T24-manual-2026-10-17.md` 的「第 8 列:長相」,`../reviews/T23-manual-2026-10-17.md` 的「長相」與 O1。
T24 合併(`bff8c9e`)到 `d2a09a9`:`packages/ui-shared/src/hud/` 去掉測試檔一行都沒改;考試卡 `App.svelte` 的 `<style>` 也沒改,題目畫面的標記只多了「逾期 N」那一段與 stuck 那一行(T23),其他是 done 畫面與評分失敗的字(T23、T30)。
所以兩段放回一行之後,沒有 stuck 的題目量值應該回到 T24 的值。

## 一個陷阱(起草時量過)

header 裡有**三個**子元素:兩段字,再加 HP 條(`<HpBar>`,畫出來是 `<div data-hud="hp-bar">`)。
HP 條本身沒有寬度,寬度是 grid 把它撐開的(`../../packages/ui-shared/src/hud/hud.css` 的 `[data-hud="hp-bar"]` 只設了高度與邊框)。

起草時用 headless Chrome 畫了一份複製品(`hud.css` 加同樣的三個子元素,寬 327.6)量四種寫法:

| 寫法 | 兩段的 y | 兩段之間 | HP 條 | header 高 |
|---|---|---|---|---|
| 現在(grid 一欄) | 0 與 27.2 | (上下兩行) | 寬 327.6,在第二段下面 3.2 | 65.9 |
| 只寫 `display: flex; gap: 0.2rem` | 同一行 | 3.2 px | **跟字擠在同一行,寬 2.0**(只剩邊框) | 24.0 |
| flex 換行 + HP 條自己一行 | 同一行 | 12 px(`column-gap: 0.75rem`) | 寬 327.6,在字下面 3.2 | 38.7 |
| grid 兩欄 + HP 條跨欄 | 同一行 | 12 px | 寬 327.6,在字下面 3.2 | 38.7 |

- 第二種的 HP 條看起來就是不見了。**T15 的 HP 條渲染測試這時是空過**:它量綠色有沒有佔內寬的 1/3(`../../packages/ui-shared/src/hud/card-render-test-support.ts:260`),內寬 0、要 0、量到 0,過。所以這張要另外量 HP 條的寬度。
- 讓 HP 條自己一行的規則,選擇器要碰到子元件裡的 `<div>`,在 Svelte 的 scoped 樣式裡要寫 `:global(...)`(前例:`../../apps/teach-card/src/App.svelte:96`)。
  起草時用 svelte 的 `compile` 試過:寫成 `.progress > [data-hud="hp-bar"]` 會得到 `css_unused_selector` 這個 warning,整條規則被註解掉,結果跟第二種一樣;寫成 `.progress > :global([data-hud="hp-bar"])` 才會留下來。

## 驗收條件

量的地方有兩個:**自動測試**在 headless Chrome(T15 的考試卡渲染工具,`openCard('test-card')`,視窗 360 × 480)量相對位置;**`@manual`** 在 tauri 產物上量絕對位置(驗收 5)。

### 1. 兩段同一行,順序與間距

題目狀態的 `header.progress` 裡,「已答 / 總數」那一段(字以 `數字 / 數字` 開頭)與「逾期 N」那一段(字以「逾期」開頭):

- 上緣的 y 相差 ≤ 1 px。
- 「已答 / 總數」在左、「逾期 N」在右:`逾期 N 的左緣 − 已答 / 總數的右緣` 在 **8 到 24 px** 之間(建議 `column-gap: 0.75rem`,12 px)。
  下限是讓兩段字不黏在一起;上限是讓兩段讀起來是同一句狀態,逾期數不被推到最右邊。
  靠左、保留上限是顧問 2026-10-18 的裁決:`../00-design.md` §5.5 寫的是「今日 3 / 10 題,逾期 0」,同一句話,逾期數要貼著進度讀,不是右邊對齊的另一欄。
- 兩段都在 header 的矩形裡面(不溢出)。

### 2. HP 條照舊自己一行、全寬

- HP 條的上緣在兩段字的下緣(取兩段裡比較低的那個)**下面 0.2rem**(3.2 px,±1)。這是 T24 的間距,也是「送出」回到 T24 位置的前提。
- HP 條的寬度等於 header 的寬度(±1),左緣跟 header 的左緣對齊(±1)。
- HP 條的填滿照舊:T15 的 HP 條渲染測試照舊綠。

### 3. 只改 `<style>`

- `git diff main -- apps/test-card/src/App.svelte` 的改動**全部**在 `<style>` … `</style>` 裡;其他檔案不改(檔頭 `touches` 只有這一個檔)。
- DOM 與字一個都不動:`<header class="progress">` 裡照舊是「已答 / 總數」那段、「逾期 N」那段、`<HpBar>`,文件順序、標籤、屬性都不變。
- 樣式照 T15 的規矩:不畫框、顏色只用 `var(--hud-*)`(這張用不到顏色)。T15 的靜態檢查(`styleProblems`、`progressProblems`)照舊綠。

### 4. 不退步

- T15(14 phase-2)、T23(06 phase-3)考試卡的渲染測試與靜態測試全綠:`packages/ui-shared/src/hud/`、`apps/test-card/src/` 底下的測試。
- cucumber `(@hud-skin or @test-card) and not @manual` 全綠(拿位子)。任何 `.feature` 都不改。

### 5. 觀感(`@manual`,前端做、技術顧問判)

用 `tauri build --debug --no-bundle` 的產物,**從這張的簽出 build**(repo 根是編譯時從 `CARGO_MANIFEST_DIR` 帶進去的)。暫存根 + `vault.ts init`,**假 router**,不准 live。
build 與開 app 是重活,要協調者給位子(暖快取 build 十幾秒、四輪 app,約 5 分鐘)。
在 Xvfb 裡跑,不碰使用者的桌面;檢查器設 `value`、按鈕 `click()`;關窗送 `WM_DELETE_WINDOW`,出錯也要關。簽出的 `.env` 只放假值,做完刪掉。真的 learning/ 開工、收工各量一次,前後要相同。
種子跟 T23 `@manual` 同一份 fixture、同樣的題目(填空 3 格、填空 1 格、應用題、填空 3 格 + stuck)。

| 量什麼 | 過的條件(視窗 360 × 480,Rajdhani `loaded`) |
|---|---|
| header 兩段 | 都在 y 81.9(±1);「逾期 N」在「已答 / 總數」右邊 8–24 px |
| HP 條 | y 109.1(±1,= 81.9 + 24 + 3.2),寬 327.6(±1) |
| 「送出」,填空 3 格 | (16.2, 330.6)(±1),T24 的值 |
| 「送出」,填空 1 格 | (16.2, 213.0)(±1),T24 的值 |
| 「送出」,應用題 | (16.2, 347.4)(±1),T24 的值 |
| 「送出」,填空 3 格 + stuck | (16.2, 357.8)(±1,= T23 的 385.0 − 27.2);stuck 那一行在 y 123.8(±1,T23 是 151.0) |
| 「送出」看得到 | T15 的量法:矩形在視窗內與捲動區內、`scrollTop` 0、正中心 `elementFromPoint` 是它;捲動區 0 / 433 / 433 |
| 長相 | 檢查器截圖:有逾期數的題目、stuck 的題目;console 0 則 |

±1 的理由:T24、T23 是同一個視窗大小、同一個字型量的,HUD 的部分從 T24 到現在沒改;差超過 1 就是有別的東西也動了。

## 做法建議(不綁做法,量的結果才是驗收)

flex + gap 是顧問裁決時舉的例子,不是綁定的方向;只寫 flex + gap 會把 HP 條擠掉(見「一個陷阱」)。照那一節的量法,HP 條要另外給它一整行:

```css
.progress {
  display: flex;
  flex-wrap: wrap;
  column-gap: 0.75rem;
  row-gap: 0.2rem;
}
.progress > :global([data-hud='hp-bar']) {
  flex-basis: 100%;
}
```

grid 兩欄、HP 條 `grid-column: 1 / -1` 量起來一樣,也可以。

## 規格

這張不加、不改 `.feature`:06 phase-3「The header includes the overdue count」(`@manual`)只管 header 有逾期數,沒管排版;排版以本檔驗收條件為準。

## 紅測試(-e5 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | 同一行 | 真 Chrome(`openCard('test-card')`,跟 `../../packages/ui-shared/src/hud/card-render-phase3.test.ts` 同一套):第一題載入後,用字找兩段(跟同檔「逾期數用一般字色」那條一樣,找葉子元素),量 `getBoundingClientRect().top` | 紅(差一行) |
| 1 | 順序與間距 | 同上:`逾期 N 的 left − 已答 / 總數的 right` 在 8–24;兩段都在 header 矩形裡 | 紅(現在兩段都撐滿整欄,差是負的) |
| 2 | HP 條 | 同上:`HP 條 top − 兩段裡較低的 bottom` 在 0.2rem ± 1(rem 從 `getComputedStyle(:root).fontSize` 讀);HP 條寬 = header 寬 ± 1、左緣對齊 | 綠(本來就綠;這條是擋「只寫 flex」的) |
| 4 | 不退步 | 既有測試全綠 | 綠 |

- 數值放在 `card-design-values-test-support.ts`,跟 T15 的設計值放一起。
- 交件前用丟棄式實作證明三件事,不進 git、交件前刪:「做法建議」那份 → 全綠,**包含 T15 的 `styleProblems`、`progressProblems` 靜態檢查**;只寫 `display: flex; gap: 0.2rem` → HP 條那條紅;HP 條的規則拿掉 `:global` → HP 條那條紅。
  靜態檢查要一起跑的理由(顧問 2026-10-18):那個 CSS 解析器看過 `:global(.lc-example)`,沒看過 `:global([data-hud='hp-bar'])` 這種括號裡是屬性選擇器、還帶引號的寫法。解析器若讀錯,是測試端的事,由 -e5 在交 worker 之前修好,不讓量尺跟工單打架。
  起草時先試過一次(`d2a09a9` 的 `card-static-test-support.ts`,把 `.progress` 換成「做法建議」那份):`styleProblems`、`progressProblems` 都是 0 條;在同一條 `:global(...)` 規則裡多寫一個 `border` → 被擋,訊息裡的選擇器原樣讀到,所以規則有被解析、不是被跳過。-e5 交件前照樣再跑一次。
- 驗收 3 的「只改 `<style>`」不寫成永久測試(以後改 markup 的工單會被它擋),由 -ed 驗收時看 diff(顧問 2026-10-18 同意)。
- T15 的 `hpBarProblems` 在 HP 條寬 0 時空過,要不要順手加一條最小寬度,由 -e5 決定;加的話寫進 commit 說明。

## 怎麼跑

```bash
VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud apps/test-card
NODE_OPTIONS=--import=tsx npx cucumber-js --tags '(@hud-skin or @test-card) and not @manual' --format summary
npm run boundaries
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。渲染測試要 Chrome(`LC_CHROME`,沒有就找常見路徑,找不到是紅不是跳過)。cucumber 一律用 `--tags`(重活,先拿位子)。
- 不跑完整 cucumber、不跑 `npm run check:all`、不跑 `tauri dev`。這張沒有嚴格級模組,不跑變異測試。

## 不在範圍

- 不改 `hud.css`、`HpBar.svelte`、其他 HUD 元件(14-hud-skin 的東西)。
- 不改 DOM、字、`session.ts`、側車、Rust、任何 `.feature`、任何測試檔(測試由 -e5 改)。
- reteach、小結、錯誤畫面沒有這個 header,不動。
- 「逾期 N」的字色照 T23(一般字色),不改。

## 預算

`budget_usd: 1`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## 測試誰寫

- 紅測試:-e5。開發 worker 以紅測試分支為基底。
- 實作:worker-grok,只改「touches」列的檔,而且只改它的 `<style>`。
- 驗收:-ed(看 diff 只在 `<style>` 裡)。觀感:前端(驗收 5),技術顧問判。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
落點只有 `apps/test-card/src/App.svelte` 的 `<style>`,跟 T29 不重疊。
