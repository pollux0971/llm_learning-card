# 驗收證據:T67 紅測試(07 phase-5 今日負擔提示)

- 被驗分支:t67-red,6f367ed8b015ebfca7089cf73a0243cbc665f289(基底 7445428;4 個 commit、13 檔、1963 增 7 減)
- 開跑與跑完的 tree sha(筆電、i9 一致):26bd94cb4ee2728d377e50c133f99a1221956dfe
- 日期:2026-10-27。LLM 花費 0。沒有 `.env`。沒有開發 worker(紅測試階段)。

## 1. 範圍與作者

- 13 檔都在測試層:apps/teach-card/src 兩個既有版面測試加兩個新測試、features/steps 兩檔、features/support 的兩個既有 handler 測試加兩個新測試、packages/core/src/session 的 protocol.test、protocol.vectors.json 與一個新測試。實作檔(packages 的非測試檔、apps 的 App.svelte 與 teach-session、scripts)0 變動。tracked 檔裡沒有 mutants 輸出夾(計數 0)。

## 2. 基底紅、不是套套邏輯

i9 空 HOME(env 清掉 XDG_*、NO_COLOR、DBUS),在 t67-red(測試在、實作沒有)上:

| 層 | 結果 |
|---|---|
| vitest(session、teach、t67 各檔、t37/t43 handler、整個 apps/teach-card) | 47 檔,8 檔紅:95 條紅、808 條過。紅的檔:t67-load-render 13/14、t67-load-session 16、t67-teach-load 31、t67-estimate 21、t67-shared-estimate 6、protocol.test 6、t37-handler 1、t43-handler 1 |
| cucumber `@teach-card and @phase-5 and not @manual` | 8 場景全紅 |
| 既有 T44–T50 版面測試(含改過預期的 t47、t49) | 全過(t47 64/64、t49 32/32、t45 42/42、t44 11+12、t50 10) |
| cucumber 其他 `@teach-card` 場景 | 24/24 過 |

- 14 條渲染測試裡 13 條紅;沒紅的 1 條是「console 一則都沒有」,基底上本來就成立(資訊,不是缺口)。
- 紅的原因是「功能還沒有」(找不到 teach.load、estimateTomorrowFrom 不是函式、畫面沒有提示),不是測試自己寫壞。

## 3. 我自己寫的丟棄式實作能全轉綠(沒看 -a6 的;不進 git、已刪)

- 實作涵蓋:session/summary.ts 的 estimateTomorrowFrom(summarizeDay 改叫它)、teach/deck.ts 的 countLearnedOn、session/teach.ts 的 TeachView.load 與唯讀 load()、protocol.ts 新方法、handler.ts 的 teach.load 與 dueTomorrow 回呼、review-client 的 teachLoad(安靜版:不announce忙碌)、teach-session.ts 的 load 解析與 refreshLoad、App.svelte 的 focus 重拿與兩處提示。
- 結果(i9 空 HOME):
  - 同一批 vitest:47 檔 903/903 過。
  - 更大一批(features/support 全部、session、teach):57 檔 984/984 過。
  - cucumber `@teach-card and @phase-5 and not @manual`:8/8 過。
  - cucumber `@teach-card and not @manual`:32/32 過(24 舊 + 8 新)。
  - tsc 乾淨。boundaries PASS(掃 411 檔)。check:steps PASS(2713 句、1349 定義,無重複)。
  - Rust:`cargo test --test review_sidecar`(在 apps/desktop/src-tauri)41/41 過——新向量列 Rust 端全 accept,不會因新列變紅(Rust 只看信封,不看 method 名與 params 內容)。
- 順帶:測試要求 `teachLoad` 在忙碌時不能讓 session 的 waiting/busyNotice/controlsDisabled 動過;實作需要「安靜呼叫」(客戶端不對這個方法發忙碌通知),這是測試實際鎖住的行為,工單文字只說「安靜保留舊數字」,建議派工時提醒 worker。
- 其他測試集(`(@review-cli or @i2 or @phase-3) and not @manual and not @teach-card`)145 場景:143 過、2 undefined,都是 10-desktop-shell phase-3 本來就沒做的場景(Autostart、due count),與這批無關。
- HOME 下 .cache 只有 Chrome 的 fontconfig,沒有 llm-learning-cards。

## 4. 自選改壞(不在 -a6 的清單上)

在我的丟棄式實作上做,跑核心/側車/視窗那批(555 條)或對應的渲染測試。

| # | 改法 | 結果 |
|---|---|---|
| C1 | learnedToday 改成「學的日期 ≤ 今天」 | 紅 5 |
| C2 | dueTomorrow 用 total 不用 shown(忽略每日上限) | 紅 3 |
| C4 | 沒有考試卡 session 時每日上限寫死 10(不讀設定檔) | 紅 2 |
| C5 | 回退的統計用「明天」而非今天 | 紅 2 |
| C6 | teach.load 順帶 teach.open(重置畫面那張卡) | 紅 2 |
| C9 | 讀到別天的快取(stale)也拿它的名單 | **存活**(見下) |
| C10 | 沒有 session 時不讀磁碟上的當日快取 | 紅 1 |
| C11 | 「今天」改用機器日期 | 紅 10 |
| C12 | 明天到期張數不扣回退 | 紅 4 |
| C13 | teach.load 順帶寫一筆 log 事件 | 紅 4 |
| C14 | teach.load 順帶把 reviews.json 原封不動重存 | **存活**(見下) |
| W1 | 視窗接受負數的 load | 紅 1 |
| W2 | 重拿失敗時清掉舊數字 | 紅 7 |
| W5 | 回應沒有 load 時保留舊數字 | 紅 1 |
| W6 | 重拿回壞資料時把 load 清掉 | 紅 1 |
| W7 | 視窗接受小數 | 紅 2 |
| R1 | 提示放在 .dock 外面 | 紅 3 |
| R2 | 提示元素加 style 屬性 | 紅 1 |
| R4 | 學完畫面沒有提示 | 紅 1 |
| R5 | 提示顏色寫死 #888888 | 紅 1 |
| R8 | 提示放在 .status-slot 上面 | 紅 2 |
| R9 | focus 監聽只觸發一次 | 紅 2 |
| R10 | 重拿完不重畫(少 pull) | 紅 2 |
| R12 | 提示下面多 6px 空白(t47 版面) | 紅 4 |
| R13 | 提示往下偏 5px(t47 版面) | 紅 4 |
| R11 | 只把 .dock 本體的底色改 transparent(t49) | 存活——等價:.dock 還有 ::before 與 ::after 兩層不透明底色 |
| R11b | 把 ::after 的底色改 transparent(t49) | 紅 3 |
| R11c | .dock 與兩層偽元素的底色全改 transparent(t49) | 紅 14 |

28 個裡 25 紅、3 存活(R11 等價;C9、C14 是小缺口,不擋)。

### 小缺口(不擋,建議 -a6 低優先補列)

- **C9**:現有的「stale 快取」那條只驗快取檔沒被動、log 沒多事件,但佈置的 stale 快取名單裡沒有回退的卡,所以拿它的名單算出來數字一樣。補一條:stale 快取名單裡有今天回退的卡,teach.load 的 dueTomorrow 要忽略它。
- **C14**:「不寫 reviews.json」只比位元組。teach.load 原封不動重存(內容相同)分不出來。可補量 mtime 前後相同,或接受(影響只有時間戳)。

## 5. 動到既有測試:放寬還是跟規格走

| 處 | 改了什麼 | 判定 |
|---|---|---|
| a. t37-handler | 回應「七個欄位」→ 八個,加 load | 跟規格走,更嚴(精確比對鍵集合,多了 load) |
| b. t43-handler | 同欄位清單加 load | 同上 |
| c. protocol.test + 向量檔 | 十三個 method → 十四個(末尾 teach.load);新量尺 2 條;向量 +5 列(合法 1、不合法 params 3、未知 method teach.loads 1);Rust 向量測試 41/41 過 | 跟規格走,更嚴;沒有放鬆任何舊列。量尺自測會在向量被刪時紅 |
| d. t47 | dockGap 改成 max(按鈕列下緣、狀態字樣下緣、提示下緣);距離仍 ≤2、≥−0.5 不變 | 跟規格走。沒有提示時行為與舊的完全一樣(-Infinity);有提示時改量到提示下緣。我用 R12(多 6px)與 R13(偏 5px)證明仍抓得到 |
| e. t49 | 「黏底塊像素跟面板色差 ≤1」多扣掉提示那一行(外擴 2px) | 跟規格走。扣掉的只有提示框加 2px(字的反鋸齒像素);我用 R11b、R11c 證明整塊底色透明仍被抓到(紅 3、紅 14) |

## 6. 資料前後

- learning/:64 檔 / e31b011a670e1a0f / 帳本 114 行(跑後;與基準一致)。筆電 ~/.cache/llm-learning-cards 頂層 497(不變)。
- 筆電只做單檔層級的 vitest;Chrome、cucumber、cargo 全在 i9。沒碰真的指標檔。

## 7. 清理

- 筆電簽出、i9 的兩個簽出與暫存目錄(含 cargo 產物)、暫存分支與引用、i9 暫存檔都已移除。丟棄式實作沒進 git,補丁檔已刪。

## 結論

通過,沒有阻擋項。
