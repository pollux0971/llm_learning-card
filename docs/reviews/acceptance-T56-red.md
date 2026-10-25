# T56 紅測試驗收證據

- 工單:T56(HUD 的縮放把手與標題列改在 mousedown 開始拖拉、只認左鍵)。只驗測試。
- 被驗分支:t56-red,sha 1b6fa9da142e932736754172270fb4d20b8d0323(基底 aae1eba,1 個 commit)
- 開跑與跑完的 tree sha:4ef4485a249169ca7e6b217d04f4ac2b1304f257(相同;丟棄實作與改壞都已還原,git status 乾淨)
- 日期:2026-10-25
- 工作樹:乾淨簽出(detached),沒有 .env

## 只動測試
只加一個檔:packages/ui-shared/src/hud/hud-drag-wiring-render.test.ts(51 條:a 9、b 3、c 3、d 18、e 18)。沒有實作檔。

## 真渲染,沒有比原始碼字串
- 在 Chrome 畫出展示頁,打開「無框」開關後有標題列與八個把手。
- 用同一個 Chrome 的第二條 CDP 送真的滑鼠(可選左、右、中鍵)。
- 用 initScript 放假的 Tauri(isTauri 與 invoke),頁面走真的視窗控制,記下 invoke 的命令名與縮放方向。
- 唯一讀檔的地方是找 Chrome 的除錯埠。選擇器與基底元件對得上。
- 含新檔的樹 boundaries:PASS(377);tsc 乾淨。

## 基底紅綠
51 條 = 20 紅 / 31 綠,與測試 agent 自報一致,也與讀碼推算一致:
- 紅 20:b 的真右鍵、真中鍵各 1(基底掛 pointerdown,任何鍵都開始);d 18(九個位置各 2 條:第二次只有 mousedown 時基底不開始,實際 1 次要 2 次;只有 pointerdown 時基底會開始)。
- 綠 31:a 9、c 3、e 18、b 的合成非左鍵 mousedown 1(基底沒掛 mousedown,所以本來就不叫);是護欄。
- 紅的原因都是「還沒有這個功能」。

## 丟棄式實作(不進 git,已刪)
把手與標題列的 pointerdown 改成 mousedown,只認左鍵(button 為 0);標題列保留 closest('button') 的擋法;不加 preventDefault。51/51 全綠;tsc 乾淨;packages/ui-shared 與 apps/test-card 共 32 檔 853 條全綠。

## 改壞(對丟棄實作手改;測試範圍:新檔 51 條)
| # | 改法 | 結果 |
|---|---|---|
| Y1 | 兩處都改回 pointerdown | 紅 18(全是 d) |
| Y2 | 把手拿掉左鍵判斷 | 紅 3(b) |
| Y3 | 標題列拿掉左鍵判斷 | 紅 3(b) |
| Y4 | 把手同時掛 pointerdown 與 mousedown | 紅 40(a 8、d 16、e 16;一次按下開兩次) |
| Y5 | 標題列同時掛兩個事件 | 紅 5(a 1、d 2、e 2) |
| Y6 | 標題列拿掉 closest('button') 擋法 | 紅 3(c) |
| Y7 | 把手 North 寫成 South(方向錯一個) | 紅 4(a 1、d 1、e 2) |
| Y9 | 標題列改掛 mouseup | 紅 2(d 1、e 1) |
| Y10 | 把手改掛 click | 紅 16(d 8、e 8) |
| Y11 | 標題列在 mousedown 加 preventDefault | **存活**(51 全綠) |
10 個:9 紅、1 存活。工單 must_catch 五條(改回 pointerdown → d;拿掉左鍵判斷 → b;兩個事件都接 → e;拿掉 closest → c;方向寫錯 → a)都對應到紅。

## 殘餘缺口(低,交顧問裁)
工單要的結果第 4 條「不加 preventDefault(T54 量過沒用,還會改到焦點)」沒有測試守,Y11 存活。可補一條:在把手與標題列上送一個可取消的左鍵 mousedown,斷言它沒有被 preventDefault(defaultPrevented 為假)。不擋。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 結論
通過(附一項殘餘缺口建議)。
