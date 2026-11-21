# 驗收證據:T67 實作(07 phase-5 今日負擔提示)

- 被驗:t67-impl,f44210b53cf18d27c65f6515ad73a0a390e93013(worker 實作;基底 t67-start)+ t67-red2,a52466638732707288caf44ff4da7a8c5525bd0a(測試補丁,疊在 t67-impl 上)
- 筆電簽出的 tree sha:0612307dd834974e37568bb0a6993c76725438fa(t67-red2 tip)。i9 跑的是同一份再加一個 commit(只多了變異設定檔 stryker.t67-load.json),tree sha 47413d2745fe3a4015f3c3cf1277ff2a1c89b85f。
- 日期:2026-11-21。LLM 花費 0。worker 花費 $8.94(協調者給的數字,只記錄)。沒有 `.env`(兩台都 `ls .env` 失敗)。

## 1. 測試作者

- t67-start 之後的測試檔(*.test.ts、features/steps、protocol.vectors.json)只來自測試 agent 的 t67-red 與 t67-red2 commit。worker 的 commit 只動 9 個實作檔加自己的報告,沒有測試檔、沒有 .feature。tracked 檔沒有 mutants 輸出夾。
- t67-red2 的 2 檔:test-card-phase2-sidecar.steps.ts 的鍵清單加 teachLoad(也斷言它不收參數)、t67-teach-load.test.ts 多 2 條(C9:stale 快取名單要忽略;C14:teach.load 不重存 reviews.json,量修改時間與 inode)。是補嚴,沒放寬。

## 2. 筆電(輕)

- 單元(session、teach、t67 各檔、t37/t43 handler、視窗 session 測試):25 檔 557/557 過。tsc 乾淨、boundaries PASS(411)、check:steps PASS(2713 句、1349 定義)。

## 3. i9(空 HOME,env 清掉 XDG_*、NO_COLOR、DBUS;cargo 帶 RUSTUP_HOME、CARGO_HOME)

| 項目 | 結果 |
|---|---|
| tsc、boundaries、check:steps | 全過 |
| cargo test --test review_sidecar | 41/41 過 |
| cucumber `@teach-card and @phase-5 and not @manual` | 8/8 過 |
| cucumber `@teach-card and not @manual` | 32/32 過 |
| cucumber `@test-card and (@phase-2 or @phase-3) and not @manual`(06 phase-2/3) | 13/13 過 |
| cucumber `@integration and (@i2 or @i3) and not @manual` | 20/20 過 |
| cucumber `@llm-router and not @manual` | 52/52 過 |
| 渲染 8 檔(t67 14 條、t44、t45、t46、t47、t48、t49、t50;真 Chrome) | 8 檔 211/211 過 |
| 全 vitest | 294 檔裡 293 過,7646 條過、187 skipped、1 檔紅(見下) |
| cucumber `@hud-skin and not @manual` | 第一次 23 場景 18 過 / 5 敗;**重跑 23/23 過**;基底(main 5e77c5c)23/23 過(見下) |
| HOME 下 .cache | 只有 Chrome 的 fontconfig,沒有 llm-learning-cards |

### 兩個不穩的項目(都不是這批的問題)

- **t47 渲染檔在全 vitest 裡紅 1 檔**:錯誤是「Chrome 沒有在 10 秒內打開 DevTools 埠」,在 openApp 就丟,零斷言;i9 與別的專案共用、load 偏高。同一檔在渲染 8 檔那次 64/64 過;再單跑連 2 次都 64/64 過。照「只有逾時、單跑連 2 次綠」收。
- **14-hud-skin 第一次 5 敗**:全是畫面像素量測的場景(透明、一像素線、焦點外觀、字高),跑在 i9 負載高的時候;同一份重跑 23/23 過,基底也 23/23。這批沒動 hud.css 與 HUD 元件。照同型收,資訊給協調者。

## 4. 變異(npm run mutate -- stryker.t67-load.json;完整指令見下,設定檔在本分支)

- 完整指令:`env -u XDG_CACHE_HOME -u XDG_CONFIG_HOME -u NO_COLOR -u DBUS_SESSION_BUS_ADDRESS HOME=<空目錄> CARGO_HOME=/home/i9/.cargo RUSTUP_HOME=/home/i9/.rustup VITEST_MAX_WORKERS=1 npm run mutate -- stryker.t67-load.json`
- 範圍:summary.ts 的 estimateTomorrowFrom;deck.ts 的 countLearnedOn;handler.ts 的 loadInputs 與 teach.load 分派;teach.ts 的 computeLoad 與 readLoad;review-client.ts 的 callOnce 與 teachLoad;teach-session.ts 的 isCount/parseLoad、takeLoad、refreshLoad。測試是上面那批 14 個單元檔。Svelte 檔(App.svelte)變異工具不支援,改由渲染測試與下面的手動改壞量。
- 總分 **82.05%**(門檻 80%):64 殺 / 14 活 / 0 逾時 / 0 沒涵蓋。summary.ts、teach.ts、deck.ts 各 100%;teach-session.ts 94.44%;handler.ts 60%;review-client.ts 50%。
- 存活的 14 個:
  - handler.ts 的 loadInputs 「session 開著就用它的名單與上限」那個分支 8 個(分支改成永遠走磁碟,結果相同):等價——開著的 session 用的名單與上限,本來就是 openDay 寫進當日快取、從設定檔讀的同一份,走磁碟讀到的數字一樣。唯一會不同的情況是快取在 session 開著時被別處改掉,現在沒有測試佈置它(小缺口,不擋)。
  - handler.ts 另 1 個:不是 ok 的快取名單 `[]` 換成一個不存在的卡 id,不影響數字(等價)。
  - review-client.ts callOnce 4 個:`nextId += 1` 改成 `-= 1`(id 不重複性,現有測試沒釘);catch 區塊整個拿掉或 `instanceof ReviewError` 判斷永遠真/假(ReviewError 原樣丟、其他例外轉成 ReviewError)。小缺口:teachLoad 丟出非 ReviewError 例外時的轉換與 id 遞增沒測。後果有限——視窗那一側 refreshLoad 吃掉所有例外(安靜)。
  - teach-session.ts 2 個:isCount 的 `typeof value === 'number'` 拿掉(後面還有 Number.isInteger,數字以外的值 isInteger 回 false,等價);refreshLoad 成功後的 emitChange 拿掉(App.svelte 已在 `.then` 裡自己 pull,等價)。

## 5. 手動檢查

- **teach.load 唯讀**:handler 的 loadInputs 只呼叫 readSessionCache(只讀、不建目錄不寫檔)與 loadSettings(讀);teach.readLoad 只讀 reviews 快照,再算數字。沒有呼叫 openDay、warnInvalidSessionCache、任何寫入函式;不動目前這張卡與麵包屑(兩個狀態變數都沒被碰)。測試證實:C13(順帶寫 log)、C14(順帶重存 reviews)、C6(順帶 teach.open)、stale 快取、壞掉快取、快取目錄不建都有條目抓。
- **卡片靜態禁止清單**:App.svelte 新增樣式 `.load-hint` 只用 `var(--hud-text)`,沒有 style 屬性、沒有顏色字面、沒有邊框/外框/陰影;card-static 的掃描在全 vitest 裡過。提示在 `.dock` 最下面、`.status-slot` 底下,學完畫面在「換類別」下面;載入中、出錯、類別清單不顯示(渲染測試對這三處都有量)。
- **安靜呼叫**:teachLoad 走 callOnce(送一次,不通知忙碌、不重試),忙或出錯由 session 吃掉(視窗測試用真 ReviewClient 讓 teach.load 一直回 busy,waiting/busyNotice/controlsDisabled 一次都沒動過)。

## 6. 自選手動改壞(筆電,對真實作;單元那批 679 條)

| # | 改法 | 結果 |
|---|---|---|
| P1 | 學過張數改成「日期 ≥ 今天」 | 紅 3 |
| P2 | 明天張數用 total 不用 shown | 紅 3 |
| P3、P3b | 讀到 stale 快取(兩種寫法) | 各紅 1(C9 新測試抓到) |
| P4 | 沒有 session 時每日上限寫死 10 | 紅 2 |
| P5 | session 開著時名單當 [] | 紅 1 |
| P6 | 回退的統計用「明天」 | 紅 3 |
| P7 | 明天到期不扣回退 | 紅 4 |
| P8 | teachLoad 改走一般 call(會發忙碌通知) | 紅 1 |
| P9 | parseLoad 接受負數 | 紅 1 |
| P10 | 重拿失敗時清掉舊數字 | 紅 7 |
| P11 | refreshLoad 成功後不通知 | 存活(等價,同上) |
| P12 | 回應沒有 load 時保留舊數字 | 紅 1 |
| P13 | readLoad 順帶重存 reviews.json | 紅 1(C14 新測試抓到) |

14 個裡 13 紅、1 等價存活。

## 7. 資料前後

- learning/:前後都是 64 檔 / e31b011a670e1a0f / 帳本 114 行。筆電 ~/.cache/llm-learning-cards 頂層 497(不變)。沒碰真的指標檔。

## 8. 清理

- 筆電簽出、i9 的兩個簽出與整個暫存根、暫存分支與引用都已移除;i9 上 /data/python/wt 沒有 t67 開頭的東西。

## 結論

通過,沒有阻擋項。
