# T44 實作驗收(教學卡生成中的畫面)

- 工單:`docs/tickets/T44-teach-card-generating-view.md`
- 被驗分支:`t44-impl` = 0173e1f59005a231aab4019258d8d766ecf718ab(基底 t44-start 9b995b6)
- 驗收開跑 / 跑完的 tree sha:4ece33ae2279d6b37ae6fde32dc4aea4bfeebb97 / 同(原始碼沒被留下改動)
- 日期:2026-10-24;驗收者:驗收 -5b

## 1. 測試作者
`git diff --name-only 9b995b6..0173e1f`:只有 App.svelte、teach-session.ts、docs/reviews/T44-implementation.md。測試檔 0 個,受保護檔 0 命中。mutants.out 0。新程式碼沒有任何寫檔(沒有 fs 寫入、沒有 state 路徑)。

## 2. 基準(乾淨簽出,無 .env)
- tsc 乾淨;boundaries PASS 363;doc-links PASS 131。
- apps/teach-card 與 review-client 相關 16 檔 214 條全綠(含 T44 兩檔 23 條、T40 靜態與 busy)。
- cucumber(--tags):@teach-card phase-3 / phase-2 / phase-1、@i2、@i3(皆 not @manual)全部 rc=0;步驟 49 / 25 / 41 / 464 / 858 全過。
- **完整 vitest:245 檔,1 檔紅、6581 條過、171 跳過。紅的是 packages/ui-shared/src/hud/card-static.test.ts 的「`<style>` 不畫框」那條。** 訊息原文:`<style> 畫框:.generating, .deepen-error { border-top: 1px solid var(--hud-line) }(只有 .lc-example 的 border-left 例外)`。
  - 原因:工單第 8 條要求 1px 分隔線,工單與紅測試都沒提這條既有靜態測試(它只放行 .lc-example 的 border-left)。紅測試(-a6)與實作都沒碰它;在 t44-start 上它是綠的,所以是這張工單**引入的退步**,不是實作者的錯。
  - 需要顧問/測試 agent 裁:把例外擴成「.generating、.deepen-error 的 border-top: 1px solid var(--hud-line)」(測試由 -a6 改,改前先證明鬆)。

## 3. 變異(Stryker CLI,經 npm run mutate)
指令:`npm run mutate -- stryker.t44-session.json`(範圍 teach-session.ts 全檔;測試集 teach-session、t40-busy、t43-deepen、t44-generating-session)。
結果:278 個,殺 229、逾時 7、存活 42,分數 84.89%。App.svelte 不是 Stryker 對象,用第 4 節手改驗。
存活 42 個中,落在這次新增行的只有 5 個:

| 行(新碼) | 改法 | 分類 |
|---|---|---|
| 取消訂閱的 splice 判斷 | 條件改 true | 低:只有「同一個取消函式叫兩次」才有差 |
| 通知迴圈的 slice 複本 | 去掉複本 | 低:只有「通知途中有人取消訂閱」才有差 |
| deepen 直接丟錯那條的 emitChange | 刪掉 | 低 / 近等價:App 在 act 結束一定 pull 一次,畫面一樣 |
| cancel 失敗那條的 emitChange | 刪掉 | 同上 |
| followPrereq 的 kind 字串 | 改成空字串 | 等價:invoke 走預設分支,kind 沒被讀 |

另有 1 個逾時落在新碼(輪詢仍在生成的條件改 true,會無限迴圈),逾時視為殺掉。其餘 37 個存活在舊碼(mode 初值、clearBusy、back 的錯誤分支等),不屬 T44,沿用 T40/T37 的分類。
原始 JSON 摘要:reports/mutation/0173e1f-t44-session.json。

## 4. 手改抽驗(只改實作、不改測試,改完還原)
跑 T44 兩檔 + teach-session + t43-deepen + t40-busy(95 條):

| # | 改法 | 結果 |
|---|---|---|
| H1 | 拿掉 App 的 onChange 訂閱 | 紅 5(a、b、e…) |
| H2 | next 防線拿掉 | 紅 2 |
| H3 | deepen 送出當下就通知(閃) | 紅 2(渲染 f、session 不閃) |
| H4 | 拿掉分隔線 | 紅 3(g 生成中、g 其他錯誤、g 最深一層) |
| H5 | 字級改 1rem | 紅 3 |
| H6 | chooseCategory 防線拿掉 | 紅 2 |
| H7 | followPrereq 防線拿掉 | 紅 2 |
| H8 | 取消成功後不通知 | 紅 1 |
| H9 | 輪詢仍在生成時不通知 | 紅 1 |
| H10 | 取消訂閱變空操作 | 紅 1 |
| H11 | 生成中那一行不畫 | 紅 3 |
11 個全紅。

## 5. 紅測試的已知小洞(先前已回報,仍在)
畫面上先備提示按鈕「生成中要停用」沒人量(fixture 沒有先備提示);session 層的 followPrereq 防線有測。

## 6. 資料與花費
- learning/ 前後:64 檔 / c2e4dd6d71de3976 / 108 行,相同。
- 花費:worker 自述 $1.75,預算 2,比值 0.88,未超過 2 倍。

## 7. 結論
有阻擋項:完整 vitest 的 card-static 靜態測試因工單第 8 條的分隔線而紅(見第 2 節),修好之前不能合併。T44 本身的驗收條件與必抓改壞點全部成立,變異新增行無實質缺口。
