# T47 紅測試驗收證據(只驗測試,不是實作)

- 被驗分支:`t47-red2` 5e5e66fbfd57398ec6c31f81e649d250000760cc(基底 `cd21d85`,含 T48 實作)
- tree sha(開跑與跑完相同):de0a0c0ad091427551a924bb46e26550be1993da
- 日期:2026-10-24;驗收 agent;`VITEST_MAX_WORKERS=1`;乾淨簽出,`.env` 不存在,`node_modules/@learning/*` 指向自己的 packages
- 本檔只是證據,結論由顧問裁決

## 1. 只動測試與 feature

對基底多 4 檔:`t47-test-support.ts`、`t47-window-static.test.ts`、`t47-zoom-layout-render.test.ts`、`features/07-teach-card/phase-4.feature`(+1262/−4)。沒有實作檔。提交裡 `mutants.out` 0。

## 2. 基底上的紅綠(真渲染)

t47 兩檔共 67 條:**58 紅、9 綠**,與測試作者自報一致。
- 紅的原因都是功能還沒有:縮放鍵無效(內容不是 80/90/110/125/150%)、行數不隨級距變、長卡捲到上面時「下一個」在看得到範圍外、往上找不到 `position: sticky` 的祖先、`minWidth` 是 undefined、縮放鍵沒被攔下(preventDefault 七個都是 false)、T45 轉換在長卡捲到中間時按鈕不在看得到範圍。不是 import 或環境錯。
- 本來就綠的 9 條都是守門條:c 兩條(捲到底時最後內容在黏住那塊上面、短卡按鈕在內容後面)、f 一條(捲到最下面時提示沒蓋住)、e 六條(原欄位不動、考試卡視窗不動、視窗仍兩個、沒有 zoomHotkeysEnabled、教學卡與桌面殼沒呼叫 webview 縮放)。
- 渲染測試用 `openApp` + 真鍵盤(第二條 CDP 的 Input.dispatchKeyEvent)+ 真指標,量 Range 寬度、`getBoundingClientRect`、computed style、`elementFromPoint`;沒有拿原始碼字串當渲染結果。靜態 e 讀 `tauri.conf.json`(JSON.parse)與原始碼字面,是工單指定的靜態測試。

## 3. 工單 must_catch a–f 對應

a 縮放鍵、到頭不動、還原、換卡與重載照舊、按鈕列與標題列不縮放 → 九條 a;b 四種視窗大小 × 每級無橫向捲動與行數增加 → 四條 b;c 長內容捲上中下 → 七條 c;d 縮放下 T45 轉換 → 多組 d;e 視窗最小寬高與縮放快捷鍵 → 靜態 e;f Wayland 提示 → 四條 f。全部在下面的改壞中至少被一條抓到。

## 4. 丟棄式實作(不進 git,已刪)

我自己寫了一份:鍵盤 Ctrl/Cmd 加 = + - 0(含數字鍵盤)改 `level`,存 `deps.storage`;卡片內容包一層 `style:zoom`;按鈕列加狀態字樣那塊包進 `position: sticky; bottom: 0; background: var(--hud-panel)`;放大層搬到黏住那塊外面;`tauri.conf.json` 教學卡視窗加 `minWidth: 360`、`minHeight: 400`。
- t47 兩檔 **67/67 綠**。
- 全回歸(teach-card、ui-shared、desktop 的 vitest,64 檔 1083 條):**只有 T48 的 7 條紅**。原因:黏住那塊蓋住例子標題,T48 測試的 `scrollIntoView({block:'nearest'})` 會把標題捲到被蓋住的位置,真指標點到的是黏住那塊。在 `.hud-body` 加 `scroll-padding-bottom`(約 8.5rem)之後 teach-card 全部 **289 條綠**(19 檔,含 T46、T48、T47)。這就是協調者要寫進派工提示的第二點;沒有這一點,實作會被 T48 擋住。
- 加上 scroll-padding 後:cucumber teach-card 非 manual 24 場景 118 步全綠;tsc 乾淨;boundaries 374;doc-links 131。

## 5. 改壞證明(對我的丟棄式實作;每版跑 t47 兩檔加 card-static,共 81 條)

| # | 改了什麼 | 結果 |
|---|---|---|
| Z1 | 縮放改成 `transform: scale` | 紅 11 |
| Z2 | 縮放連按鈕列一起縮 | 紅 13(d 的 150%) |
| Z3 | 拿掉 sticky | 紅 24(c、f) |
| Z4 | 拿掉狀態字樣留的位置 | 紅 26(d) |
| Z5 | `minWidth` 改 300 | 紅 1(e) |
| Z9 | `minHeight` 改 300 | 紅 1(e) |
| Z6 | 級距少一檔(沒有 125%) | 紅 4(a) |
| Z7 | 不存設定(跨卡不記住) | 紅 1(a 跨卡) |
| Z8 | `Ctrl+0` 還原到 110% | 紅 24 |
| Z10 | 縮放鍵不 preventDefault | 紅 1(a) |
| Z12 | 黏住那塊沒有底色 | 紅 1(c) |
| Z13 | 不認 Cmd(Meta) | 紅 1(a) |
| Z16 | 加上 `zoomHotkeysEnabled: true` | 紅 1(e) |
| Z17 | 黏住那塊上框線 | 紅 2(c 與 card-static) |
| Z19 | 放大到頭繞回最小 | 紅 1(a) |
| Z20 | 不認 `Ctrl+Shift+=` 的 `+` | 紅 2(a) |
| Z21 | 縮放改成只改 font-size | 紅 9(a) |
| Z11 | 黏住那塊 `bottom: 40px`(離視窗底 40 px,下面露出內容) | **存活** |
| Z14 | 不認數字鍵盤的 code(只靠 key) | **存活**(等價:測試送的 key 本來就是 `+` `-` `0`,實際瀏覽器的數字鍵盤 Ctrl 組合也是) |

不在作者清單上的我設計的:Z6、Z8、Z11、Z12、Z13、Z14、Z19、Z20、Z21 等 9 版,其中 7 版紅、2 版存活。

### 存活項

- **Z11(真缺口,低到中)**:沒有測試量「黏住那塊的下緣貼著 `.hud-body` 看得到範圍的下緣」。黏住那塊往上偏 40 px、下面露出內容,所有測試仍綠。建議補一條:很長的卡捲到上、中兩個位置,黏住那塊的下緣離看得到範圍的下緣不超過幾 px(例如 2 px)。
- **Z14**:等價,不補。

## 6. feature 措辭對 ADR-080

- 場景 6:`Then the card content scales up one step` / `And the controls keep their size`,對 D1(只縮卡片內容、按鈕列不縮)。
- 場景 7:`Then the body and the examples scroll together` / `And the controls stay fixed at the bottom`,對 D3=B(內文與例子一起捲、按鈕列黏底),且不寫「three」(level 1 起有「回上一層」)。
- 兩個場景都是 `@manual`,沒有步驟定義要改;cucumber 非 manual 24 場景照常過。

## 7. 資料前後(只記數字)

learning/ 前後都是 64 檔、`c2e4dd6d71de3976`、帳本 108 行。

## 結論

通過(紅測試可用:基底 58 紅 9 綠,丟棄版 67/67 綠、回歸除 T48 需要 scroll-padding 外全綠;建議補 Z11 一條測試,不擋)。
