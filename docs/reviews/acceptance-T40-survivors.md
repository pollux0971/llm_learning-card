# T40 存活變異歸類(Stryker,review-client.ts)

來源:`acceptance-T40.md` 的 Stryker 一節,被驗 sha ef6d318。位置寫成「行 N 欄 M」。
分類:**真缺口**(測試沒釘到、行為會不同,交測試 agent 補)、**低**(行為差在不會發生或不影響使用者的邊上)、**等價**(改了也看不出差別)。

## 工單範圍(行 9–93 與 121–183):28 個存活

| 位置 | 變異 | 歸類 | 為什麼 / 怎麼補 |
|---|---|---|---|
| 行 78 欄 33、欄 61;行 79 欄 29 | 預設 sleep(外層與 setTimeout 那層)與預設 now 換成回 undefined 的函式 | **真缺口 G3** | 所有測試都注入假的 sleep 與 now,正式環境用的預設路徑沒人走過。補:不給 sleep 與 now,用 vi.useFakeTimers,invoke 先 busy 再成功,推進 300 ms 後第二次 invoke 發生、整體成功;並且不推進時第二次還沒發生 |
| 行 125 欄 25 | `now() - started` 換成 `now() + started` | **真缺口 G4** | 假時鐘都從 0 開始,0 加 0 與 0 減 0 一樣。正式用 Date.now,起點是一個很大的數,這個改壞會讓第一次嘗試就通知等候。補:假時鐘起點設成 1_700_000_000_000,總等候 ≤ 1000 ms 不通知 |
| 行 137 欄 13(兩個:換成 false、`>=` 換成 `>`)、行 137 欄 49(整塊清空)、行 154 欄 17(兩個)、行 154 欄 53(整塊清空) | 放棄檢查的兩處:少了其中一處,或邊界差 1 | **真缺口 G1** | 兩處檢查合起來才對:每次嘗試前檢查一次(沒有的話,過了 180 秒還會多送一次),busy 之後睡之前再檢查一次(沒有的話,過了 180 秒還會多睡 300 ms)。現有測試只看「之後不再呼叫」,沒釘住次數與時間。補三條:(a)每趟 invoke 花 0 ms 全 busy:invoke 剛好 600 次、sleep 剛好 600 次、丟 timeout 時假時鐘剛好 180000;(b)某一趟 invoke 花的時間讓 busy 回來時剛好超過 180000:不睡、不再送,丟 timeout;(c)剛好 180000 還送,和 179999 的對照 |
| 行 156 欄 37、行 156 欄 72 | busy 之後放棄那一處的 timeout 字樣換成空字串、unsent 換成 false | **真缺口 G1(同上)** | 現有測試的放棄都落在 137 那一處,154 這一處從沒被走到。補(b)就同時殺這兩個 |
| 行 47 欄 26、行 47 欄 60(兩個) | rejectionKind 的「kind 是字串」與「kind 不是空字串」判斷換成 true、`> 0` 換成 `>= 0` | **真缺口 G5** | 拒絕值 `{ kind: '' }` 與 `{ kind: 5 }` 應該都落到 sidecar-unavailable,現有測試只試了字串與 null。補這兩個拒絕值 |
| 行 87 欄 11(兩個) | 取消訂閱的 `at >= 0` 換成 true、`at > 0` | **真缺口 G6** | 取消第一個訂閱者沒測;換成 true 時重複取消會把最後一個訂閱者拿掉。補:三個訂閱者,取消第一個後只剩另兩個通知;同一個取消函式呼叫兩次,別人仍收得到 |
| 行 20 欄 17 | ReviewError 的 name 換成空字串 | 低 | 考試卡 session 的 reviewOf 有 name 比對的後備(跨環境的錯誤物件)。補一行 `expect(new ReviewError(...).name).toBe('ReviewError')` 即可 |
| 行 43 欄 10 | isRecord 的 typeof 判斷換成 true | 低 | 對 rejectionKind 等價(字串與陣列的 .kind 也是 undefined)。但同一個 helper 也在 attempt 驗 value.result,見下面 attempt 一節 |
| 行 68 欄 37 | BAD_RESPONSE 的鍵 'bad-response' 換成空字串(訊息變 undefined) | 低 | 畫面上的字樣由 kind 查 ERROR_MESSAGES 得來,不看這個 message。補:斷言 bad-response 的 message |
| 行 92 欄 28 | 通知時 listeners.slice() 換成 listeners | 低 | 只有在通知的過程中有人取消訂閱時才不同;沒有人這樣做。可以補一個測試,不急 |
| 行 149 欄 15、欄 43 | 「attempt 丟出 ReviewError 就直接重丟」的條件換成 false、整塊清空 | 低 | 掉到下面重新包一個同 kind 同 message 的 ReviewError,只差在側車自己回 kind 為 busy 的業務錯誤時會被重試(協定上側車不會回 busy)。補:ok:false 的 kind 為 busy 只送一次 |
| 行 138 欄 11、行 150 欄 13、行 155 欄 15、行 161 欄 11、行 166 欄 7 | 五處 endWait() 呼叫被拿掉 | **等價** | 同一個函式最外層 catch 也會呼叫 endWait,任何一處拿掉,出口還是會通知「不等了」一次 |

## attempt(行 95–119,舊的回應驗證):20 個存活,不在工單範圍

這一段是 T22/T24 以前就有的回應驗證,T40 沒有改它,現有測試也沒有釘。列出來給測試 agent 排順序(不擋 T40):

- 行 101 欄 45、行 108 欄 70、行 117 欄 77:丟 bad-response 時 kind 字串換成空字串。補:畫面收到格式錯的回應時 kind 是 bad-response。
- 行 108 欄 9(兩個:換成 false、`||` 換成 `&&`)、行 117 欄 9(兩個)、行 117 欄 77:回應不是物件、ok 不是 true、result 不是物件時都要丟 bad-response。補:每種各一個回應。
- 行 106 欄 18、欄 33,行 107 欄 20、欄 35:invoke 回字串的分支。Rust 的 invoke 回的是物件,字串分支是死碼;106 那兩個等價,107 那兩個只有在 invoke 真的回字串時才不同。
- 行 113 欄 20(三個)、欄 54(兩個)、欄 91、行 114 欄 23:側車 ok:false 回應的 kind 與 message 的後備(沒 kind 用 internal、沒 message 用 kind)。補:ok:false 沒有 kind、kind 為空字串、kind 非字串,各一個。
- 行 43 欄 10 在這裡不等價:ok:true 但 result 是字串或數字時,應該丟 bad-response,現在會原樣回傳。

## 另外:不在 Stryker 範圍,手改存活

- **G2(教學卡 teach-session)**:`controlsDisabled = isWaiting || inFlight` 改成只看 isWaiting 全綠。補:onWait(false) 在請求還沒回來時送出,按鈕仍然停用,請求完成後才放開。
- C4 / C5 是 G1 的手改版。

## 建議順序

G1、G3、G4(各 1–3 條測試)是最重要的:它們管的是 180 秒放棄與正式環境用的時鐘,是 T40 修法 2 的核心。G5、G6、G2 次之。attempt 那一段另開小票即可。

## 已知、不修(顧問裁)

call_locked 換 id 後,長度檢查在請求貼著 262,144 bytes 上限時可能多拒一次:已知、不修。理由(顧問裁):上限守的是真正送出去的那一行,實際請求遠小於上限。不開票、不補測。
